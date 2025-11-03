/**
 * GPS Processor
 * Main processing logic for GPS data
 */

const BatchProcessor = require('./batch-processor');
const OSRMService = require('./osrm.service');
const SegmentActivationService = require('./segment-activation.service');
const { calculateDistance } = require('../utils/geo-calculations');

class GPSProcessor {
    constructor(databaseService, config) {
        this.db = databaseService;
        this.config = config;
        this.batchProcessor = new BatchProcessor(config.processing);
        this.osrm = new OSRMService(config.osrm.baseUrl);
        this.segmentActivator = new SegmentActivationService();
        this.logger = null; // Will be set by Worker
    }

    /**
     * Set the logger instance
     * @param {Object} logger - Remote logger instance
     */
    setLogger(logger) {
        this.logger = logger;
        // Pass logger to segment activator as well
        if (this.segmentActivator) {
            this.segmentActivator.setLogger(logger);
        }
    }

    /**
     * Process GPS data for a device
     * @param {string} deviceId - Device ID to process
     * @returns {Promise<void>}
     */
    async processDevice(deviceId) {
        const client = await this.db.getClient();

        try {
            await this.processDeviceData(client, deviceId);
        } catch (error) {
            if (this.logger) {
                this.logger.error(`Error processing device ${deviceId}`, { error: error.message, stack: error.stack });
            } else {
                console.error(`❌ Error processing device ${deviceId}:`, error);
            }
        } finally {
            client.release();
        }
    }

    /**
     * Process data for a single device
     * @param {Object} client - Database client
     * @param {string} deviceId - Device ID
     * @returns {Promise<void>}
     */
    async processDeviceData(client, deviceId) {
        if (this.logger) {
            this.logger.info(`📍 Processing device: ${deviceId}`);
        }
        
        // Get the last processed point for seamless connection
        const lastProcessed = await this.db.getLastProcessedPoint(deviceId);
        
        // Get unprocessed GPS points
        const unprocessedPoints = await this.db.getUnprocessedPoints(deviceId);
        
        // Combine points for processing
        let allPoints = [];
        if (lastProcessed && unprocessedPoints.length > 0) {
            const lastProcessedTime = new Date(lastProcessed.recorded_at);
            const firstUnprocessedTime = new Date(unprocessedPoints[0].recorded_at);
            
            if (this.batchProcessor.shouldConnectPoints(lastProcessedTime, firstUnprocessedTime)) {
                allPoints.push(lastProcessed);
                const gapMinutes = (firstUnprocessedTime - lastProcessedTime) / 1000 / 60;
                if (this.logger) {
                    this.logger.info(`   🔗 Including last processed point for seamless connection (gap: ${gapMinutes.toFixed(1)}min)`);
                }
            } else {
                const gapMinutes = (firstUnprocessedTime - lastProcessedTime) / 1000 / 60;
                if (this.logger) {
                    this.logger.warn(`   ⚠️  Skipping last processed point - gap too large (${gapMinutes.toFixed(1)} minutes)`);
                }
            }
        }
        allPoints = allPoints.concat(unprocessedPoints);
        
        if (allPoints.length < 2) {
            if (this.logger) {
                this.logger.warn(`   ⚠️  Not enough points (need at least 2, have ${allPoints.length})`);
            }
            return;
        }

        if (this.logger) {
            this.logger.info(`   📊 Found ${unprocessedPoints.length} unprocessed GPS points (${allPoints.length} total with overlap)`);
        }

        // Group points into time windows
        const batches = this.batchProcessor.groupIntoTimeWindows(allPoints);
        if (this.logger) {
            this.logger.info(`   📦 Grouped into ${batches.length} time window(s)`);
        }
        
        for (const batch of batches) {
            // Only mark the NEW points as processed
            const newPointsInBatch = batch.filter(p => 
                !lastProcessed || p.id !== lastProcessed.id
            );
            await this.processBatch(client, deviceId, batch, newPointsInBatch);
        }
    }

