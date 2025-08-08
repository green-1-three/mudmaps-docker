const net = require('net');
const fs = require('fs');

// TCP listener port from env or default
const PORT = process.env.LISTENER_PORT || 5500;

// Helper to log decoded records and errors
const logDecoded = (msg) => fs.appendFileSync('decoded_records.log', msg + '\n');
const logError = (msg) => fs.appendFileSync('decode_errors.log', msg + '\n');

const server = net.createServer((socket) => {
    console.log('📡 Incoming TCP connection from', socket.remoteAddress);

    let imei = null;
    let buffer = Buffer.alloc(0);

    socket.on('data', (data) => {
        buffer = Buffer.concat([buffer, data]);

        // If IMEI not set, first packet is IMEI handshake
        if (!imei && buffer.length >= 2) {
            const imeiLength = buffer.readUInt16BE(0);
            if (buffer.length >= imeiLength + 2) {
                imei = buffer.slice(2, imeiLength + 2).toString();
                console.log('📍 IMEI received:', imei);

                // Send confirmation: 0x01 for Teltonika
                socket.write(Buffer.from([0x01]));
                buffer = buffer.slice(imeiLength + 2);
            } else {
                return; // wait for full IMEI packet
            }
        }

        // Now handle AVL data packets
        while (buffer.length >= 4) {
            const avlLen = buffer.readUInt32BE(0);
            if (buffer.length < avlLen + 8) {
                return; // wait for more data
            }

            const avlData = buffer.slice(4, 4 + avlLen);
            buffer = buffer.slice(4 + avlLen + 4); // Skip CRC too

            try {
                // For now, just log the raw length and hex preview
                logDecoded(`IMEI: ${imei}, AVL length: ${avlLen}, Raw hex: ${avlData.toString('hex').slice(0, 50)}...`);
                console.log(`✅ Decoded AVL from ${imei} — length ${avlLen}`);
            } catch (err) {
                logError(`Error decoding from ${imei}: ${err.message}`);
                console.error(`❌ Error decoding from ${imei}:`, err);
            }
        }
    });

    socket.on('error', (err) => {
        console.error('Socket error:', err);
    });

    socket.on('close', () => {
        console.log(`🔌 Connection closed for ${imei || socket.remoteAddress}`);
    });
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Teltonika TCP listener running on 0.0.0.0:${PORT}`);
});
