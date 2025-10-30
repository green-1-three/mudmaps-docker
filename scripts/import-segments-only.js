#!/usr/bin/env node

/**
 * Import segments using EXISTING boundary
 * This version doesn't fetch/overwrite the boundary from OSM
 */

const { Pool } = require('pg');
const fetch = require('node-fetch');
const turf = require('@turf/turf');

const pool = new Pool({
    user: process.env.PGUSER || 'mudmaps',
    host: process.env.PGHOST || 'localhost',
    database: process.env.PGDATABASE || 'mudmapsdb',
    password: process.env.PGPASSWORD || 'fDNVp1hPW75zvQU3TqVmOI5G0X4pdx4V1UEHhan8llo=',
    port: parseInt(process.env.PGPORT) || 5432,
});

async function importSegmentsOnly() {
    const client = await pool.connect();
    
    try {
        console.log('🏛️  Importing segments for Pomfret, VT');
        console.log('📏 Segment length: 50m\n');
        
        // Step 1: Get EXISTING boundary from database
        console.log('Step 1: Using existing boundary from database...');
        const boundaryResult = await client.query(`
            SELECT ST_AsGeoJSON(boundary) as geojson,
                   ST_Area(boundary::geography)/1000000 as area_km2
            FROM municipalities 
            WHERE id = 'pomfret-vt'
        `);
        
        if (!boundaryResult.rows[0]) {
            throw new Error('No boundary found for pomfret-vt');
        }
        
        const boundary = JSON.parse(boundaryResult.rows[0].geojson);
        console.log(`✓ Using existing boundary (${boundaryResult.rows[0].area_km2.toFixed(2)} km²)\n`);
        
        // Step 2: Fetch roads from OSM
        console.log('Step 2: Fetching roads from OpenStreetMap...');
        const bbox = [-72.65, 43.62, -72.40, 43.80]; // Pomfret area
        
        const query = `
            [out:json][timeout:180][bbox:${bbox[1]},${bbox[0]},${bbox[3]},${bbox[2]}];
            (
                way[highway~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|service|living_street|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link)$"][name];
            );
            out geom;
        `;
        
        const response = await fetch('https://overpass-api.de/api/interpreter', {
            method: 'POST',
            body: query
        });
        
        const data = await response.json();
        console.log(`✓ Fetched ${data.elements.length} road ways\n`);
        
        // Step 3: Process and clip to boundary
        console.log('Step 3: Processing and clipping roads to boundary...');
        
        const segments = [];
        let roadsInside = 0;
        let roadsOutside = 0;
        
        for (const way of data.elements) {
            if (!way.geometry) continue;
            
            const lineCoords = way.geometry.map(pt => [pt.lon, pt.lat]);
            const line = turf.lineString(lineCoords);
            
            // Check if road intersects with boundary
            try {
                if (turf.booleanIntersects(line, boundary)) {
                    roadsInside++;
                    
                    // Segment the road into 50m pieces
                    const lineLength = turf.length(line, { units: 'meters' });
                    const numSegments = Math.max(1, Math.ceil(lineLength / 50));
                    
                    for (let i = 0; i < numSegments; i++) {
                        const startDist = (i * 50) / 1000;
                        const endDist = Math.min(((i + 1) * 50) / 1000, lineLength / 1000);
                        
                        try {
                            const segment = turf.lineSliceAlong(line, startDist, endDist, { units: 'kilometers' });
                            const segmentLength = turf.length(segment, { units: 'meters' });
                            
                            if (segmentLength > 0) {
                                segments.push({
                                    geometry: segment.geometry,
                                    street_name: way.tags.name,
                                    road_classification: way.tags.highway,
                                    segment_length: segmentLength,
                                    osm_way_id: way.id
                                });
                            }
                        } catch (e) {
                            // Skip invalid segments
                        }
                    }
                } else {
                    roadsOutside++;
                }
            } catch (e) {
                // Skip roads that cause geometry errors
            }
        }
        
        console.log(`✓ ${roadsInside} roads inside boundary, ${roadsOutside} outside`);
        console.log(`✓ Created ${segments.length} segments\n`);
        
        // Step 4: Insert segments
        console.log('Step 4: Inserting segments into database...');
        
        let inserted = 0;
        let failed = 0;
        
        for (const segment of segments) {
            try {
                const coords = segment.geometry.coordinates
                    .map(pt => `${pt[0]} ${pt[1]}`)
                    .join(', ');
                const wkt = `LINESTRING(${coords})`;
                
                // Calculate bearing
                const coords_array = segment.geometry.coordinates;
                const bearing = coords_array.length >= 2 ? 
                    turf.bearing(
                        turf.point(coords_array[0]),
                        turf.point(coords_array[coords_array.length - 1])
                    ) : null;
                
                await client.query(`
                    INSERT INTO road_segments (
                        municipality_id,
                        geometry,
                        segment_length,
                        bearing,
                        street_name,
                        road_classification,
                        osm_way_id
                    ) VALUES ($1, ST_GeomFromText($2, 4326), $3, $4, $5, $6, $7)
                `, [
                    'pomfret-vt',
                    wkt,
                    segment.segment_length,
                    bearing,
                    segment.street_name,
                    segment.road_classification,
                    segment.osm_way_id
                ]);
                
                inserted++;
                if (inserted % 100 === 0) {
                    process.stdout.write(`  Progress: ${inserted}/${segments.length}\r`);
                }
            } catch (e) {
                failed++;
                if (failed <= 5) {
                    console.error(`  Failed: ${e.message}`);
                }
            }
        }
        
        console.log(`✓ Inserted ${inserted} segments (${failed} failed)\n`);
        
        // Step 5: Verify
        const stats = await client.query(`
            SELECT 
                COUNT(*) as total_segments,
                COUNT(DISTINCT street_name) as unique_streets,
                ROUND(SUM(segment_length)::numeric / 1000, 1) as total_km
            FROM road_segments
            WHERE municipality_id = 'pomfret-vt'
        `);
        
        console.log('═══════════════════════════════════════════════════');
        console.log('IMPORT COMPLETE');
        console.log('═══════════════════════════════════════════════════');
        console.log(`Total segments: ${stats.rows[0].total_segments}`);
        console.log(`Unique streets: ${stats.rows[0].unique_streets}`);
        console.log(`Total road length: ${stats.rows[0].total_km} km`);
        console.log('═══════════════════════════════════════════════════\n');
        
    } catch (error) {
        console.error('❌ Import failed:', error);
        throw error;
    } finally {
        client.release();
        await pool.end();
    }
}

importSegmentsOnly().catch(console.error);
