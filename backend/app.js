/**
 * MudMaps Backend Application
 * Express app setup and configuration
 */

const express = require('express');
const cors = require('cors');
const config = require('./config/config');
const createLogger = require('./shared/logger');
const DatabaseService = require('./services/database.service');
const PolylinesService = require('./services/polylines.service');
const SegmentsService = require('./services/segments.service');
const DatabaseInspectionService = require('./services/database-inspection.service');
const OperationsService = require('./services/operations.service');
const loggingService = require('./services/logging.service');
const createPolylinesRoutes = require('./routes/polylines.routes');
const createSegmentsRoutes = require('./routes/segments.routes');
const createHealthRoutes = require('./routes/health.routes');
const createDatabaseRoutes = require('./routes/database.routes');
const createOperationsRoutes = require('./routes/operations.routes');
const createLogsRoutes = require('./routes/logs.routes');
const errorHandler = require('./middleware/error-handler');

// Create Express app
function createApp() {
    const app = express();

    // Middleware
    app.use(cors({
        origin: config.server.corsOrigin,
        credentials: false
    }));
    app.use(express.json({ limit: '10mb' })); // Increased limit for log payloads

    // Create Winston logger for backend services
    // Create custom transport that writes directly to loggingService (avoid HTTP circular dependency)
    const winston = require('winston');
    const Transport = require('winston-transport');

    class DirectLoggingTransport extends Transport {
        constructor(opts = {}) {
            super(opts);
            this.loggingService = opts.loggingService;
            this.component = opts.component;
        }

        log(info, callback) {
            setImmediate(() => {
                this.emit('logged', info);
            });

            // Write directly to logging service
            if (this.loggingService) {
                const method = info.level; // 'info', 'error', 'warn', etc.
                if (typeof this.loggingService[method] === 'function') {
                    this.loggingService[method](info.message, this.component, info.details);
                }
            }

            callback();
        }
    }

    // Create base logger (console + file)
    const logger = createLogger('Backend-Services', null);

    // Add direct logging service transport
    logger.add(new DirectLoggingTransport({
        loggingService: loggingService,
        component: 'Backend-Services'
    }));

    // Initialize services with logger
    const database = new DatabaseService(config.postgres);
    const polylinesService = new PolylinesService(database, logger);
    const segmentsService = new SegmentsService(database, logger);
    const databaseInspectionService = new DatabaseInspectionService(database, logger);
    const operationsService = new OperationsService(database, logger);

    // Mount routes
    app.use(createPolylinesRoutes(polylinesService));
    app.use(createSegmentsRoutes(segmentsService));
    app.use(createHealthRoutes(database));
    app.use(createDatabaseRoutes(databaseInspectionService));
    app.use(createOperationsRoutes(operationsService));
    app.use(createLogsRoutes(loggingService));

    // Error handler (must be last)
    app.use(errorHandler);

    // Store services for graceful shutdown
    app.locals.database = database;
    app.locals.loggingService = loggingService;

    // Log application startup
    loggingService.info('MudMaps backend application initialized', 'Application');

    return app;
}

module.exports = createApp;
