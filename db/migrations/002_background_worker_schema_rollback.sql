-- ============================================
-- ROLLBACK: Background Worker Schema Migration
-- ============================================
-- Description: Restore original schema if migration needs to be reverted
-- Date: 2025-10-28
-- Usage: Run this file if you need to undo the migration
-- ============================================

BEGIN;

DO $$
BEGIN
    RAISE NOTICE 'Rolling back background worker schema migration...';
END $$;

-- ============================================
-- STEP 1: Drop new tables
-- ============================================
DROP TABLE IF EXISTS processing_log CASCADE;
DROP TABLE IF EXISTS cached_polylines CASCADE;
DROP TABLE IF EXISTS gps_raw_data CASCADE;

-- Drop helper functions
DROP FUNCTION IF EXISTS get_processing_stats() CASCADE;
DROP FUNCTION IF EXISTS update_processing_log_on_complete() CASCADE;

DO $$
BEGIN
    RAISE NOTICE 'Dropped new tables and functions';
END $$;

-- ============================================
-- STEP 2: Restore from backups
-- ============================================
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'markers_backup') THEN
        ALTER TABLE markers_backup RENAME TO markers;
        RAISE NOTICE 'Restored markers table from backup';
    ELSE
        RAISE EXCEPTION 'markers_backup table not found - cannot rollback!';
    END IF;
    
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'matched_paths_backup') THEN
        ALTER TABLE matched_paths_backup RENAME TO matched_paths;
        RAISE NOTICE 'Restored matched_paths table from backup';
    ELSE
        RAISE EXCEPTION 'matched_paths_backup table not found - cannot rollback!';
    END IF;
END $$;

-- ============================================
-- VERIFICATION
-- ============================================
DO $$
DECLARE
    markers_count INTEGER;
    matched_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO markers_count FROM markers;
    SELECT COUNT(*) INTO matched_count FROM matched_paths;
    
    RAISE NOTICE '==================================================';
    RAISE NOTICE 'ROLLBACK COMPLETE';
    RAISE NOTICE '==================================================';
    RAISE NOTICE 'Restored markers: % rows', markers_count;
    RAISE NOTICE 'Restored matched_paths: % rows', matched_count;
    RAISE NOTICE '==================================================';
END $$;

COMMIT;

-- ============================================
-- INSTRUCTIONS
-- ============================================
DO $$
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE 'Schema has been rolled back to original state.';
    RAISE NOTICE 'You can now:';
    RAISE NOTICE '1. Restart services that depend on old schema';
    RAISE NOTICE '2. Investigate why rollback was needed';
    RAISE NOTICE '3. Fix issues and re-run migration when ready';
    RAISE NOTICE '';
END $$;
