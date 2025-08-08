const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');

const app = express();
const port = process.env.PORT || 3000;
const hostPort = process.env.HOST_PORT || port; // Will use mapped port if provided in .env

const corsOrigin = process.env.CORS_ORIGIN || '*';
app.use(cors({ origin: corsOrigin }));

// PostgreSQL connection setup
const pool = new Pool({
    user: process.env.PGUSER || 'mudmaps',
    host: process.env.PGHOST || 'postgres',
    database: process.env.PGDATABASE || 'mudmapsdb',
    password: process.env.PGPASSWORD || 'mudmaps',
    port: Number(process.env.PGPORT) || 5432,
});

// Route: /markers -> [{ username, coords: [[lon,lat],...] }]
app.get('/markers', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT username, ARRAY[coords] AS coords
            FROM markers
            ORDER BY created_at DESC
        `);
        res.json(result.rows);
    } catch (err) {
        console.error('Error in /markers:', err);
        res.status(500).send('Database error in /markers');
    }
});

// Route: /polylines -> [{ username, coords: [[lon,lat],...] }]
app.get('/polylines', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT username, coords
            FROM polylines
            ORDER BY created_at DESC
                LIMIT 200
        `);
        res.json(result.rows);
    } catch (err) {
        console.error('Error in /polylines:', err);
        res.status(500).send('Database error in /polylines');
    }
});

// Basic healthcheck
app.get('/healthz', (_req, res) => res.send('ok'));

// Handle unhandled promise rejections globally
process.on('unhandledRejection', (err) => {
    console.error('Unhandled rejection:', err);
});

// Start server
app.listen(port, () => {
    console.log(`✅ MudMaps backend running — container port: ${port}, host port: ${hostPort}`);
});

// Raw capture endpoint for GPS tracker pings
app.all('/upload', (req, res) => {
    console.log('--- Incoming GPS Tracker Data ---');
    console.log('Method:', req.method);
    console.log('Headers:', req.headers);

    if (req.method === 'POST') {
        let body = '';
        req.on('data', chunk => (body += chunk));
        req.on('end', () => {
            console.log('POST Body:', body);
            res.send('OK');
        });
    } else if (req.method === 'GET') {
        console.log('Query Parameters:', req.query);
        res.send('OK');
    } else {
        res.send('Method received but not processed.');
    }
});
