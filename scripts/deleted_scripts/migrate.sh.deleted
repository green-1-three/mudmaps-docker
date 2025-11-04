#!/bin/bash
# ============================================
# FULL MIGRATION EXECUTION SCRIPT
# ============================================
# This script performs the complete migration:
# 1. Database schema changes
# 2. TCP listener code update
# 3. Backend API code update
# 4. Verification tests
# ============================================

set -e  # Exit on any error

echo "🚀 Starting Full Migration - Option B (Replace Entirely)"
echo "========================================================"
echo ""

# ============================================
# CONFIGURATION
# ============================================
PROJECT_DIR="/Users/jamesfreeman/Desktop/Mudmaps-Docker"
MIGRATION_FILE="$PROJECT_DIR/db/migrations/002_background_worker_schema.sql"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# ============================================
# STEP 1: PRE-FLIGHT CHECKS
# ============================================
echo "Step 1: Pre-flight checks..."
echo "----------------------------"

# Check if Docker is running
if ! docker ps >/dev/null 2>&1; then
    echo -e "${RED}❌ Docker is not running${NC}"
    exit 1
fi
echo -e "${GREEN}✓ Docker is running${NC}"

# Check if containers are up
if ! docker ps | grep -q "mudmaps-postgres"; then
    echo -e "${RED}❌ PostgreSQL container is not running${NC}"
    echo "Run: docker-compose up -d postgres"
    exit 1
fi
echo -e "${GREEN}✓ PostgreSQL container is running${NC}"

# Check if migration file exists
if [ ! -f "$MIGRATION_FILE" ]; then
    echo -e "${RED}❌ Migration file not found: $MIGRATION_FILE${NC}"
    exit 1
fi
echo -e "${GREEN}✓ Migration file found${NC}"

echo ""

# ============================================
# STEP 2: BACKUP CURRENT STATE
# ============================================
echo "Step 2: Creating backups..."
echo "----------------------------"

BACKUP_DIR="$PROJECT_DIR/backups/$(date +%Y%m%d_%H%M%S)"
mkdir -p "$BACKUP_DIR"

# Backup current code files
echo "Backing up code files..."
cp "$PROJECT_DIR/tcp-listener/tcp-listener.js" "$BACKUP_DIR/tcp-listener.js.bak"
cp "$PROJECT_DIR/backend/server.js" "$BACKUP_DIR/server.js.bak"
echo -e "${GREEN}✓ Code files backed up to: $BACKUP_DIR${NC}"

# Backup database
echo "Backing up database..."
docker exec mudmaps-postgres pg_dump -U mudmaps mudmapsdb > "$BACKUP_DIR/database_backup.sql"
echo -e "${GREEN}✓ Database backed up${NC}"

echo ""

# ============================================
# STEP 3: RUN DATABASE MIGRATION
# ============================================
echo "Step 3: Running database migration..."
echo "--------------------------------------"
echo -e "${YELLOW}This will:${NC}"
echo "  - Create gps_raw_data table"
echo "  - Create cached_polylines table"
echo "  - Create processing_log table"
echo "  - Migrate data from markers → gps_raw_data"
echo "  - Migrate data from matched_paths → cached_polylines"
echo ""

read -p "Continue with database migration? (yes/no): " -r
if [[ ! $REPLY =~ ^[Yy]es$ ]]; then
    echo "Migration cancelled."
    exit 1
fi

echo "Running migration..."
docker exec -i mudmaps-postgres psql -U mudmaps -d mudmapsdb < "$MIGRATION_FILE"

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✓ Database migration completed successfully${NC}"
else
    echo -e "${RED}❌ Database migration failed${NC}"
    echo "Restore from backup: $BACKUP_DIR/database_backup.sql"
    exit 1
fi

echo ""

# ============================================
# STEP 4: VERIFY MIGRATION
# ============================================
echo "Step 4: Verifying migration..."
echo "-------------------------------"

# Check new tables exist
TABLES=$(docker exec mudmaps-postgres psql -U mudmaps -d mudmapsdb -t -c "\dt" | grep -E "gps_raw_data|cached_polylines|processing_log" | wc -l)
if [ "$TABLES" -eq 3 ]; then
    echo -e "${GREEN}✓ All 3 new tables created${NC}"
else
    echo -e "${RED}❌ Expected 3 tables, found $TABLES${NC}"
    exit 1
fi

# Check data migrated
GPS_COUNT=$(docker exec mudmaps-postgres psql -U mudmaps -d mudmapsdb -t -c "SELECT COUNT(*) FROM gps_raw_data")
MARKERS_COUNT=$(docker exec mudmaps-postgres psql -U mudmaps -d mudmapsdb -t -c "SELECT COUNT(*) FROM markers_backup")

echo "GPS data migrated: $GPS_COUNT rows (from $MARKERS_COUNT markers)"

if [ "$GPS_COUNT" -eq "$MARKERS_COUNT" ]; then
    echo -e "${GREEN}✓ All GPS data migrated successfully${NC}"
else
    echo -e "${RED}❌ Data migration mismatch${NC}"
    exit 1
fi

echo ""

# ============================================
# STEP 5: UPDATE TCP LISTENER
# ============================================
echo "Step 5: Updating TCP listener code..."
echo "--------------------------------------"

cat > "$PROJECT_DIR/tcp-listener/tcp-listener.js" << 'EOF'
const net = require('net');
const { Pool } = require('pg');

const pool = new Pool({
    host: process.env.PGHOST || 'postgres',
    port: Number(process.env.PGPORT || 5432),
    database: process.env.PGDATABASE,
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD,
    max: 10
});

