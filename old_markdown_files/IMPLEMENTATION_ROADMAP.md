# OSRM Background Worker Implementation Roadmap
## Step-by-Step Transition Plan

---

## 🎯 Goal
Transform OSRM from **on-demand (slow)** to **background worker (fast)** architecture.

---

## Phase 1: Database Schema Design (Today - Step 1)

### 1.1 Review Current Schema
**Current tables:**
```sql
-- Raw GPS points (inserted by TCP listener)
markers (id, username, coords[], created_at)

-- Current cache (filled on user request)
matched_paths (device_id, start_time, end_time, encoded_polyline, ...)
```

**Issue:** `matched_paths` is used for caching but also stores raw_coordinates as backup. This mixing of concerns needs separation.

### 1.2 Design New Schema

**Decision Point 1:** Do we keep `markers` table or migrate?

**Option A - Keep & Augment (RECOMMENDED)**
```sql
-- Keep markers as-is, add tracking column
ALTER TABLE markers ADD COLUMN processed BOOLEAN DEFAULT FALSE;
ALTER TABLE markers ADD COLUMN batch_id UUID;
CREATE INDEX idx_markers_unprocessed ON markers(username, processed, created_at);
```
✅ Pros: No data migration, TCP listener unchanged, zero downtime  
❌ Cons: Table name doesn't reflect background processing model

**Option B - New Table**
```sql
-- Create new table for incoming GPS
CREATE TABLE gps_coordinates (
    id BIGSERIAL PRIMARY KEY,
    device_id TEXT NOT NULL,
    longitude DOUBLE PRECISION NOT NULL,
    latitude DOUBLE PRECISION NOT NULL,
    recorded_at TIMESTAMPTZ NOT NULL,
    processed BOOLEAN DEFAULT FALSE,
    batch_id UUID,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
```
✅ Pros: Clean architecture, clear naming  
❌ Cons: Requires TCP listener changes, data migration

### 1.3 Design Polyline Cache Table

**Decision Point 2:** Redesign `matched_paths` or create new?

**Recommended: Transform matched_paths → cached_polylines**
```sql
-- Migration script
CREATE TABLE cached_polylines (
    id BIGSERIAL PRIMARY KEY,
    device_id TEXT NOT NULL,
    start_time TIMESTAMPTZ NOT NULL,
    end_time TIMESTAMPTZ NOT NULL,
    
    -- What gets displayed on map
    encoded_polyline TEXT NOT NULL,
    osrm_confidence FLOAT,
    
    -- Metadata
    point_count INTEGER NOT NULL,
    processing_duration_ms INTEGER,
    
    -- Tracking
    source_coordinates_count INTEGER NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    last_accessed TIMESTAMPTZ,
    
    -- Unique constraint for deduplication
    UNIQUE(device_id, start_time)
);

-- Indexes for fast queries
CREATE INDEX idx_cached_recent 
    ON cached_polylines(device_id, start_time DESC, end_time DESC);

CREATE INDEX idx_cached_access 
    ON cached_polylines(last_accessed DESC) 
    WHERE last_accessed IS NOT NULL;
```

### 1.4 Tracking Table (Optional but Recommended)

**Purpose:** Know what's been processed, what failed, what's pending

```sql
CREATE TABLE processing_batches (
    batch_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    device_id TEXT NOT NULL,
    start_time TIMESTAMPTZ NOT NULL,
    end_time TIMESTAMPTZ NOT NULL,
    
    -- State machine
    status TEXT NOT NULL CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
    
    -- Metrics
    coordinate_count INTEGER NOT NULL,
    osrm_calls INTEGER DEFAULT 0,
    processing_started_at TIMESTAMPTZ,
    processing_completed_at TIMESTAMPTZ,
    
    -- Error tracking
    error_message TEXT,
    retry_count INTEGER DEFAULT 0,
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_batches_pending ON processing_batches(status, created_at);
CREATE INDEX idx_batches_device ON processing_batches(device_id, created_at DESC);
```

