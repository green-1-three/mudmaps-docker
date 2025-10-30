-- ============================================
-- Migration: Add Road Segment Model
-- ============================================
-- Description: Add road segments and municipalities tables for segment-based
--              visualization. Polylines become processing layer only.
-- Date: 2025-10-29
-- Author: MudMaps Team
-- ============================================

BEGIN;

-- ============================================
-- STEP 1: ENSURE POSTGIS IS INSTALLED
-- ============================================
DO $$
BEGIN
    RAISE NOTICE 'Checking PostGIS installation...';
END $$;

CREATE EXTENSION IF NOT EXISTS postgis;

-- Verify PostGIS is installed
DO $$
DECLARE
    postgis_version TEXT;
BEGIN
    SELECT PostGIS_version() INTO postgis_version;
    RAISE NOTICE '✓ PostGIS installed: %', postgis_version;
END $$;

-- ============================================
-- STEP 2: CREATE MUNICIPALITIES TABLE
-- ============================================
DO $$
BEGIN
    RAISE NOTICE 'Creating municipalities table...';
END $$;

CREATE TABLE municipalities (
    id TEXT PRIMARY KEY,  -- e.g., 'pomfret-vt', 'lyme-nh'
    name TEXT NOT NULL,
    state TEXT NOT NULL,
    
    -- Boundary polygon
    boundary GEOMETRY(MULTIPOLYGON, 4326) NOT NULL,
    
    -- Status
    active BOOLEAN DEFAULT TRUE,
    subscription_status TEXT DEFAULT 'inactive',
    
    -- Contact/admin
    admin_email TEXT,
    admin_name TEXT,
    
    -- Metadata
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Constraints
    CONSTRAINT valid_subscription_status CHECK (
        subscription_status IN ('active', 'trial', 'inactive', 'cancelled')
    )
);

-- Spatial index on boundary
CREATE INDEX idx_municipalities_boundary 
ON municipalities USING GIST(boundary);

-- Comments
COMMENT ON TABLE municipalities IS 
    'Municipality boundaries and metadata. Used to define service areas and clip road segments.';
COMMENT ON COLUMN municipalities.boundary IS 
    'MultiPolygon geometry defining the municipality boundary (from OpenStreetMap)';
COMMENT ON COLUMN municipalities.subscription_status IS 
    'Billing/service status: active (paid), trial (testing), inactive (not subscribed), cancelled';

-- ============================================
-- STEP 3: CREATE ROAD SEGMENTS TABLE
-- ============================================
DO $$
BEGIN
    RAISE NOTICE 'Creating road_segments table...';
END $$;

CREATE TABLE road_segments (
    id BIGSERIAL PRIMARY KEY,
    
    -- Geometry
    geometry GEOMETRY(LINESTRING, 4326) NOT NULL,
    segment_length DOUBLE PRECISION NOT NULL,  -- meters
    bearing DOUBLE PRECISION,  -- 0-360 degrees
    
    -- Location metadata
    municipality_id TEXT NOT NULL REFERENCES municipalities(id),
    street_name TEXT,
    road_classification TEXT,  -- 'residential', 'primary', 'secondary', etc.
    
    -- OSM metadata
    osm_way_id BIGINT,
    osm_tags JSONB,
    
    -- Plowing status (directional)
    last_plowed_forward TIMESTAMPTZ,
    last_plowed_reverse TIMESTAMPTZ,
    last_plowed_device_id TEXT,
    
    -- Statistics
    plow_count_today INTEGER DEFAULT 0,
    plow_count_total INTEGER DEFAULT 0,
    last_reset_date DATE DEFAULT CURRENT_DATE,
    
    -- Metadata
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Constraints
    CONSTRAINT valid_segment_length CHECK (
        segment_length > 0 AND segment_length <= 200
    ),
    CONSTRAINT valid_bearing CHECK (
        bearing IS NULL OR (bearing >= 0 AND bearing < 360)
    ),
    CONSTRAINT valid_road_classification CHECK (
        road_classification IS NULL OR road_classification IN (
            'motorway', 'trunk', 'primary', 'secondary', 'tertiary',
            'unclassified', 'residential', 'service', 'living_street'
        )
    )
);

-- Spatial index on geometry (critical for performance)
CREATE INDEX idx_segments_geom 
ON road_segments USING GIST(geometry);

-- Municipality lookup
CREATE INDEX idx_segments_municipality 
ON road_segments(municipality_id);

-- Plowed status queries
CREATE INDEX idx_segments_plowed_forward 
ON road_segments(last_plowed_forward DESC) 
WHERE last_plowed_forward IS NOT NULL;

