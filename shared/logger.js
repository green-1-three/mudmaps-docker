/**
 * Shared Winston Logger Factory
 * Creates Winston logger instances with consistent configuration across all services
 */

const winston = require('winston');
const Transport = require('winston-transport');

/**
 * Custom HTTP Transport for Backend API
 * Sends logs to the centralized logging API endpoint
 */
class BackendHttpTransport extends Transport {
    constructor(opts = {}) {
        super(opts);
        this.backendUrl = opts.backendUrl;
        this.component = opts.component;
        this.batchSize = opts.batchSize || 10;
        this.batchTimeout = opts.batchTimeout || 2000;
        this.logQueue = [];
        this.batchTimer = null;
    }

    log(info, callback) {
        setImmediate(() => {
            this.emit('logged', info);
        });

        // Queue the log
        this.queueLog(info);
        callback();
    }

    queueLog(info) {
        const logEntry = {
            level: info.level,
            message: info.message,
            component: this.component,
            details: info.details || null
        };

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

    sendLog(logEntry) {
        return new Promise((resolve, reject) => {
            if (!this.backendUrl) {
                return resolve(); // Skip if no backend URL
            }

            const http = require('http');
            const https = require('https');
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
                timeout: 5000
            };

            const req = protocol.request(options, (res) => {
                let data = '';
                res.on('data', (chunk) => { data += chunk; });
                res.on('end', () => {
                    if (res.statusCode >= 200 && res.statusCode < 300) {
                        resolve();
                    } else {
                        reject(new Error(`HTTP ${res.statusCode}: ${data}`));
                    }
                });
            });

            req.on('error', (error) => reject(error));
            req.on('timeout', () => {
                req.destroy();
                reject(new Error('Request timeout'));
            });

            req.write(postData);
            req.end();
        });
    }

    async close() {
        await this.flush();
    }
}

/**
 * Create a Winston logger instance
 * @param {string} component - Component name (e.g., 'Worker', 'TCP-Listener', 'Backend')
 * @param {string} backendUrl - Backend URL for remote logging (optional, e.g., 'http://backend:3000/api')
 * @param {Object} options - Additional options
 * @returns {winston.Logger} Configured Winston logger
 */
function createLogger(component, backendUrl = null, options = {}) {
    const transports = [];

    // Console transport (always enabled for Docker logs)
    transports.push(
        new winston.transports.Console({
            format: winston.format.combine(
                winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
                winston.format.printf(({ timestamp, level, message, ...meta }) => {
                    // Format with emojis for readability
                    const emoji = {
                        error: '❌',
                        warn: '⚠️ ',
                        info: 'ℹ️ ',
                        debug: '🐛'
                    }[level] || '📝';

                    const componentStr = component ? `[${component}]` : '';
                    const metaStr = Object.keys(meta).length > 0 && meta.details
                        ? ` ${JSON.stringify(meta.details)}`
                        : '';

                    return `${emoji} ${timestamp} ${componentStr} ${message}${metaStr}`;
                })
            )
        })
    );

    // File transport (persistent local logs)
    if (options.enableFileLogging !== false) {
        transports.push(
            new winston.transports.File({
                filename: options.logFilename || `${component.toLowerCase()}.log`,
                maxsize: options.maxFileSize || 10 * 1024 * 1024, // 10MB default
                maxFiles: options.maxFiles || 5,
                format: winston.format.combine(
                    winston.format.timestamp(),
                    winston.format.json()
                )
            })
        );
    }

    // HTTP transport (send to backend API)
    if (backendUrl) {
        transports.push(
            new BackendHttpTransport({
                backendUrl,
                component,
                batchSize: options.batchSize || 10,
                batchTimeout: options.batchTimeout || 2000
            })
        );
    }

    // Create the logger
    const logger = winston.createLogger({
        level: options.level || 'info',
        transports,
        exitOnError: false
    });

    // Add graceful shutdown method
    logger.shutdown = async function() {
        for (const transport of this.transports) {
            if (transport.close) {
                await transport.close();
            }
        }
    };

    return logger;
}

module.exports = createLogger;
