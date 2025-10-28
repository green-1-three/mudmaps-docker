# Architecture Decision Record
## OSRM Background Worker - Key Decisions

**Date:** October 28, 2025  
**Status:** Under Review  
**Participants:** James, Claude

---

## Decision 1: Database Schema Approach

### Context
We need to separate raw GPS data from processed polylines. Should we keep the existing `markers` table or create new tables?

### Options

#### Option A: Augment Existing `markers` Table ⭐ RECOMMENDED
**Approach:** Add `processed` and `batch_id` columns to existing table

**Pros:**
- ✅ Zero downtime migration
- ✅ No TCP listener changes needed
- ✅ Preserves historical data
- ✅ Simple ALTER TABLE command
- ✅ Backward compatible

**Cons:**
- ❌ Table name doesn't reflect new purpose
- ❌ Slightly less "clean" architecturally
- ❌ Large table may have performance implications long-term

**Migration SQL:**
```sql
ALTER TABLE markers 
ADD COLUMN processed BOOLEAN DEFAULT FALSE,
ADD COLUMN batch_id UUID;

CREATE INDEX idx_markers_unprocessed 
ON markers(username, processed, created_at) 
WHERE processed = FALSE;
```

**Impact:** Low risk, immediate deployment possible

---

#### Option B: Create New `gps_coordinates` Table
**Approach:** New table for incoming GPS, migrate historical data

**Pros:**
- ✅ Clean separation of concerns
- ✅ Better naming convention
- ✅ Fresh start, optimized indexes
- ✅ Can optimize data types

**Cons:**
- ❌ Requires TCP listener changes
- ❌ Complex data migration
- ❌ Need to maintain both tables during transition
- ❌ Potential for data loss during migration
- ❌ More testing required

**Migration SQL:**
```sql
-- Create new table
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

-- Migrate existing data (expensive!)
INSERT INTO gps_coordinates (device_id, longitude, latitude, recorded_at)
SELECT username, coords[1], coords[2], created_at FROM markers;
```

**Impact:** High risk, requires significant testing

---

### Recommendation
**Choose Option A: Augment existing `markers` table**

**Rationale:**
1. Lower risk - no breaking changes
2. Faster implementation - can deploy today
3. Proven pattern - many systems evolve tables over time
4. Easy rollback - just ignore new columns

**Follow-up:** Can rename table in future Phase 2 if desired

---

## Decision 2: Cache Table Design

### Context
Need to store processed polylines for fast retrieval. Should we transform `matched_paths` or create new?

### Options

#### Option A: Transform `matched_paths` to `cached_polylines` ⭐ RECOMMENDED
**Approach:** Rename and refactor existing cache table

**Pros:**
- ✅ Already has similar structure
- ✅ Some historical data already exists
- ✅ Indexes already tuned
- ✅ Simple migration path

**Cons:**
- ❌ Carries legacy column names
- ❌ May have unused columns
- ❌ Index overhead from old design

**Migration SQL:**
```sql
-- Rename table
ALTER TABLE matched_paths RENAME TO cached_polylines;

-- Drop unnecessary columns
ALTER TABLE cached_polylines DROP COLUMN raw_coordinates;
ALTER TABLE cached_polylines DROP COLUMN batch_index;
ALTER TABLE cached_polylines DROP COLUMN total_batches;

-- Add new tracking columns
ALTER TABLE cached_polylines ADD COLUMN last_accessed TIMESTAMPTZ;
ALTER TABLE cached_polylines ADD COLUMN access_count INTEGER DEFAULT 0;
ALTER TABLE cached_polylines ADD COLUMN processing_duration_ms INTEGER;

-- Add new index for access tracking
CREATE INDEX idx_cached_access 
ON cached_polylines(last_accessed DESC) 
WHERE last_accessed IS NOT NULL;
```

---

#### Option B: Create Fresh `cached_polylines` Table
**Approach:** New table with optimized design

