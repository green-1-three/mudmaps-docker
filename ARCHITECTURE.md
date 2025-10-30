# MudMaps Architecture Documentation

## System Architecture Overview

MudMaps uses a multi-stage pipeline to process GPS data and display plow activity:

```
GPS Tracker (30s intervals)
    ↓
TCP Listener (receives raw GPS, stores in PostgreSQL)
    ↓
Redis Queue (batches 25 points = ~12.5 minutes)
    ↓
Background Workers (10 parallel) → OSRM map-matching
    ↓
cached_polylines table (pre-computed, ready to serve)
    ↓
Backend API (instant retrieval)
    ↓
Frontend (OpenLayers map)
```

**Key Design Decisions:**
- **Batch processing:** GPS points queued until 25 accumulate, then processed as a batch
- **Pre-computation:** OSRM map-matching done in background, results cached
- **Instant serving:** Frontend never waits for processing, only displays cached data
- **Parallel workers:** 10 workers process different batches simultaneously
- **Hybrid model:** Polylines trigger segment activations but aren't sent to frontend for resident view

---

## Road Segment Model: Architecture Decision

### The Problem with Pure Polyline Display

**Current polyline-only model issues:**
- Overlapping polylines create visual clutter
- Arrow placement becomes messy with multiple passes
- Hard to measure coverage ("has Main Street been plowed?")
- Deduplication is complex: cumulative overlaps, diverging paths, partial coverage
- Infinite growth: database and frontend must handle thousands of polylines per storm
- Performance degrades over time as polylines accumulate

### The Road Segment Solution

**Core concept:** Pre-segment all roads into 50m chunks, use polylines as triggers to activate segments.

**How it works:**
1. Town has predefined 50m road segments (imported from OSM once)
2. Vehicle drives → creates polyline (existing system, unchanged)
3. Polyline intersects road segments → updates segment timestamps
4. **Polylines never sent to frontend** - only used backend for activation
5. Frontend displays segments colored by recency, not polylines
6. Polylines stored for debugging/admin but not used for resident-facing visualization

**Hybrid architecture:**
- Polylines remain authoritative source (actual GPS-derived paths)
- Segments are visualization layer (what residents see)
- Best of both worlds: accuracy + clean display

### Benefits Analysis

**Visual clarity:**
- No overlap/deduplication needed (discrete segments)
- Clean visualization, solves arrow clutter naturally
- Segments colored by recency: green (recent) → red (old)
- Directional tracking: northbound vs southbound timestamps
- Partial coverage: "40% of this segment plowed" using ST_Length(ST_Intersection())

**Coverage metrics (B2G value):**
- Granular reporting: "50% of Main St cleared", "cleared both directions"
- Coverage statistics: "83% of roads serviced in last 6 hours"
- Frequency tracking: "Main Street plowed 3 times today"
- Better product for municipalities: they care about "which streets serviced" not "exact vehicle path"

**Performance & scalability:**
- VT has ~25,000 km of roads = 250,000 segments for entire state (at 100m each)
- Single town: 1,000-3,000 segments vs 9,000+ polylines from just a few drives
- **Fixed dataset size** - never grows (just timestamp updates)
- Frontend loads 1,000 objects once vs thousands that keep accumulating
- Mobile/slow devices: trivial to render, aggressive caching possible
- Network: download segments once, then only tiny timestamp updates via WebSocket
- Database: UPDATE operations only (no infinite INSERT growth)
- Queries stay fast - predictable, fixed dataset size

**Operational simplicity:**
- Complexity front-loaded in setup phase (OSM import, segmentation)
- Runtime is dead simple: polyline intersects segment → update timestamp
- No complex deduplication, filtering, or arrow logic during storms
- Easy to monitor: "are segments updating?" (binary yes/no)
- Fewer failure modes - simpler to debug
- **Perfect for solo operation:** system "just works" once configured
- **Critical for B2G:** can't afford complex failures during peak usage (winter storms)

