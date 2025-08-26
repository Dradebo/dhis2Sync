from fastapi import APIRouter, Request, BackgroundTasks, HTTPException
from fastapi.responses import JSONResponse
from typing import Dict, Any, Optional, List
import json
import time

from ..dhis2_api import Api
from ..conn_utils import resolve_connections
from ..db import SessionLocal
from ..models_db import TaskProgress

router = APIRouter(prefix="/tracker", tags=["tracker"])

# In-memory progress storage for quick polling
tracker_progress: Dict[str, Dict[str, Any]] = {}


def _save_progress(task_id: str, payload: dict, task_type: str = "tracker_transfer"):
    """Persist task progress to DB (TaskProgress)."""
    db = SessionLocal()
    try:
        row = db.query(TaskProgress).filter(TaskProgress.id == task_id).first()
        messages = payload.get("messages")
        result = payload.get("result") or payload.get("results")
        if not row:
            row = TaskProgress(
                id=task_id,
                task_type=task_type,
                status=payload.get("status", "starting"),
                progress=int(payload.get("progress", 0)),
                messages=json.dumps(messages) if isinstance(messages, list) else None,
                result=json.dumps(result) if result is not None else None,
            )
            db.add(row)
        else:
            row.status = payload.get("status", row.status)
            if "progress" in payload:
                row.progress = int(payload.get("progress", row.progress))
            if messages is not None:
                row.messages = json.dumps(messages)
            if result is not None:
                row.result = json.dumps(result)
        db.commit()
    finally:
        db.close()


def _load_progress(task_id: str) -> Optional[dict]:
    db = SessionLocal()
    try:
        row = db.query(TaskProgress).filter(TaskProgress.id == task_id).first()
        if not row:
            return None
        out = {
            "status": row.status,
            "progress": row.progress,
            "messages": json.loads(row.messages) if row.messages else [],
        }
        if row.result:
            try:
                out["result"] = json.loads(row.result)
            except Exception:
                out["result"] = None
        return out
    finally:
        db.close()


@router.get("/programs")
async def list_programs(request: Request, instance: str = "source", include_all: bool = True, q: str = ""):
    """List programs. Optionally filter to event-only (WITHOUT_REGISTRATION) if include_all=False. Supports search via q."""
    connections = resolve_connections(request)
    if not connections or instance not in connections:
        raise HTTPException(400, f"No connection configured for {instance}")

    api = Api(**connections[instance])
    resp = api.list_programs(params={"filter": f"displayName:ilike:{q}"} if q else None)
    if resp.status_code != 200:
        raise HTTPException(400, f"Failed to fetch programs: HTTP {resp.status_code}")
    body = resp.json() or {}
    programs = body.get("programs") or []

    if not include_all:
        programs = [p for p in programs if (p.get("programType") or "").upper() == "WITHOUT_REGISTRATION"]

    return {"programs": programs, "count": len(programs)}


@router.get("/program/{program_id}")
async def program_detail(request: Request, program_id: str, instance: str = "source"):
    connections = resolve_connections(request)
    if not connections or instance not in connections:
        raise HTTPException(400, f"No connection configured for {instance}")

    api = Api(**connections[instance])
    resp = api.program_detail(program_id)
    if resp.status_code != 200:
        raise HTTPException(400, f"Failed to fetch program detail: HTTP {resp.status_code}")
    return resp.json()


