/**
 * Frontend Logger
 * Captures frontend console logs and sends them to the backend logging service
 */

// Store original console methods
const originalConsole = {
    log: console.log,
    error: console.error,
    warn: console.warn,
    info: console.info,
    debug: console.debug
};

// Configuration
let loggerConfig = {
    apiBase: '',
    enabled: true,
    batchSize: 10,
    batchTimeout: 2000, // 2 seconds
    logQueue: [],
    batchTimer: null
};

/**
 * Initialize the frontend logger
 * @param {string} apiBase - The API base URL
 */
export function initFrontendLogger(apiBase) {
    loggerConfig.apiBase = apiBase;

    // Intercept console methods
    console.log = createInterceptor('info', originalConsole.log);
    console.info = createInterceptor('info', originalConsole.info);
    console.warn = createInterceptor('warn', originalConsole.warn);
    console.error = createInterceptor('error', originalConsole.error);
    console.debug = createInterceptor('debug', originalConsole.debug);

    // Log initialization
    originalConsole.info('🎯 Frontend logger initialized - console logs will be sent to backend');

    return {
        enable: () => { loggerConfig.enabled = true; },
        disable: () => { loggerConfig.enabled = false; },
        flush: () => flushLogs()
    };
}

/**
 * Create an interceptor for a console method
 * @param {string} level - Log level
 * @param {Function} originalMethod - Original console method
 * @returns {Function} Intercepted method
 */
function createInterceptor(level, originalMethod) {
    return function(...args) {
        // Call original console method first
        originalMethod.apply(console, args);

        // Don't send to backend if disabled
        if (!loggerConfig.enabled) return;

        // Format the message
        const message = args.map(arg => {
            if (typeof arg === 'object') {
                try {
                    return JSON.stringify(arg);
                } catch (e) {
                    return String(arg);
                }
            }
            return String(arg);
        }).join(' ');

        // Extract details if first arg is an object
        let details = null;
        if (args.length > 0 && typeof args[0] === 'object' && args[0] !== null) {
            try {
                details = JSON.parse(JSON.stringify(args[0])); // Deep clone
            } catch (e) {
                // Ignore if can't clone
            }
        }

        // Add to queue
        queueLog({
            level,
            message,
            component: 'Frontend',
            details
        });
    };
}

/**
 * Add log to queue and schedule batch send
 * @param {Object} logEntry - Log entry to queue
 */
function queueLog(logEntry) {
    loggerConfig.logQueue.push(logEntry);

    // Send immediately if queue is full
    if (loggerConfig.logQueue.length >= loggerConfig.batchSize) {
        flushLogs();
    } else {
        // Schedule batch send
        if (!loggerConfig.batchTimer) {
            loggerConfig.batchTimer = setTimeout(() => {
                flushLogs();
            }, loggerConfig.batchTimeout);
        }
    }
}

/**
 * Flush queued logs to backend
 */
async function flushLogs() {
    // Clear timer
    if (loggerConfig.batchTimer) {
        clearTimeout(loggerConfig.batchTimer);
        loggerConfig.batchTimer = null;
    }

    // Nothing to send
    if (loggerConfig.logQueue.length === 0) return;

    // Get logs to send
    const logsToSend = [...loggerConfig.logQueue];
    loggerConfig.logQueue = [];

    // Send logs to backend (one at a time to match API)
    for (const log of logsToSend) {
        try {
            await fetch(`${loggerConfig.apiBase}/logs`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(log)
            });
        } catch (error) {
            // Silently fail - don't want to create infinite loop of errors
            // Use original console to log the issue
            originalConsole.error('Failed to send log to backend:', error);
        }
    }
}

/**
 * Restore original console methods (for cleanup)
 */
export function restoreConsole() {
    console.log = originalConsole.log;
    console.error = originalConsole.error;
    console.warn = originalConsole.warn;
    console.info = originalConsole.info;
    console.debug = originalConsole.debug;

    originalConsole.info('Frontend logger disabled - console methods restored');
}

/**
 * Get access to original console methods
 */
export function getOriginalConsole() {
    return originalConsole;
}
