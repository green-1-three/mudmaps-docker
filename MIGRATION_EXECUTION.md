# Full Migration Execution - Step by Step

**Ready to execute Option B (Replace Entirely) migration**

---

## 🚀 Quick Start (Run These Commands)

```bash
# 1. Make migration script executable
chmod +x /Users/jamesfreeman/Desktop/Mudmaps-Docker/migrate.sh

# 2. Run database migration + TCP listener update
./migrate.sh

# 3. Replace backend (after migrate.sh completes)
cd /Users/jamesfreeman/Desktop/Mudmaps-Docker/backend
mv server.js server_old.js
mv server_new.js server.js

# 4. Restart backend
docker-compose restart backend

# 5. Test it works
curl http://localhost:3001/health | jq
curl http://localhost:3001/worker/status | jq
```

---

## 📋 Detailed Step-by-Step Instructions

### Step 1: Pre-Flight Check

```bash
cd /Users/jamesfreeman/Desktop/Mudmaps-Docker

# Verify Docker is running
docker ps

# Should see: mudmaps-postgres, mudmaps-backend, mudmaps-tcp-listener
```

---

### Step 2: Run Database Migration

```bash
# Make script executable
chmod +x migrate.sh

# Run the migration
./migrate.sh
```

**What it does:**
- ✅ Creates backups (database + code)
- ✅ Runs SQL migration (creates new tables)
- ✅ Migrates data (markers → gps_raw_data)
- ✅ Updates TCP listener code
- ✅ Restarts TCP listener
- ✅ Tests TCP listener with sample data

**Expected output:**
```
🚀 Starting Full Migration - Option B (Replace Entirely)
========================================================

Step 1: Pre-flight checks...
✓ Docker is running
✓ PostgreSQL container is running
✓ Migration file found

Step 2: Creating backups...
✓ Code files backed up to: backups/20251028_HHMMSS
✓ Database backed up

Step 3: Running database migration...
... (SQL output) ...
✓ Database migration completed successfully

Step 4: Verifying migration...
✓ All 3 new tables created
GPS data migrated: XXX rows (from XXX markers)
✓ All GPS data migrated successfully

Step 5: Updating TCP listener code...
✓ TCP listener code updated

Step 7: Restarting services...
✓ TCP listener restarted

Step 8: Testing TCP listener...
✓ TCP listener test PASSED - data saved to gps_raw_data

========================================================
✅ MIGRATION PHASE 1 COMPLETE
========================================================
```

---

### Step 3: Replace Backend Code

```bash
cd backend

# Backup old backend
mv server.js server_old.js

# Install new backend
mv server_new.js server.js

# Verify
ls -la server*.js
# Should see: server.js (new) and server_old.js (backup)
```

---

### Step 4: Restart Backend

```bash
cd ..

# Restart backend service
docker-compose restart backend

# Watch logs to confirm it started
docker logs -f mudmaps-backend
```

**Expected output:**
```
============================================
✅ MudMaps Backend (NEW SCHEMA)
============================================
📡 Server running on port 3000
📊 Reading from: gps_raw_data
⚡ Serving from: cached_polylines
📝 Logging to: processing_log

Available endpoints:
  GET  /markers
  GET  /markers/enhanced
  GET  /paths/cached ⚡ (FAST)
  GET  /paths/encoded (legacy)
  GET  /worker/status
  GET  /cache/stats
  GET  /processing/recent
  GET  /health
============================================
```

Press `Ctrl+C` to stop watching logs.

---

### Step 5: Test Everything Works

```bash
# Test health endpoint
curl http://localhost:3001/health | jq

# Expected output:
# {
#   "status": "healthy",
#   "database": "connected",
#   "schema_migrated": true,
#   "tables": {
#     "gps_raw_data": true,
#     "cached_polylines": true,
#     "processing_log": true
#   }
# }

# Test markers endpoint
curl http://localhost:3001/markers?limit=5 | jq

# Test worker status
curl http://localhost:3001/worker/status | jq

# Test cache stats
curl http://localhost:3001/cache/stats | jq
```

---

### Step 6: Send Test GPS Data

```bash
# Send GPS data to TCP listener
echo '{"username":"test-device","longitude":-72.5,"latitude":44.26,"timestamp":"'$(date -u +%Y-%m-%dT%H:%M:%SZ)'"}' | nc localhost 5500

# Verify it arrived in database
docker exec mudmaps-postgres psql -U mudmaps -d mudmapsdb -c "SELECT device_id, longitude, latitude, recorded_at FROM gps_raw_data WHERE device_id='test-device' ORDER BY recorded_at DESC LIMIT 1"
```

