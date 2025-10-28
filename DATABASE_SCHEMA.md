# Database Schema - Clean Design
## OSRM Background Worker Architecture

**Date:** October 28, 2025  
**Decisions:** Rename markers → gps_raw_data, no retention policy, clean slate

---

## New Schema Design

### Table 1: `gps_raw_data` (Input Layer)

**Purpose:** Store all incoming GPS points from devices

```sql
CREATE TABLE gps_raw_data (
    id BIGSERIAL PRIMARY KEY,
    
    -- Device identification
    device_id TEXT NOT NULL,
    
    -- GPS coordinates
    longitude DOUBLE PRECISION NOT NULL,
    latitude DOUBLE PRECISION NOT NULL,
    
    -- Timestamps
    recorded_at TIMESTAMPTZ NOT NULL,  -- When GPS was recorded
    received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),  -- When we received it
    
    -- Processing tracking
    processed BOOLEAN NOT NULL DEFAULT FALSE,
    batch_id UUID,  -- Groups coordinates for batch processing
    
    -- Metadata (optional, for future use)
    altitude DOUBLE PRECISION,
    accuracy DOUBLE PRECISION,
    speed DOUBLE PRECISION,
    bearing DOUBLE PRECISION,
    
    -- Constraints
    CONSTRAINT valid_coordinates CHECK (
        longitude BETWEEN -180 AND 180 AND
        latitude BETWEEN -90 AND 90
    )
);

-- Indexes for fast queries
CREATE INDEX idx_gps_unprocessed 
    ON gps_raw_data(device_id, processed, recorded_at)
    WHERE processed = FALSE;

CREATE INDEX idx_gps_device_time 
    ON gps_raw_data(device_id, recorded_at DESC);

CREATE INDEX idx_gps_batch 
    ON gps_raw_data(batch_id)
    WHERE batch_id IS NOT NULL;

-- Comment for documentation
COMMENT ON TABLE gps_raw_data IS 'Raw GPS coordinates from all devices. Never deleted - kept indefinitely for historical analysis.';
COMMENT ON COLUMN gps_raw_data.processed IS 'TRUE when this coordinate has been processed into a cached polyline';
COMMENT ON COLUMN gps_raw_data.batch_id IS 'Groups coordinates that were processed together in a single OSRM call';
```

---

### Table 2: `cached_polylines` (Output Layer)

**Purpose:** Store processed, ready-to-display polylines

```sql
CREATE TABLE cached_polylines (
    id BIGSERIAL PRIMARY KEY,
    
    -- Device and time range
    device_id TEXT NOT NULL,
    start_time TIMESTAMPTZ NOT NULL,
    end_time TIMESTAMPTZ NOT NULL,
    
    -- Display data
    encoded_polyline TEXT NOT NULL,  -- Google's encoded polyline format
    osrm_confidence FLOAT,  -- OSRM's confidence score (0-1)
    
    -- Metadata
    point_count INTEGER NOT NULL,  -- Number of GPS points used
    osrm_duration_ms INTEGER,  -- How long OSRM took
    
    -- Tracking
    batch_id UUID NOT NULL,  -- Links back to gps_raw_data.batch_id
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Access tracking (for future optimization)
    last_accessed TIMESTAMPTZ,
    access_count INTEGER DEFAULT 0,
    
    -- Ensure no duplicate paths for same time range
    UNIQUE(device_id, start_time, end_time)
);

-- Indexes for fast retrieval
CREATE INDEX idx_cached_device_time 
    ON cached_polylines(device_id, start_time DESC, end_time DESC);

CREATE INDEX idx_cached_recent 
    ON cached_polylines(created_at DESC);

CREATE INDEX idx_cached_batch 
    ON cached_polylines(batch_id);

-- Optional: Index for finding popular paths (future optimization)
CREATE INDEX idx_cached_popular 
    ON cached_polylines(access_count DESC, last_accessed DESC)
    WHERE access_count > 5;

-- Comment for documentation
COMMENT ON TABLE cached_polylines IS 'Pre-computed road-matched polylines ready for map display. Kept indefinitely.';
COMMENT ON COLUMN cached_polylines.encoded_polyline IS 'Google encoded polyline format - decode with polyline library';
COMMENT ON COLUMN cached_polylines.batch_id IS 'References the batch_id in gps_raw_data to track source coordinates';
```

