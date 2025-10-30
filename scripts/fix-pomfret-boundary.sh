#!/bin/bash

#####################################################################
# Pomfret Boundary Fix Script - Aggressive Repair
# 
# This script uses multiple strategies to fix the corrupted Pomfret
# boundary geometry:
# 1. Aggressive PostGIS repair with ST_Buffer trick
# 2. Complete re-fetch from OpenStreetMap if needed
# 3. Verification and re-import of segments
#
# Usage: ./fix-pomfret-boundary.sh
#####################################################################

set -e  # Exit on any error

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo ""
echo "═══════════════════════════════════════════════════════════"
echo "  POMFRET BOUNDARY AGGRESSIVE FIX"
echo "═══════════════════════════════════════════════════════════"
echo ""
echo -e "${YELLOW}⚠️  WARNING: This script will:${NC}"
echo "   - Aggressively repair Pomfret boundary geometry"
echo "   - Re-fetch from OSM if repair fails"
echo "   - Delete and re-import all road segments"
echo "   - Clear all cached data"
echo "   - Reset GPS processing"
echo ""
read -p "Continue? (yes/no): " confirm

if [ "$confirm" != "yes" ]; then
    echo "Aborted."
    exit 0
fi

# Set up database credentials
export PGUSER=mudmaps
export PGHOST=localhost
export PGDATABASE=mudmapsdb
export PGPASSWORD='fDNVp1hPW75zvQU3TqVmOI5G0X4pdx4V1UEHhan8llo='
export PGPORT=5432

echo ""
echo -e "${BLUE}───────────────────────────────────────────────────────────${NC}"
echo -e "${BLUE}STEP 1: Backing up current boundary${NC}"
echo -e "${BLUE}───────────────────────────────────────────────────────────${NC}"

docker exec mudmaps-postgres psql -U mudmaps -d mudmapsdb -c "
    -- Create backup of current boundary
    CREATE TABLE IF NOT EXISTS municipalities_backup AS 
    SELECT * FROM municipalities WHERE id = 'pomfret-vt';
"
echo -e "${GREEN}✓ Boundary backed up${NC}"

echo ""
echo -e "${BLUE}───────────────────────────────────────────────────────────${NC}"
echo -e "${BLUE}STEP 2: Attempting aggressive PostGIS repair${NC}"
echo -e "${BLUE}───────────────────────────────────────────────────────────${NC}"

echo "Trying ST_Buffer(0) technique to rebuild geometry..."
docker exec mudmaps-postgres psql -U mudmaps -d mudmapsdb -c "
    -- First attempt: ST_MakeValid + ST_Buffer(0) to force complete rebuild
    UPDATE municipalities 
    SET boundary = ST_Multi(ST_Buffer(ST_MakeValid(boundary), 0)),
        updated_at = NOW()
    WHERE id = 'pomfret-vt';
"

