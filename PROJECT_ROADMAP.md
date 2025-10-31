# MudMaps Project Roadmap

## Project Overview

MudMaps is a real-time GPS tracking system designed for municipalities to track snowplows and road maintenance vehicles. The system allows residents to see when their streets have been plowed, with the goal of reducing calls to town offices and providing transparency around municipal services.

**Target Market:** Municipal governments (B2G)
**Current Status:** Core GPS tracking infrastructure is complete and working in production
**Business Model:** Per-municipality licensing (details TBD)

**Architecture Overview:**
- **GPS Trackers:** Report every 30 seconds via TCP
- **TCP Listener:** Receives GPS data, stores in PostgreSQL, queues batches to Redis after 25 points (~12.5 minutes)
- **Background Workers:** Process GPS batches through OSRM for map-matching, cache polylines in database
- **Backend API:** Serves pre-computed polylines instantly from cached_polylines table
- **Frontend:** OpenLayers-based map displaying historical paths and real-time vehicle positions

---

## 🧹 CLEANUP & REFACTORING TO-DO

### Code Organization
- [ ] Consolidate duplicate database connection code across scripts
- [ ] Move shared PostGIS functions to a utilities module
- [ ] Standardize error handling across import scripts
- [ ] Remove hardcoded credentials from scripts (use .env consistently)

### Refactor for AI-Assisted Development
- [ ] **Split monolithic files** - Break up large files (server.js, worker/index.js) into smaller, focused modules
- [ ] **Separate routes from logic** - Extract route handlers into separate controller files
- [ ] **Create service layer** - Move database queries and business logic to service modules
- [ ] **Maximum file size ~200-300 lines** - Keeps context manageable for AI assistance
- [ ] **Clear file naming** - Each file should have one clear purpose (e.g., `segment-activation.js`, not `utils.js`)

**Target structure:**
```
/backend
  /routes
    - segments.routes.js
    - polylines.routes.js
    - municipalities.routes.js
  /controllers
    - segments.controller.js
    - polylines.controller.js
  /services
    - database.service.js
    - postgis.service.js
    - segment-activation.service.js
  /queries
    - segments.queries.js
    - polylines.queries.js
  /middleware
    - error-handler.js
  - app.js (minimal setup only)
```

**Benefits of AI-Optimized Structure:**
- AI reads only relevant files (saves tokens)
- Clearer prompts: "modify segment-activation.service.js" vs "find activation code"
- Parallel development: Multiple files can be worked on simultaneously
- Easier testing and debugging of individual modules
- Reduced chance of AI making unintended changes to unrelated code

### Script Cleanup
- [ ] Remove or archive old test scripts
- [ ] Consolidate similar functionality (multiple boundary fix attempts)
- [ ] Add proper command-line argument parsing to scripts
- [ ] Add --help documentation to all scripts

### Database Cleanup
- [ ] Archive old GPS data (older than X days)
- [ ] Remove orphaned polylines with no GPS points
- [ ] Clean up test data from development
- [ ] Add indexes where needed for performance

### OSM Import Improvements
- [ ] Filter out `highway=service` with `access=private`
- [ ] Exclude waterways incorrectly tagged as roads
- [ ] Exclude unnamed roads under certain length (driveways)
- [ ] Add validation to check for suspicious features (e.g., segments in water bodies)

### Documentation
- [ ] Create README for scripts directory explaining each script
- [ ] Document environment variables needed
- [ ] Create troubleshooting guide for common issues
- [ ] Add inline comments to complex PostGIS queries

### Frontend Cleanup
- [ ] Remove unused polyline rendering code once segments fully tested
- [ ] Optimize segment loading for better performance
- [ ] Clean up console.log statements
- [ ] Refactor duplicate color gradient logic

### Docker & Infrastructure
- [ ] Optimize Docker image sizes
- [ ] Remove unnecessary packages from containers
- [ ] Set up proper log rotation
- [ ] Configure automatic database backups

---

## 🎯 IMMEDIATE GOALS: Public-Facing Map

### Phase 1: Data Foundation ✅ COMPLETE
- [x] **Preload week's data** - Modify backend endpoint to return all polylines from last 7 days at once
- [x] **Time-based filtering logic** - Implement client-side show/hide based on time range
- [x] **Smooth gradient coloring** - Interpolated gradient: 0min=green → 6hrs=yellow → 12hrs=orange → 24hrs=gray

