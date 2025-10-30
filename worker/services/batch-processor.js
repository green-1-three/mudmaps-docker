/**
 * GPS Batch Processing Service
 * Handles grouping and processing of GPS points into batches
 */

const polyline = require('@mapbox/polyline');
const { calculateBearing, coordinatesToWKT, hasSignificantMovement } = require('../utils/geo-calculations');

class BatchProcessor {
    constructor(config = {}) {
        this.batchSize = config.batchSize || 4;
        this.timeWindowMinutes = config.timeWindowMinutes || 2;
        this.minMovementMeters = config.minMovementMeters || 50;
    }

    /**
     * Group GPS points into time-based batches
     * @param {Array<Object>} points - Array of GPS points with recorded_at timestamps
     * @returns {Array<Array<Object>>} Array of batches
     */
    groupIntoTimeWindows(points) {
        if (points.length === 0) return [];
        
        const batches = [];
        let currentBatch = [points[0]];
        
        for (let i = 1; i < points.length; i++) {
            const prevTime = new Date(currentBatch[currentBatch.length - 1].recorded_at);
            const currTime = new Date(points[i].recorded_at);
            const diffMinutes = (currTime - prevTime) / 1000 / 60;
            
            if (diffMinutes <= this.timeWindowMinutes && currentBatch.length < this.batchSize) {
                currentBatch.push(points[i]);
            } else {
                if (currentBatch.length >= 2) {
                    batches.push(currentBatch);
                }
                // Start new batch with the last point from previous batch for continuity
                currentBatch = [currentBatch[currentBatch.length - 1], points[i]];
            }
        }
        
        // Add final batch if it has enough points
        if (currentBatch.length >= 2) {
            batches.push(currentBatch);
        }
        
        return batches;
    }

    /**
     * Process a matched route into a polyline format
     * @param {Object} matchedRoute - Route from OSRM with coordinates and confidence
     * @returns {Object} Processed polyline data
     */
    processMatchedRoute(matchedRoute) {
        if (!matchedRoute || !matchedRoute.coordinates || matchedRoute.coordinates.length < 2) {
            return null;
        }

        // Encode the polyline
        const encodedPolyline = polyline.encode(matchedRoute.coordinates);
        
        // Convert to WKT for PostGIS
        const wkt = coordinatesToWKT(matchedRoute.coordinates);
        
        // Calculate bearing
        const firstCoord = matchedRoute.coordinates[0];
        const lastCoord = matchedRoute.coordinates[matchedRoute.coordinates.length - 1];
        const bearing = calculateBearing(
            firstCoord[0], firstCoord[1],
            lastCoord[0], lastCoord[1]
        );

        return {
            encodedPolyline,
            wkt,
            bearing,
            confidence: matchedRoute.confidence
        };
    }

    /**
     * Check if batch should be processed based on movement
     * @param {Array<Object>} batch - GPS points
     * @returns {boolean} True if batch should be processed
     */
    shouldProcessBatch(batch) {
        return hasSignificantMovement(batch, this.minMovementMeters);
    }

    /**
     * Generate a UUID for batch tracking
     * @returns {string} UUID
     */
    generateBatchId() {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
            const r = Math.random() * 16 | 0;
            const v = c === 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    }

    /**
     * Check if a gap between points is small enough to connect them
     * @param {Date} lastTime - Last processed time
     * @param {Date} firstTime - First unprocessed time
     * @param {number} maxGapMinutes - Maximum gap in minutes (default 5)
     * @returns {boolean} True if points should be connected
     */
    shouldConnectPoints(lastTime, firstTime, maxGapMinutes = 5) {
        const gapMinutes = (firstTime - lastTime) / 1000 / 60;
        return gapMinutes <= maxGapMinutes;
    }
}

module.exports = BatchProcessor;
