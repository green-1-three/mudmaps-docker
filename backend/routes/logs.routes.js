/**
 * Logs Routes
 * API endpoints for viewing application logs
 */

const express = require('express');

function createLogsRoutes(loggingService) {
    const router = express.Router();

    /**
     * GET /api/logs
     * Get application logs with optional filtering
     *
     * Query parameters:
     * - limit: Maximum number of logs to return (default: 200)
     * - level: Filter by level (all, error, warn, info, debug)
     * - component: Filter by component name
     * - since: Filter by timestamp (ISO 8601 date string)
     */
    router.get('/api/logs', async (req, res, next) => {
        try {
            const options = {
                limit: parseInt(req.query.limit) || 200,
                level: req.query.level || 'all',
                component: req.query.component || 'all',
                since: req.query.since ? new Date(req.query.since) : null
            };

            // Validate limit
            if (options.limit < 1 || options.limit > 10000) {
                return res.status(400).json({
                    error: 'Invalid limit. Must be between 1 and 10000'
                });
            }

            const logs = loggingService.getLogs(options);

            res.json({
                logs,
                count: logs.length,
                filters: {
                    limit: options.limit,
                    level: options.level,
                    component: options.component,
                    since: options.since ? options.since.toISOString() : null
                }
            });

        } catch (error) {
            next(error);
        }
    });

    /**
     * GET /api/logs/stats
     * Get statistics about logs
     */
    router.get('/api/logs/stats', async (req, res, next) => {
        try {
            const stats = loggingService.getStats();
            res.json(stats);
        } catch (error) {
            next(error);
        }
    });

    /**
     * GET /api/logs/components
     * Get list of unique component names
     */
    router.get('/api/logs/components', async (req, res, next) => {
        try {
            const components = loggingService.getComponents();
            res.json({
                components,
                count: components.length
            });
        } catch (error) {
            next(error);
        }
    });

    /**
     * DELETE /api/logs
     * Clear all logs (useful for testing/debugging)
     */
    router.delete('/api/logs', async (req, res, next) => {
        try {
            loggingService.clear();
            res.json({
                message: 'Logs cleared successfully',
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            next(error);
        }
    });

    return router;
}

module.exports = createLogsRoutes;