### Database Complexity Trade-off

**More structured schema:**
- Multiple linked tables: `road_segments`, `municipalities`, `streets`, `segment_updates`
- More database relationships and foreign keys to manage
- Migrations more complex when onboarding new municipalities
- Schema changes affect multiple tables

**Trade-off analysis:**
- More upfront database design vs simpler runtime logic
- Is added database complexity worth the operational simplicity?

**Mitigation: AI-assisted iteration makes this practical**
- Can iterate on schema design locally many times before production
- Docker local development = safe experimentation environment
- Test with real GPS data from existing drives
- Drop/recreate tables freely during design phase
- AI helps with SQL syntax, PostGIS functions, migration scripts
- Reduces friction of database iteration by 10x
- Focus on design decisions, not syntax details
- Makes ambitious schema practical for solo developer

### Implementation Approach

**Preprocessing (automated):**
- Download OSM road data via Overpass API or Geofabrik extracts
- Filter for drivable roads: highway IN ('residential', 'primary', 'secondary', 'tertiary', 'unclassified', 'service')
- Use PostGIS ST_LineSubstring() to segment roads into 50m chunks
- Tools: osm2pgsql, osmium, Overpass Turbo
- One-time setup per municipality (can be automated with script)
- Per municipality: define boundary polygon → download roads → clip → segment → load to DB

**Processing flow:**
1. Vehicle reports GPS → create polyline (existing system, unchanged)
2. Worker processes polyline through OSRM (existing system, unchanged)
3. NEW: Check which road segments intersect with new polyline (PostGIS ST_Intersects)
4. NEW: For each intersecting segment:
   - Calculate overlap: ST_Length(ST_Intersection(polyline, segment)) / ST_Length(segment)
   - Determine direction: compare polyline bearing to segment bearing (within ±30° tolerance)
   - Update appropriate timestamp (northbound/southbound)
   - Update coverage_percentage
   - Increment plow_count_today
5. Frontend loads segments instead of polylines, colors by timestamp

**Map-matching criticality:**
- Accurate polyline-to-segment matching depends on good OSRM map-matching
- Already have this infrastructure in place
- May need to tune OSRM confidence thresholds

**Edge cases to consider:**
- What about roads not in OSM network? (driveways, parking lots, private roads)
- Handle segments that span municipality boundaries
- Roads that vehicles service but aren't "plowing" (salt spreading, sanding)

**Frontend changes:**
- Load road segments instead of polylines from API
- Color segments by recency (same gradient system)
- Show directional indicators if needed (northbound/southbound have different ages)
- Display partial coverage visually (segment partially colored)
- Arrows become less relevant or unnecessary

---

## Database Schema

### Road Segment Model Tables

