#!/bin/bash

# Migration Runner Script
# Run this on the DigitalOcean droplet after deploying

set -e

echo "🔄 Running Database Migration"
echo "=============================="
echo ""

# Load environment variables
if [ -f .env.production ]; then
    export $(cat .env.production | grep -v '^#' | xargs)
    echo "✅ Loaded environment variables from .env.production"
else
    echo "❌ ERROR: .env.production not found"
    exit 1
fi

# Verify postgres container is running
if ! docker compose ps postgres | grep -q "Up"; then
    echo "❌ ERROR: Postgres container is not running"
    echo "Run: docker compose up -d postgres"
    exit 1
fi

echo "✅ Postgres container is running"
echo ""

# Run the migration
echo "🚀 Executing migration: 002_background_worker_schema.sql"
echo ""

docker compose exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -f /docker-entrypoint-initdb.d/migrations/002_background_worker_schema.sql

echo ""
echo "✅ Migration completed!"
echo ""
echo "📊 Checking new schema..."
docker compose exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "\dt" | grep -E "(gps_raw_data|cached_polylines|processing_log)"

echo ""
echo "🎉 Done! New tables created:"
echo "  - gps_raw_data"
echo "  - cached_polylines" 
echo "  - processing_log"
