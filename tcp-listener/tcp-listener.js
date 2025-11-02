const net = require('net');
const fs = require('fs');
const { Pool } = require('pg');
const { createClient } = require('redis');
const RemoteLogger = require('../shared/remote-logger');
require('dotenv').config();

// Config
const PORT = process.env.LISTENER_PORT || 5500;
const REDIS_URL = process.env.REDIS_URL || 'redis://redis:6379';
const BACKEND_URL = process.env.BACKEND_URL || 'http://backend:3000/api';
const logDecoded = (msg) => fs.appendFileSync('decoded_records.log', msg + '\n');
const logError = (msg) => fs.appendFileSync('decode_errors.log', msg + '\n');

// Initialize remote logger
const logger = new RemoteLogger(BACKEND_URL, 'TCP-Listener');

// Helper functions for logging with timestamp
function timestamp() {
    return new Date().toISOString();
}

function log(message) {
    logger.info(message);
}

// Postgres connection
const pool = new Pool({
    user: process.env.PGUSER || 'mudmaps',           // Changed from POSTGRES_USER
    host: process.env.PGHOST || 'postgres',
    database: process.env.PGDATABASE || 'mudmapsdb', // Changed from POSTGRES_DB
    password: process.env.PGPASSWORD || 'mudmaps',   // Changed from POSTGRES_PASSWORD
    port: Number(process.env.PGPORT) || 5432,        // Changed from POSTGRES_PORT
});

// Handle pool errors to prevent crashes
pool.on('error', (err) => {
    logger.error('PostgreSQL pool error', { error: err.message, stack: err.stack });
    logError(`PostgreSQL pool error: ${err.stack}`);
    // Pool will automatically try to reconnect
});

// Redis connection
const redis = createClient({ url: REDIS_URL });
redis.on('error', (err) => logger.error('Redis error', { error: err.message }));
redis.connect().then(() => {
    logger.info('Connected to Redis');
}).catch(err => {
    logger.error('Failed to connect to Redis', { error: err.message });
});

// Codec 8 decoder
function decodeCodec8(buffer) {
    let offset = 0;
    offset += 4; // Preamble

    const dataLength = buffer.readUInt32BE(offset);
    offset += 4;

    const codecId = buffer.readUInt8(offset);
    offset += 1;

    const recordCount = buffer.readUInt8(offset);
    offset += 1;

    if (codecId !== 0x08) {
        throw new Error(`Unsupported codec: ${codecId}`);
    }

    const records = [];

    for (let i = 0; i < recordCount; i++) {
        const timestamp = buffer.readBigUInt64BE(offset); offset += 8;
        const priority = buffer.readUInt8(offset); offset += 1;
        const lon = buffer.readInt32BE(offset) / 1e7; offset += 4;
        const lat = buffer.readInt32BE(offset) / 1e7; offset += 4;
        const altitude = buffer.readUInt16BE(offset); offset += 2;
        const angle = buffer.readUInt16BE(offset); offset += 2;
        const satellites = buffer.readUInt8(offset); offset += 1;
        const speed = buffer.readUInt16BE(offset); offset += 2;
        const eventIOId = buffer.readUInt8(offset); offset += 1;
        const totalIO = buffer.readUInt8(offset); offset += 1;

        const io = {};
        for (let size of [1, 2, 4, 8]) {
            const count = buffer.readUInt8(offset); offset += 1;
            for (let j = 0; j < count; j++) {
                const id = buffer.readUInt8(offset); offset += 1;
                let value;
                if (size === 1) value = buffer.readUInt8(offset);
                else if (size === 2) value = buffer.readUInt16BE(offset);
                else if (size === 4) value = buffer.readUInt32BE(offset);
                else if (size === 8) value = buffer.readBigUInt64BE(offset);
                offset += size;
                io[id] = value;
            }
        }

        records.push({
            timestamp: new Date(Number(timestamp)),
            priority, lat, lon, altitude, angle, satellites, speed, eventIOId, io
        });
    }

    return records;
}

