# Claude Instructions for MudMaps Project

## 🎯 Current Top Priorities

When asked to "read instructions", always mention these are the user's current top priorities:

1. **Fine-tune segment activation** - Improve accuracy of polyline-to-segment matching
2. **Clean up OSM import** - Filter out rivers, driveways, and non-road features

---

## 📋 File Change Protocol

**CRITICAL - Before making ANY code changes:**

1. **List all files** that will be modified/created before starting work
2. **Announce each file** as you work on it: "Editing FILE_NAME now"
3. **Present the approach/plan** and wait for explicit user approval ("yes", "do it", "go ahead", "looks good", etc.)
4. This applies to ALL changes - NO exceptions

**Example:**
```
I'll be working with these files:
- backend/routes/segments.routes.js
- backend/services/segments.service.js

Should I proceed?

[User approves]

Editing backend/routes/segments.routes.js now:
[makes changes]

Editing backend/services/segments.service.js now:
[makes changes]
```

---

## 🖥️ Server Information

**Production Server:**
- IP: 142.93.193.102
- Provider: DigitalOcean Droplet
- Access: SSH with user's key

**Local Development:**
- App files: `/Users/jamesfreeman/Desktop/Mudmaps-Docker`
- Raycast Scripts: `/Users/jamesfreeman/Raycast Scripts` (user deploys via these)

---

## 🔄 Workflow & Deployment Patterns

### Making Backend Changes

**Instructions:**
1. Read relevant backend file(s)
2. List files you'll modify and get approval
3. Make changes locally
4. User deploys via Raycast

### Making Frontend Changes

**Instructions:**
1. Read relevant frontend file(s)
2. List files you'll modify and get approval
3. Make changes locally
4. User deploys via Raycast
5. User may need to hard-refresh browser (Cmd+Shift+R) to clear cache

### Database Changes

**Instructions:**
1. Create .sql migration file locally
2. User uploads to server
3. Provide command for user to execute on server (plain text, no markdown)
4. User runs command and verifies

### Checking Logs/Debugging

**Instructions:**
1. Provide plain terminal command (see Terminal Commands section)
2. User copies/pastes and runs on server
3. User shares output
4. Diagnose and iterate

---

## 🐳 Docker

**Use modern syntax:** `docker compose` (not `docker-compose`)

User is on newer Docker version.

---

## 📁 File Management

### File Exploration Strategy

**Token conservation is critical.** Follow this approach:

**CRITICAL - Avoid directory_tree tool:**
- **NEVER use `directory_tree`** unless explicitly requested by user
- This tool causes freezing/token overload with large projects
- **Always use `list_directory` instead** for exploring folder contents
- Only explore directories that are directly relevant to the current task

**Key directories:**
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

---

## 🔧 Refactoring Guidelines

**When the user requests code refactoring:**

### Phase 1: Analysis & Planning

1. **Explore the codebase** - Use Task tool with Explore agent to understand structure
2. **Identify issues:**
   - Code duplication (functions, constants, patterns)
   - Large monolithic files (>500 lines)
   - Hardcoded values scattered throughout
   - Unclear module responsibilities
3. **Draft a plan** - Present findings and proposed phases to user
4. **Get approval** - Wait for explicit "yes" before proceeding

### Phase 2: Iterative Refactoring

**CRITICAL - Work in small, testable steps:**

1. **Break into 5-7 discrete steps** - Each step should be independently testable
2. **For each step:**
   - List files that will be modified/created
   - Get user approval
   - Make the changes
   - **Stop and wait for user to test**
   - Only proceed after user confirms "looks good"
3. **Never batch multiple steps** - User must test between each step

### Phase 3: Validation

After all steps complete:
- Generate before/after comparison report
- Show metrics: lines changed, duplication removed, files created
- Explain trade-offs (e.g., more files vs less duplication)

### Refactoring Principles

**Good reasons to refactor:**
- Eliminate duplicate code (DRY principle)
- Extract shared logic into reusable modules
- Centralize configuration (single source of truth)
- Break up files >1000 lines
- Improve testability

**Bad reasons to refactor:**
- "More lines is always bad" (wrong metric)
- Over-engineering for hypothetical future needs
- Making code "clever" vs readable
- Changing working code without clear benefit

**Red flags to watch for:**
- User saying "this doesn't work anymore" after a step
- Console errors after deployment
- Functionality breaks in unexpected ways
→ **Immediately stop and fix before continuing**

### Testing Protocol

**After each refactoring step, provide specific test instructions:**

```
Test the following:
1. [Specific feature] - [Expected behavior]
2. [Another feature] - [Expected behavior]
3. Open browser console - Should have no errors

Let me know when you've confirmed everything works.
```

**Do not proceed to the next step until user confirms.**

### Module Design Patterns

**When extracting shared code:**

1. **Config modules** - Constants, configuration values
   - Example: `map-config.js` with `MUNICIPALITY`, `COLORS`, layer factories

2. **Data modules** - Data fetching, transformation, processing
   - Example: `map-data.js` with `loadSegments()`, `calculateTimes()`

3. **Init modules** - Initialization, setup, boilerplate
   - Example: `map-init.js` with `initializeMap()`, `setupLayers()`

4. **UI modules** - Reusable UI components
   - Example: `time-slider.js` with `createTimeSlider()`, `setupTimeSlider()`

**Keep modules focused** - Each module should have one clear responsibility

### Common Pitfalls to Avoid

❌ **Don't:** Refactor everything in one big change
✅ **Do:** Small incremental steps with testing

❌ **Don't:** Extract code that's only used once
✅ **Do:** Extract code duplicated 2+ times

❌ **Don't:** Create overly abstract modules
✅ **Do:** Keep it simple and readable