---

### Table 3: `processing_log` (Optional but Recommended)

**Purpose:** Track worker processing for debugging and monitoring

```sql
CREATE TABLE processing_log (
    id BIGSERIAL PRIMARY KEY,
    
    -- Batch identification
    batch_id UUID NOT NULL DEFAULT gen_random_uuid(),
    device_id TEXT NOT NULL,
    
    -- Time range processed
    start_time TIMESTAMPTZ NOT NULL,
    end_time TIMESTAMPTZ NOT NULL,
    coordinate_count INTEGER NOT NULL,
    
    -- Processing status
    status TEXT NOT NULL CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
    
    -- Timing
    processing_started_at TIMESTAMPTZ,
    processing_completed_at TIMESTAMPTZ,
    duration_ms INTEGER,
    
    -- OSRM details
    osrm_calls INTEGER DEFAULT 0,
    osrm_success_rate FLOAT,
    
    -- Error tracking
    error_message TEXT,
    error_code TEXT,
    retry_count INTEGER DEFAULT 0,
    
    -- Timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_log_device_time 
    ON processing_log(device_id, created_at DESC);

CREATE INDEX idx_log_status 
    ON processing_log(status, created_at DESC);

CREATE INDEX idx_log_failed 
    ON processing_log(created_at DESC)
    WHERE status = 'failed';

-- Comment
COMMENT ON TABLE processing_log IS 'Audit log of background worker processing. Useful for debugging and monitoring.';
```

---

## Migration from Current Schema

### Step 1: Backup Current Data

```sql
-- Backup existing markers
CREATE TABLE markers_backup AS SELECT * FROM markers;

-- Backup existing matched_paths
CREATE TABLE matched_paths_backup AS SELECT * FROM matched_paths;
```

### Step 2: Create New Tables

```sql
-- Create new schema (SQL above)
\i db/migrations/002_create_clean_schema.sql
```

### Step 3: Migrate Data

```sql
-- Migrate markers → gps_raw_data
INSERT INTO gps_raw_data (
    device_id,
    longitude,
    latitude,
    recorded_at,
    received_at,
    processed
)
SELECT 
    username,
    coords[1],  -- longitude
    coords[2],  -- latitude
    created_at,
    created_at,
    FALSE  -- Mark all as unprocessed for now
FROM markers;

-- Migrate matched_paths → cached_polylines (if you want to keep existing cache)
INSERT INTO cached_polylines (
    device_id,
    start_time,
    end_time,
    encoded_polyline,
    osrm_confidence,
    point_count,
    batch_id,
    created_at
)
SELECT 
    device_id,
    start_time,
    end_time,
    encoded_polyline,
    osrm_confidence,
    point_count,
    gen_random_uuid(),  -- Generate new batch IDs
    created_at
FROM matched_paths
WHERE encoded_polyline IS NOT NULL;  -- Only migrate successful matches

-- Verification
SELECT 'gps_raw_data' as table_name, COUNT(*) FROM gps_raw_data
UNION ALL
SELECT 'cached_polylines', COUNT(*) FROM cached_polylines
UNION ALL
SELECT 'markers (original)', COUNT(*) FROM markers;
```

### Step 4: Update TCP Listener

```javascript
// tcp-listener/tcp-listener.js

// OLD CODE:
// await pool.query(
//     'INSERT INTO markers (username, coords, created_at) VALUES ($1, $2, NOW())',
//     [username, [lon, lat]]
// );

// NEW CODE:
await pool.query(`
    INSERT INTO gps_raw_data (
        device_id, 
        longitude, 
        latitude, 
        recorded_at,
        processed
    ) VALUES ($1, $2, $3, $4, FALSE)
