# Code Changes After Database Migration

**After running the database migration, these code changes are required.**

---

## 🎯 Strategy: Backward-Compatible Transition

We'll use a **dual-mode** approach:
1. Keep old endpoints working (reads from new tables)
2. Add new optimized endpoints alongside
3. Gradually migrate frontend to new endpoints
4. Remove old endpoints later

This ensures **zero downtime** and **easy rollback**.

---

## 1️⃣ TCP Listener Changes (REQUIRED IMMEDIATELY)

**File:** `tcp-listener/tcp-listener.js`

### Current Code:
```javascript
// Around line 50-60 (in the TCP message handler)
await pool.query(
    'INSERT INTO markers (username, coords, created_at) VALUES ($1, $2, NOW())',
    [username, [lon, lat]]
);
```

### New Code:
```javascript
// Extract timestamp from message or use current time
const timestamp = message.timestamp || new Date();

await pool.query(`
    INSERT INTO gps_raw_data (
        device_id, 
        longitude, 
        latitude, 
        recorded_at,
        received_at,
        processed
    ) VALUES ($1, $2, $3, $4, NOW(), FALSE)
`, [
    username,      // device_id
    longitude,     // longitude
    latitude,      // latitude
    timestamp      // recorded_at
]);
```

### Full Example:
```javascript
// tcp-listener/tcp-listener.js
const net = require('net');
const { Pool } = require('pg');

const pool = new Pool({
    host: process.env.PGHOST,
    port: process.env.PGPORT,
    database: process.env.PGDATABASE,
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD
});

const server = net.createServer((socket) => {
    console.log('📱 Device connected');
    
    socket.on('data', async (data) => {
        try {
            const message = JSON.parse(data.toString());
            const { username, longitude, latitude, timestamp } = message;
            
            // Validate data
            if (!username || longitude === undefined || latitude === undefined) {
                console.error('❌ Invalid GPS data:', message);
                return;
            }
            
            // Insert into new table
            await pool.query(`
                INSERT INTO gps_raw_data (
                    device_id,
                    longitude,
                    latitude,
                    recorded_at,
                    processed
                ) VALUES ($1, $2, $3, $4, FALSE)
            `, [
                username,
                longitude,
                latitude,
                timestamp || new Date()
            ]);
            
            console.log(`✅ GPS saved: ${username} at [${longitude}, ${latitude}]`);
            
        } catch (error) {
            console.error('❌ Error processing GPS data:', error);
        }
    });
    
    socket.on('end', () => {
        console.log('📱 Device disconnected');
    });
});

server.listen(process.env.LISTENER_PORT || 5500, () => {
    console.log('🎧 TCP Listener started on port', process.env.LISTENER_PORT || 5500);
});
```

---

## 2️⃣ Backend API Changes (DUAL MODE)

**File:** `backend/server.js`

### Strategy:
- Update existing endpoints to read from new tables (backward compatible)
- Add new optimized `/paths/cached` endpoint
- Keep response format the same initially

---

### A. Update `/markers` endpoint

```javascript
// OLD VERSION (DELETE THIS)
app.get('/markers', async (_req, res) => {
    try {
        const { rows } = await pool.query('SELECT username, coords FROM markers');
        res.json(rows);
    } catch (e) {
        console.error('GET /markers error:', e);
        res.status(500).json({ error: 'db_error' });
    }
});

// NEW VERSION (REPLACE WITH THIS)
app.get('/markers', async (_req, res) => {
    try {
        const { rows } = await pool.query(`
            SELECT 
                device_id as username,
                ARRAY[longitude, latitude] as coords,
                recorded_at as created_at
            FROM gps_raw_data
            ORDER BY recorded_at DESC
            LIMIT 1000
        `);
        res.json(rows);
    } catch (e) {
        console.error('GET /markers error:', e);
        res.status(500).json({ error: 'db_error' });
    }
});
```

---

### B. Update `/markers/enhanced` endpoint

