const net = require('net');
const fs = require('fs');

function decodeCodec8(buffer) {
    let offset = 0;

    // Skip preamble (4 bytes)
    offset += 4;

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
        const priority  = buffer.readUInt8(offset);       offset += 1;
        const lon       = buffer.readInt32BE(offset) / 10 ** 7; offset += 4;
        const lat       = buffer.readInt32BE(offset) / 10 ** 7; offset += 4;
        const altitude  = buffer.readUInt16BE(offset);    offset += 2;
        const angle     = buffer.readUInt16BE(offset);    offset += 2;
        const satellites= buffer.readUInt8(offset);       offset += 1;
        const speed     = buffer.readUInt16BE(offset);    offset += 2;

        const eventIOId = buffer.readUInt8(offset);       offset += 1;
        const totalIO   = buffer.readUInt8(offset);       offset += 1;

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

const PORT = Number(process.env.LISTENER_PORT) || 5500;

const server = net.createServer(socket => {
    console.log(`📡 New connection from ${socket.remoteAddress}:${socket.remotePort}`);

    socket.on('data', buffer => {
        try {
            const records = decodeCodec8(buffer);
            records.forEach(record => {
                const line = JSON.stringify(record);
                console.log('✅ Decoded Record:', line);
                fs.appendFileSync('decoded_records.log', line + '\n');
            });

            // Acknowledge per Teltonika spec (number of records)
            const ack = Buffer.alloc(4);
            ack.writeUInt32BE(records.length);
            socket.write(ack);
        } catch (err) {
            console.error('❌ Decode Error:', err.message);
            fs.appendFileSync('decode_errors.log', err.stack + '\n');
        }
    });

    socket.on('end', () => {
        console.log(`🔌 Connection from ${socket.remoteAddress}:${socket.remotePort} closed`);
    });

    socket.on('error', err => {
        console.error(`❌ Socket error from ${socket.remoteAddress}:${socket.remotePort}:`, err.message);
    });
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Teltonika TCP listener running on 0.0.0.0:${PORT}`);
});