**Pros:**
- ✅ Perfect column layout
- ✅ No legacy baggage
- ✅ Optimized indexes from start
- ✅ Clear naming

**Cons:**
- ❌ Lose existing cache data
- ❌ Cold start problem
- ❌ Duplicate effort (already have matched_paths)

**Migration SQL:**
```sql
CREATE TABLE cached_polylines (
    id BIGSERIAL PRIMARY KEY,
    device_id TEXT NOT NULL,
    start_time TIMESTAMPTZ NOT NULL,
    end_time TIMESTAMPTZ NOT NULL,
    encoded_polyline TEXT NOT NULL,
    osrm_confidence FLOAT,
    point_count INTEGER NOT NULL,
    processing_duration_ms INTEGER,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    last_accessed TIMESTAMPTZ,
    access_count INTEGER DEFAULT 0,
    UNIQUE(device_id, start_time)
);
```

---

### Recommendation
**Choose Option A: Transform `matched_paths`**

**Rationale:**
1. Preserves existing cache data
2. Faster initial deployment
3. Can refine over time
4. Less risk of cache miss on launch

---

## Decision 3: Worker Service Architecture

### Context
Need background processing. How should the worker run?

### Options

#### Option A: Separate Node.js Service ⭐ RECOMMENDED
**Approach:** Dedicated container with node-schedule

**Pros:**
- ✅ Independent scaling
- ✅ Clean separation of concerns
- ✅ Easy to restart/update without affecting API
- ✅ Separate logs and monitoring
- ✅ Can run multiple workers for scale

**Cons:**
- ❌ One more container to manage
- ❌ Slightly more complex deployment
- ❌ Need separate Dockerfile and config

**Implementation:**
```javascript
// worker/index.js
const schedule = require('node-schedule');

schedule.scheduleJob('*/1 * * * *', async () => {
    await processUnprocessedGPS();
});
```

**Docker Compose:**
```yaml
osrm-worker:
  build: ./worker
  environment:
    PGHOST: postgres
    OSRM_BASE: http://osrm:5000
  depends_on:
    - postgres
    - osrm
```

---

#### Option B: Background Thread in Backend
**Approach:** Add setInterval to existing backend service

**Pros:**
- ✅ Simpler deployment (no new container)
- ✅ Share database pool
- ✅ Same logging infrastructure

**Cons:**
- ❌ Mixed responsibilities (API + worker)
- ❌ Backend restarts affect worker
- ❌ Can't scale independently
- ❌ Harder to monitor separately
- ❌ Resource contention with API

**Implementation:**
```javascript
// backend/server.js
setInterval(processUnprocessedGPS, 60000);
```

---

#### Option C: PostgreSQL pg_cron Extension
**Approach:** Scheduled function inside database

**Pros:**
- ✅ No external service needed
- ✅ Direct database access
- ✅ Transactional guarantees

**Cons:**
- ❌ Requires PostgreSQL extension
- ❌ Limited debugging capabilities
- ❌ Harder to monitor
- ❌ Mixing application logic with database
- ❌ Can't call external HTTP (OSRM) easily

**Implementation:**
```sql
CREATE EXTENSION pg_cron;

SELECT cron.schedule('process-gps', '*/1 * * * *', $$
    SELECT process_unprocessed_gps();
$$);
```

---

### Recommendation
**Choose Option A: Separate Node.js Service**

**Rationale:**
1. Best practice for microservices
2. Independent scaling and monitoring
3. Same tech stack as backend (easy for team)
4. Clean separation allows easier testing
5. Industry standard pattern

---

## Decision 4: Processing Frequency

### Context
How often should the worker check for unprocessed GPS data?

### Options

#### Option A: Every 1 Minute ⭐ RECOMMENDED
**Pros:**
- ✅ Near real-time (max 1-2 min delay)
- ✅ Reasonable balance
- ✅ Good for live tracking use case

