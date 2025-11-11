# DHIS2 Sync Desktop Migration Progress

## ✅ Phase 1: Project Initialization (COMPLETE)

### Completed Tasks
- [x] Installed Wails CLI v2.10.2
- [x] Verified all dependencies (Go, Node.js, npm, Xcode tools)
- [x] Initialized Wails project with vanilla template
- [x] Installed Go dependencies:
  - `gorm.io/gorm` - Database ORM
  - `gorm.io/driver/sqlite` - SQLite driver
  - `gorm.io/driver/postgres` - PostgreSQL driver
  - `github.com/go-resty/resty/v2` - HTTP client
  - `github.com/robfig/cron/v3` - Job scheduler
  - `github.com/google/uuid` - UUID generation
  - `golang.org/x/crypto` - Encryption primitives
- [x] Created project directory structure:
  ```
  internal/
  ├── api/              # DHIS2 API client
  ├── database/         # DB connection & migrations
  ├── models/           # GORM models
  ├── crypto/           # Encryption utilities
  ├── services/         # Business logic
  │   ├── transfer/
  │   ├── metadata/
  │   ├── completeness/
  │   ├── tracker/
  │   └── scheduler/
  └── utils/            # Helpers
  ```

## ✅ Phase 2: Core Infrastructure (COMPLETE)

### Database Layer
**Files Created:**
- `internal/models/connection_profile.go` - Connection profile model with encrypted credentials
- `internal/models/scheduled_job.go` - Scheduled job model with cron support
- `internal/models/task_progress.go` - Task progress tracking model
- `internal/database/db.go` - Database initialization, auto-migration, connection management

**Features:**
- GORM models matching Python SQLAlchemy schema
- Auto-migration on startup
- Support for both SQLite (dev) and PostgreSQL (prod)
- UUID primary keys with BeforeCreate hooks
- Proper column name mapping (snake_case)

### Encryption Layer
**File Created:**
- `internal/crypto/encryption.go` - AES-256-GCM encryption/decryption

**Migration from Python:**
- Ported from Python's `Fernet` (symmetric encryption) to Go's `AES-256-GCM`
- Uses `ENCRYPTION_KEY` environment variable
- Base64-encoded ciphertext for database storage
- Nonce prepended to ciphertext for security
- SHA256 key derivation for flexible key input

### DHIS2 API Client
**File Created:**
- `internal/api/client.go` - DHIS2 REST API client

**Features:**
- HTTP client with automatic retry logic (3 attempts, exponential backoff)
- Retry on 429, 500-504 status codes
- Organization unit name caching (thread-safe with RWMutex)
- Methods: `Get`, `Post`, `Delete`, `Put`, `ListPrograms`, `GetOrgUnitName`
- Configurable timeouts (default 10s for GET, retries with backoff)
- Built on `go-resty/resty` for robust HTTP handling

### Application Bootstrap
**Files Modified:**
- `app.go` - Main application struct with startup/shutdown hooks
- `main.go` - Entry point with Wails configuration

**Features:**
- Startup initialization:
  1. Initialize encryption from `ENCRYPTION_KEY`
  2. Connect to database and run auto-migration
  3. TODO: Load scheduler (Phase 3)
  4. TODO: Restore in-progress tasks (Phase 3)
- Shutdown cleanup:
  1. Close database connections
  2. TODO: Stop scheduler gracefully (Phase 3)
- In-memory task progress cache for performance
- Selected profile state management

### Build Verification
- ✅ Successful compilation (`go build`)
- ✅ Binary size: 21MB (single executable)
- ✅ All imports resolved correctly
- ✅ No compilation errors or warnings

---

## 🚧 Phase 3: Service Layer Migration (IN PROGRESS)

### Remaining Services to Implement

#### 3.1 Transfer Service (`internal/services/transfer/`)
**Python Source:** `app/routes/transfer.py`, `app/dhis2_api.py`

