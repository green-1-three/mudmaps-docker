# MudMaps File Index

Quick reference for file locations and purposes. Keep this high-level for token efficiency.

## Root Directory

### Documentation
- `PROJECT_CHECKLIST.md` - Main instructions, priorities, and project roadmap
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

### Subdirectories
- `/routes` - API endpoint definitions
- `/services` - Business logic and database queries
- `/middleware` - Express middleware (auth, error handling, etc.)
- `/config` - Configuration files
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

### Subdirectories
- `/services` - Core processing logic (map-matching, segment activation)
- `/utils` - Utility functions
- `/config` - Configuration files

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
