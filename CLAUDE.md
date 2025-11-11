# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**dhis2Sync** is a web application for synchronizing health data between DHIS2 (District Health Information System 2) instances. It provides:

- **Data Transfer**: Sync aggregate datasets between instances with element mapping
- **Metadata Assessment**: Compare and sync metadata (data elements, categories, org units, etc.)
- **Completeness Assessment**: Analyze data element compliance across organization units
- **Tracker/Events**: Transfer event programs between instances
- **Scheduled Jobs**: Automate recurring transfers and assessments

**Technology Stack:**
- Backend: FastAPI (Python 3.11) + Uvicorn ASGI server
- Frontend: Vanilla JavaScript (no frameworks), Bootstrap 5, Jinja2 templates
- Database: SQLAlchemy ORM (SQLite for dev, PostgreSQL for production)
- Task Processing: APScheduler for background jobs
- Security: Fernet symmetric encryption for stored credentials

---

## Desktop Application Migration (In Progress)

**Status**: Migrating from FastAPI web app to Wails v2 desktop application

**Beads Issue Tracker**: [bd-24](https://github.com/anthropics/beads) - Phase 3 Complete

### Migration Progress

#### ✅ Completed Phases:
- **Phase 1**: Foundation (CSS + utilities) - **4 hours** ✅
  - Created `app.css` (319 lines) - Complete CSS port from web app
  - Created `components/index.js` (159 lines) - Reusable UI components
  - Created `utils/periods.js` (382 lines) - DHIS2 period generation for 15 types
  - Created `utils/progress-polling.js` (133 lines) - Polling-based progress tracker
  - Created `utils/import-report.js` (255 lines) - DHIS2 import report renderer
  - Fixed 3 critical naming bugs in main.js

- **Phase 2**: Navigation & Dashboard - **4 hours** ✅
  - 4-tab navigation system (Dashboard, Settings, Transfer, Completeness)
  - Header with connection status indicator
  - Dashboard tab with job history, quick actions, system status
  - Settings tab with profile management form
  - JS bundle: 29.73 KB, CSS: 3.43 KB

- **Phase 3**: Transfer Tab - **10 hours** ✅
  - **Phase 3.1**: Transfer tab shell with 3 subtabs (Data, Metadata, Tracker/Events)
    - Bootstrap nav-pills for subtab navigation
    - JS bundle: 32.84 KB

  - **Phase 3.2**: Data subtab implementation
    - Dataset selection dropdown
    - Auto-loading dataset info on selection
    - Dynamic period picker (15 period types)
    - Multi-select periods with transfer button
    - Real-time progress tracking (2s polling)
    - JS bundle: 43.97 KB (+11.13 KB)

  - **Phase 3.3**: Metadata subtab implementation
    - 6 metadata type checkboxes (OUs, categories, options, data elements, datasets)
    - Run Assessment with progress tracking
    - Results with accordions (Missing, Conflicts, Suggestions)
    - Paginated results (25 items/page with "Load more")
    - Review Suggestions modal
    - Preview Payload, Dry-Run, Apply workflow
    - DHIS2 import report rendering
    - JS bundle: 65.56 KB (+21.59 KB)
    - 11 new methods added

  - **Phase 3.4**: Tracker/Events subtab implementation
    - Program selection dropdown (auto-loads from source)
    - Program stage selection (auto-populates)
    - Org unit input + date range pickers
    - Preview Events (shows counts + sample table)
    - Transfer and Dry Run buttons
    - Real-time progress tracking
    - Import summary display
    - JS bundle: 80.57 KB (+15.01 KB)
    - 5 new methods added

- **Phase 4**: Completeness Tab - **3 hours** ✅
  - Fixed completeness assessment workflow integration
  - Added instance change listener for dataset reloading
  - Fixed export method to use correct backend API signature (taskID-based)
  - Integrated progress tracking with proper taskID storage
  - Export buttons show/hide based on completion status
  - JS bundle: 93.31 KB (+12.74 KB)
  - **Implementation notes:**
    * Kept simple text-based OU input (not hierarchical tree picker)
    * No period picker or DE pagination in v1 (future enhancement)
    * Focused on core functionality: assessment execution + export
    * All builds compile successfully (frontend + backend)

- **Backend Migration**: **100% Complete** ✅
  - 5 services fully ported (Transfer, Metadata, Completeness, Tracker, Scheduler)
  - 33 Wails-bound methods exposed to frontend (added `ListJobs()`)
  - ~4,300 lines of Go code
  - **Recent additions (Nov 4, 2025):**
    * Secure encryption system with keychain integration
    * `ListJobs()` method for Dashboard job history
    * Encryption validation in profile creation

#### ⏳ Remaining Phases:
- **Phase 5**: Testing & Polish - **2-3 hours**
- **Phase 6**: Documentation - **1 hour**

**Total Estimated Remaining**: ~4 hours

### Desktop App Technology Stack:
- **Backend**: Go 1.24 + GORM (SQLite/PostgreSQL)
- **Frontend**: Vanilla JavaScript + Vite + Bootstrap 5
- **Framework**: Wails v2 (Go desktop apps with web frontend)
- **Encryption**: AES-256-GCM for credentials (replaces Fernet)
- **Real-time**: Wails EventsEmit (replaces polling/WebSockets)
- **Task Processing**: Goroutines with panic recovery (replaces APScheduler)

### Desktop App Structure:
```
dhis2sync-desktop/
├── main.go                      # Wails entry point
├── app.go                       # 32 Wails-bound methods
├── internal/
│   ├── crypto/                  # AES-256-GCM encryption
│   ├── database/                # GORM setup + auto-migration
│   ├── models/                  # Database models
│   └── services/                # 5 services (Transfer, Metadata, Completeness, Tracker, Scheduler)
│       ├── transfer/            # Dataset transfer with mapping
│       ├── metadata/            # Metadata comparison & sync
│       ├── completeness/        # Data element compliance assessment
│       ├── tracker/             # Event program transfer
│       └── scheduler/           # CRON job automation
└── frontend/
    ├── src/
    │   ├── main.js              # Application logic (573 lines)
    │   ├── app.css              # Ported styles (319 lines)
    │   ├── components/          # Reusable UI (renderProgressBar, renderAlert, etc.)
    │   └── utils/               # periods.js, progress-polling.js, import-report.js
    └── dist/                    # Vite build output
```

### Key Differences from Web App:

| Feature | Web App (Python/FastAPI) | Desktop App (Go/Wails) |
|---------|--------------------------|------------------------|
| **Authentication** | HTTP sessions with cookies | Desktop app state (no sessions) |
| **API Communication** | REST endpoints (AJAX) | Wails bindings (`App.*` methods) |
| **Real-time Updates** | Polling (`/progress/{taskId}`) | EventsEmit (`runtime.EventsOn`) |
| **Encryption** | Fernet (symmetric) | AES-256-GCM |
| **Task Processing** | APScheduler (Python) | Goroutines + robfig/cron |
| **Database** | SQLAlchemy ORM | GORM |
| **Deployment** | Railway/Docker/EC2 | Native app bundles (DMG/MSI/DEB) |

### Development Commands (Desktop):

```bash
# Install Wails CLI (first time only)
go install github.com/wailsapp/wails/v2/cmd/wails@latest

# Run development mode with hot reload
cd dhis2sync-desktop
wails dev

# Build production app
wails build

# Build output locations:
# macOS:   build/bin/dhis2sync-desktop.app
# Windows: build/bin/dhis2sync-desktop.exe
# Linux:   build/bin/dhis2sync-desktop
```

### Testing Desktop App:

```bash
# Backend tests
cd dhis2sync-desktop
go test ./internal/...

# Frontend build
cd frontend
npm run build

# Check Wails bindings generation
wails generate module
```

### Backend Services (Go):

All 5 services from the web app have been fully ported:

1. **Transfer Service** (`internal/services/transfer/`)
   - List datasets and detailed info
   - Background transfer with element mapping
   - Progress tracking with EventsEmit
   - Dataset completeness marking
   - Import report parsing

2. **Metadata Service** (`internal/services/metadata/`)
   - Metadata comparison (source vs destination)
   - Mapping suggestions (UID → code → name)
   - Dependency-aware payload building
   - Dry-run validation
   - Import execution with reports

3. **Completeness Service** (`internal/services/completeness/`)
   - Data element compliance assessment
   - Multi-OU support with hierarchy traversal
   - Background processing with progress updates
   - Export to JSON/CSV
   - Bulk actions (mark complete/incomplete)

4. **Tracker Service** (`internal/services/tracker/`)
   - Event program listing and filtering
   - Event preview with sampling
   - Background event transfer
   - Event transformation to minimal payload
   - Multi-OU batch processing

5. **Scheduler Service** (`internal/services/scheduler/`)
   - CRON-based job scheduling (robfig/cron)
   - Job persistence in database
   - Dynamic job registration/removal
   - Automated transfers and assessments
   - Last/next run time tracking

### Frontend Migration Status:

| Component | Web App | Desktop App | Status |
|-----------|---------|-------------|--------|
| **Foundation** | Bootstrap 5 CSS | Ported to app.css | ✅ Complete |
| **Navigation** | 4 tabs | 4 tabs (Dashboard, Settings, Transfer, Completeness) | ✅ Complete |
| **Dashboard** | Job history, Quick actions, System status | Full parity with `ListJobs()` | ✅ Complete |
| **Settings** | Profile CRUD | Profile list + creation form | ✅ Complete |
| **Transfer** | 3 subtabs (Data, Metadata, Tracker) | Full implementation (Data + Metadata + Tracker) | ✅ Complete |
| **Completeness** | Assessment + export | Core functionality (assessment execution + export) | ✅ Complete (v1) |
| **Schedules** | CRON jobs | Deferred to Phase 5 | ⏳ Phase 5 |

### Recent Critical Fixes (Nov 4, 2025):

#### 1. Encryption System Overhaul ✅
**Problem:** Profiles saved with encrypted passwords failed to decrypt due to missing/changing encryption keys.

**Solution Implemented:**
- Created `internal/crypto/keystore.go` with system keychain integration
- Uses `github.com/zalando/go-keyring` for secure key storage
- **Priority order:**
  1. `ENCRYPTION_KEY` env var (development/testing)
  2. System keychain (production - macOS Keychain, Windows Credential Manager)
  3. Auto-generate and store new key if none exists
- Made encryption initialization **fatal** (app won't start without it)
- Added `IsInitialized()` check to prevent profile creation without encryption
- Keys persist across app restarts via OS-level secure storage

**Files Modified:**
- `internal/crypto/keystore.go` (new file - 67 lines)
- `internal/crypto/encryption.go` (updated InitEncryption + added IsInitialized)
- `app.go` (fatal error on init failure, validation in CreateProfile)

#### 2. Dashboard Job History ✅
**Problem:** Dashboard showed placeholder "No jobs yet" even after running transfers/assessments.

**Solution Implemented:**
- Added `ListJobs(limit int)` method in `app.go` (lines 214-251)
- Queries `TaskProgress` table for recent jobs
- Returns `JobHistoryResponse` with task_id, job_type, status, timestamps, summary
- Frontend `refreshJobHistory()` method updated to call backend and render table
- Displays last 10 jobs with type, status badges, timestamps, and summaries

**Files Modified:**
- `app.go` (added JobHistoryResponse type + ListJobs method)
- `frontend/src/main.js` (updated refreshJobHistory with actual API call)

**Build Status:** ✅ All changes compile successfully
- Backend: No errors
- Frontend: 93.02 KB JS bundle (was 80.57 KB)
- Wails bindings regenerated successfully

---

## Implementation Gaps Analysis & Fixes (bd-27)

**Status**: In Progress
**Beads Issue**: [bd-27](https://github.com/anthropics/beads) - Fix 12 Implementation Gaps + Add Mark Complete UI
**Discovery Date**: Nov 5, 2025
**Total Estimated Time**: 5.5-7.5 hours

### Overview
Through comprehensive comparison of FastAPI (Python) vs Desktop (Go) implementations, discovered **12 critical gaps** where the desktop app doesn't replicate proven FastAPI patterns. Additionally adding "Mark Complete" checkbox UI enhancement.

### Phase 1: Critical Fixes (3-4 hours) 🔴

#### 1.1 Transfer: Add "Mark Complete" Checkbox ✨ NEW (5 minutes)
**Problem**: No UI control for marking datasets complete after transfer
**Backend**: `TransferRequest.MarkComplete` field already exists (line 13 in `types.go`)
**Frontend Gap**: `mark_complete` hardcoded to `false` (line 922 in `main.js`)

**Files to Modify**:
- `frontend/src/main.js` (lines ~316-328)
  - Add checkbox HTML after period selection
  - Read checkbox value in `startDataTransfer()`
  - Reset checkbox on dataset change

**Implementation**:
```html
<div class="form-check mb-3">
    <input class="form-check-input" type="checkbox" id="mark-complete-checkbox">
    <label class="form-check-label" for="mark-complete-checkbox">
        Mark datasets as complete after transfer
    </label>
</div>
```

#### 1.2 Transfer: Apply Element Mappings (30 minutes)
**Problem**: Element mapping logic exists but never applied during transfer
**FastAPI**: Lines 1491-1502 in `app/main.py` apply mappings before import
**Desktop**: `applyMapping()` method exists but returns values unchanged

**Files to Modify**:
- `internal/services/transfer/service.go`
  - Review/fix `applyMapping()` implementation
  - Ensure it transforms data element IDs using `req.ElementMapping`
  - Call it before importing to destination
  - Add unit tests for mapping logic

#### 1.3 Transfer: Implement Dataset Completeness Marking (45 minutes)
**Problem**: After successful transfer, datasets never marked complete in destination
**FastAPI**: Lines 1518-1550 in `app/main.py` mark datasets complete
**Desktop**: `markDatasetComplete()` method commented out in `app.go` line ~403

**Files to Modify**:
- `app.go` (line ~403)
  - Uncomment and fix `markDatasetComplete()` method
- `internal/services/transfer/service.go`
  - Call `markDatasetComplete()` from `TransferData()` after successful import
  - Only if `req.MarkComplete == true`
  - Use `/api/completeDataSetRegistrations` endpoint
  - Handle per org unit/period combination

#### 1.4 Scheduler: Fix CRON Format Incompatibility (30 minutes)
**Problem**: FastAPI uses 5-field cron (`* * * * *`), Desktop uses 6-field cron (`* * * * * *`)
**FastAPI**: APScheduler expects `minute hour day month day_of_week`
**Desktop**: robfig/cron v3 expects `second minute hour day month day_of_week`

**Files to Modify**:
- `internal/services/scheduler/service.go`
  - Add cron format detection in `CreateJob()` and `UpdateJob()`
  - Auto-convert 5-field → 6-field (prepend `0` seconds)
  - Add validation error messages for invalid formats
- Frontend UI (optional)
  - Update hint text to indicate 6-field format required

**Example Conversion**:
- Input: `"0 2 * * 1"` (5-field: Every Monday at 2 AM)
- Output: `"0 0 2 * * 1"` (6-field: same)

#### 1.5 Scheduler: Implement Completeness Jobs (45 minutes)
**Problem**: Completeness jobs are stubs, don't actually run assessments
**FastAPI**: Lines 80-105 in `app/scheduler.py` run `perform_assessment()`
**Desktop**: `executeCompletenessJob()` logs "executing..." but does nothing

**Files to Modify**:
- `internal/services/scheduler/service.go`
  - Implement `executeCompletenessJob()` method
  - Call `s.completenessService.RunAssessment()`
  - Parse job payload: `dataset_id`, `org_units`, `periods`
  - Handle background execution with progress tracking
  - Store task progress same as manual assessments

### Phase 2: High Priority (1-2 hours) 🟡

#### 2.1 Completeness: Fix Hierarchy Building (30 minutes)
**Problem**: Org unit hierarchy building uses hardcoded structure assumptions
**FastAPI**: Lines 200-250 in `app/routes/completeness.py` - dynamic hierarchy
**Desktop**: May not handle complex/deep hierarchies

**Files to Modify**:
- `internal/services/completeness/service.go`
  - Review `buildHierarchy()` method
  - Handle variable-depth org unit trees
  - Test with real DHIS2 instances

#### 2.2 Metadata: Add Required Field Defaults (30 minutes)
**Problem**: Metadata imports may fail due to missing required DHIS2 fields
**FastAPI**: Lines 150-200 in `app/routes/metadata.py` set defaults
**Desktop**: May not set all required defaults

**Files to Modify**:
- `internal/services/metadata/service.go`
  - Review `buildPayload()` method
  - Add defaults: `sharing`, `attributeValues`, `aggregationType`, `valueType`, `domainType`
  - Test imports across DHIS2 versions

#### 2.3 Tracker: Make ouMode Configurable (30 minutes)
**Problem**: Desktop hardcodes `ouMode=DESCENDANTS`, limiting flexibility
**FastAPI**: `ouMode` is configurable per request
**Desktop**: Line ~150 in `service.go` hardcodes value

**Files to Modify**:
- `internal/services/tracker/types.go`
  - Add `OuMode` field to `TransferRequest` struct
  - Default to `DESCENDANTS` for backwards compatibility
- `internal/services/tracker/service.go`
  - Use `req.OuMode` instead of hardcoded value
- Frontend (optional enhancement)
  - Add dropdown for `SELECTED`, `DESCENDANTS`, `CHILDREN`, `ACCESSIBLE`

### Phase 3: Medium Priority (1 hour) 🟢

#### 3.1 Transfer: Enhanced Import Report Parsing (20 minutes)
**FastAPI**: Parses detailed conflict information
**Desktop**: Returns raw import response

**Files to Modify**:
- `internal/services/transfer/service.go`
  - Parse conflict details from import reports
  - Extract validation errors
  - Display in UI

#### 3.2 Metadata: Dry-Run Result Caching (20 minutes)
**FastAPI**: Caches dry-run results to speed up actual import
**Desktop**: Re-fetches payload after dry-run

**Files to Modify**:
- `internal/services/metadata/service.go`
  - Cache dry-run payloads in memory
  - 5-10 minute expiration
  - Reuse for actual import

#### 3.3 Completeness: Granular Progress Updates (20 minutes)
**FastAPI**: Reports progress per org unit
**Desktop**: Only reports start/complete

**Files to Modify**:
- `internal/services/completeness/service.go`
  - Add incremental progress updates in `RunAssessment()` loop
  - Report 0%, 10%, 20%, etc. as OUs are processed

### Phase 4: Low Priority (30 minutes) 🔵

#### 4.1 Transfer: Retry Logic for Failed Imports (15 minutes)
**FastAPI**: Retries failed imports 3 times with exponential backoff
**Desktop**: Single attempt, fails immediately

**Files to Modify**:
- `internal/services/transfer/service.go`
  - Add retry wrapper around `importDataValues()` calls
  - 3 retries with exponential backoff (500ms, 1s, 2s)

#### 4.2 Scheduler: Job Execution History (15 minutes)
**FastAPI**: Stores execution history with success/failure logs
**Desktop**: Only tracks `last_run_at` and `next_run_at`

**Files to Modify**:
- `internal/models/models.go`
  - Add `JobExecutionHistory` table
- `internal/services/scheduler/service.go`
  - Track each execution with logs, start/end time, success/failure

### Testing Strategy

For each implementation:
1. **Unit Tests**: Add Go tests for new/modified functions
2. **Manual Testing**: Test with real DHIS2 instances
3. **Regression Testing**: Ensure existing functionality still works
4. **Build Verification**: Backend compiles, frontend builds successfully

### Progress Tracking

- [ ] Phase 1.1: Mark Complete checkbox ✨
- [ ] Phase 1.2: Apply element mappings
- [ ] Phase 1.3: Dataset completeness marking
- [ ] Phase 1.4: CRON format compatibility
- [ ] Phase 1.5: Completeness jobs
- [ ] Phase 2.1: Hierarchy building
- [ ] Phase 2.2: Metadata defaults
- [ ] Phase 2.3: ouMode configurable
- [ ] Phase 3.1: Import report parsing
- [ ] Phase 3.2: Dry-run caching
- [ ] Phase 3.3: Granular progress
- [ ] Phase 4.1: Retry logic
- [ ] Phase 4.2: Execution history

---

## Development Commands (Web App)

### Local Setup

```bash
# Create and activate virtual environment
python -m venv .venv
source .venv/bin/activate  # On Windows: .venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Generate encryption key (required)
export ENCRYPTION_KEY="$(python -c 'from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())')"

# Set database URL (SQLite for dev)
export DATABASE_URL="sqlite:///./app.db"
export ENVIRONMENT="development"

# Run development server with auto-reload
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

### Database Migrations

```bash
# Create new migration after model changes
alembic revision -m "description of changes" --autogenerate

# Apply migrations
alembic upgrade head

# Rollback one migration
alembic downgrade -1
```

### Production Deployment

**Railway/Docker:**
- Set environment variables: `DATABASE_URL`, `ENCRYPTION_KEY`, `SECRET_KEY`
- Dockerfile handles build and startup
- Health check: `GET /healthz` � `{"status": "ok"}`
- Readiness: `GET /ready` � `{"ready": true}`

**AWS EC2:**
- Use provided deployment scripts: `deploy-aws.sh` or `deploy-aws-simple.sh`
- SSL setup: `setup-ssl.sh` (Let's Encrypt)
- App updates: `update-app.sh`

## High-Level Architecture

### Client-Server MVC Pattern

```
Browser (Vanilla JS)
    � AJAX requests
FastAPI Routes
    �
Business Logic (dhis2_api.py, scheduler.py)
    �
SQLAlchemy ORM � � Database (SQLite/PostgreSQL)
    �
DHIS2 API Client � External DHIS2 Instances
```

### Key Architectural Patterns

#### 1. Encrypted Credential Storage
- Connection profiles store DHIS2 credentials encrypted with Fernet
- `ConnectionProfile` table holds encrypted passwords
- Decryption happens server-side per request using `conn_utils.py`
- Encryption key stored in `ENCRYPTION_KEY` environment variable (never in code)

#### 2. Session-Based Authentication
- User selects connection profile in UI
- `profile_id` stored in HTTP session (secure, HTTP-only cookie)
- Server resolves credentials from session without transmitting passwords
- Session middleware: `SessionMiddleware` in `app/main.py`

#### 3. Background Task Processing
- Long-running operations (transfer, completeness) run as background tasks
- APScheduler manages scheduled jobs; task state tracked in `TaskProgress` table
- **Dual Storage Pattern**: In-memory dict + DB persistence for reliability
- Frontend polls `/transfer/progress/{task_id}` or `/completeness/progress/{task_id}`
- Task status: `pending` � `running` � `completed`/`failed`

#### 4. API-First Design
- Frontend communicates exclusively via REST endpoints
- No WebSockets (explicitly blocked by middleware in `main.py`)
- All dynamic data fetched via AJAX (`static/js/app.js` DHISApp class)

### Critical Data Flows

#### Transfer Operation Flow
```
1. User selects dataset/periods/OUs in browser
2. POST /transfer/start � creates background task
3. Task added to TaskProgress (DB + in-memory)
4. Browser polls GET /transfer/progress/{task_id} every 2 seconds
5. Backend:
   - Fetches data from source DHIS2 instance
   - Applies element mappings (if needed)
   - Posts to destination instance
   - Updates TaskProgress incrementally
6. Returns import report on completion
7. Optionally marks dataset complete in destination
```

#### Credential Resolution Flow
```
1. User selects profile in UI
2. profile_id stored in session cookie
3. On subsequent requests, server calls get_profile_from_session()
4. Retrieves ConnectionProfile from DB by profile_id
5. Decrypts passwords using Fernet key
6. Returns plaintext credentials for DHIS2 API calls
```

#### Metadata Assessment Flow
```
1. User initiates assessment (source vs destination comparison)
2. Backend fetches metadata from both instances
3. Compares objects by UID, code, name
4. Identifies missing objects and dependency chains
5. Builds minimal import payload respecting dependencies
6. Dry-run validation shows what will be imported
7. User confirms; import executed with report generation
```

## Core Modules

### 1. Transfer (`routes/transfer.py`, `app/dhis2_api.py`)
- Syncs aggregate dataset values between instances
- Supports direct sync (compatible elements) or element mapping
- Uses `transfer_data_with_mapping()` function
- Progress tracked via `TaskProgress` table
- Marks datasets complete after import using `/completeDataSetRegistrations`

### 2. Metadata (`routes/metadata.py`)
- Compares metadata objects (data elements, categories, org units, etc.)
- Suggests mappings: UID match � code match � name match
- Builds dependency-aware payloads (e.g., data element � category combo � categories)
- Dry-run mode validates before import
- Import report shows created/updated/ignored counts

### 3. Completeness (`routes/completeness.py`)
- Assesses data element compliance per organization unit
- OU tree picker with hierarchical selection
- Background task with progress polling
- Results: compliance %, present/missing elements
- Export to JSON/CSV

### 4. Tracker (`routes/tracker.py`)
- Event program (without registration) transfer
- Multi-OU selection with hierarchical picker
- Bulk event transfer between instances
- Uses `/events` DHIS2 API endpoint

### 5. Schedules (`routes/schedules.py`)
- CRON-based job scheduling for recurring operations
- APScheduler backed by `ScheduledJob` table
- Jobs loaded at app startup via `start_scheduler_and_load_jobs()`
- Supports transfer and completeness job types

### 6. Connection Profiles (`routes/settings_profiles.py`)
- CRUD operations for DHIS2 instance pairs
- Credentials encrypted before storage
- Profile selection stored in session
- Validation: tests connection before saving

## Database Models

### SQLAlchemy ORM Models (`app/models_db.py`)

**ConnectionProfile**
- `id`, `name`, `source_url`, `source_username`, `source_password_encrypted`
- `destination_url`, `destination_username`, `destination_password_encrypted`
- Passwords stored as Fernet-encrypted strings

**ScheduledJob**
- `id`, `name`, `cron_expression`, `job_type`, `payload` (JSON)
- `is_active`, `last_run_at`, `next_run_at`
- Loaded into APScheduler on app startup

**TaskProgress**
- `id`, `task_id` (UUID), `status`, `progress` (0-100), `message`, `result` (JSON)
- Dual storage: DB + in-memory dict for performance
- Cleaned up after task completion

## Environment Configuration

### Required Variables

```bash
DATABASE_URL="postgresql+psycopg2://user:pass@host:5432/dbname"  # Or sqlite:///./app.db
ENCRYPTION_KEY="<base64-encoded-32-byte-fernet-key>"  # Generate with cryptography.fernet
```

### Optional Variables

```bash
SECRET_KEY="<random-string>"          # Session middleware secret (default: change-me-in-prod)
ENVIRONMENT="production"               # development or production (affects CORS, cookies)
CORS_ALLOW_ORIGINS="http://localhost:3000,https://app.example.com"  # CSV-separated
LOG_LEVEL="INFO"                       # Logging verbosity
PORT="8000"                            # Server port
HOST="0.0.0.0"                         # Bind address
TZ="UTC"                               # Timezone for scheduler
```

### Security Configuration

**Production Requirements:**
- `ENVIRONMENT=production` enables:
  - HTTPS-only session cookies
  - Strict CORS validation
  - Secure cookie flags
- Always set unique `SECRET_KEY` and `ENCRYPTION_KEY`
- Use PostgreSQL (not SQLite) for production
- Enable HTTPS at reverse proxy/load balancer

## Frontend Architecture

### Vanilla JavaScript (No Frameworks)

**DHISApp Class** (`static/js/app.js`):
- `makeRequest(url, options)`: AJAX wrapper with error handling
- `updateElement(selector, content)`: DOM update utility
- `showLoading(message)`, `hideLoading()`: Loading UI
- `showError(message)`, `showSuccess(message)`: User feedback
- Polling utilities for task progress

**Templates** (`app/templates/`):
- `dashboard.html`: Main application shell
- `partials/`: Modular sections for each feature
  - `transfer_content.html`: Dataset transfer UI
  - `completeness_content.html`: Compliance assessment UI
  - `metadata_content.html`: Metadata comparison UI
  - `tracker_content.html`: Event transfer UI
  - `schedules_content.html`: Job scheduling UI
  - `settings_content.html`: Profile management UI

**UI Pattern:**
- Bootstrap 5 for styling (no custom CSS frameworks)
- Jinja2 server-side rendering for initial page load
- AJAX for dynamic content updates
- Service worker (`sw.js`) + PWA manifest for offline capability

## Security & Resilience Patterns

### Encryption
- **Fernet (symmetric encryption)** for stored passwords
- Time-safe encryption with automatic key rotation support
- Keys never stored in code; always via environment variables
- Decryption only happens server-side, never in frontend

### Retry Logic
- DHIS2 API calls retry 3 times with exponential backoff
- Handles transient network errors gracefully
- Configurable in `dhis2_api.py` client

### Task Resilience
- Progress persisted to DB for recovery after restart
- Chunked processing for large datasets
- Time-slicing to avoid blocking
- Log trimming for large jobs

### Middleware
- **WebSocket Blocker**: Explicitly blocks WebSocket/SSE endpoints
- **Session Middleware**: HTTP-only cookies, SameSite=Lax
- **CORS**: Configurable origins for integration

## Common Development Tasks

### Adding a New Feature Module

1. Create route handler in `app/routes/new_feature.py`
2. Create Pydantic models in `app/models.py` (request/response)
3. Add SQLAlchemy models in `app/models_db.py` (if DB needed)
4. Create template in `app/templates/partials/new_feature_content.html`
5. Add route registration in `app/main.py`
6. Create frontend JS in `static/js/app.js` (or separate file)
7. Add navigation link in `dashboard.html`

### Modifying DHIS2 API Integration

- All DHIS2 API calls go through `app/dhis2_api.py`
- Use `DHIS2Client` class methods (get, post, put, delete)
- Add new endpoints as methods on DHIS2Client
- Handle pagination, filtering, fields selection consistently
- Test with both source and destination instances

### Database Schema Changes

```bash
# 1. Modify models in app/models_db.py
# 2. Generate migration
alembic revision -m "add new column to table" --autogenerate
# 3. Review generated migration in migrations/versions/
# 4. Apply migration
alembic upgrade head
```

### Debugging Background Tasks

- Check `TaskProgress` table for task status
- In-memory task storage: `app.main.task_progress_store` dict
- APScheduler jobs: `app.scheduler.scheduler.get_jobs()`
- Logs: task progress messages stored in `TaskProgress.message`

## Important Code Patterns

### Credential Decryption
```python
from app.conn_utils import get_profile_from_session
profile = get_profile_from_session(request)  # Returns decrypted ConnectionProfile
source_client = DHIS2Client(profile.source_url, profile.source_username, profile.source_password)
```

### Background Task Creation
```python
from app.main import task_progress_store
task_id = str(uuid.uuid4())
task_progress_store[task_id] = {"status": "pending", "progress": 0}
# Run task in background thread/process
# Update task_progress_store incrementally
```

### DHIS2 API Call Pattern
```python
client = DHIS2Client(base_url, username, password)
data_elements = client.get("/api/dataElements.json", params={"fields": "id,name,code"})
```

### OU Tree Picker Integration
- Organization units fetched via `/api/organisationUnits` with `level` parameter
- Hierarchical display requires parent-child relationships
- Selection stored as comma-separated OU UIDs
- Tree picker component in completeness/transfer/tracker templates

## File Structure Reference

```
app/
   main.py                    # FastAPI app, routes, middleware, session config
   db.py                      # SQLAlchemy engine, session factory
   models.py                  # Pydantic request/response models
   models_db.py               # SQLAlchemy ORM models
   dhis2_api.py               # DHIS2 API client wrapper
   conn_utils.py              # Credential decryption utilities
   scheduler.py               # APScheduler job management
   routes/                    # Feature-specific route handlers
       completeness.py        # Data completeness assessment
       metadata.py            # Metadata sync & mapping
       tracker.py             # Tracker/event program transfer
       schedules.py           # Job scheduling management
       settings_profiles.py   # Connection profile CRUD

static/
   js/app.js                  # Vanilla JS application logic
   manifest.json              # PWA manifest
   sw.js                      # Service worker

app/templates/
   dashboard.html             # Main application shell
   partials/                  # Feature templates
       completeness_content.html
       transfer_content.html
       metadata_content.html
       tracker_content.html
       schedules_content.html
       settings_content.html

migrations/                    # Alembic migration scripts
```

## Recent Development Focus

Based on recent commits, active development areas:
- **Job Resilience**: Chunking, progress persistence, time-slicing for large jobs
- **UX Improvements**: Auto-loading dataset info, alphabetical OU sorting
- **Period Handling**: Weekly periods relative-from-today calculations
- **Tracker Enhancements**: OU dropdown fixes, event program support

## DHIS2 API Integration Notes

### Common Endpoints Used

- `/api/dataSets` - Dataset metadata
- `/api/dataElements` - Data element definitions
- `/api/dataValueSets` - Aggregate data values
- `/api/organisationUnits` - OU hierarchy
- `/api/categoryOptionCombos` - Disaggregation categories
- `/api/events` - Tracker event programs
- `/api/completeDataSetRegistrations` - Completeness markers
- `/api/metadata` - Bulk metadata import/export

### API Versioning
- Supports DHIS2 v2.35+ (API version 35+)
- Uses `/api/` prefix (not versioned endpoints)
- Fields filtering: `?fields=id,name,code`
- Paging: `?page=1&pageSize=50`

### Import Strategies
- `CREATE_AND_UPDATE`: Default for metadata/data imports
- `dryRun=true`: Validation without persistence
- Import reports: `status`, `stats`, `typeReports`, `validationReport`

 Fetching 16/17: Odravu P.S (IDotUrc9qFO)
2025/11/10 12:04:58 [7d6ee51a-79a8-4102-a794-4c9289a1ad5c] running (67%):   ✓ Fetched 27 values for period 2021
2025/11/10 12:04:58 [7d6ee51a-79a8-4102-a794-4c9289a1ad5c] running (70%): Fetching 17/17: Test P.S (J37hk7HCxoi)
2025/11/10 12:05:07 [7d6ee51a-79a8-4102-a794-4c9289a1ad5c] running (70%):   ✓ Fetched 2 values for period 2021
2025/11/10 12:05:07 [7d6ee51a-79a8-4102-a794-4c9289a1ad5c] running (70%): ✓ Fetched 5015 total data values from 17 org units
2025/11/10 12:05:07 [7d6ee51a-79a8-4102-a794-4c9289a1ad5c] running (72%): Importing 5015 data values in bulk (1000 values per chunk)...
2025/11/10 12:05:07 Bulk import: 5015 total values, 6 chunks of ~1000 values each
2025/11/10 12:05:07 Sending bulk chunk 6/6 (15 values)...
2025/11/10 12:05:07 Sending bulk chunk 1/6 (1000 values)...
2025/11/10 12:05:07 Sending bulk chunk 2/6 (1000 values)...
2025/11/10 12:05:07 Sending bulk chunk 4/6 (1000 values)...
2025/11/10 12:05:07 Sending bulk chunk 5/6 (1000 values)...
2025/11/10 12:06:42 ✓ Chunk 6/6 complete: imported=0, updated=0, ignored=0
2025/11/10 12:06:42 [7d6ee51a-79a8-4102-a794-4c9289a1ad5c] running (95%): ✓ Completed chunk 6/6 (imported=0, updated=0)
2025/11/10 12:06:42 Sending bulk chunk 3/6 (1000 values)...
2025/11/10 12:07:07.666441 WARN RESTY Post "<https://dev.emisuganda.org/emisdev/api/dataValueSets>": context deadline exceeded (Client.Timeout exceeded while awaiting headers), Attempt 1
2025/11/10 12:07:07.666534 ERROR RESTY Post "<https://dev.emisuganda.org/emisdev/api/dataValueSets>": context deadline exceeded (Client.Timeout exceeded while awaiting headers)
2025/11/10 12:07:07.729675 WARN RESTY Post "<https://dev.emisuganda.org/emisdev/api/dataValueSets>": context deadline exceeded (Client.Timeout exceeded while awaiting headers), Attempt 1
2025/11/10 12:07:07.729715 ERROR RESTY Post "<https://dev.emisuganda.org/emisdev/api/dataValueSets>": context deadline exceeded (Client.Timeout exceeded while awaiting headers)
2025/11/10 12:07:07.729694 WARN RESTY Post "<https://dev.emisuganda.org/emisdev/api/dataValueSets>": context deadline exceeded (Client.Timeout exceeded while awaiting headers), Attempt 1
2025/11/10 12:07:07.729741 ERROR RESTY Post "<https://dev.emisuganda.org/emisdev/api/dataValueSets>": context deadline exceeded (Client.Timeout exceeded while awaiting headers)
2025/11/10 12:07:07.729733 WARN RESTY Post "<https://dev.emisuganda.org/emisdev/api/dataValueSets>": context deadline exceeded (Client.Timeout exceeded while awaiting headers), Attempt 1
2025/11/10 12:07:07.729763 ERROR RESTY Post "<https://dev.emisuganda.org/emisdev/api/dataValueSets>": context deadline exceeded (Client.Timeout exceeded while awaiting headers)
2025/11/10 12:08:42.325672 WARN RESTY Post "<https://dev.emisuganda.org/emisdev/api/dataValueSets>": context deadline exceeded (Client.Timeout exceeded while awaiting headers), Attempt 1
2025/11/10 12:08:42.325743 ERROR RESTY Post "<https://dev.emisuganda.org/emisdev/api/dataValueSets>": context deadline exceeded (Client.Timeout exceeded while awaiting headers)
2025/11/10 12:08:42 [7d6ee51a-79a8-4102-a794-4c9289a1ad5c] error (72%): ✗ Bulk import failed: bulk import had 5 errors: chunk 1 failed: Post "<https://dev.emisuganda.org/emisdev/api/dataValueSets>": context deadline exceeded (Client.Timeout exceeded while awaiting headers)
