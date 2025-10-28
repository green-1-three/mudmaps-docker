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

// IMPROVED: Utility function to call OSRM with better parameters
async function callOSRM(coordinates, options = {}) {
    try {
        const coordString = coordinates.map(([lon, lat]) => `${lon},${lat}`).join(';');

        // Add radiuses parameter - allows OSRM to search further from each point
        const radiuses = coordinates.map(() => '50').join(';');

        // Build URL with improved parameters
        const params = new URLSearchParams({
            geometries: 'polyline',
            overview: 'full',
            radiuses: radiuses,
            gaps: 'ignore',  // Continue matching even if some points can't be matched
            tidy: 'true'     // Clean up the geometry
        });

        const url = `${OSRM_BASE}/match/v1/driving/${coordString}?${params}`;

        console.log(`Calling OSRM with ${coordinates.length} points...`);

        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`OSRM returned ${response.status}`);
        }

        const data = await response.json();

        if (data.matchings && data.matchings.length > 0) {
            return {
                success: true,
                encoded_polyline: data.matchings[0].geometry,
                confidence: data.matchings[0].confidence || 1.0,
                matched_points: coordinates.length
            };
        } else {
            return { success: false, error: 'No matching found', code: data.code };
        }
    } catch (error) {
        console.error('OSRM error:', error.message);
        return { success: false, error: error.message };
    }
}

