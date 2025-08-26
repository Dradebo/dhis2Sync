import json
from typing import Any, Dict
from fastapi import APIRouter, HTTPException

from ..db import SessionLocal
from ..models_db import ScheduledJob
from ..scheduler import reschedule_job
from apscheduler.triggers.cron import CronTrigger
from datetime import datetime, timezone
import pytz


router = APIRouter(prefix="/schedules", tags=["schedules"])


@router.get("")
async def list_schedules():
    db = SessionLocal()
    try:
        rows = db.query(ScheduledJob).order_by(ScheduledJob.created_at.desc()).all()
        out = []
        for r in rows:
            # Compute next run preview using cron
            next_run_str = None
            try:
                tz = r.timezone or "UTC"
                trigger = CronTrigger.from_crontab(r.cron, timezone=tz)
                now = datetime.now(pytz.timezone(tz))
                nxt = trigger.get_next_fire_time(None, now)
                if nxt:
                    next_run_str = nxt.astimezone(timezone.utc).isoformat()
            except Exception:
                next_run_str = None
            out.append({
                "id": r.id,
                "name": r.name,
                "job_type": r.job_type,
                "cron": r.cron,
                "timezone": r.timezone,
                "enabled": r.enabled,
                "last_run_at": r.last_run_at.isoformat() if r.last_run_at else None,
                "next_run": next_run_str or (r.next_run_at.isoformat() if r.next_run_at else None),
                "created_at": r.created_at.isoformat(),
                "updated_at": r.updated_at.isoformat(),
            })
        return out
    finally:
        db.close()


@router.post("")
async def upsert_schedule(item: Dict[str, Any]):
    required = ["name", "job_type", "cron"]
    for k in required:
        if not item.get(k):
            raise HTTPException(400, f"{k} is required")

    db = SessionLocal()
    try:
        row = db.query(ScheduledJob).filter(ScheduledJob.name == item["name"]).first()
        if not row:
            row = ScheduledJob(name=item["name"], job_type=item["job_type"], cron=item["cron"])
            db.add(row)
        row.cron = item["cron"]
        row.job_type = item["job_type"]
        row.timezone = item.get("timezone") or "UTC"
        row.enabled = bool(item.get("enabled", True))
        payload = item.get("payload")
        try:
            # Accept dict and stringify; accept string as-is
            row.payload = json.dumps(payload) if isinstance(payload, (dict, list)) else (payload or "")
        except Exception:
            row.payload = ""
        # Compute and store next_run_at preview in UTC
        try:
            trigger = CronTrigger.from_crontab(row.cron, timezone=row.timezone or "UTC")
            now = datetime.now(pytz.timezone(row.timezone or "UTC"))
            nxt = trigger.get_next_fire_time(None, now)
            row.next_run_at = nxt.astimezone(timezone.utc) if nxt else None
        except Exception:
            row.next_run_at = None
        db.commit()
        db.refresh(row)
        # Reschedule in APScheduler
        reschedule_job(row.id)
        return {"id": row.id, "updated": True}
    finally:
        db.close()


@router.delete("/{job_id}")
async def delete_schedule(job_id: str):
    db = SessionLocal()
    try:
        row = db.query(ScheduledJob).filter(ScheduledJob.id == job_id).first()
        if not row:
            raise HTTPException(404, "Schedule not found")
        db.delete(row)
        db.commit()
        return {"deleted": True}
    finally:
        db.close()


