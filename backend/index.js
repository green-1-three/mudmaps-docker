/**
 * MudMaps Backend Server
 * Entry point for the API server
 */

const createApp = require('./app');
const config = require('./config/config');

// Create and start server
const app = createApp();
const PORT = config.server.port;
const logger = app.locals.loggingService;

const server = app.listen(PORT, () => {
    console.log(`✅ MudMaps backend running on port ${PORT}`);
    console.log(`📦 Using cached_polylines table (pre-processed)`);
    console.log(`🛣️  Segments endpoint: /api/segments`);
    console.log(`🗺️  OSRM: ${config.services.osrmBase}`);

    // Log to logging service
    logger.info(`Server started on port ${PORT}`, 'Server');
    logger.info('Using cached_polylines table (pre-processed)', 'Server');
    logger.info(`OSRM endpoint: ${config.services.osrmBase}`, 'Server');
});

// Graceful shutdown
async function shutdown(signal) {
    console.log(`\n📴 Received ${signal}, shutting down gracefully...`);
    logger.warn(`Received ${signal}, initiating graceful shutdown`, 'Server');

    // Close server
    server.close(() => {
        console.log('✅ HTTP server closed');
        logger.info('HTTP server closed', 'Server');
    });

    // Close database connections
    if (app.locals.database) {
        await app.locals.database.close();
        console.log('✅ Database connections closed');
        logger.info('Database connections closed', 'Database');
    }

    process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

module.exports = server;
