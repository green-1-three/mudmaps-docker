#!/bin/bash

# Generic Migration Runner
# Usage: ./run-single-migration.sh <migration_number>
# Example: ./run-single-migration.sh 005

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "🔄 Database Migration Runner"
echo "============================"
echo ""

# Check argument
if [ -z "$1" ]; then
    echo -e "${RED}❌ ERROR: Migration number required${NC}"
    echo "Usage: ./run-single-migration.sh <migration_number>"
    echo "Example: ./run-single-migration.sh 005"
    echo ""
    echo "Available migrations:"
    ls -1 db/migrations/*.sql | sed 's/.*\//  - /'
    exit 1
fi

MIGRATION_NUM="$1"
MIGRATION_FILE="db/migrations/${MIGRATION_NUM}_*.sql"

# Find the migration file
FOUND_FILE=$(ls $MIGRATION_FILE 2>/dev/null | head -1)

if [ -z "$FOUND_FILE" ]; then
    echo -e "${RED}❌ ERROR: Migration ${MIGRATION_NUM} not found${NC}"
    echo ""
    echo "Available migrations:"
    ls -1 db/migrations/*.sql | sed 's/.*\//  - /'
    exit 1
fi

echo -e "${GREEN}✓ Found migration: ${FOUND_FILE}${NC}"
echo ""

# Load environment variables
if [ -f .env ]; then
    export $(cat .env | grep -v '^#' | xargs)
    echo "✓ Loaded environment from .env"
elif [ -f .env.production ]; then
    export $(cat .env.production | grep -v '^#' | xargs)
    echo "✓ Loaded environment from .env.production"
else
    echo -e "${YELLOW}⚠️  No .env file found, using defaults${NC}"
    export POSTGRES_DB=${POSTGRES_DB:-mudmapsdb}
    export POSTGRES_USER=${POSTGRES_USER:-mudmaps}
fi

echo "✓ Database: ${POSTGRES_DB}"
echo "✓ User: ${POSTGRES_USER}"
echo ""

# Verify postgres container is running
if ! docker compose ps postgres | grep -q "Up"; then
    echo -e "${RED}❌ ERROR: Postgres container is not running${NC}"
    echo "Run: docker compose up -d postgres"
    exit 1
fi

echo "✓ Postgres container is running"
echo ""

# Show migration details
echo "📄 Migration Details:"
head -10 "$FOUND_FILE" | grep -E "(Description:|Date:|Author:)" || true
echo ""

# Confirm before running
read -p "Run this migration? (yes/no): " -r
if [[ ! $REPLY =~ ^[Yy]es$ ]]; then
    echo "Migration cancelled."
    exit 0
fi

echo ""
echo "🚀 Executing migration..."
echo ""

# Run the migration
docker compose exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -f "/docker-entrypoint-initdb.d/migrations/$(basename $FOUND_FILE)"

if [ $? -eq 0 ]; then
    echo ""
    echo -e "${GREEN}✅ Migration completed successfully!${NC}"
else
    echo ""
    echo -e "${RED}❌ Migration failed${NC}"
    exit 1
fi

echo ""
echo "🎉 Done!"
