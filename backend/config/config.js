/**
 * Backend Configuration
 * Central configuration for the MudMaps API
 */

module.exports = {
    // Server Configuration
    server: {
        port: process.env.PORT || 3000,
        corsOrigin: process.env.CORS_ORIGIN || '*'
    },
    
    // PostgreSQL Configuration
    postgres: {
        host: process.env.PGHOST || 'postgres',
        port: Number(process.env.PGPORT || 5432),
        database: process.env.PGDATABASE,
        user: process.env.PGUSER,
        password: process.env.PGPASSWORD,
        max: 10 // connection pool size
    },
    
    // External Services
    services: {
        osrmBase: process.env.OSRM_BASE || 'http://router.project-osrm.org'
    },
    
    // API Configuration
    api: {
        defaultHours: 168, // Default to 7 days of data
        maxHours: 720 // Maximum 30 days
    }
};