**Cons:**
- ❌ More frequent DB polling
- ❌ Slightly higher resource usage

**Expected Delay:** 1-2 minutes from GPS arrival to cache

---

#### Option B: Every 5 Minutes
**Pros:**
- ✅ Lower database load
- ✅ More time to batch coordinates
- ✅ Fewer OSRM calls

**Cons:**
- ❌ Longer delay for users
- ❌ Less "real-time" feel
- ❌ 5-10 min wait not acceptable for live tracking

**Expected Delay:** 5-10 minutes

---

#### Option C: On-Demand (Pub/Sub)
**Pros:**
- ✅ Instant processing
- ✅ No polling overhead
- ✅ Most efficient

**Cons:**
- ❌ Complex implementation (Redis/RabbitMQ)
- ❌ Another service dependency
- ❌ Overkill for this use case

---

### Recommendation
**Choose Option A: Every 1 Minute**

**Rationale:**
1. Good balance of responsiveness and efficiency
2. Simple implementation
3. Meets user expectations for live tracking
4. Can adjust later based on load

---

## Decision 5: Batch Size Strategy

### Context
How many GPS points should we group together for OSRM calls?

### Options

#### Option A: Time-Based Windows (5 minutes) ⭐ RECOMMENDED
**Approach:** Group coordinates within 5-minute time spans

**Pros:**
- ✅ Natural grouping (reflects actual movement)
- ✅ Predictable batch sizes
- ✅ Easy to reason about
- ✅ Aligns with user mental model ("last 5 minutes")

**Cons:**
- ❌ Variable batch sizes (sparse vs dense GPS)
- ❌ May need to split if > 100 points

**Implementation:**
```sql
SELECT 
    DATE_TRUNC('minute', created_at) / 5 * INTERVAL '5 minutes' as batch_time,
    ARRAY_AGG(coords ORDER BY created_at) as coordinates
FROM markers
WHERE processed = FALSE
GROUP BY batch_time
```

---

#### Option B: Fixed Point Count (50 points)
**Approach:** Always process exactly 50 points per batch

**Pros:**
- ✅ Consistent OSRM load
- ✅ Predictable processing time
- ✅ Easy capacity planning

**Cons:**
- ❌ Arbitrary cutoffs (may split logical routes)
- ❌ Doesn't respect temporal coherence
- ❌ Complex query logic

---

#### Option C: Adaptive (Device-Specific)
**Approach:** Learn optimal batch size per device

**Pros:**
- ✅ Optimized for each device's GPS rate
- ✅ Best performance theoretically

**Cons:**
- ❌ Complex implementation
- ❌ Requires ML/heuristics
- ❌ Premature optimization

---

### Recommendation
**Choose Option A: Time-Based Windows (5 minutes)**

**Rationale:**
1. Intuitive and easy to debug
2. Respects temporal coherence of routes
3. Simple SQL implementation
4. Can adjust window size if needed

---

## Decision 6: Cache Expiration Policy

### Context
How long should we keep cached polylines?

### Options

#### Option A: 30-Day Rolling Window ⭐ RECOMMENDED
**Approach:** Delete cache entries older than 30 days

**Pros:**
- ✅ Simple policy
- ✅ Bounded storage growth
- ✅ Covers most use cases
- ✅ Easy to communicate to users

**Cons:**
- ❌ Loses historical data
- ❌ May delete valuable routes

**Implementation:**
```sql
-- Daily cleanup job
DELETE FROM cached_polylines
WHERE created_at < NOW() - INTERVAL '30 days'
  AND (last_accessed IS NULL OR last_accessed < NOW() - INTERVAL '7 days');
```

---

#### Option B: Keep Forever (with LRU)
**Approach:** Only delete least-recently-used when storage full

**Pros:**
- ✅ Never lose data
- ✅ Popular routes always available
- ✅ Historical analysis possible

