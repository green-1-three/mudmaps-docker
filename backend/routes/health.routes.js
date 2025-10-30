/**
 * Health Routes
 * API endpoints for health checks and monitoring
 */

const express = require('express');

function createHealthRoutes(databaseService) {
    const router = express.Router();

    // Health check endpoint
    router.get('/health', async (req, res) => {
        try {
            const isHealthy = await databaseService.isHealthy();
            
            if (isHealthy) {
                res.json({
                    status: 'healthy',
                    timestamp: new Date().toISOString()
                });
            } else {
                res.status(500).json({
                    status: 'unhealthy',
                    timestamp: new Date().toISOString()
                });
            }
        } catch (error) {
            res.status(500).json({ 
                status: 'unhealthy', 
                error: error.message 
            });
        }
    });

    return router;
}

module.exports = createHealthRoutes;
