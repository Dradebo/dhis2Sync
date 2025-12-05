# DHIS2 Data Exchange

![DHIS2 Sync Banner](https://img.shields.io/badge/DHIS2-Data_Exchange-blue?style=for-the-badge&logo=dhis2)
![License](https://img.shields.io/badge/license-MIT-green?style=for-the-badge)

**DHIS2 Data Exchange** is a comprehensive toolkit for synchronizing data and metadata between DHIS2 instances. This repository contains two distinct solutions tailored to different deployment needs:

1.  **🖥️ Desktop Application (Recommended)**: A modern, cross-platform native app for individual users.
2.  **🌐 Web Application**: A server-based solution for centralized, multi-user deployments.

---

## 🖥️ Solution 1: Desktop Application (Recommended)

> **Best for:** Individual data managers, offline use, and local security.

Built with **Wails (Go + JS)**, the desktop app offers a fast, secure, and native experience on macOS, Windows, and Linux.

### Key Features
- ✅ **Data Transfer**: Sync aggregate datasets with automatic element mapping
- ✅ **Completeness Assessment**: Analyze data quality and compliance across org units
- ✅ **Tracker/Events**: Transfer event programs between instances
- ✅ **Audit**: Pre-transfer metadata validation to prevent failures
- ✅ **Scheduled Jobs**: Automate recurring transfers with cron-based scheduling
- ✅ **Native Performance**: Single executable with lightweight footprint (~20MB)
- ✅ **Local Security**: Credentials stored encrypted on your device (AES-256-GCM)
- ✅ **Offline Capable**: Configure jobs and view history without internet
- ✅ **Cross-Platform**: Runs natively on macOS, Windows, and Linux

### Quick Start
```bash
# Download the latest release or build from source:
cd dhis2sync-desktop
wails build
```

[👉 Go to Desktop Documentation](./dhis2sync-desktop/README.md)

---

## 🌐 Solution 2: Web Application

> **Best for:** Centralized teams, cloud deployment (Railway/Docker), and shared access.

Built with **FastAPI (Python)** and **Vanilla JS**, this web application is designed for server deployments where multiple users need to access the same sync configuration.

### Key Features
- **Centralized**: Deploy once, access from anywhere via browser
- **Docker Ready**: Production-ready `Dockerfile` for easy containerization
- **Database Backed**: Uses PostgreSQL for robust job and profile storage
- **Scalable**: Designed for cloud environments like Railway or AWS
- **Multi-user**: Shared connection profiles and job history

### Quick Start
```bash
# Run locally with Python
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

---

## ⚖️ Which one should I use?

| Feature | 🖥️ Desktop App | 🌐 Web App |
| :--- | :--- | :--- |
| **Tech Stack** | Go (Wails) + JS | Python (FastAPI) + JS |
| **Deployment** | Install on laptop | Deploy to Server/Cloud |
| **User Base** | Single User | Team / Multi-user |
| **Security** | Local Encryption (AES-256-GCM) | Server-side DB |
| **Setup** | Download & Run | Requires Server/Docker |
| **Offline** | Yes | No |
| **Performance** | Native (20MB executable) | Web-based |
| **Auto-updates** | Planned | Manual deployment |

**Recommendation:** Use the **Desktop App** for individual use cases, and the **Web App** for team deployments requiring centralized access.

---

## 📁 Repository Structure

- **`dhis2sync-desktop/`**: Source code for the Wails/Go desktop application
  - `internal/services/`: Business logic (transfer, completeness, tracker, audit, scheduler)
  - `frontend/src/`: JavaScript frontend with Bootstrap 5
  - `build/`: Platform-specific build configurations
- **`app/`**: Source code for the FastAPI/Python web application
- **`static/`**: Frontend assets for the web application
- **`migrations/`**: Database migrations for the web application

---

## 🚀 Recent Updates

### Desktop Application
- ✅ All major features implemented and functional
- ✅ Optimized org unit picker for large hierarchies (60K+ units)
- ✅ Fixed completeness assessment results rendering
- ✅ Improved API client with connection pooling
- ✅ Real-time progress tracking with Wails events

### Web Application
- ⚠️ Maintenance mode - focus shifted to desktop app
- Legacy Python/FastAPI implementation available for reference

---

## 📄 License

Distributed under the MIT License. See `LICENSE` for more information.

---

## 🤝 Contributing

Contributions are welcome! Please see individual project READMEs for specific guidelines.

---

**Built with ❤️ for the DHIS2 community**