@router.post("/preview-events")
async def preview_events(request: Request):
    """Preview events for a program and org unit/date selection.
    Body: { instance, program_id, org_unit, start_date, end_date, program_stage?, status? }
    """
    data = await request.json()
    instance = data.get("instance") or "source"
    program_id = data.get("program_id")
    org_unit = data.get("org_unit")
    org_units = data.get("org_units") or []
    start_date = data.get("start_date")
    end_date = data.get("end_date")
    program_stage = data.get("program_stage")
    status = data.get("status")

    if not program_id or not start_date or not end_date:
        raise HTTPException(400, "program_id, start_date, end_date are required")
    # Allow multi-select org units; fallback to single
    if not org_units:
        if not org_unit:
            raise HTTPException(400, "org_unit or org_units[] required")
        org_units = [org_unit]

    connections = resolve_connections(request)
    if not connections or instance not in connections:
        raise HTTPException(400, f"No connection configured for {instance}")

    api = Api(**connections[instance])

    # Page through events with a soft cap for preview
    preview_cap = int(data.get("preview_cap", 1000))
    page_size = min(int(data.get("page_size", 200)), 500)
    total_collected = 0
    sample: List[dict] = []

    for ou in org_units:
        page = 1
        while total_collected < preview_cap:
            resp = api.list_events(
                program_id=program_id,
                org_unit=ou,
                start_date=start_date,
                end_date=end_date,
                program_stage=program_stage,
                status=status,
                page=page,
                page_size=page_size,
            )
            if resp.status_code != 200:
                break
            payload = resp.json() or {}
            events = payload.get("events", [])
            if not events:
                break
            total_collected += len(events)
            if len(sample) < 5:
                sample.extend(events[: max(0, 5 - len(sample))])

            pager = payload.get("pager") or {}
            page_count = int(pager.get("pageCount") or 1)
            if page >= page_count:
                break
            page += 1

    return {
        "program_id": program_id,
        "org_units": org_units,
        "start_date": start_date,
        "end_date": end_date,
        "estimate_total": total_collected,
        "sample": sample,
    }


@router.post("/transfer-bg")
async def transfer_events_background(request: Request, background_tasks: BackgroundTasks):
    """Start background transfer of events from source to dest.
    Body: { source_instance, dest_instance, program_id, org_unit, start_date, end_date, program_stage?, status?, dry_run? }
    Returns: { task_id }
    """
    data = await request.json()
    source_instance = (data.get("source_instance") or "source").strip()
    dest_instance = (data.get("dest_instance") or "dest").strip()
    program_id = data.get("program_id")
    org_unit = data.get("org_unit")
    org_units = data.get("org_units") or []
    start_date = data.get("start_date")
    end_date = data.get("end_date")
    program_stage = data.get("program_stage")
    status = data.get("status")
    dry_run = bool(data.get("dry_run", False))
    # Resilience knobs
    batch_size = int(data.get("batch_size", 200))
    max_pages = int(data.get("max_pages", 500))
    max_runtime_seconds = int(data.get("max_runtime_seconds", 60 * 25))  # default 25 minutes

    if not program_id or not start_date or not end_date:
        raise HTTPException(400, "program_id, start_date, end_date are required")
    if not org_units:
        if not org_unit:
            raise HTTPException(400, "org_unit or org_units[] required")
        org_units = [org_unit]

    connections = resolve_connections(request)
    if not connections or source_instance not in connections or dest_instance not in connections:
        raise HTTPException(400, "Source and destination connections must be configured")

    task_id = f"trk_{len(tracker_progress)}"
    tracker_progress[task_id] = {
        "status": "starting",
        "progress": 0,
        "messages": ["Starting tracker event transfer..."],
    }
    _save_progress(task_id, tracker_progress[task_id], task_type="tracker_transfer")

    background_tasks.add_task(
        _run_event_transfer,
        task_id,
        connections[source_instance],
        connections[dest_instance],
        program_id,
        org_units,
        start_date,
        end_date,
        program_stage,
        status,
        dry_run,
        batch_size,
        max_pages,
        max_runtime_seconds,
    )

    return {"task_id": task_id, "status": "started"}


def _minimal_event(event: dict) -> dict:
    """Transform a source event to a minimal payload acceptable by DHIS2 POST /api/events.
    Drops identifiers and immutable fields."""
    allowed_keys = {
        "program",
        "orgUnit",
        "programStage",
        "eventDate",
        "dueDate",
        "status",
        "dataValues",
        "coordinate",
        "geometry",
        "completedDate",
        "attributeOptionCombo",
        "notes",
    }
    out = {k: v for k, v in event.items() if k in allowed_keys}
    # Ensure programStage present if available in source
    if not out.get("programStage") and event.get("programStage"):
        out["programStage"] = event.get("programStage")
    # Filter dataValues to core keys
    dvs = out.get("dataValues") or []
    cleaned = []
    for dv in dvs:
        cleaned.append({k: v for k, v in dv.items() if k in {"dataElement", "value", "providedElsewhere"}})
    if cleaned:
        out["dataValues"] = cleaned
    return out


