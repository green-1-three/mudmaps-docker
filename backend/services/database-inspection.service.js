/**
 * Database Inspection Service
 * Provides read-only access to database tables for debugging
 */

class DatabaseInspectionService {
    constructor(database) {
        this.db = database;
        this.allowedTables = [
            'gps_raw_data',
            'cached_polylines',
            'road_segments', 
            'segment_updates',
            'municipalities',
            'processing_log'
        ];
    }

    /**
     * Get paginated rows from a table
     */
    async getTableData(tableName, limit = 10, offset = 0) {
        if (!this.allowedTables.includes(tableName)) {
            throw new Error(`Invalid table name. Allowed tables: ${this.allowedTables.join(', ')}`);
        }

        // Build order by clause based on table
        let orderByColumn;
        switch(tableName) {
            case 'gps_raw_data':
                orderByColumn = 'recorded_at';
                break;
            case 'cached_polylines':
                orderByColumn = 'created_at';
                break;
            case 'road_segments':
                orderByColumn = 'updated_at';
                break;
            case 'segment_updates':
                orderByColumn = 'timestamp';
                break;
            case 'municipalities':
                orderByColumn = 'created_at';
                break;
            case 'processing_log':
                orderByColumn = 'created_at';
                break;
            default:
                orderByColumn = 'id';
        }

        try {
            // Get rows with pagination
            const dataQuery = `
                SELECT * FROM ${tableName}
                ORDER BY ${orderByColumn} DESC
                LIMIT $1 OFFSET $2
            `;
            const dataResult = await this.db.query(dataQuery, [limit, offset]);

            // Get total count
            const countQuery = `SELECT COUNT(*) as count FROM ${tableName}`;
            const countResult = await this.db.query(countQuery);

            return {
                table: tableName,
                rows: dataResult.rows,
                total: parseInt(countResult.rows[0].count),
                limit: parseInt(limit),
                offset: parseInt(offset)
            };
        } catch (error) {
            console.error(`Error querying ${tableName}:`, error);
            throw new Error(`Database query failed: ${error.message}`);
        }
    }

    /**
     * Get a single record by ID
     */
    async getRecord(tableName, id) {
        if (!this.allowedTables.includes(tableName)) {
            throw new Error(`Invalid table name. Allowed tables: ${this.allowedTables.join(', ')}`);
        }

        try {
            const query = `SELECT * FROM ${tableName} WHERE id = $1`;
            const result = await this.db.query(query, [id]);

            if (result.rows.length === 0) {
                return null;
            }

            return {
                table: tableName,
                record: result.rows[0]
            };
        } catch (error) {
            console.error(`Error fetching record from ${tableName}:`, error);
            throw new Error(`Database query failed: ${error.message}`);
        }
    }

    /**
     * Get table statistics
     */
    async getTableStats(tableName) {
        if (!this.allowedTables.includes(tableName)) {
            throw new Error(`Invalid table name. Allowed tables: ${this.allowedTables.join(', ')}`);
        }

        try {
            const statsQuery = `
                SELECT 
                    COUNT(*) as total_rows,
                    pg_size_pretty(pg_relation_size('${tableName}')) as table_size,
                    (SELECT MAX(${this.getTimestampColumn(tableName)}) FROM ${tableName}) as last_updated
                FROM ${tableName}
            `;
            
            const result = await this.db.query(statsQuery);
            
            return {
                table: tableName,
                stats: result.rows[0]
            };
        } catch (error) {
            console.error(`Error getting stats for ${tableName}:`, error);
            throw new Error(`Stats query failed: ${error.message}`);
        }
    }

    /**
     * Helper to get timestamp column for a table
     */
    getTimestampColumn(tableName) {
        const timestampColumns = {
            'gps_raw_data': 'recorded_at',
            'cached_polylines': 'created_at',
            'road_segments': 'updated_at',
            'segment_updates': 'timestamp',
            'municipalities': 'updated_at',
            'processing_log': 'updated_at'
        };
        return timestampColumns[tableName] || 'created_at';
    }
}

module.exports = DatabaseInspectionService;
