# Future File Structure

This document outlines the planned file structure for upcoming MudMaps features including authentication, user reports, notifications, real-time updates, and UI improvements.

---

## Overview

### New Features
- **Authentication & Users** - Login system with role-based permissions
- **User Reports** - Click-to-report map markers (ice, potholes, blocked roads, etc.)
- **Notifications** - User notification system (in-app and preferences)
- **Real-time Updates** - WebSocket integration for live segment updates and tracker positions
- **User Preferences** - Per-user map settings, time ranges, notification preferences
- **UI Improvements** - Enhanced path display, segment direction indicators

### User Roles & Permissions
- **Roles:** `admin`, `roadcrew`, `user`
- **Tiers:** `basic`, `premium`
- **Permission examples:**
  - Moderating reports: admin + roadcrew
  - Historical data access: premium tier
  - Segment editing: admin only

---

## Backend Structure

```
/backend
  /middleware
    auth.js                    # JWT validation, token verification
    permissions.js             # Role-based access control (RBAC)
    validation.js              # Input validation (zod/joi)

  /routes
    auth.routes.js             # POST /login, /logout, /register, /refresh
    users.routes.js            # User CRUD, profile, preferences
    reports.routes.js          # User map reports CRUD, moderation
    notifications.routes.js    # User notifications, preferences, mark as read
    segments.routes.js         # (existing) Add auth middleware
    polylines.routes.js        # (existing) Add auth middleware
    database.routes.js         # (existing) Admin-only access

  /services
    auth.service.js            # Password hashing (bcrypt), JWT generation
    users.service.js           # User management, preferences
    reports.service.js         # Report creation, moderation, expiration
    notifications.service.js   # Notification creation, delivery logic
    email.service.js           # Email notifications (optional)
    segments.service.js        # (existing)
    polylines.service.js       # (existing)
    database-inspection.service.js  # (existing)

  /websocket
    socket-server.js           # Socket.io server setup (integrated with Express)
    auth.js                    # WebSocket authentication (verify JWT on connect)
    /handlers
      segments.handler.js      # Broadcast segment updates in real-time
      trackers.handler.js      # Broadcast live plow positions
      reports.handler.js       # Broadcast new/resolved reports
      notifications.handler.js # Push notifications to connected users

  /jobs
    daily-reset.js             # (existing) Plow count reset
    report-expiration.js       # Auto-resolve/archive old reports
    notification-digest.js     # Daily/weekly notification summaries (optional)
```