**Required Methods:**
- `ListDatasets(sourceOrDest string) ([]Dataset, error)` - List available datasets
- `GetDatasetInfo(datasetID, sourceOrDest string) (*DatasetInfo, error)` - Get dataset details
- `StartTransfer(req TransferRequest) (taskID string, error)` - Initiate data transfer
- `GetTransferProgress(taskID string) (*TaskProgress, error)` - Query transfer status
- `TransferDataWithMapping()` - Core transfer logic with element mapping
- `MarkDatasetComplete()` - Register dataset completeness

**Key Complexity:**
- Element mapping (UID → code → name matching)
- Chunked data fetching/posting for large datasets
- Progress tracking with DB + in-memory dual storage
- Dataset completeness registration via `/completeDataSetRegistrations`

#### 3.2 Metadata Service (`internal/services/metadata/`)
**Python Source:** `app/routes/metadata.py`

**Required Methods:**
- `CompareMetadata(req CompareRequest) (*ComparisonResult, error)` - Compare source vs dest
- `SuggestMappings()` - Auto-suggest element mappings
- `BuildImportPayload()` - Dependency resolution (element → catCombo → categories)
- `ValidateImport(dryRun=true)` - Dry-run validation
- `ExecuteImport()` - Actual metadata import

**Key Complexity:**
- Dependency graph traversal
- Ensuring correct import order
- Dry-run validation before actual import
- Import report parsing (created/updated/ignored counts)

#### 3.3 Completeness Service (`internal/services/completeness/`)
**Python Source:** `app/routes/completeness.py`

**Required Methods:**
- `GetOrgUnitsTree(parentID, level)` - Hierarchical OU fetching
- `StartCompletenessAssessment(req AssessRequest) (taskID, error)` - Start assessment
- `AssessCompliance()` - Calculate present/missing elements per OU
- `GetCompletenessProgress(taskID)` - Progress polling
- `ExportResults(format string)` - JSON/CSV export

**Key Complexity:**
- Recursive OU tree traversal
- Large dataset processing (chunking, time-slicing)
- Compliance % calculation
- Export formatting

#### 3.4 Tracker Service (`internal/services/tracker/`)
**Python Source:** `app/routes/tracker.py`

**Required Methods:**
- `ListEventPrograms()` - List available event programs
- `TransferEvents(req EventTransferRequest) (taskID, error)` - Bulk event transfer
- Multi-OU event fetching
- Progress tracking

**Key Complexity:**
- Event program metadata handling
- Multi-OU bulk operations
- Event payload transformation

#### 3.5 Scheduler Service (`internal/services/scheduler/`)
**Python Source:** `app/scheduler.py`

**Required Functionality:**
- Replace `APScheduler` with `robfig/cron/v3`
- Load jobs from `ScheduledJob` table on startup
- Execute jobs: completeness, transfer, metadata
- Update `last_run_at`, `next_run_at` in DB
- Support enable/disable, CRUD operations
- Timezone handling (default: UTC)

**Key Complexity:**
- Cron expression parsing
- Job state persistence
- Error handling and retry logic
- Integration with Transfer/Completeness services

---

## 📋 Phase 4: Frontend Migration (PENDING)

### Tasks
- [ ] Copy `static/js/app.js` → `frontend/src/js/app.js`
- [ ] Copy Bootstrap 5 CSS and templates
- [ ] Replace `fetch()` calls with Wails bindings (auto-generated)
- [ ] Replace polling with `EventsOn`/`EventsEmit` for real-time updates
- [ ] Migrate HTML templates to single `index.html` with sections
- [ ] Bind Go methods to frontend via Wails runtime

**Example Binding:**
```javascript
// OLD (FastAPI)
const profiles = await fetch('/api/profiles').then(r => r.json());

// NEW (Wails)
import { ListProfiles } from '../wailsjs/go/main/App.js';
const profiles = await ListProfiles();
```

---

## 📋 Phase 5: Background Tasks & Progress (PENDING)

### Tasks
- [ ] Implement `TaskManager` with goroutine-based execution
- [ ] Use channels for progress updates
- [ ] Emit events to frontend via `runtime.EventsEmit`
- [ ] Dual storage: DB + in-memory cache for task state
- [ ] Recovery mechanism for in-progress tasks after restart

---

## 📋 Phase 6: Application Features (PENDING)

