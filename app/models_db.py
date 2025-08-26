import uuid
import datetime as dt
from sqlalchemy import Column, String, DateTime, Text, Boolean, Integer
from .db import Base


class ConnectionProfile(Base):
    __tablename__ = "connection_profiles"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    name = Column(String, unique=True, nullable=False)
    owner = Column(String, nullable=True)

    source_url = Column(String, nullable=False)
    source_username = Column(String, nullable=False)
    source_password_enc = Column(String, nullable=False)

    dest_url = Column(String, nullable=False)
    dest_username = Column(String, nullable=False)
    dest_password_enc = Column(String, nullable=False)

    created_at = Column(DateTime, default=dt.datetime.utcnow)
    updated_at = Column(DateTime, default=dt.datetime.utcnow, onupdate=dt.datetime.utcnow)


class ScheduledJob(Base):
    __tablename__ = "scheduled_jobs"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    name = Column(String, unique=True, nullable=False)
    job_type = Column(String, nullable=False)  # e.g., completeness, transfer, metadata
    cron = Column(String, nullable=False)      # cron expression
    timezone = Column(String, nullable=True, default="UTC")
    payload = Column(Text, nullable=True)      # JSON payload string
    enabled = Column(Boolean, default=True)
    last_run_at = Column(DateTime, nullable=True)
    next_run_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=dt.datetime.utcnow)
    updated_at = Column(DateTime, default=dt.datetime.utcnow, onupdate=dt.datetime.utcnow)


class TaskProgress(Base):
    __tablename__ = "task_progress"

    id = Column(String, primary_key=True)
    task_type = Column(String, nullable=False)  # e.g., transfer, completeness, bulk_completeness, metadata
    status = Column(String, nullable=False, default="starting")  # starting, running, completed, error
    progress = Column(Integer, nullable=False, default=0)  # 0-100
    messages = Column(Text, nullable=True)  # JSON array of strings
    results = Column(Text, nullable=True)   # JSON blob
    created_at = Column(DateTime, default=dt.datetime.utcnow)
    updated_at = Column(DateTime, default=dt.datetime.utcnow, onupdate=dt.datetime.utcnow)
