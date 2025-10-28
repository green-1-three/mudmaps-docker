const { Pool } = require('pg');
const fetch = require('node-fetch');
const polyline = require('@mapbox/polyline');
require('dotenv').config();

// Configuration
const WORKER_INTERVAL = parseInt(process.env.WORKER_INTERVAL) || 60000; // 60 seconds default
const OSRM_BASE = process.env.OSRM_BASE || 'http://osrm:5000';
const BATCH_SIZE = 50; // Process up to 50 coordinates per batch
const TIME_WINDOW_MINUTES = 60; // Group coordinates within 60-minute windows

// PostgreSQL connection
const pool = new Pool({
    user: process.env.PGUSER,
    host: process.env.PGHOST,
    database: process.env.PGDATABASE,
    password: process.env.PGPASSWORD,
    port: parseInt(process.env.PGPORT) || 5432,
});

console.log('🚀 Background Worker Starting...');
console.log(`📊 Config: Interval=${WORKER_INTERVAL}ms, OSRM=${OSRM_BASE}, BatchSize=${BATCH_SIZE}`);

// Main processing function
async function processUnprocessedGPS() {
    const client = await pool.connect();
    
    try {
        console.log('🔍 Checking for unprocessed GPS data...');
        
        // Get unprocessed GPS points grouped by device
        const devicesResult = await client.query(`
            SELECT DISTINCT device_id 
            FROM gps_raw_data 
            WHERE processed = FALSE
            ORDER BY device_id
        `);
        
        if (devicesResult.rows.length === 0) {
            console.log('✅ No unprocessed data found');
            return;
        }
        
        console.log(`📱 Found ${devicesResult.rows.length} devices with unprocessed data`);
        
        for (const { device_id } of devicesResult.rows) {
            await processDeviceData(client, device_id);
        }
        
    } catch (error) {
        console.error('❌ Error in processUnprocessedGPS:', error);
    } finally {
        client.release();
    }
}

// Process data for a single device
async function processDeviceData(client, device_id) {
    try {
        console.log(`\n📍 Processing device: ${device_id}`);
        
        // Get unprocessed GPS points for this device, ordered by time
        const gpsResult = await client.query(`
            SELECT id, longitude, latitude, recorded_at
            FROM gps_raw_data
            WHERE device_id = $1 AND processed = FALSE
            ORDER BY recorded_at ASC
            LIMIT $2
        `, [device_id, BATCH_SIZE]);
        
        if (gpsResult.rows.length < 2) {
            console.log(`   ⚠️  Not enough points (need at least 2, have ${gpsResult.rows.length})`);
            return;
        }
        
        console.log(`   📊 Found ${gpsResult.rows.length} unprocessed GPS points`);
        
        // Group points into time windows
        const batches = groupIntoTimeWindows(gpsResult.rows);
        console.log(`   📦 Grouped into ${batches.length} time window(s)`);
        
        for (const batch of batches) {
            await processBatch(client, device_id, batch);
        }
        
    } catch (error) {
        console.error(`❌ Error processing device ${device_id}:`, error);
    }
}

// Group GPS points into time windows
function groupIntoTimeWindows(points) {
    if (points.length === 0) return [];
    
    const batches = [];
    let currentBatch = [points[0]];
    
    for (let i = 1; i < points.length; i++) {
        const prevTime = new Date(currentBatch[currentBatch.length - 1].recorded_at);
        const currTime = new Date(points[i].recorded_at);
        const diffMinutes = (currTime - prevTime) / 1000 / 60;
        
        if (diffMinutes <= TIME_WINDOW_MINUTES && currentBatch.length < BATCH_SIZE) {
            currentBatch.push(points[i]);
        } else {
            if (currentBatch.length >= 2) {
                batches.push(currentBatch);
            }
            currentBatch = [points[i]];
        }
    }
    
    // Add final batch if it has enough points
    if (currentBatch.length >= 2) {
        batches.push(currentBatch);
    }
    
    return batches;
}

