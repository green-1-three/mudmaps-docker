const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');

const app = express();

const PORT = process.env.PORT || 3000;
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';

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

// ============================================
// NEW SCHEMA ENDPOINTS (Option B - Replace)
// ============================================

// GET /markers - Returns GPS points (from gps_raw_data)
app.get('/markers', async (req, res) => {
    try {
        const { limit = 1000 } = req.query;
        
        const { rows } = await pool.query(`
            SELECT 
                device_id as username,
                ARRAY[longitude, latitude] as coords,
                recorded_at as created_at
            FROM gps_raw_data
            ORDER BY recorded_at DESC
            LIMIT $1
        `, [parseInt(limit)]);
        
        res.json(rows);
    } catch (e) {
        console.error('GET /markers error:', e);
        res.status(500).json({ error: 'db_error', message: e.message });
    }
});

// GET /markers/enhanced - Enhanced GPS query with filtering
app.get('/markers/enhanced', async (req, res) => {
    try {
        const {
            limit = 1000,
            offset = 0,
            username,
            since,
            hours = 24
        } = req.query;

        let query = `
            SELECT 
                device_id as username,
                ARRAY[longitude, latitude] as coords,
                recorded_at as created_at
            FROM gps_raw_data
        `;
        
        let conditions = [];
        let params = [];
        let paramCount = 0;

        // Add time filter
        const timeFilter = since 
            ? new Date(since) 
            : new Date(Date.now() - hours * 60 * 60 * 1000);
        conditions.push(`recorded_at > $${++paramCount}`);
        params.push(timeFilter);

        if (username) {
            conditions.push(`device_id = $${++paramCount}`);
            params.push(username);
        }

        if (conditions.length > 0) {
            query += ' WHERE ' + conditions.join(' AND ');
        }

        query += ` ORDER BY recorded_at ASC LIMIT $${++paramCount} OFFSET $${++paramCount}`;
        params.push(parseInt(limit), parseInt(offset));

        const { rows } = await pool.query(query, params);

        console.log(`Enhanced markers query returned ${rows.length} rows`);
        res.json(rows);
    } catch (e) {
        console.error('GET /markers/enhanced error:', e);
        res.status(500).json({ error: 'db_error', message: e.message });
    }
});

// GET /paths/cached - Fast endpoint reading from cache
app.get('/paths/cached', async (req, res) => {
    try {
        const { username, hours = 24 } = req.query;

        if (!username) {
            return res.status(400).json({ 
                error: 'username parameter is required' 
            });
        }

        console.log(`🚀 Fetching cached paths for: ${username}, timeframe: ${hours}h`);

        const query = `
            SELECT 
                device_id,
                start_time,
                end_time,
                encoded_polyline,
                osrm_confidence,
                point_count,
                created_at
            FROM cached_polylines
            WHERE device_id = $1
              AND start_time > $2
            ORDER BY start_time ASC
        `;
        
        const params = [
            username,
            new Date(Date.now() - hours * 60 * 60 * 1000)
        ];

        const { rows } = await pool.query(query, params);

        // Update access tracking
        if (rows.length > 0) {
            await pool.query(`
                UPDATE cached_polylines
                SET last_accessed = NOW(),
                    access_count = access_count + 1
                WHERE device_id = $1
                  AND start_time > $2
            `, params);
        }

        console.log(`✅ Returned ${rows.length} cached path(s)`);
        
        res.json({
            cached: true,
            device: username,
            paths: rows,
            count: rows.length
        });

    } catch (e) {
        console.error('GET /paths/cached error:', e);
        res.status(500).json({ error: 'db_error', message: e.message });
    }
});

// GET /paths/encoded - LEGACY: Fallback for uncached data
// This endpoint now just reads from cache (worker does the processing)
app.get('/paths/encoded', async (req, res) => {
    try {
        const { username, hours = 24 } = req.query;

        console.log(`⚠️  Legacy /paths/encoded called for: ${username || 'all devices'}`);
        console.log(`   (Redirecting to cached data - use /paths/cached instead)`);

        if (!username) {
            return res.status(400).json({ 
                error: 'username parameter is required',
                hint: 'Use /paths/cached endpoint instead'
            });
        }

        // Just read from cache - no on-demand processing
        const query = `
            SELECT 
                device_id as device,
                start_time,
                end_time,
                encoded_polyline as encoded_path,
                osrm_confidence,
                point_count as coordinate_count
            FROM cached_polylines
            WHERE device_id = $1
              AND start_time > $2
            ORDER BY start_time ASC
        `;
        
        const params = [
            username,
            new Date(Date.now() - hours * 60 * 60 * 1000)
        ];

        const { rows } = await pool.query(query, params);

        // Format to match old response structure
        const result = {
            devices: rows.map(row => ({
                device: row.device,
                start_time: row.start_time,
                end_time: row.end_time,
                encoded_path: row.encoded_path,
                osrm_confidence: row.osrm_confidence,
                coordinate_count: row.coordinate_count
            }))
        };

        res.json(result);

    } catch (e) {
        console.error('GET /paths/encoded error:', e);
        res.status(500).json({ error: 'db_error', message: e.message });
    }
});

