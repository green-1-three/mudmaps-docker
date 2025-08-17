const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');

const app = express();

const PORT = process.env.PORT || 3000;
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';
const OSRM_BASE = process.env.OSRM_BASE || 'http://router.project-osrm.org'; // Public OSRM for testing

app.use(cors({ origin: CORS_ORIGIN, credentials: false }));
app.use(express.json());

const pool = new Pool({
    host: process.env.PGHOST || 'postgres',
    port: Number(process.env.PGPORT || 5432),
    database: process.env.PGDATABASE,
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD,
    max: 10
});

// Utility function to call OSRM
async function callOSRM(coordinates) {
    try {
        const coordString = coordinates.map(([lon, lat]) => `${lon},${lat}`).join(';');
        const url = `${OSRM_BASE}/match/v1/driving/${coordString}?geometries=polyline&overview=full`;

        console.log(`Calling OSRM: ${url.substring(0, 100)}...`);

        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`OSRM returned ${response.status}`);
        }

        const data = await response.json();

        if (data.matchings && data.matchings.length > 0) {
            return {
                success: true,
                encoded_polyline: data.matchings[0].geometry,
                confidence: data.matchings[0].confidence || 1.0
            };
        } else {
            return { success: false, error: 'No matching found' };
        }
    } catch (error) {
        console.error('OSRM error:', error.message);
        return { success: false, error: error.message };
    }
}

// Function to group markers by device and create minute markers
function createPathWithMinuteMarkers(markers) {
    if (markers.length < 2) return null;

    // Sort by timestamp
    const sortedMarkers = markers.sort((a, b) =>
        new Date(a.created_at || a.timestamp) - new Date(b.created_at || b.timestamp)
    );

    const coordinates = [];
    const minuteMarkers = [];
    let lastMarkerMinute = null;

    sortedMarkers.forEach((marker, index) => {
        if (!marker.coords || marker.coords.length !== 2) return;

        coordinates.push(marker.coords);

        // Create minute marker if we've crossed into a new minute
        const timestamp = new Date(marker.created_at || marker.timestamp);
        const currentMinute = Math.floor(timestamp.getTime() / 60000);

        if (currentMinute !== lastMarkerMinute) {
            minuteMarkers.push({
                coord_index: coordinates.length - 1,
                timestamp: timestamp.toISOString()
            });
            lastMarkerMinute = currentMinute;
        }
    });

    return {
        coordinates,
        minute_markers: minuteMarkers,
        start_time: sortedMarkers[0].created_at || sortedMarkers[0].timestamp,
        end_time: sortedMarkers[sortedMarkers.length - 1].created_at || sortedMarkers[sortedMarkers.length - 1].timestamp
    };
}

// Your existing endpoints (unchanged)
app.get('/markers', async (_req, res) => {
    try {
        const { rows } = await pool.query('SELECT username, coords FROM markers');
        res.json(rows);
    } catch (e) {
        console.error('GET /markers error:', e);
        res.status(500).json({ error: 'db_error' });
    }
});

app.get('/polylines', async (_req, res) => {
    try {
        const { rows } = await pool.query('SELECT username, coords FROM polylines');
        res.json(rows);
    } catch (e) {
        console.error('GET /polylines error:', e);
        res.status(500).json({ error: 'db_error' });
    }
});

// NEW: Enhanced markers endpoint with temporal filtering
app.get('/markers/enhanced', async (req, res) => {
    try {
        const {
            limit = 1000,
            offset = 0,
            username,
            since,
            hours = 24  // Default to last 24 hours
        } = req.query;

        let query = 'SELECT username, coords, created_at FROM markers';
        let conditions = [];
        let params = [];
        let paramCount = 0;

        // Add time filter (default to last 24 hours)
        const timeFilter = since ? new Date(since) : new Date(Date.now() - hours * 60 * 60 * 1000);
        conditions.push(`created_at > $${++paramCount}`);
        params.push(timeFilter);

        if (username) {
            conditions.push(`username = $${++paramCount}`);
            params.push(username);
        }

        if (conditions.length > 0) {
            query += ' WHERE ' + conditions.join(' AND ');
        }

        query += ` ORDER BY created_at ASC LIMIT $${++paramCount} OFFSET $${++paramCount}`;
        params.push(parseInt(limit), parseInt(offset));

        const { rows } = await pool.query(query, params);

        console.log(`Enhanced markers query returned ${rows.length} rows`);
        res.json(rows);
    } catch (e) {
        console.error('GET /markers/enhanced error:', e);
        res.status(500).json({ error: 'db_error', message: e.message });
    }
});

// NEW: Generate encoded paths from markers
app.get('/paths/encoded', async (req, res) => {
    try {
        const { username, hours = 24 } = req.query;

        console.log(`Generating encoded path for username: ${username || 'all'}, hours: ${hours}`);

        // Get markers for the specified time period
        let query = 'SELECT username, coords, created_at FROM markers WHERE created_at > $1';
        let params = [new Date(Date.now() - hours * 60 * 60 * 1000)];

        if (username) {
            query += ' AND username = $2 ORDER BY created_at ASC';
            params.push(username);
        } else {
            query += ' ORDER BY created_at ASC';
        }

        const { rows } = await pool.query(query, params);
        console.log(`Found ${rows.length} markers for path generation`);

        if (rows.length === 0) {
            return res.json({ devices: [] });
        }

        // Group by device/username
        const deviceGroups = {};
        rows.forEach(row => {
            const device = row.username;
            if (!deviceGroups[device]) {
                deviceGroups[device] = [];
            }
            deviceGroups[device].push(row);
        });

        const results = [];

        for (const [device, markers] of Object.entries(deviceGroups)) {
            console.log(`Processing ${markers.length} markers for device: ${device}`);

            const pathData = createPathWithMinuteMarkers(markers);
            if (!pathData) {
                console.log(`Skipping device ${device} - insufficient data`);
                continue;
            }

            // Try to get OSRM encoded polyline
            const osrmResult = await callOSRM(pathData.coordinates);

            const deviceResult = {
                device: device,
                start_time: pathData.start_time,
                end_time: pathData.end_time,
                minute_markers: pathData.minute_markers,
                coordinate_count: pathData.coordinates.length
            };

            if (osrmResult.success) {
                deviceResult.encoded_path = osrmResult.encoded_polyline;
                deviceResult.osrm_confidence = osrmResult.confidence;
                console.log(`✅ OSRM success for ${device}: ${osrmResult.encoded_polyline.length} chars`);
            } else {
                // Fallback: encode the raw coordinates ourselves (simplified)
                deviceResult.raw_coordinates = pathData.coordinates;
                deviceResult.osrm_error = osrmResult.error;
                console.log(`❌ OSRM failed for ${device}: ${osrmResult.error}`);
            }

            results.push(deviceResult);
        }

        console.log(`Returning ${results.length} device paths`);
        res.json({ devices: results });

    } catch (e) {
        console.error('GET /paths/encoded error:', e);
        res.status(500).json({ error: 'db_error', message: e.message });
    }
});

// NEW: Health check endpoint
app.get('/health', async (req, res) => {
    try {
        await pool.query('SELECT 1');
        res.json({
            status: 'healthy',
            timestamp: new Date().toISOString(),
            osrm_base: OSRM_BASE
        });
    } catch (error) {
        res.status(500).json({ status: 'unhealthy', error: error.message });
    }
});

app.listen(PORT, () => {
    console.log(`✅ MudMaps backend running on ${PORT} (behind proxy)`);
    console.log(`📍 OSRM endpoint: ${OSRM_BASE}`);
});