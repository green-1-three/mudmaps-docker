/**
 * Error Handler Middleware
 * Central error handling for the API
 */

function errorHandler(err, req, res, next) {
    // Log error details
    console.error('Error:', {
        message: err.message,
        stack: err.stack,
        path: req.path,
        method: req.method
    });

    // Database connection errors
    if (err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND') {
        return res.status(503).json({
            error: 'Service Unavailable',
            message: 'Database connection failed'
        });
    }

    // PostgreSQL errors
    if (err.code && err.code.startsWith('23')) {
        return res.status(400).json({
            error: 'Bad Request',
            message: 'Database constraint violation'
        });
    }

    // Default error response
    res.status(err.status || 500).json({
        error: err.name || 'Internal Server Error',
        message: err.message || 'An unexpected error occurred'
    });
}

module.exports = errorHandler;
