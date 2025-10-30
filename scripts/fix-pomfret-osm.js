#!/usr/bin/env node

/**
 * Fix Pomfret Boundary - Properly connect OSM ways
 * 
 * This script correctly assembles the Pomfret boundary from 
 * the 6 outer ways in OSM relation 2030458
 */

const { Pool } = require('pg');
const fetch = require('node-fetch');

const pool = new Pool({
    user: process.env.PGUSER || 'mudmaps',
    host: process.env.PGHOST || 'localhost',
    database: process.env.PGDATABASE || 'mudmapsdb',
    password: process.env.PGPASSWORD || 'fDNVp1hPW75zvQU3TqVmOI5G0X4pdx4V1UEHhan8llo=',
    port: parseInt(process.env.PGPORT) || 5432,
});

async function fixPomfretBoundary() {
    console.log('Fetching Pomfret boundary from OSM...');
    
    const query = `[out:json];relation(2030458);out geom;`;
    const url = 'https://overpass-api.de/api/interpreter';
    
    const response = await fetch(url, {
        method: 'POST',
        body: query
    });
    
    if (!response.ok) {
        throw new Error(`OSM API error: ${response.status}`);
    }
    
    const data = await response.json();
    const relation = data.elements[0];
    
    console.log(`Found relation: ${relation.tags.name}, ${relation.tags.border_type}`);
    console.log(`OSM relation has ${relation.members.filter(m => m.role === 'outer').length} outer ways`);
    
    // Extract all outer ways
    const outerWays = relation.members
        .filter(m => m.role === 'outer' && m.geometry)
        .map(m => ({
            ref: m.ref,
            coords: m.geometry.map(pt => [pt.lon, pt.lat])
        }));
    
    console.log('\nOuter ways found:');
    outerWays.forEach(way => {
        const start = way.coords[0];
        const end = way.coords[way.coords.length - 1];
        console.log(`  Way ${way.ref}: ${way.coords.length} points`);
        console.log(`    Start: [${start[0].toFixed(4)}, ${start[1].toFixed(4)}]`);
        console.log(`    End:   [${end[0].toFixed(4)}, ${end[1].toFixed(4)}]`);
    });
    
    // Connect the ways into a single polygon ring
    console.log('\nConnecting ways into continuous boundary...');
    
    let boundary = [];
    let remainingWays = [...outerWays];
    
    // Start with the first way
    let currentWay = remainingWays.shift();
    boundary.push(...currentWay.coords);
    
    // Connect remaining ways
    while (remainingWays.length > 0) {
        const lastPoint = boundary[boundary.length - 1];
        let connected = false;
        
        for (let i = 0; i < remainingWays.length; i++) {
            const way = remainingWays[i];
            const firstPoint = way.coords[0];
            const lastWayPoint = way.coords[way.coords.length - 1];
            
            // Check if this way connects to our boundary
            if (Math.abs(lastPoint[0] - firstPoint[0]) < 0.0001 && 
                Math.abs(lastPoint[1] - firstPoint[1]) < 0.0001) {
                // Connect at the start of this way
                boundary.push(...way.coords.slice(1)); // Skip duplicate point
                remainingWays.splice(i, 1);
                connected = true;
                console.log(`  Connected way ${way.ref} (forward)`);
                break;
            } else if (Math.abs(lastPoint[0] - lastWayPoint[0]) < 0.0001 && 
                       Math.abs(lastPoint[1] - lastWayPoint[1]) < 0.0001) {
                // Connect at the end of this way (need to reverse it)
                boundary.push(...way.coords.slice(0, -1).reverse());
                remainingWays.splice(i, 1);
                connected = true;
                console.log(`  Connected way ${way.ref} (reversed)`);
                break;
            }
        }
        
        if (!connected && remainingWays.length > 0) {
            console.log(`  Warning: Could not connect ${remainingWays.length} remaining ways`);
            console.log(`  Last point: [${lastPoint[0].toFixed(4)}, ${lastPoint[1].toFixed(4)}]`);
            break;
        }
    }
    
    // Close the polygon if needed
    const firstPoint = boundary[0];
    const lastPoint = boundary[boundary.length - 1];
    if (firstPoint[0] !== lastPoint[0] || firstPoint[1] !== lastPoint[1]) {
        boundary.push([firstPoint[0], firstPoint[1]]);
        console.log('  Closed the polygon ring');
    }
    
    console.log(`\nFinal boundary: ${boundary.length} points`);
    
    // Create WKT
    const coords = boundary.map(pt => `${pt[0]} ${pt[1]}`).join(', ');
    const wkt = `POLYGON((${coords}))`;
    
    // Update database
    const client = await pool.connect();
    try {
        // Check if valid
        const validCheck = await client.query(`
            SELECT ST_IsValid(ST_GeomFromText($1, 4326)) as is_valid,
                   ST_IsValidReason(ST_GeomFromText($1, 4326)) as reason
        `, [wkt]);
        
        console.log(`\nGeometry valid: ${validCheck.rows[0].is_valid}`);
        if (!validCheck.rows[0].is_valid) {
            console.log(`Issue: ${validCheck.rows[0].reason}`);
        }
        
        // Update the boundary
        await client.query(`
            UPDATE municipalities 
            SET boundary = ST_Multi(ST_MakeValid(ST_GeomFromText($1, 4326))),
                updated_at = NOW()
            WHERE id = 'pomfret-vt'
        `, [wkt]);
        
        console.log('✓ Boundary updated successfully');
        
        // Verify
        const result = await client.query(`
            SELECT 
                ST_IsValid(boundary) as is_valid,
                ST_NPoints(boundary) as num_points,
                ST_Area(boundary::geography) / 1000000 as area_km2,
                ST_Perimeter(boundary::geography) / 1000 as perimeter_km
            FROM municipalities WHERE id = 'pomfret-vt'
        `);
        
        const stats = result.rows[0];
        console.log(`\nFinal boundary stats:`);
        console.log(`  Valid: ${stats.is_valid}`);
        console.log(`  Points: ${stats.num_points}`);
        console.log(`  Area: ${stats.area_km2.toFixed(2)} km²`);
        console.log(`  Perimeter: ${stats.perimeter_km.toFixed(2)} km`);
        
    } finally {
        client.release();
        await pool.end();
    }
}

fixPomfretBoundary().catch(console.error);
