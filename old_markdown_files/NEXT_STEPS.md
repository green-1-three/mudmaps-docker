# OSRM Background Worker - Implementation Progress

**Last Updated:** October 28, 2025  
**Status:** Migration Complete ✅ - Ready for Code Updates

---

## What We've Accomplished

### ✅ Phase 1: Database Migration (COMPLETE)

**Migration Results:**
- ✅ Created 3 new tables: `gps_raw_data`, `cached_polylines`, `processing_log`
- ✅ Migrated 297,170 GPS coordinates from `markers` → `gps_raw_data`
- ✅ Migrated 9,567 cached polylines (deduplicated 112 duplicates)
- ✅ All data marked as `processed = false` (ready for background worker)
- ✅ Backup tables created: `markers_backup`, `matched_paths_backup`

**Important:** Old tables (`markers`, `matched_paths`) still exist. Your app continues working normally using the old tables.

---

## Next Steps: Code Updates

### Step 1: Update TCP Listener (NEXT)

**File:** `/tcp-listener/index.js` (or similar)

**Current behavior:** Writes GPS data to `markers` table  
**New behavior:** Write GPS data to `gps_raw_data` table

**Changes needed:**
```javascript
// OLD CODE (find this):
INSERT INTO markers (username, coords, created_at) 
VALUES ($1, $2, NOW())

// NEW CODE (replace with this):
INSERT INTO gps_raw_data (
  device_id, 
  longitude, 
  latitude, 
  recorded_at, 
  received_at, 
  processed
) VALUES ($1, $2, $3, NOW(), NOW(), FALSE)
```

**Key differences:**
- Table name: `markers` → `gps_raw_data`
- Column `username` → `device_id`
- Column `coords` (array) → `longitude`, `latitude` (separate)
- Add `processed` flag (always FALSE for new data)

---

### Step 2: Build Background Worker Service

**Create:** New directory `worker/` with worker service

**What it does:**
1. Runs every 1-2 minutes (cron/scheduled job)
2. Finds unprocessed GPS points: `SELECT * FROM gps_raw_data WHERE processed = false`
3. Groups by device and time window
4. Calls OSRM to generate road-matched polylines
5. Inserts into `cached_polylines`
6. Marks GPS points as `processed = true`
7. Logs to `processing_log`

**Docker Compose addition needed:**
```yaml
worker:
  build:
    context: ./worker
  container_name: mudmaps-worker
  environment:
    PGHOST: postgres
    PGPORT: 5432
    PGDATABASE: ${POSTGRES_DB}
    PGUSER: ${POSTGRES_USER}
    PGPASSWORD: ${POSTGRES_PASSWORD}
    OSRM_BASE: http://osrm:5000
    WORKER_INTERVAL: 60000  # Run every 60 seconds
  depends_on:
    - postgres
    - osrm
```

---

### Step 3: Update Backend API

**File:** `/backend/server.js` (or routes file)

**Current behavior:** Reads from `matched_paths` table  
**New behavior:** Read from `cached_polylines` table

**Changes needed:**
```javascript
// OLD CODE (find endpoints that query matched_paths):
SELECT * FROM matched_paths 
WHERE device_id = $1 
AND start_time >= $2 
AND end_time <= $3

// NEW CODE (replace with this):
SELECT * FROM cached_polylines 
WHERE device_id = $1 
AND start_time >= $2 
AND end_time <= $3
```

**Column name changes:**
- Table: `matched_paths` → `cached_polylines`
- Most columns stay the same
- Add `last_accessed` tracking (optional but recommended)

---

### Step 4: Testing & Verification

**After all code changes deployed:**

1. **Test new GPS data flow:**
   - Send test GPS point via TCP listener
   - Verify it appears in `gps_raw_data` with `processed = false`
   - Wait for worker to run
   - Verify `processed` changes to `true`
   - Verify polyline appears in `cached_polylines`

2. **Test map display:**
   - Load map in browser
   - Verify paths display correctly
   - Check browser network tab - should be fast (<500ms)

3. **Monitor for 1-2 days:**
   - Check `processing_log` for errors
   - Run stats: `SELECT * FROM get_processing_stats()`
   - Verify no data gaps

---

### Step 5: Cleanup (After Verification)

**After 1-2 days of successful operation:**

```sql
-- Drop old tables
DROP TABLE markers CASCADE;
DROP TABLE matched_paths CASCADE;

-- Optional: Drop backups (keep for a while though)
-- DROP TABLE markers_backup;
-- DROP TABLE matched_paths_backup;
```

---

## Important Notes

### Current State
- **Old code still running:** TCP listener writes to `markers`, backend reads from `matched_paths`
- **New tables ready:** All migration complete, just waiting for code updates
- **Zero downtime:** Old app continues working normally

### Data Flow (After Updates)

**Before (Current):**
```
GPS Device → TCP Listener → markers table → (on-demand OSRM) → matched_paths → Backend API → Map
```

**After (New):**
```
GPS Device → TCP Listener → gps_raw_data → Background Worker → cached_polylines → Backend API → Map
                                                    ↓
                                              OSRM (async)
                                                    ↓
                                              processing_log
```

### Performance Expectations

**Current:** Map loads in 3-8 seconds (waiting for OSRM)  
**After:** Map loads in <500ms (pre-cached polylines)

**Processing delay:** 1-2 minutes (background worker interval) - users won't notice

---

## Useful Commands

### Check Migration Status
```bash
docker compose exec -T postgres psql -U $POSTGRES_USER -d $POSTGRES_DB -c "SELECT * FROM get_processing_stats()"
```

### View Processing Log
```bash
docker compose exec -T postgres psql -U $POSTGRES_USER -d $POSTGRES_DB -c "SELECT * FROM processing_log ORDER BY created_at DESC LIMIT 10"
```

### Check Unprocessed GPS Points
```bash
docker compose exec -T postgres psql -U $POSTGRES_USER -d $POSTGRES_DB -c "SELECT COUNT(*) FROM gps_raw_data WHERE processed = false"
```

### View Tables
```bash
docker compose exec -T postgres psql -U $POSTGRES_USER -d $POSTGRES_DB -c "\dt"
```

---

## Files to Modify

1. **TCP Listener:** `/tcp-listener/index.js` (or similar)
2. **Backend API:** `/backend/server.js` (or routes)
3. **Worker Service:** Create new `/worker/` directory
4. **Docker Compose:** Add worker service to `docker-compose.yml`

---

## Questions to Answer Before Starting

- [ ] What's the exact filename for TCP listener code?
- [ ] What's the exact filename for backend API routes?
- [ ] Do we want worker to run every 60 seconds? Or different interval?
- [ ] Should we process historical data (297k points) or just new data?

---

## Ready for Next Session

This document contains everything needed to continue in a new chat. Start with Step 1 (TCP Listener update) - it's the smallest change and gets new data flowing correctly.