### Phase 2: Core Interactions
- [x] **Time slider with scale toggle** - Switch between "0-24 hours" and "0-7 days" modes
- [x] **Address search** - Search box to find and zoom to addresses/streets
- [ ] **Town boundaries with gray overlay** - Display all towns on single map. Participating towns show full-color data with clear boundaries. Non-participating towns show gray overlay with "Not available in [Town Name]" message.
- [ ] **Hover for timestamp (desktop)** - Tooltip on hover showing "Last plowed at [timestamp]"
- [x] **Direction arrows on polylines** - Show which direction the plow traveled

### Phase 3: Live Features
- [ ] **Real-time vehicle positions** - Show current location of each active vehicle as distinct marker
- [ ] **Pulse active polylines** - Polylines within last 10 minutes get pulsing/animated effect
- [ ] **WebSockets/SSE for live updates** - Map updates automatically without page refresh

### Phase 4: Polish & Utility
- [ ] **Polyline deduplication** - Backend optimization to reduce overlapping polylines
- [ ] **Simplify map appearance** - Switch to lighter tile provider (CartoDB Positron, Mapbox Light) so polylines stand out
- [ ] **Clean UI pass** - Polish for non-technical users, clear labels, professional appearance

### Phase 5: Later Features (Post-MVP)
- [ ] **Report button for road conditions** - Residents can report issues (requires auth system)
- [ ] **Mobile optimization** - Touch interactions, responsive layout, cellular performance

---

## 🚀 LONGER-TERM GOALS: Full Product

### Municipality Admin Panel
**Purpose:** Dashboard for town DPW directors and supervisors

**Features needed:**
- [ ] View all municipality vehicles on map in real-time
- [ ] Assign/rename vehicles ("Plow 3", "East Grader", "Sander 2")
- [ ] Set vehicle types (plow, grader, sander, other)
- [ ] View coverage statistics ("83% of streets plowed in last 6 hours")
- [ ] Historical playback - replay any past storm to see routes taken
- [ ] Export reports for town meetings/budget justification
- [ ] Manage coverage areas/zones for each vehicle
- [ ] Multi-user access with role-based permissions

### Text Alert System
**Purpose:** Notify residents when their street has been plowed

**Features needed:**
- [ ] Resident signup: phone number + address/area
- [ ] SMS notification when plow enters their street/zone
- [ ] Geofencing logic to detect when vehicle enters resident's area
- [ ] Rate limiting to avoid spam
- [ ] Opt-in/opt-out management
- [ ] Integration with Twilio or similar SMS service
- [ ] Determine cost structure (municipality pays vs resident pays)

### Super-Admin System (Your Interface)
**Purpose:** System for onboarding municipalities and monitoring health

**Features needed:**
- [ ] Onboard new municipalities (create account, define coverage area, set up branding)
- [ ] Provision GPS trackers and assign to specific vehicles
- [ ] System monitoring dashboard (tracker status, error alerts, processing backlog)
- [ ] Support tools (view any municipality's data for debugging)
- [ ] Billing management (track usage, generate invoices)
- [ ] Analytics across all municipalities (system health, usage patterns)

### Infrastructure & Reliability
**Critical considerations:**
- [ ] **Signal loss handling:** Queue points, process when signal returns
- [ ] **Server downtime:** Monitoring, alerts, automatic restart, failover strategy
- [ ] **Monitoring/alerting:** System health dashboard, alerts when things break
- [ ] **Backup/disaster recovery:** Database backups, recovery procedures
- [ ] **Scaling:** Support 50+ towns with multiple vehicles each
- [ ] **Performance:** Ensure fast map loads with weeks of data across municipalities
- [ ] **Security:** Authentication, authorization, data privacy, secure API endpoints

---

## ✅ SUCCESS CRITERIA (Pre-Launch)

Before approaching municipalities for sales, the system should:

1. **Work reliably** - 99%+ uptime, handles signal loss gracefully, no data loss
2. **Look professional** - Clean UI suitable for embedding on town websites
3. **Provide core value** - Residents can easily see if their street was plowed and when
4. **Be demonstrable** - Can show working system with real GPS data in real-time
5. **Scale adequately** - Can handle at least 10 towns simultaneously without performance degradation
6. **Support basic admin** - Municipalities can manage their own vehicles and view their coverage

**Timeline goal:** Ready for winter 2025-26 season (sales should begin summer/fall 2025)
