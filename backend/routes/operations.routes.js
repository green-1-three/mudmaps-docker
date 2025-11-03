/**
 * Operations Routes
 * API endpoints for database operations and maintenance
 */

const express = require('express');

function createOperationsRoutes(operationsService) {
    const router = express.Router();

    // Reprocess all cached polylines
    router.post('/api/operations/reprocess-polylines', async (req, res) => {
        try {
            const { limit, offset = 0 } = req.body;

            const result = await operationsService.reprocessPolylines(limit, offset);

            res.json(result);
        } catch (error) {
            console.error('POST /api/operations/reprocess-polylines error:', error);
            res.status(500).json({
                error: 'operation_failed',
                message: error.message
            });
        }
    });

    // Get reprocessing status/stats
    router.get('/api/operations/reprocess-status', async (req, res) => {
        try {
            const stats = await operationsService.getReprocessStats();
            res.json(stats);
        } catch (error) {
            console.error('GET /api/operations/reprocess-status error:', error);
            res.status(500).json({
                error: 'operation_failed',
                message: error.message
            });
        }
    });

    return router;
}

module.exports = createOperationsRoutes;
