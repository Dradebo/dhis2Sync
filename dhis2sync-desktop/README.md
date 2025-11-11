# DHIS2 Sync Desktop

Cross-platform desktop application for synchronizing health data between DHIS2 (District Health Information System 2) instances.

**⚠️ WORK IN PROGRESS:** This is a migration of the [dhis2Sync web application](../README.md) to a native desktop application using Go and Wails. See [PROGRESS.md](./PROGRESS.md) for current status.

## Features (Planned)

- **Data Transfer**: Sync aggregate datasets between instances with element mapping
- **Metadata Assessment**: Compare and sync metadata (data elements, categories, org units)
- **Completeness Assessment**: Analyze data element compliance across organization units
- **Tracker/Events**: Transfer event programs between instances
- **Scheduled Jobs**: Automate recurring transfers and assessments
- **Native Desktop Experience**:
  - Single executable (no browser required)
  - System tray integration
  - Native file dialogs
  - Offline-capable
  - Auto-updates

## Technology Stack

- **Backend**: Go 1.24+ with Wails v2
- **Frontend**: Vanilla JavaScript (ported from web version)
- **Database**: SQLite (dev) / PostgreSQL (prod) with GORM
- **Task Processing**: Goroutines + channels for background jobs
- **Scheduler**: robfig/cron for recurring operations
- **Security**: AES-256-GCM encryption for stored credentials

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
│   ├── services/              # Business logic (Transfer, Metadata, Completeness, Tracker, Scheduler)
│   └── utils/                 # Helper functions
├── frontend/
│   ├── src/                   # Frontend source (HTML, JS, CSS)
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

## Development Status

**Current Phase:** Phase 2 - Core Infrastructure (Complete) ✅

**Completed:**
- ✅ Project initialization with Wails
- ✅ GORM models (ConnectionProfile, ScheduledJob, TaskProgress)
- ✅ Database layer (SQLite + PostgreSQL support)
- ✅ AES-256-GCM encryption (ported from Python Fernet)
- ✅ DHIS2 API client with retry logic
- ✅ Application lifecycle (startup/shutdown hooks)
- ✅ Build verification (21MB single executable)

**In Progress:**
- 🚧 Service layer migration (Transfer, Metadata, Completeness, Tracker, Scheduler)

**Pending:**
- ⏳ Frontend migration (Vanilla JS with Wails bindings)
- ⏳ Background task management (goroutines + events)
- ⏳ Native UI features (menus, tray, dialogs)
- ⏳ Testing & quality assurance
- ⏳ Multi-platform build & distribution

See [PROGRESS.md](./PROGRESS.md) for detailed tracking.

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

- Issues: [GitHub Issues](https://github.com/yourusername/dhis2Sync/issues)
- Documentation: [Wiki](https://github.com/yourusername/dhis2Sync/wiki)
- Parent Web App: [../README.md](../README.md)

---

**Developed with ❤️ using Wails**
