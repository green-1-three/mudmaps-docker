# Redis Queue Architecture - Implementation Complete

**Date:** October 28, 2025  
**Status:** Ready to Deploy

---

## What Changed

Migrated from **polling-based workers** to **Redis queue-based workers**.

### Old Architecture:
```
Workers poll DB every N seconds → Check for unprocessed GPS → Process
Problem: Wasted cycles, hard to scale
```

### New Architecture:
```
GPS arrives → TCP Listener inserts to DB + publishes to Redis queue
Workers listen to queue → Process only when work available → Instant response
Benefits: Event-driven, infinite scaling, no wasted cycles
```

---

## Files Modified

1. **docker-compose.yml** - Added Redis service, updated all workers
2. **tcp-listener/package.json** - Added redis dependency
3. **tcp-listener/tcp-listener.js** - Publishes device_id to queue after GPS insert
4. **worker/package.json** - Added redis dependency  
5. **worker/worker.js** - Changed from polling to queue listening

---

## How It Works Now

### TCP Listener (Producer):
```javascript
1. GPS arrives from device
2. INSERT into gps_raw_data table
3. LPUSH device_id to Redis queue 'gps:queue'
```

### Workers (Consumers):
```javascript
1. BRPOP from Redis queue 'gps:queue' (blocking wait)
2. When device_id arrives, process that device
3. Return to step 1
```

### Benefits:
- **Event-driven:** Workers only run when there's work
- **Instant:** No polling delay, processes within milliseconds
- **Scalable:** Add 100 workers, they all pull from same queue
- **Efficient:** Zero wasted CPU cycles
- **Fair:** First device in queue gets processed first

---

## Scaling Capacity

**With 10 workers:**
- Each worker processes jobs instantly as they arrive
- Queue handles 1000s of jobs per second
- Limited only by OSRM speed (~20-50ms per batch)
- **Theoretical capacity: ~1000+ devices easily**

**To add more workers:**
Just copy-paste another worker service in docker-compose.yml. That's it.

---

## Redis Configuration

**Service:** redis:7-alpine  
**Memory limit:** 256MB  
**Eviction policy:** allkeys-lru (removes oldest if full)  
**Queue name:** `gps:queue`  
**Port:** 6379

---

## Monitoring

### Check queue depth:
```bash
docker compose exec redis redis-cli LLEN gps:queue
```

### Check worker logs:
```bash
docker compose logs -f worker
docker compose logs -f worker-2
# etc...
```

### Check processing stats:
```bash
docker compose exec -T postgres psql -U mudmaps -d mudmapsdb -c "SELECT * FROM get_processing_stats()"
```

---

## Deployment

**Ready to deploy:**
```bash
# Run Raycast "Full Deploy"
```

**What will happen:**
1. Redis container starts
2. TCP listener connects to Redis
3. All 10 workers connect to Redis and wait for jobs
4. When GPS arrives, workers process instantly

**Note:** Since we're switching architectures, the existing backlog won't be automatically queued. The workers will sit idle until new GPS data arrives. If you want to process the remaining backlog, you can manually queue it (optional).

---

## Manual Backlog Queueing (Optional)

If you want workers to process existing unprocessed GPS:

```bash
# SSH to server
docker compose exec -T postgres psql -U mudmaps -d mudmapsdb -c "
  SELECT DISTINCT device_id 
  FROM gps_raw_data 
  WHERE processed = FALSE
" | while read device_id; do
  docker compose exec redis redis-cli LPUSH gps:queue "$device_id"
done
```

This manually adds all devices with unprocessed data to the queue.

---

## Key Advantages Over Polling

| Feature | Polling (Old) | Queue (New) |
|---------|--------------|-------------|
| Response time | 5-60 seconds | Instant (<1s) |
| CPU usage | Constant | Only when working |
| Scalability | Hard (need intervals) | Easy (just add workers) |
| Max workers | ~20 practical | Unlimited |
| Wasted cycles | Many | Zero |
| Backpressure | No | Yes (queue depth) |

---

## Next Steps

1. ✅ Redis implementation complete
2. ⏳ Deploy and test
3. ⏳ Update backend API (read from cached_polylines)
4. ⏳ Final end-to-end testing

Ready to deploy!
