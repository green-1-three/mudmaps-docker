/**
 * MudMaps GPS Processing Worker
 * Refactored modular version
 */

const { createClient } = require('redis');
const config = require('./config/config');
const DatabaseService = require('./services/database.service');
const GPSProcessor = require('./services/gps-processor');
const createLogger = require('./shared/logger');

class Worker {
    constructor() {
        this.config = config;
        this.db = new DatabaseService(config.postgres);
        this.processor = new GPSProcessor(this.db, config);
        this.redis = null;
        this.isShuttingDown = false;

        // Initialize Winston logger
        const backendUrl = process.env.BACKEND_URL || 'http://backend:3000/api';
        this.logger = createLogger('Worker', backendUrl);

        // Pass logger to processor
        this.processor.setLogger(this.logger);
    }

    /**
     * Initialize the worker
     */
    async initialize() {
        this.logger.info('Background Worker Starting...');
        this.logger.info(`Config: OSRM=${this.config.osrm.baseUrl}, BatchSize=${this.config.processing.batchSize}, TimeWindow=${this.config.processing.timeWindowMinutes}min, MinMovement=${this.config.processing.minMovementMeters}m`);

        // Connect to Redis
        this.redis = createClient({ url: this.config.redis.url });
        this.redis.on('error', (err) => this.logger.error('Redis error', { error: err.message }));
        await this.redis.connect();
        this.logger.info('Connected to Redis queue');

        // Log initial statistics
        await this.logStatistics();

        // Set up statistics interval
        setInterval(() => this.logStatistics(), this.config.processing.statisticsIntervalMs);

        // Set up graceful shutdown handlers
        process.on('SIGTERM', () => this.shutdown('SIGTERM'));
        process.on('SIGINT', () => this.shutdown('SIGINT'));
    }

    /**
     * Main processing loop
     */
    async run() {
        this.logger.info('Listening for jobs on gps:queue...');

        while (!this.isShuttingDown) {
            try {
                // BRPOP blocks until a job is available
                const result = await this.redis.brPop(
                    this.config.redis.queues.gps,
                    this.config.redis.popTimeout
                );

                if (result) {
                    const deviceId = result.element;
                    this.logger.info(`Received job for device: ${deviceId}`);

                    await this.processor.processDevice(deviceId);

                    // Remove device from queued set
                    await this.redis.sRem(this.config.redis.queues.devicesQueued, deviceId);
                }
            } catch (error) {
                this.logger.error('Error in main loop', { error: error.message, stack: error.stack });
                // Brief pause before retrying on error
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }
    }

    /**
     * Log statistics
     */
    async logStatistics() {
        try {
            const stats = await this.db.getStatistics();

            this.logger.info('=== STATISTICS ===', {
                total_gps_points: stats.total_gps_points,
                unprocessed: stats.unprocessed_points,
                processed: stats.processed_points,
                cached_paths: stats.total_cached_paths,
                active_devices: stats.active_devices,
                backlog_minutes: stats.processing_backlog_minutes ? Math.round(stats.processing_backlog_minutes) : null
            });
        } catch (error) {
            this.logger.error('Error logging statistics', { error: error.message });
        }
    }

    /**
     * Graceful shutdown
     */
    async shutdown(signal) {
        this.logger.warn(`Received ${signal}, shutting down gracefully...`);
        this.isShuttingDown = true;

        try {
            if (this.redis) {
                await this.redis.quit();
            }
            await this.db.close();

            this.logger.info('Shutdown complete');

            // Flush remaining logs before exiting
            await this.logger.shutdown();

            process.exit(0);
        } catch (error) {
            this.logger.error('Error during shutdown', { error: error.message });
            await this.logger.shutdown();
            process.exit(1);
        }
    }
}

// Start the worker
async function main() {
    const worker = new Worker();

    try {
        await worker.initialize();
        await worker.run();
    } catch (error) {
        worker.logger.error('Fatal error', { error: error.message, stack: error.stack });
        await worker.logger.shutdown();
        process.exit(1);
    }
}

// Run if this is the main module
if (require.main === module) {
    main();
}

module.exports = Worker;
