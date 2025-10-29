# Quick Reference - OSRM Background Worker Project

**Last Updated:** October 28, 2025

---

## 📚 Documentation Index

1. **ARCHITECTURE_ANALYSIS.md** - Comprehensive architecture overview
2. **IMPLEMENTATION_ROADMAP.md** - Step-by-step implementation guide  
3. **ARCHITECTURE_VISUAL.md** - Visual diagrams and comparisons
4. **DECISION_MATRIX.md** - Key architectural decisions and rationale
5. **README_PROJECT.md** - This file (quick reference)

---

## 🎯 Project Goal

**Transform OSRM from on-demand (slow) to background worker (fast)**

Current: User waits 3-8 seconds for OSRM processing  
Target: User sees map in < 500ms (from pre-cached data)

---

## 🏗️ High-Level Architecture

### Before (Current - SLOW)
```
User Request → Backend → Fetch GPS → Call OSRM → Wait... → Return
                                                    ⏱️ 3-8 seconds
```

### After (Proposed - FAST)
```
GPS Arrives → Background Worker → OSRM → Cache → Done
                                         (happens in background)

User Request → Backend → Fetch Cache → Return
                                        ⚡ < 500ms
```

---

## 📊 Key Tables

### Input: `markers` (augmented)
```sql
-- Raw GPS data with processing tracking
CREATE TABLE markers (
    id SERIAL,
    username TEXT,
    coords DOUBLE PRECISION[],
    created_at TIMESTAMPTZ,
    processed BOOLEAN DEFAULT FALSE,    -- NEW
    batch_id UUID                        -- NEW
);
```

### Output: `cached_polylines` (new/renamed)
```sql
-- Ready-to-display polylines
CREATE TABLE cached_polylines (
    id BIGSERIAL PRIMARY KEY,
    device_id TEXT,
    start_time TIMESTAMPTZ,
    end_time TIMESTAMPTZ,
    encoded_polyline TEXT,              -- Display on map
    osrm_confidence FLOAT,
    point_count INTEGER,
    processing_duration_ms INTEGER,
    created_at TIMESTAMPTZ,
    last_accessed TIMESTAMPTZ,
    UNIQUE(device_id, start_time)
);
```

---

## 🔄 Background Worker Logic

```javascript
// Every 1 minute:
1. Find unprocessed GPS coordinates
2. Group by device + 5-minute time windows
3. Call OSRM for each batch
4. Store result in cached_polylines
5. Mark markers as processed=true
```

---

## 🚀 Deployment Plan

### Phase 1: Database (Day 1)
- Add `processed` and `batch_id` columns to `markers`
- Rename/create `cached_polylines` table
- Add indexes

### Phase 2: Worker Service (Days 2-4)
- Build Node.js worker service
- Implement processing logic
- Add to Docker Compose

### Phase 3: API Updates (Day 5)
- Create `/paths/cached` endpoint
- Update frontend to use new endpoint

### Phase 4: Testing (Days 6-7)
- Integration testing
- Load testing
- Monitor cache hit rates

### Phase 5: Cutover (Day 8)
- Switch frontend to cached endpoint
- Monitor performance
- Celebrate! 🎉

---

## 🔑 Key Decisions Made

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Database approach | Augment existing `markers` | Zero downtime, simple migration |
| Cache table | Transform `matched_paths` | Preserve existing cache data |
| Worker architecture | Separate Node.js service | Clean separation, independent scaling |
| Processing frequency | Every 1 minute | Good balance of real-time and efficiency |
| Batch strategy | 5-minute time windows | Natural grouping, temporal coherence |
| Cache expiration | 30-day rolling window | Bounded storage, covers most use cases |
| Error handling | Retry with exponential backoff | Handles transient failures automatically |

---

## 📈 Expected Performance Improvements

