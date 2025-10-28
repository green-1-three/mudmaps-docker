-- ============================================
-- Migration: Clean Schema for Background Worker
-- ============================================
-- Description: Rename markers → gps_raw_data, matched_paths → cached_polylines
--              Add background worker infrastructure
-- Date: 2025-10-28
-- Author: Architecture Team
-- Rollback: See rollback.sql
-- ============================================

BEGIN;

-- ============================================
-- STEP 1: BACKUP EXISTING DATA
-- ============================================
DO $$
BEGIN
    RAISE NOTICE 'Creating backups of existing tables...';
END $$;

CREATE TABLE markers_backup AS SELECT * FROM markers;
CREATE TABLE matched_paths_backup AS SELECT * FROM matched_paths;

-- ============================================
-- STEP 2: CREATE NEW TABLES
-- ============================================
DO $$
BEGIN
    RAISE NOTICE 'Creating new schema tables...';
END $$;

-- Table 1: GPS Raw Data (Input Layer)
CREATE TABLE gps_raw_data (
    id BIGSERIAL PRIMARY KEY,
    
    -- Device identification
    device_id TEXT NOT NULL,
    
    -- GPS coordinates
    longitude DOUBLE PRECISION NOT NULL,
    latitude DOUBLE PRECISION NOT NULL,
    
    -- Timestamps
    recorded_at TIMESTAMPTZ NOT NULL,
    received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Processing tracking
    processed BOOLEAN NOT NULL DEFAULT FALSE,
    batch_id UUID,
    
    -- Optional metadata (for future use)
    altitude DOUBLE PRECISION,
    accuracy DOUBLE PRECISION,
    speed DOUBLE PRECISION,
    bearing DOUBLE PRECISION,
    
    -- Data validation
    CONSTRAINT valid_coordinates CHECK (
        longitude BETWEEN -180 AND 180 AND
        latitude BETWEEN -90 AND 90
    ),
    CONSTRAINT valid_altitude CHECK (
        altitude IS NULL OR altitude BETWEEN -1000 AND 50000
    )
);

-- Indexes for gps_raw_data
CREATE INDEX idx_gps_unprocessed 
    ON gps_raw_data(device_id, processed, recorded_at)
    WHERE processed = FALSE;

CREATE INDEX idx_gps_device_time 
    ON gps_raw_data(device_id, recorded_at DESC);

CREATE INDEX idx_gps_batch 
    ON gps_raw_data(batch_id)
    WHERE batch_id IS NOT NULL;

CREATE INDEX idx_gps_recent
    ON gps_raw_data(received_at DESC);

-- Table 2: Cached Polylines (Output Layer)
CREATE TABLE cached_polylines (
    id BIGSERIAL PRIMARY KEY,
    
    -- Device and time range
    device_id TEXT NOT NULL,
    start_time TIMESTAMPTZ NOT NULL,
    end_time TIMESTAMPTZ NOT NULL,
    
    -- Display data
    encoded_polyline TEXT NOT NULL,
    osrm_confidence FLOAT,
    
    -- Metadata
    point_count INTEGER NOT NULL,
    osrm_duration_ms INTEGER,
    
    -- Tracking
    batch_id UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Access tracking
    last_accessed TIMESTAMPTZ,
    access_count INTEGER DEFAULT 0,
    
    -- Constraints
    UNIQUE(device_id, start_time, end_time),
    CONSTRAINT valid_point_count CHECK (point_count >= 2),
    CONSTRAINT valid_confidence CHECK (
        osrm_confidence IS NULL OR 
        (osrm_confidence >= 0 AND osrm_confidence <= 1)
    ),
    CONSTRAINT valid_time_range CHECK (end_time > start_time)
);

-- Indexes for cached_polylines
CREATE INDEX idx_cached_device_time 
    ON cached_polylines(device_id, start_time DESC, end_time DESC);

CREATE INDEX idx_cached_recent 
    ON cached_polylines(created_at DESC);

CREATE INDEX idx_cached_batch 
    ON cached_polylines(batch_id);

CREATE INDEX idx_cached_popular 
    ON cached_polylines(access_count DESC, last_accessed DESC)
    WHERE access_count > 5;