**Expected:** You should see your test GPS point in the database.

---

### Step 7: Test Frontend (Browser)

Open your frontend in a browser and check:

1. **Map loads** - Should display without errors
2. **Markers appear** - GPS points show up on map
3. **No console errors** - Check browser DevTools console

**Note:** Paths won't show yet because worker isn't running (that's Phase 2).

---

## ✅ Success Criteria

After migration, you should have:

- [x] Database migrated (3 new tables)
- [x] Old data preserved in `*_backup` tables
- [x] TCP listener writing to `gps_raw_data`
- [x] Backend reading from new schema
- [x] All endpoints responding correctly
- [x] Frontend still loads (even if paths are empty)

---

## 🔍 Troubleshooting

### Problem: Migration script fails

**Solution:**
```bash
# Check what failed
./migrate.sh 2>&1 | tee migration_log.txt

# Review the log
cat migration_log.txt
```

### Problem: TCP listener won't start

**Solution:**
```bash
# Check logs
docker logs mudmaps-tcp-listener

# Common issue: syntax error in code
# Fix: Restore backup
cp backups/LATEST/tcp-listener.js.bak tcp-listener/tcp-listener.js
docker-compose restart tcp-listener
```

### Problem: Backend won't start

**Solution:**
```bash
# Check logs
docker logs mudmaps-backend

# Common issue: missing tables
# Check if migration completed:
docker exec mudmaps-postgres psql -U mudmaps -d mudmapsdb -c "\dt"

# Should see: gps_raw_data, cached_polylines, processing_log
```

### Problem: Frontend shows errors

**Solution:**
```bash
# Check browser console for specific error
# Most likely: API endpoint not responding

# Test backend health:
curl http://localhost:3001/health

# If health check fails, backend migration incomplete
```

---

## 🔄 Rollback Procedure

If something goes wrong and you need to rollback:

```bash
# 1. Rollback database
docker exec -i mudmaps-postgres psql -U mudmaps -d mudmapsdb < db/migrations/002_background_worker_schema_rollback.sql

# 2. Restore TCP listener
LATEST_BACKUP=$(ls -t backups/ | head -1)
cp backups/$LATEST_BACKUP/tcp-listener.js.bak tcp-listener/tcp-listener.js

# 3. Restore backend
cd backend
mv server.js server_broken.js
mv server_old.js server.js
cd ..

# 4. Restart everything
docker-compose restart tcp-listener backend

# 5. Verify rollback worked
curl http://localhost:3001/health
```

---

## 📊 What's Next After Successful Migration?

### Immediate (Today):
- ✅ Migration complete
- ✅ TCP listener and backend updated
- ✅ System working with new schema

### Phase 2 (Tomorrow):
- [ ] Build background worker service
- [ ] Worker processes GPS → cached polylines
- [ ] Test worker with real data

### Phase 3 (Day After):
- [ ] Deploy worker to production
- [ ] Monitor cache population
- [ ] Optimize and tune

---

## 💾 Backup Locations

All backups are saved to:
```
backups/YYYYMMDD_HHMMSS/
├── database_backup.sql
├── tcp-listener.js.bak
└── server.js.bak
```

**Keep these backups for at least 7 days!**

---

## 🎯 Quick Reference Commands

```bash
# Check system status
docker-compose ps

# View logs
docker logs mudmaps-backend
docker logs mudmaps-tcp-listener
docker logs mudmaps-postgres

# Check database
docker exec mudmaps-postgres psql -U mudmaps -d mudmapsdb -c "\dt"

# Test endpoints
curl http://localhost:3001/health | jq
curl http://localhost:3001/worker/status | jq
curl http://localhost:3001/markers?limit=5 | jq

# Send test GPS
echo '{"username":"test","longitude":-72.5,"latitude":44.2}' | nc localhost 5500

# Query GPS data
docker exec mudmaps-postgres psql -U mudmaps -d mudmapsdb -c "SELECT COUNT(*) FROM gps_raw_data"

# Check cache
docker exec mudmaps-postgres psql -U mudmaps -d mudmapsdb -c "SELECT COUNT(*) FROM cached_polylines"
```

---

## 📞 Ready?

**When you're ready to execute:**

```bash
cd /Users/jamesfreeman/Desktop/Mudmaps-Docker
chmod +x migrate.sh
./migrate.sh
```

Then follow the steps above!

**Questions before we start?** Let me know! Otherwise, run that `./migrate.sh` and let's see how it goes! 🚀
