-- ============================================
-- Migration: Add Offset Geometries to Road Segments
-- ============================================
-- Description: Add vertices_forward and vertices_reverse columns
--              to store pre-calculated offset geometries for
--              directional plow visualization
-- Date: 2025-11-03
-- Author: MudMaps Team
-- ============================================

BEGIN;

-- ============================================
-- STEP 1: ADD COLUMNS
-- ============================================
DO $$
BEGIN
    RAISE NOTICE 'Adding offset geometry columns to road_segments...';
END $$;

ALTER TABLE road_segments
ADD COLUMN IF NOT EXISTS vertices_forward GEOMETRY(LINESTRING, 4326),
ADD COLUMN IF NOT EXISTS vertices_reverse GEOMETRY(LINESTRING, 4326);

-- ============================================
-- STEP 2: CREATE SPATIAL INDEXES
-- ============================================
DO $$
BEGIN
    RAISE NOTICE 'Creating spatial indexes...';
END $$;

CREATE INDEX IF NOT EXISTS idx_segments_vertices_forward
ON road_segments USING GIST(vertices_forward)
WHERE vertices_forward IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_segments_vertices_reverse
ON road_segments USING GIST(vertices_reverse)
WHERE vertices_reverse IS NOT NULL;

-- ============================================
-- STEP 3: ADD COMMENTS
-- ============================================
DO $$
BEGIN
    RAISE NOTICE 'Adding column comments...';
END $$;

COMMENT ON COLUMN road_segments.vertices_forward IS
    'Offset geometry 2m to the left of the segment (forward direction). Pre-calculated for rendering.';

COMMENT ON COLUMN road_segments.vertices_reverse IS
    'Offset geometry 2m to the right of the segment (reverse direction). Pre-calculated for rendering.';

-- ============================================
-- STEP 4: VERIFICATION
-- ============================================
DO $$
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '==================================================';
    RAISE NOTICE 'MIGRATION VERIFICATION';
    RAISE NOTICE '==================================================';
    RAISE NOTICE '';
    RAISE NOTICE 'Columns added:';
    RAISE NOTICE '  - vertices_forward (LINESTRING)';
    RAISE NOTICE '  - vertices_reverse (LINESTRING)';
    RAISE NOTICE '';
    RAISE NOTICE 'Indexes created:';
    RAISE NOTICE '  - idx_segments_vertices_forward';
    RAISE NOTICE '  - idx_segments_vertices_reverse';
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
    RAISE NOTICE '1. Create offset generator service';
    RAISE NOTICE '';
    RAISE NOTICE '2. Add operations endpoint to generate offsets';
    RAISE NOTICE '';
    RAISE NOTICE '3. Run bulk operation to populate historical segments';
    RAISE NOTICE '';
    RAISE NOTICE '4. Update OSM import to generate offsets on new segments';
    RAISE NOTICE '==================================================';
END $$;