def _run_event_transfer(
    task_id: str,
    source_conn: dict,
    dest_conn: dict,
    program_id: str,
    org_units: List[str],
    start_date: str,
    end_date: str,
    program_stage: Optional[str],
    status: Optional[str],
    dry_run: bool,
    batch_size: int,
    max_pages: int,
    max_runtime_seconds: int,
):
    try:
        progress = tracker_progress[task_id]
        progress["status"] = "running"
        _save_progress(task_id, progress)

        src = Api(**source_conn)
        dst = Api(**dest_conn)

        page_size = max(50, min(batch_size, 500))
        total_fetched = 0
        total_sent = 0
        batches_sent = 0
        start_ts = time.time()

        for idx, org_unit in enumerate(org_units, start=1):
            progress.setdefault("messages", []).append(f"Processing OU {idx}/{len(org_units)}: {org_unit}")
            if len(progress["messages"]) > 500:
                progress["messages"] = progress["messages"][-500:]
            _save_progress(task_id, progress)
            page = 1
            while page <= max_pages:
                # Respect max runtime to avoid worker starvation
                if time.time() - start_ts > max_runtime_seconds:
                    progress["messages"].append("Max runtime reached; finishing early with partial results")
                    progress["status"] = "completed"
                    progress["result"] = {
                        "total_fetched": total_fetched,
                        "total_sent": total_sent,
                        "batches_sent": batches_sent,
                        "dry_run": dry_run,
                        "partial": True,
                    }
                    _save_progress(task_id, progress)
                    return
                resp = src.list_events(
                    program_id=program_id,
                    org_unit=org_unit,
                    start_date=start_date,
                    end_date=end_date,
                    program_stage=program_stage,
                    status=status,
                    page=page,
                    page_size=page_size,
                )
                if resp.status_code != 200:
                    progress["messages"].append(f"Fetch failed for {org_unit} page {page}: HTTP {resp.status_code}")
                    break
                payload = resp.json() or {}
                events = payload.get("events", [])
                if not events:
                    break
                total_fetched += len(events)

                transformed = [_minimal_event(e) for e in events]
                if dry_run:
                    progress["messages"].append(f"Dry-run: would send {len(transformed)} events (OU {org_unit}, page {page})")
                else:
                    chunk = batch_size
                    for i in range(0, len(transformed), chunk):
                        batch = transformed[i : i + chunk]
                        resp2 = dst.post_events_batch({"events": batch})
                        if resp2.status_code in (200, 201):
                            total_sent += len(batch)
                            batches_sent += 1
                            progress["messages"].append(
                                f"✓ Sent {len(batch)} events (OU {org_unit}, batch {batches_sent}, page {page})"
                            )
                        else:
                            progress["messages"].append(
                                f"✗ Failed to send batch (OU {org_unit}, page {page}) HTTP {resp2.status_code}: {resp2.text[:200]}"
                            )

                # Update progress
                progress["progress"] = min(95, progress.get("progress", 0) + 2)
                # Trim messages to avoid memory growth
                if len(progress.get("messages", [])) > 500:
                    progress["messages"] = progress["messages"][-500:]
                _save_progress(task_id, progress)
                # Yield a little to avoid starving loop
                time.sleep(0.01)

                pager = payload.get("pager") or {}
                page_count = int(pager.get("pageCount") or 1)
                if page >= page_count:
                    break
                page += 1

        progress["status"] = "completed"
        progress["progress"] = 100
        progress["result"] = {
            "total_fetched": total_fetched,
            "total_sent": total_sent,
            "batches_sent": batches_sent,
            "dry_run": dry_run,
        }
        progress["messages"].append(
            f"Done. Fetched {total_fetched} events, sent {total_sent} across {batches_sent} batches"
        )
        _save_progress(task_id, progress)
    except Exception as e:
        p = tracker_progress.get(task_id, {})
        p["status"] = "error"
        p.setdefault("messages", []).append(f"Error: {str(e)}")
        tracker_progress[task_id] = p
        _save_progress(task_id, p)


@router.get("/progress/{task_id}")
async def get_tracker_progress(task_id: str):
    if task_id not in tracker_progress:
        db_payload = _load_progress(task_id)
        if db_payload is None:
            raise HTTPException(404, "Task not found")
        return db_payload
    return tracker_progress[task_id]