```javascript
// NEW VERSION
app.get('/markers/enhanced', async (req, res) => {
    try {
        const {
            limit = 1000,
            offset = 0,
            username,
            since,
            hours = 24
        } = req.query;

        let query = `
            SELECT 
                device_id as username,
                ARRAY[longitude, latitude] as coords,
                recorded_at as created_at
            FROM gps_raw_data
        `;
        
        let conditions = [];
        let params = [];
        let paramCount = 0;

        // Add time filter
        const timeFilter = since ? new Date(since) : new Date(Date.now() - hours * 60 * 60 * 1000);
        conditions.push(`recorded_at > $${++paramCount}`);
        params.push(timeFilter);

        if (username) {
            conditions.push(`device_id = $${++paramCount}`);
            params.push(username);
        }

        if (conditions.length > 0) {
            query += ' WHERE ' + conditions.join(' AND ');
        }

        query += ` ORDER BY recorded_at ASC LIMIT $${++paramCount} OFFSET $${++paramCount}`;
        params.push(parseInt(limit), parseInt(offset));

        const { rows } = await pool.query(query, params);

        console.log(`Enhanced markers query returned ${rows.length} rows`);
        res.json(rows);
    } catch (e) {
        console.error('GET /markers/enhanced error:', e);
        res.status(500).json({ error: 'db_error', message: e.message });
    }
});
```

---

### C. Add NEW `/paths/cached` endpoint (FAST!)

```javascript
// NEW ENDPOINT - This is the fast one!
app.get('/paths/cached', async (req, res) => {
    try {
        const { username, hours = 24 } = req.query;

        console.log(`🚀 Fetching cached paths for: ${username || 'all devices'}, timeframe: ${hours}h`);

        let query = `
            SELECT 
                device_id,
                start_time,
                end_time,
                encoded_polyline,
                osrm_confidence,
                point_count,
                created_at
            FROM cached_polylines
            WHERE start_time > $1
        `;
        
        let params = [new Date(Date.now() - hours * 60 * 60 * 1000)];

        if (username) {
            query += ' AND device_id = $2';
            params.push(username);
        }

        query += ' ORDER BY start_time ASC';

        const { rows } = await pool.query(query, params);

        // Update access tracking (optional, for monitoring)
        if (rows.length > 0 && username) {
            await pool.query(`
                UPDATE cached_polylines
                SET last_accessed = NOW(),
                    access_count = access_count + 1
                WHERE device_id = $1
            `, [username]);
        }

        console.log(`✅ Returned ${rows.length} cached path(s)`);
        
        res.json({
            cached: true,
            paths: rows,
            count: rows.length
        });

    } catch (e) {
        console.error('GET /paths/cached error:', e);
        res.status(500).json({ error: 'db_error', message: e.message });
    }
});
```

---

### D. Keep OLD `/paths/encoded` for backward compatibility

**Option 1: Point it to cached data** (recommended)
```javascript
// Keep old endpoint but use cached data
app.get('/paths/encoded', async (req, res) => {
    try {
        // Just redirect to cached endpoint logic
        // This keeps frontend working without changes
        const { username, hours = 24 } = req.query;

        const { rows } = await pool.query(`
            SELECT 
                device_id as device,
                start_time,
                end_time,
                encoded_polyline as encoded_path,
                osrm_confidence,
                point_count as coordinate_count
            FROM cached_polylines
            WHERE device_id = $1
              AND start_time > NOW() - INTERVAL '${parseInt(hours)} hours'
            ORDER BY start_time ASC
        `, [username]);

        // Format to match old response structure
        const result = {
            devices: rows.map(row => ({
                device: row.device,
                start_time: row.start_time,
                end_time: row.end_time,
                encoded_path: row.encoded_path,
                osrm_confidence: row.osrm_confidence,
                coordinate_count: row.coordinate_count
            }))
        };

        res.json(result);
    } catch (e) {
        console.error('GET /paths/encoded error:', e);
        res.status(500).json({ error: 'db_error', message: e.message });
    }
});
```

**Option 2: Remove it entirely**
```javascript
// Or just remove the old endpoint and force frontend to use new one
// (only if you're ready to update frontend immediately)
```

---

### E. Add Worker Status Endpoint (NEW)

```javascript
// NEW - Monitor worker progress
app.get('/worker/status', async (req, res) => {
    try {
        const stats = await pool.query('SELECT * FROM get_processing_stats()');
        
        res.json({
            status: 'healthy',
            ...stats.rows[0]
        });
    } catch (error) {
        console.error('Worker status error:', error);
        res.status(500).json({ error: error.message });
    }
});
```

