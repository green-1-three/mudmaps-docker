/**
 * Worker Configuration
 * Central configuration for the GPS processing worker
 */

require('dotenv').config();

module.exports = {
    // Redis Configuration
    redis: {
        url: process.env.REDIS_URL || 'redis://redis:6379',
        queues: {
            gps: 'gps:queue',
            devicesQueued: 'gps:devices_queued'
        },
        popTimeout: 5 // seconds to wait for queue pop
    },
    
    // PostgreSQL Configuration
    postgres: {
        user: process.env.PGUSER,
        host: process.env.PGHOST || 'postgres',
        database: process.env.PGDATABASE,
        password: process.env.PGPASSWORD,
        port: parseInt(process.env.PGPORT) || 5432,
        max: 10 // connection pool size
    },
    
    // OSRM Configuration
    osrm: {
        baseUrl: process.env.OSRM_BASE || 'http://osrm:5000',
        timeout: 10000 // milliseconds
    },
    
    // Processing Configuration
    processing: {
        batchSize: 5, // Process 5 coordinates per batch (1 overlap + 4 new = ~2 minutes of data)
        timeWindowMinutes: 2, // Group coordinates within 2-minute windows
        minMovementMeters: 50, // Minimum movement to process batch
        maxConnectionGapMinutes: 5, // Max gap to connect points
        maxRetries: 3, // Max retries before abandoning points
        statisticsIntervalMs: 5 * 60 * 1000 // Log stats every 5 minutes
    }
};