| Metric | Before | After | Improvement |
|--------|--------|-------|-------------|
| Map load time | 3-8 seconds | < 500ms | **6-16x faster** |
| User blocking | Yes (waits for OSRM) | No (instant cache) | **Non-blocking** |
| Scalability | Linear degradation | Constant time | **100x more users** |
| Cache hit rate | ~70% (ad-hoc) | > 95% (systematic) | **Better UX** |

---

## 🛠️ Quick Commands

### Database Migration
```bash
# Apply migrations
psql -U $PGUSER -d $PGDATABASE -f db/migrations/002_add_background_worker.sql
```

### Worker Development
```bash
# Start worker locally
cd worker
npm install
node index.js
```

### Check Worker Status
```bash
# API endpoint
curl http://localhost:3000/worker/status

# Database query
psql -c "SELECT COUNT(*) FROM markers WHERE processed = FALSE"
```

### Monitor Processing
```bash
# Watch logs
docker logs -f mudmaps-osrm-worker

# Cache stats
psql -c "SELECT COUNT(*), AVG(point_count) FROM cached_polylines"
```

---

## 🔍 Troubleshooting

### Worker not processing?
```bash
# Check worker is running
docker ps | grep worker

# Check logs
docker logs mudmaps-osrm-worker

# Verify DB connection
docker exec mudmaps-osrm-worker node -e "require('pg').Pool().query('SELECT 1')"
```

### OSRM failing?
```bash
# Check OSRM health
curl http://localhost:5000/route/v1/driving/-122.4,37.8;-122.5,37.9

# Check OSRM logs
docker logs mudmaps-osrm
```

### Cache not populating?
```sql
-- Check unprocessed count
SELECT COUNT(*) FROM markers WHERE processed = FALSE;

-- Check recent cache entries
SELECT * FROM cached_polylines ORDER BY created_at DESC LIMIT 10;

-- Check for errors
SELECT * FROM processing_batches WHERE status = 'failed';
```

---

## 🎓 Key Concepts

**Separation of Concerns:**
- GPS collection (TCP listener)
- GPS processing (Worker)
- GPS delivery (API)

**Asynchronous Processing:**
- Users never wait for computation
- Work happens in background

**Idempotency:**
- Safe to re-process same data
- No side effects from retries

**Cache-First:**
- Display cached data first
- Process new data in background

---

## 📞 Support & Resources

**Documentation:** See files in this directory
**Architecture Diagrams:** ARCHITECTURE_VISUAL.md
**Implementation Steps:** IMPLEMENTATION_ROADMAP.md
**Decisions Explained:** DECISION_MATRIX.md

---

## ✅ Current Status

- [x] Architecture designed
- [x] Documentation written
- [ ] Database migrations created
- [ ] Worker service built
- [ ] API endpoints updated
- [ ] Testing completed
- [ ] Deployed to production

**Next Step:** Review decisions and finalize database schema

---

## 🚦 Success Criteria

### Must Have (MVP)
- ✅ Map loads < 1 second
- ✅ No user-facing OSRM calls
- ✅ Worker processes new GPS within 2 minutes
- ✅ Cache hit rate > 90%

### Nice to Have (Future)
- ✅ Cache hit rate > 95%
- ✅ Map loads < 500ms
- ✅ Support for 1000+ concurrent users
- ✅ Historical route analysis

---

## 💡 Future Enhancements

**Short Term (1-3 months):**
- Smart batch sizing
- Priority queue for recent data
- Partial cache responses

**Medium Term (3-6 months):**
- Multi-region OSRM
- Predictive caching
- ML-based route optimization

**Long Term (6-12 months):**
- Incremental updates
- Route sharing across instances
- Advanced analytics

---

## 📝 Notes

- All times are based on single-device testing
- OSRM instance has 1GB memory limit
- Current setup: Docker Compose on single host
- Database: PostgreSQL 16-alpine

---

**Ready to start? Let's begin with Phase 1 - Database Schema Design!**
