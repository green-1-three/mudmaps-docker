const { Pool } = require('pg');
const fetch = require('node-fetch');
const polyline = require('@mapbox/polyline');
const { createClient } = require('redis');
require('dotenv').config();

// Configuration
const REDIS_URL = process.env.REDIS_URL || 'redis://redis:6379';
const OSRM_BASE = process.env.OSRM_BASE || 'http://osrm:5000';
const BATCH_SIZE = 4; // Process 4 coordinates per batch (~2 minutes of data)
const TIME_WINDOW_MINUTES = 2; // Group coordinates within 2-minute windows
const MIN_MOVEMENT_METERS = 50; // Minimum movement to process batch

// PostgreSQL connection
const pool = new Pool({
    user: process.env.PGUSER,
    host: process.env.PGHOST,
    database: process.env.PGDATABASE,
    password: process.env.PGPASSWORD,
    port: parseInt(process.env.PGPORT) || 5432,
});

// Redis connection
const redis = createClient({ url: REDIS_URL });
redis.on('error', (err) => console.error('❌ Redis Error:', err));

console.log('🚀 Background Worker Starting...');
console.log(`📊 Config: OSRM=${OSRM_BASE}, BatchSize=${BATCH_SIZE}, TimeWindow=${TIME_WINDOW_MINUTES}min, MinMovement=${MIN_MOVEMENT_METERS}m, Redis=${REDIS_URL}`);

// Helper function to get timestamp for logs
function timestamp() {
    return new Date().toISOString();
}

// Helper function for logging with timestamp
function log(message) {
    console.log(`[${timestamp()}] ${message}`);
}

// Calculate distance between two GPS points in meters
function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371e3; // Earth's radius in meters
    const φ1 = lat1 * Math.PI / 180;
    const φ2 = lat2 * Math.PI / 180;
    const Δφ = (lat2 - lat1) * Math.PI / 180;
    const Δλ = (lon2 - lon1) * Math.PI / 180;
    
    const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
              Math.cos(φ1) * Math.cos(φ2) *
              Math.sin(Δλ/2) * Math.sin(Δλ/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    
    return R * c; // Distance in meters
}

// Check if batch has significant movement
function hasSignificantMovement(batch, minDistanceMeters = MIN_MOVEMENT_METERS) {
    if (batch.length < 2) return false;
    
    const first = batch[0];
    const last = batch[batch.length - 1];
    
    const distance = calculateDistance(
        first.latitude, first.longitude,
        last.latitude, last.longitude
    );
    
    return distance >= minDistanceMeters;
}

// Main processing function - called when device_id is pulled from queue
async function processDevice(device_id) {
    const client = await pool.connect();
    
    try {
        await processDeviceData(client, device_id);
    } catch (error) {
        console.error(`❌ Error processing device ${device_id}:`, error);
    } finally {
        client.release();
        
        // Remove device from queued set so it can be queued again if needed
        try {
            await redis.sRem('gps:devices_queued', device_id);
        } catch (redisErr) {
            console.error(`❌ Redis error removing ${device_id} from queued set:`, redisErr);
        }
    }
}

// Process data for a single device
async function processDeviceData(client, device_id) {
    try {
        log(`📍 Processing device: ${device_id}`);
        
        // Get the last processed point for this device (for seamless connection)
        const lastProcessedResult = await client.query(`
            SELECT id, longitude, latitude, recorded_at
            FROM gps_raw_data
            WHERE device_id = $1 AND processed = TRUE
            ORDER BY recorded_at DESC
            LIMIT 1
        `, [device_id]);
        
        // Get unprocessed GPS points for this device, ordered by time
        const gpsResult = await client.query(`
            SELECT id, longitude, latitude, recorded_at
            FROM gps_raw_data
            WHERE device_id = $1 AND processed = FALSE
            ORDER BY recorded_at ASC
        `, [device_id]);
        
        // Combine last processed point (if exists) with new unprocessed points
        let allPoints = [];
        if (lastProcessedResult.rows.length > 0) {
            allPoints.push(lastProcessedResult.rows[0]);
            log(`   🔗 Including last processed point for seamless connection`);
        }
        allPoints = allPoints.concat(gpsResult.rows);
        
        if (allPoints.length < 2) {
            log(`   ⚠️  Not enough points (need at least 2, have ${allPoints.length})`);
            return;
        }
        
        log(`   📊 Found ${gpsResult.rows.length} unprocessed GPS points (${allPoints.length} total with overlap)`);
        
        // Group points into time windows
        const batches = groupIntoTimeWindows(allPoints);
        log(`   📦 Grouped into ${batches.length} time window(s)`);
        
        for (const batch of batches) {
            // Only mark the NEW points as processed (not the overlapping first point)
            const newPointsInBatch = batch.filter(p => 
                !lastProcessedResult.rows.length || p.id !== lastProcessedResult.rows[0].id
            );
            await processBatch(client, device_id, batch, newPointsInBatch);
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
            // Start new batch with the last point from previous batch for continuity
            currentBatch = [currentBatch[currentBatch.length - 1], points[i]];
        }
    }
    
    // Add final batch if it has enough points
    if (currentBatch.length >= 2) {
        batches.push(currentBatch);
    }
    
    return batches;
}