-- Table 3: Processing Log (Monitoring Layer)
CREATE TABLE processing_log (
    id BIGSERIAL PRIMARY KEY,
    
    -- Batch identification
    batch_id UUID NOT NULL DEFAULT gen_random_uuid(),
    device_id TEXT NOT NULL,
    
    -- Time range
    start_time TIMESTAMPTZ NOT NULL,
    end_time TIMESTAMPTZ NOT NULL,
    coordinate_count INTEGER NOT NULL,
    
    -- Processing status
    status TEXT NOT NULL,
    
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
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Constraints
    CONSTRAINT valid_status CHECK (
        status IN ('pending', 'processing', 'completed', 'failed', 'retrying')
    ),
    CONSTRAINT valid_retry_count CHECK (retry_count >= 0),
    CONSTRAINT valid_osrm_success_rate CHECK (
        osrm_success_rate IS NULL OR
        (osrm_success_rate >= 0 AND osrm_success_rate <= 1)
    )
);

-- Indexes for processing_log
CREATE INDEX idx_log_device_time 
    ON processing_log(device_id, created_at DESC);

CREATE INDEX idx_log_status 
    ON processing_log(status, created_at DESC);

CREATE INDEX idx_log_failed 
    ON processing_log(created_at DESC)
    WHERE status = 'failed';

CREATE INDEX idx_log_batch
    ON processing_log(batch_id);

-- ============================================
-- STEP 3: MIGRATE DATA
-- ============================================
DO $$
DECLARE
    markers_count INTEGER;
    migrated_count INTEGER;
BEGIN
    RAISE NOTICE 'Migrating data from old schema...';
    
    -- Get count before migration
    SELECT COUNT(*) INTO markers_count FROM markers;
    RAISE NOTICE 'Found % rows in markers table', markers_count;
    
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
        FALSE  -- Mark all as unprocessed
    FROM markers;
    
    -- Verify count
    SELECT COUNT(*) INTO migrated_count FROM gps_raw_data;
    
    IF markers_count != migrated_count THEN
        RAISE EXCEPTION 'Migration failed: expected % rows, got %', markers_count, migrated_count;
    END IF;
    
    RAISE NOTICE '✓ Migrated % GPS coordinates to gps_raw_data', migrated_count;
END $$;

-- Migrate matched_paths → cached_polylines
DO $$
DECLARE
    matched_count INTEGER;
    migrated_count INTEGER;
BEGIN
    -- Count successful matches in old table
    SELECT COUNT(*) INTO matched_count 
    FROM matched_paths 
    WHERE encoded_polyline IS NOT NULL;
    
    RAISE NOTICE 'Found % cached paths in matched_paths', matched_count;
    
    -- Migrate only successful matches
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
    WHERE encoded_polyline IS NOT NULL;
    
    -- Verify count
    SELECT COUNT(*) INTO migrated_count FROM cached_polylines;
    
    IF matched_count != migrated_count THEN
        RAISE EXCEPTION 'Migration failed: expected % cached paths, got %', matched_count, migrated_count;
    END IF;
    
    RAISE NOTICE '✓ Migrated % cached polylines', migrated_count;
END $$;

-- ============================================
-- STEP 4: ADD COMMENTS (Documentation)
-- ============================================
DO $$
BEGIN
    RAISE NOTICE 'Adding table comments...';
END $$;

COMMENT ON TABLE gps_raw_data IS 
    'Raw GPS coordinates from all devices. Never deleted - kept indefinitely for historical analysis. Used as input for background worker processing.';

COMMENT ON COLUMN gps_raw_data.device_id IS 
    'Unique identifier for the GPS device/tracker';

COMMENT ON COLUMN gps_raw_data.processed IS 
    'TRUE when this coordinate has been processed into a cached polyline by the background worker';

COMMENT ON COLUMN gps_raw_data.batch_id IS 
    'UUID linking coordinates that were processed together in a single OSRM batch call';

COMMENT ON TABLE cached_polylines IS 
    'Pre-computed road-matched polylines ready for immediate map display. Generated by background worker. Kept indefinitely.';

COMMENT ON COLUMN cached_polylines.encoded_polyline IS 
    'Google encoded polyline format (decode with @mapbox/polyline library)';

COMMENT ON COLUMN cached_polylines.batch_id IS 
    'References the batch_id in gps_raw_data to track source coordinates';

COMMENT ON TABLE processing_log IS 
    'Audit log of background worker processing. Tracks success/failure for monitoring and debugging.';

-- ============================================
-- STEP 5: CREATE HELPER FUNCTIONS
-- ============================================
DO $$
BEGIN
    RAISE NOTICE 'Creating helper functions...';
END $$;

