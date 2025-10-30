const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');

const app = express();

const PORT = process.env.PORT || 3000;
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';
const OSRM_BASE = process.env.OSRM_BASE || 'http://router.project-osrm.org';

app.use(cors({ origin: CORS_ORIGIN, credentials: false }));
app.use(express.json());

const pool = new Pool({
    host: process.env.PGHOST || 'postgres',
    port: Number(process.env.PGPORT || 5432),
    database: process.env.PGDATABASE,
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD,
    max: 10
});

// Your existing endpoints (unchanged)
app.get('/markers', async (_req, res) => {
    try {
        const { rows } = await pool.query('SELECT username, coords FROM markers');
        res.json(rows);
    } catch (e) {
        console.error('GET /markers error:', e);
        res.status(500).json({ error: 'db_error' });
    }
});

app.get('/polylines', async (_req, res) => {
    try {
        const { rows } = await pool.query('SELECT username, coords FROM polylines');
        res.json(rows);
    } catch (e) {
        console.error('GET /polylines error:', e);
        res.status(500).json({ error: 'db_error' });
    }
});

// UPDATED: Get pre-cached polylines (FAST - no OSRM processing)
app.get('/api/paths/encoded', async (req, res) => {
    try {
        const { device_id, hours = 168 } = req.query;

        console.log(`\n🗺️ Fetching cached polylines for: ${device_id || 'all devices'}, timeframe: ${hours}h`);

        const startTime = performance.now();

        // Query cached_polylines table (pre-processed by background worker)
        let query = `
            SELECT 
                device_id,
                start_time,
                end_time,
                encoded_polyline,
                osrm_confidence,
                point_count
            FROM cached_polylines
            WHERE start_time > $1
        `;
        
        const params = [new Date(Date.now() - hours * 60 * 60 * 1000)];

        if (device_id) {
            query += ' AND device_id = $2';
            params.push(device_id);
        }

        query += ' ORDER BY start_time DESC';

        const { rows } = await pool.query(query, params);
        
        const queryTime = performance.now() - startTime;
        console.log(`✅ Query completed in ${queryTime.toFixed(0)}ms, found ${rows.length} cached polylines`);

        if (rows.length === 0) {
            return res.json({ devices: [] });
        }

        // Group by device
        const deviceMap = {};
        rows.forEach(row => {
            if (!deviceMap[row.device_id]) {
                deviceMap[row.device_id] = [];
            }
            deviceMap[row.device_id].push({
                start_time: row.start_time,
                end_time: row.end_time,
                encoded_polyline: row.encoded_polyline,
                osrm_confidence: row.osrm_confidence,
                point_count: row.point_count
            });
        });

        // Format response to match frontend expectations
        const devices = Object.keys(deviceMap).map(deviceId => {
            const polylines = deviceMap[deviceId];
            
            // Return as batches to match existing frontend code
            return {
                device: deviceId,
                start_time: polylines[0].start_time,
                end_time: polylines[polylines.length - 1].end_time,
                coordinate_count: polylines.reduce((sum, p) => sum + p.point_count, 0),
                batches: polylines.map(p => ({
                    success: true,
                    encoded_polyline: p.encoded_polyline,
                    confidence: p.osrm_confidence
                })),
                matched_batches: polylines.length,
                total_batches: polylines.length,
                coverage: '100%',
                cache_hits: polylines.length
            };
        });

        const totalTime = performance.now() - startTime;
        console.log(`⚡ Total time: ${totalTime.toFixed(0)}ms for ${devices.length} device(s)\n`);
        
        res.json({ devices });

    } catch (e) {
        console.error('GET /api/paths/encoded error:', e);
        res.status(500).json({ error: 'db_error', message: e.message });
    }
});

// Cache statistics endpoint
app.get('/cache/stats', async (req, res) => {
    try {
        const stats = await pool.query(`
            SELECT 
                COUNT(*) as total_cached_paths,
                COUNT(DISTINCT device_id) as unique_devices,
                MIN(start_time) as oldest_path,
                MAX(end_time) as newest_path,
                SUM(point_count) as total_points
            FROM cached_polylines
        `);

        res.json(stats.rows[0]);
    } catch (error) {
        console.error('Cache stats error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get activated road segments (UNCHANGED - working correctly)
app.get('/api/segments', async (req, res) => {
    try {
        const { municipality = 'pomfret-vt', since } = req.query;
        
        console.log(`🛣️  Fetching segments for ${municipality}${since ? ` since ${since}` : ''}`);
        
        let query = `
            SELECT 
                id,
                ST_AsGeoJSON(geometry) as geometry,
                street_name,
                road_classification,
                bearing,
                last_plowed_forward,
                last_plowed_reverse,
                last_plowed_device_id,
                plow_count_today,
                plow_count_total,
                segment_length
            FROM road_segments
            WHERE municipality_id = $1
        `;
        
        const params = [municipality];
        
        // Optional time filter
        if (since) {
            query += ` AND (last_plowed_forward > $2 OR last_plowed_reverse > $2)`;
            params.push(new Date(since));
        } else {
            // Default: only return segments plowed in last 7 days
            query += ` AND (last_plowed_forward > NOW() - INTERVAL '7 days' OR last_plowed_reverse > NOW() - INTERVAL '7 days')`;
        }
        
        query += ` ORDER BY GREATEST(last_plowed_forward, last_plowed_reverse) DESC`;
        
        const { rows } = await pool.query(query, params);
        
        console.log(`✅ Returning ${rows.length} activated segments`);
        
        // Transform to GeoJSON-friendly format
        const segments = rows.map(row => ({
            id: row.id,
            geometry: JSON.parse(row.geometry),
            properties: {
                street_name: row.street_name,
                road_classification: row.road_classification,
                bearing: row.bearing,
                last_plowed_forward: row.last_plowed_forward,
                last_plowed_reverse: row.last_plowed_reverse,
                last_plowed: row.last_plowed_forward > row.last_plowed_reverse 
                    ? row.last_plowed_forward 
                    : row.last_plowed_reverse,
                device_id: row.last_plowed_device_id,
                plow_count_today: row.plow_count_today,
                plow_count_total: row.plow_count_total,
                segment_length: row.segment_length
            }
        }));
        
        res.json({
            type: 'FeatureCollection',
            features: segments
        });
        
    } catch (error) {
        console.error('GET /api/segments error:', error);
        res.status(500).json({ error: 'db_error', message: error.message });
    }
});

// Health check endpoint
app.get('/health', async (req, res) => {
    try {
        await pool.query('SELECT 1');
        
        res.json({
            status: 'healthy',
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).json({ status: 'unhealthy', error: error.message });
    }
});

app.listen(PORT, () => {
    console.log(`✅ MudMaps backend running on ${PORT}`);
    console.log(`📦 Using cached_polylines table (pre-processed)`);
    console.log(`🛣️  Segments endpoint: /api/segments`);
});