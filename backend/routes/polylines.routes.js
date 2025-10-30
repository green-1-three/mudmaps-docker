/**
 * Polylines Routes
 * API endpoints for polyline operations
 */

const express = require('express');

function createPolylinesRoutes(polylinesService) {
    const router = express.Router();

    // Get cached polylines
    router.get('/api/paths/encoded', async (req, res) => {
        try {
            const { device_id, hours = 168 } = req.query;
            const result = await polylinesService.getCachedPolylines(device_id, Number(hours));
            res.json(result);
        } catch (error) {
            console.error('GET /api/paths/encoded error:', error);
            res.status(500).json({ error: 'db_error', message: error.message });
        }
    });

    // Cache statistics
    router.get('/cache/stats', async (req, res) => {
        try {
            const stats = await polylinesService.getCacheStats();
            res.json(stats);
        } catch (error) {
            console.error('Cache stats error:', error);
            res.status(500).json({ error: error.message });
        }
    });

    // Legacy endpoints
    router.get('/markers', async (req, res) => {
        try {
            const markers = await polylinesService.getMarkers();
            res.json(markers);
        } catch (error) {
            console.error('GET /markers error:', error);
            res.status(500).json({ error: 'db_error' });
        }
    });

    router.get('/polylines', async (req, res) => {
        try {
            const polylines = await polylinesService.getLegacyPolylines();
            res.json(polylines);
        } catch (error) {
            console.error('GET /polylines error:', error);
            res.status(500).json({ error: 'db_error' });
        }
    });

    return router;
}

module.exports = createPolylinesRoutes;
