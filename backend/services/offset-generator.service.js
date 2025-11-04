/**
 * Offset Generator Service
 * Generates offset geometries for road segments
 * Uses full OSM way offset curves, then slices per segment
 */

class OffsetGeneratorService {
    constructor(databaseService, logger = null) {
        this.db = databaseService;
        this.logger = logger;
        this.offsetDistance = 2; // meters
    }

    /**
     * Generate offset geometries for a single OSM way
     * @param {Object} client - Database client
     * @param {number} osmWayId - OSM way ID
     * @returns {Promise<number>} Number of segments updated
     */
    async generateOffsetsForWay(client, osmWayId) {
        try {
            // Get all segments for this way, ordered by their position along the way
            const segmentsResult = await client.query(`
                SELECT
                    id,
                    geometry,
                    ST_AsText(geometry) as geom_wkt,
                    ST_StartPoint(geometry) as start_point,
                    ST_EndPoint(geometry) as end_point
                FROM road_segments
                WHERE osm_way_id = $1
                  AND geometry IS NOT NULL
                ORDER BY id  -- Assuming segments are created in order
            `, [osmWayId]);

            const segments = segmentsResult.rows;

            if (segments.length === 0) {
                return 0;
            }

            // Reconstruct full way geometry from segments
            const wayGeometryResult = await client.query(`
                SELECT ST_LineMerge(ST_Union(geometry)) as way_geometry
                FROM road_segments
                WHERE osm_way_id = $1
                  AND geometry IS NOT NULL
            `, [osmWayId]);

            if (!wayGeometryResult.rows[0].way_geometry) {
                if (this.logger) {
                    this.logger.warn(`Could not merge segments for OSM way ${osmWayId}`);
                }
                return 0;
            }

            // Generate offset curves for the entire way
            // Using geography for accurate meter-based offsets
            const offsetResult = await client.query(`
                WITH way AS (
                    SELECT ST_LineMerge(ST_Union(geometry)) as geom
                    FROM road_segments
                    WHERE osm_way_id = $1
                      AND geometry IS NOT NULL
                )
                SELECT
                    ST_AsText(ST_OffsetCurve(geom::geography, $2)::geometry) as left_offset,
                    ST_AsText(ST_OffsetCurve(geom::geography, $3)::geometry) as right_offset
                FROM way
            `, [osmWayId, this.offsetDistance, -this.offsetDistance]);

            const { left_offset, right_offset } = offsetResult.rows[0];

            if (!left_offset || !right_offset) {
                if (this.logger) {
                    this.logger.warn(`Could not generate offset curves for OSM way ${osmWayId}`);
                }
                return 0;
            }

            // Process each segment
            let updatedCount = 0;
            for (const segment of segments) {
                try {
                    // Slice the offset curves at segment boundaries
                    const sliceResult = await client.query(`
                        WITH
                        segment AS (
                            SELECT
                                ST_GeomFromText($1, 4326) as geom,
                                ST_StartPoint(ST_GeomFromText($1, 4326)) as start_pt,
                                ST_EndPoint(ST_GeomFromText($1, 4326)) as end_pt
                        ),
                        offsets AS (
                            SELECT
                                ST_GeomFromText($2, 4326) as left_curve,
                                ST_GeomFromText($3, 4326) as right_curve
                        ),
                        slice_points AS (
                            SELECT
                                ST_LineLocatePoint(o.left_curve, s.start_pt) as left_start_fraction,
                                ST_LineLocatePoint(o.left_curve, s.end_pt) as left_end_fraction,
                                ST_LineLocatePoint(o.right_curve, s.start_pt) as right_start_fraction,
                                ST_LineLocatePoint(o.right_curve, s.end_pt) as right_end_fraction,
                                o.left_curve,
                                o.right_curve
                            FROM segment s, offsets o
                        )
                        SELECT
                            ST_LineSubstring(
                                left_curve,
                                LEAST(left_start_fraction, left_end_fraction),
                                GREATEST(left_start_fraction, left_end_fraction)
                            ) as vertices_forward,
                            ST_LineSubstring(
                                right_curve,
                                LEAST(right_start_fraction, right_end_fraction),
                                GREATEST(right_start_fraction, right_end_fraction)
                            ) as vertices_reverse
                        FROM slice_points
                    `, [segment.geom_wkt, left_offset, right_offset]);

                    const offsets = sliceResult.rows[0];

                    // Update segment with offset geometries
                    await client.query(`
                        UPDATE road_segments
                        SET
                            vertices_forward = $1,
                            vertices_reverse = $2,
                            updated_at = NOW()
                        WHERE id = $3
                    `, [offsets.vertices_forward, offsets.vertices_reverse, segment.id]);

                    updatedCount++;
                } catch (error) {
                    if (this.logger) {
                        this.logger.error(`Error processing segment ${segment.id}`, { error: error.message });
                    }
                    // Continue with other segments
                }
            }

            return updatedCount;
        } catch (error) {
            if (this.logger) {
                this.logger.error(`Error generating offsets for way ${osmWayId}`, { error: error.message });
            }
            throw error;
        }
    }

    /**
     * Get statistics about offset generation
     * @returns {Promise<Object>} Statistics
     */
    async getOffsetStats() {
        try {
            const result = await this.db.pool.query(`
                SELECT
                    COUNT(*) as total_segments,
                    COUNT(CASE WHEN vertices_forward IS NOT NULL THEN 1 END) as segments_with_forward,
                    COUNT(CASE WHEN vertices_reverse IS NOT NULL THEN 1 END) as segments_with_reverse,
                    COUNT(DISTINCT osm_way_id) as total_ways,
                    COUNT(DISTINCT CASE WHEN vertices_forward IS NOT NULL THEN osm_way_id END) as ways_with_offsets
                FROM road_segments
                WHERE osm_way_id IS NOT NULL
            `);

            return result.rows[0];
        } catch (error) {
            if (this.logger) {
                this.logger.error('Error getting offset stats', { error: error.message });
            }
            throw error;
        }
    }
}

module.exports = OffsetGeneratorService;
