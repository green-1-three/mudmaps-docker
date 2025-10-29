# MudMaps OSRM Architecture Analysis
## Current State Assessment - October 28, 2025

---

## 🎯 Executive Summary

**Current Problem:** OSRM is invoked on-demand when users request paths (`/paths/encoded`), causing slow map loads and blocking user experience.

**Root Cause:** Reactive architecture - processing happens when users ask for data rather than proactively maintaining a ready-to-display cache.

**Proposed Solution:** Background worker pattern with dual-table architecture to separate computation from delivery.

---

## 📊 Current Architecture

### Data Flow (As-Is)
```
User Request → Backend API → Fetch GPS from DB → Call OSRM → Return Results
                                   ↓
                              (Optional: Cache results in matched_paths)
```

### Key Components

#### 1. **Backend Service** (`backend/server.js`)
- Express server on port 3000
- Handles real-time OSRM processing
- Has caching logic but only fills cache on user request
- Batch processing with 50-point chunks

#### 2. **Database Tables**
```sql
-- Raw GPS data
markers (id, username, coords[], created_at)

-- Pre-drawn lines (manual)
polylines (id, username, coords[][], created_at)

-- OSRM cache (populated on-demand)
matched_paths (
  id, device_id, start_time, end_time,
  encoded_polyline, osrm_confidence,
  raw_coordinates, point_count,
  batch_index, total_batches,
  created_at, processed_at
)
```

#### 3. **OSRM Service**
- Self-hosted container: `osrm:5000`
- Algorithm: MLD (Multi-Level Dijkstra)
- 1GB memory limit
- Map matching endpoint: `/match/v1/driving`

### Current Performance Issues

**🐌 Slow Map Loads**
- User must wait for OSRM processing on every request
- 50+ GPS points = multiple sequential OSRM calls
- Network latency compounded by batch processing

**🔄 Redundant Work**
- Same GPS data processed multiple times
- Cache only populated after first user request
- New data never proactively cached

**📈 Poor Scalability**
- Processing time grows linearly with user count
- OSRM becomes bottleneck under load
- No prioritization of recent data

---

## 🏗️ Proposed Architecture: Background Worker Pattern

### New Data Flow (To-Be)
```
GPS Data Arrives → [Trigger] → Background Worker → Process with OSRM → Cache Results
                                                                              ↓
User Request → Backend API → Fetch from Cache → Return Instantly
```

### Architecture Components

#### 1. **New Table: `gps_coordinates`**
Purpose: Store raw GPS data separate from processed results

```sql
CREATE TABLE gps_coordinates (
    id BIGSERIAL PRIMARY KEY,
    device_id TEXT NOT NULL,
    longitude DOUBLE PRECISION NOT NULL,
    latitude DOUBLE PRECISION NOT NULL,
    recorded_at TIMESTAMPTZ NOT NULL,
    processed BOOLEAN DEFAULT FALSE,
    batch_id UUID,  -- Groups coordinates into processing batches
    created_at TIMESTAMPTZ DEFAULT NOW(),
    
    INDEX idx_unprocessed (device_id, processed, recorded_at)
    INDEX idx_batch (batch_id)
);
```

#### 2. **Enhanced Table: `cached_polylines`**
Purpose: Store ready-to-display polylines

```sql
CREATE TABLE cached_polylines (
    id BIGSERIAL PRIMARY KEY,
    device_id TEXT NOT NULL,
    start_time TIMESTAMPTZ NOT NULL,
    end_time TIMESTAMPTZ NOT NULL,
    
    -- Display data
    encoded_polyline TEXT NOT NULL,  -- Ready for map rendering
    osrm_confidence FLOAT,
    
    -- Metadata
    point_count INTEGER NOT NULL,
    processing_duration_ms INTEGER,
    
    -- Tracking
    source_batch_id UUID NOT NULL,  -- Links to gps_coordinates
    created_at TIMESTAMPTZ DEFAULT NOW(),
    last_accessed TIMESTAMPTZ,
    access_count INTEGER DEFAULT 0,
    
    UNIQUE(device_id, start_time)
);

CREATE INDEX idx_cached_recent ON cached_polylines(device_id, start_time DESC);
CREATE INDEX idx_cached_popular ON cached_polylines(access_count DESC, last_accessed DESC);
```

