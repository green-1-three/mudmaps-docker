#!/bin/bash

#####################################################################
# Reset GPS Processing Only
# 
# This script resets GPS data processing WITHOUT touching
# the boundary or segments (which are already correctly set up)
#
# Usage: ./reset-gps-processing.sh
#####################################################################

set -e

echo ""
echo "═══════════════════════════════════════════════════════════"
echo "  RESET GPS PROCESSING"
echo "═══════════════════════════════════════════════════════════"
echo ""
echo "This will:"
echo "  - Clear cached polylines"
echo "  - Clear segment activations"
echo "  - Reset all GPS data to unprocessed"
echo "  - Restart the worker"
echo ""
echo "This will NOT touch the boundary or segments."
echo ""
read -p "Continue? (yes/no): " confirm

if [ "$confirm" != "yes" ]; then
    echo "Aborted."
    exit 0
fi

echo ""
echo "───────────────────────────────────────────────────────────"
echo "Clearing cached data and resetting GPS processing..."
echo "───────────────────────────────────────────────────────────"

docker exec mudmaps-postgres psql -U mudmaps -d mudmapsdb -c "
    -- Clear cached polylines
    TRUNCATE TABLE cached_polylines CASCADE;
    
    -- Clear segment activations
    TRUNCATE TABLE segment_updates CASCADE;
    
    -- Reset GPS data to unprocessed
    UPDATE gps_raw_data SET processed = FALSE, batch_id = NULL;
    
    -- Clear processing log
    TRUNCATE TABLE processing_log CASCADE;
"

echo "✓ Cached polylines cleared"
echo "✓ Segment activations cleared"
echo "✓ GPS data reset to unprocessed"
echo "✓ Processing log cleared"

echo ""
echo "───────────────────────────────────────────────────────────"
echo "Restarting worker to begin processing..."
echo "───────────────────────────────────────────────────────────"

docker restart mudmaps-worker
echo "✓ Worker restarted"

echo ""
echo "───────────────────────────────────────────────────────────"
echo "Checking worker logs (press Ctrl+C to exit)..."
echo "───────────────────────────────────────────────────────────"
sleep 2
docker logs -f --tail 20 mudmaps-worker

echo ""
echo "═══════════════════════════════════════════════════════════"
echo "  GPS PROCESSING RESET COMPLETE!"
echo "═══════════════════════════════════════════════════════════"
echo ""
echo "The worker is now reprocessing all GPS data."
echo "Segments will be activated as polylines are processed."
echo ""
echo "Monitor progress:"
echo "  docker logs -f mudmaps-worker"
echo ""
echo "Check the map at:"
echo "  https://muckmaps.app/"
echo ""
