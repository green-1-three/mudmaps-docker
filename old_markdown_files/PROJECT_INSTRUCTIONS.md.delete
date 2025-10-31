# MudMaps Project Checklist

## 🔴 TOP PRIORITY: Cleanup/Refactoring & Segment Fine-Tuning

**User's explicit top-of-list priorities:**
1. **Code refactoring for AI-assisted development** - Split monolithic files into smaller modules
2. **Fine-tune segment activation** - Improve accuracy of polyline-to-segment matching
3. **Clean up OSM import** - Filter out rivers, driveways, and non-road features

*(Claude: When asked to read instructions, always mention these are the user's top priorities)*

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

---

## 📋 INSTRUCTIONS FOR CLAUDE

### Server Information

**Production Server:**
- IP: 142.93.193.102
- Provider: DigitalOcean Droplet
- Access: SSH with user's key

### Workflow & Environment

**Local vs Remote:**
- App files are on local machine at `/Users/jamesfreeman/Desktop/Mudmaps-Docker`
- Production server is DigitalOcean Droplet at IP: **142.93.193.102** (remote)
- **Prefer local changes:** Make all code changes, create files, edit configurations locally when practical
- **Deployment:** User deploys via Raycast scripts (filesystem access granted to `/Users/jamesfreeman/Raycast Scripts`)
- **Remote terminal:** User can SSH to server and run commands, but prefer scripted approaches
- **Database migrations:** Script the migration locally (create .sql file), user will upload and execute on server

**Docker version:** User is on newer Docker version - use modern `docker compose` syntax (not `docker-compose`)

### File Exploration Strategy

**Token conservation is critical.** Follow this approach:

1. **Initial scan:** Start by viewing first 2-3 directory levels to understand structure
2. **Targeted reading:** Only read files that are directly relevant to current task
3. **Avoid deep dives:** Do NOT recursively explore folders unless specifically needed
4. **Skip obvious non-targets:** node_modules, .git, build artifacts, logs, etc.
5. **Ask first:** If you need to do extensive file exploration, prompt user for permission first

**CRITICAL - Avoid directory_tree tool:**
- **NEVER use `directory_tree`** unless explicitly requested by user
- This tool causes freezing/token overload with large projects
- **Always use `list_directory` instead** for exploring folder contents
- Only explore directories that are directly relevant to the current task

**Key directories to know:**
- `/backend` - Express API server
- `/frontend` - OpenLayers map interface  
- `/worker` - Background processing workers
- `/tcp-listener` - GPS data ingestion
- `/db` or `/postgres` - Database schemas/migrations (if present)

### File Deletion Strategy

**Claude cannot delete files directly.** When user requests file deletion:

1. **Check if `old_files` folder exists** in the same directory as the target file(s)
2. **If it doesn't exist, create it** using `create_directory`
3. **Rename the file** by appending `.delete` to the filename
4. **Move the renamed file** to the `old_files` folder using `move_file`
5. **Update FILE_INDEX.md** to reflect the change
6. Confirm action with user

**Example:** To "delete" `/backend/old-script.js`:
- Create `/backend/old_files/` if needed
- Rename to `old-script.js.delete`
- Move to `/backend/old_files/old-script.js.delete`
- Update FILE_INDEX.md if the file was listed there

### File Index Maintenance

**ALWAYS update FILE_INDEX.md when:**
- Creating new files (especially key files like routes, services, controllers)
- Moving files to different directories
- Creating new directories
- Archiving/deleting files (moving to old_files)

**Keep it high-level** - Only add entries for files that are important for navigation, not every single file.

### Terminal Commands

**Format rules:**
- Provide commands in plain text, ready to copy/paste
- NO markdown code blocks
- NO comments or explanations in the command itself
- NO line continuation characters unless actually needed
- User should be able to copy entire output and paste directly into terminal

**Example - Good:**
```
docker compose logs backend --tail 50
```

**Example - Bad:**
```bash
# Check backend logs
docker compose logs backend --tail 50  # Shows last 50 lines
```

### Progress Tracking

**After each feature implementation:**
1. User tests and verifies feature works
2. **Claude prompts user:** "Feature working? Should I check it off in PROJECT_CHECKLIST.md?"
3. User confirms
4. **Claude checks off the item** in this file
5. Move to next item

**Claude can edit the checklist** - but must always prompt for user confirmation before checking off items.

### Communication Style

- **Be direct:** User values efficiency, skip unnecessary preamble
- **Systems thinking:** User thinks architecturally, comfortable with high-level concepts
- **Ask clarifying questions:** When ambiguous, ask rather than assume
- **Correct approach:** User will push back if approach is wrong - this is good feedback, adjust accordingly
- **Avoid over-explaining:** User will ask if they need more context
- **ALWAYS ask for explicit approval before making ANY code changes:** Before modifying, creating, or editing any files in the codebase, Claude must present the approach/plan and wait for explicit user approval ("yes", "do it", "go ahead", "looks good", etc.). This applies to ALL changes, not just when presenting multiple options. NO exceptions.

### Common Patterns

**Making backend changes:**
1. Read relevant backend file(s)
2. Make changes locally
3. User deploys via Raycast
4. User tests on production server

**Making frontend changes:**
1. Read relevant frontend file(s)  
2. Make changes locally
3. User deploys via Raycast
4. User may need to hard-refresh browser (Cmd+Shift+R) to clear cache

**Database changes:**
1. Create .sql migration file locally
2. User uploads to server
3. Provide command for user to execute on server
4. User runs command and verifies

**Checking logs/debugging:**
1. Provide plain terminal command
2. User copies/pastes and runs on server
3. User shares output
4. Diagnose and iterate

---

## 📚 ADDITIONAL DOCUMENTATION

For more detailed information, see:
- **ARCHITECTURE.md** - System design, segment model rationale, technical details
- **OSM_OPERATIONS.md** - OSM import guide, troubleshooting, safe scripts
- **NOTES.md** - Technical debt, future improvements, business notes