#### 3. **Background Worker Service**

**Option A: Node.js Scheduled Job**
```javascript
// worker/osrm-processor.js
const schedule = require('node-schedule');

// Run every 1 minute
schedule.scheduleJob('*/1 * * * *', async () => {
    await processUnprocessedGPS();
});

async function processUnprocessedGPS() {
    // 1. Find unprocessed GPS coordinates
    // 2. Group by device_id and time windows (e.g., 5-minute chunks)
    // 3. Call OSRM for each batch
    // 4. Store in cached_polylines
    // 5. Mark gps_coordinates as processed
}
```

**Option B: PostgreSQL LISTEN/NOTIFY**
```javascript
// Real-time trigger when new GPS arrives
pool.on('notification', async (msg) => {
    if (msg.channel === 'new_gps') {
        await processDeviceGPS(msg.payload);
    }
});
```

**Option C: pg_cron Extension**
```sql
-- Runs inside PostgreSQL, no separate service needed
SELECT cron.schedule('process-gps', '* * * * *', $$
    SELECT process_unprocessed_gps();
$$);
```

#### 4. **Updated API Endpoints**

```javascript
// INSTANT - just fetch cached data
app.get('/paths/cached', async (req, res) => {
    const { device_id, hours = 24 } = req.query;
    
    const result = await pool.query(`
        SELECT device_id, encoded_polyline, start_time, end_time, point_count
        FROM cached_polylines
        WHERE device_id = $1 
          AND start_time > NOW() - INTERVAL '${hours} hours'
        ORDER BY start_time DESC
    `, [device_id]);
    
    res.json({ paths: result.rows });
});

// Track access for cache optimization
app.post('/paths/accessed/:id', async (req, res) => {
    await pool.query(`
        UPDATE cached_polylines 
        SET access_count = access_count + 1,
            last_accessed = NOW()
        WHERE id = $1
    `, [req.params.id]);
});
```

---

## 🔄 Migration Strategy

### Phase 1: Add New Infrastructure (Non-Breaking)
✅ Create `gps_coordinates` table
✅ Create `cached_polylines` table  
✅ Add background worker service to Docker Compose
✅ Keep existing endpoints working

**Deployment:** Zero downtime, can be done live

### Phase 2: Dual-Write Period (Transition)
✅ Modify TCP listener to write to BOTH `markers` AND `gps_coordinates`
✅ Start background worker processing
✅ Populate cache with historical data
✅ Monitor cache hit rates

**Duration:** 1-2 weeks to build confidence

### Phase 3: Switch Over (Cutover)
✅ Update frontend to use `/paths/cached` endpoint
✅ Monitor performance improvements
✅ Keep old endpoints for rollback safety

**Rollback Plan:** Simple nginx config change to point back to old endpoint

### Phase 4: Cleanup (Post-Migration)
✅ Deprecate old `/paths/encoded` endpoint
✅ Optional: Migrate old `markers` data to new schema
✅ Remove legacy caching code from server.js

---

## 🚀 Performance Improvements

### Before (Current)
- Map load: **3-8 seconds** (depends on GPS points)
- OSRM calls: **On every page load**
- User experience: **Blocking, unpredictable**

### After (Background Worker)
- Map load: **< 500ms** (pure database fetch)
- OSRM calls: **Background, never blocks users**
- User experience: **Instant, consistent**

### Scalability Gains
- 100 users checking map simultaneously: **No problem** (just DB reads)
- New GPS data arrival: **Processed within 1 minute**
- OSRM load: **Distributed over time, not spiked**

---

## 🛠️ Implementation Checklist

### Database Changes
- [ ] Create `gps_coordinates` table with indexes
- [ ] Create `cached_polylines` table with indexes
- [ ] Add migration scripts to `/db/migrations/`
- [ ] Test migration on development database

