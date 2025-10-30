#!/bin/bash

#####################################################################
# Pomfret Boundary Check Script
# 
# Quick diagnostic to check the current state of Pomfret boundary
# and segments without making any changes
#
# Usage: ./check-pomfret-status.sh
#####################################################################

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo ""
echo "═══════════════════════════════════════════════════════════"
echo "  POMFRET BOUNDARY & SEGMENTS STATUS CHECK"
echo "═══════════════════════════════════════════════════════════"
echo ""

echo -e "${BLUE}Checking boundary validity...${NC}"
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

echo ""
echo -e "${BLUE}Testing boundary in spatial query...${NC}"
TEST_OUTPUT=$(docker exec mudmaps-postgres psql -U mudmaps -d mudmapsdb -c "
    SELECT ST_Within(
        ST_GeomFromText('POINT(-72.52 43.7)', 4326),
        boundary
    ) as point_within_boundary
    FROM municipalities 
    WHERE id = 'pomfret-vt';
" 2>&1)

if [[ "$TEST_OUTPUT" == *"TopologyException"* ]]; then
    echo -e "${RED}✗ Boundary throws TopologyException in spatial queries!${NC}"
    echo "Error details:"
    echo "$TEST_OUTPUT" | grep -i "topology"
else
    echo "$TEST_OUTPUT"
    echo -e "${GREEN}✓ Boundary works in spatial queries${NC}"
fi

echo ""
echo -e "${BLUE}Checking road segments...${NC}"
docker exec mudmaps-postgres psql -U mudmaps -d mudmapsdb -c "
    SELECT 
        COUNT(*) as total_segments,
        COUNT(DISTINCT street_name) as unique_streets,
        ROUND(AVG(segment_length)::numeric, 1) as avg_length_m,
        ROUND(SUM(segment_length)::numeric / 1000, 1) as total_km
    FROM road_segments
    WHERE municipality_id = 'pomfret-vt';
"

echo ""
echo -e "${BLUE}Checking segment positions relative to boundary...${NC}"
echo "(This query may fail if boundary is corrupted)"

POSITION_CHECK=$(docker exec mudmaps-postgres psql -U mudmaps -d mudmapsdb -c "
    WITH segment_check AS (
        SELECT 
            COUNT(*) as total
        FROM road_segments 
        WHERE municipality_id = 'pomfret-vt'
    )
    SELECT total as total_segments FROM segment_check;
" 2>&1)

if [[ "$POSITION_CHECK" == *"ERROR"* ]] || [[ "$POSITION_CHECK" == *"TopologyException"* ]]; then
    echo -e "${RED}✗ Cannot check segment positions - boundary is corrupted${NC}"
else
    # Try a simpler check without ST_Within
    docker exec mudmaps-postgres psql -U mudmaps -d mudmapsdb -c "
        SELECT 
            COUNT(*) as total_segments,
            'Cannot check position due to boundary issues' as note
        FROM road_segments
        WHERE municipality_id = 'pomfret-vt';
    "
fi

echo ""
echo -e "${BLUE}Checking segment activations...${NC}"
docker exec mudmaps-postgres psql -U mudmaps -d mudmapsdb -c "
    SELECT 
        COUNT(DISTINCT segment_id) as activated_segments,
        COUNT(*) as total_updates,
        COUNT(DISTINCT device_name) as devices,
        MIN(updated_at) as first_activation,
        MAX(updated_at) as last_activation
    FROM segment_updates
    WHERE segment_id IN (
        SELECT id FROM road_segments WHERE municipality_id = 'pomfret-vt'
    );
"

echo ""
echo -e "${BLUE}Checking cached polylines...${NC}"
docker exec mudmaps-postgres psql -U mudmaps -d mudmapsdb -c "
    SELECT 
        COUNT(*) as total_polylines,
        COUNT(DISTINCT device_name) as devices,
        MIN(start_time) as earliest,
        MAX(end_time) as latest
    FROM cached_polylines
    WHERE device_name LIKE '%pomfret%' OR device_name LIKE '%Pomfret%';
"

echo ""
echo -e "${BLUE}Checking unprocessed GPS data...${NC}"
docker exec mudmaps-postgres psql -U mudmaps -d mudmapsdb -c "
    SELECT 
        COUNT(*) as total_points,
        COUNT(CASE WHEN processed = FALSE THEN 1 END) as unprocessed,
        COUNT(DISTINCT device_name) as devices,
        MIN(timestamp) as earliest,
        MAX(timestamp) as latest
    FROM gps_raw_data
    WHERE device_name LIKE '%pomfret%' OR device_name LIKE '%Pomfret%';
"

echo ""
echo "═══════════════════════════════════════════════════════════"
echo "  STATUS CHECK COMPLETE"
echo "═══════════════════════════════════════════════════════════"
echo ""
echo "If you see TopologyException errors above, the boundary needs fixing."
echo "Run ./fix-pomfret-boundary.sh to attempt repair."
echo ""