    /**
     * Process a single batch of GPS points
     * @param {Object} client - Database client
     * @param {string} deviceId - Device ID
     * @param {Array} batch - Batch of GPS points
     * @param {Array} newPointsInBatch - New points in the batch
     * @returns {Promise<void>}
     */
    async processBatch(client, deviceId, batch, newPointsInBatch) {
        // Sort batch by recorded_at
        batch.sort((a, b) => new Date(a.recorded_at) - new Date(b.recorded_at));
        
        const batchId = this.batchProcessor.generateBatchId();
        const startTime = batch[0].recorded_at;
        const endTime = batch[batch.length - 1].recorded_at;
        const pointIds = newPointsInBatch.map(p => p.id);

        if (this.logger) {
            this.logger.info(`   🔄 Processing batch: ${batch.length} points (${newPointsInBatch.length} new) from ${startTime} to ${endTime}`);
        }
        
        // Check if batch has significant movement
        if (!this.batchProcessor.shouldProcessBatch(batch)) {
            const distance = calculateDistance(
                batch[0].latitude, batch[0].longitude,
                batch[batch.length - 1].latitude, batch[batch.length - 1].longitude
            );
            if (this.logger) {
                this.logger.info(`   ⏭️  Skipping stationary batch (movement: ${distance.toFixed(1)}m < ${this.config.processing.minMovementMeters}m)`);
            }
            
            // Still mark points as processed
            await this.db.markPointsAsProcessed(pointIds, batchId);
            return;
        }
        
        // Log processing start
        await this.db.logProcessing({
            batchId,
            deviceId,
            startTime,
            endTime,
            coordinateCount: newPointsInBatch.length,
            status: 'processing'
        });
        
        try {
            // Call OSRM to match route
            const osrmStart = Date.now();
            const coordinates = batch.map(p => [p.longitude, p.latitude]);
            const matchedRoute = await this.osrm.matchRoute(coordinates);
            const osrmDuration = Date.now() - osrmStart;
            
            if (!matchedRoute) {
                throw new Error('OSRM returned no matched route');
            }
            
            // Process the matched route
            const polylineData = this.batchProcessor.processMatchedRoute(matchedRoute);
            if (!polylineData) {
                throw new Error('Failed to process matched route');
            }
            
            // Save polyline
            const polylineId = await this.db.savePolyline({
                deviceId,
                startTime,
                endTime,
                encodedPolyline: polylineData.encodedPolyline,
                wkt: polylineData.wkt,
                bearing: polylineData.bearing,
                confidence: polylineData.confidence,
                pointCount: newPointsInBatch.length,
                batchId,
                osrmDuration
            });
            
            // Activate road segments
            await this.segmentActivator.activateSegments(
                client, 
                polylineId, 
                deviceId, 
                polylineData.wkt, 
                polylineData.bearing, 
                endTime
            );
            
            // Mark points as processed
            await this.db.markPointsAsProcessed(pointIds, batchId);
            
            // Update processing log - success
            await this.db.logProcessing({
                batchId,
                deviceId,
                startTime,
                endTime,
                coordinateCount: newPointsInBatch.length,
                status: 'completed',
                osrmCalls: 1,
                osrmSuccessRate: 1.0
            });
            
            if (this.logger) {
                this.logger.info(`   ✅ Batch processed successfully (${osrmDuration}ms, bearing: ${polylineData.bearing ? polylineData.bearing.toFixed(1) : 'N/A'}°)`);
            }
            
        } catch (error) {
            if (this.logger) {
                this.logger.error(`   ❌ Error processing batch: ${error.message}`);
            }

            // Check failure count
            const failureCount = await this.db.getFailureCount(deviceId, startTime, endTime) + 1;
            if (this.logger) {
                this.logger.info(`   📊 Batch failure count: ${failureCount}`);
            }

            // After max retries, mark points as processed
            if (failureCount >= this.config.processing.maxRetries && pointIds.length > 0) {
                if (this.logger) {
                    this.logger.warn(`   🗑️  Permanently abandoning ${pointIds.length} points after ${failureCount} failures`);
                }
                await this.db.markPointsAsProcessed(pointIds, batchId);
            }
            
            // Update processing log - failure
            await this.db.logProcessing({
                batchId,
                deviceId,
                startTime,
                endTime,
                coordinateCount: newPointsInBatch.length,
                status: 'failed',
                errorMessage: error.message,
                errorCode: error.code || 'UNKNOWN'
            });
        }
    }
}

module.exports = GPSProcessor;