### Backend Changes
- [ ] Build background worker service
- [ ] Implement batch processing logic
- [ ] Add tracking for processed coordinates
- [ ] Create new `/paths/cached` endpoint
- [ ] Add monitoring/logging for worker

### Infrastructure Changes
- [ ] Add worker service to `docker-compose.yml`
- [ ] Configure worker environment variables
- [ ] Set up worker health checks
- [ ] Add worker to logging pipeline

### Testing & Validation
- [ ] Test worker processes old GPS data correctly
- [ ] Verify cache hit rates > 95%
- [ ] Load test cached endpoint
- [ ] Test failure scenarios (OSRM down, worker crash)
- [ ] Verify data consistency between tables

### Documentation
- [ ] Document new architecture
- [ ] Update API documentation
- [ ] Create runbook for worker monitoring
- [ ] Document rollback procedures

---

## 🔍 Questions to Resolve

### 1. **Batch Processing Window**
How often should the worker run?
- Option A: Every 1 minute (near real-time)
- Option B: Every 5 minutes (less load)
- Option C: Every 15 minutes (batch-oriented)

**Recommendation:** Start with 1 minute, adjust based on GPS arrival rate

### 2. **Cache Expiration**
How long should we keep cached polylines?
- Option A: Forever (with LRU eviction)
- Option B: 30 days rolling window
- Option C: Configurable per device

**Recommendation:** 30 days, with popular paths kept longer

### 3. **Historical Data Migration**
Should we backfill `gps_coordinates` from `markers`?
- Pros: Complete historical cache
- Cons: Large one-time processing job

**Recommendation:** Backfill last 7 days only, leave older data in `markers`

### 4. **Worker Deployment**
Separate container or shared backend container?
- Option A: Separate worker container (cleaner separation)
- Option B: Background thread in backend (simpler deployment)

**Recommendation:** Separate container for easier scaling and monitoring

---

## 📈 Monitoring & Observability

### Key Metrics to Track

**Worker Performance:**
- GPS coordinates processed per minute
- Average OSRM call duration
- Processing backlog size
- Failure rate

**Cache Performance:**
- Cache hit rate (should be > 95%)
- Average response time
- Cache size / memory usage
- Stale cache entries

**System Health:**
- OSRM service availability
- Database connection pool usage
- Worker restarts/errors
- End-to-end latency

---

## 💡 Future Enhancements

### Short Term (1-3 months)
1. **Smart Batch Sizing:** Adjust batch size based on GPS density
2. **Priority Queue:** Process recent data first
3. **Partial Cache:** Return partial results while background processes

### Medium Term (3-6 months)
1. **Multi-Region OSRM:** Route to nearest OSRM instance
2. **Predictive Caching:** Pre-compute paths for frequent routes
3. **Cache Warming:** Populate cache for anticipated queries

### Long Term (6-12 months)
1. **Incremental Updates:** Only re-process new segments
2. **ML-Based Routing:** Learn better routes from historical data
3. **Federation:** Share cache across multiple instances

---

## 🎓 Key Architectural Principles

**Separation of Concerns:**
- GPS collection ≠ GPS processing ≠ GPS delivery
- Each layer has single responsibility

**Asynchronous Processing:**
- Never make users wait for computation
- Background work happens out-of-band

**Idempotency:**
- Re-processing same GPS data produces same result
- Safe to retry failed batches

**Observability:**
- Every stage is measurable
- Clear health indicators
- Easy debugging

---

## 📝 Next Steps

1. **Review this document together** - discuss questions and decisions
2. **Design database schema** - finalize table structures
3. **Prototype worker** - build minimal viable background processor
4. **Test on subset** - process one device's data end-to-end
5. **Deploy to production** - gradual rollout with monitoring

---

**Document Version:** 1.0  
**Last Updated:** October 28, 2025  
**Author:** Architecture Team  
**Status:** DRAFT - Awaiting Review
