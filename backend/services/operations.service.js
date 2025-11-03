/**
 * Operations Service
 * Handles database operations and maintenance tasks
 */

class OperationsService {
    constructor(databaseService, logger) {
        this.db = databaseService;
        this.logger = logger;
    }

    /**
     * Reprocess cached polylines to activate road segments
     * @param {number} limit - Maximum number of polylines to process (optional)
     * @param {number} offset - Offset for pagination (default: 0)
     * @returns {Promise<Object>} Result with stats
     */
    async reprocessPolylines(limit = null, offset = 0) {
        const client = await this.db.pool.connect();

        if (this.logger) {
            this.logger.info(`Starting polyline reprocessing - Limit: ${limit || 'ALL'}, Offset: ${offset}`);
        }

        try {
            await client.query('BEGIN');

            // Get polylines to reprocess
            let query = `
                SELECT
                    id,
                    device_id,
                    geometry,
                    bearing,
                    end_time
                FROM cached_polylines
                WHERE geometry IS NOT NULL
                ORDER BY id ASC
                OFFSET $1
            `;
            const params = [offset];

            if (limit) {
                query += ` LIMIT $2`;
                params.push(limit);
            }

            const polylinesResult = await client.query(query, params);
            const polylines = polylinesResult.rows;

            if (this.logger) {
                this.logger.info(`Found ${polylines.length} polylines to reprocess`);
            }

            if (polylines.length === 0) {
                await client.query('COMMIT');
                if (this.logger) {
                    this.logger.info('No polylines to process');
                }
                return {
                    success: true,
                    processed: 0,
                    segmentsActivated: 0,
                    message: 'No polylines to process'
                };
            }

            let totalSegmentsActivated = 0;
            let processedCount = 0;
            const errors = [];

            // Process each polyline
            for (const polyline of polylines) {
                try {
                    // Convert geometry to WKT
                    const wktResult = await client.query(
                        `SELECT ST_AsText(ST_GeomFromText($1, 4326)) as wkt`,
                        [polyline.geometry]
                    );
                    const polylineWKT = wktResult.rows[0].wkt;

                    // Find intersecting segments (same logic as worker)
                    const segmentsResult = await client.query(`
                        SELECT
                            rs.id,
                            rs.bearing as segment_bearing,
                            rs.municipality_id,
                            rs.street_name,
                            CASE
                                WHEN ST_Intersects(rs.geometry, ST_GeomFromText($1, 4326)) THEN
                                    -- Exact intersection - calculate actual overlap
                                    ST_Length(ST_Intersection(rs.geometry, ST_GeomFromText($1, 4326))::geography) /
                                    ST_Length(rs.geometry::geography) * 100
                                ELSE
                                    -- Within 2m buffer but not intersecting - estimate overlap based on distance
                                    (1.0 - ST_Distance(rs.geometry::geography, ST_GeomFromText($1, 4326)::geography) / 2.0) *
                                    ST_Length(rs.geometry::geography) / ST_Length(rs.geometry::geography) * 100
                            END as overlap_percentage
                        FROM road_segments rs
                        WHERE ST_DWithin(rs.geometry::geography, ST_GeomFromText($1, 4326)::geography, 2)
                    `, [polylineWKT]);

                    const segments = segmentsResult.rows;
                    totalSegmentsActivated += segments.length;

                    // Process each intersecting segment
                    for (const segment of segments) {
                        // Determine direction
                        const directionResult = await client.query(
                            `SELECT determine_direction($1, $2) as direction`,
                            [polyline.bearing, segment.segment_bearing]
                        );
                        const direction = directionResult.rows[0].direction;
                        const timestampColumn = direction === 'forward' ? 'last_plowed_forward' : 'last_plowed_reverse';

                        // Update segment only if this polyline's timestamp is newer
                        await client.query(`
                            UPDATE road_segments
                            SET
                                ${timestampColumn} = GREATEST(${timestampColumn}, $1),
                                last_plowed_device_id = CASE
                                    WHEN ${timestampColumn} IS NULL OR ${timestampColumn} < $1
                                    THEN $2
                                    ELSE last_plowed_device_id
                                END,
                                plow_count_total = plow_count_total + CASE
                                    WHEN ${timestampColumn} IS NULL OR ${timestampColumn} < $1
                                    THEN 1
                                    ELSE 0
                                END,
                                updated_at = NOW()
                            WHERE id = $3
                        `, [polyline.end_time, polyline.device_id, segment.id]);

                        // Log the activation (avoid duplicates)
                        await client.query(`
                            INSERT INTO segment_updates (
                                segment_id,
                                polyline_id,
                                device_id,
                                direction,
                                overlap_percentage,
                                timestamp
                            )
                            SELECT $1, $2, $3, $4, $5, $6
                            WHERE NOT EXISTS (
                                SELECT 1 FROM segment_updates
                                WHERE segment_id = $1 AND polyline_id = $2
                            )
                        `, [
                            segment.id,
                            polyline.id,
                            polyline.device_id,
                            direction,
                            segment.overlap_percentage,
                            polyline.end_time
                        ]);
                    }

                    processedCount++;
                } catch (error) {
                    if (this.logger) {
                        this.logger.error(`Error processing polyline ${polyline.id}: ${error.message}`);
                    }
                    errors.push({
                        polylineId: polyline.id,
                        error: error.message
                    });
                }
            }

            await client.query('COMMIT');

            if (this.logger) {
                this.logger.info(`Reprocessing complete - Processed: ${processedCount}, Segments activated: ${totalSegmentsActivated}, Errors: ${errors.length}`);
            }

            return {
                success: true,
                processed: processedCount,
                segmentsActivated: totalSegmentsActivated,
                errors: errors.length > 0 ? errors : undefined,
                message: `Processed ${processedCount} polylines, activated ${totalSegmentsActivated} segment updates`
            };

        } catch (error) {
            await client.query('ROLLBACK');
            if (this.logger) {
                this.logger.error(`Reprocessing failed: ${error.message}`);
            }
            throw error;
        } finally {
            client.release();
        }
    }

    /**
     * Get statistics about reprocessing potential
     * @returns {Promise<Object>} Statistics
     */
    async getReprocessStats() {
        const result = await this.db.pool.query(`
            SELECT
                COUNT(*) as total_polylines,
                COUNT(CASE WHEN geometry IS NOT NULL THEN 1 END) as polylines_with_geometry,
                MIN(created_at) as oldest_polyline,
                MAX(created_at) as newest_polyline,
                COUNT(DISTINCT device_id) as unique_devices
            FROM cached_polylines
        `);

        const segmentStats = await this.db.pool.query(`
            SELECT
                COUNT(*) as total_segments,
                COUNT(CASE WHEN last_plowed_forward IS NOT NULL OR last_plowed_reverse IS NOT NULL THEN 1 END) as activated_segments
            FROM road_segments
        `);

        return {
            polylines: result.rows[0],
            segments: segmentStats.rows[0]
        };
    }
}

module.exports = OperationsService;