---

## 3️⃣ Frontend Changes (OPTIONAL INITIALLY)

**File:** `frontend/main.js`

### Option A: No Changes Required (Backward Compatible)
If you keep `/paths/encoded` working, frontend needs **zero changes**.

### Option B: Update to Use Cached Endpoint (Better Performance)

```javascript
// OLD CODE (if it looks like this)
async function loadPaths() {
    const response = await fetch('/api/paths/encoded?username=device123&hours=24');
    const data = await response.json();
    // ... render paths
}

// NEW CODE (optional, for better performance)
async function loadPaths() {
    const response = await fetch('/api/paths/cached?username=device123&hours=24');
    const data = await response.json();
    
    // Response format might be slightly different
    data.paths.forEach(path => {
        displayPathOnMap(path.encoded_polyline);
    });
}
```

---

## 📋 Migration Checklist

### Step 1: Database Migration
- [ ] Backup current database
- [ ] Run `002_background_worker_schema.sql`
- [ ] Verify tables created: `gps_raw_data`, `cached_polylines`, `processing_log`
- [ ] Verify data migrated correctly

### Step 2: Update TCP Listener
- [ ] Update `tcp-listener/tcp-listener.js` to write to `gps_raw_data`
- [ ] Test with sample GPS data
- [ ] Verify data appears in `gps_raw_data` table

### Step 3: Update Backend API
- [ ] Update `/markers` endpoint
- [ ] Update `/markers/enhanced` endpoint
- [ ] Add `/paths/cached` endpoint
- [ ] Update or keep `/paths/encoded` (your choice)
- [ ] Add `/worker/status` endpoint
- [ ] Restart backend service
- [ ] Test all endpoints

### Step 4: Test Frontend (No Changes Needed Initially)
- [ ] Open map in browser
- [ ] Verify markers still display
- [ ] Verify paths still load (from old endpoint)
- [ ] Check browser console for errors

### Step 5: Deploy Worker (Next Phase)
- [ ] Build worker service (we'll do this next)
- [ ] Deploy worker
- [ ] Monitor processing

### Step 6: Optimize Frontend (Optional, Later)
- [ ] Update to use `/paths/cached` endpoint
- [ ] Test performance improvements
- [ ] Remove old endpoint usage

---

## 🧪 Testing Commands

```bash
# Test TCP listener accepts data
echo '{"username":"test-device","longitude":-72.5,"latitude":44.2}' | nc localhost 5500

# Check data arrived
psql -c "SELECT * FROM gps_raw_data WHERE device_id='test-device' ORDER BY recorded_at DESC LIMIT 1"

# Test backend endpoints
curl http://localhost:3001/markers | jq
curl http://localhost:3001/paths/cached?username=test-device | jq
curl http://localhost:3001/worker/status | jq
```

---

## 🔄 Rollback Plan

If something goes wrong:

### Quick Rollback (Backend/TCP Listener)
```bash
# Revert to old code using git
git checkout HEAD -- tcp-listener/tcp-listener.js
git checkout HEAD -- backend/server.js

# Restart services
docker-compose restart tcp-listener backend
```

### Full Rollback (Database + Code)
```bash
# Rollback database
psql -f db/migrations/002_background_worker_schema_rollback.sql

# Revert code
git checkout HEAD -- tcp-listener/tcp-listener.js
git checkout HEAD -- backend/server.js

# Restart everything
docker-compose restart
```

---

## ⚠️ Important Notes

1. **TCP Listener is critical** - If this breaks, no new GPS data is saved
2. **Test TCP listener first** - Before testing anything else
3. **Backend changes are backward compatible** - Old frontend keeps working
4. **Frontend changes are optional** - Can wait until worker is running

---

## 🎯 Recommended Order

1. ✅ Run database migration
2. ✅ Update TCP listener (test with sample data)
3. ✅ Update backend API (test endpoints)
4. ⬜ Build worker service (next phase)
5. ⬜ Update frontend (optional optimization)

---

**Ready to start? Should we:**
1. Run the database migration first?
2. Update the TCP listener code together?
3. Review the backend changes in detail?