// Process a single batch of GPS points
async function processBatch(client, device_id, batch, newPointsInBatch) {
    // Sort batch by recorded_at to ensure correct time order
    batch.sort((a, b) => new Date(a.recorded_at) - new Date(b.recorded_at));
    
    const batchId = generateUUID();
    const startTime = batch[0].recorded_at;
    const endTime = batch[batch.length - 1].recorded_at;
    const pointIds = newPointsInBatch.map(p => p.id); // Only IDs of NEW points
    
    log(`   🔄 Processing batch: ${batch.length} points (${newPointsInBatch.length} new) from ${startTime} to ${endTime}`);
    
    // Check if batch has significant movement
    if (!hasSignificantMovement(batch)) {
        const distance = calculateDistance(
            batch[0].latitude, batch[0].longitude,
            batch[batch.length - 1].latitude, batch[batch.length - 1].longitude
        );
        log(`   ⏭️  Skipping stationary batch (movement: ${distance.toFixed(1)}m < ${MIN_MOVEMENT_METERS}m)`);
        
        // Still mark points as processed so they don't get reprocessed
        if (pointIds.length > 0) {
            await client.query(`
                UPDATE gps_raw_data 
                SET processed = TRUE
                WHERE id = ANY($1)
            `, [pointIds]);
        }
        return;
    }
    
    // Log processing start
    await client.query(`
        INSERT INTO processing_log (
            batch_id, device_id, start_time, end_time, 
            coordinate_count, status, processing_started_at
        ) VALUES ($1, $2, $3, $4, $5, 'processing', NOW())
    `, [batchId, device_id, startTime, endTime, newPointsInBatch.length]);
    
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
            newPointsInBatch.length,
            batchId,
            osrmDuration
        ]);
        
        // Mark only NEW GPS points as processed (not the overlapping first point)
        if (pointIds.length > 0) {
            await client.query(`
                UPDATE gps_raw_data 
                SET processed = TRUE, batch_id = $1
                WHERE id = ANY($2)
            `, [batchId, pointIds]);
        }
        
        // Update processing log - success
        await client.query(`
            UPDATE processing_log 
            SET status = 'completed', 
                osrm_calls = 1,
                osrm_success_rate = 1.0
            WHERE batch_id = $1
        `, [batchId]);
        
        log(`   ✅ Batch processed successfully (${osrmDuration}ms)`);
        
    } catch (error) {
        log(`   ❌ Error processing batch: ${error.message}`);
        
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
        log(`❌ OSRM API Error: ${error.message}`);
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
    log('✅ Worker ready. Connecting to Redis and waiting for jobs...');
    
    // Connect to Redis
    await redis.connect();
    log('✅ Connected to Redis queue');
    
    // Log initial statistics
    await logStatistics();
    
    // Statistics logging (every 5 minutes)
    setInterval(async () => {
        await logStatistics();
    }, 5 * 60 * 1000);
    
    // Main queue processing loop - blocks waiting for jobs
    log('👂 Listening for jobs on gps:queue...');
    while (true) {
        try {
            // BRPOP blocks until a job is available (timeout after 5 seconds to allow graceful shutdown)
            const result = await redis.brPop('gps:queue', 5);
            
            if (result) {
                const device_id = result.element;
                log(`📦 Received job for device: ${device_id}`);
                await processDevice(device_id);
            }
        } catch (error) {
            console.error('❌ Error in main loop:', error);
            // Brief pause before retrying on error
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
    }
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
