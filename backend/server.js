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

// Enhanced markers endpoint with temporal filtering
app.get('/markers/enhanced', async (req, res) => {
    try {
        const {
            limit = 1000,
            offset = 0,
            username,
            since,
            hours = 24  // Default to last 24 hours
        } = req.query;

        let query = 'SELECT username, coords, created_at FROM markers';
        let conditions = [];
        let params = [];
        let paramCount = 0;

        // Add time filter (default to last 24 hours)
        const timeFilter = since ? new Date(since) : new Date(Date.now() - hours * 60 * 60 * 1000);
        conditions.push(`created_at > $${++paramCount}`);
        params.push(timeFilter);

        if (username) {
            conditions.push(`username = $${++paramCount}`);
            params.push(username);
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

// NEW: Fast path retrieval from cached_polylines (no OSRM calls!)
app.get('/paths/encoded', async (req, res) => {
    try {
        const { username, hours = 168 } = req.query; // Default to 7 days (168 hours)

        console.log(`\n🗺️  Fetching cached paths for: ${username || 'all devices'}, timeframe: ${hours}h`);

        // Query cached polylines directly - no OSRM calls!
        let query = `
            SELECT 
                device_id,
                encoded_polyline,
                start_time,
                end_time,
                point_count,
                osrm_confidence
            FROM cached_polylines
            WHERE start_time > $1
        `;
        let params = [new Date(Date.now() - hours * 60 * 60 * 1000)];

        if (username) {
            query += ' AND device_id = $2';
            params.push(username);
        }

        query += ' ORDER BY start_time ASC';

        const { rows } = await pool.query(query, params);
        console.log(`📊 Found ${rows.length} cached polylines`);

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

// NEW: Cache statistics endpoint
app.get('/cache/stats', async (req, res) => {
    try {
        const stats = await pool.query(`
            SELECT 
                COUNT(*) as total_cached_paths,
                COUNT(DISTINCT device_id) as unique_devices,
                SUM(point_count) as total_points,
                MIN(created_at) as oldest_cache,
                MAX(created_at) as newest_cache
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
    console.log(`💾 Reading from cached_polylines - instant map loads!`);
});