#!/usr/bin/env node

/**
 * OSM Road Segment Import Script
 * 
 * Downloads road data from OpenStreetMap for a municipality and
 * segments it into 50-100m chunks for the road segment model.
 * 
 * Usage: node import-osm-segments.js <municipality-id> [--segment-length=75]
 * Example: node import-osm-segments.js pomfret-vt --segment-length=75
 */

const { Pool } = require('pg');
const fetch = require('node-fetch');
const turf = require('@turf/turf');
require('dotenv').config();

const pool = new Pool({
    user: process.env.PGUSER,
    host: process.env.PGHOST,
    database: process.env.PGDATABASE,
    password: process.env.PGPASSWORD,
    port: parseInt(process.env.PGPORT) || 5432,
});

// Municipality definitions
const MUNICIPALITIES = {
    'pomfret-vt': {
        name: 'Pomfret',
        state: 'VT',
        osmRelationId: 2030458,  // OpenStreetMap relation ID for Pomfret, VT
        // Bounding box: [minLon, minLat, maxLon, maxLat]
        bbox: [-72.6, 43.6, -72.4, 43.8]
    },
    'lyme-nh': {
        name: 'Lyme',
        state: 'NH',
        osmRelationId: 61644,  // Placeholder - need to verify
        bbox: [-72.2, 43.7, -72.0, 43.9]
    }
};

// Road types to include (OSM highway tags)
const DRIVABLE_ROAD_TYPES = [
    'motorway', 'trunk', 'primary', 'secondary', 'tertiary',
    'unclassified', 'residential', 'service', 'living_street',
    'motorway_link', 'trunk_link', 'primary_link', 'secondary_link', 'tertiary_link'
];

/**
 * Fetch municipality boundary from OpenStreetMap
 */
async function fetchMunicipalityBoundary(osmRelationId) {
    console.log(`📍 Fetching boundary for OSM relation ${osmRelationId}...`);
    
    const query = `
        [out:json][timeout:60];
        relation(${osmRelationId});
        out geom;
    `;
    
    const url = 'https://overpass-api.de/api/interpreter';
    const response = await fetch(url, {
        method: 'POST',
        body: query
    });
    
    if (!response.ok) {
        throw new Error(`Overpass API error: ${response.status}`);
    }
    
    const data = await response.json();
    
    if (!data.elements || data.elements.length === 0) {
        throw new Error(`No boundary found for relation ${osmRelationId}`);
    }
    
    // Convert OSM relation to GeoJSON
    const relation = data.elements[0];
    
    // Extract outer ways (boundary)
    const coordinates = [];
    for (const member of relation.members) {
        if (member.role === 'outer' && member.type === 'way') {
            const wayCoords = member.geometry.map(node => [node.lon, node.lat]);
            
            // Ensure ring is closed (first point = last point)
            if (wayCoords.length > 0) {
                const first = wayCoords[0];
                const last = wayCoords[wayCoords.length - 1];
                
                if (first[0] !== last[0] || first[1] !== last[1]) {
                    // Close the ring by adding first point to the end
                    wayCoords.push([...first]);
                }
            }
            
            coordinates.push(wayCoords);
        }
    }
    
    if (coordinates.length === 0) {
        throw new Error('No outer boundary found');
    }
    
    // Create MultiPolygon (OSM relations can have multiple outer rings)
    const multiPolygon = turf.multiPolygon([coordinates]);
    
    console.log(`✓ Boundary fetched: ${coordinates.length} outer ring(s)`);
    return multiPolygon;
}

/**
 * Fetch roads within bounding box from OpenStreetMap
 */
async function fetchRoads(bbox, roadTypes) {
    console.log(`🛣️  Fetching roads from OSM...`);
    
    const roadTypeFilter = roadTypes.map(t => `"highway"="${t}"`).join('');
    
    const query = `
        [out:json][timeout:180][bbox:${bbox[1]},${bbox[0]},${bbox[3]},${bbox[2]}];
        (
            way[highway~"^(${roadTypes.join('|')})$"][name];
        );
        out geom;
    `;
    
    const url = 'https://overpass-api.de/api/interpreter';
    const response = await fetch(url, {
        method: 'POST',
        body: query
    });
    
    if (!response.ok) {
        throw new Error(`Overpass API error: ${response.status}`);
    }
    
    const data = await response.json();
    console.log(`✓ Fetched ${data.elements.length} road ways from OSM`);
    
    return data.elements;
}

/**
 * Convert OSM way to GeoJSON LineString
 */
function osmWayToGeoJSON(way) {
    const coordinates = way.geometry.map(node => [node.lon, node.lat]);
    
    return {
        type: 'Feature',
        geometry: {
            type: 'LineString',
            coordinates: coordinates
        },
        properties: {
            osm_way_id: way.id,
            street_name: way.tags.name || null,
            road_classification: way.tags.highway,
            osm_tags: way.tags
        }
    };
}

