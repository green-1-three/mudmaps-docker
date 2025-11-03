/**
 * Road Segment Activation Service
 * Handles the activation of road segments when vehicles pass over them
 */

class SegmentActivationService {
    constructor(logger = null) {
        this.logger = logger;
    }

    setLogger(logger) {
        this.logger = logger;
    }
    /**
     * Activate road segments based on polyline intersection
     * @param {Object} client - PostgreSQL client
     * @param {number} polylineId - ID of the polyline
     * @param {string} deviceId - Device ID that created the polyline
     * @param {string} polylineWKT - WKT representation of the polyline
     * @param {number} polylineBearing - Bearing of the polyline in degrees
     * @param {Date} timestamp - Timestamp of the polyline
     * @returns {Promise<number>} Number of segments activated
     */
    async activateSegments(client, polylineId, deviceId, polylineWKT, polylineBearing, timestamp) {
        try {
            // Find all road segments that intersect with this polyline
            const segmentsResult = await client.query(`
                SELECT 
                    rs.id,
                    rs.bearing as segment_bearing,
                    rs.municipality_id,
                    rs.street_name,
                    ST_Length(ST_Intersection(rs.geometry, ST_GeomFromText($1, 4326))::geography) / 
                    ST_Length(rs.geometry::geography) * 100 as overlap_percentage
                FROM road_segments rs
                WHERE ST_Intersects(rs.geometry, ST_GeomFromText($1, 4326))
            `, [polylineWKT]);
            
            if (segmentsResult.rows.length === 0) {
                if (this.logger) {
                    this.logger.info(`   📍 No road segments found for polyline ${polylineId}`);
                }
                return 0;
            }

            if (this.logger) {
                this.logger.info(`   🛣️  Activating ${segmentsResult.rows.length} road segments`);
            }
            
            // Process each intersecting segment
            for (const segment of segmentsResult.rows) {
                // Determine direction (forward or reverse)
                const direction = await this.determineDirection(client, polylineBearing, segment.segment_bearing);
                const timestampColumn = direction === 'forward' ? 'last_plowed_forward' : 'last_plowed_reverse';
                
                // Update the segment timestamp and counters
                await client.query(`
                    UPDATE road_segments
                    SET 
                        ${timestampColumn} = $1,
                        last_plowed_device_id = $2,
                        plow_count_today = plow_count_today + 1,
                        plow_count_total = plow_count_total + 1,
                        updated_at = NOW()
                    WHERE id = $3
                `, [timestamp, deviceId, segment.id]);
                
                // Log the activation in segment_updates
                await client.query(`
                    INSERT INTO segment_updates (
                        segment_id,
                        polyline_id,
                        device_id,
                        direction,
                        overlap_percentage,
                        timestamp
                    ) VALUES ($1, $2, $3, $4, $5, $6)
                `, [
                    segment.id,
                    polylineId,
                    deviceId,
                    direction,
                    segment.overlap_percentage,
                    timestamp
                ]);
            }
            
            if (this.logger) {
                this.logger.info(`   ✅ Activated ${segmentsResult.rows.length} segments (polyline ${polylineId})`);
            }
            return segmentsResult.rows.length;

        } catch (error) {
            if (this.logger) {
                this.logger.error(`   ❌ Error activating road segments: ${error.message}`);
            }
            // Don't throw - we want the polyline to still be saved even if segment activation fails
            return 0;
        }
    }

    /**
     * Determine the direction of travel relative to segment bearing
     * @param {Object} client - PostgreSQL client
     * @param {number} polylineBearing - Bearing of the polyline
     * @param {number} segmentBearing - Bearing of the segment
     * @returns {Promise<string>} 'forward' or 'reverse'
     */
    async determineDirection(client, polylineBearing, segmentBearing) {
        try {
            const direction = await client.query(`
                SELECT determine_direction($1, $2) as direction
            `, [polylineBearing, segmentBearing]);
            
            return direction.rows[0].direction;
        } catch (error) {
            // If the database function doesn't exist or fails, use simple logic
            const diff = Math.abs(polylineBearing - segmentBearing);
            const normalizedDiff = diff > 180 ? 360 - diff : diff;
            return normalizedDiff <= 90 ? 'forward' : 'reverse';
        }
    }

    /**
     * Get statistics for segment activation
     * @param {Object} client - PostgreSQL client
     * @param {string} municipalityId - Municipality ID
     * @returns {Promise<Object>} Statistics object
     */
    async getActivationStats(client, municipalityId) {
        const result = await client.query(`
            SELECT 
                COUNT(*) as total_segments,
                COUNT(CASE WHEN last_plowed_forward IS NOT NULL OR last_plowed_reverse IS NOT NULL THEN 1 END) as activated_segments,
                COUNT(CASE WHEN last_plowed_forward > NOW() - INTERVAL '24 hours' OR last_plowed_reverse > NOW() - INTERVAL '24 hours' THEN 1 END) as recently_activated
            FROM road_segments
            WHERE municipality_id = $1
        `, [municipalityId]);
        
        return result.rows[0];
    }
}

module.exports = SegmentActivationService;