**Cons:**
- ❌ Unbounded storage growth
- ❌ Complex eviction logic
- ❌ Need monitoring for disk space

---

#### Option C: Device-Specific Retention
**Approach:** Different retention per device type

**Pros:**
- ✅ Flexible per use case
- ✅ Premium users get longer retention

**Cons:**
- ❌ Complex policy management
- ❌ Inconsistent user experience
- ❌ Harder to reason about

---

### Recommendation
**Choose Option A: 30-Day Rolling Window**

**Rationale:**
1. Simple and predictable
2. 30 days covers most tracking needs
3. Can preserve frequently accessed routes longer
4. Easy to implement and explain

---

## Decision 7: Error Handling Strategy

### Context
What should happen when OSRM fails to match a path?

### Options

#### Option A: Retry with Exponential Backoff ⭐ RECOMMENDED
**Approach:** Retry failed batches with increasing delays

**Pros:**
- ✅ Handles transient failures
- ✅ Doesn't overwhelm OSRM
- ✅ Eventually succeeds for temporary issues

**Cons:**
- ❌ Delayed processing for persistent failures
- ❌ Need to track retry counts

**Implementation:**
```javascript
async function processBatchWithRetry(batch, maxRetries = 3) {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            return await callOSRM(batch);
        } catch (error) {
            if (attempt === maxRetries - 1) throw error;
            await sleep(Math.pow(2, attempt) * 1000); // 1s, 2s, 4s
        }
    }
}
```

---

#### Option B: Mark as Failed, Move On
**Approach:** Log failure and continue to next batch

**Pros:**
- ✅ Simple
- ✅ Doesn't block other processing
- ✅ Fast failure

**Cons:**
- ❌ Loses data permanently
- ❌ No recovery from transient errors
- ❌ Poor user experience

---

#### Option C: Queue Failed Batches for Manual Review
**Approach:** Store failures in separate table for later

**Pros:**
- ✅ No data loss
- ✅ Can investigate issues
- ✅ Manual intervention possible

**Cons:**
- ❌ Requires manual work
- ❌ Complex workflow
- ❌ Delayed resolution

---

### Recommendation
**Choose Option A: Retry with Exponential Backoff**

**Rationale:**
1. Handles most errors automatically
2. Standard pattern in distributed systems
3. Good balance of reliability and complexity
4. Can add dead letter queue later if needed

---

## Summary of Decisions

| Decision | Chosen Option | Risk Level | Deployment Complexity |
|----------|---------------|------------|----------------------|
| Database Schema | Augment existing markers | LOW | Simple ALTER |
| Cache Table | Transform matched_paths | LOW | Simple rename |
| Worker Service | Separate Node.js container | MEDIUM | New service |
| Processing Frequency | Every 1 minute | LOW | Config value |
| Batch Strategy | 5-minute time windows | LOW | SQL GROUP BY |
| Cache Expiration | 30-day rolling | LOW | Daily cron |
| Error Handling | Retry with backoff | MEDIUM | Retry logic |

---

## Open Questions

1. **Question:** Should we backfill historical data or start fresh?
   - **Impact:** Cache availability on day 1
   - **Decision needed:** Before deployment

2. **Question:** What's the acceptable processing delay?
   - **Current:** Real-time expectation?
   - **Decision needed:** Validate with users

3. **Question:** How to handle gaps in GPS data?
   - **Impact:** Route continuity
   - **Decision needed:** Define business logic

4. **Question:** Should we preserve OSRM-failed coordinates separately?
   - **Impact:** Debugging and data analysis
   - **Decision needed:** Before worker implementation

---

## Next Steps

1. ✅ Review decisions above - get agreement
2. ⬜ Finalize database migration scripts
3. ⬜ Create worker service skeleton
4. ⬜ Build first prototype
5. ⬜ Test with real data

---

**Status:** Ready for review and discussion
**Approval needed:** Yes - let's discuss these decisions together!
