const net = require('net');
const fs = require('fs');
const { Pool } = require('pg');
require('dotenv').config();

// Config
const PORT = process.env.LISTENER_PORT || 5500;
const logDecoded = (msg) => fs.appendFileSync('decoded_records.log', msg + '\n');
const logError = (msg) => fs.appendFileSync('decode_errors.log', msg + '\n');

// Postgres connection
const pool = new Pool({
    user: process.env.POSTGRES_USER || 'mudmaps',
    host: process.env.PGHOST || 'postgres',
    database: process.env.POSTGRES_DB || 'mudmapsdb',
    password: process.env.POSTGRES_PASSWORD || 'mudmaps',
    port: Number(process.env.POSTGRES_PORT) || 5432,
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
    console.log(`📡 New connection from ${socket.remoteAddress}:${socket.remotePort}`);

    let imei = null;
    let buffer = Buffer.alloc(0);

    socket.on('data', async (data) => {
        buffer = Buffer.concat([buffer, data]);

        // Step 1: IMEI handshake
        if (!imei && buffer.length >= 2) {
            const imeiLength = buffer.readUInt16BE(0);
            if (buffer.length >= imeiLength + 2) {
                imei = buffer.slice(2, imeiLength + 2).toString();
                console.log('📍 IMEI received:', imei);
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
                    console.log('✅ Decoded Record:', line);
                    logDecoded(line);

                    // Insert into DB
                    try {
                        await pool.query(
                            'INSERT INTO markers (username, coords) VALUES ($1, $2)',
                            [imei, [record.lon, record.lat]]
                        );
                    } catch (dbErr) {
                        logError(`DB insert error for ${imei}: ${dbErr.message}`);
                    }
                }
            } catch (err) {
                console.error('❌ Decode Error:', err.message);
                logError(`Decode error for ${imei}: ${err.stack}`);
            }
        }
    });

    socket.on('end', () => {
        console.log(`🔌 Connection from ${socket.remoteAddress}:${socket.remotePort} closed`);
    });

    socket.on('error', (err) => {
        console.error(`❌ Socket error from ${socket.remoteAddress}:${socket.remotePort}:`, err.message);
    });
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Teltonika TCP listener running on 0.0.0.0:${PORT}`);
});