// TCP Server
const server = net.createServer((socket) => {
    log(`📡 New connection from ${socket.remoteAddress}:${socket.remotePort}`);

    let imei = null;
    let buffer = Buffer.alloc(0);

    socket.on('data', async (data) => {
        buffer = Buffer.concat([buffer, data]);

        // Step 1: IMEI handshake
        if (!imei && buffer.length >= 2) {
            const imeiLength = buffer.readUInt16BE(0);
            if (buffer.length >= imeiLength + 2) {
                imei = buffer.slice(2, imeiLength + 2).toString();
                log(`📍 IMEI received: ${imei}`);
                socket.write(Buffer.from([0x01])); // ACK
                buffer = buffer.slice(imeiLength + 2);
            } else {
                return; // Wait for more data
            }
        }

        // Step 2: AVL data
        while (buffer.length >= 8) {
            const avlLen = buffer.readUInt32BE(4); // read after preamble
            const totalPacketLen = 4 + 4 + avlLen + 4; // preamble + length + payload + CRC

            if (buffer.length < totalPacketLen) return; // Wait for full frame

            const avlPacket = buffer.slice(0, totalPacketLen);
            buffer = buffer.slice(totalPacketLen);

            try {
                const records = decodeCodec8(avlPacket);
                for (const record of records) {
                    const line = JSON.stringify({ imei, ...record });
                    log(`✅ Decoded Record: ${line}`);
                    logDecoded(line);

                    // Insert into DB
                    try {
                        await pool.query(
                            'INSERT INTO gps_raw_data (device_id, longitude, latitude, recorded_at, received_at, processed) VALUES ($1, $2, $3, $4, NOW(), FALSE)',
                            [imei, record.lon, record.lat, record.timestamp]
                        );
                        
                        // Check if device has accumulated enough points to process
                        const countResult = await pool.query(
                            'SELECT COUNT(*) as count FROM gps_raw_data WHERE device_id = $1 AND processed = FALSE',
                            [imei]
                        );
                        
                        const unprocessedCount = parseInt(countResult.rows[0].count);
                        
                        // Only queue if we have 4+ unprocessed points AND device isn't already queued
                        if (unprocessedCount >= 4) {
                            try {
                                // Use Redis SET to prevent duplicate queueing
                                const added = await redis.sAdd('gps:devices_queued', imei);
                                if (added) {
                                    await redis.lPush('gps:queue', imei);
                                    log(`📤 Queued ${imei} for processing (${unprocessedCount} points)`);
                                } else {
                                    log(`⏭️  ${imei} already queued (${unprocessedCount} points)`);
                                }
                            } catch (redisErr) {
                                logError(`Redis publish error for ${imei}: ${redisErr.message}`);
                            }
                        }
                    } catch (dbErr) {
                        logError(`DB insert error for ${imei}: ${dbErr.message}`);
                    }
                }
            } catch (err) {
                log(`❌ Decode Error: ${err.message}`);
                logError(`Decode error for ${imei}: ${err.stack}`);
            }
        }
    });

    socket.on('end', () => {
        log(`🔌 Connection from ${socket.remoteAddress}:${socket.remotePort} closed`);
    });

    socket.on('error', (err) => {
        log(`❌ Socket error from ${socket.remoteAddress}:${socket.remotePort}: ${err.message}`);
    });
});

server.listen(PORT, '0.0.0.0', () => {
    log(`🚀 Teltonika TCP listener running on 0.0.0.0:${PORT}`);
});

// Graceful shutdown
async function shutdown(signal) {
    logger.warn(`Received ${signal}, shutting down gracefully`);

    // Close server
    server.close(() => {
        logger.info('TCP server closed');
    });

    // Close connections
    await redis.disconnect();
    await pool.end();

    // Flush remaining logs
    await logger.shutdown();

    process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
