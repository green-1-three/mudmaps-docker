/**
 * MudMaps GPS Processing Worker
 * Refactored modular version
 */

const { createClient } = require('redis');
const config = require('./config/config');
const DatabaseService = require('./services/database.service');
const GPSProcessor = require('./services/gps-processor');

class Worker {
    constructor() {
        this.config = config;
        this.db = new DatabaseService(config.postgres);
        this.processor = new GPSProcessor(this.db, config);
        this.redis = null;
        this.isShuttingDown = false;
    }

    /**
     * Initialize the worker
     */
    async initialize() {
        console.log('🚀 Background Worker Starting...');
        console.log(`📊 Config: OSRM=${this.config.osrm.baseUrl}, BatchSize=${this.config.processing.batchSize}, TimeWindow=${this.config.processing.timeWindowMinutes}min, MinMovement=${this.config.processing.minMovementMeters}m`);
        
        // Connect to Redis
        this.redis = createClient({ url: this.config.redis.url });
        this.redis.on('error', (err) => console.error('❌ Redis Error:', err));
        await this.redis.connect();
        console.log('✅ Connected to Redis queue');
        
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
        console.log('👂 Listening for jobs on gps:queue...');
        
        while (!this.isShuttingDown) {
            try {
                // BRPOP blocks until a job is available
                const result = await this.redis.brPop(
                    this.config.redis.queues.gps, 
                    this.config.redis.popTimeout
                );
                
                if (result) {
                    const deviceId = result.element;
                    console.log(`\n📦 Received job for device: ${deviceId}`);
                    
                    await this.processor.processDevice(deviceId);
                    
                    // Remove device from queued set
                    await this.redis.sRem(this.config.redis.queues.devicesQueued, deviceId);
                }
            } catch (error) {
                console.error('❌ Error in main loop:', error);
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
            
            console.log('\n📊 === STATISTICS ===');
            console.log(`   Total GPS Points: ${stats.total_gps_points}`);
            console.log(`   Unprocessed: ${stats.unprocessed_points}`);
            console.log(`   Processed: ${stats.processed_points}`);
            console.log(`   Cached Paths: ${stats.total_cached_paths}`);
            console.log(`   Active Devices: ${stats.active_devices}`);
            if (stats.processing_backlog_minutes) {
                console.log(`   Backlog: ${Math.round(stats.processing_backlog_minutes)} minutes`);
            }
            console.log('=====================\n');
        } catch (error) {
            console.error('❌ Error logging statistics:', error);
        }
    }

    /**
     * Graceful shutdown
     */
    async shutdown(signal) {
        console.log(`\n📴 Received ${signal}, shutting down gracefully...`);
        this.isShuttingDown = true;
        
        try {
            if (this.redis) {
                await this.redis.quit();
            }
            await this.db.close();
            console.log('✅ Shutdown complete');
            process.exit(0);
        } catch (error) {
            console.error('❌ Error during shutdown:', error);
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
        console.error('❌ Fatal error:', error);
        process.exit(1);
    }
}

// Run if this is the main module
if (require.main === module) {
    main();
}

module.exports = Worker;
