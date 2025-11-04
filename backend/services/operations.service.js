/**
 * Operations Service
 * Handles database operations and maintenance tasks
 */

const jobTracker = require('./job-tracker.service');
const OffsetGeneratorService = require('./offset-generator.service');

class OperationsService {
    constructor(databaseService, logger) {
        this.db = databaseService;
        this.logger = logger;
        this.offsetGenerator = new OffsetGeneratorService(databaseService, logger);
    }

    /**
     * Determine direction based on bearing comparison
     * @param {number} polylineBearing - Bearing of the polyline
     * @param {number} segmentBearing - Bearing of the segment
     * @returns {string} 'forward' or 'reverse'
     */
    determineDirection(polylineBearing, segmentBearing) {
        // Handle null bearings
        if (polylineBearing == null || segmentBearing == null) {
            return 'forward'; // Default to forward if unknown
        }

        // Calculate angular difference
        const diff = Math.abs(polylineBearing - segmentBearing);
        const normalizedDiff = diff > 180 ? 360 - diff : diff;

        // Within 45 degrees = same direction (forward)
        // More than 45 degrees = opposite direction (reverse)
        return normalizedDiff <= 45 ? 'forward' : 'reverse';
    }

    /**
     * Start reprocessing job asynchronously
     * @param {number} limit - Maximum number of polylines to process (optional)
     * @param {number} offset - Offset for pagination (default: 0)
     * @returns {string} Job ID
     */
    startReprocessJob(limit = null, offset = 0) {
        const jobId = jobTracker.createJob('reprocess-polylines', { limit, offset });

        // Run in background
        this.reprocessPolylines(jobId, limit, offset).catch(error => {
            if (this.logger) {
                this.logger.error(`Background reprocess job ${jobId} failed: ${error.message}`);
            }
        });

        return jobId;
    }

    /**
     * Get job status
     * @param {string} jobId - Job ID
     * @returns {Object|null} Job status
     */
    getJobStatus(jobId) {
        return jobTracker.getJob(jobId);
    }