`, [username, longitude, latitude, timestamp]);
```

### Step 5: Drop Old Tables (After Verification)

```sql
-- Only after you've verified everything works!

-- Drop old tables
DROP TABLE markers CASCADE;
DROP TABLE matched_paths CASCADE;
DROP TABLE polylines CASCADE;  -- If you don't need this

-- Keep backups for a while
-- DROP TABLE markers_backup;
-- DROP TABLE matched_paths_backup;
```

---

## Complete Migration Script

```sql
-- db/migrations/002_clean_schema_migration.sql

BEGIN;

-- ============================================
-- STEP 1: BACKUP
-- ============================================
CREATE TABLE markers_backup AS SELECT * FROM markers;
CREATE TABLE matched_paths_backup AS SELECT * FROM matched_paths;

-- ============================================
-- STEP 2: CREATE NEW TABLES
-- ============================================

-- GPS Raw Data Table
CREATE TABLE gps_raw_data (
    id BIGSERIAL PRIMARY KEY,
    device_id TEXT NOT NULL,
    longitude DOUBLE PRECISION NOT NULL,
    latitude DOUBLE PRECISION NOT NULL,
    recorded_at TIMESTAMPTZ NOT NULL,
    received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    processed BOOLEAN NOT NULL DEFAULT FALSE,
    batch_id UUID,
    altitude DOUBLE PRECISION,
    accuracy DOUBLE PRECISION,
    speed DOUBLE PRECISION,
    bearing DOUBLE PRECISION,
    CONSTRAINT valid_coordinates CHECK (
        longitude BETWEEN -180 AND 180 AND
        latitude BETWEEN -90 AND 90
    )
);

CREATE INDEX idx_gps_unprocessed ON gps_raw_data(device_id, processed, recorded_at) WHERE processed = FALSE;
CREATE INDEX idx_gps_device_time ON gps_raw_data(device_id, recorded_at DESC);
CREATE INDEX idx_gps_batch ON gps_raw_data(batch_id) WHERE batch_id IS NOT NULL;

-- Cached Polylines Table
CREATE TABLE cached_polylines (
    id BIGSERIAL PRIMARY KEY,
    device_id TEXT NOT NULL,
    start_time TIMESTAMPTZ NOT NULL,
    end_time TIMESTAMPTZ NOT NULL,
    encoded_polyline TEXT NOT NULL,
    osrm_confidence FLOAT,
    point_count INTEGER NOT NULL,
    osrm_duration_ms INTEGER,
    batch_id UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_accessed TIMESTAMPTZ,
    access_count INTEGER DEFAULT 0,
    UNIQUE(device_id, start_time, end_time)
);

CREATE INDEX idx_cached_device_time ON cached_polylines(device_id, start_time DESC, end_time DESC);
CREATE INDEX idx_cached_recent ON cached_polylines(created_at DESC);
CREATE INDEX idx_cached_batch ON cached_polylines(batch_id);

-- Processing Log Table
CREATE TABLE processing_log (
    id BIGSERIAL PRIMARY KEY,
    batch_id UUID NOT NULL DEFAULT gen_random_uuid(),
    device_id TEXT NOT NULL,
    start_time TIMESTAMPTZ NOT NULL,
    end_time TIMESTAMPTZ NOT NULL,
    coordinate_count INTEGER NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
    processing_started_at TIMESTAMPTZ,
    processing_completed_at TIMESTAMPTZ,
    duration_ms INTEGER,
    osrm_calls INTEGER DEFAULT 0,
    osrm_success_rate FLOAT,
    error_message TEXT,
    error_code TEXT,
    retry_count INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_log_device_time ON processing_log(device_id, created_at DESC);
CREATE INDEX idx_log_status ON processing_log(status, created_at DESC);
CREATE INDEX idx_log_failed ON processing_log(created_at DESC) WHERE status = 'failed';

-- ============================================
-- STEP 3: MIGRATE DATA
-- ============================================

-- Migrate markers → gps_raw_data
INSERT INTO gps_raw_data (
    device_id,
    longitude,
    latitude,
    recorded_at,
    received_at,
    processed
)
SELECT 
    username,
    coords[1],
    coords[2],
    created_at,
    created_at,
    FALSE
FROM markers;

-- Migrate matched_paths → cached_polylines
INSERT INTO cached_polylines (
    device_id,
    start_time,
    end_time,
    encoded_polyline,
    osrm_confidence,
    point_count,
    batch_id,
    created_at
)
SELECT 
    device_id,
    start_time,
    end_time,
    encoded_polyline,
    osrm_confidence,
    point_count,
    gen_random_uuid(),
    created_at
FROM matched_paths
WHERE encoded_polyline IS NOT NULL;

-- ============================================
-- STEP 4: VERIFICATION
-- ============================================

-- Check counts match
DO $$
DECLARE
    old_count INTEGER;
    new_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO old_count FROM markers;
    SELECT COUNT(*) INTO new_count FROM gps_raw_data;
    
    IF old_count != new_count THEN
        RAISE EXCEPTION 'Migration failed: markers count % != gps_raw_data count %', old_count, new_count;
    END IF;
    
    RAISE NOTICE 'Migration successful: % rows migrated from markers to gps_raw_data', new_count;
END $$;

-- ============================================
-- STEP 5: COMMENTS
-- ============================================

COMMENT ON TABLE gps_raw_data IS 'Raw GPS coordinates from all devices. Kept indefinitely.';
COMMENT ON TABLE cached_polylines IS 'Pre-computed road-matched polylines ready for display. Kept indefinitely.';
COMMENT ON TABLE processing_log IS 'Audit log of background worker processing.';

COMMIT;

-- ============================================
-- MANUAL STEP: Drop old tables after verification
-- ============================================
-- DROP TABLE markers CASCADE;
-- DROP TABLE matched_paths CASCADE;
```