**municipalities table:**
```sql
CREATE TABLE municipalities (
    id VARCHAR(50) PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    state VARCHAR(2) NOT NULL,
    boundary GEOMETRY(MultiPolygon, 4326),
    osm_relation_id BIGINT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

**streets table:**
```sql
CREATE TABLE streets (
    id SERIAL PRIMARY KEY,
    municipality_id VARCHAR(50) REFERENCES municipalities(id),
    street_name VARCHAR(200) NOT NULL,
    road_classification VARCHAR(50),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

**road_segments table:**
```sql
CREATE TABLE road_segments (
    id SERIAL PRIMARY KEY,
    municipality_id VARCHAR(50) REFERENCES municipalities(id),
    street_id INTEGER REFERENCES streets(id),
    geometry GEOMETRY(LineString, 4326) NOT NULL,
    segment_length NUMERIC(10, 2),
    bearing NUMERIC(5, 2) CHECK (bearing >= 0 AND bearing < 360),
    osm_way_id BIGINT,
    road_classification VARCHAR(50),
    street_name VARCHAR(200),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_road_segments_geom ON road_segments USING GIST (geometry);
CREATE INDEX idx_road_segments_municipality ON road_segments(municipality_id);
```

**segment_updates table:**
```sql
CREATE TABLE segment_updates (
    id SERIAL PRIMARY KEY,
    segment_id INTEGER REFERENCES road_segments(id),
    device_id INTEGER REFERENCES devices(id),
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    direction VARCHAR(20),
    coverage_percentage NUMERIC(5, 2)
);

CREATE INDEX idx_segment_updates_segment ON segment_updates(segment_id);
CREATE INDEX idx_segment_updates_time ON segment_updates(updated_at DESC);
```

### Schema Reference - Road Segments

**Key fields:**
- `road_segments.id` - Primary key (auto-increment)
- `road_segments.municipality_id` - Foreign key to municipalities
- `road_segments.geometry` - PostGIS LineString (4326 projection)
- `road_segments.segment_length` - Length in meters
- `road_segments.bearing` - Direction in degrees (0-360)
- `road_segments.street_name` - From OSM
- `road_segments.osm_way_id` - Original OSM way reference

**Indexes:**
- GIST spatial index on geometry (critical for performance)
- B-tree index on municipality_id
- Index on segment_updates(segment_id, updated_at)

---

## Implementation Status

### ✅ PHASE 1: FOUNDATION (COMPLETE)

**Database Schema:**
- Migration created: `004_add_road_segment_model.sql`
- Tables: `municipalities`, `streets`, `road_segments`, `segment_updates`
- PostGIS enabled: Using `postgis/postgis:16-3.4-alpine` Docker image

**OSM Import Tool:**
- Script: `/db/scripts/import-segments-only.js` (the safe version)
- Original script moved to deleted_scripts (had boundary assembly bug)
- Dependencies installed: `@turf/turf`, `node-fetch`, `pg`, `dotenv`
- Segment length: **50m** (configurable)
- Fixed multi-way boundary assembly issue with `fix-pomfret-osm.js`
- Fixed bearing calculation (defaults to 0 when calculation fails)

**Data Imported:**
- **Pomfret, VT:** 2,994 segments, 70 unique streets, 146.8 km total
- Municipality boundary properly assembled (102.45 km² - was 0.57 km² when broken)
- Some segments include driveways/rivers (needs filtering in future)

### ✅ PHASE 2: ACTIVATION LOGIC (COMPLETE)

**Segment activation is fully operational!**
- Workers automatically activate segments when polylines pass over them
- 4,105 segment activations recorded after first day
- PostGIS spatial matching working correctly
- `segment_updates` table populating with device/timestamp data
- No additional code needed - already implemented in worker

### ✅ PHASE 3: FRONTEND DISPLAY (COMPLETE)

**Segments displaying on map:**
- Frontend already loads and displays road segments
- Green = recently serviced/activated
- Red = not yet serviced
- Yellow/orange = older activations
- Segments properly colored by recency
- Map shows both segments AND GPS polylines (blue lines)

### 📊 PHASE 4: COVERAGE METRICS (FUTURE)

**Not yet implemented but data foundation exists:**
- Can calculate % coverage from segment_updates
- Directional tracking possible (bearing stored)
- Frequency tracking ready (count updates per segment)
- All data being collected, just needs reporting UI

### 🎯 CURRENT STATUS SUMMARY

**What's Working:**
- ✅ Complete end-to-end segment system operational
- ✅ GPS data → polylines → segment activation → display
- ✅ 2,994 road segments imported for Pomfret
- ✅ Real-time activation as vehicles drive
- ✅ Map showing green/red segments based on service status
- ✅ 10 parallel workers processing GPS data
- ✅ 27,600+ GPS points processed, 749 polylines created

**Known Issues to Address:**
- Some segments are actually rivers/driveways (need better OSM filtering)
- Some roads missing segments where OSM data incomplete
- Multi-municipality support needs testing

**Deprecated/Unnecessary Features:**
- ❌ Polyline deduplication - segments solve this
- ❌ Arrow clutter fixes - not needed with segments
- ❌ Complex overlap handling - segments are discrete

---

## Performance Characteristics

### Current Pomfret Stats
- **Segments:** 2,994 total
- **Total road length:** 146.8 km
- **Segment activations:** 4,105 after one day
- **Unique streets:** 70

### Scaling Projections

**Single municipality:**
- Small town (Pomfret): 1,000-3,000 segments
- Medium town (Woodstock): 3,000-5,000 segments
- Larger town (Hartford): 5,000-10,000 segments

**State-wide (Vermont):**
- Total roads: ~25,000 km
- At 100m segments: 250,000 segments
- At 50m segments: 500,000 segments

**Performance considerations:**
- Activation query uses GIST spatial index (fast)
- Fixed dataset size means predictable query performance
- Frontend loads segments once, then only timestamp updates
- Consider partitioning if > 100k segments across all municipalities

### Query Performance

**Critical queries:**
- Segment-polyline intersection: Uses GIST index on geometry
- Latest activations: Uses index on (updated_at DESC)
- Municipality filtering: Uses B-tree index on municipality_id

**Expected performance:**
- Single municipality segment load: < 100ms (1,000-3,000 records)
- Activation query per polyline: < 50ms (typically 5-20 segments)
- Frontend initial load: < 500ms total

---

## Implementation Strategy

**Phased approach:**
1. ✅ Import segments (done)
2. ✅ Implement activation logic (done)
3. ✅ Add frontend display (done)
4. 📊 Add coverage metrics (future)
5. 🔄 Gradually deprecate polyline display (future)

**Key principles:**
- Keep polylines as parallel system initially
- Test thoroughly with real GPS data
- Migrate gradually, not all at once
- Monitor performance at each step
- Can always roll back if issues arise

---

## Future Architecture Considerations

### Multi-Municipality Support

**Current state:**
- Single municipality (Pomfret) fully operational
- Schema supports multiple municipalities
- Need to test with 2+ municipalities active simultaneously

**Considerations:**
- Separate segments by municipality_id
- Frontend needs municipality selector or auto-detect by location
- Backend API needs efficient filtering by municipality
- Consider separate OSRM instances per municipality or shared routing graph

### Real-Time Updates

**Current state:**
- Frontend requires manual refresh
- Segments update in database but client doesn't know

**Future implementation:**
- WebSocket or Server-Sent Events connection
- Push only timestamp updates (tiny payload)
- Client updates segment colors without full reload
- Push new segment activations as they occur

### Historical Replay

**Use case:** Municipality wants to review past storm performance

**Implementation:**
- Query segment_updates with time filter
- Replay activations chronologically
- Show progression of coverage over time
- Export to video or report format

### Coverage Analytics

**Metrics to track:**
- % of total road network serviced in last X hours
- Average time between service for each street
- Frequency of service per segment
- Directional balance (both directions covered equally?)
- Identify underserved areas
- Compare performance across storms

---

## Technical Decisions Log

**Why 50m segments?**
- Small enough for granular tracking
- Large enough to avoid excessive database size
- Typical plow speed ~30-50 km/h means crossing segment in 3-6 seconds
- GPS reports every 30s, so multiple reports per segment

**Why PostGIS over alternatives?**
- Industry standard for spatial data
- Excellent performance with proper indexing
- Rich function library (ST_Intersects, ST_Length, ST_Intersection)
- Works seamlessly with PostgreSQL

**Why OSRM for map-matching?**
- Open source, self-hosted
- Fast (< 100ms per polyline)
- Good accuracy for road snapping
- Already integrated and working

**Why batch processing (25 points)?**
- Balances latency vs efficiency
- ~12.5 minutes of driving before processing
- Reduces OSRM API calls
- Allows for better path smoothing

**Why Redis for queuing?**
- Fast, reliable message queue
- Built-in data structures (lists)
- Easy to monitor queue depth
- Supports multiple workers naturally
