/**
 * Polylines Service
 * Business logic for polyline operations
 */

class PolylinesService {
    constructor(database) {
        this.db = database;
    }

    /**
     * Get cached polylines for devices
     * @param {string} deviceId - Optional device ID filter
     * @param {number} hours - Hours to look back
     * @returns {Promise<Object>} Formatted polyline data
     */
    async getCachedPolylines(deviceId, hours) {
        console.log(`\n🗺️ Fetching cached polylines for: ${deviceId || 'all devices'}, timeframe: ${hours}h`);
        
        const startTime = performance.now();
        
        // Build query
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

        if (deviceId) {
            query += ' AND device_id = $2';
            params.push(deviceId);
        }

        query += ' ORDER BY start_time DESC';

        const { rows } = await this.db.query(query, params);
        
        const queryTime = performance.now() - startTime;
        console.log(`✅ Query completed in ${queryTime.toFixed(0)}ms, found ${rows.length} cached polylines`);

        if (rows.length === 0) {
            return { devices: [] };
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
        
        return { devices };
    }

    /**
     * Get cache statistics
     * @returns {Promise<Object>} Cache statistics
     */
    async getCacheStats() {
        const result = await this.db.query(`
            SELECT 
                COUNT(*) as total_cached_paths,
                COUNT(DISTINCT device_id) as unique_devices,
                MIN(start_time) as oldest_path,
                MAX(end_time) as newest_path,
                SUM(point_count) as total_points
            FROM cached_polylines
        `);

        return result.rows[0];
    }

    /**
     * Get legacy markers
     * @returns {Promise<Array>} Markers array
     */
    async getMarkers() {
        const { rows } = await this.db.query('SELECT username, coords FROM markers');
        return rows;
    }

    /**
     * Get legacy polylines
     * @returns {Promise<Array>} Polylines array
     */
    async getLegacyPolylines() {
        const { rows } = await this.db.query('SELECT username, coords FROM polylines');
        return rows;
    }
}

module.exports = PolylinesService;
