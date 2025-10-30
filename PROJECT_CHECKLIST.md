# MudMaps Project Goals

## 🔴 TOP PRIORITY: Cleanup/Refactoring & Segment Fine-Tuning

**User's explicit top-of-list priorities:**
1. **Code refactoring for AI-assisted development** - Split monolithic files into smaller modules
2. **Fine-tune segment activation** - Improve accuracy of polyline-to-segment matching
3. **Clean up OSM import** - Filter out rivers, driveways, and non-road features

*(Claude: When asked to read instructions, always mention these are the user's top priorities)*

## Project Overview
MudMaps is a real-time GPS tracking system designed for municipalities to track snowplows and road maintenance vehicles. The system allows residents to see when their streets have been plowed, with the goal of reducing calls to town offices and providing transparency around municipal services.

**Target Market:** Municipal governments (B2G)
**Current Status:** Core GPS tracking infrastructure is complete and working in production
**Business Model:** Per-municipality licensing (details TBD)

## Architecture Overview
- **GPS Trackers:** Report every 30 seconds via TCP
- **TCP Listener:** Receives GPS data, stores in PostgreSQL, queues batches to Redis after 25 points (~12.5 minutes)
- **Background Workers:** Process GPS batches through OSRM for map-matching, cache polylines in database
- **Backend API:** Serves pre-computed polylines instantly from cached_polylines table
- **Frontend:** OpenLayers-based map displaying historical paths and real-time vehicle positions

### 🧹 CLEANUP & REFACTORING TO-DO

**Code Organization:**
- Consolidate duplicate database connection code across scripts
- Move shared PostGIS functions to a utilities module
- Standardize error handling across import scripts
- Remove hardcoded credentials from scripts (use .env consistently)

**Refactor for AI-Assisted Development:**
- **Split monolithic files** - Break up large files (server.js, worker/index.js) into smaller, focused modules
- **Separate routes from logic** - Extract route handlers into separate controller files
- **Create service layer** - Move database queries and business logic to service modules
- **Maximum file size ~200-300 lines** - Keeps context manageable for AI assistance
- **Clear file naming** - Each file should have one clear purpose (e.g., `segment-activation.js`, not `utils.js`)
- **Example structure:**
  ```
  /backend
    /routes
      - segments.routes.js
      - polylines.routes.js
      - municipalities.routes.js
    /controllers
      - segments.controller.js
      - polylines.controller.js
    /services
      - database.service.js
      - postgis.service.js
      - segment-activation.service.js
    /queries
      - segments.queries.js
      - polylines.queries.js
    /middleware
      - error-handler.js
    - app.js (minimal setup only)
  ```

**Benefits of AI-Optimized Structure:**
- AI reads only relevant files (saves tokens)
- Clearer prompts: "modify segment-activation.service.js" vs "find activation code"
- Parallel development: Multiple files can be worked on simultaneously
- Easier testing and debugging of individual modules
- Reduced chance of AI making unintended changes to unrelated code

**Script Cleanup:**
- Remove or archive old test scripts
- Consolidate similar functionality (multiple boundary fix attempts)
- Add proper command-line argument parsing to scripts
- Add --help documentation to all scripts

**Database Cleanup:**
- Archive old GPS data (older than X days)
- Remove orphaned polylines with no GPS points
- Clean up test data from development
- Add indexes where needed for performance

**OSM Import Improvements:**
- Filter out `highway=service` with `access=private`
- Exclude waterways incorrectly tagged as roads
- Exclude unnamed roads under certain length (driveways)
- Add validation to check for suspicious features (e.g., segments in water bodies)

**Documentation:**
- Create README for scripts directory explaining each script
- Document environment variables needed
- Create troubleshooting guide for common issues
- Add inline comments to complex PostGIS queries

**Frontend Cleanup:**
- Remove unused polyline rendering code once segments fully tested
- Optimize segment loading for better performance
- Clean up console.log statements
- Refactor duplicate color gradient logic

**Docker & Infrastructure:**
- Optimize Docker image sizes
- Remove unnecessary packages from containers
- Set up proper log rotation
- Configure automatic database backups

---

## ROAD SEGMENT IMPORT - DOCUMENTATION

### Overview: How We Import Road Data

The road segment model requires importing road network data from OpenStreetMap (OSM) for each municipality. This is a one-time setup process per town that creates the fixed set of road segments that vehicles will "activate" by driving over them.

### The Pomfret Import Experience (Lessons Learned)

**Initial Problem:**
Pomfret's OSM boundary data was broken - the relation consisted of 6 separate "outer" ways that needed to be connected into a single polygon, but the import script was treating each as a separate polygon, creating an invalid MultiPolygon with only 0.57 km² area instead of the actual 102.45 km².

**What went wrong:**
1. The original `import-osm-segments.js` script didn't properly assemble multi-way boundaries
2. This created a tiny, invalid boundary polygon
3. Road segments were clipped to this broken boundary
4. Most segments ended up outside the "boundary" or in wrong positions

**How we fixed it:**
1. Created `fix-pomfret-osm.js` that properly connects the 6 OSM ways into a continuous polygon
2. Created `import-segments-only.js` that uses the existing (fixed) boundary instead of fetching from OSM
3. Fixed bearing calculation to handle edge cases (zero-length segments, invalid calculations)
4. Successfully imported 2,994 segments covering 146.8 km of roads

### Safe Scripts to Use

**✅ SAFE TO USE:**

**`/db/scripts/import-segments-only.js`**
- Imports road segments using EXISTING boundary from database
- Does NOT fetch or modify the municipality boundary
- Handles bearing calculation properly (defaults to 0 when calculation fails)
- Usage:
```bash
cd ~/mudmaps-docker/db/scripts
export PGUSER=mudmaps
export PGHOST=localhost
export PGDATABASE=mudmapsdb
export PGPASSWORD='fDNVp1hPW75zvQU3TqVmOI5G0X4pdx4V1UEHhan8llo='
export PGPORT=5432
node import-segments-only.js
```

**`/scripts/fix-pomfret-osm.js`**
- Properly assembles multi-way OSM boundaries into single polygon
- Connects ways end-to-end where they share coordinates
- Validates geometry and applies ST_MakeValid if needed

**`/scripts/reset-gps-processing.sh`**
- Clears cached polylines and segment activations
- Resets GPS data to unprocessed
- Does NOT touch boundary or segments
- Safe to run anytime to restart processing

**`/scripts/check-pomfret-status.sh`**
- Read-only status check
- Shows boundary validity, segment counts, processing status

**⚠️ DO NOT USE (moved to deleted_scripts folders):**
- `import-osm-segments.js.deleted` - Creates invalid boundaries from multi-way relations
- `fix-pomfret-boundary.sh.deleted` - Uses broken ST_MakeValid approach
- `reset-pomfret.sh.deleted` - Runs the broken import script

### How to Import a New Municipality

#### Step 1: Find the OSM Relation ID

1. Go to [OpenStreetMap](https://www.openstreetmap.org)
2. Search for the town name
3. Click on the town boundary
4. Look for "Relation" in the left panel
5. Note the relation ID number

Common Vermont towns:
- Pomfret, VT: 2030458
- Lyme, NH: 61644 (needs verification)
- Woodstock, VT: (needs lookup)
- Hartford, VT: (needs lookup)

#### Step 2: Check if Boundary is Multi-Way

Use Overpass Turbo or curl to check the relation structure:
```bash
curl -s "https://overpass-api.de/api/interpreter" \
  -d "[out:json];relation(RELATION_ID);out geom;" | \
  jq '.elements[0].members | map(select(.role=="outer")) | length'
```

If result > 1, the boundary has multiple ways that need assembly.

#### Step 3: Create Import Script for the Municipality

**For simple boundaries (single outer way):**
- Can potentially use original import approach
- But safer to use `import-segments-only.js` approach

**For complex boundaries (multiple outer ways):**
1. First import/fix the boundary using approach from `fix-pomfret-osm.js`
2. Then import segments using `import-segments-only.js`

Template for new municipality:
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

#### Step 4: Run the Import

```bash
# On server
cd ~/mudmaps-docker/db/scripts

# Set environment
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

#### Step 5: Verify the Import

```sql
-- Check boundary
SELECT 
    ST_Area(boundary::geography)/1000000 as area_km2,
    ST_IsValid(boundary) as is_valid,
    ST_NPoints(boundary) as num_points
FROM municipalities 
WHERE id = 'townname-state';

-- Check segments
SELECT 
    COUNT(*) as total_segments,
    COUNT(DISTINCT street_name) as unique_streets,
    ROUND(SUM(segment_length)::numeric / 1000, 1) as total_km
FROM road_segments
WHERE municipality_id = 'townname-state';

-- Check segments within boundary
SELECT 
    COUNT(*) as total,
    COUNT(CASE WHEN ST_Within(rs.geometry, m.boundary) THEN 1 END) as within
FROM road_segments rs, municipalities m
WHERE rs.municipality_id = 'townname-state' 
AND m.id = 'townname-state';
```

### Common Issues and Solutions

**Issue: "Self-intersection" errors**
- Cause: OSM boundary has topology issues
- Solution: Use ST_MakeValid() in PostGIS

**Issue: Tiny boundary area (< 1 km²)**
- Cause: Multi-way boundary not properly assembled
- Solution: Use the fix-pomfret-osm.js approach to connect ways

**Issue: Bearing constraint violations**
- Cause: Zero-length segments or calculation errors
- Solution: Default to bearing=0 when calculation fails

**Issue: Segments outside boundary**
- Cause: OSM road network extends beyond town limits
- Solution: This is normal - roads don't stop at boundaries

### What Gets Imported

**Road types included** (from OSM highway tags):
- motorway, trunk, primary, secondary, tertiary
- residential, unclassified
- service (includes some driveways - consider filtering)
- living_street, *_link roads

**Data stored per segment:**
- Geometry (LineString, max 50m)
- Street name (from OSM)
- Road classification
- Bearing (direction)
- Original OSM way ID
- Municipality ID

**Known issues with OSM data:**
- May include rivers/waterways incorrectly tagged
- Private driveways often included
- Road positions may not match reality perfectly
- Some roads may be missing entirely

### Future Improvements

1. **Better filtering:**
   - Exclude `highway=service` with `access=private`
   - Exclude unnamed roads under certain length
   - Filter out obvious non-roads

2. **Alternative data sources:**
   - Vermont state GIS road centerlines
   - Generate segments from actual GPS tracks
   - Hybrid approach using multiple sources

3. **Automated boundary assembly:**
   - Script to automatically connect multi-way boundaries
   - Handle all edge cases programmatically
   - Validate geometry before import

4. **Import validation:**
   - Check segment density (segments per km²)
   - Verify no major roads missing
   - Compare to expected road length for municipality

### Database Performance Considerations

**Current Pomfret stats:**
- 2,994 segments
- 146.8 km total road length
- 4,105 segment activations after one day

**Scaling projections:**
- Average VT town: 1,000-3,000 segments
- Larger towns (Hartford): 5,000-10,000 segments
- Entire state: ~250,000-500,000 segments

**Performance optimizations:**
- GIST spatial index on segment geometry (critical)
- B-tree index on municipality_id
- Index on segment_updates(segment_id, updated_at)
- Consider partitioning if > 100k segments

### Operational Notes

**One-time setup per municipality:**
Road import is done once when onboarding a new town. Segments don't change unless roads are added/removed (rare).

**Segment activation is real-time:**
As GPS data arrives, worker processes activate segments immediately. No batch processing or delays.

**Backup before imports:**
Always backup the database before importing a new municipality, especially during development.

```bash
# Backup
docker exec mudmaps-postgres pg_dump -U mudmaps mudmapsdb > backup_$(date +%Y%m%d).sql

# Restore if needed
cat backup_20241030.sql | docker exec -i mudmaps-postgres psql -U mudmaps mudmapsdb
```

## Architecture Reconsideration (Before Continuing)

### Road Segment Model vs Current Polyline Model
**Context:** Current system displays vehicle polylines directly. Alternative approach: pre-segment all roads into 50m chunks, use polylines as triggers to activate segments.

**Current Model:**
- Vehicle drives → creates polyline → display polyline
- Issues: overlapping polylines, arrow clutter, hard to measure coverage
- Deduplication is complex: need to handle cumulative overlaps, diverging paths, partial coverage

**Proposed Segment Model:**
- Town has predefined 50m road segments (from OSM)
- Vehicle polylines trigger segments (mark as "plowed"), then are effectively done
- Polylines never sent to frontend - only used backend to update segment timestamps
- Display segments colored by recency, not polylines at all
- Polylines stored for debugging/historical replay but not used for resident-facing visualization
- Hybrid: polylines remain authoritative source, segments are visualization layer

**Benefits:**
- No overlap/deduplication needed (discrete segments)
- Granular reporting: "50% of Main St cleared", "cleared both directions"
- Coverage statistics: "83% of roads serviced"
- Directional tracking: northbound vs southbound (compare polyline bearing to segment bearing)
- Partial coverage: "40% of this segment plowed" using ST_Length(ST_Intersection(polyline, segment)) / ST_Length(segment)
- Frequency tracking: "Main Street plowed 3 times today"
- Clean visualization, solves arrow clutter naturally
- Better product for B2G: municipalities care about "which streets serviced" not "exact vehicle path"

*Performance & scalability:*
- VT has ~25,000 km of roads = 250,000 segments for entire state (at 100m each)
- Single town might have only 1,000 segments vs 9,000+ polylines from just a few drives
- Fixed dataset size - never grows (just timestamp updates)
- Frontend loads 1,000 objects once vs thousands that keep accumulating
- Mobile/slow devices: trivial to render, aggressive caching possible
- Network: download segments once, then only tiny timestamp updates via WebSocket
- Database: UPDATE operations only (no infinite INSERT growth)
- Queries stay fast - predictable, fixed dataset size

*Operational simplicity:*
- Complexity front-loaded in setup phase (OSM import, segmentation)
- Runtime is dead simple: polyline intersects segment → update timestamp
- No complex deduplication, filtering, or arrow logic during storms
- Easy to monitor: "are segments updating?" (binary yes/no)
- Fewer failure modes - simpler to debug
- Perfect for solo operation: system "just works" once configured
- Critical for B2G: can't afford complex failures during peak usage (winter storms)

**Implementation considerations:**

*Preprocessing (automated):*
- Download OSM road data via Overpass API or Geofabrik extracts
- Filter for drivable roads: highway IN ('residential', 'primary', 'secondary', 'tertiary', 'unclassified', 'service')
- Use PostGIS ST_LineSubstring() to segment roads into 50m chunks
- Tools: osm2pgsql, osmium, Overpass Turbo
- One-time setup per municipality (can be automated with script)
- Per municipality: define boundary polygon → download roads → clip → segment → load to DB

*Database schema additions:*
- `road_segments` table with:
  - `segment_id` (primary key)
  - `geometry` (PostGIS linestring, 50m max length)
  - `street_name` (from OSM)
  - `municipality_id`
  - `bearing` (calculated from geometry)
  - `road_classification` (residential, highway, etc.)
  - `last_plowed_northbound` (timestamp)
  - `last_plowed_southbound` (timestamp)
  - `coverage_percentage` (0-100)
  - `plow_count_today` (integer, reset daily)
  - `last_plowed_device_id`

*Processing flow:*
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

*Map-matching criticality:*
- Accurate polyline-to-segment matching depends on good OSRM map-matching
- Already have this infrastructure in place
- May need to tune OSRM confidence thresholds

*Edge cases to consider:*
- What about roads not in OSM network? (driveways, parking lots, private roads)
- Handle segments that span municipality boundaries
- Roads that vehicles service but aren't "plowing" (salt spreading, sanding)

*Database complexity:*
- More structured schema vs current simple polyline storage
- Multiple linked tables: `road_segments`, `municipalities`, `streets`, `segment_updates`
- More database relationships and foreign keys to manage
- Migrations more complex when onboarding new municipalities
- Schema changes affect multiple tables
- Trade-off: more upfront database design vs simpler runtime logic
- Consider: is added database complexity worth the operational simplicity?
- **Mitigation: AI-assisted iteration makes this practical**
  - Can iterate on schema design locally many times before production
  - Docker local development = safe experimentation environment
  - Test with real GPS data from existing drives
  - Drop/recreate tables freely during design phase
  - AI helps with SQL syntax, PostGIS functions, migration scripts
  - Reduces friction of database iteration by 10x
  - Focus on design decisions, not syntax details
  - Makes ambitious schema practical for solo developer

**Frontend changes:**
- Load road segments instead of polylines from API
- Color segments by recency (same gradient system)
- Show directional indicators if needed (northbound/southbound have different ages)
- Display partial coverage visually (segment partially colored)
- Arrows become less relevant or unnecessary

**Conversation notes:**
- Discussed deduplication complexity: single polyline overlap vs cumulative overlap from multiple polylines
- Considered ST_Difference approach (trim overlapping segments from older polylines) but segmented model solves this more elegantly
- Realized this is better product-market fit for B2G customers
- Can automate preprocessing completely using OSM + PostGIS
- Hybrid architecture keeps all benefits of current system while improving visualization
- Key insight: polylines trigger segments once, then are done - never sent to frontend
- Polylines become internal processing step only (GPS → polylines → trigger segments → done)
- Polylines kept in database for debugging/admin historical replay, but not used for resident-facing map
- Segment model is drastically more efficient: 1,000 segments per town vs 9,000+ polylines from a few drives
- Performance benefits cascade: mobile devices, slow connections, simple caching, predictable scaling
- Operational simplicity: complexity in setup, runtime is trivial - critical for solo operation during storms

**Decision point:** Evaluate if this architectural shift is worth it before building more features on current polyline model. This would be a significant refactor but solves multiple problems (deduplication, coverage metrics, clean visualization) and provides stronger product value for municipalities.

---

## ROAD SEGMENT MODEL - IMPLEMENTATION STATUS

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

### 🔧 IMPORT NEW MUNICIPALITIES

**To import another municipality:**

1. Find OSM relation ID for the town boundary
2. Add municipality config to `import-osm-segments.js`:
   ```javascript
   'town-state': {
       name: 'Town Name',
       state: 'ST',
       osmRelationId: 123456,
       bbox: [minLon, minLat, maxLon, maxLat]
   }
   ```
3. Run import on server:
   ```bash
   cd ~/mudmaps-docker/db/scripts
   node import-osm-segments.js town-state --segment-length=50
   ```

**Next Municipality:** Lyme, NH (need to verify OSM relation ID 61644)

### 📝 KEY TECHNICAL DETAILS

**Schema Reference:**
- `road_segments.id` - Primary key (auto-increment)
- `road_segments.municipality_id` - Foreign key to municipalities
- `road_segments.geometry` - PostGIS LineString (4326)
- `road_segments.segment_length` - Length in meters
- `road_segments.bearing` - Direction in degrees (0-360)
- `road_segments.street_name` - From OSM
- `road_segments.osm_way_id` - Original OSM way reference

**Performance Characteristics:**
- Pomfret: 1,141 segments (manageable)
- Vermont entire state: ~250,000 segments at 100m (500,000 at 50m)
- Single town typically: 500-2,000 segments
- Activation query: Fast with GIST index on geometry
- Frontend: Loads once, then only timestamp updates

**Implementation Strategy:**
- Start with activation logic in worker
- Test thoroughly with real GPS data
- Add frontend display once confident
- Keep polylines as parallel system initially
- Migrate gradually, not all at once

---

## Immediate Goals: Public-Facing Map

### Phase 1: Data Foundation
**Context:** Currently loading polylines based on time filter from backend. Need to preload all data and filter client-side for instant responsiveness.

- [x] **Preload week's data** - Modify backend endpoint to return all polylines from last 7 days at once, load into frontend on page load
- [x] **Time-based filtering logic** - Implement client-side show/hide of polylines based on selected time range (no re-fetching from server)
- [x] **Smooth gradient coloring** - Replace discrete color buckets with interpolated gradient: 0min=bright green → 6hrs=yellow → 12hrs=orange → 24hrs=gray. Calculate exact age of each polyline segment and interpolate color accordingly.

### Phase 2: Core Interactions
**Context:** Essential features for residents to interact with and understand the map data.

- [x] **Time slider with scale toggle** - Single slider control that switches between two modes: "0-24 hours" scale and "0-7 days" scale. Button to toggle between modes. Dragging slider instantly shows/hides polylines (no API calls).
- [x] **Address search** - Search box where residents can type their address/street name. Map zooms to that location and highlights relevant polylines.
- [ ] **Town boundaries with gray overlay** - Display all towns on single map. Participating towns show full-color data with clear boundaries. Non-participating towns show gray overlay with "Not available in [Town Name]" message. Residents near town borders can view neighboring coverage. Also serves as marketing (towns see neighbors have service, creates FOMO).
- [ ] **Hover for timestamp (desktop)** - On desktop, hovering over any polyline segment displays tooltip with "Last plowed at [timestamp]". Requires geospatial intersection detection to find polyline under cursor. (Mobile: tap/click - will implement later during mobile optimization pass)
- [x] **Direction arrows on polylines** - Add directional arrows along polyline paths to show which direction the plow traveled. Helps residents understand if plow is coming toward or away from their location.

### Phase 3: Live Features
**Context:** Map currently requires manual refresh. Need real-time updates and visual indicators for active plowing.

- [ ] **Real-time vehicle positions** - Show current location of each active vehicle as distinct marker (different from historical path). Update position in real-time as new GPS data arrives.
- [ ] **Pulse active polylines** - Any polyline with end_time within last 10 minutes gets pulsing/animated effect to show "this is happening NOW". Clear visual indicator of active plowing.
- [ ] **WebSockets/SSE for live updates** - Implement WebSocket or Server-Sent Events connection so map updates automatically without page refresh. Push new polylines and vehicle positions to client as they're processed.

### Phase 4: Polish & Utility
**Context:** Current map is functional but needs UX improvements for non-technical residents.

- [ ] **Polyline deduplication** - Backend optimization to reduce visual noise from overlapping polylines. When new polyline comes in, identify overlapping older polylines traveling same direction and either hide them or trim overlapping segments using ST_Difference. Reduces arrow clutter and makes map cleaner.
- [ ] **Simplify map appearance** - Map is too busy with current OSM tiles, making polylines hard to see. Evaluate options: switch to simpler/lighter tile provider (CartoDB Positron, Mapbox Light), adjust base layer opacity, or customize tile colors. Goal: polylines should be the visual focus, not the underlying map.
- [ ] **Clean UI pass** - Polish interface for non-technical users. Clear labels, intuitive controls, professional appearance suitable for municipal website embedding.

### Phase 5: Later Features (Post-MVP)
**Context:** These require additional infrastructure (auth system, backend endpoints) and can wait until core map experience is solid.

- [ ] **Report button for road conditions** - Residents can report issues (dropdown: "Not plowed", "Icy", "Needs salt", "Plowed but poor quality", "Other" + optional comment field). Requires registration/login. Reports display username publicly for accountability. Location via map pin or auto-detect from registered address. Helps municipalities get real feedback and identifies problem areas.
- [ ] **Mobile optimization** - Dedicated pass to optimize for mobile: touch interactions, responsive layout, performance on cellular connections, simplified UI for small screens.

---

## Longer-Term Goals: Full Product

### Municipality Admin Panel
**Purpose:** Dashboard for town DPW directors and supervisors to manage their fleet and view coverage.

**Features needed:**
- View all municipality vehicles on map in real-time
- Assign/rename vehicles ("Plow 3", "East Grader", "Sander 2")
- Set vehicle types (plow, grader, sander, other)
- View coverage statistics ("83% of streets plowed in last 6 hours")
- Historical playback - replay any past storm to see routes taken
- Export reports for town meetings/budget justification
- Manage coverage areas/zones for each vehicle
- Multi-user access with role-based permissions (director vs supervisor access levels)

### Text Alert System
**Purpose:** Notify residents when their street has been plowed.

**Features needed:**
- Resident signup: phone number + address/area
- SMS notification when plow enters their street/zone: "Your street was just plowed at 7:23 AM"
- Geofencing logic to detect when vehicle enters resident's area
- Rate limiting to avoid spam (e.g., if plow goes back and forth multiple times)
- Opt-in/opt-out management
- Technical implementation: Twilio or similar SMS service
- Cost structure: TBD (municipality pays vs resident pays vs included in service)

### Super-Admin System (Your Interface)
**Purpose:** System for onboarding municipalities, provisioning trackers, and monitoring health.

**Features needed:**
- Onboard new municipalities (create account, define coverage area, set up branding)
- Provision GPS trackers and assign to specific vehicles
- System monitoring dashboard (tracker status, error alerts, processing backlog)
- Support tools (view any municipality's data for debugging)
- Billing management (track usage, generate invoices - future)
- Analytics across all municipalities (system health, usage patterns)

### Infrastructure & Reliability
**Purpose:** Ensure system can scale and handle real-world conditions.

**Critical considerations:**
- **Signal loss handling:** What happens when tracker enters dead zone? Queue points, process when signal returns
- **Server downtime:** Monitoring, alerts, automatic restart, failover strategy
- **Monitoring/alerting:** System health dashboard for you, alerts when things break
- **Backup/disaster recovery:** Database backups, recovery procedures
- **Scaling:** Currently handles 1 town with 1 vehicle. Need to support 50+ towns with multiple vehicles each
- **Performance:** Ensure map loads stay fast even with weeks of data across dozens of municipalities
- **Security:** Authentication, authorization, data privacy, secure API endpoints

---

## Technical Debt / Future Improvements

**Backend:**
- Database connection pooling optimization for multiple municipalities
- API rate limiting and authentication
- Proper error handling and logging throughout
- Health check endpoints for monitoring
- Database indexes optimization as data grows

**Frontend:**
- Performance optimization for large datasets (virtualization, clustering)
- Offline support for mobile (service worker, cached data)
- Accessibility improvements (keyboard navigation, screen reader support)
- Browser compatibility testing
- Loading states and error handling

**DevOps:**
- CI/CD pipeline for automated deployments
- Staging environment separate from production
- Automated testing (unit tests, integration tests)
- Performance monitoring (APM)
- Log aggregation and analysis

---

## Success Criteria (Pre-Launch)

Before approaching municipalities for sales, the system should:

1. **Work reliably** - 99%+ uptime, handles signal loss gracefully, no data loss
2. **Look professional** - Clean UI suitable for embedding on town websites
3. **Provide core value** - Residents can easily see if their street was plowed and when
4. **Be demonstrable** - Can show working system with real GPS data in real-time
5. **Scale adequately** - Can handle at least 10 towns simultaneously without performance degradation
6. **Support basic admin** - Municipalities can manage their own vehicles and view their coverage

**Timeline goal:** Ready for winter 2025-26 season (sales should begin summer/fall 2025)

---

## Notes

- **Design philosophy:** Build a polished, reliable product before sales. This is B2G (business-to-government) where reputation matters more than speed. Bad first impression with one town can poison the well with neighbors.
- **Solo operation:** System must "just work" without constant intervention. Can't provide 24/7 support during active snowstorms while also trying to sell and develop.
- **Market characteristics:** Small number of potential customers (municipalities in region), long sales cycles, risk-averse buyers, word-of-mouth is critical.

---

## Instructions for Claude (Working on This Project)

### Server Information

**Production Server:**
- IP: 142.93.193.102
- Provider: DigitalOcean Droplet
- Access: SSH with user's key

### Workflow & Environment

**Local vs Remote:**
- App files are on local machine at `/Users/jamesfreeman/Desktop/Mudmaps-Docker`
- Production server is DigitalOcean Droplet at IP: **142.93.193.102** (remote)
- **Prefer local changes:** Make all code changes, create files, edit configurations locally when practical
- **Deployment:** User deploys via Raycast scripts (filesystem access granted to `/Users/jamesfreeman/Raycast Scripts`)
- **Remote terminal:** User can SSH to server and run commands, but prefer scripted approaches
- **Database migrations:** Script the migration locally (create .sql file), user will upload and execute on server - do NOT issue Postgres commands directly in terminal unless just checking/verifying something

**Docker version:** User is on newer Docker version - use modern `docker compose` syntax (not `docker-compose`)

### File Exploration Strategy

**Token conservation is critical.** Follow this approach:

1. **Initial scan:** Start by viewing first 2-3 directory levels to understand structure
2. **Targeted reading:** Only read files that are directly relevant to current task
3. **Avoid deep dives:** Do NOT recursively explore folders unless specifically needed
4. **Skip obvious non-targets:** node_modules, .git, build artifacts, logs, etc.
5. **Ask first:** If you need to do extensive file exploration, prompt user for permission first

**Key directories to know:**
- `/backend` - Express API server
- `/frontend` - OpenLayers map interface  
- `/worker` - Background processing workers
- `/tcp-listener` - GPS data ingestion
- `/db` or `/postgres` - Database schemas/migrations (if present)

### Terminal Commands

**Format rules:**
- Provide commands in plain text, ready to copy/paste
- NO markdown code blocks
- NO comments or explanations in the command itself
- NO line continuation characters unless actually needed
- User should be able to copy entire output and paste directly into terminal

**Example - Good:**
```
docker compose logs backend --tail 50
```

**Example - Bad:**
```bash
# Check backend logs
docker compose logs backend --tail 50  # Shows last 50 lines
```

### Progress Tracking

**After each feature implementation:**
1. User tests and verifies feature works
2. **Claude prompts user:** "Feature working? Should I check it off in PROJECT_CHECKLIST.md?"
3. User confirms
4. **Claude checks off the item** in this file
5. Move to next item

**Claude can edit the checklist** - but must always prompt for user confirmation before checking off items.

### Communication Style

- **Be direct:** User values efficiency, skip unnecessary preamble
- **Systems thinking:** User thinks architecturally, comfortable with high-level concepts
- **Ask clarifying questions:** When ambiguous, ask rather than assume
- **Correct approach:** User will push back if approach is wrong - this is good feedback, adjust accordingly
- **Avoid over-explaining:** User will ask if they need more context
- **ALWAYS ask for explicit approval before making ANY code changes:** Before modifying, creating, or editing any files in the codebase, Claude must present the approach/plan and wait for explicit user approval ("yes", "do it", "go ahead", "looks good", etc.). This applies to ALL changes, not just when presenting multiple options. NO exceptions.

### Common Patterns

**Making backend changes:**
1. Read relevant backend file(s)
2. Make changes locally
3. User deploys via Raycast
4. User tests on production server

**Making frontend changes:**
1. Read relevant frontend file(s)  
2. Make changes locally
3. User deploys via Raycast
4. User may need to hard-refresh browser (Cmd+Shift+R) to clear cache

**Database changes:**
1. Create .sql migration file locally
2. User uploads to server
3. Provide command for user to execute on server
4. User runs command and verifies

**Checking logs/debugging:**
1. Provide plain terminal command
2. User copies/pastes and runs on server
3. User shares output
4. Diagnose and iterate