// GET /polylines - Manual polylines (if you still need this)
app.get('/polylines', async (req, res) => {
    try {
        // Check if table still exists
        const tableCheck = await pool.query(`
            SELECT EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_name = 'polylines'
            )
        `);
        
        if (!tableCheck.rows[0].exists) {
            return res.json([]);
        }
        
        const { rows } = await pool.query('SELECT username, coords FROM polylines');
        res.json(rows);
    } catch (e) {
        console.error('GET /polylines error:', e);
        res.status(500).json({ error: 'db_error', message: e.message });
    }
});

// ============================================
// WORKER STATUS & MONITORING
// ============================================

// GET /worker/status - Worker processing statistics
app.get('/worker/status', async (req, res) => {
    try {
        const stats = await pool.query('SELECT * FROM get_processing_stats()');
        
        res.json({
            status: 'healthy',
            timestamp: new Date().toISOString(),
            ...stats.rows[0]
        });
    } catch (error) {
        console.error('Worker status error:', error);
        res.status(500).json({ 
            status: 'error',
            error: error.message 
        });
    }
});

// GET /cache/stats - Cache performance statistics
app.get('/cache/stats', async (req, res) => {
    try {
        const stats = await pool.query(`
            SELECT 
                COUNT(*) as total_cached_paths,
                COUNT(DISTINCT device_id) as unique_devices,
                SUM(point_count) as total_points_cached,
                AVG(point_count) as avg_points_per_path,
                AVG(osrm_confidence) as avg_confidence,
                MIN(created_at) as oldest_cache,
                MAX(created_at) as newest_cache,
                MAX(last_accessed) as most_recent_access,
                SUM(access_count) as total_accesses
            FROM cached_polylines
        `);

        const recentProcessing = await pool.query(`
            SELECT 
                status,
                COUNT(*) as count
            FROM processing_log
            WHERE created_at > NOW() - INTERVAL '24 hours'
            GROUP BY status
        `);

        res.json({
            cache: stats.rows[0],
            recent_processing: recentProcessing.rows
        });
    } catch (error) {
        console.error('Cache stats error:', error);
        res.status(500).json({ error: error.message });
    }
});

// GET /processing/recent - Recent processing activity
app.get('/processing/recent', async (req, res) => {
    try {
        const { limit = 20 } = req.query;
        
        const { rows } = await pool.query(`
            SELECT 
                batch_id,
                device_id,
                start_time,
                end_time,
                coordinate_count,
                status,
                duration_ms,
                error_message,
                created_at
            FROM processing_log
            ORDER BY created_at DESC
            LIMIT $1
        `, [parseInt(limit)]);

        res.json(rows);
    } catch (error) {
        console.error('Recent processing error:', error);
        res.status(500).json({ error: error.message });
    }
});

// DELETE /cache/cleanup - Clean up old cache (if needed)
app.delete('/cache/cleanup', async (req, res) => {
    try {
        const { days = 30 } = req.query;

        const result = await pool.query(`
            DELETE FROM cached_polylines
            WHERE created_at < NOW() - INTERVAL '${parseInt(days)} days'
              AND (last_accessed IS NULL OR last_accessed < NOW() - INTERVAL '7 days')
        `);

        res.json({
            deleted: result.rowCount,
            message: `Cleared cache entries older than ${days} days (excluding recently accessed)`
        });
    } catch (error) {
        console.error('Cache cleanup error:', error);
        res.status(500).json({ error: error.message });
    }
});

// ============================================
// HEALTH CHECK
// ============================================

app.get('/health', async (req, res) => {
    try {
        // Check database
        await pool.query('SELECT 1');
        
        // Check new tables exist
        const tablesCheck = await pool.query(`
            SELECT 
                (SELECT COUNT(*) FROM information_schema.tables WHERE table_name = 'gps_raw_data') as gps_table,
                (SELECT COUNT(*) FROM information_schema.tables WHERE table_name = 'cached_polylines') as cache_table,
                (SELECT COUNT(*) FROM information_schema.tables WHERE table_name = 'processing_log') as log_table
        `);
        
        const tables = tablesCheck.rows[0];
        const allTablesExist = tables.gps_table > 0 && tables.cache_table > 0 && tables.log_table > 0;

        res.json({
            status: allTablesExist ? 'healthy' : 'degraded',
            timestamp: new Date().toISOString(),
            database: 'connected',
            schema_migrated: allTablesExist,
            tables: {
                gps_raw_data: tables.gps_table > 0,
                cached_polylines: tables.cache_table > 0,
                processing_log: tables.log_table > 0
            }
        });
    } catch (error) {
        res.status(500).json({ 
            status: 'unhealthy', 
            error: error.message 
        });
    }
});

// ============================================
// START SERVER
// ============================================

app.listen(PORT, () => {
    console.log('============================================');
    console.log('✅ MudMaps Backend (NEW SCHEMA)');
    console.log('============================================');
    console.log(`📡 Server running on port ${PORT}`);
    console.log(`📊 Reading from: gps_raw_data`);
    console.log(`⚡ Serving from: cached_polylines`);
    console.log(`📝 Logging to: processing_log`);
    console.log('');
    console.log('Available endpoints:');
    console.log('  GET  /markers');
    console.log('  GET  /markers/enhanced');
    console.log('  GET  /paths/cached ⚡ (FAST)');
    console.log('  GET  /paths/encoded (legacy)');
    console.log('  GET  /worker/status');
    console.log('  GET  /cache/stats');
    console.log('  GET  /processing/recent');
    console.log('  GET  /health');
    console.log('============================================');
});