    /**
     * Reprocess cached polylines to activate road segments
     * @param {string} jobId - Job ID for tracking progress
     * @param {number} limit - Maximum number of polylines to process (optional)
     * @param {number} offset - Offset for pagination (default: 0)
     * @returns {Promise<Object>} Result with stats
     */
    async reprocessPolylines(jobId, limit = null, offset = 0) {
        const client = await this.db.pool.connect();

        if (this.logger) {
            this.logger.info(`Starting polyline reprocessing - Limit: ${limit || 'ALL'}, Offset: ${offset}`);
        }

        try {
            await client.query('BEGIN');

            // Get polylines to reprocess
            // Convert geometry to WKT in the query so we can use it in ST_GeomFromText later
            let query = `
                SELECT
                    id,
                    device_id,
                    ST_AsText(geometry) as geometry_wkt,
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

            // Update job with total count
            jobTracker.updateProgress(jobId, 0, polylines.length);

            if (polylines.length === 0) {
                await client.query('COMMIT');
                if (this.logger) {
                    this.logger.info('No polylines to process');
                }
                const result = {
                    success: true,
                    processed: 0,
                    segmentsActivated: 0,
                    message: 'No polylines to process'
                };
                jobTracker.completeJob(jobId, result);
                return result;
            }

            let totalSegmentsActivated = 0;
            let processedCount = 0;
            const errors = [];

            // Process each polyline
            for (const polyline of polylines) {
                try {
                    // Geometry is already converted to WKT in the SELECT query above
                    const polylineWKT = polyline.geometry_wkt;

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
                        // Determine direction (in JavaScript to avoid 13k+ DB queries)
                        const direction = this.determineDirection(polyline.bearing, segment.segment_bearing);
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

                    // Update progress every 10 polylines
                    if (processedCount % 10 === 0 || processedCount === polylines.length) {
                        jobTracker.updateProgress(jobId, processedCount, polylines.length);
                    }
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

            const result = {
                success: true,
                processed: processedCount,
                segmentsActivated: totalSegmentsActivated,
                errors: errors.length > 0 ? errors : undefined,
                message: `Processed ${processedCount} polylines, activated ${totalSegmentsActivated} segment updates`
            };

            jobTracker.completeJob(jobId, result);
            return result;

        } catch (error) {
            await client.query('ROLLBACK');
            if (this.logger) {
                this.logger.error(`Reprocessing failed: ${error.message}`);
            }
            jobTracker.failJob(jobId, error);
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

    /**
     * Start offset generation job asynchronously
     * @param {number} limit - Maximum number of ways to process (optional)
     * @returns {string} Job ID
     */
    startOffsetGenerationJob(limit = null) {
        const jobId = jobTracker.createJob('generate-offsets', { limit });

        // Run in background
        this.generateOffsets(jobId, limit).catch(error => {
            if (this.logger) {
                this.logger.error(`Background offset generation job ${jobId} failed: ${error.message}`);
            }
        });

        return jobId;
    }

    /**
     * Generate offset geometries for road segments
     * @param {string} jobId - Job ID for tracking progress
     * @param {number} limit - Maximum number of ways to process (optional)
     * @returns {Promise<Object>} Result with stats
     */
    async generateOffsets(jobId, limit = null) {
        const client = await this.db.pool.connect();

        if (this.logger) {
            this.logger.info(`Starting offset generation - Limit: ${limit || 'ALL ways'}`);
        }

        try {
            await client.query('BEGIN');

            // Get distinct OSM way IDs
            let query = `
                SELECT DISTINCT osm_way_id
                FROM road_segments
                WHERE osm_way_id IS NOT NULL
                  AND geometry IS NOT NULL
                ORDER BY osm_way_id
            `;

            if (limit) {
                query += ` LIMIT $1`;
            }

            const params = limit ? [limit] : [];
            const waysResult = await client.query(query, params);
            const ways = waysResult.rows;

            if (this.logger) {
                this.logger.info(`Found ${ways.length} OSM ways to process`);
            }

            // Update job with total count
            jobTracker.updateProgress(jobId, 0, ways.length);

            if (ways.length === 0) {
                await client.query('COMMIT');
                if (this.logger) {
                    this.logger.info('No ways to process');
                }
                const result = {
                    success: true,
                    processed: 0,
                    segmentsUpdated: 0,
                    message: 'No ways to process'
                };
                jobTracker.completeJob(jobId, result);
                return result;
            }

            let totalSegmentsUpdated = 0;
            let processedCount = 0;
            const errors = [];

            // Process each way
            for (const way of ways) {
                try {
                    const segmentsUpdated = await this.offsetGenerator.generateOffsetsForWay(
                        client,
                        way.osm_way_id
                    );

                    totalSegmentsUpdated += segmentsUpdated;
                    processedCount++;

                    // Update progress every 10 ways
                    if (processedCount % 10 === 0 || processedCount === ways.length) {
                        jobTracker.updateProgress(jobId, processedCount, ways.length);
                    }
                } catch (error) {
                    if (this.logger) {
                        this.logger.error(`Error processing way ${way.osm_way_id}: ${error.message}`);
                    }
                    errors.push({
                        wayId: way.osm_way_id,
                        error: error.message
                    });
                }
            }

            await client.query('COMMIT');

            if (this.logger) {
                this.logger.info(`Offset generation complete - Processed: ${processedCount} ways, Segments updated: ${totalSegmentsUpdated}, Errors: ${errors.length}`);
            }

            const result = {
                success: true,
                processed: processedCount,
                segmentsUpdated: totalSegmentsUpdated,
                errors: errors.length > 0 ? errors : undefined,
                message: `Processed ${processedCount} ways, updated ${totalSegmentsUpdated} segments`
            };

            jobTracker.completeJob(jobId, result);
            return result;

        } catch (error) {
            await client.query('ROLLBACK');
            if (this.logger) {
                this.logger.error(`Offset generation failed: ${error.message}`);
            }
            jobTracker.failJob(jobId, error);
            throw error;
        } finally {
            client.release();
        }
    }

    /**
     * Get statistics about offset generation
     * @returns {Promise<Object>} Statistics
     */
    async getOffsetStats() {
        return await this.offsetGenerator.getOffsetStats();
    }
}

module.exports = OperationsService;
