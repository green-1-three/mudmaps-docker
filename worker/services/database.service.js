/**
 * Database Service
 * Handles all database operations for GPS processing
 */

const { Pool } = require('pg');

class DatabaseService {
    constructor(config) {
        this.pool = new Pool(config);
    }

    /**
     * Get a client from the connection pool
     * @returns {Promise<Object>} Database client
     */
    async getClient() {
        return await this.pool.connect();
    }

    /**
     * Get the last processed point for a device
     * @param {string} deviceId - Device ID
     * @returns {Promise<Object|null>} Last processed point or null
     */
    async getLastProcessedPoint(deviceId) {
        const result = await this.pool.query(`
            SELECT id, longitude, latitude, recorded_at
            FROM gps_raw_data
            WHERE device_id = $1 AND processed = TRUE
            ORDER BY recorded_at DESC
            LIMIT 1
        `, [deviceId]);
        
        return result.rows[0] || null;
    }

    /**
     * Get unprocessed GPS points for a device
     * @param {string} deviceId - Device ID
     * @returns {Promise<Array>} Array of unprocessed points
     */
    async getUnprocessedPoints(deviceId) {
        const result = await this.pool.query(`
            SELECT id, longitude, latitude, recorded_at
            FROM gps_raw_data
            WHERE device_id = $1 AND processed = FALSE
            ORDER BY recorded_at ASC
        `, [deviceId]);
        
        return result.rows;
    }

    /**
     * Mark GPS points as processed
     * @param {Array<number>} pointIds - Array of point IDs
     * @param {string} batchId - Batch ID
     * @returns {Promise<void>}
     */
    async markPointsAsProcessed(pointIds, batchId) {
        if (pointIds.length === 0) return;
        
        await this.pool.query(`
            UPDATE gps_raw_data 
            SET processed = TRUE, batch_id = $1
            WHERE id = ANY($2)
        `, [batchId, pointIds]);
    }

    /**
     * Save a polyline to the cache
     * @param {Object} polylineData - Polyline data
     * @returns {Promise<number>} Polyline ID
     */
    async savePolyline(polylineData) {
        const result = await this.pool.query(`
            INSERT INTO cached_polylines (
                device_id, start_time, end_time, encoded_polyline,
                geometry, bearing,
                osrm_confidence, point_count, batch_id, osrm_duration_ms
            ) VALUES ($1, $2, $3, $4, ST_GeomFromText($5, 4326), $6, $7, $8, $9, $10)
            ON CONFLICT (device_id, start_time, end_time) 
            DO UPDATE SET 
                encoded_polyline = EXCLUDED.encoded_polyline,
                geometry = EXCLUDED.geometry,
                bearing = EXCLUDED.bearing,
                osrm_confidence = EXCLUDED.osrm_confidence,
                batch_id = EXCLUDED.batch_id,
                osrm_duration_ms = EXCLUDED.osrm_duration_ms
            RETURNING id
        `, [
            polylineData.deviceId,
            polylineData.startTime,
            polylineData.endTime,
            polylineData.encodedPolyline,
            polylineData.wkt,
            polylineData.bearing,
            polylineData.confidence,
            polylineData.pointCount,
            polylineData.batchId,
            polylineData.osrmDuration
        ]);
        
        return result.rows[0].id;
    }

    /**
     * Log processing status
     * @param {Object} logData - Processing log data
     * @returns {Promise<void>}
     */
    async logProcessing(logData) {
        await this.pool.query(`
            INSERT INTO processing_log (
                batch_id, device_id, start_time, end_time, 
                coordinate_count, status, processing_started_at,
                osrm_calls, osrm_success_rate, error_message, error_code
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
            ON CONFLICT (batch_id) DO UPDATE SET
                status = EXCLUDED.status,
                osrm_calls = EXCLUDED.osrm_calls,
                osrm_success_rate = EXCLUDED.osrm_success_rate,
                error_message = EXCLUDED.error_message,
                error_code = EXCLUDED.error_code
        `, [
            logData.batchId,
            logData.deviceId,
            logData.startTime,
            logData.endTime,
            logData.coordinateCount,
            logData.status || 'processing',
            logData.processingStartedAt || new Date(),
            logData.osrmCalls,
            logData.osrmSuccessRate,
            logData.errorMessage,
            logData.errorCode
        ]);
    }

    /**
     * Get processing failure count for a batch
     * @param {string} deviceId - Device ID
     * @param {Date} startTime - Start time
     * @param {Date} endTime - End time
     * @returns {Promise<number>} Failure count
     */
    async getFailureCount(deviceId, startTime, endTime) {
        const result = await this.pool.query(`
            SELECT COUNT(DISTINCT pl.batch_id) as failure_count
            FROM processing_log pl
            WHERE pl.status = 'failed'
            AND pl.device_id = $1
            AND pl.start_time >= $2
            AND pl.end_time <= $3
        `, [deviceId, startTime, endTime]);
        
        return parseInt(result.rows[0].failure_count) || 0;
    }

    /**
     * Get processing statistics
     * @returns {Promise<Object>} Statistics object
     */
    async getStatistics() {
        const result = await this.pool.query('SELECT * FROM get_processing_stats()');
        return result.rows[0];
    }

    /**
     * Close the database pool
     * @returns {Promise<void>}
     */
    async close() {
        await this.pool.end();
    }
}

module.exports = DatabaseService;