-- Function to get processing statistics
CREATE OR REPLACE FUNCTION get_processing_stats()
RETURNS TABLE (
    total_gps_points BIGINT,
    unprocessed_points BIGINT,
    processed_points BIGINT,
    total_cached_paths BIGINT,
    active_devices BIGINT,
    last_cache_update TIMESTAMPTZ,
    processing_backlog_minutes NUMERIC
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        COUNT(*)::BIGINT as total_gps_points,
        COUNT(*) FILTER (WHERE processed = FALSE)::BIGINT as unprocessed_points,
        COUNT(*) FILTER (WHERE processed = TRUE)::BIGINT as processed_points,
        (SELECT COUNT(*) FROM cached_polylines)::BIGINT as total_cached_paths,
        COUNT(DISTINCT device_id)::BIGINT as active_devices,
        (SELECT MAX(created_at) FROM cached_polylines) as last_cache_update,
        EXTRACT(EPOCH FROM (NOW() - MIN(recorded_at) FILTER (WHERE processed = FALSE))) / 60.0 as processing_backlog_minutes
    FROM gps_raw_data;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION get_processing_stats() IS 
    'Returns current processing statistics for monitoring dashboard';

-- Function to update processing log on completion
CREATE OR REPLACE FUNCTION update_processing_log_on_complete()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    
    IF NEW.status = 'completed' AND NEW.processing_started_at IS NOT NULL THEN
        NEW.processing_completed_at = NOW();
        NEW.duration_ms = EXTRACT(EPOCH FROM (NOW() - NEW.processing_started_at)) * 1000;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to automatically update processing log
CREATE TRIGGER trg_processing_log_update
    BEFORE UPDATE ON processing_log
    FOR EACH ROW
    EXECUTE FUNCTION update_processing_log_on_complete();

-- ============================================
-- STEP 6: VERIFICATION QUERIES
-- ============================================
DO $$
DECLARE
    gps_count INTEGER;
    cached_count INTEGER;
    markers_count INTEGER;
    matched_count INTEGER;
BEGIN
    RAISE NOTICE '==================================================';
    RAISE NOTICE 'MIGRATION VERIFICATION';
    RAISE NOTICE '==================================================';
    
    SELECT COUNT(*) INTO markers_count FROM markers;
    SELECT COUNT(*) INTO gps_count FROM gps_raw_data;
    RAISE NOTICE 'GPS Raw Data: % rows (from % markers)', gps_count, markers_count;
    
    SELECT COUNT(*) INTO matched_count FROM matched_paths WHERE encoded_polyline IS NOT NULL;
    SELECT COUNT(*) INTO cached_count FROM cached_polylines;
    RAISE NOTICE 'Cached Polylines: % rows (from % matched)', cached_count, matched_count;
    
    IF markers_count = gps_count AND matched_count = cached_count THEN
        RAISE NOTICE '✓ Migration successful!';
    ELSE
        RAISE EXCEPTION 'Migration verification failed!';
    END IF;
    
    RAISE NOTICE '==================================================';
END $$;

-- Show sample data
SELECT 'Sample GPS data:' as info;
SELECT device_id, longitude, latitude, recorded_at, processed 
FROM gps_raw_data 
ORDER BY recorded_at DESC 
LIMIT 5;

SELECT 'Sample cached polylines:' as info;
SELECT device_id, start_time, point_count, created_at 
FROM cached_polylines 
ORDER BY created_at DESC 
LIMIT 5;

-- Show statistics
SELECT 'Processing statistics:' as info;
SELECT * FROM get_processing_stats();

COMMIT;

-- ============================================
-- POST-MIGRATION INSTRUCTIONS
-- ============================================
DO $$
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '==================================================';
    RAISE NOTICE 'MIGRATION COMPLETED SUCCESSFULLY';
    RAISE NOTICE '==================================================';
    RAISE NOTICE '';
    RAISE NOTICE 'Next steps:';
    RAISE NOTICE '1. Update TCP listener to write to gps_raw_data';
    RAISE NOTICE '2. Deploy background worker service';
    RAISE NOTICE '3. Update backend API to read from cached_polylines';
    RAISE NOTICE '4. Test end-to-end flow';
    RAISE NOTICE '';
    RAISE NOTICE 'After verification (1-2 days):';
    RAISE NOTICE '- Run: DROP TABLE markers CASCADE;';
    RAISE NOTICE '- Run: DROP TABLE matched_paths CASCADE;';
    RAISE NOTICE '';
    RAISE NOTICE 'Backups preserved in:';
    RAISE NOTICE '- markers_backup';
    RAISE NOTICE '- matched_paths_backup';
    RAISE NOTICE '==================================================';
END $$;
