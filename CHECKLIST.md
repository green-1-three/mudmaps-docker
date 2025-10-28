# ✅ Migration Readiness Checklist

**Before you run the migration, verify these items:**

---

## Pre-Migration Checklist

### Environment
- [ ] Docker is running (`docker ps` works)
- [ ] PostgreSQL container is up (`docker ps | grep postgres`)
- [ ] Backend container is up
- [ ] TCP listener container is up
- [ ] You have SSH/terminal access to the server

### Backups
- [ ] You have a recent full system backup (optional but recommended)
- [ ] Migration script will create automatic backups
- [ ] You know how to restore from backup if needed

### Files Ready
- [ ] `migrate.sh` exists and is ready
- [ ] `db/migrations/002_background_worker_schema.sql` exists
- [ ] `backend/server_new.js` exists
- [ ] All files are in correct location

### Testing
- [ ] You can access the application currently
- [ ] You can send test GPS data: `echo '{"username":"test","longitude":-72.5,"latitude":44.2}' | nc localhost 5500`
- [ ] You can query database: `docker exec mudmaps-postgres psql -U mudmaps -d mudmapsdb -c "SELECT 1"`

---

## Migration Execution Checklist

### Phase 1: Database + TCP Listener
```bash
cd /Users/jamesfreeman/Desktop/Mudmaps-Docker
chmod +x migrate.sh
./migrate.sh
```

- [ ] Script completed without errors
- [ ] New tables created (gps_raw_data, cached_polylines, processing_log)
- [ ] Data migrated successfully
- [ ] TCP listener restarted
- [ ] TCP listener test passed

### Phase 2: Backend
```bash
cd backend
mv server.js server_old.js
mv server_new.js server.js
cd ..
docker-compose restart backend
```

- [ ] Backend file replaced
- [ ] Backend restarted successfully
- [ ] Backend logs show "NEW SCHEMA" message
- [ ] No error messages in logs

### Phase 3: Verification
```bash
# Health check
curl http://localhost:3001/health | jq

# Worker status  
curl http://localhost:3001/worker/status | jq

# Test markers
curl http://localhost:3001/markers?limit=5 | jq
```

- [ ] Health endpoint returns `"status": "healthy"`
- [ ] Worker status returns statistics
- [ ] Markers endpoint returns data
- [ ] No errors in any endpoint

### Phase 4: Functional Testing
```bash
# Send GPS data
echo '{"username":"migration-test","longitude":-72.5,"latitude":44.26}' | nc localhost 5500

# Verify it saved
docker exec mudmaps-postgres psql -U mudmaps -d mudmapsdb -c \
  "SELECT * FROM gps_raw_data WHERE device_id='migration-test' ORDER BY recorded_at DESC LIMIT 1"
```

- [ ] GPS data sent successfully
- [ ] Data appears in gps_raw_data table
- [ ] processed = FALSE (correct)

### Phase 5: Frontend Testing
- [ ] Open frontend in browser
- [ ] Map loads without errors
- [ ] Check browser console - no errors
- [ ] GPS markers display on map
- [ ] No JavaScript errors

---

## Post-Migration Checklist

### Immediate (Right After)
- [ ] All services running: `docker-compose ps`
- [ ] Backend responding: `curl http://localhost:3001/health`
- [ ] TCP listener accepting data
- [ ] Frontend loads without errors
- [ ] Backup files saved in `backups/` directory

### Within 1 Hour
- [ ] Send real GPS data from device
- [ ] Verify it arrives in gps_raw_data
- [ ] Check backend logs for any errors
- [ ] Monitor system resources

### Within 24 Hours
- [ ] Build and deploy worker service (Phase 2)
- [ ] Verify worker processes GPS data
- [ ] Check cached_polylines populates
- [ ] Test /paths/cached endpoint
- [ ] Performance validation

---

## Rollback Checklist (If Needed)

**Only if something goes wrong:**

```bash
# 1. Rollback database
docker exec -i mudmaps-postgres psql -U mudmaps -d mudmapsdb < \
  db/migrations/002_background_worker_schema_rollback.sql

# 2. Restore TCP listener
BACKUP=$(ls -t backups/ | head -1)
cp backups/$BACKUP/tcp-listener.js.bak tcp-listener/tcp-listener.js

# 3. Restore backend
cd backend
mv server.js server_failed.js
mv server_old.js server.js
cd ..

# 4. Restart
docker-compose restart tcp-listener backend

# 5. Verify
curl http://localhost:3001/health
```

- [ ] Database rolled back
- [ ] Code restored from backups
- [ ] Services restarted
- [ ] System working as before
- [ ] Understand what went wrong

---

## Success Criteria

**Migration is successful when:**

✅ All services running without errors  
✅ TCP listener saves to gps_raw_data  
✅ Backend reads from new tables  
✅ All API endpoints respond correctly  
✅ Frontend displays without errors  
✅ GPS data flows end-to-end  

---

## Quick Status Commands

```bash
# Overall status
docker-compose ps

# Check new tables
docker exec mudmaps-postgres psql -U mudmaps -d mudmapsdb -c "\dt" | grep -E "gps_raw_data|cached_polylines|processing_log"

# Count GPS points
docker exec mudmaps-postgres psql -U mudmaps -d mudmapsdb -c "SELECT COUNT(*) FROM gps_raw_data"

# Test all endpoints
curl -s http://localhost:3001/health | jq '.status'
curl -s http://localhost:3001/worker/status | jq '.status'
curl -s http://localhost:3001/markers?limit=1 | jq 'length'
```

---

## 🚦 Ready to Execute?

### Green Light ✅ (Ready to Proceed)
- All pre-migration checks passed
- You have terminal access
- System is currently stable
- You're ready to monitor during migration

### Yellow Light ⚠️ (Proceed with Caution)
- Some checks failed but you understand why
- Testing in non-production environment
- Have rollback plan ready

### Red Light 🛑 (Do NOT Proceed)
- Docker not running
- Cannot access database
- Missing critical files
- Production system with no backup plan

---

**Current Status: Ready for execution!**

**When ready, run:**
```bash
cd /Users/jamesfreeman/Desktop/Mudmaps-Docker
./migrate.sh
```

Then follow MIGRATION_EXECUTION.md for next steps!