CREATE INDEX idx_segments_plowed_reverse 
ON road_segments(last_plowed_reverse DESC) 
WHERE last_plowed_reverse IS NOT NULL;

-- Street name lookups
CREATE INDEX idx_segments_street_name 
ON road_segments(street_name) 
WHERE street_name IS NOT NULL;

-- Road classification filtering
CREATE INDEX idx_segments_classification 
ON road_segments(road_classification);

-- Comments
COMMENT ON TABLE road_segments IS 
    'Pre-segmented road network (50-100m chunks) for visualization. Updated by polyline processing, displayed to users.';
COMMENT ON COLUMN road_segments.geometry IS 
    'LineString geometry of the road segment (50-100m length)';
COMMENT ON COLUMN road_segments.bearing IS 
    'Average bearing of segment from start to end (0-360 degrees). Used to determine forward vs reverse direction.';
COMMENT ON COLUMN road_segments.last_plowed_forward IS 
    'Most recent timestamp when this segment was plowed in the forward direction (bearing ±45°)';
COMMENT ON COLUMN road_segments.last_plowed_reverse IS 
    'Most recent timestamp when this segment was plowed in the reverse direction (bearing ±135-180°)';
COMMENT ON COLUMN road_segments.plow_count_today IS 
    'Number of times this segment was plowed today (resets daily at midnight)';

-- ============================================
-- STEP 4: CREATE SEGMENT UPDATES LOG
-- ============================================
DO $$
BEGIN
    RAISE NOTICE 'Creating segment_updates table...';
END $$;

CREATE TABLE segment_updates (
    id BIGSERIAL PRIMARY KEY,
    
    -- References
    segment_id BIGINT NOT NULL REFERENCES road_segments(id),
    polyline_id BIGINT NOT NULL REFERENCES cached_polylines(id),
    device_id TEXT NOT NULL,
    
    -- Update details
    direction TEXT NOT NULL,  -- 'forward' or 'reverse'
    overlap_percentage DOUBLE PRECISION NOT NULL,  -- 0-100
    
    -- Timing
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Constraints
    CONSTRAINT valid_direction CHECK (direction IN ('forward', 'reverse')),
    CONSTRAINT valid_overlap CHECK (
        overlap_percentage >= 0 AND overlap_percentage <= 100
    )
);

-- Indexes for audit/debugging
CREATE INDEX idx_segment_updates_segment 
ON segment_updates(segment_id, timestamp DESC);

CREATE INDEX idx_segment_updates_polyline 
ON segment_updates(polyline_id);

CREATE INDEX idx_segment_updates_device 
ON segment_updates(device_id, timestamp DESC);

COMMENT ON TABLE segment_updates IS 
    'Audit log of when polylines activated road segments. Used for debugging and analytics.';

-- ============================================
-- STEP 5: ADD GEOMETRY TO CACHED_POLYLINES (if not exists)
-- ============================================
DO $$
BEGIN
    RAISE NOTICE 'Ensuring cached_polylines has geometry and bearing...';
END $$;

-- Add columns if they don't exist
ALTER TABLE cached_polylines 
ADD COLUMN IF NOT EXISTS geometry GEOMETRY(LINESTRING, 4326),
ADD COLUMN IF NOT EXISTS bearing DOUBLE PRECISION;

-- Create spatial index if doesn't exist
CREATE INDEX IF NOT EXISTS idx_cached_polylines_geom 
ON cached_polylines USING GIST(geometry)
WHERE geometry IS NOT NULL;

-- ============================================
-- STEP 6: CREATE HELPER FUNCTIONS
-- ============================================
DO $$
BEGIN
    RAISE NOTICE 'Creating helper functions...';
END $$;

-- Function to calculate bearing between two points
CREATE OR REPLACE FUNCTION calculate_bearing(
    lat1 DOUBLE PRECISION, 
    lon1 DOUBLE PRECISION,
    lat2 DOUBLE PRECISION, 
    lon2 DOUBLE PRECISION
) RETURNS DOUBLE PRECISION AS $$
DECLARE
    dlon DOUBLE PRECISION;
    y DOUBLE PRECISION;
    x DOUBLE PRECISION;
    bearing DOUBLE PRECISION;
BEGIN
    IF lat1 = lat2 AND lon1 = lon2 THEN
        RETURN NULL;
    END IF;
    
    dlon := radians(lon2 - lon1);
    
    y := sin(dlon) * cos(radians(lat2));
    x := cos(radians(lat1)) * sin(radians(lat2)) - 
         sin(radians(lat1)) * cos(radians(lat2)) * cos(dlon);
    
    bearing := degrees(atan2(y, x));
    
    IF bearing < 0 THEN
        bearing := bearing + 360;
    END IF;
    
    RETURN bearing;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Function to check if two bearings are similar (with wraparound handling)
