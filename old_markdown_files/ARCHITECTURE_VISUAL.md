# OSRM Architecture - Visual Overview

## BEFORE: On-Demand Processing (Current - SLOW 🐌)

```
┌─────────────┐
│    User     │
│   Browser   │
└──────┬──────┘
       │ 1. Request map
       ↓
┌─────────────────┐
│  Backend API    │
│  /paths/encoded │
└────────┬────────┘
         │ 2. Fetch GPS from DB
         ↓
    ┌────────┐
    │markers │  (Raw GPS points)
    └────────┘
         ↓
         │ 3. Call OSRM for EACH request
         ↓
    ┌──────────┐
    │   OSRM   │  (Road matching - BLOCKING)
    │  Service │
    └──────────┘
         ↓
         │ 4. Return results
         ↓
┌─────────────────┐
│  User waits...  │  ⏱️ 3-8 seconds
│  Map loads slow │
└─────────────────┘

Problems:
❌ Users wait for OSRM on every request
❌ Same data processed repeatedly
❌ OSRM becomes bottleneck
❌ Unpredictable performance
```

---

## AFTER: Background Worker (Proposed - FAST ⚡)

```
GPS DATA ARRIVAL (Continuous)
━━━━━━━━━━━━━━━━━━━━━━━━━━━
┌──────────────┐
│ GPS Tracker  │
│  Sends data  │
└──────┬───────┘
       │ TCP connection
       ↓
┌──────────────────┐
│  TCP Listener    │
│   (Port 5500)    │
└────────┬─────────┘
         │ Insert raw GPS
         ↓
    ┌─────────┐
    │ markers │ processed=FALSE ─┐
    └─────────┘                   │
                                  │
                                  │
BACKGROUND PROCESSING (Every minute)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
                                  │
         ┌────────────────────────┘
         │
    ┌────▼─────────┐
    │ OSRM Worker  │  (Runs independently)
    │  Background  │
    └────┬─────────┘
         │ 1. Find unprocessed GPS
         │ 2. Group into batches
         │ 3. Call OSRM
         ↓
    ┌──────────┐
    │   OSRM   │  (Not blocking users!)
    │  Service │
    └─────┬────┘
          │ 4. Store results
          ↓
    ┌──────────────────┐
    │cached_polylines  │  Ready-to-display paths
    └──────────────────┘
          │ 5. Mark processed
          ↓
    ┌─────────┐
    │ markers │ processed=TRUE
    └─────────┘


USER REQUEST (Instant!)
━━━━━━━━━━━━━━━━━━━━━━
┌─────────────┐
│    User     │
│   Browser   │
└──────┬──────┘
       │ 1. Request map
       ↓
┌─────────────────┐
│  Backend API    │
│  /paths/cached  │
└────────┬────────┘
         │ 2. Simple SELECT
         ↓
    ┌──────────────────┐
    │cached_polylines  │  (Pre-computed!)
    └──────────────────┘
         ↓
         │ 3. Return instantly
         ↓
┌─────────────────┐
│  Map loads!     │  ⚡ < 500ms
│  Instant UX     │
└─────────────────┘

Benefits:
✅ Users never wait for OSRM
✅ Data processed once, used many times
✅ OSRM load distributed over time
✅ Predictable, fast performance
```

---

## Database Schema Evolution

### CURRENT STATE
```
┌──────────────────────────────────┐
│          markers                 │
│  ─────────────────────────────   │
│  id, username, coords[], created │
│  (Raw GPS + everything else)     │
└──────────────────────────────────┘
           ↓ (on user request)
┌──────────────────────────────────┐
│       matched_paths              │
│  ─────────────────────────────   │
│  device_id, encoded_polyline,    │
│  raw_coordinates, ...            │
│  (Cache + backup data mixed)     │
└──────────────────────────────────┘
```

### NEW DESIGN
```
INPUT LAYER
┌──────────────────────────────────┐
│          markers                 │
│  ─────────────────────────────   │
│  id, username, coords[]          │
│  processed BOOL ← NEW             │
│  batch_id UUID  ← NEW             │
│  (Raw GPS data only)             │
└──────────────────────────────────┘
           ↓
      (Background worker processes)
           ↓
OUTPUT LAYER
┌──────────────────────────────────┐
│      cached_polylines            │
│  ─────────────────────────────   │
│  device_id, start_time,          │
│  encoded_polyline ← Ready!        │
│  (Only display-ready data)       │
└──────────────────────────────────┘
```

**Key Changes:**
1. **Separation:** Input (markers) vs Output (cached_polylines)
2. **Tracking:** `processed` flag prevents reprocessing
3. **Purpose:** Each table has single responsibility

---

## Processing Flow Details

### Current: User-Triggered
```
User Request → Query markers → Group by device → 
Call OSRM (batch 1) → Wait... →
Call OSRM (batch 2) → Wait... →
Call OSRM (batch 3) → Wait... →
Return to user (finally!)

⏱️ Time: 3-8 seconds per request
🔄 Repeated for same data
```

### New: Background Processing
```
GPS arrives → Insert to markers (processed=false)
                    ↓
            (User sees nothing yet)
                    ↓
Worker wakes up (every 1 min) →
Find unprocessed coords →
Group into time windows →
Call OSRM (no rush!) →
Cache result →
Mark processed=true
                    ↓
User requests → SELECT from cache → Display!

⏱️ Time: < 500ms (just DB query)
🔄 Process once, use forever
```