### ✅ Action Items - Database Design
- [ ] Decide: Keep `markers` or create `gps_coordinates`?
- [ ] Decide: Transform `matched_paths` or create new `cached_polylines`?
- [ ] Do we need `processing_batches` tracking table?
- [ ] Review schema together
- [ ] Write migration SQL files

---

## Phase 2: Background Worker Service (Steps 2-3)

### 2.1 Worker Architecture Decision

**Decision Point 3:** How should the worker run?

**Option A: Node.js Cron Service (RECOMMENDED)**
```javascript
// worker/index.js
const schedule = require('node-schedule');

// Every 1 minute
schedule.scheduleJob('*/1 * * * *', async () => {
    await processPendingBatches();
});
```
✅ Pros: Simple, same language as backend, easy to debug  
❌ Cons: One more service to manage

**Option B: PostgreSQL pg_cron Extension**
```sql
-- Runs inside PostgreSQL
SELECT cron.schedule('process-gps', '*/1 * * * *', $$
    SELECT process_pending_gps();
$$);
```
✅ Pros: No separate service, uses DB directly  
❌ Cons: Requires PostgreSQL extension, harder to debug

**Option C: Backend with Background Thread**
```javascript
// In existing backend/server.js
setInterval(async () => {
    await processPendingBatches();
}, 60000); // Every minute
```
✅ Pros: No new service, simple deployment  
❌ Cons: Mixes concerns, harder to scale independently

### 2.2 Worker Core Logic