### Tasks
- [ ] Native application menu (File, Edit, View, Help)
- [ ] System tray icon (optional)
- [ ] Preferences dialog
- [ ] Native file dialogs (export results, import mappings)
- [ ] Keyboard shortcuts

---

## 📋 Phase 7: Testing (PENDING)

### Tasks
- [ ] Unit tests for API client
- [ ] Unit tests for encryption
- [ ] Unit tests for services
- [ ] Integration tests for end-to-end workflows
- [ ] Manual testing on macOS/Windows/Linux

---

## 📋 Phase 8: Build & Distribution (PENDING)

### Tasks
- [ ] Configure `wails.json` for production
- [ ] Build for all platforms (darwin/amd64, darwin/arm64, windows/amd64, linux/amd64)
- [ ] Create installers (.dmg, .exe, .deb, .rpm)
- [ ] Code signing (macOS: Developer ID, Windows: Authenticode)
- [ ] GitHub releases workflow
- [ ] Auto-update configuration

---

## 📋 Phase 9: Documentation (PENDING)

### Tasks
- [ ] Archive web version to `legacy/` folder
- [ ] Update README for desktop app
- [ ] Create `BUILDING.md` (developer guide)
- [ ] User manual (PDF/web)
- [ ] API documentation (godoc)

---

## Project Statistics

**Lines of Code (Go):**
- `app.go`: ~65 lines
- `internal/models/`: ~90 lines (3 files)
- `internal/database/db.go`: ~85 lines
- `internal/crypto/encryption.go`: ~125 lines
- `internal/api/client.go`: ~165 lines
- **Total Core:** ~530 lines

**Estimated Remaining:**
- Service layer: ~2,500 lines (5 services)
- Frontend migration: ~500 lines (JS adaptation)
- Additional utilities: ~200 lines
- **Total Project:** ~3,730 lines

**Python Source (for reference):**
- `app/main.py`: ~800 lines
- `app/routes/*.py`: ~1,200 lines total
- `app/dhis2_api.py`: ~300 lines
- `app/scheduler.py`: ~100 lines
- `static/js/app.js`: ~450 lines
- **Total Python:** ~2,850 lines

**Migration Progress:** ~18% complete (infrastructure only)

---

## Environment Variables

**Required:**
```bash
ENCRYPTION_KEY="<base64-encoded-32-byte-key>"
DATABASE_URL="sqlite://./dhis2sync.db"  # Or postgresql://...
```

**Optional:**
```bash
LOG_LEVEL="DEBUG"  # Enable verbose GORM logging
```

---

## Next Steps (Immediate)

1. **Implement Transfer Service** (highest priority)
   - Port `transfer_data_with_mapping()` from Python
   - Implement background task execution with goroutines
   - Add progress tracking with events

2. **Implement Scheduler Service**
   - Integrate `robfig/cron/v3`
   - Load jobs from DB on startup
   - Wire up to Transfer/Completeness services

3. **Frontend Migration**
   - Start with profile management UI
   - Test Wails bindings with simple CRUD operations
   - Iterate to transfer/metadata/completeness UIs

---

## Known Issues / TODOs

1. **Encryption Migration Path**
   - Need migration script to re-encrypt existing Python Fernet passwords to Go AES-GCM
   - OR: Implement Fernet decryption in Go for backward compatibility

2. **Database Compatibility**
   - GORM auto-migration may create slightly different schemas than Alembic
   - Need to verify schema compatibility with existing SQLite/PostgreSQL databases

3. **WebSocket Removal**
   - Python version has WebSocket blocker middleware
   - Wails uses events instead - ensure no WebSocket dependencies in frontend

4. **Session Management**
   - Python uses FastAPI `SessionMiddleware` with HTTP cookies
   - Desktop app uses in-memory profile selection - simpler, no cookies needed

---

## Timeline Update

**Completed:** Phases 1-2 (2 weeks estimated, completed)
**Current:** Phase 3 (2 weeks estimated, in progress)
**Remaining:** Phases 4-9 (5 weeks estimated)
**Total:** 9 weeks (on track)
