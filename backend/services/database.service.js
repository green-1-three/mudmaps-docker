/**
 * Database Service
 * Handles database connection pooling and common queries
 */

const { Pool } = require('pg');

class DatabaseService {
    constructor(config) {
        this.pool = new Pool(config);
    }

    /**
     * Execute a query
     * @param {string} text - SQL query text
     * @param {Array} params - Query parameters
     * @returns {Promise<Object>} Query result
     */
    async query(text, params) {
        return await this.pool.query(text, params);
    }

    /**
     * Get a client from the pool
     * @returns {Promise<Object>} Database client
     */
    async getClient() {
        return await this.pool.connect();
    }

    /**
     * Health check
     * @returns {Promise<boolean>} True if database is healthy
     */
    async isHealthy() {
        try {
            await this.pool.query('SELECT 1');
            return true;
        } catch (error) {
            return false;
        }
    }

    /**
     * Close the pool
     * @returns {Promise<void>}
     */
    async close() {
        await this.pool.end();
    }
}

module.exports = DatabaseService;