### Key Backend Decisions
- **WebSocket:** Integrated with Express using Socket.io (same port, simpler deployment)
- **Auth:** JWT-based, stored in httpOnly cookies or localStorage
- **Logging:** Standardize to use winston logger (see CODE_CLEANUP.md #3)
- **Validation:** Add input validation middleware for all routes

---

## Frontend Structure

```
/frontend
  /auth
    login.js                   # Login page UI
    register.js                # Registration page UI
    auth-utils.js              # Token management, session checks

  /user
    preferences.js             # User preferences UI (map settings, notifications)
    profile.js                 # User profile management

  /reports
    report-form.js             # Pop-up form when user clicks map
    report-marker.js           # Custom marker component for reports
    report-layer.js            # Map layer for all reports
    report-categories.js       # Report category definitions and icons

  /notifications
    notification-panel.js      # Notification UI component (bell icon, dropdown)
    notification-client.js     # WebSocket notification handler

  /map
    map-init.js                # (existing) Map initialization
    map-config.js              # (existing) Map constants and layers
    map-data.js                # (existing) Segment loading
    map-realtime.js            # WebSocket handler for live segment updates
    segment-direction.js       # Enhanced direction indicators on segments
    path-renderer.js           # Improved path visualization
    tracker-layer.js           # Live plow tracker positions

  /admin
    admin.js                   # Main admin map page (refactored from existing)
    user-management.js         # User CRUD, role assignment
    report-moderation.js       # Review/resolve user reports
    segment-editor.js          # Segment editing tools (existing functionality)
    analytics.js               # Stats dashboard (optional)

  /websocket
    socket-client.js           # WebSocket client connection setup
    reconnect-handler.js       # Auto-reconnect logic with exponential backoff

  /shared
    utils.js                   # (existing) Shared utilities
    time-slider.js             # (existing) Time slider component
    api-client.js              # Centralized API wrapper with auth headers

  main.js                      # (existing) Public map page
  admin.js                     # REFACTOR → /admin/admin.js
  style.css                    # (existing) Global styles
```

### Key Frontend Decisions
- **Admin refactor:** Break up `admin.js` (1,587 lines) into `/admin` folder modules
- **API client:** Centralized `api-client.js` handles auth tokens, refresh, 401 handling
- **WebSocket:** Single client connection, routes events to appropriate handlers
- **Report UI:** Modal/popup form, integrates with existing map click events

---

## Worker Structure

```
/worker
  /events
    segment-publisher.js       # Publish segment updates to WebSocket server
    activity-logger.js         # Log plow activity for analytics/reports

  main.js                      # (existing) Add event publishing
```

### Key Worker Decisions
- Workers publish events to backend WebSocket server (not directly to clients)
- Backend broadcasts to connected clients based on permissions/subscriptions

---

## Database Schema Additions

```sql
-- Users table
CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role VARCHAR(20) NOT NULL DEFAULT 'user',  -- admin, roadcrew, user
  tier VARCHAR(20) NOT NULL DEFAULT 'basic', -- basic, premium
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- User preferences
CREATE TABLE user_preferences (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  default_time_range INTEGER DEFAULT 168,  -- hours
  notification_enabled BOOLEAN DEFAULT true,
  email_digest BOOLEAN DEFAULT false,
  map_settings JSONB,  -- Custom map preferences
  updated_at TIMESTAMP DEFAULT NOW()
);

-- User reports on map
CREATE TABLE user_reports (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  latitude DECIMAL(10, 8) NOT NULL,
  longitude DECIMAL(11, 8) NOT NULL,
  category VARCHAR(50) NOT NULL,  -- ice, pothole, blocked, debris, etc.
  notes TEXT,
  photo_url VARCHAR(255),
  status VARCHAR(20) DEFAULT 'open',  -- open, resolved, expired
  resolved_by INTEGER REFERENCES users(id),
  resolved_at TIMESTAMP,
  expires_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Notifications
CREATE TABLE notifications (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  type VARCHAR(50) NOT NULL,  -- report_resolved, segment_update, system
  title VARCHAR(255) NOT NULL,
  message TEXT,
  read BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Sessions (optional - if using database sessions instead of JWT only)
CREATE TABLE sessions (
  sid VARCHAR(255) PRIMARY KEY,
  sess JSONB NOT NULL,
  expire TIMESTAMP NOT NULL
);
```

---

## Implementation Phases

### Phase 1: Authentication & Users (Foundation)
**Order matters - everything depends on this**

1. Database migrations (users, user_preferences, sessions)
2. Backend auth service (password hashing, JWT generation)
3. Backend auth routes (login, register, logout, refresh)
4. Auth middleware (protect existing routes)
5. Frontend login/register pages
6. Frontend api-client.js (centralized auth handling)
7. Update existing routes to require auth

**Testing:** Can register, login, logout, access protected routes

### Phase 2: User Reports
**Depends on: Phase 1 (users)**

1. Database migration (user_reports)
2. Backend reports service & routes
3. Frontend report form (map click → modal)
4. Frontend report markers & layer
5. Admin report moderation UI

**Testing:** Users can submit reports, admin can moderate

### Phase 3: Real-time Updates (WebSocket)
**Can start in parallel with Phase 2**

1. Backend WebSocket server setup
2. WebSocket auth (verify JWT on connect)
3. Frontend WebSocket client
4. Segment update handler (backend → frontend)
5. Report broadcast handler (new reports appear live)
6. Worker event publishing (segment updates)

**Testing:** Multiple clients see updates in real-time

### Phase 4: Notifications
**Depends on: Phase 1 (users), Phase 3 (WebSocket)**

1. Database migration (notifications)
2. Backend notifications service & routes
3. Frontend notification panel UI
4. WebSocket notification push
5. User notification preferences

**Testing:** Users receive notifications for relevant events

### Phase 5: UI Improvements
**Can happen anytime, independent**

1. Segment direction indicators
2. Enhanced path rendering
3. Live tracker positions (depends on Phase 3)
4. User preferences UI (depends on Phase 1)

**Testing:** Visual improvements verified on map

### Phase 6: Admin Refactor
**Should happen early to establish pattern**

1. Create `/frontend/admin/` folder structure
2. Move segment editing to `segment-editor.js`
3. Create `user-management.js`
4. Create `report-moderation.js`
5. Refactor `admin.js` to use modules

**Testing:** Admin functionality unchanged, code more maintainable

---

## Dependencies Between Modules

```
Auth (Phase 1)
  ↓
  ├── User Reports (Phase 2)
  ├── Notifications (Phase 4) ──┐
  └── WebSocket (Phase 3) ──────┤
                                 ↓
                         Real-time features work together
```

---

## Open Questions

### Technical Decisions
- [ ] JWT storage: httpOnly cookies or localStorage?
- [ ] Session management: JWT only or database sessions too?
- [ ] Photo uploads: Where to store? (S3, local filesystem, database?)
- [ ] Report expiration: Auto-expire after X days or manual only?
- [ ] WebSocket rooms: Per municipality, per user role, global?

### Feature Details
- [ ] Report categories: Exact list needed (ice, pothole, blocked, debris, other?)
- [ ] Report moderation: Can roadcrew edit reports or just resolve?
- [ ] Premium features: What features are basic vs premium?
- [ ] Notification types: What events trigger notifications?
- [ ] Email notifications: Required or optional for v1?

### Performance
- [ ] WebSocket scaling: How many concurrent connections expected?
- [ ] Report archive: Do old reports get archived or deleted?
- [ ] Caching strategy: Redis needed for sessions/frequent queries?

---

## Notes

- **Start with Phase 1 (Auth)** - everything depends on users existing
- **Phase 6 (Admin refactor)** could happen early to establish modular pattern
- **Create folders only** when starting a phase, create files as implementing
- **Test between phases** to ensure foundation is solid
- **Update this document** as decisions are made and structure evolves