// NEW: Batch OSRM calls with caching
async function callOSRMBatchedWithCache(deviceId, startTime, endTime, coordinates, batchSize = 50) {
    console.log(`Processing ${coordinates.length} coordinates for device ${deviceId}`);

    // For small coordinate sets, skip batching
    if (coordinates.length <= batchSize) {
        // Check cache first
        const cached = await getCachedPath(deviceId, startTime, endTime, 0);
        if (cached) {
            console.log(`✅ Cache hit for ${deviceId}`);
            return {
                success: cached.encoded_polyline !== null,
                encoded_polyline: cached.encoded_polyline,
                confidence: cached.osrm_confidence,
                raw_coordinates: cached.encoded_polyline ? null : cached.raw_coordinates
            };
        }

        // Not cached, call OSRM
        const result = await callOSRM(coordinates);

        // Cache the result
        await cachePath(deviceId, startTime, endTime, coordinates, result, 0, 1);

        return result;
    }

    // Split into batches
    const batches = [];
    for (let i = 0; i < coordinates.length; i += batchSize) {
        batches.push(coordinates.slice(i, i + batchSize));
    }

    console.log(`Split into ${batches.length} batches`);

    const results = [];
    let totalMatched = 0;
    let cacheHits = 0;

    for (let i = 0; i < batches.length; i++) {
        const batch = batches[i];
        const batchStartTime = new Date(startTime.getTime() + (i * 60000)); // Approximate
        const batchEndTime = new Date(batchStartTime.getTime() + 60000);

        // Check cache for this batch
        const cached = await getCachedPath(deviceId, batchStartTime, batchEndTime, i);

        if (cached) {
            console.log(`✅ Cache hit for batch ${i + 1}/${batches.length}`);
            cacheHits++;

            results.push({
                success: cached.encoded_polyline !== null,
                encoded_polyline: cached.encoded_polyline,
                confidence: cached.osrm_confidence,
                raw_coordinates: cached.encoded_polyline ? null : JSON.parse(cached.raw_coordinates)
            });

            if (cached.encoded_polyline) {
                totalMatched += batch.length;
            }
        } else {
            // Not cached, call OSRM
            console.log(`🔄 Processing batch ${i + 1}/${batches.length} (${batch.length} points)`);

            const result = await callOSRM(batch);

            // Cache this batch
            await cachePath(deviceId, batchStartTime, batchEndTime, batch, result, i, batches.length);

            results.push({
                success: result.success,
                encoded_polyline: result.encoded_polyline,
                confidence: result.confidence,
                raw_coordinates: result.success ? null : batch
            });

            if (result.success) {
                totalMatched += batch.length;
                console.log(`✅ Batch ${i + 1} successful`);
            } else {
                console.log(`❌ Batch ${i + 1} failed: ${result.error}`);
            }

            // Reduced delay for local OSRM (10ms), keep 100ms for public
            const delay = OSRM_BASE.includes('localhost') || OSRM_BASE.includes('osrm:') ? 10 : 100;
            if (i < batches.length - 1) {
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
    }

    console.log(`Cache performance: ${cacheHits}/${batches.length} hits (${(cacheHits/batches.length*100).toFixed(1)}%)`);

    const successfulBatches = results.filter(r => r.success);

    if (successfulBatches.length === 0) {
        return {
            success: false,
            error: 'All batches failed',
            raw_coordinates: coordinates
        };
    }

    return {
        success: true,
        batches: results,
        matched_batches: successfulBatches.length,
        total_batches: batches.length,
        coverage: (totalMatched / coordinates.length * 100).toFixed(1) + '%',
        cache_hits: cacheHits
    };
}

// NEW: Get cached path from database
async function getCachedPath(deviceId, startTime, endTime, batchIndex) {
    try {
        const query = `
            SELECT encoded_polyline, osrm_confidence, raw_coordinates
            FROM matched_paths
            WHERE device_id = $1
              AND start_time = $2
              AND batch_index = $3
            LIMIT 1
        `;

        const result = await pool.query(query, [deviceId, startTime, batchIndex]);

        return result.rows.length > 0 ? result.rows[0] : null;
    } catch (error) {
        console.error('Cache lookup error:', error.message);
        return null;
    }
}

// NEW: Cache path result in database
async function cachePath(deviceId, startTime, endTime, coordinates, osrmResult, batchIndex, totalBatches) {
    try {
        const query = `
            INSERT INTO matched_paths (
                device_id, start_time, end_time, 
                encoded_polyline, osrm_confidence,
                raw_coordinates, point_count, 
                batch_index, total_batches, processed_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
            ON CONFLICT (device_id, start_time, batch_index) 
            DO UPDATE SET
                encoded_polyline = EXCLUDED.encoded_polyline,
                osrm_confidence = EXCLUDED.osrm_confidence,
                processed_at = NOW()
        `;

        await pool.query(query, [
            deviceId,
            startTime,
            endTime,
            osrmResult.success ? osrmResult.encoded_polyline : null,
            osrmResult.success ? osrmResult.confidence : null,
            JSON.stringify(coordinates),
            coordinates.length,
            batchIndex,
            totalBatches
        ]);

        console.log(`💾 Cached batch ${batchIndex} for device ${deviceId}`);
    } catch (error) {
        console.error('Cache write error:', error.message);
        // Don't throw - caching failure shouldn't break the request
    }
}

// Function to group markers by device and create minute markers
function createPathWithMinuteMarkers(markers) {
    if (markers.length < 2) return null;

    // Sort by timestamp
    const sortedMarkers = markers.sort((a, b) =>
        new Date(a.created_at || a.timestamp) - new Date(b.created_at || b.timestamp)
    );

    const coordinates = [];
    const minuteMarkers = [];
    let lastMarkerMinute = null;

    sortedMarkers.forEach((marker, index) => {
        if (!marker.coords || marker.coords.length !== 2) return;

        coordinates.push(marker.coords);

        // Create minute marker if we've crossed into a new minute
        const timestamp = new Date(marker.created_at || marker.timestamp);
        const currentMinute = Math.floor(timestamp.getTime() / 60000);

        if (currentMinute !== lastMarkerMinute) {
            minuteMarkers.push({
                coord_index: coordinates.length - 1,
                timestamp: timestamp.toISOString()
            });
            lastMarkerMinute = currentMinute;
        }
    });

    return {
        coordinates,
        minute_markers: minuteMarkers,
        start_time: sortedMarkers[0].created_at || sortedMarkers[0].timestamp,
        end_time: sortedMarkers[sortedMarkers.length - 1].created_at || sortedMarkers[sortedMarkers.length - 1].timestamp
    };
}

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

// IMPROVED: Generate encoded paths with caching
app.get('/paths/encoded', async (req, res) => {
    try {
        const { username, hours = 24 } = req.query;

        console.log(`\n🗺️  Generating encoded paths for: ${username || 'all devices'}, timeframe: ${hours}h`);

        // Get markers for the specified time period
        let query = 'SELECT username, coords, created_at FROM markers WHERE created_at > $1';
        let params = [new Date(Date.now() - hours * 60 * 60 * 1000)];

        if (username) {
            query += ' AND username = $2 ORDER BY created_at ASC';
            params.push(username);
        } else {
            query += ' ORDER BY created_at ASC';
        }

        const { rows } = await pool.query(query, params);
        console.log(`📊 Found ${rows.length} GPS markers`);

        if (rows.length === 0) {
            return res.json({ devices: [] });
        }

        // Group by device/username
        const deviceGroups = {};
        rows.forEach(row => {
            const device = row.username;
            if (!deviceGroups[device]) {
                deviceGroups[device] = [];
            }
            deviceGroups[device].push(row);
        });

        console.log(`📱 Processing ${Object.keys(deviceGroups).length} device(s)`);

        const results = [];

        for (const [device, markers] of Object.entries(deviceGroups)) {
            console.log(`\n--- Device: ${device} (${markers.length} markers) ---`);

            const pathData = createPathWithMinuteMarkers(markers);
            if (!pathData) {
                console.log(`⚠️  Skipping ${device} - insufficient data`);
                continue;
            }

            // Get OSRM results with caching
            const osrmResult = await callOSRMBatchedWithCache(
                device,
                new Date(pathData.start_time),
                new Date(pathData.end_time),
                pathData.coordinates
            );

            const deviceResult = {
                device: device,
                start_time: pathData.start_time,
                end_time: pathData.end_time,
                minute_markers: pathData.minute_markers,
                coordinate_count: pathData.coordinates.length
            };

            if (osrmResult.success && osrmResult.batches) {
                // Multiple batches
                deviceResult.batches = osrmResult.batches;
                deviceResult.matched_batches = osrmResult.matched_batches;
                deviceResult.total_batches = osrmResult.total_batches;
                deviceResult.coverage = osrmResult.coverage;
                deviceResult.cache_hits = osrmResult.cache_hits;
                console.log(`✅ Result: ${osrmResult.matched_batches}/${osrmResult.total_batches} batches (${osrmResult.coverage} coverage, ${osrmResult.cache_hits} cached)`);
            } else if (osrmResult.success) {
                // Single successful call
                deviceResult.encoded_path = osrmResult.encoded_polyline;
                deviceResult.osrm_confidence = osrmResult.confidence;
                console.log(`✅ Single path matched successfully`);
            } else {
                // Complete failure
                deviceResult.raw_coordinates = osrmResult.raw_coordinates || pathData.coordinates;
                deviceResult.osrm_error = osrmResult.error;
                console.log(`❌ OSRM failed: ${osrmResult.error}`);
            }

            results.push(deviceResult);
        }

        console.log(`\n✅ Returning ${results.length} device path(s)\n`);
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
                SUM(CASE WHEN encoded_polyline IS NOT NULL THEN 1 ELSE 0 END) as matched_paths,
                SUM(CASE WHEN encoded_polyline IS NULL THEN 1 ELSE 0 END) as unmatched_paths,
                MIN(created_at) as oldest_cache,
                MAX(created_at) as newest_cache
            FROM matched_paths
        `);

        res.json(stats.rows[0]);
    } catch (error) {
        console.error('Cache stats error:', error);
        res.status(500).json({ error: error.message });
    }
});

// NEW: Clear old cache entries
app.delete('/cache/cleanup', async (req, res) => {
    try {
        const { days = 30 } = req.query;

        const result = await pool.query(`
            DELETE FROM matched_paths
            WHERE created_at < NOW() - INTERVAL '${parseInt(days)} days'
        `);

        res.json({
            deleted: result.rowCount,
            message: `Cleared cache entries older than ${days} days`
        });
    } catch (error) {
        console.error('Cache cleanup error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Health check endpoint (with OSRM check)
app.get('/health', async (req, res) => {
    try {
        await pool.query('SELECT 1');

        // Quick OSRM health check
        let osrmHealthy = false;
        try {
            const testUrl = `${OSRM_BASE}/route/v1/driving/-122.4,37.8;-122.5,37.9`;
            const osrmRes = await fetch(testUrl);
            osrmHealthy = osrmRes.ok;
        } catch (e) {
            console.error('OSRM health check failed:', e.message);
        }

        res.json({
            status: 'healthy',
            timestamp: new Date().toISOString(),
            osrm_base: OSRM_BASE,
            osrm_healthy: osrmHealthy
        });
    } catch (error) {
        res.status(500).json({ status: 'unhealthy', error: error.message });
    }
});

app.listen(PORT, () => {
    console.log(`✅ MudMaps backend running on ${PORT} (behind proxy)`);
    console.log(`📍 OSRM endpoint: ${OSRM_BASE}`);
    console.log(`💾 Path caching: ENABLED`);
});