const LISTENER_PORT = process.env.LISTENER_PORT || 5500;

const server = net.createServer((socket) => {
    console.log('📱 Device connected:', socket.remoteAddress);
    
    let buffer = '';
    
    socket.on('data', async (data) => {
        buffer += data.toString();
        
        // Process complete messages (newline-delimited)
        const messages = buffer.split('\n');
        buffer = messages.pop(); // Keep incomplete message in buffer
        
        for (const messageStr of messages) {
            if (!messageStr.trim()) continue;
            
            try {
                const message = JSON.parse(messageStr);
                const { username, longitude, latitude, timestamp, altitude, accuracy, speed, bearing } = message;
                
                // Validate required fields
                if (!username || longitude === undefined || latitude === undefined) {
                    console.error('❌ Invalid GPS data (missing required fields):', message);
                    socket.write(JSON.stringify({ error: 'Missing required fields: username, longitude, latitude' }) + '\n');
                    continue;
                }
                
                // Validate coordinate ranges
                if (longitude < -180 || longitude > 180 || latitude < -90 || latitude > 90) {
                    console.error('❌ Invalid coordinates:', { longitude, latitude });
                    socket.write(JSON.stringify({ error: 'Invalid coordinates' }) + '\n');
                    continue;
                }
                
                // Insert into new gps_raw_data table
                await pool.query(`
                    INSERT INTO gps_raw_data (
                        device_id,
                        longitude,
                        latitude,
                        recorded_at,
                        altitude,
                        accuracy,
                        speed,
                        bearing,
                        processed
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, FALSE)
                `, [
                    username,
                    longitude,
                    latitude,
                    timestamp ? new Date(timestamp) : new Date(),
                    altitude || null,
                    accuracy || null,
                    speed || null,
                    bearing || null
                ]);
                
                console.log(`✅ GPS saved: ${username} at [${longitude}, ${latitude}]`);
                socket.write(JSON.stringify({ status: 'ok' }) + '\n');
                
            } catch (error) {
                console.error('❌ Error processing GPS data:', error.message);
                socket.write(JSON.stringify({ error: error.message }) + '\n');
            }
        }
    });
    
    socket.on('end', () => {
        console.log('📱 Device disconnected');
    });
    
    socket.on('error', (error) => {
        console.error('Socket error:', error.message);
    });
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('SIGTERM received, closing server...');
    server.close(() => {
        pool.end(() => {
            console.log('TCP listener shut down gracefully');
            process.exit(0);
        });
    });
});

server.listen(LISTENER_PORT, () => {
    console.log('🎧 TCP Listener started on port', LISTENER_PORT);
    console.log('📍 Writing to: gps_raw_data table');
    console.log('🗄️  Database:', process.env.PGDATABASE);
});
EOF

echo -e "${GREEN}✓ TCP listener code updated${NC}"
echo ""

# ============================================
# STEP 6: UPDATE BACKEND API
# ============================================
echo "Step 6: Updating backend API code..."
echo "-------------------------------------"

# This is complex - let's create it in a separate step
echo -e "${YELLOW}⚠️  Backend update requires manual review${NC}"
echo "The backend changes are extensive. Let's verify TCP listener first."
echo ""

# ============================================
# STEP 7: RESTART SERVICES
# ============================================
echo "Step 7: Restarting services..."
echo "-------------------------------"

echo "Restarting TCP listener..."
docker-compose restart tcp-listener
sleep 2

if docker ps | grep -q "mudmaps-tcp-listener"; then
    echo -e "${GREEN}✓ TCP listener restarted${NC}"
else
    echo -e "${RED}❌ TCP listener failed to start${NC}"
    docker logs mudmaps-tcp-listener --tail 20
    exit 1
fi

echo ""

# ============================================
# STEP 8: TEST TCP LISTENER
# ============================================
echo "Step 8: Testing TCP listener..."
echo "--------------------------------"

# Send test GPS data
echo '{"username":"migration-test","longitude":-72.5,"latitude":44.2,"timestamp":"'$(date -u +%Y-%m-%dT%H:%M:%SZ)'"}' | nc localhost 5500

sleep 1

# Check if data arrived in new table
TEST_COUNT=$(docker exec mudmaps-postgres psql -U mudmaps -d mudmapsdb -t -c "SELECT COUNT(*) FROM gps_raw_data WHERE device_id='migration-test'")

if [ "$TEST_COUNT" -gt 0 ]; then
    echo -e "${GREEN}✓ TCP listener test PASSED - data saved to gps_raw_data${NC}"
else
    echo -e "${RED}❌ TCP listener test FAILED - no data in gps_raw_data${NC}"
    docker logs mudmaps-tcp-listener --tail 20
    exit 1
fi

echo ""

# ============================================
# SUMMARY
# ============================================
echo "========================================================"
echo -e "${GREEN}✅ MIGRATION PHASE 1 COMPLETE${NC}"
echo "========================================================"
echo ""
echo "Completed:"
echo "  ✓ Database schema migrated"
echo "  ✓ TCP listener updated and tested"
echo "  ✓ Backups saved to: $BACKUP_DIR"
echo ""
echo "Next steps:"
echo "  1. Review and update backend API (server.js)"
echo "  2. Build worker service"
echo "  3. Test end-to-end flow"
echo ""
echo "Backup location: $BACKUP_DIR"
echo ""
echo -e "${YELLOW}⚠️  Backend API update is next - shall we continue?${NC}"