```javascript
// worker/processor.js
const { Pool } = require('pg');

class OSRMProcessor {
    constructor(pool, osrmBase) {
        this.pool = pool;
        this.osrmBase = osrmBase;
    }
    
    async processPendingBatches() {
        console.log('[Worker] Starting batch processing cycle...');
        
        // 1. Find devices with unprocessed GPS data
        const devices = await this.findDevicesWithUnprocessedGPS();
        
        for (const device of devices) {
            // 2. Group unprocessed coordinates into time-based batches
            const batches = await this.createBatchesForDevice(device);
            
            for (const batch of batches) {
                // 3. Process each batch through OSRM
                await this.processBatch(batch);
            }
        }
        
        console.log('[Worker] Batch processing cycle complete.');
    }
    
    async findDevicesWithUnprocessedGPS() {
        const result = await this.pool.query(`
            SELECT DISTINCT username as device_id
            FROM markers
            WHERE processed = FALSE
            ORDER BY created_at ASC
        `);
        return result.rows;
    }
    
    async createBatchesForDevice(device) {
        // Group coordinates into 5-minute windows
        const result = await this.pool.query(`
            SELECT 
                date_trunc('minute', created_at) / 5 * interval '5 minutes' as batch_time,
                array_agg(coords ORDER BY created_at) as coordinates,
                MIN(created_at) as start_time,
                MAX(created_at) as end_time,
                COUNT(*) as point_count
            FROM markers
            WHERE username = $1 
              AND processed = FALSE
              AND created_at > NOW() - INTERVAL '24 hours'  -- Only recent data
            GROUP BY batch_time
            HAVING COUNT(*) >= 2  -- Need at least 2 points
            ORDER BY batch_time ASC
        `, [device.device_id]);
        
        return result.rows;
    }
    
    async processBatch(batch) {
        console.log(`[Worker] Processing batch for device ${batch.device_id}: ${batch.point_count} points`);
        
        try {
            // Call OSRM with the batch of coordinates
            const osrmResult = await this.callOSRM(batch.coordinates);
            
            if (osrmResult.success) {
                // Store in cache
                await this.pool.query(`
                    INSERT INTO cached_polylines (
                        device_id, start_time, end_time,
                        encoded_polyline, osrm_confidence,
                        point_count, source_coordinates_count,
                        processing_duration_ms
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                    ON CONFLICT (device_id, start_time) DO UPDATE
                    SET encoded_polyline = EXCLUDED.encoded_polyline,
                        osrm_confidence = EXCLUDED.osrm_confidence
                `, [
                    batch.device_id,
                    batch.start_time,
                    batch.end_time,
                    osrmResult.encoded_polyline,
                    osrmResult.confidence,
                    batch.point_count,
                    batch.point_count,
                    osrmResult.duration_ms
                ]);
                
                // Mark coordinates as processed
                await this.pool.query(`
                    UPDATE markers
                    SET processed = TRUE
                    WHERE username = $1
                      AND created_at BETWEEN $2 AND $3
                `, [batch.device_id, batch.start_time, batch.end_time]);
                
                console.log(`[Worker] ✅ Batch cached successfully`);
            } else {
                console.error(`[Worker] ❌ OSRM failed: ${osrmResult.error}`);
                // Don't mark as processed - retry later
            }
        } catch (error) {
            console.error(`[Worker] Error processing batch:`, error);
        }
    }
    
    async callOSRM(coordinates) {
        const start = Date.now();
        
        // OSRM expects [[lon, lat], [lon, lat], ...]
        const coordString = coordinates.map(c => `${c[0]},${c[1]}`).join(';');
        
        const url = `${this.osrmBase}/match/v1/driving/${coordString}?geometries=polyline&overview=full`;
        
        const response = await fetch(url);
        const data = await response.json();
        
        const duration = Date.now() - start;
        
        if (data.matchings && data.matchings.length > 0) {
            return {
                success: true,
                encoded_polyline: data.matchings[0].geometry,
                confidence: data.matchings[0].confidence || 1.0,
                duration_ms: duration
            };
        }
        
        return {
            success: false,
            error: data.message || 'No matching found'
        };
    }
}

module.exports = OSRMProcessor;
```

### 2.3 Worker Entry Point

```javascript
// worker/index.js
const schedule = require('node-schedule');
const { Pool } = require('pg');
const OSRMProcessor = require('./processor');

const pool = new Pool({
    host: process.env.PGHOST,
    port: process.env.PGPORT,
    database: process.env.PGDATABASE,
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD
});

const processor = new OSRMProcessor(
    pool,
    process.env.OSRM_BASE || 'http://osrm:5000'
);

// Run every minute
schedule.scheduleJob('*/1 * * * *', async () => {
    try {
        await processor.processPendingBatches();
    } catch (error) {
        console.error('[Worker] Fatal error:', error);
    }
});

// Also run on startup
processor.processPendingBatches();

console.log('[Worker] OSRM Background Worker started');
console.log(`[Worker] OSRM endpoint: ${process.env.OSRM_BASE}`);
console.log('[Worker] Processing schedule: Every 1 minute');
```

### ✅ Action Items - Worker Service
- [ ] Decide: Separate service vs background thread?
- [ ] Create `worker/` directory structure
- [ ] Implement processor logic
- [ ] Add worker to Docker Compose
- [ ] Test worker processes one batch correctly

---

## Phase 3: Update API Endpoints (Step 4)

### 3.1 New Cached Endpoint

```javascript
// backend/server.js

// NEW: Fast cached endpoint
app.get('/paths/cached', async (req, res) => {
    try {
        const { username, hours = 24 } = req.query;
        
        const query = `
            SELECT 
                device_id,
                start_time,
                end_time,
                encoded_polyline,
                osrm_confidence,
                point_count
            FROM cached_polylines
            WHERE device_id = $1
              AND start_time > NOW() - INTERVAL '${parseInt(hours)} hours'
            ORDER BY start_time ASC
        `;
        
        const result = await pool.query(query, [username]);
        
        // Update access tracking
        if (result.rows.length > 0) {
            await pool.query(`
                UPDATE cached_polylines
                SET last_accessed = NOW()
                WHERE device_id = $1
            `, [username]);
        }
        
        res.json({
            device: username,
            paths: result.rows,
            cached: true,
            processing_delay_ms: 0
        });
    } catch (error) {
        console.error('Cached paths error:', error);
        res.status(500).json({ error: error.message });
    }
});

// NEW: Worker status endpoint
app.get('/worker/status', async (req, res) => {
    try {
        const stats = await pool.query(`
            SELECT 
                COUNT(*) FILTER (WHERE processed = FALSE) as unprocessed_points,
                COUNT(*) FILTER (WHERE processed = TRUE) as processed_points,
                COUNT(DISTINCT username) as active_devices,
                (SELECT COUNT(*) FROM cached_polylines) as cached_paths,
                (SELECT MAX(created_at) FROM cached_polylines) as last_cache_update
            FROM markers
            WHERE created_at > NOW() - INTERVAL '24 hours'
        `);
        
        res.json(stats.rows[0]);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});
```

### 3.2 Frontend Changes

```javascript
// frontend/main.js

// OLD way (slow)
async function loadPaths_OLD() {
    const response = await fetch('/paths/encoded?hours=24');
    // Wait for OSRM processing...
}

// NEW way (fast)
async function loadPaths() {
    const response = await fetch('/paths/cached?hours=24');
    const data = await response.json();
    
    // Instantly display cached paths
    data.paths.forEach(path => {
        displayPathOnMap(path.encoded_polyline);
    });
}
```

### ✅ Action Items - API Updates
- [ ] Add `/paths/cached` endpoint
- [ ] Add `/worker/status` endpoint
- [ ] Update frontend to use new endpoint
- [ ] Add fallback for missing cache

---

## Phase 4: Docker Compose Integration (Step 5)

### 4.1 Add Worker Service

```yaml
# docker-compose.yml

services:
  # ... existing services ...
  
  osrm-worker:
    build:
      context: ./worker
    container_name: mudmaps-osrm-worker
    environment:
      PGHOST: postgres
      PGPORT: 5432
      PGDATABASE: ${POSTGRES_DB}
      PGUSER: ${POSTGRES_USER}
      PGPASSWORD: ${POSTGRES_PASSWORD}
      OSRM_BASE: http://osrm:5000
      WORKER_INTERVAL: 60  # seconds
    depends_on:
      - postgres
      - osrm
    restart: unless-stopped
    # Health check
    healthcheck:
      test: ["CMD", "node", "-e", "process.exit(0)"]
      interval: 30s
      timeout: 10s
      retries: 3
```

### 4.2 Worker Dockerfile

```dockerfile
# worker/Dockerfile
FROM node:18-alpine

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci --only=production

# Copy worker code
COPY . .

# Run as non-root user
USER node

CMD ["node", "index.js"]
```

### 4.3 Worker package.json

```json
{
  "name": "mudmaps-osrm-worker",
  "version": "1.0.0",
  "main": "index.js",
  "dependencies": {
    "pg": "^8.11.0",
    "node-schedule": "^2.1.1"
  }
}
```

### ✅ Action Items - Infrastructure
- [ ] Create `worker/` directory
- [ ] Add Dockerfile for worker
- [ ] Update docker-compose.yml
- [ ] Test worker starts and connects to DB
- [ ] Verify worker processes batches

---

## Phase 5: Testing & Validation (Step 6)

### 5.1 Unit Tests

```javascript
// worker/test/processor.test.js
const OSRMProcessor = require('../processor');

describe('OSRMProcessor', () => {
    test('groups coordinates into 5-minute batches', async () => {
        // Test batch creation logic
    });
    
    test('marks coordinates as processed after success', async () => {
        // Test state management
    });
    
    test('retries failed OSRM calls', async () => {
        // Test error handling
    });
});
```

### 5.2 Integration Tests

```bash
#!/bin/bash
# test/integration-test.sh

echo "🧪 Integration Test: Background Worker"

# 1. Insert test GPS data
psql -c "INSERT INTO markers (username, coords, created_at) VALUES 
    ('test-device', ARRAY[-72.5, 44.2], NOW() - INTERVAL '10 minutes'),
    ('test-device', ARRAY[-72.51, 44.21], NOW() - INTERVAL '9 minutes'),
    ('test-device', ARRAY[-72.52, 44.22], NOW() - INTERVAL '8 minutes')"

# 2. Trigger worker manually
curl -X POST http://localhost:3000/worker/trigger

# 3. Wait for processing
sleep 5

# 4. Check cache was populated
CACHED=$(psql -t -c "SELECT COUNT(*) FROM cached_polylines WHERE device_id = 'test-device'")

if [ "$CACHED" -gt 0 ]; then
    echo "✅ Test passed: Cache populated"
else
    echo "❌ Test failed: Cache not populated"
    exit 1
fi
```

### ✅ Action Items - Testing
- [ ] Write unit tests for worker logic
- [ ] Create integration test script
- [ ] Test with real GPS data
- [ ] Validate cache hit rates
- [ ] Performance test: 1000+ points

---

## Phase 6: Deployment & Monitoring (Step 7)

### 6.1 Deployment Checklist

```bash
# Pre-deployment
- [ ] Run database migrations
- [ ] Backfill recent GPS data (last 7 days)
- [ ] Test worker on staging environment
- [ ] Review worker logs for errors

# Deployment
- [ ] Deploy worker service
- [ ] Verify worker starts successfully
- [ ] Monitor processing progress
- [ ] Check cache population rate

# Post-deployment
- [ ] Switch frontend to cached endpoint
- [ ] Monitor API response times
- [ ] Validate user experience
- [ ] Watch for errors in logs
```

### 6.2 Monitoring Dashboard

**Key Metrics:**
```sql
-- Worker health
SELECT 
    COUNT(*) FILTER (WHERE processed = FALSE) as backlog,
    COUNT(*) FILTER (WHERE processed = TRUE AND created_at > NOW() - INTERVAL '1 hour') as processed_last_hour,
    AVG(EXTRACT(EPOCH FROM (NOW() - created_at))) as avg_delay_seconds
FROM markers
WHERE created_at > NOW() - INTERVAL '24 hours';

-- Cache performance
SELECT 
    COUNT(*) as total_cached_paths,
    COUNT(DISTINCT device_id) as devices_with_cache,
    AVG(point_count) as avg_points_per_path,
    MAX(last_accessed) as most_recent_access
FROM cached_polylines;
```

### ✅ Action Items - Deployment
- [ ] Create monitoring dashboard
- [ ] Set up alerting for worker failures
- [ ] Document rollback procedure
- [ ] Train team on new architecture

---

## Success Criteria

### Performance Targets
- ✅ Map loads < 500ms (currently 3-8 seconds)
- ✅ Cache hit rate > 95%
- ✅ Processing delay < 2 minutes for new GPS data
- ✅ Zero blocking OSRM calls during user requests

### Operational Targets
- ✅ Worker uptime > 99%
- ✅ Failed batch retry rate < 1%
- ✅ Cache storage < 1GB for 30 days of data

---

## Rollback Plan

If something goes wrong:

1. **Immediate:** Point frontend back to old `/paths/encoded` endpoint
2. **Stop worker:** Scale worker to 0 replicas
3. **Investigate:** Check logs, database state
4. **Fix forward or rollback:** Deploy fix or revert changes

---

## Timeline Estimate

- **Phase 1:** Database design - **1 day**
- **Phase 2:** Worker development - **2-3 days**
- **Phase 3:** API updates - **1 day**
- **Phase 4:** Docker integration - **1 day**
- **Phase 5:** Testing - **2 days**
- **Phase 6:** Deployment & monitoring - **1 day**

**Total: ~7-9 days** for complete migration

---

**Let's start with Phase 1 today - reviewing and finalizing the database schema design!**
