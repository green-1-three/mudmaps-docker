-- Migration: Add matched_paths table for caching OSRM results
-- This table stores pre-computed road-matched paths to avoid re-processing GPS data

CREATE TABLE IF NOT EXISTS matched_paths (
                                             id SERIAL PRIMARY KEY,
                                             device_id TEXT NOT NULL,
                                             start_time TIMESTAMPTZ NOT NULL,
                                             end_time TIMESTAMPTZ NOT NULL,

    -- OSRM matched polyline (Google's encoded polyline format)
                                             encoded_polyline TEXT,
                                             osrm_confidence FLOAT,

    -- Original coordinates as JSON array for fallback
                                             raw_coordinates JSONB NOT NULL,

    -- Metadata
                                             point_count INTEGER NOT NULL,
                                             batch_index INTEGER NOT NULL DEFAULT 0,  -- Which batch this is (for large paths)
                                             total_batches INTEGER NOT NULL DEFAULT 1,

    -- Timestamps
                                             created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    processed_at TIMESTAMPTZ,

    -- Index for fast queries
    UNIQUE(device_id, start_time, batch_index)
    );

-- Index for fast lookups by device and time range
CREATE INDEX IF NOT EXISTS idx_matched_paths_device_time
    ON matched_paths(device_id, start_time DESC, end_time DESC);

-- Index for finding paths that need processing
CREATE INDEX IF NOT EXISTS idx_matched_paths_unprocessed
    ON matched_paths(processed_at)
    WHERE encoded_polyline IS NULL;

-- Add comment explaining the table
COMMENT ON TABLE matched_paths IS 'Cached OSRM road-matched paths to avoid re-processing GPS data';
COMMENT ON COLUMN matched_paths.batch_index IS 'For large paths split into multiple OSRM calls, this is the sequence number';
COMMENT ON COLUMN matched_paths.raw_coordinates IS 'Original GPS coordinates as [[lon,lat],[lon,lat],...] JSON array';
COMMENT ON COLUMN matched_paths.encoded_polyline IS 'OSRM matched path in Google polyline encoding format';