// Process a single batch of GPS points
async function processBatch(client, device_id, batch) {
    const batchId = generateUUID();
    const startTime = batch[0].recorded_at;
    const endTime = batch[batch.length - 1].recorded_at;
    const pointIds = batch.map(p => p.id);
    
    console.log(`   🔄 Processing batch: ${batch.length} points from ${startTime} to ${endTime}`);
    
    // Log processing start
    await client.query(`
        INSERT INTO processing_log (
            batch_id, device_id, start_time, end_time, 
            coordinate_count, status, processing_started_at
        ) VALUES ($1, $2, $3, $4, $5, 'processing', NOW())
    `, [batchId, device_id, startTime, endTime, batch.length]);
    
    try {
        // Call OSRM to match route
        const osrmStart = Date.now();
        const coordinates = batch.map(p => [p.longitude, p.latitude]);
        const matchedRoute = await callOSRMMatch(coordinates);
        const osrmDuration = Date.now() - osrmStart;
        
        if (!matchedRoute) {
            throw new Error('OSRM returned no matched route');
        }
        
        // Encode the polyline
        const encodedPolyline = polyline.encode(matchedRoute.coordinates);
        
        // Insert into cached_polylines
        await client.query(`
            INSERT INTO cached_polylines (
                device_id, start_time, end_time, encoded_polyline,
                osrm_confidence, point_count, batch_id, osrm_duration_ms
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            ON CONFLICT (device_id, start_time, end_time) 
            DO UPDATE SET 
                encoded_polyline = EXCLUDED.encoded_polyline,
                osrm_confidence = EXCLUDED.osrm_confidence,
                batch_id = EXCLUDED.batch_id,
                osrm_duration_ms = EXCLUDED.osrm_duration_ms
        `, [
            device_id, 
            startTime, 
            endTime, 
            encodedPolyline,
            matchedRoute.confidence,
            batch.length,
            batchId,
            osrmDuration
        ]);
        
        // Mark GPS points as processed
        await client.query(`
            UPDATE gps_raw_data 
            SET processed = TRUE, batch_id = $1
            WHERE id = ANY($2)
        `, [batchId, pointIds]);
        
        // Update processing log - success
        await client.query(`
            UPDATE processing_log 
            SET status = 'completed', 
                osrm_calls = 1,
                osrm_success_rate = 1.0
            WHERE batch_id = $1
        `, [batchId]);
        
        console.log(`   ✅ Batch processed successfully (${osrmDuration}ms)`);
        
    } catch (error) {
        console.error(`   ❌ Error processing batch:`, error.message);
        
        // Update processing log - failure
        await client.query(`
            UPDATE processing_log 
            SET status = 'failed',
                error_message = $1,
                error_code = $2
            WHERE batch_id = $3
        `, [error.message, error.code || 'UNKNOWN', batchId]);
    }
}

// Call OSRM match service
async function callOSRMMatch(coordinates) {
    try {
        // Format: longitude,latitude;longitude,latitude;...
        const coordString = coordinates.map(c => `${c[0]},${c[1]}`).join(';');
        const url = `${OSRM_BASE}/match/v1/driving/${coordString}?overview=full&geometries=geojson`;
        
        const response = await fetch(url, { timeout: 10000 });
        
        if (!response.ok) {
            throw new Error(`OSRM responded with status ${response.status}`);
        }
        
        const data = await response.json();
        
        if (data.code !== 'Ok' || !data.matchings || data.matchings.length === 0) {
            return null;
        }
        
        const matching = data.matchings[0];
        
        return {
            coordinates: matching.geometry.coordinates.map(c => [c[1], c[0]]), // Convert to [lat, lon]
            confidence: matching.confidence || 0.5
        };
        
    } catch (error) {
        console.error('❌ OSRM API Error:', error.message);
        return null;
    }
}

// Simple UUID generator
function generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

// Health check - log statistics
async function logStatistics() {
    try {
        const result = await pool.query('SELECT * FROM get_processing_stats()');
        const stats = result.rows[0];
        
        console.log('\n📊 === STATISTICS ===');
        console.log(`   Total GPS Points: ${stats.total_gps_points}`);
        console.log(`   Unprocessed: ${stats.unprocessed_points}`);
        console.log(`   Processed: ${stats.processed_points}`);
        console.log(`   Cached Paths: ${stats.total_cached_paths}`);
        console.log(`   Active Devices: ${stats.active_devices}`);
        if (stats.processing_backlog_minutes) {
            console.log(`   Backlog: ${Math.round(stats.processing_backlog_minutes)} minutes`);
        }
        console.log('=====================\n');
    } catch (error) {
        console.error('❌ Error logging statistics:', error);
    }
}

// Main loop
async function main() {
    console.log('✅ Worker ready. Starting processing loop...\n');
    
    // Log initial statistics
    await logStatistics();
    
    // Main processing loop
    setInterval(async () => {
        try {
            await processUnprocessedGPS();
        } catch (error) {
            console.error('❌ Error in main loop:', error);
        }
    }, WORKER_INTERVAL);
    
    // Statistics logging (every 5 minutes)
    setInterval(async () => {
        await logStatistics();
    }, 5 * 60 * 1000);
    
    // Run initial processing immediately
    await processUnprocessedGPS();
}

// Start the worker
main().catch(error => {
    console.error('❌ Fatal error:', error);
    process.exit(1);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
    console.log('📴 Received SIGTERM, shutting down gracefully...');
    await pool.end();
    process.exit(0);
});

process.on('SIGINT', async () => {
    console.log('📴 Received SIGINT, shutting down gracefully...');
    await pool.end();
    process.exit(0);
});
