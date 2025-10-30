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

// Legacy endpoints (kept for backward compatibility, but deprecated)
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

// Enhanced markers endpoint with temporal filtering (DEPRECATED - use device_id parameter)
app.get('/markers/enhanced', async (req, res) => {
    try {
        const {
            limit = 1000,
            offset = 0,
            device_id,
            username,  // Legacy support
            since,
            hours = 24  // Default to last 24 hours
        } = req.query;

        const deviceIdParam = device_id || username;  // Support both for backward compatibility

        let query = 'SELECT device_id, coords, created_at FROM markers';
        let conditions = [];
        let params = [];
        let paramCount = 0;

        // Add time filter (default to last 24 hours)
        const timeFilter = since ? new Date(since) : new Date(Date.now() - hours * 60 * 60 * 1000);
        conditions.push(`created_at > $${++paramCount}`);
        params.push(timeFilter);

        if (deviceIdParam) {
            conditions.push(`device_id = $${++paramCount}`);
            params.push(deviceIdParam);
        }

        if (conditions.length > 0) {
            query += ' WHERE ' + conditions.join(' AND ');
        }

        query += ` ORDER BY created_at ASC LIMIT $${++paramCount} OFFSET $${++paramCount}`;
        params.push(parseInt(limit), parseInt(offset));

        const { rows } = await pool.query(query, params);

        console.log(`Enhanced markers query returned ${rows.length} rows`);
        res.json(rows);
    } catch (e) {
        console.error('GET /markers/enhanced error:', e);
        res.status(500).json({ error: 'db_error', message: e.message });
    }
});

// Primary endpoint: Fast path retrieval from cached_polylines with optional deduplication
app.get('/paths/encoded', async (req, res) => {
    try {
        const { 
            device_id,
            username,  // Legacy support
            hours = 24,
            deduplicate = 'true',  // Enable deduplication by default
            overlap_threshold = 0.5,  // 50% overlap to consider superseded
            bearing_tolerance = 30  // ±30 degrees for same direction
        } = req.query;

        const deviceIdParam = device_id || username;  // Support both for backward compatibility

        console.log(`\n🗺️  Fetching cached paths: device=${deviceIdParam || 'all'}, hours=${hours}, dedupe=${deduplicate}`);

        let query;
        let params = [new Date(Date.now() - hours * 60 * 60 * 1000)];

        if (deduplicate === 'true') {
            // Spatial deduplication query using PostGIS
            query = `
                WITH ranked_polylines AS (
                    SELECT 
                        p1.id,
                        p1.device_id,
                        p1.encoded_polyline,
                        p1.start_time,
                        p1.end_time,
                        p1.point_count,
                        p1.osrm_confidence,
                        p1.bearing,
                        p1.geometry,
                        -- Check if this polyline is superseded by a newer one
                        EXISTS(
                            SELECT 1 
                            FROM cached_polylines p2
                            WHERE p2.start_time > p1.end_time  -- Newer polyline
                            AND p2.start_time <= $1 + INTERVAL '1 hour'  -- Within extended time window
                            AND p2.geometry IS NOT NULL
                            AND p1.geometry IS NOT NULL
                            AND ST_Intersects(p1.geometry, p2.geometry)  -- Overlaps spatially (uses GIST index)
                            AND ST_Length(
                                ST_Intersection(p1.geometry, p2.geometry)::geography
                            ) / NULLIF(ST_Length(p1.geometry::geography), 0) > $${params.length + 1}  -- Overlap threshold
                            AND bearings_similar(p1.bearing, p2.bearing, $${params.length + 2})  -- Same direction
                        ) AS is_superseded
                    FROM cached_polylines p1
                    WHERE p1.start_time > $1
                    ${deviceIdParam ? `AND p1.device_id = $${params.length + 3}` : ''}
                )
                SELECT 
                    id, device_id, encoded_polyline, start_time, 
                    end_time, point_count, osrm_confidence
                FROM ranked_polylines
                WHERE NOT is_superseded  -- Only return non-superseded polylines
                ORDER BY start_time ASC
            `;
            
            params.push(parseFloat(overlap_threshold));
            params.push(parseFloat(bearing_tolerance));
            
            if (deviceIdParam) {
                params.push(deviceIdParam);
            }
        } else {
            // Original query without deduplication
            query = `
                SELECT 
                    device_id,
                    encoded_polyline,
                    start_time,
                    end_time,
                    point_count,
                    osrm_confidence
                FROM cached_polylines
                WHERE start_time > $1
                ${deviceIdParam ? 'AND device_id = $2' : ''}
                ORDER BY start_time ASC
            `;
            
            if (deviceIdParam) {
                params.push(deviceIdParam);
            }
        }

        const { rows } = await pool.query(query, params);
        
        console.log(`📊 Found ${rows.length} polylines (deduplicated: ${deduplicate})`);

        if (rows.length === 0) {
            return res.json({ devices: [] });
        }

        // Group by device
        const deviceGroups = {};
        rows.forEach(row => {
            const device = row.device_id;
            if (!deviceGroups[device]) {
                deviceGroups[device] = [];
            }
            deviceGroups[device].push(row);
        });

        console.log(`📱 Returning ${Object.keys(deviceGroups).length} device(s)`);

        const results = [];

        for (const [device, polylines] of Object.entries(deviceGroups)) {
            const deviceResult = {
                device: device,
                polylines: polylines.map(p => ({
                    encoded_polyline: p.encoded_polyline,
                    start_time: p.start_time,
                    end_time: p.end_time,
                    point_count: p.point_count,
                    osrm_confidence: p.osrm_confidence
                })),
                start_time: polylines[0].start_time,
                end_time: polylines[polylines.length - 1].end_time,
                total_points: polylines.reduce((sum, p) => sum + p.point_count, 0)
            };

            results.push(deviceResult);
            console.log(`✅ Device ${device}: ${polylines.length} segments, ${deviceResult.total_points} points`);
        }

        console.log(`\n✅ Returning ${results.length} device path(s) from cache\n`);
        res.json({ devices: results });

    } catch (e) {
        console.error('GET /paths/encoded error:', e);
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
                SUM(point_count) as total_points,
                MIN(created_at) as oldest_cache,
                MAX(created_at) as newest_cache,
                COUNT(geometry) as paths_with_geometry,
                COUNT(bearing) as paths_with_bearing
            FROM cached_polylines
        `);

        res.json(stats.rows[0]);
    } catch (error) {
        console.error('Cache stats error:', error);
        res.status(500).json({ error: error.message });
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
    console.log(`✅ MudMaps backend running on ${PORT} (behind proxy)`);
    console.log(`💾 Reading from cached_polylines with PostGIS deduplication`);
});