/**
 * Segment a LineString into chunks of specified length
 */
function segmentLineString(feature, segmentLengthMeters) {
    const line = turf.lineString(feature.geometry.coordinates);
    const lineLength = turf.length(line, { units: 'meters' });
    
    if (lineLength < segmentLengthMeters / 2) {
        // Too short to segment, return as-is
        return [feature];
    }
    
    const segments = [];
    const numSegments = Math.ceil(lineLength / segmentLengthMeters);
    
    for (let i = 0; i < numSegments; i++) {
        const startDist = (i * segmentLengthMeters) / 1000;  // Convert to km
        const endDist = Math.min(((i + 1) * segmentLengthMeters) / 1000, lineLength / 1000);
        
        const segmentLine = turf.lineSliceAlong(line, startDist, endDist, { units: 'kilometers' });
        
        // Calculate bearing for this segment
        const coords = segmentLine.geometry.coordinates;
        const bearing = calculateBearing(
            coords[0][1], coords[0][0],
            coords[coords.length - 1][1], coords[coords.length - 1][0]
        );
        
        // Calculate actual length
        const actualLength = turf.length(segmentLine, { units: 'meters' });
        
        segments.push({
            type: 'Feature',
            geometry: segmentLine.geometry,
            properties: {
                ...feature.properties,
                segment_length: actualLength,
                bearing: bearing
            }
        });
    }
    
    return segments;
}

/**
 * Calculate bearing between two points
 */
function calculateBearing(lat1, lon1, lat2, lon2) {
    if (lat1 === lat2 && lon1 === lon2) {
        return null;
    }
    
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const lat1Rad = lat1 * Math.PI / 180;
    const lat2Rad = lat2 * Math.PI / 180;
    
    const y = Math.sin(dLon) * Math.cos(lat2Rad);
    const x = Math.cos(lat1Rad) * Math.sin(lat2Rad) - 
              Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(dLon);
    
    let bearing = Math.atan2(y, x) * 180 / Math.PI;
    bearing = (bearing + 360) % 360;
    
    return bearing;
}

/**
 * Convert GeoJSON geometry to WKT for PostGIS
 */
function geometryToWKT(geometry) {
    if (geometry.type === 'LineString') {
        const coords = geometry.coordinates
            .map(c => `${c[0]} ${c[1]}`)
            .join(', ');
        return `LINESTRING(${coords})`;
    } else if (geometry.type === 'MultiPolygon') {
        const polygons = geometry.coordinates.map(polygon => {
            const rings = polygon.map(ring => {
                const coords = ring.map(c => `${c[0]} ${c[1]}`).join(', ');
                return `(${coords})`;
            }).join(', ');
            return `(${rings})`;
        }).join(', ');
        return `MULTIPOLYGON(${polygons})`;
    }
    throw new Error(`Unsupported geometry type: ${geometry.type}`);
}

/**
 * Main import function
 */
