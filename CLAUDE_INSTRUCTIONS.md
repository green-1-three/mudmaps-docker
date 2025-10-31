# Claude Instructions for MudMaps Project

## 🎯 Current Top Priorities

When asked to "read instructions", always mention these are the user's current top priorities:

1. **Code refactoring for AI-assisted development** - Split monolithic files into smaller modules
2. **Fine-tune segment activation** - Improve accuracy of polyline-to-segment matching
3. **Clean up OSM import** - Filter out rivers, driveways, and non-road features

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
5. User tests on production server

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

### File Index Maintenance

**ALWAYS update FILE_INDEX.md when:**
- Creating new files (especially key files like routes, services, controllers)
- Moving files to different directories
- Creating new directories
- Archiving/deleting files (moving to old_files)

**Keep it high-level** - Only add entries for files that are important for navigation, not every single file.

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
