/**
 * Operations Routes
 * API endpoints for database operations and maintenance
 */

const express = require('express');

function createOperationsRoutes(operationsService) {
    const router = express.Router();

    // Start reprocess job (returns immediately with job ID)
    router.post('/api/operations/reprocess-polylines', async (req, res) => {
        try {
            const { limit, offset = 0 } = req.body;

            const jobId = operationsService.startReprocessJob(limit, offset);

            res.json({
                success: true,
                jobId,
                message: 'Reprocessing job started'
            });
        } catch (error) {
            console.error('POST /api/operations/reprocess-polylines error:', error);
            res.status(500).json({
                error: 'operation_failed',
                message: error.message
            });
        }
    });

    // Get job status
    router.get('/api/operations/jobs/:jobId', async (req, res) => {
        try {
            const { jobId } = req.params;

            const job = operationsService.getJobStatus(jobId);

            if (!job) {
                return res.status(404).json({
                    error: 'job_not_found',
                    message: 'Job not found'
                });
            }

            res.json(job);
        } catch (error) {
            console.error('GET /api/operations/jobs/:jobId error:', error);
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

    // Start offset generation job (returns immediately with job ID)
    router.post('/api/operations/generate-offsets', async (req, res) => {
        try {
            const { limit } = req.body;

            const jobId = operationsService.startOffsetGenerationJob(limit);

            res.json({
                success: true,
                jobId,
                message: 'Offset generation job started'
            });
        } catch (error) {
            console.error('POST /api/operations/generate-offsets error:', error);
            res.status(500).json({
                error: 'operation_failed',
                message: error.message
            });
        }
    });

    // Get offset generation stats
    router.get('/api/operations/offset-status', async (req, res) => {
        try {
            const stats = await operationsService.getOffsetStats();
            res.json(stats);
        } catch (error) {
            console.error('GET /api/operations/offset-status error:', error);
            res.status(500).json({
                error: 'operation_failed',
                message: error.message
            });
        }
    });

    return router;
}

module.exports = createOperationsRoutes;
