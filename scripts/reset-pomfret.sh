#!/bin/bash

#####################################################################
# Pomfret Reset Script
# 
# This script:
# 1. Fixes the invalid Pomfret boundary geometry
# 2. Deletes and re-imports road segments
# 3. Truncates cached polylines and segment updates
# 4. Reprocesses all GPS data to regenerate polylines and activate segments
#
# Usage: ./reset-pomfret.sh
#####################################################################

set -e  # Exit on any error

echo ""
echo "═══════════════════════════════════════════════════════════"
echo "  POMFRET RESET SCRIPT"
echo "═══════════════════════════════════════════════════════════"
echo ""
echo "⚠️  WARNING: This will:"
echo "   - Fix Pomfret boundary geometry"
echo "   - Delete all road segments for Pomfret"
echo "   - Re-import segments from OpenStreetMap"
echo "   - Truncate cached_polylines table"
echo "   - Truncate segment_updates table"
echo "   - Reset GPS raw data to unprocessed"
echo ""
read -p "Continue? (yes/no): " confirm

if [ "$confirm" != "yes" ]; then
    echo "Aborted."
    exit 0
fi

echo ""
echo "───────────────────────────────────────────────────────────"
echo "STEP 1: Fixing Pomfret boundary geometry"
echo "───────────────────────────────────────────────────────────"

docker exec mudmaps-postgres psql -U mudmaps -d mudmapsdb -c "
    UPDATE municipalities 
    SET boundary = ST_MakeValid(boundary),
        updated_at = NOW()
    WHERE id = 'pomfret-vt';
"

echo "✓ Boundary fixed"

# Verify the fix
echo ""
echo "Verifying boundary is now valid..."
docker exec mudmaps-postgres psql -U mudmaps -d mudmapsdb -c "
    SELECT 
        id,
        name,
        ST_IsValid(boundary) as is_valid,
        ST_GeometryType(boundary) as geom_type,
        ST_AsText(ST_Centroid(boundary)) as center
    FROM municipalities
    WHERE id = 'pomfret-vt';
"

echo ""
read -p "Does the boundary look valid (is_valid = t)? (yes/no): " boundary_ok

if [ "$boundary_ok" != "yes" ]; then
    echo "❌ Boundary still invalid. Aborting."
    exit 1
fi

echo ""
echo "───────────────────────────────────────────────────────────"
echo "STEP 2: Deleting existing road segments"
echo "───────────────────────────────────────────────────────────"

docker exec mudmaps-postgres psql -U mudmaps -d mudmapsdb -c "
    DELETE FROM road_segments WHERE municipality_id = 'pomfret-vt';
"

echo "✓ Road segments deleted"

echo ""
echo "───────────────────────────────────────────────────────────"
echo "STEP 3: Truncating derived tables"
echo "───────────────────────────────────────────────────────────"

docker exec mudmaps-postgres psql -U mudmaps -d mudmapsdb -c "
    TRUNCATE TABLE segment_updates CASCADE;
    TRUNCATE TABLE cached_polylines CASCADE;
    
    -- Reset GPS data to unprocessed
    UPDATE gps_raw_data SET processed = FALSE, batch_id = NULL;
    
    -- Reset processing log
    TRUNCATE TABLE processing_log CASCADE;
"

echo "✓ Cached polylines truncated"
echo "✓ Segment updates truncated"
echo "✓ GPS data reset to unprocessed"
echo "✓ Processing log cleared"

echo ""
echo "───────────────────────────────────────────────────────────"
echo "STEP 4: Re-importing road segments from OpenStreetMap"
echo "───────────────────────────────────────────────────────────"

# Navigate to scripts directory
cd ~/mudmaps-docker/db/scripts

echo "Running OSM import for Pomfret..."
node import-osm-segments.js pomfret-vt --segment-length=50

if [ $? -ne 0 ]; then
    echo "❌ OSM import failed"
    exit 1
fi

echo ""
echo "───────────────────────────────────────────────────────────"
echo "STEP 5: Verifying segment import"
echo "───────────────────────────────────────────────────────────"

docker exec mudmaps-postgres psql -U mudmaps -d mudmapsdb -c "
    SELECT 
        COUNT(*) as total_segments,
        COUNT(DISTINCT street_name) as unique_streets,
        ROUND(AVG(segment_length)::numeric, 1) as avg_length_m,
        ROUND(SUM(segment_length)::numeric / 1000, 1) as total_km,
        COUNT(CASE WHEN ST_IsValid(geometry) THEN 1 END) as valid_geometries
    FROM road_segments
    WHERE municipality_id = 'pomfret-vt';
"

echo ""
echo "───────────────────────────────────────────────────────────"
echo "STEP 6: Restarting worker to reprocess GPS data"
echo "───────────────────────────────────────────────────────────"

echo "Restarting worker container..."
docker restart mudmaps-worker

echo "✓ Worker restarted"

echo ""
echo "Checking worker logs (Ctrl+C to exit)..."
sleep 2
docker logs -f --tail 50 mudmaps-worker &
LOGS_PID=$!

echo ""
echo "Press Ctrl+C when you see the worker processing GPS data..."
wait $LOGS_PID 2>/dev/null || true

echo ""
echo "═══════════════════════════════════════════════════════════"
echo "  RESET COMPLETE!"
echo "═══════════════════════════════════════════════════════════"
echo ""
echo "Summary:"
echo "  ✓ Pomfret boundary fixed"
echo "  ✓ Road segments re-imported from OSM"
echo "  ✓ Cached polylines cleared"
echo "  ✓ GPS data reset to unprocessed"
echo "  ✓ Worker restarted to reprocess data"
echo ""
echo "Next steps:"
echo "  1. Monitor worker logs: docker logs -f mudmaps-worker"
echo "  2. Check map at https://muckmaps.app/"
echo "  3. Verify segments are now inside boundary"
echo ""
echo "═══════════════════════════════════════════════════════════"
