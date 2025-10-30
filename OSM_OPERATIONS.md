# OSM Import Operations Guide

## Overview: How Road Segment Import Works

The road segment model requires importing road network data from OpenStreetMap (OSM) for each municipality. This is a one-time setup process per town that creates the fixed set of road segments that vehicles will "activate" by driving over them.

---

## The Pomfret Import Experience (Lessons Learned)

### Initial Problem

Pomfret's OSM boundary data was broken - the relation consisted of 6 separate "outer" ways that needed to be connected into a single polygon, but the import script was treating each as a separate polygon, creating an invalid MultiPolygon with only 0.57 km² area instead of the actual 102.45 km².

### What Went Wrong

1. The original `import-osm-segments.js` script didn't properly assemble multi-way boundaries
2. This created a tiny, invalid boundary polygon
3. Road segments were clipped to this broken boundary
4. Most segments ended up outside the "boundary" or in wrong positions

### How We Fixed It

1. Created `fix-pomfret-osm.js` that properly connects the 6 OSM ways into a continuous polygon
2. Created `import-segments-only.js` that uses the existing (fixed) boundary instead of fetching from OSM
3. Fixed bearing calculation to handle edge cases (zero-length segments, invalid calculations)
4. Successfully imported 2,994 segments covering 146.8 km of roads

---

## Safe Scripts to Use

### ✅ SAFE SCRIPTS

#### `/db/scripts/import-segments-only.js`
**Purpose:** Imports road segments using EXISTING boundary from database

**Key features:**
- Does NOT fetch or modify the municipality boundary
- Handles bearing calculation properly (defaults to 0 when calculation fails)
- Uses existing municipality record in database

**Usage:**
```bash
cd ~/mudmaps-docker/db/scripts

# Set environment variables
export PGUSER=mudmaps
export PGHOST=localhost
export PGDATABASE=mudmapsdb
export PGPASSWORD='fDNVp1hPW75zvQU3TqVmOI5G0X4pdx4V1UEHhan8llo='
export PGPORT=5432

# Run import
node import-segments-only.js
```

#### `/scripts/fix-pomfret-osm.js`
**Purpose:** Properly assembles multi-way OSM boundaries into single polygon

**Key features:**
- Connects ways end-to-end where they share coordinates
- Validates geometry and applies ST_MakeValid if needed
- Handles complex multi-way relations correctly

#### `/scripts/reset-gps-processing.sh`
**Purpose:** Clears cached polylines and segment activations

**Key features:**
- Resets GPS data to unprocessed state
- Does NOT touch boundary or segments
- Safe to run anytime to restart processing

#### `/scripts/check-pomfret-status.sh`
**Purpose:** Read-only status check

**Key features:**
- Shows boundary validity
- Shows segment counts
- Shows processing status
- No modifications to database

### ⚠️ DO NOT USE (moved to deleted_scripts folders)

- `import-osm-segments.js.deleted` - Creates invalid boundaries from multi-way relations
- `fix-pomfret-boundary.sh.deleted` - Uses broken ST_MakeValid approach
- `reset-pomfret.sh.deleted` - Runs the broken import script

---

## How to Import a New Municipality

### Step 1: Find the OSM Relation ID

