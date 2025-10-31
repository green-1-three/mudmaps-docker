/**
 * Segments Service
 * Business logic for road segment operations
 */

class SegmentsService {
    constructor(database) {
        this.db = database;
    }

    /**
     * Get road segments for a municipality
     * @param {string} municipalityId - Municipality ID
     * @param {Date} since - Optional date filter
     * @param {boolean} all - Return all segments regardless of activation
     * @returns {Promise<Object>} GeoJSON FeatureCollection of segments
     */
    async getSegments(municipalityId, since, all) {
        console.log(`🛣️  Fetching segments for ${municipalityId}${since ? ` since ${since}` : ''}${all ? ' (ALL segments)' : ''}`);
        
        let query = `
            SELECT 
                id,
                ST_AsGeoJSON(geometry) as geometry,
                street_name,
                road_classification,
                bearing,
                last_plowed_forward,
                last_plowed_reverse,
                last_plowed_device_id,
                plow_count_today,
                plow_count_total,
                segment_length
            FROM road_segments
            WHERE municipality_id = $1
        `;
        
        const params = [municipalityId];
        
        // Optional time filter or all segments
        if (all) {
            console.log('  📦 Returning ALL segments (including unactivated)');
        } else if (since) {
            query += ` AND (last_plowed_forward > $2 OR last_plowed_reverse > $2)`;
            params.push(new Date(since));
        } else {
            // Default: only return segments plowed in last 7 days
            query += ` AND (last_plowed_forward > NOW() - INTERVAL '7 days' OR last_plowed_reverse > NOW() - INTERVAL '7 days')`;
        }
        
        query += ` ORDER BY GREATEST(last_plowed_forward, last_plowed_reverse) DESC`;
        
        const { rows } = await this.db.query(query, params);
        
        console.log(`✅ Returning ${rows.length} activated segments`);
        
        // Transform to GeoJSON-friendly format
        const segments = rows.map(row => ({
            id: row.id,
            geometry: JSON.parse(row.geometry),
            properties: {
                street_name: row.street_name,
                road_classification: row.road_classification,
                bearing: row.bearing,
                last_plowed_forward: row.last_plowed_forward,
                last_plowed_reverse: row.last_plowed_reverse,
                last_plowed: row.last_plowed_forward > row.last_plowed_reverse 
                    ? row.last_plowed_forward 
                    : row.last_plowed_reverse,
                device_id: row.last_plowed_device_id,
                plow_count_today: row.plow_count_today,
                plow_count_total: row.plow_count_total,
                segment_length: row.segment_length
            }
        }));
        
        return {
            type: 'FeatureCollection',
            features: segments
        };
    }

    /**
     * Get a single segment by ID
     * @param {number} id - Segment ID
     * @returns {Promise<Object>} Segment data
     */
    async getSegmentById(id) {
        console.log(`🔍 Fetching segment by ID: ${id}`);
        
        const { rows } = await this.db.query(`
            SELECT 
                id,
                ST_AsGeoJSON(geometry) as geometry,
                street_name,
                road_classification,
                bearing,
                last_plowed_forward,
                last_plowed_reverse,
                last_plowed_device_id,
                plow_count_today,
                plow_count_total,
                segment_length,
                municipality_id
            FROM road_segments
            WHERE id = $1
        `, [id]);
        
        if (rows.length === 0) {
            return null;
        }
        
        const row = rows[0];
        console.log(`✅ Found segment ${id}: ${row.street_name}`);
        
        return {
            id: row.id,
            geometry: JSON.parse(row.geometry),
            properties: {
                street_name: row.street_name,
                road_classification: row.road_classification,
                bearing: row.bearing,
                last_plowed_forward: row.last_plowed_forward,
                last_plowed_reverse: row.last_plowed_reverse,
                last_plowed: row.last_plowed_forward > row.last_plowed_reverse 
                    ? row.last_plowed_forward 
                    : row.last_plowed_reverse,
                device_id: row.last_plowed_device_id,
                plow_count_today: row.plow_count_today,
                plow_count_total: row.plow_count_total,
                segment_length: row.segment_length,
                municipality_id: row.municipality_id
            }
        };
    }

    /**
     * Get municipality boundary
     * @param {string} municipalityId - Municipality ID
     * @returns {Promise<Object>} GeoJSON Feature of boundary
     */
    async getMunicipalityBoundary(municipalityId) {
        console.log(`🗺️  Fetching boundary for ${municipalityId}`);
        
        const { rows } = await this.db.query(`
            SELECT 
                id,
                name,
                state,
                ST_AsGeoJSON(boundary) as geometry
            FROM municipalities
            WHERE id = $1
        `, [municipalityId]);
        
        if (rows.length === 0) {
            return null;
        }
        
        const boundary = rows[0];
        console.log(`✅ Returning boundary for ${boundary.name}, ${boundary.state}`);
        
        return {
            type: 'Feature',
            id: boundary.id,
            geometry: JSON.parse(boundary.geometry),
            properties: {
                name: boundary.name,
                state: boundary.state
            }
        };
    }
}

module.exports = SegmentsService;