---

## Testing the Migration

```bash
#!/bin/bash
# test-migration.sh

echo "🧪 Testing Migration..."

# 1. Check table exists
psql -c "\d gps_raw_data" || exit 1

# 2. Check data migrated
OLD_COUNT=$(psql -t -c "SELECT COUNT(*) FROM markers")
NEW_COUNT=$(psql -t -c "SELECT COUNT(*) FROM gps_raw_data")

echo "Old markers: $OLD_COUNT"
echo "New gps_raw_data: $NEW_COUNT"

if [ "$OLD_COUNT" != "$NEW_COUNT" ]; then
    echo "❌ Migration failed: counts don't match"
    exit 1
fi

# 3. Check indexes exist
psql -c "\d gps_raw_data" | grep idx_gps_unprocessed || exit 1

# 4. Check constraints work
psql -c "INSERT INTO gps_raw_data (device_id, longitude, latitude, recorded_at) 
         VALUES ('test', 200, 45, NOW())" 2>&1 | grep "valid_coordinates" || exit 1

echo "✅ Migration test passed!"
```

---

## Rollback Plan

If anything goes wrong:

```sql
-- Restore from backup
DROP TABLE IF EXISTS gps_raw_data;
DROP TABLE IF EXISTS cached_polylines;
DROP TABLE IF EXISTS processing_log;

ALTER TABLE markers_backup RENAME TO markers;
ALTER TABLE matched_paths_backup RENAME TO matched_paths;
```

---

## Next Steps After Migration

1. ✅ Update TCP listener to write to `gps_raw_data`
2. ✅ Build worker service to process from `gps_raw_data`
3. ✅ Update backend API to read from `cached_polylines`
4. ✅ Test end-to-end flow

**Ready to proceed with this migration?** Should I create the actual migration SQL file that you can run?
