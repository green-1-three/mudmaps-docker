/**
 * Logging Service
 * Provides centralized logging with in-memory storage for the /logs API endpoint
 */

class LoggingService {
    constructor(maxLogs = 1000) {
        this.logs = [];
        this.maxLogs = maxLogs;
    }

    /**
     * Add a log entry
     * @param {string} level - Log level (error, warn, info, debug)
     * @param {string} message - Log message
     * @param {string} component - Component name (optional)
     * @param {Object} details - Additional details (optional)
     */
    log(level, message, component = null, details = null) {
        const logEntry = {
            timestamp: new Date().toISOString(),
            level: level.toLowerCase(),
            message,
            component,
            details
        };

        // Add to beginning of array (most recent first)
        this.logs.unshift(logEntry);

        // Trim to max size (circular buffer)
        if (this.logs.length > this.maxLogs) {
            this.logs = this.logs.slice(0, this.maxLogs);
        }

        // Also output to console for real-time monitoring
        const timestamp = new Date().toLocaleString();
        const componentStr = component ? `[${component}]` : '';
        const detailsStr = details ? ` ${JSON.stringify(details)}` : '';

        switch (level.toLowerCase()) {
            case 'error':
                console.error(`❌ ${timestamp} ${componentStr} ${message}${detailsStr}`);
                break;
            case 'warn':
                console.warn(`⚠️  ${timestamp} ${componentStr} ${message}${detailsStr}`);
                break;
            case 'info':
                console.info(`ℹ️  ${timestamp} ${componentStr} ${message}${detailsStr}`);
                break;
            case 'debug':
                console.log(`🐛 ${timestamp} ${componentStr} ${message}${detailsStr}`);
                break;
            default:
                console.log(`📝 ${timestamp} ${componentStr} ${message}${detailsStr}`);
        }
    }

    /**
     * Log an error
     */
    error(message, component = null, details = null) {
        this.log('error', message, component, details);
    }

    /**
     * Log a warning
     */
    warn(message, component = null, details = null) {
        this.log('warn', message, component, details);
    }

    /**
     * Log an info message
     */
    info(message, component = null, details = null) {
        this.log('info', message, component, details);
    }

    /**
     * Log a debug message
     */
    debug(message, component = null, details = null) {
        this.log('debug', message, component, details);
    }

    /**
     * Get logs with optional filtering
     * @param {Object} options - Filter options
     * @param {number} options.limit - Maximum number of logs to return
     * @param {string} options.level - Filter by level
     * @param {string} options.component - Filter by component
     * @param {Date} options.since - Filter by timestamp (logs after this date)
     * @returns {Array} Filtered logs
     */
    getLogs(options = {}) {
        let filteredLogs = [...this.logs];

        // Filter by level
        if (options.level && options.level !== 'all') {
            filteredLogs = filteredLogs.filter(log => log.level === options.level.toLowerCase());
        }

        // Filter by component
        if (options.component && options.component !== 'all') {
            filteredLogs = filteredLogs.filter(log => log.component === options.component);
        }

        // Filter by timestamp
        if (options.since) {
            const sinceDate = new Date(options.since);
            filteredLogs = filteredLogs.filter(log => new Date(log.timestamp) >= sinceDate);
        }

        // Apply limit
        const limit = options.limit || filteredLogs.length;
        return filteredLogs.slice(0, limit);
    }

    /**
     * Get unique components from logs
     * @returns {Array} List of unique component names
     */
    getComponents() {
        const components = new Set();
        this.logs.forEach(log => {
            if (log.component) {
                components.add(log.component);
            }
        });
        return Array.from(components).sort();
    }

    /**
     * Get log statistics
     * @returns {Object} Statistics about logs
     */
    getStats() {
        const stats = {
            total: this.logs.length,
            maxCapacity: this.maxLogs,
            byLevel: {
                error: 0,
                warn: 0,
                info: 0,
                debug: 0
            },
            byComponent: {},
            oldestLog: this.logs.length > 0 ? this.logs[this.logs.length - 1].timestamp : null,
            newestLog: this.logs.length > 0 ? this.logs[0].timestamp : null
        };

        // Count by level and component
        this.logs.forEach(log => {
            if (stats.byLevel[log.level] !== undefined) {
                stats.byLevel[log.level]++;
            }

            if (log.component) {
                if (!stats.byComponent[log.component]) {
                    stats.byComponent[log.component] = 0;
                }
                stats.byComponent[log.component]++;
            }
        });

        return stats;
    }

    /**
     * Clear all logs
     */
    clear() {
        const count = this.logs.length;
        this.logs = [];
        console.log(`🗑️  Cleared ${count} log entries`);
    }
}

// Export singleton instance
const loggingService = new LoggingService(1000);

module.exports = loggingService;