echo ""
echo "Checking if repair worked..."
VALIDITY_CHECK=$(docker exec mudmaps-postgres psql -U mudmaps -d mudmapsdb -t -c "
    SELECT ST_IsValid(boundary) FROM municipalities WHERE id = 'pomfret-vt';
" | tr -d ' ')

if [ "$VALIDITY_CHECK" = "t" ]; then
    echo -e "${GREEN}✓ Boundary appears valid after ST_Buffer repair${NC}"
    
    # Test if we can actually use it in spatial queries
    echo "Testing boundary in spatial query..."
    TEST_RESULT=$(docker exec mudmaps-postgres psql -U mudmaps -d mudmapsdb -t -c "
        SELECT COUNT(*)
        FROM (
            SELECT ST_Within(
                ST_GeomFromText('POINT(-72.52 43.7)', 4326),
                boundary
            ) as test
            FROM municipalities 
            WHERE id = 'pomfret-vt'
        ) t;
    " 2>&1)
    
    if [[ "$TEST_RESULT" == *"TopologyException"* ]] || [[ "$TEST_RESULT" == *"ERROR"* ]]; then
        echo -e "${RED}✗ Boundary still throws topology errors in spatial queries${NC}"
        BOUNDARY_FIXED=false
    else
        echo -e "${GREEN}✓ Boundary works in spatial queries${NC}"
        BOUNDARY_FIXED=true
    fi
else
    echo -e "${RED}✗ Boundary still invalid${NC}"
    BOUNDARY_FIXED=false
fi

if [ "$BOUNDARY_FIXED" = false ]; then
    echo ""
    echo -e "${BLUE}───────────────────────────────────────────────────────────${NC}"
    echo -e "${BLUE}STEP 3: Repair failed - Re-fetching from OpenStreetMap${NC}"
    echo -e "${BLUE}───────────────────────────────────────────────────────────${NC}"
    
    # Create a temporary Node.js script to fetch just the boundary
    cat > /tmp/fetch-pomfret-boundary.js << 'EOF'
const fetch = require('node-fetch');
const { Pool } = require('pg');

const pool = new Pool({
    user: process.env.PGUSER || 'mudmaps',
    host: process.env.PGHOST || 'localhost',
    database: process.env.PGDATABASE || 'mudmapsdb',
    password: process.env.PGPASSWORD || 'fDNVp1hPW75zvQU3TqVmOI5G0X4pdx4V1UEHhan8llo=',
    port: parseInt(process.env.PGPORT) || 5432,
});

async function fetchAndFixBoundary() {
    console.log('Fetching fresh boundary from OpenStreetMap...');
    
    const query = `
        [out:json][timeout:60];
        relation(2030458);
        out geom;
    `;
    
    const url = 'https://overpass-api.de/api/interpreter';
    const response = await fetch(url, {
        method: 'POST',
        body: query
    });
    
    if (!response.ok) {
        throw new Error(`OSM API error: ${response.status}`);
    }
    
    const data = await response.json();
    
    if (!data.elements || data.elements.length === 0) {
        throw new Error('No boundary found');
    }
    
    const relation = data.elements[0];
    console.log(`Found relation: ${relation.tags.name}`);
    
    // Extract and clean outer boundaries
    const coordinates = [];
    for (const member of relation.members) {
        if (member.role === 'outer' && member.type === 'way' && member.geometry) {
            const wayCoords = member.geometry.map(node => [node.lon, node.lat]);
            
            // Ensure ring is properly closed
            if (wayCoords.length > 2) {
                const first = wayCoords[0];
                const last = wayCoords[wayCoords.length - 1];
                
                if (first[0] !== last[0] || first[1] !== last[1]) {
                    wayCoords.push([first[0], first[1]]);
                }
                
                // Only add if we have at least 4 points (minimum for a valid polygon)
                if (wayCoords.length >= 4) {
                    coordinates.push(wayCoords);
                }
            }
        }
    }
    
    if (coordinates.length === 0) {
        throw new Error('No valid outer boundaries found');
    }
    
    console.log(`Found ${coordinates.length} outer ring(s)`);
    
    // Build WKT
    const polygons = coordinates.map(ring => {
        const coords = ring.map(c => `${c[0]} ${c[1]}`).join(', ');
        return `((${coords}))`;
    }).join(', ');
    
    const wkt = `MULTIPOLYGON(${polygons})`;
    
    // Update database with clean geometry
    const client = await pool.connect();
    try {
        // First, create the geometry and validate it
        const result = await client.query(`
            SELECT 
                ST_IsValid(ST_GeomFromText($1, 4326)) as is_valid,
                ST_IsValidReason(ST_GeomFromText($1, 4326)) as reason
        `, [wkt]);
        
        console.log(`Geometry valid: ${result.rows[0].is_valid}`);
        if (!result.rows[0].is_valid) {
            console.log(`Validation issue: ${result.rows[0].reason}`);
            console.log('Attempting to fix with ST_MakeValid...');
            
            // Try to fix and insert
            await client.query(`
                UPDATE municipalities 
                SET boundary = ST_Multi(ST_MakeValid(ST_GeomFromText($1, 4326))),
                    updated_at = NOW()
                WHERE id = 'pomfret-vt'
            `, [wkt]);
        } else {
            // Direct insert of valid geometry
            await client.query(`
                UPDATE municipalities 
                SET boundary = ST_Multi(ST_GeomFromText($1, 4326)),
                    updated_at = NOW()
                WHERE id = 'pomfret-vt'
            `, [wkt]);
        }
        
        console.log('✓ Boundary updated successfully');
        
        // Verify the update
        const verify = await client.query(`
            SELECT 
                ST_IsValid(boundary) as is_valid,
                ST_NPoints(boundary) as num_points,
                ST_Area(boundary::geography) / 1000000 as area_km2
            FROM municipalities 
            WHERE id = 'pomfret-vt'
        `);
        
        console.log(`Final check - Valid: ${verify.rows[0].is_valid}, Points: ${verify.rows[0].num_points}, Area: ${verify.rows[0].area_km2.toFixed(2)} km²`);
        
    } finally {
        client.release();
        await pool.end();
    }
}

fetchAndFixBoundary().catch(console.error);
EOF
    
    # Copy the script to the scripts directory and run it
    cp /tmp/fetch-pomfret-boundary.js ~/mudmaps-docker/db/scripts/
    cd ~/mudmaps-docker/db/scripts
    
    echo "Installing dependencies if needed..."
    # Check if node_modules exists at all
    if [ ! -d "node_modules" ]; then
        echo "Running npm install to get all dependencies..."
        npm install
    fi
    # Check for specific packages
    npm list node-fetch >/dev/null 2>&1 || npm install node-fetch
    npm list pg >/dev/null 2>&1 || npm install pg
    
    echo "Fetching fresh boundary from OpenStreetMap..."
    node fetch-pomfret-boundary.js
    
    if [ $? -ne 0 ]; then
        echo -e "${RED}✗ Failed to fetch boundary from OSM${NC}"
        exit 1
    fi
    
    # Clean up
    rm fetch-pomfret-boundary.js
    rm /tmp/fetch-pomfret-boundary.js
fi

echo ""
echo -e "${BLUE}───────────────────────────────────────────────────────────${NC}"
echo -e "${BLUE}STEP 4: Verifying final boundary validity${NC}"
echo -e "${BLUE}───────────────────────────────────────────────────────────${NC}"

docker exec mudmaps-postgres psql -U mudmaps -d mudmapsdb -c "
    SELECT 
        id,
        name || ', ' || state as location,
        ST_IsValid(boundary) as is_valid,
        ST_GeometryType(boundary) as geom_type,
        ST_NPoints(boundary) as num_points,
        ROUND((ST_Area(boundary::geography) / 1000000)::numeric, 2) as area_km2,
        ROUND(ST_Perimeter(boundary::geography)::numeric / 1000, 2) as perimeter_km
    FROM municipalities
    WHERE id = 'pomfret-vt';
"

# Final validity check
FINAL_VALID=$(docker exec mudmaps-postgres psql -U mudmaps -d mudmapsdb -t -c "
    SELECT ST_IsValid(boundary) FROM municipalities WHERE id = 'pomfret-vt';
" | tr -d ' ')

if [ "$FINAL_VALID" != "t" ]; then
    echo -e "${RED}✗ Boundary is still invalid after all repair attempts${NC}"
    echo "You may need to find an alternative boundary source (e.g., Vermont GIS data)"
    exit 1
fi

echo -e "${GREEN}✓ Boundary is valid!${NC}"

echo ""
echo -e "${BLUE}───────────────────────────────────────────────────────────${NC}"
echo -e "${BLUE}STEP 5: Clearing old data${NC}"
echo -e "${BLUE}───────────────────────────────────────────────────────────${NC}"

docker exec mudmaps-postgres psql -U mudmaps -d mudmapsdb -c "
    -- Clear all derived data
    TRUNCATE TABLE segment_updates CASCADE;
    TRUNCATE TABLE cached_polylines CASCADE;
    DELETE FROM road_segments WHERE municipality_id = 'pomfret-vt';
    
    -- Reset GPS data for reprocessing
    UPDATE gps_raw_data SET processed = FALSE, batch_id = NULL;
    
    -- Clear processing log
    TRUNCATE TABLE processing_log CASCADE;
"

echo -e "${GREEN}✓ Old data cleared${NC}"

echo ""
echo -e "${BLUE}───────────────────────────────────────────────────────────${NC}"
echo -e "${BLUE}STEP 6: Re-importing road segments with fixed boundary${NC}"
echo -e "${BLUE}───────────────────────────────────────────────────────────${NC}"

cd ~/mudmaps-docker/db/scripts

# Check if npm packages are installed, install if missing
if [ ! -d "node_modules" ] || [ ! -d "node_modules/@turf" ]; then
    echo "Installing required npm packages..."
    npm install
fi

node import-osm-segments.js pomfret-vt --segment-length=50

if [ $? -ne 0 ]; then
    echo -e "${RED}✗ Segment import failed${NC}"
    exit 1
fi

echo ""
echo -e "${BLUE}───────────────────────────────────────────────────────────${NC}"
echo -e "${BLUE}STEP 7: Verifying segments are within boundary${NC}"
echo -e "${BLUE}───────────────────────────────────────────────────────────${NC}"

docker exec mudmaps-postgres psql -U mudmaps -d mudmapsdb -c "
    WITH segment_check AS (
        SELECT 
            COUNT(*) as total_segments,
            COUNT(CASE 
                WHEN ST_Within(rs.geometry, m.boundary) THEN 1 
            END) as inside_boundary,
            COUNT(CASE 
                WHEN ST_Intersects(rs.geometry, m.boundary) 
                AND NOT ST_Within(rs.geometry, m.boundary) THEN 1 
            END) as on_boundary,
            COUNT(CASE 
                WHEN NOT ST_Intersects(rs.geometry, m.boundary) THEN 1 
            END) as outside_boundary
        FROM road_segments rs
        CROSS JOIN municipalities m
        WHERE rs.municipality_id = 'pomfret-vt'
        AND m.id = 'pomfret-vt'
    )
    SELECT 
        total_segments,
        inside_boundary,
        on_boundary,
        outside_boundary,
        ROUND((inside_boundary::numeric / total_segments * 100), 1) as pct_inside,
        ROUND((on_boundary::numeric / total_segments * 100), 1) as pct_on_boundary,
        ROUND((outside_boundary::numeric / total_segments * 100), 1) as pct_outside
    FROM segment_check;
"

# Check if most segments are inside
INSIDE_COUNT=$(docker exec mudmaps-postgres psql -U mudmaps -d mudmapsdb -t -c "
    SELECT COUNT(*)
    FROM road_segments rs, municipalities m
    WHERE rs.municipality_id = 'pomfret-vt'
    AND m.id = 'pomfret-vt'
    AND (ST_Within(rs.geometry, m.boundary) OR ST_Intersects(rs.geometry, m.boundary));
" | tr -d ' ')

TOTAL_COUNT=$(docker exec mudmaps-postgres psql -U mudmaps -d mudmapsdb -t -c "
    SELECT COUNT(*) FROM road_segments WHERE municipality_id = 'pomfret-vt';
" | tr -d ' ')

if [ "$INSIDE_COUNT" -lt "$((TOTAL_COUNT / 2))" ]; then
    echo -e "${YELLOW}⚠️  Warning: Less than 50% of segments are within/intersecting the boundary${NC}"
    echo "This suggests the boundary might still have issues"
fi

echo ""
echo -e "${BLUE}───────────────────────────────────────────────────────────${NC}"
echo -e "${BLUE}STEP 8: Restarting worker to reprocess GPS data${NC}"
echo -e "${BLUE}───────────────────────────────────────────────────────────${NC}"

docker restart mudmaps-worker
echo -e "${GREEN}✓ Worker restarted${NC}"

echo ""
echo "═══════════════════════════════════════════════════════════"
echo -e "${GREEN}  BOUNDARY FIX COMPLETE!${NC}"
echo "═══════════════════════════════════════════════════════════"
echo ""
echo "Summary:"
echo "  ✓ Pomfret boundary aggressively repaired/replaced"
echo "  ✓ Road segments re-imported with fixed boundary"
echo "  ✓ All cached data cleared"
echo "  ✓ GPS data queued for reprocessing"
echo "  ✓ Worker restarted"
echo ""
echo "Next steps:"
echo "  1. Monitor worker: docker logs -f mudmaps-worker"
echo "  2. Check the map: https://muckmaps.app/"
echo "  3. Verify segments appear inside the white boundary line"
echo "  4. Watch for segments turning green as GPS data activates them"
echo ""
echo "Debugging commands:"
echo "  - Check segment positions: docker exec mudmaps-postgres psql -U mudmaps -d mudmapsdb -c \"SELECT COUNT(*) FROM road_segments WHERE municipality_id = 'pomfret-vt';\""
echo "  - Check activations: docker exec mudmaps-postgres psql -U mudmaps -d mudmapsdb -c \"SELECT COUNT(*) FROM segment_updates;\""
echo ""
echo "═══════════════════════════════════════════════════════════"