async function importMunicipality(municipalityId, segmentLength = 75) {
    const client = await pool.connect();
    
    try {
        const config = MUNICIPALITIES[municipalityId];
        if (!config) {
            throw new Error(`Unknown municipality: ${municipalityId}. Available: ${Object.keys(MUNICIPALITIES).join(', ')}`);
        }
        
        console.log(`\n🏛️  Importing ${config.name}, ${config.state}`);
        console.log(`📏 Segment length: ${segmentLength}m\n`);
        
        // Step 1: Fetch and insert municipality boundary
        console.log('Step 1: Fetching municipality boundary...');
        const boundary = await fetchMunicipalityBoundary(config.osmRelationId);
        const boundaryWKT = geometryToWKT(boundary.geometry);
        
        await client.query(`
            INSERT INTO municipalities (id, name, state, boundary, active)
            VALUES ($1, $2, $3, ST_GeomFromText($4, 4326), true)
            ON CONFLICT (id) DO UPDATE
            SET boundary = ST_GeomFromText($4, 4326),
                updated_at = NOW()
        `, [municipalityId, config.name, config.state, boundaryWKT]);
        
        console.log(`✓ Municipality boundary saved\n`);
        
        // Step 2: Fetch roads from OSM
        console.log('Step 2: Fetching roads from OpenStreetMap...');
        const osmWays = await fetchRoads(config.bbox, DRIVABLE_ROAD_TYPES);
        console.log(`✓ Fetched ${osmWays.length} road ways\n`);
        
        // Step 3: Convert to GeoJSON and clip to municipality boundary
        console.log('Step 3: Processing and clipping roads...');
        let features = osmWays.map(osmWayToGeoJSON);
        
        // Create a buffered boundary for more forgiving intersection test
        // Buffer by 100m to catch roads on the boundary edge
        const bufferedBoundary = turf.buffer(boundary, 0.1, { units: 'kilometers' });
        
        // Convert MultiPolygon to Polygon if only one ring (turf works better with simple polygons)
        let testBoundary = bufferedBoundary;
        if (bufferedBoundary.geometry.type === 'MultiPolygon' && bufferedBoundary.geometry.coordinates.length === 1) {
            testBoundary = turf.polygon(bufferedBoundary.geometry.coordinates[0]);
        }
        
        // Clip to municipality boundary
        const clippedFeatures = [];
        let skipped = 0;
        
        for (const feature of features) {
            try {
                const line = turf.lineString(feature.geometry.coordinates);
                
                // Test if line intersects OR is within the buffered boundary
                if (turf.booleanIntersects(line, testBoundary) || turf.booleanWithin(line, testBoundary)) {
                    clippedFeatures.push(feature);
                }
            } catch (e) {
                // Skip invalid geometries
                skipped++;
                if (skipped <= 5) {  // Only show first 5 warnings
                    console.warn(`  ⚠️  Skipping invalid geometry for way ${feature.properties.osm_way_id}: ${e.message}`);
                }
            }
        }
        
        if (skipped > 5) {
            console.warn(`  ⚠️  (${skipped - 5} more geometries skipped)`);
        }
        
        console.log(`✓ ${clippedFeatures.length} roads within municipality boundary (${features.length - clippedFeatures.length - skipped} outside, ${skipped} invalid)\n`);
        
        // Step 4: Segment roads
        console.log('Step 4: Segmenting roads...');
        const allSegments = [];
        for (const feature of clippedFeatures) {
            const segments = segmentLineString(feature, segmentLength);
            allSegments.push(...segments);
        }
        console.log(`✓ Created ${allSegments.length} road segments\n`);
        
        // Step 5: Insert segments into database
        console.log('Step 5: Inserting segments into database...');
        
        // Delete existing segments for this municipality
        await client.query(`
            DELETE FROM road_segments WHERE municipality_id = $1
        `, [municipalityId]);
        
        let inserted = 0;
        let failed = 0;
        
        for (const segment of allSegments) {
            try {
                const wkt = geometryToWKT(segment.geometry);
                
                await client.query(`
                    INSERT INTO road_segments (
                        municipality_id,
                        geometry,
                        segment_length,
                        bearing,
                        street_name,
                        road_classification,
                        osm_way_id,
                        osm_tags
                    ) VALUES ($1, ST_GeomFromText($2, 4326), $3, $4, $5, $6, $7, $8)
                `, [
                    municipalityId,
                    wkt,
                    segment.properties.segment_length,
                    segment.properties.bearing,
                    segment.properties.street_name,
                    segment.properties.road_classification,
                    segment.properties.osm_way_id,
                    JSON.stringify(segment.properties.osm_tags)
                ]);
                
                inserted++;
                
                if (inserted % 100 === 0) {
                    process.stdout.write(`  Progress: ${inserted}/${allSegments.length}\r`);
                }
            } catch (e) {
                failed++;
                console.error(`  ❌ Failed to insert segment: ${e.message}`);
            }
        }
        
        console.log(`✓ Inserted ${inserted} segments (${failed} failed)\n`);
        
        // Step 6: Verify
        const stats = await client.query(`
            SELECT 
                COUNT(*) as total_segments,
                COUNT(DISTINCT street_name) as unique_streets,
                ROUND(AVG(segment_length)::numeric, 1) as avg_length,
                ROUND(SUM(segment_length)::numeric / 1000, 1) as total_km
            FROM road_segments
            WHERE municipality_id = $1
        `, [municipalityId]);
        
        console.log('═══════════════════════════════════════════════════');
        console.log('IMPORT COMPLETE');
        console.log('═══════════════════════════════════════════════════');
        console.log(`Municipality: ${config.name}, ${config.state}`);
        console.log(`Total segments: ${stats.rows[0].total_segments}`);
        console.log(`Unique streets: ${stats.rows[0].unique_streets}`);
        console.log(`Average segment length: ${stats.rows[0].avg_length}m`);
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

// Parse command line arguments
const args = process.argv.slice(2);
const municipalityId = args[0];
const segmentLength = parseInt(
    args.find(arg => arg.startsWith('--segment-length='))?.split('=')[1] || '75'
);

if (!municipalityId) {
    console.error('Usage: node import-osm-segments.js <municipality-id> [--segment-length=75]');
    console.error('Available municipalities:', Object.keys(MUNICIPALITIES).join(', '));
    process.exit(1);
}

// Run import
importMunicipality(municipalityId, segmentLength).catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
});