---

## Data Flow Comparison

### BEFORE
```
GPS Point Lifecycle:
1. Arrives via TCP          [0s]
2. Stored in markers        [0s]
3. User requests map        [+5s]
4. Backend queries markers  [+5s]
5. Backend calls OSRM       [+7s]
6. User sees map            [+7s]
   └─ SLOW: 7 seconds
```

### AFTER
```
GPS Point Lifecycle:
1. Arrives via TCP          [0s]
2. Stored in markers        [0s]
3. Worker picks it up       [+60s max]
4. OSRM processes           [+62s]
5. Cached in polylines      [+62s]
6. User requests map        [anytime after +62s]
7. User sees map            [< 1s after request]
   └─ FAST: Sub-second for user!
```

---

## Worker Process Detail

```
WORKER CYCLE (Every 1 minute)
┌───────────────────────────────────────┐
│                                       │
│  1. Wake Up                           │
│     ↓                                 │
│  2. Query: Find unprocessed coords    │
│     SELECT * FROM markers             │
│     WHERE processed = FALSE           │
│     ↓                                 │
│  3. Group by device + time window     │
│     Device A: [100 points]            │
│     Device B: [50 points]             │
│     Device C: [200 points]            │
│     ↓                                 │
│  4. Process each device               │
│     ↓                                 │
│  ┌─────────────────────────┐          │
│  │  For Device A:          │          │
│  │  - Split into batches   │          │
│  │  - Call OSRM batch 1    │          │
│  │  - Call OSRM batch 2    │          │
│  │  - Cache results        │          │
│  │  - Mark processed=true  │          │
│  └─────────────────────────┘          │
│     ↓                                 │
│  5. Sleep until next cycle            │
│                                       │
└───────────────────────────────────────┘
```

---

## Scaling Considerations

### Current Architecture
```
1 User  → 1 OSRM call  → 3 seconds
10 Users → 10 OSRM calls → 30 seconds (sequential)
100 Users → 💥 System overload
```

### New Architecture
```
1 User  → 1 Cache read → 0.5 seconds
10 Users → 10 Cache reads → 0.5 seconds (parallel)
100 Users → 100 Cache reads → 0.5 seconds
1000 Users → Still fine! (just DB reads)

Background worker processes at steady rate:
- 1 device = 1 batch/minute
- 10 devices = 10 batches/minute
- Scale workers horizontally if needed
```

---

## Error Handling

### Current
```
User request → OSRM fails → User sees error ❌
```

### New
```
GPS arrives → Worker processes → OSRM fails
  → Retry later → User never affected
  → Fallback: Show raw GPS points
```

---

## Cache Management

### Cache Lifecycle
```
1. GPS arrives (unprocessed)
2. Worker processes → Cache entry created
3. User accesses → Cache hit! ✅
4. ... (30 days later)
5. Cleanup job → Remove old cache
   (or keep if frequently accessed)
```

### Cache Optimization
```
Priority Queue:
1. Recent data (< 24h)     → High priority
2. Frequently accessed     → High priority  
3. Old, unused data        → Low priority → Delete
```

---

## Monitoring Dashboard

```
┌─────────────────────────────────────────┐
│        OSRM Background Worker           │
│         System Dashboard                │
├─────────────────────────────────────────┤
│                                         │
│  Processing Status:                     │
│  ├─ Unprocessed points: 234            │
│  ├─ Processing rate: 150 pts/min       │
│  └─ Avg delay: 45 seconds              │
│                                         │
│  Cache Performance:                     │
│  ├─ Hit rate: 98.5% ✅                  │
│  ├─ Total paths: 1,247                 │
│  └─ Storage: 45 MB                     │
│                                         │
│  OSRM Health:                           │
│  ├─ Success rate: 99.2% ✅              │
│  ├─ Avg response: 120ms                │
│  └─ Failures: 3 (last hour)            │
│                                         │
│  Worker Status:                         │
│  ├─ Uptime: 7 days, 3 hours            │
│  ├─ Last cycle: 23 seconds ago         │
│  └─ Next cycle: in 37 seconds          │
│                                         │
└─────────────────────────────────────────┘
```

---

## Migration Path

```
WEEK 1: Setup
├─ Day 1-2: Design & review database schema
├─ Day 3-4: Build worker service
└─ Day 5: Deploy worker (not yet active)

WEEK 2: Testing
├─ Day 1-2: Test worker with sample data
├─ Day 3: Backfill recent cache
└─ Day 4-5: Integration testing

WEEK 3: Cutover
├─ Day 1: Deploy new /paths/cached endpoint
├─ Day 2: Switch frontend to new endpoint
├─ Day 3-5: Monitor, optimize, celebrate! 🎉
```

---

## Summary: Why This Is Better

| Aspect | Before | After |
|--------|--------|-------|
| **User Experience** | Wait 3-8s for map | Map loads < 500ms |
| **Scalability** | Linear degradation | Handles 100x users |
| **OSRM Load** | Spiky, unpredictable | Smooth, distributed |
| **Caching** | Ad-hoc, on-demand | Systematic, proactive |
| **Resilience** | User sees failures | Failures isolated |
| **Development** | Mixed concerns | Clean separation |

---

**This is the architecture we're building towards!**

Ready to start with Phase 1? Let's design the database schema together! 🚀
