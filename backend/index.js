/**
 * MudMaps Backend Server
 * Entry point for the API server
 */

const createApp = require('./app');
const config = require('./config/config');
const createLogger = require('../shared/logger');

// Create Winston logger for backend's own logs (console + file only, no HTTP)
const logger = createLogger('Backend', null);

// Create and start server
const app = createApp();
const PORT = config.server.port;
const loggingService = app.locals.loggingService;

const server = app.listen(PORT, () => {
    // Log to Winston (console + file)
    logger.info(`MudMaps backend running on port ${PORT}`);
    logger.info(`Using cached_polylines table (pre-processed)`);
    logger.info(`Segments endpoint: /api/segments`);
    logger.info(`OSRM: ${config.services.osrmBase}`);

    // Also log to centralized logging service for remote access
    loggingService.info(`Server started on port ${PORT}`, 'Backend');
    loggingService.info('Using cached_polylines table (pre-processed)', 'Backend');
    loggingService.info(`OSRM endpoint: ${config.services.osrmBase}`, 'Backend');
});

// Graceful shutdown
async function shutdown(signal) {
    logger.warn(`Received ${signal}, shutting down gracefully...`);
    loggingService.warn(`Received ${signal}, initiating graceful shutdown`, 'Backend');

    // Close server
    server.close(() => {
        logger.info('HTTP server closed');
        loggingService.info('HTTP server closed', 'Backend');
    });

    // Close database connections
    if (app.locals.database) {
        await app.locals.database.close();
        logger.info('Database connections closed');
        loggingService.info('Database connections closed', 'Backend');
    }

    // Flush Winston logs before exit
    await logger.shutdown();

    process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

module.exports = server;