1. Go to [OpenStreetMap](https://www.openstreetmap.org)
2. Search for the town name
3. Click on the town boundary
4. Look for "Relation" in the left panel
5. Note the relation ID number

**Common Vermont/New Hampshire towns:**
- Pomfret, VT: 2030458
- Lyme, NH: 61644 (needs verification)
- Woodstock, VT: (needs lookup)
- Hartford, VT: (needs lookup)

### Step 2: Check if Boundary is Multi-Way

Use Overpass Turbo or curl to check the relation structure:

```bash
curl -s "https://overpass-api.de/api/interpreter" \
  -d "[out:json];relation(RELATION_ID);out geom;" | \
  jq '.elements[0].members | map(select(.role=="outer")) | length'
```

**Interpretation:**
- If result = 1: Simple boundary (single outer way)
- If result > 1: Complex boundary (multiple outer ways need assembly)

### Step 3: Create Import Configuration

**For simple boundaries (single outer way):**
- Can potentially use original import approach
- But safer to use `import-segments-only.js` approach

**For complex boundaries (multiple outer ways):**
1. First import/fix the boundary using approach from `fix-pomfret-osm.js`
2. Then import segments using `import-segments-only.js`

**Template for new municipality:**
```javascript
const MUNICIPALITIES = {
    'townname-state': {
        name: 'Town Name',
        state: 'ST',
        osmRelationId: 123456,
        bbox: [minLon, minLat, maxLon, maxLat]
    }
};
```

### Step 4: Run the Import

```bash
# On server
cd ~/mudmaps-docker/db/scripts

# Set environment variables
export PGUSER=mudmaps
export PGHOST=localhost
export PGDATABASE=mudmapsdb
export PGPASSWORD='fDNVp1hPW75zvQU3TqVmOI5G0X4pdx4V1UEHhan8llo='
export PGPORT=5432

# For new municipality, might need to:
# 1. First create municipality record with proper boundary
# 2. Then run segment import

node import-segments-only.js
```

### Step 5: Verify the Import

**Check boundary validity:**
```sql
SELECT 
    ST_Area(boundary::geography)/1000000 as area_km2,
    ST_IsValid(boundary) as is_valid,
    ST_NPoints(boundary) as num_points
FROM municipalities 
WHERE id = 'townname-state';
```

**Check segment counts:**
```sql
SELECT 
    COUNT(*) as total_segments,
    COUNT(DISTINCT street_name) as unique_streets,
    ROUND(SUM(segment_length)::numeric / 1000, 1) as total_km
FROM road_segments
WHERE municipality_id = 'townname-state';
```

**Check segments within boundary:**
```sql
SELECT 
    COUNT(*) as total,
    COUNT(CASE WHEN ST_Within(rs.geometry, m.boundary) THEN 1 END) as within
FROM road_segments rs, municipalities m
WHERE rs.municipality_id = 'townname-state' 
AND m.id = 'townname-state';
```

---

## Common Issues and Solutions

### Issue: "Self-intersection" errors
**Cause:** OSM boundary has topology issues
**Solution:** Use ST_MakeValid() in PostGIS to fix geometry

### Issue: Tiny boundary area (< 1 km²)
**Cause:** Multi-way boundary not properly assembled
**Solution:** Use the fix-pomfret-osm.js approach to connect ways end-to-end

### Issue: Bearing constraint violations
**Cause:** Zero-length segments or calculation errors
**Solution:** Default to bearing=0 when calculation fails (already implemented in import-segments-only.js)

### Issue: Segments outside boundary
**Cause:** OSM road network extends beyond town limits
**Solution:** This is normal - roads don't stop at administrative boundaries. Filter by proximity if needed.

### Issue: Missing major roads
**Cause:** OSM data incomplete or road incorrectly tagged
**Solution:** 
- Check OSM data quality for the area
- Consider alternative data sources (state GIS)
- Manually add missing segments if critical

### Issue: Rivers/waterways included as roads
**Cause:** OSM data incorrectly tagged (waterway tagged as highway)
**Solution:** Add filtering in import script to exclude waterways

### Issue: Private driveways included
**Cause:** OSM includes highway=service with access=private
**Solution:** Add filtering: exclude highway=service where access=private

---

## What Gets Imported

### Road Types Included (from OSM highway tags)

**Major roads:**
- motorway, trunk, primary, secondary, tertiary

**Local roads:**
- residential, unclassified, living_street

**Service roads:**
- service (includes some driveways - consider filtering)
- *_link roads (ramps, connectors)

### Data Stored Per Segment

- **Geometry:** PostGIS LineString (max 50m length)
- **Street name:** From OSM name tag
- **Road classification:** From OSM highway tag
- **Bearing:** Direction in degrees (0-360)
- **Original OSM way ID:** For reference back to OSM
- **Municipality ID:** Foreign key to municipality
- **Segment length:** Calculated from geometry

### Known Issues with OSM Data

- May include rivers/waterways incorrectly tagged as roads
- Private driveways often included (highway=service)
- Road positions may not match reality perfectly
- Some roads may be missing entirely
- Road names may be inconsistent or missing
- Boundaries may have topology errors

---

## Future Improvements

### Better Filtering

**Planned improvements:**
- Exclude `highway=service` with `access=private`
- Exclude unnamed roads under certain length (likely driveways)
- Filter out obvious non-roads (check for water bodies, verify connectivity)
- Validate against expected road density for municipality

### Alternative Data Sources

**Options to consider:**
- Vermont state GIS road centerlines
- New Hampshire DOT road data
- Generate segments from actual GPS tracks (reverse-engineer network)
- Hybrid approach using multiple sources

### Automated Boundary Assembly

**Goals:**
- Script to automatically connect multi-way boundaries
- Handle all edge cases programmatically
- Validate geometry before import
- Test with various municipalities to ensure robustness

### Import Validation

**Automated checks:**
- Verify segment density (segments per km²) is reasonable
- Check for major roads that should be present
- Compare total road length to expected value for municipality
- Flag suspicious segments (very short, very long, isolated)

---

## Database Performance Considerations

### Current Pomfret Stats
- **Total segments:** 2,994
- **Total road length:** 146.8 km
- **Unique streets:** 70
- **Segment activations:** 4,105 after one day

### Scaling Projections

**Vermont municipalities:**
- Small town (Pomfret-sized): 1,000-3,000 segments
- Medium town (Woodstock): 3,000-5,000 segments
- Larger town (Hartford): 5,000-10,000 segments

**State-wide:**
- Vermont total roads: ~25,000 km
- At 100m segments: 250,000 segments
- At 50m segments: 500,000 segments

### Performance Optimizations

**Critical indexes:**
- GIST spatial index on segment geometry (absolutely required)
- B-tree index on municipality_id
- Index on segment_updates(segment_id, updated_at)

**Future considerations:**
- Consider partitioning if > 100k segments total
- May need separate OSRM routing graphs per municipality
- Monitor query performance as data grows

---

## Operational Notes

### One-Time Setup Per Municipality

Road import is done once when onboarding a new town. Segments don't change unless:
- Roads are added/removed (rare)
- OSM data is significantly updated
- Need to adjust segment length
- Need to re-filter roads (exclude more/different types)

### Segment Activation is Real-Time

**Processing flow:**
- GPS data arrives → polyline created → segments activated immediately
- No batch processing or delays for activation
- Updates happen continuously as vehicles drive

### Backup Before Imports

**Always backup before importing:**

```bash
# Backup database
docker exec mudmaps-postgres pg_dump -U mudmaps mudmapsdb > backup_$(date +%Y%m%d).sql

# Restore if needed
cat backup_20241030.sql | docker exec -i mudmaps-postgres psql -U mudmaps mudmapsdb
```

### Testing New Imports

**Recommended workflow:**
1. Import on local development environment first
2. Verify with test GPS data
3. Check segment counts and coverage
4. Only deploy to production when confident

---

## Import Script Environment Variables

### Required for All Imports

```bash
export PGUSER=mudmaps
export PGHOST=localhost
export PGDATABASE=mudmapsdb
export PGPASSWORD='fDNVp1hPW75zvQU3TqVmOI5G0X4pdx4V1UEHhan8llo='
export PGPORT=5432
```

### Optional Configuration

```bash
# Segment length (default: 50 meters)
export SEGMENT_LENGTH=50

# Municipality to import
export MUNICIPALITY_ID='pomfret-vt'
```

---

## Troubleshooting

### Import Script Fails with Connection Error

**Check:**
- Database is running: `docker ps | grep postgres`
- Environment variables are set correctly
- Connection from import script location is allowed

### No Segments Imported

**Check:**
- Municipality record exists in database
- Boundary geometry is valid (not null, not empty)
- OSM relation ID is correct
- Network connection to Overpass API working

### Segments Have Bearing = 0

**Explanation:**
- Bearing defaults to 0 when calculation fails
- Usually happens with very short segments (< 1m)
- Or segments with identical start/end points

**Action:**
- Filter out segments < 5m length
- Check for duplicate coordinates in geometry

### Segments Outside Municipality Boundary

**Explanation:**
- This is normal - roads cross boundaries
- OSM road network doesn't respect administrative boundaries

**Action:**
- No action needed for segments slightly outside
- Can filter by distance from boundary if desired

### Import Takes Very Long Time

**Typical import time:**
- Small municipality: 2-5 minutes
- Medium municipality: 5-10 minutes
- Large municipality: 10-20 minutes

**If slower:**
- Check network speed to Overpass API
- Check database performance (indexes exist?)
- Consider increasing segment length to reduce count
