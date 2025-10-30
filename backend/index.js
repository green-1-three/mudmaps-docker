/**
 * MudMaps Backend Server
 * Entry point for the API server
 */

const createApp = require('./app');
const config = require('./config/config');

// Create and start server
const app = createApp();
const PORT = config.server.port;

const server = app.listen(PORT, () => {
    console.log(`✅ MudMaps backend running on port ${PORT}`);
    console.log(`📦 Using cached_polylines table (pre-processed)`);
    console.log(`🛣️  Segments endpoint: /api/segments`);
    console.log(`🗺️  OSRM: ${config.services.osrmBase}`);
});

// Graceful shutdown
async function shutdown(signal) {
    console.log(`\n📴 Received ${signal}, shutting down gracefully...`);
    
    // Close server
    server.close(() => {
        console.log('✅ HTTP server closed');
    });
    
    // Close database connections
    if (app.locals.database) {
        await app.locals.database.close();
        console.log('✅ Database connections closed');
    }
    
    process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

module.exports = server;
