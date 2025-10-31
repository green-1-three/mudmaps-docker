# MudMaps File Index

Quick reference for file locations and purposes. Keep this high-level for token efficiency.

## Root Directory

### Documentation
- `CLAUDE_INSTRUCTIONS.md` - Instructions for Claude on how to work with this codebase
- `PROJECT_ROADMAP.md` - Project roadmap, features, todos, and timeline
- `ARCHITECTURE.md` - System design and technical details
- `OSM_OPERATIONS.md` - OSM import guide and troubleshooting
- `NOTES.md` - Technical debt and business notes
- `FILE_INDEX.md` - This file - quick reference for navigating the codebase
- `.claudeignore` - Files/directories Claude should ignore to conserve tokens

### Configuration
- `docker-compose.yml` - Docker orchestration config
- `.env.production` - Production environment variables
- `.env.example` - Template for environment variables
- `nginx.conf` - Root nginx configuration
- `setup-osrm.sh` - OSRM routing server setup
- `migrate.sh` - Database migration runner
- `run-migration.sh` - Migration execution helper

### Package Files
- `package.json` / `package-lock.json` - Root-level Node.js dependencies

---

## /backend - Express API Server

Main API server that serves polylines, segments, and municipality data to frontend.

### Key Files
- `index.js` - Server entry point
- `app.js` - Express app setup and middleware
- `package.json` - Backend dependencies

### Routes (`/routes`)
- `database.routes.js` - Database inspection endpoints
- `health.routes.js` - Health check endpoints
- `polylines.routes.js` - Polyline data endpoints
- `segments.routes.js` - Segment data endpoints

### Services (`/services`)
- `database.service.js` - Database connection and query utilities
- `database-inspection.service.js` - Database inspection and debugging queries
- `polylines.service.js` - Polyline data retrieval logic
- `segments.service.js` - Segment data retrieval logic

### Middleware (`/middleware`)
- `error-handler.js` - Centralized error handling

### Config (`/config`)
- `config.js` - Backend configuration settings

### Other
- `/old_files` - Archived/deprecated code

---

## /frontend - OpenLayers Map Interface

Public-facing map showing plowed streets with time-based coloring.

### Key Files
- `index.html` - Main HTML entry point
- `main.js` - Map initialization and interaction logic
- `style.css` - UI styling
- `vite.config.js` - Vite build configuration
- `nginx.conf` - Frontend nginx configuration

### Configuration
- `.env.development` - Development environment variables
- `.env.production` - Production environment variables

---

## /worker - Background Processing

Processes GPS batches, performs map-matching via OSRM, activates segments.

### Key Files
- `index.js` - Worker entry point
- `package.json` - Worker dependencies

### Services (`/services`)
- `batch-processor.js` - Main batch processing orchestration
- `database.service.js` - Database connection and query utilities
- `gps-processor.js` - GPS point processing and validation
- `osrm.service.js` - OSRM map-matching integration
- `segment-activation.service.js` - Segment activation logic

### Utils (`/utils`)
- `geo-calculations.js` - Geographic calculation utilities

### Config (`/config`)
- `config.js` - Worker configuration settings

---

## /tcp-listener - GPS Data Ingestion

TCP server that receives GPS data from trackers every 30 seconds.

### Key Files
- `tcp-listener.js` - TCP server that receives and stores GPS points
- `package.json` - TCP listener dependencies

---

## /db - Database

PostgreSQL schemas, migrations, and database-related scripts.

### Structure
- `init.sql` - Initial database schema
- `/migrations` - SQL migration files
- `/scripts` - Database maintenance and utility scripts

---

## /scripts - Maintenance & Utilities

One-off scripts for debugging, fixing data issues, and system maintenance.

### Current Scripts
- `check-pomfret-status.sh` - Status check script
- `fix-pomfret-osm.js` - OSM data fix script
- `reset-gps-processing.sh` - Reset GPS processing state
- `/deleted_scripts` - Archived old scripts

---

## /proxy - Nginx Reverse Proxy

Reverse proxy configuration for routing traffic between services.

### Key Files
- `reverse-proxy.conf` - Nginx reverse proxy rules

---

## Other Directories

- `/compose_backups` - Docker compose backup configurations
- `/old_markdown_files` - Archived documentation
- `/.git` - Git version control
- `/.idea` - IDE configuration files
- `/node_modules` - Node.js dependencies (various levels)
