#!/bin/bash

# OSRM Setup Script for MudMaps
# Creates combined VT+NH region plus individual states

set -e  # Exit on any error

echo "🗺️  OSRM Setup for MudMaps"
echo "=========================="
echo ""

BASE_URL="http://download.geofabrik.de/north-america/us"
DATA_DIR="./osrm-data"

# Individual regions to download
REGIONS=(
    "vermont"
    "new-hampshire"
    "new-york"
    "massachusetts"
    "maine"
    "connecticut"
    "rhode-island"
)

echo "📋 Setup plan:"
echo "   1. Download VT + NH (will combine these)"
echo "   2. Download other regions individually"
echo "   3. Create combined VT+NH routing data"
echo "   4. Set combined VT+NH as primary"
echo ""

# Create data directory
mkdir -p "$DATA_DIR"

# Download all regions
echo "📥 DOWNLOADING MAP DATA"
echo "======================="
for region in "${REGIONS[@]}"; do
    REGION_FILE="${region}-latest.osm.pbf"
    REGION_URL="${BASE_URL}/${REGION_FILE}"

    echo "⬇️  Downloading ${region}..."
    if [ -f "$DATA_DIR/$REGION_FILE" ]; then
        echo "   ✅ Already exists, skipping"
    else
        wget -q --show-progress -O "$DATA_DIR/$REGION_FILE" "$REGION_URL"
        echo "   ✅ Downloaded"
    fi
done

echo ""
echo "🔗 CREATING COMBINED VT+NH REGION"
echo "=================================="
echo "Merging Vermont and New Hampshire into single routing data..."

# Combine VT and NH using osmium-tool container
if [ ! -f "$DATA_DIR/vt-nh-combined.osm.pbf" ]; then
    echo "🔧 Merging VT + NH map data..."
    docker run -t --rm \
        -v "$(pwd)/$DATA_DIR:/data" \
        ghcr.io/osmcode/osmium-tool:latest \
        osmium merge /data/vermont-latest.osm.pbf /data/new-hampshire-latest.osm.pbf \
        -o /data/vt-nh-combined.osm.pbf
    echo "✅ Merge complete"
else
    echo "✅ Combined file already exists"
fi

# Process combined VT+NH
echo ""
echo "🔧 Processing combined VT+NH..."
echo "   (This is your primary routing region)"
echo ""

# Extract
echo "📍 Extracting road network..."
docker run -t --rm \
    -v "$(pwd)/$DATA_DIR:/data" \
    osrm/osrm-backend \
    osrm-extract -p /opt/car.lua /data/vt-nh-combined.osm.pbf

# Partition
echo "📊 Partitioning graph..."
docker run -t --rm \
    -v "$(pwd)/$DATA_DIR:/data" \
    osrm/osrm-backend \
    osrm-partition /data/vt-nh-combined.osrm

# Customize
echo "⚙️  Customizing graph..."
docker run -t --rm \
    -v "$(pwd)/$DATA_DIR:/data" \
    osrm/osrm-backend \
    osrm-customize /data/vt-nh-combined.osrm

echo "✅ Combined VT+NH processing complete!"

# Optional: Process other states
echo ""
echo "❓ Process other states? (NY, MA, ME, CT, RI)"
echo "   These are optional and can be processed later if needed."
read -p "Process now? (y/N): " -n 1 -r
echo

if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo ""
    echo "🔧 PROCESSING OTHER STATES"
    echo "=========================="

    for region in "new-york" "massachusetts" "maine" "connecticut" "rhode-island"; do
        echo ""
        echo "Processing: $region"
        echo "-------------------"

        REGION_FILE="${region}-latest.osm.pbf"

        # Extract
        echo "📍 Extracting..."
        docker run -t --rm \
            -v "$(pwd)/$DATA_DIR:/data" \
            osrm/osrm-backend \
            osrm-extract -p /opt/car.lua /data/$REGION_FILE

        # Partition
        echo "📊 Partitioning..."
        docker run -t --rm \
            -v "$(pwd)/$DATA_DIR:/data" \
            osrm/osrm-backend \
            osrm-partition /data/${region}-latest.osrm

        # Customize
        echo "⚙️  Customizing..."
        docker run -t --rm \
            -v "$(pwd)/$DATA_DIR:/data" \
            osrm/osrm-backend \
            osrm-customize /data/${region}-latest.osrm

        echo "✅ $region complete"
    done
else
    echo "⏭️  Skipping other states (can process later)"
fi

# Create symlink to combined VT+NH
echo ""
echo "🔗 Setting combined VT+NH as primary region..."
ln -sf "vt-nh-combined.osrm" "$DATA_DIR/region.osrm"

echo ""
echo "════════════════════════════════════════"
echo "✅ OSRM SETUP COMPLETE!"
echo "════════════════════════════════════════"
echo ""
echo "📊 Summary:"
echo "   ✅ Combined VT+NH region (PRIMARY)"
echo "   📁 Data size: $(du -sh $DATA_DIR | cut -f1)"
echo ""
echo "🎯 Primary region: Vermont + New Hampshire (combined)"
echo "   - Routes seamlessly across VT/NH border"
echo "   - Perfect for your main markets"
echo ""
echo "💡 Other regions:"
if [ -f "$DATA_DIR/new-york-latest.osrm" ]; then
    echo "   ✅ Processed and ready to use"
else
    echo "   ⏭️  Downloaded but not processed (saves time/RAM)"
    echo "   Run this script again and choose 'y' to process them"
fi
echo ""
echo "📋 Next steps:"
echo "   1. Start services: docker-compose up -d"
echo "   2. Check OSRM: curl http://localhost:5000/health"
echo "   3. Test routing: curl 'http://localhost:5000/route/v1/driving/-72.5,44.2;-71.5,43.2'"
echo ""
echo "💡 To switch to a different region later:"
echo "   ln -sf new-york-latest.osrm $DATA_DIR/region.osrm"
echo "   docker-compose restart osrm"
echo ""
echo "💾 RAM usage:"
echo "   Combined VT+NH: ~800MB-1GB"
echo "   Your 2GB droplet: Perfect fit! ✅"
echo ""