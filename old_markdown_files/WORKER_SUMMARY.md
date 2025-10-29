# Background Worker - Implementation Summary

## What We Just Built

A Node.js background worker service that:
- ✅ Runs every 60 seconds (configurable via `WORKER_INTERVAL`)
- ✅ Finds unprocessed GPS points (`processed = false`)
- ✅ Groups them by device and time windows (60-minute windows)
- ✅ Calls OSRM to generate road-matched polylines
- ✅ Stores results in `cached_polylines` table
- ✅ Marks GPS points as `processed = true`
- ✅ Logs everything to `processing_log` table
- ✅ Reports statistics every 5 minutes

## Files Created

1. **`worker/worker.js`** - Main worker logic (300+ lines)
2. **`worker/package.json`** - Dependencies
3. **`worker/Dockerfile`** - Container definition
4. **`worker/.dockerignore`** - Build exclusions
5. **`docker-compose.yml`** - Updated with worker service

## Key Features

### Smart Batching
- Groups GPS points into 60-minute time windows
- Processes up to 50 coordinates per batch
- Requires minimum 2 points to create a polyline

### Error Handling
- Logs all processing attempts to `processing_log`
- Continues on OSRM failures (doesn't crash)
- Graceful shutdown on SIGTERM/SIGINT

### Monitoring
- Logs statistics every 5 minutes
- Shows: total points, unprocessed, processed, cached paths, backlog
- Console output for easy debugging

## Configuration

Environment variables (set in docker-compose.yml):
- `WORKER_INTERVAL` - How often to run (default: 60000ms = 60 seconds)
- `OSRM_BASE` - OSRM service URL (default: http://osrm:5000)
- `PGHOST`, `PGDATABASE`, `PGUSER`, `PGPASSWORD` - Database connection

## How It Works

```
Every 60 seconds:
1. Query: SELECT * FROM gps_raw_data WHERE processed = false
2. Group by device_id
3. For each device:
   - Group points into time windows
   - Call OSRM match API
   - Encode polyline
   - INSERT INTO cached_polylines
   - UPDATE gps_raw_data SET processed = true
   - Log to processing_log
```

## Next Steps

### Deploy the Worker

1. **Full Deploy:**
   ```bash
   # Run Raycast "Full Deploy"
   ```

2. **Verify It's Running:**
   ```bash
   # SSH to server
   docker compose ps
   
   # Should see:
   # mudmaps-worker    Up
   ```

3. **Check Logs:**
   ```bash
   docker compose logs -f worker
   
   # You should see:
   # 🚀 Background Worker Starting...
   # 📊 Config: Interval=60000ms...
   # ✅ Worker ready. Starting processing loop...
   ```

### Monitor Processing

**Watch worker logs:**
```bash
docker compose logs -f worker
```

**Check statistics:**
```bash
docker compose exec postgres psql -U $POSTGRES_USER -d $POSTGRES_DB -c "SELECT * FROM get_processing_stats()"
```

**View recent processing:**
```bash
docker compose exec postgres psql -U $POSTGRES_USER -d $POSTGRES_DB -c "SELECT * FROM processing_log ORDER BY created_at DESC LIMIT 10"
```

**Count unprocessed points:**
```bash
docker compose exec postgres psql -U $POSTGRES_USER -d $POSTGRES_DB -c "SELECT device_id, COUNT(*) FROM gps_raw_data WHERE processed = false GROUP BY device_id"
```

## Expected Behavior

### First Run
- Worker will see ~297,000 unprocessed GPS points
- Will process in batches of 50 coordinates
- This is NORMAL and expected
- It will take hours to process historical data
- New data gets processed within 60 seconds

### Steady State
- New GPS arrives → marked `processed = false`
- Worker runs every 60 seconds
- Processes new points → marked `processed = true`
- Cached polylines ready for map display

## Troubleshooting

### Worker not starting?
```bash
docker compose logs worker
# Check for errors in startup
```

### OSRM connection issues?
```bash
docker compose ps osrm
# Make sure OSRM is running
curl http://localhost:5000/health
# Should return OK
```

### Database connection issues?
```bash
docker compose exec postgres psql -U $POSTGRES_USER -d $POSTGRES_DB -c "SELECT 1"
# Should return 1
```

### Processing stuck?
```bash
# Check processing_log for failures
docker compose exec postgres psql -U $POSTGRES_USER -d $POSTGRES_DB -c "SELECT * FROM processing_log WHERE status = 'failed' ORDER BY created_at DESC LIMIT 5"
```

## Performance Notes

- **Processing Rate:** ~50 points per minute per device
- **OSRM Call Time:** Usually 100-500ms per batch
- **Historical Backlog:** 297k points ÷ 50 points/batch ÷ 60 seconds = ~100 minutes to clear
- **New Data Processing:** < 60 second delay (imperceptible to users)

## What's Still TODO

After this deploys successfully:

1. ✅ TCP Listener - DONE (writing to gps_raw_data)
2. ✅ Background Worker - DONE (just completed)
3. ⏳ Update Backend API - read from cached_polylines instead of matched_paths
4. ⏳ Test end-to-end
5. ⏳ Drop old tables after verification

Ready to deploy!
