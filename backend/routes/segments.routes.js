/**
 * Segments Routes
 * API endpoints for road segment operations
 */

const express = require('express');

function createSegmentsRoutes(segmentsService) {
    const router = express.Router();

    // Get road segments
    router.get('/api/segments', async (req, res) => {
        try {
            const { 
                municipality = 'pomfret-vt', 
                since, 
                all 
            } = req.query;
            
            const segments = await segmentsService.getSegments(
                municipality,
                since,
                all === 'true'
            );
            
            res.json(segments);
        } catch (error) {
            console.error('GET /api/segments error:', error);
            res.status(500).json({ error: 'db_error', message: error.message });
        }
    });

    // Get municipality boundary
    router.get('/api/boundary', async (req, res) => {
        try {
            const { municipality = 'pomfret-vt' } = req.query;
            
            const boundary = await segmentsService.getMunicipalityBoundary(municipality);
            
            if (!boundary) {
                return res.status(404).json({ error: 'Municipality not found' });
            }
            
            res.json(boundary);
        } catch (error) {
            console.error('GET /api/boundary error:', error);
            res.status(500).json({ error: 'db_error', message: error.message });
        }
    });

    return router;
}

module.exports = createSegmentsRoutes;
