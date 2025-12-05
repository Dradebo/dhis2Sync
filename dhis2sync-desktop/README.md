# DHIS2 Sync Desktop

Cross-platform desktop application for synchronizing health data between DHIS2 (District Health Information System 2) instances.

## Features

- **✅ Data Transfer**: Sync aggregate datasets between instances with element mapping
- **✅ Completeness Assessment**: Analyze data element compliance across organization units
- **✅ Tracker/Events**: Transfer event programs between instances  
- **✅ Audit**: Pre-transfer metadata validation to identify missing elements
- **✅ Scheduled Jobs**: Automate recurring transfers and assessments
- **✅ Native Desktop Experience**:
  - Single executable (no browser required)
  - Encrypted credential storage (AES-256-GCM)
  - Offline-capable configuration
  - Cross-platform (macOS, Windows, Linux)

## Technology Stack

- **Backend**: Go 1.24+ with Wails v2
- **Frontend**: Vanilla JavaScript with Bootstrap 5
- **Database**: SQLite (dev) / PostgreSQL (prod) with GORM
- **Task Processing**: Goroutines + channels for background jobs
- **Scheduler**: robfig/cron for recurring operations
- **Security**: AES-256-GCM encryption for stored credentials
- **API Client**: Resty with connection pooling and retry logic

## Quick Start

### Prerequisites

- Go 1.24 or higher
- Node.js 20+ and npm
- Wails CLI v2.10.2+
- Platform-specific dependencies:
  - **macOS**: Xcode Command Line Tools
  - **Windows**: WebView2 (usually pre-installed on Windows 10+)
  - **Linux**: `gtk3` and `webkit2gtk`

### Installation

```bash
# Install Wails CLI
go install github.com/wailsapp/wails/v2/cmd/wails@latest

# Clone repository
cd dhis2sync-desktop

# Install dependencies
go mod download
cd frontend && npm install && cd ..
```

### Development

```bash
# Set required environment variables
export ENCRYPTION_KEY="$(openssl rand -base64 32)"
export DATABASE_URL="sqlite://./dhis2sync.db"

# Run in development mode with hot reload
wails dev
```

### Build

```bash
# Build for current platform
wails build

# Cross-compile for other platforms
wails build -platform darwin/amd64        # macOS Intel
wails build -platform darwin/arm64        # macOS Apple Silicon
wails build -platform darwin/universal    # macOS Universal
wails build -platform windows/amd64       # Windows 64-bit
wails build -platform linux/amd64         # Linux 64-bit
```

## Project Structure

```
dhis2sync-desktop/
├── main.go                    # Application entry point
├── app.go                     # Main app struct with Wails bindings
├── wails.json                 # Wails configuration
├── internal/
│   ├── api/                   # DHIS2 API client (resty-based)
│   ├── database/              # GORM database layer
│   ├── models/                # Data models (ConnectionProfile, ScheduledJob, TaskProgress)
│   ├── crypto/                # AES-256-GCM encryption utilities
│   ├── services/              # Business logic
│   │   ├── transfer/          # Data transfer service
│   │   ├── completeness/      # Completeness assessment
│   │   ├── tracker/           # Tracker/event transfer
│   │   ├── audit/             # Metadata audit
│   │   ├── scheduler/         # Job scheduling
│   │   └── metadata/          # Metadata operations
│   └── utils/                 # Helper functions
├── frontend/
│   ├── src/                   # Frontend source (HTML, JS, CSS)
│   │   ├── main.js            # Main application logic
│   │   ├── components/        # Reusable components
│   │   │   ├── org-unit-tree.js      # Org unit picker with batch loading
│   │   │   ├── data-element-picker.js # Data element selector
│   │   │   └── scheduler.js          # Job scheduler UI
│   │   ├── progress-tracker.js       # Real-time progress tracking
│   │   ├── audit.js           # Audit module
│   │   └── utils/             # Frontend utilities
│   ├── dist/                  # Built frontend assets
│   └── wailsjs/               # Auto-generated Wails bindings
└── build/                     # Build configurations per platform
```

## Environment Variables

### Required

```bash
ENCRYPTION_KEY="<base64-32-byte-key>"  # Generate with: openssl rand -base64 32
DATABASE_URL="sqlite://./dhis2sync.db" # Or postgresql://user:pass@host:5432/db
```

### Optional

```bash
LOG_LEVEL="DEBUG"              # Enable verbose logging (default: INFO)
```

## Key Features

### 1. Data Transfer
- Transfer aggregate data between DHIS2 instances
- Automatic data element mapping
- Org unit selection with hierarchical tree picker (batch loading for 60K+ units)
- Period selection with quick presets
- Dry-run mode for validation
- Real-time progress tracking
- Mark datasets as complete after transfer

### 2. Completeness Assessment
- Assess data completeness across organization units
- Configurable compliance thresholds
- Period-based analysis
- Data element filtering
- Export results (JSON/CSV)
- Visual compliance reporting

### 3. Tracker/Event Transfer
- Transfer tracker events between instances
- Program and event type selection
- Date range filtering
- Org unit scoping

### 4. Audit
- Pre-transfer metadata validation
- Identify missing data elements, categories, and org units
- Detailed mismatch reporting
- Prevent transfer failures

### 5. Scheduled Jobs
- Automate recurring transfers and assessments
- Cron-based scheduling
- Job history and monitoring
- Enable/disable jobs dynamically

## Recent Improvements

- ✅ **Org Unit Picker**: Optimized batch loading for large hierarchies (63K+ units)
- ✅ **Completeness Tab**: Fixed results rendering and data structure handling
- ✅ **Progress Tracking**: Real-time event-based updates using Wails runtime
- ✅ **Connection Pooling**: Improved API client performance with connection reuse
- ✅ **Credential Security**: AES-256-GCM encryption with PBKDF2 key derivation

## Migration from Web Version

This desktop application is a complete rewrite of the [FastAPI/Python web application](../README.md) using Go for the backend and Wails for the desktop integration. Key differences:

| Aspect | Web Version | Desktop Version |
|--------|-------------|-----------------|
| **Backend** | Python 3.11 + FastAPI + Uvicorn | Go 1.24 + Wails v2 |
| **Frontend** | Vanilla JS + Jinja2 templates | Vanilla JS (ported) |
| **Database** | SQLAlchemy ORM | GORM ORM |
| **Encryption** | Fernet (symmetric) | AES-256-GCM |
| **Scheduler** | APScheduler | robfig/cron |
| **Deployment** | Docker / Railway / EC2 | Single executable |
| **Distribution** | Web server required | Standalone app (Windows/macOS/Linux) |
| **Updates** | Manual deployment | Auto-update (planned) |

**Backward Compatibility:**
- Database schema is compatible (with minor adjustments)
- Credentials may need re-encryption (Fernet → AES-GCM migration script planned)

## Contributing

See parent project [CONTRIBUTING.md](../CONTRIBUTING.md) for guidelines.

## License

See parent project [LICENSE](../LICENSE).

## Support

- Issues: [GitHub Issues](https://github.com/Dradebo/dhis2Sync/issues)
- Parent Web App: [../README.md](../README.md)

---

**Developed with ❤️ using Wails**
