/**
 * MudMaps Backend Application
 * Express app setup and configuration
 */

const express = require('express');
const cors = require('cors');
const config = require('./config/config');
const DatabaseService = require('./services/database.service');
const PolylinesService = require('./services/polylines.service');
const SegmentsService = require('./services/segments.service');
const createPolylinesRoutes = require('./routes/polylines.routes');
const createSegmentsRoutes = require('./routes/segments.routes');
const createHealthRoutes = require('./routes/health.routes');
const errorHandler = require('./middleware/error-handler');

// Create Express app
function createApp() {
    const app = express();

    // Middleware
    app.use(cors({ 
        origin: config.server.corsOrigin, 
        credentials: false 
    }));
    app.use(express.json());

    // Initialize services
    const database = new DatabaseService(config.postgres);
    const polylinesService = new PolylinesService(database);
    const segmentsService = new SegmentsService(database);

    // Mount routes
    app.use(createPolylinesRoutes(polylinesService));
    app.use(createSegmentsRoutes(segmentsService));
    app.use(createHealthRoutes(database));

    // Error handler (must be last)
    app.use(errorHandler);

    // Store services for graceful shutdown
    app.locals.database = database;

    return app;
}

module.exports = createApp;