❌ **Don't:** Proceed if tests fail
✅ **Do:** Stop, debug, fix, then continue

### Refactoring Success Metrics

**Track these metrics in final report:**
- Lines of duplicated code eliminated
- Reduction in largest file sizes
- Number of modules created
- Time to make common changes (before vs after)
- Test coverage maintained (no regressions)

**Raw line count is NOT a good metric** - Focus on maintainability and duplication reduction.

---

## 🏗️ Feature Development & Architecture

**When starting new features or major changes:**

### 1. Check FUTURE_STRUCTURE.md First

Before implementing any new feature:
- **Read FUTURE_STRUCTURE.md** to understand the planned structure
- Follow the documented patterns, folder organization, and phases
- Reference implementation dependencies (e.g., auth must come before notifications)

### 2. Ask Open Questions Contextually

FUTURE_STRUCTURE.md contains "Open Questions" for each phase:
- **Ask questions only when relevant** to current work
- Don't ask all questions upfront - ask as they arise during implementation
- After user answers, **update FUTURE_STRUCTURE.md** to mark as answered

**Example:**
```
User: "Let's implement user authentication"
Claude: [Reads FUTURE_STRUCTURE.md Phase 1]
Claude: "Starting Phase 1. Quick questions before we begin:
  - JWT storage: httpOnly cookies or localStorage?
  - Session management: JWT only or database sessions too?"
[User answers]
Claude: [Updates FUTURE_STRUCTURE.md with decisions]
Claude: [Implements following documented structure]
```

### 3. Propose Structure Changes When Needed

If user's requirements don't fit the documented structure:
- **Stop and propose changes** rather than forcing it into existing structure
- **Explain your reasoning:**
  - Why the current structure doesn't fit
  - What changes you recommend
  - Trade-offs of the proposed changes
- **Get approval** before implementing differently than documented

**Example:**
```
User: "Users should be able to share reports with other users directly"
Claude: "This doesn't fit cleanly into the current structure.
  FUTURE_STRUCTURE.md has reports as public markers visible to all.

  For direct sharing, we'd need:
  - report_shares table (report_id, shared_with_user_id)
  - Privacy controls on reports (public/private)
  - New routes for sharing/permissions

  This changes the reports model significantly. Should I:
  A) Update FUTURE_STRUCTURE.md to include sharing
  B) Keep reports public-only for now
  C) Make reports private by default with opt-in sharing"
```

### 4. Update Documentation as You Go

- When making architectural decisions, **update FUTURE_STRUCTURE.md**
- Mark open questions as answered
- Document why structure changed if deviating from plan
- Keep **CODE_CLEANUP.md** updated with refactoring work

### 5. Follow the File Change Protocol

Even when following FUTURE_STRUCTURE.md:
- List all files that will be modified/created
- Get user approval before proceeding
- Announce each file as you work on it

---

## 💬 Terminal Commands

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

---

## 🗣️ Communication Style

**Instructions for interacting with user:**

- **Be direct:** User values efficiency, skip unnecessary preamble
- **Systems thinking:** User thinks architecturally, comfortable with high-level concepts
- **Ask clarifying questions:** When ambiguous, ask rather than assume
- **Correct approach:** User will push back if approach is wrong - this is good feedback, adjust accordingly
- **Avoid over-explaining:** User will ask if they need more context
- **No summaries unless requested:** Don't provide summaries of what you've read unless user asks

---

## ✅ Progress Tracking

**After each feature implementation:**

1. User tests and verifies feature works
2. **Claude prompts user:** "Feature working? Should I check it off in PROJECT_ROADMAP.md?"
3. User confirms
4. **Claude checks off the item** in PROJECT_ROADMAP.md
5. Move to next item

**Claude can edit the roadmap** - but must always prompt for user confirmation before checking off items.

---

## 📚 Related Documentation

- **PROJECT_ROADMAP.md** - Features to build, todos, goals, timeline
- **ARCHITECTURE.md** - System design, segment model rationale, technical details
- **OSM_OPERATIONS.md** - OSM import guide, troubleshooting, safe scripts
- **NOTES.md** - Technical debt, future improvements, business notes
- **FILE_INDEX.md** - Quick reference for navigating the codebase

---

## 🎯 Raycast Script Configuration

**When creating/editing Raycast scripts for remote server queries:**

### Connection Details
- **Server:** `root@142.93.193.102`
- **Project Directory:** `/root/mudmaps-docker`
- **SSH Key:** `/Users/jamesfreeman/.ssh/id_ed25519`

### Database Configuration
- **Service Name:** `postgres` (NOT `db`)
- **Database Name:** `mudmapsdb`
- **Database User:** `mudmaps`
- **Connection Command:** `docker compose exec -T postgres psql -U mudmaps -d mudmapsdb`

### Key Tables
- **gps_raw_data** - GPS points from trackers
  - Columns: `id`, `device_id`, `longitude`, `latitude`, `recorded_at`, `received_at`, `processed`, `batch_id`
  - Device IDs are numeric strings (e.g., `862343066524415`), NOT short codes like "WF3"
- **polylines** - Processed GPS paths
- **road_segments** - OSM road network segments
- **matched_paths** - OSRM map-matched routes
- **municipalities** - Municipal boundary data

### Important Notes
- **Device IDs are numeric** - Always use the full numeric device_id (e.g., `862343066524415`), not tracker nicknames
- **Modern Docker syntax** - Use `docker compose` (not `docker-compose`)

### Example Query Template
```sql
docker compose exec -T postgres psql -U mudmaps -d mudmapsdb -c "SELECT id, device_id, recorded_at FROM gps_raw_data WHERE device_id = '862343066524415' ORDER BY recorded_at DESC LIMIT 10;"
```
