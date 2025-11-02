/**
 * Remote Logger Client
 * Sends logs to the backend logging API from worker processes
 */

const http = require('http');
const https = require('https');

class RemoteLogger {
    constructor(backendUrl, component = 'Worker') {
        this.backendUrl = backendUrl;
        this.component = component;
        this.enabled = true;
        this.logQueue = [];
        this.batchSize = 10;
        this.batchTimeout = 2000; // 2 seconds
        this.batchTimer = null;
    }

    /**
     * Send a log to the backend
     * @param {string} level - Log level (error, warn, info, debug)
     * @param {string} message - Log message
     * @param {Object} details - Additional details (optional)
     */
    log(level, message, details = null) {
        // Always log to console first
        const timestamp = new Date().toLocaleString();
        const detailsStr = details ? ` ${JSON.stringify(details)}` : '';

        switch (level.toLowerCase()) {
            case 'error':
                console.error(`❌ ${timestamp} [${this.component}] ${message}${detailsStr}`);
                break;
            case 'warn':
                console.warn(`⚠️  ${timestamp} [${this.component}] ${message}${detailsStr}`);
                break;
            case 'info':
                console.info(`ℹ️  ${timestamp} [${this.component}] ${message}${detailsStr}`);
                break;
            case 'debug':
                console.log(`🐛 ${timestamp} [${this.component}] ${message}${detailsStr}`);
                break;
            default:
                console.log(`📝 ${timestamp} [${this.component}] ${message}${detailsStr}`);
        }

        // Send to backend if enabled
        if (!this.enabled || !this.backendUrl) return;

        // Queue the log
        this.queueLog({
            level: level.toLowerCase(),
            message,
            component: this.component,
            details
        });
    }

    /**
     * Log an error
     */
    error(message, details = null) {
        this.log('error', message, details);
    }

    /**
     * Log a warning
     */
    warn(message, details = null) {
        this.log('warn', message, details);
    }

    /**
     * Log an info message
     */
    info(message, details = null) {
        this.log('info', message, details);
    }

    /**
     * Log a debug message
     */
    debug(message, details = null) {
        this.log('debug', message, details);
    }

    /**
     * Queue log for batch sending
     */
    queueLog(logEntry) {
        this.logQueue.push(logEntry);

        // Send immediately if queue is full
        if (this.logQueue.length >= this.batchSize) {
            this.flush();
        } else {
            // Schedule batch send
            if (!this.batchTimer) {
                this.batchTimer = setTimeout(() => {
                    this.flush();
                }, this.batchTimeout);
            }
        }
    }

    /**
     * Flush queued logs to backend
     */
    async flush() {
        // Clear timer
        if (this.batchTimer) {
            clearTimeout(this.batchTimer);
            this.batchTimer = null;
        }

        // Nothing to send
        if (this.logQueue.length === 0) return;

        // Get logs to send
        const logsToSend = [...this.logQueue];
        this.logQueue = [];

        // Send each log (API expects one at a time)
        for (const log of logsToSend) {
            try {
                await this.sendLog(log);
            } catch (error) {
                // Silently fail - don't want to create infinite loop
                // Only log to console if it's a critical error
                if (error.code !== 'ECONNREFUSED' && error.code !== 'ETIMEDOUT') {
                    console.error(`Failed to send log to backend: ${error.message}`);
                }
            }
        }
    }

    /**
     * Send a single log to the backend
     */
    sendLog(logEntry) {
        return new Promise((resolve, reject) => {
            const url = new URL(`${this.backendUrl}/logs`);
            const protocol = url.protocol === 'https:' ? https : http;

            const postData = JSON.stringify(logEntry);

            const options = {
                hostname: url.hostname,
                port: url.port || (url.protocol === 'https:' ? 443 : 80),
                path: url.pathname,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(postData)
                },
                timeout: 5000 // 5 second timeout
            };

            const req = protocol.request(options, (res) => {
                let data = '';

                res.on('data', (chunk) => {
                    data += chunk;
                });

                res.on('end', () => {
                    if (res.statusCode >= 200 && res.statusCode < 300) {
                        resolve();
                    } else {
                        reject(new Error(`HTTP ${res.statusCode}: ${data}`));
                    }
                });
            });

            req.on('error', (error) => {
                reject(error);
            });

            req.on('timeout', () => {
                req.destroy();
                reject(new Error('Request timeout'));
            });

            req.write(postData);
            req.end();
        });
    }

    /**
     * Enable remote logging
     */
    enable() {
        this.enabled = true;
    }

    /**
     * Disable remote logging (only console logs)
     */
    disable() {
        this.enabled = false;
    }

    /**
     * Graceful shutdown - flush remaining logs
     */
    async shutdown() {
        await this.flush();
    }
}

module.exports = RemoteLogger;
