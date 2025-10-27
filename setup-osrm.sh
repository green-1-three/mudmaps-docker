#!/bin/bash

# OSRM Setup Script for MudMaps
# Interactive setup - choose which states to process

set -e  # Exit on any error

echo "🗺️  OSRM Setup for MudMaps"
echo "=========================="
echo ""

BASE_URL="http://download.geofabrik.de/north-america/us"
DATA_DIR="./osrm-data"

# All available regions
ALL_REGIONS=(
    "vermont"
    "new-hampshire"
    "new-york"
    "massachusetts"
    "maine"
    "connecticut"
    "rhode-island"
)

echo "📋 Available regions:"
for i in "${!ALL_REGIONS[@]}"; do
    echo "   $((i+1)). ${ALL_REGIONS[$i]}"
done
echo ""

# Create data directory
mkdir -p "$DATA_DIR"

# Download all regions first
echo "📥 STEP 1: DOWNLOADING MAP DATA"
echo "================================"
echo "Downloading all regions (you'll choose which to process next)..."
echo ""

for region in "${ALL_REGIONS[@]}"; do
    REGION_FILE="${region}-latest.osm.pbf"
    REGION_URL="${BASE_URL}/${REGION_FILE}"

    if [ -f "$DATA_DIR/$REGION_FILE" ]; then
        echo "✅ ${region}: Already downloaded"
    else
        echo "⬇️  Downloading ${region}..."
        wget -q --show-progress -O "$DATA_DIR/$REGION_FILE" "$REGION_URL"
        echo "✅ ${region}: Downloaded"
    fi
done

echo ""
echo "✅ All map data downloaded!"
echo "📁 Total download size: $(du -sh $DATA_DIR | cut -f1)"
echo ""

# Interactive selection for processing
echo "🔧 STEP 2: CHOOSE STATES TO PROCESS"
echo "===================================="
echo ""
echo "⚠️  Important: Each state takes ~5-10 minutes to process"
echo "   Vermont & New Hampshire are recommended to start."
echo ""

REGIONS_TO_PROCESS=()

for region in "${ALL_REGIONS[@]}"; do
    # Check if already processed
    if [ -f "$DATA_DIR/${region}-latest.osrm" ]; then
        echo "✅ ${region}: Already processed (skip)"
        continue
    fi

    read -p "Process ${region}? (y/N): " -n 1 -r
    echo

    if [[ $REPLY =~ ^[Yy]$ ]]; then
        REGIONS_TO_PROCESS+=("$region")
    fi
done

