/**
 * Database Inspection Routes
 * Provides endpoints for database table inspection
 */

const express = require('express');

function createDatabaseRoutes(databaseInspectionService) {
    const router = express.Router();

    /**
     * GET /api/database/:tableName
     * Get paginated data from a table
     */
    router.get('/api/database/:tableName', async (req, res, next) => {
        try {
            const { tableName } = req.params;
            const { limit = 10, offset = 0 } = req.query;

            const data = await databaseInspectionService.getTableData(
                tableName, 
                parseInt(limit), 
                parseInt(offset)
            );

            res.json(data);
        } catch (error) {
            next(error);
        }
    });

    /**
     * GET /api/database/:tableName/stats
     * Get statistics for a table
     */
    router.get('/api/database/:tableName/stats', async (req, res, next) => {
        try {
            const { tableName } = req.params;
            const stats = await databaseInspectionService.getTableStats(tableName);
            res.json(stats);
        } catch (error) {
            next(error);
        }
    });

    /**
     * GET /api/database/:tableName/:id
     * Get a single record by ID
     */
    router.get('/api/database/:tableName/:id', async (req, res, next) => {
        try {
            const { tableName, id } = req.params;
            const record = await databaseInspectionService.getRecord(tableName, id);

            if (!record) {
                return res.status(404).json({ 
                    error: 'Record not found' 
                });
            }

            res.json(record);
        } catch (error) {
            next(error);
        }
    });

    return router;
}

module.exports = createDatabaseRoutes;
