#!/bin/bash

#####################################################################
# Pomfret Boundary Manual Fix
# 
# Creates a proper boundary for Pomfret based on the actual extent
# of the road segments, which are correctly positioned
#
# Usage: ./fix-pomfret-boundary-manual.sh
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
echo "  POMFRET BOUNDARY MANUAL FIX"
echo "═══════════════════════════════════════════════════════════"
echo ""

echo -e "${BLUE}Current boundary extent vs segment extent:${NC}"
docker exec mudmaps-postgres psql -U mudmaps -d mudmapsdb -c "
WITH boundary_extent AS (
    SELECT 
        ST_XMin(boundary) as b_west,
        ST_YMin(boundary) as b_south,
        ST_XMax(boundary) as b_east,
        ST_YMax(boundary) as b_north
    FROM municipalities WHERE id = 'pomfret-vt'
),
segment_extent AS (
    SELECT 
        MIN(ST_X(ST_Centroid(geometry))) as s_west,
        MIN(ST_Y(ST_Centroid(geometry))) as s_south,
        MAX(ST_X(ST_Centroid(geometry))) as s_east,
        MAX(ST_Y(ST_Centroid(geometry))) as s_north
    FROM road_segments WHERE municipality_id = 'pomfret-vt'
)
SELECT 
    'Current Boundary' as description,
    ROUND(b_west::numeric, 4) as west,
    ROUND(b_south::numeric, 4) as south,
    ROUND(b_east::numeric, 4) as east,
    ROUND(b_north::numeric, 4) as north
FROM boundary_extent
UNION ALL
SELECT 
    'Segment Coverage' as description,
    ROUND(s_west::numeric, 4) as west,
    ROUND(s_south::numeric, 4) as south,
    ROUND(s_east::numeric, 4) as east,
    ROUND(s_north::numeric, 4) as north
FROM segment_extent;"

echo ""
echo -e "${YELLOW}The boundary is too small! Creating a proper boundary based on segment extent...${NC}"
echo ""

# Backup current boundary
echo -e "${BLUE}Backing up current boundary...${NC}"
docker exec mudmaps-postgres psql -U mudmaps -d mudmapsdb -c "
    CREATE TABLE IF NOT EXISTS municipalities_backup_manual_fix AS 
    SELECT * FROM municipalities WHERE id = 'pomfret-vt';
"

# Create a new boundary that encompasses all the segments with a small buffer
echo -e "${BLUE}Creating new boundary from segment extent...${NC}"
docker exec mudmaps-postgres psql -U mudmaps -d mudmapsdb -c "
    -- Create a convex hull around all segments with a 500m buffer
    UPDATE municipalities
    SET boundary = ST_Multi(
        ST_Buffer(
            ST_ConvexHull(
                ST_Collect(rs.geometry)
            )::geography, 
            500  -- 500 meter buffer
        )::geometry
    ),
    updated_at = NOW()
    FROM (
        SELECT ST_Union(geometry) as geometry
        FROM road_segments 
        WHERE municipality_id = 'pomfret-vt'
    ) rs
    WHERE municipalities.id = 'pomfret-vt';
"

echo ""
echo -e "${BLUE}Verifying new boundary...${NC}"
docker exec mudmaps-postgres psql -U mudmaps -d mudmapsdb -c "
    SELECT 
        id,
        name || ', ' || state as location,
        ST_IsValid(boundary) as is_valid,
        ROUND((ST_Area(boundary::geography) / 1000000)::numeric, 2) as area_km2,
        ROUND(ST_XMin(boundary)::numeric, 4) as west,
        ROUND(ST_YMin(boundary)::numeric, 4) as south,
        ROUND(ST_XMax(boundary)::numeric, 4) as east,
        ROUND(ST_YMax(boundary)::numeric, 4) as north
    FROM municipalities
    WHERE id = 'pomfret-vt';
"

echo ""
echo -e "${BLUE}Checking how many segments are now within the boundary...${NC}"
docker exec mudmaps-postgres psql -U mudmaps -d mudmapsdb -c "
    WITH segment_check AS (
        SELECT 
            COUNT(*) as total_segments
        FROM road_segments 
        WHERE municipality_id = 'pomfret-vt'
    ),
    within_check AS (
        SELECT 
            COUNT(*) as segments_within
        FROM road_segments rs, municipalities m
        WHERE rs.municipality_id = 'pomfret-vt'
        AND m.id = 'pomfret-vt'
        AND ST_Intersects(rs.geometry, m.boundary)
    )
    SELECT 
        sc.total_segments,
        wc.segments_within,
        ROUND((wc.segments_within::numeric / sc.total_segments * 100), 1) as percent_within
    FROM segment_check sc, within_check wc;
"

echo ""
echo -e "${BLUE}Clearing cached data for fresh start...${NC}"
docker exec mudmaps-postgres psql -U mudmaps -d mudmapsdb -c "
    TRUNCATE TABLE segment_updates CASCADE;
    TRUNCATE TABLE cached_polylines CASCADE;
    UPDATE gps_raw_data SET processed = FALSE, batch_id = NULL;
"

echo ""
echo -e "${BLUE}Restarting worker...${NC}"
docker restart mudmaps-worker

echo ""
echo "═══════════════════════════════════════════════════════════"
echo -e "${GREEN}  BOUNDARY FIX COMPLETE!${NC}"
echo "═══════════════════════════════════════════════════════════"
echo ""
echo "Created a new boundary that encompasses all road segments."
echo "This is a temporary fix - you should eventually get the"
echo "official Pomfret boundary from Vermont GIS data."
echo ""
echo "Check the map at: https://muckmaps.app/"
echo "The segments should now appear INSIDE the boundary."
echo ""