CREATE OR REPLACE FUNCTION bearings_similar(
    bearing1 DOUBLE PRECISION, 
    bearing2 DOUBLE PRECISION,
    tolerance DOUBLE PRECISION DEFAULT 45.0
) RETURNS BOOLEAN AS $$
DECLARE
    diff DOUBLE PRECISION;
BEGIN
    IF bearing1 IS NULL OR bearing2 IS NULL THEN
        RETURN FALSE;
    END IF;
    
    diff := ABS(bearing1 - bearing2);
    IF diff > 180 THEN
        diff := 360 - diff;
    END IF;
    
    RETURN diff <= tolerance;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Function to determine direction (forward or reverse) based on bearings
CREATE OR REPLACE FUNCTION determine_direction(
    polyline_bearing DOUBLE PRECISION,
    segment_bearing DOUBLE PRECISION,
    tolerance DOUBLE PRECISION DEFAULT 45.0
) RETURNS TEXT AS $$
DECLARE
    diff DOUBLE PRECISION;
BEGIN
    IF polyline_bearing IS NULL OR segment_bearing IS NULL THEN
        RETURN 'forward';  -- Default to forward if unknown
    END IF;
    
    diff := ABS(polyline_bearing - segment_bearing);
    IF diff > 180 THEN
        diff := 360 - diff;
    END IF;
    
    IF diff <= tolerance THEN
        RETURN 'forward';
    ELSE
        RETURN 'reverse';
    END IF;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Function to reset daily counters (call from cron)
CREATE OR REPLACE FUNCTION reset_daily_plow_counts()
RETURNS INTEGER AS $$
DECLARE
    reset_count INTEGER;
BEGIN
    UPDATE road_segments
    SET plow_count_today = 0,
        last_reset_date = CURRENT_DATE
    WHERE last_reset_date < CURRENT_DATE;
    
    GET DIAGNOSTICS reset_count = ROW_COUNT;
    RETURN reset_count;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION reset_daily_plow_counts() IS 
    'Reset plow_count_today to 0 for all segments. Should be called daily at midnight via cron.';

-- ============================================
-- STEP 7: CREATE VIEWS FOR COMMON QUERIES
-- ============================================
DO $$
BEGIN
    RAISE NOTICE 'Creating helper views...';
END $$;

-- View: Recently plowed segments (last 24 hours)
CREATE OR REPLACE VIEW segments_plowed_24h AS
SELECT 
    s.*,
    GREATEST(s.last_plowed_forward, s.last_plowed_reverse) as last_plowed,
    CASE 
        WHEN s.last_plowed_forward > s.last_plowed_reverse THEN 'forward'
        WHEN s.last_plowed_reverse > s.last_plowed_forward THEN 'reverse'
        WHEN s.last_plowed_forward IS NOT NULL THEN 'both'
        ELSE NULL
    END as last_direction
FROM road_segments s
WHERE s.last_plowed_forward > NOW() - INTERVAL '24 hours'
   OR s.last_plowed_reverse > NOW() - INTERVAL '24 hours';

COMMENT ON VIEW segments_plowed_24h IS 
    'Segments plowed in the last 24 hours with computed last_plowed and direction';

-- ============================================
-- STEP 8: VERIFICATION
-- ============================================
DO $$
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '==================================================';
    RAISE NOTICE 'MIGRATION VERIFICATION';
    RAISE NOTICE '==================================================';
    RAISE NOTICE '';
    RAISE NOTICE 'Tables created:';
    RAISE NOTICE '  - municipalities';
    RAISE NOTICE '  - road_segments';
    RAISE NOTICE '  - segment_updates';
    RAISE NOTICE '';
    RAISE NOTICE 'Functions created:';
    RAISE NOTICE '  - calculate_bearing()';
    RAISE NOTICE '  - bearings_similar()';
    RAISE NOTICE '  - determine_direction()';
    RAISE NOTICE '  - reset_daily_plow_counts()';
    RAISE NOTICE '';
    RAISE NOTICE '==================================================';
END $$;

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
    RAISE NOTICE '1. Run OSM import script to populate road segments:';
    RAISE NOTICE '   node db/scripts/import-osm-segments.js pomfret-vt';
    RAISE NOTICE '';
    RAISE NOTICE '2. Update worker to process polylines → segments';
    RAISE NOTICE '';
    RAISE NOTICE '3. Add backend /api/segments endpoint';
    RAISE NOTICE '';
    RAISE NOTICE '4. Update frontend to display segments';
    RAISE NOTICE '==================================================';
END $$;
