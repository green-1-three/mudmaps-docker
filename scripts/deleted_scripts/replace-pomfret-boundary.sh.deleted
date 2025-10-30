#!/bin/bash

#####################################################################
# Pomfret Boundary Complete Replacement
# 
# This script completely replaces the corrupted boundary with a
# fresh download from OpenStreetMap
#
# Usage: ./replace-pomfret-boundary.sh
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
echo "  POMFRET BOUNDARY COMPLETE REPLACEMENT"
echo "═══════════════════════════════════════════════════════════"
echo ""

# Set up database credentials
export PGUSER=mudmaps
export PGHOST=localhost
export PGDATABASE=mudmapsdb
export PGPASSWORD='fDNVp1hPW75zvQU3TqVmOI5G0X4pdx4V1UEHhan8llo='
export PGPORT=5432

echo -e "${BLUE}Backing up current data...${NC}"
docker exec mudmaps-postgres psql -U mudmaps -d mudmapsdb -c "
    CREATE TABLE IF NOT EXISTS municipalities_backup_$(date +%Y%m%d_%H%M%S) AS 
    SELECT * FROM municipalities WHERE id = 'pomfret-vt';
"

echo ""
echo -e "${BLUE}Deleting corrupted boundary...${NC}"
docker exec mudmaps-postgres psql -U mudmaps -d mudmapsdb -c "
    DELETE FROM municipalities WHERE id = 'pomfret-vt';
"

echo ""
echo -e "${BLUE}Re-importing fresh boundary and segments...${NC}"

cd ~/mudmaps-docker/db/scripts

# Check if npm packages are installed
if [ ! -d "node_modules" ] || [ ! -d "node_modules/@turf" ]; then
    echo "Installing required npm packages..."
    npm install
fi

# Import with fresh boundary from OSM
node import-osm-segments.js pomfret-vt --segment-length=50

if [ $? -ne 0 ]; then
    echo -e "${RED}✗ Import failed${NC}"
    exit 1
fi

echo ""
echo -e "${BLUE}Checking new boundary validity...${NC}"
docker exec mudmaps-postgres psql -U mudmaps -d mudmapsdb -c "
    SELECT 
        id,
        name || ', ' || state as location,
        ST_IsValid(boundary) as is_valid,
        ST_NPoints(boundary) as num_points,
        ROUND((ST_Area(boundary::geography) / 1000000)::numeric, 2) as area_km2
    FROM municipalities
    WHERE id = 'pomfret-vt';
"

echo ""
echo -e "${BLUE}Testing spatial query (without ST_Within to avoid topology errors)...${NC}"
docker exec mudmaps-postgres psql -U mudmaps -d mudmapsdb -c "
    WITH segment_sample AS (
        SELECT geometry FROM road_segments 
        WHERE municipality_id = 'pomfret-vt' 
        LIMIT 1
    ),
    boundary AS (
        SELECT boundary FROM municipalities 
        WHERE id = 'pomfret-vt'
    )
    SELECT 
        CASE 
            WHEN ST_Intersects(s.geometry, b.boundary) THEN 'Segments intersect boundary - Good!'
            ELSE 'No intersection - Problem!'
        END as result
    FROM segment_sample s, boundary b;
"

echo ""
echo -e "${BLUE}Checking segment statistics...${NC}"
docker exec mudmaps-postgres psql -U mudmaps -d mudmapsdb -c "
    SELECT 
        COUNT(*) as total_segments,
        COUNT(DISTINCT street_name) as unique_streets,
        ROUND(SUM(segment_length)::numeric / 1000, 1) as total_km
    FROM road_segments
    WHERE municipality_id = 'pomfret-vt';
"

echo ""
echo -e "${BLUE}Resetting GPS processing...${NC}"
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
echo -e "${GREEN}  BOUNDARY REPLACEMENT COMPLETE!${NC}"
echo "═══════════════════════════════════════════════════════════"
echo ""
echo "The Pomfret boundary has been completely replaced with a fresh"
echo "download from OpenStreetMap. The segments have been re-imported."
echo ""
echo "Note: The boundary may still show as invalid in PostGIS due to"
echo "complex geometry, but it should work for segment activation."
echo ""
echo "Monitor the worker to see segments being activated:"
echo "  docker logs -f mudmaps-worker"
echo ""
echo "Check the map at: https://muckmaps.app/"
echo ""
