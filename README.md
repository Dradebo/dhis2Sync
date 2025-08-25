# DHIS2 Data Exchange (Railway Deployment)

A deployment-ready FastAPI + Jinja app for DHIS2 data exchange, metadata sync, and completeness assessment.

## ✨ Highlights

- FastAPI backend, Bootstrap + Vanilla JS frontend
- Data transfer (dataset → periods → org units) with progress polling
- Metadata assessment, mapping suggestions, dry-run + apply
- Completeness assessment with OU tree, period picker, detailed results, and exports
- Connection profiles stored securely (SQLAlchemy + Fernet encryption)
- Health (`/healthz`) and readiness (`/ready`) endpoints

## 📦 Folder Contents

- `app/` – FastAPI app, routers, templates, models, DB
- `static/` – JS, manifest, service worker, icons
- `migrations/`, `alembic.ini` – Alembic migrations
- `requirements.txt` – Pinned dependencies
- `Dockerfile` – Production container image (uvicorn)

## 🚀 Deploy on Railway

1) Create a new GitHub repo and add this `RailwayDeployment/` folder at the repo root (or set service root to this folder in Railway)

2) In Railway:
- New Service → Deploy from GitHub → select your repo
- Set the service root to `RailwayDeployment/` (Service → Settings → Build)
- Add Variables:
  - `DATABASE_URL` (from Railway Postgres plugin)
  - `ENCRYPTION_KEY` (32-byte base64; generate below)
  - Optional: `LOG_LEVEL=info`, `PORT=8000`
- Deploy → open `/ready` to confirm DB connectivity

Generate `ENCRYPTION_KEY` (macOS/Linux):
```bash
python - <<'PY'
from cryptography.fernet import Fernet
print(Fernet.generate_key().decode())
PY
```

## ⚙️ Environment

- `DATABASE_URL`  e.g. `postgresql+psycopg2://USER:PASS@HOST:5432/DB`
- `ENCRYPTION_KEY`  base64 fernet key
- Optional: `SECRET_KEY`, `ENVIRONMENT`, `LOG_LEVEL`, `HOST`, `PORT`

## 🧭 Features Overview

### Transfer
- Pick dataset → preview period options → select org units
- Direct sync when compatible; mapping otherwise
- Live progress under Transfers

### Metadata
- Assess: Missing | Conflicts | Suggestions
- Suggest mappings (UID, code, name)
- Build minimal, dependency-aware payloads
- Dry-run, then apply; friendly import report view

### Completeness
- Dataset dropdown + period picker by `periodType`
- OU tree with expand/collapse; alphabetical sorting
- Data elements list with search, pagination, A→Z ordering
- Results table with badges and a “View” modal:
  - Summary: compliance %, present/required
  - Present and Missing elements (searchable)
- Background assessment with progress polling
- Export JSON/CSV

## 🛠 Local Run (optional)

```bash
cd RailwayDeployment
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
export DATABASE_URL="sqlite:///./app.db"
export ENCRYPTION_KEY="$(python - <<'PY'
from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())
PY)"
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```
- Check `http://localhost:8000/ready`

## 🗃 Migrations (optional)

```bash
cd RailwayDeployment
alembic revision -m "init schema" --autogenerate
alembic upgrade head
```

## 🧪 Health/Readiness
- `GET /healthz` → `{ "status": "ok" }`
- `GET /ready` → `{ "ready": true }` when DB reachable

## 🧰 Notes
- Keep secrets in Railway Variables; do not commit `.env`
- App auto-creates tables on first run; introduce Alembic as needed
- If deploying subfolder, ensure Railway builds from `RailwayDeployment/`