if [ ${#REGIONS_TO_PROCESS[@]} -eq 0 ]; then
    echo ""
    echo "⚠️  No new regions selected for processing."
    echo "   All available regions are already processed or you skipped all."
    echo ""

    # Just set a default primary if nothing to process
    if [ ! -L "$DATA_DIR/region.osrm" ]; then
        if [ -f "$DATA_DIR/vermont-latest.osrm" ]; then
            echo "🔗 Setting Vermont as primary region..."
            ln -sf "vermont-latest.osrm" "$DATA_DIR/region.osrm"
        elif [ -f "$DATA_DIR/new-hampshire-latest.osrm" ]; then
            echo "🔗 Setting New Hampshire as primary region..."
            ln -sf "new-hampshire-latest.osrm" "$DATA_DIR/region.osrm"
        fi
    fi

    echo "📋 Next steps:"
    echo "   1. Start services: docker-compose up -d"
    echo "   2. Check OSRM: curl http://localhost:5000/health"
    exit 0
fi

echo ""
echo "📋 Will process ${#REGIONS_TO_PROCESS[@]} region(s):"
for region in "${REGIONS_TO_PROCESS[@]}"; do
    echo "   - ${region}"
done
echo ""
echo "⏱️  Estimated time: $((${#REGIONS_TO_PROCESS[@]} * 8)) minutes"
echo ""
read -p "Continue? (Y/n): " -n 1 -r
echo

if [[ $REPLY =~ ^[Nn]$ ]]; then
    echo "❌ Cancelled"
    exit 0
fi

# Process selected regions
echo ""
echo "🔧 STEP 3: PROCESSING SELECTED REGIONS"
echo "======================================="
echo ""

SUCCESSFUL_REGIONS=()
FAILED_REGIONS=()

for region in "${REGIONS_TO_PROCESS[@]}"; do
    echo ""
    echo "═══════════════════════════════════════"
    echo "Processing: ${region}"
    echo "═══════════════════════════════════════"

    REGION_FILE="${region}-latest.osm.pbf"

    # Extract
    echo "📍 [1/3] Extracting road network..."
    if docker run -t --rm \
        -v "$(pwd)/$DATA_DIR:/data" \
        osrm/osrm-backend \
        osrm-extract -p /opt/car.lua /data/$REGION_FILE; then
        echo "✅ Extraction complete"
    else
        echo "❌ Extraction failed"
        FAILED_REGIONS+=("$region")
        continue
    fi

    # Partition
    echo ""
    echo "📊 [2/3] Partitioning graph..."
    if docker run -t --rm \
        -v "$(pwd)/$DATA_DIR:/data" \
        osrm/osrm-backend \
        osrm-partition /data/${region}-latest.osrm; then
        echo "✅ Partitioning complete"
    else
        echo "❌ Partitioning failed"
        FAILED_REGIONS+=("$region")
        continue
    fi

    # Customize
    echo ""
    echo "⚙️  [3/3] Customizing graph..."
    if docker run -t --rm \
        -v "$(pwd)/$DATA_DIR:/data" \
        osrm/osrm-backend \
        osrm-customize /data/${region}-latest.osrm; then
        echo "✅ Customization complete"
        SUCCESSFUL_REGIONS+=("$region")

        # Show file size
        if [ -f "$DATA_DIR/${region}-latest.osrm" ]; then
            SIZE=$(du -sh "$DATA_DIR/${region}-latest.osrm" 2>/dev/null | cut -f1)
            echo "📦 File size: $SIZE"
        fi
    else
        echo "❌ Customization failed"
        FAILED_REGIONS+=("$region")
        continue
    fi

    echo "✅ ${region} processing complete!"
done

# Select primary region
echo ""
echo "🔗 STEP 4: SELECT PRIMARY REGION"
echo "================================="
echo ""
echo "Which region should be primary (loaded by default)?"
echo ""

# List all processed regions
ALL_PROCESSED=()
for region in "${ALL_REGIONS[@]}"; do
    if [ -f "$DATA_DIR/${region}-latest.osrm" ]; then
        ALL_PROCESSED+=("$region")
    fi
done

for i in "${!ALL_PROCESSED[@]}"; do
    echo "   $((i+1)). ${ALL_PROCESSED[$i]}"
done
echo ""

read -p "Select number (1-${#ALL_PROCESSED[@]}): " PRIMARY_NUM

# Validate input
if [[ "$PRIMARY_NUM" =~ ^[0-9]+$ ]] && [ "$PRIMARY_NUM" -ge 1 ] && [ "$PRIMARY_NUM" -le "${#ALL_PROCESSED[@]}" ]; then
    PRIMARY_REGION="${ALL_PROCESSED[$((PRIMARY_NUM-1))]}"
    echo ""
    echo "🔗 Setting ${PRIMARY_REGION} as primary region..."
    ln -sf "${PRIMARY_REGION}-latest.osrm" "$DATA_DIR/region.osrm"
    echo "✅ Primary region set!"
else
    echo "⚠️  Invalid selection. Defaulting to first available region..."
    ln -sf "${ALL_PROCESSED[0]}-latest.osrm" "$DATA_DIR/region.osrm"
    PRIMARY_REGION="${ALL_PROCESSED[0]}"
fi

# Summary
echo ""
echo "════════════════════════════════════════"
echo "✅ OSRM SETUP COMPLETE!"
echo "════════════════════════════════════════"
echo ""
echo "📊 Summary:"
echo "   ✅ Successfully processed: ${#SUCCESSFUL_REGIONS[@]} region(s)"
if [ ${#FAILED_REGIONS[@]} -gt 0 ]; then
    echo "   ❌ Failed: ${#FAILED_REGIONS[@]} region(s)"
fi
echo "   🎯 Primary region: ${PRIMARY_REGION}"
echo "   📁 Total data size: $(du -sh $DATA_DIR | cut -f1)"
echo ""

if [ ${#SUCCESSFUL_REGIONS[@]} -gt 0 ]; then
    echo "✅ Processed regions:"
    for region in "${SUCCESSFUL_REGIONS[@]}"; do
        SIZE=$(du -sh "$DATA_DIR/${region}-latest.osrm" 2>/dev/null | cut -f1 || echo "N/A")
        echo "   ✅ ${region} (${SIZE})"
    done
    echo ""
fi

if [ ${#FAILED_REGIONS[@]} -gt 0 ]; then
    echo "❌ Failed regions:"
    for region in "${FAILED_REGIONS[@]}"; do
        echo "   ❌ ${region}"
    done
    echo ""
fi

echo "🎯 Currently active: ${PRIMARY_REGION}"
echo ""
echo "💡 To switch to a different region:"
echo "   ln -sf <region>-latest.osrm $DATA_DIR/region.osrm"
echo "   docker-compose restart osrm"
echo ""
echo "   Available processed regions:"
for region in "${ALL_PROCESSED[@]}"; do
    if [ "$region" = "$PRIMARY_REGION" ]; then
        echo "   ★ ${region} (current)"
    else
        echo "   ○ ${region}"
    fi
done
echo ""
echo "📋 Next steps:"
echo "   1. Start services: docker-compose up -d"
echo "   2. Check OSRM health: curl http://localhost:5000/health"
echo "   3. Test routing: curl 'http://localhost:5000/route/v1/driving/-72.5,44.2;-72.6,44.3'"
echo ""
echo "💾 RAM usage per region: ~500MB-1GB"
echo "   (Only the primary region is loaded into memory)"
echo ""