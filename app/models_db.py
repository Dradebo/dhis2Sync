import uuid
import datetime as dt
from sqlalchemy import Column, String, DateTime, Text, Boolean
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
    job_type = Column(String, nullable=False)  # 'transfer' | 'completeness'
    cron = Column(String, nullable=False)
    timezone = Column(String, nullable=True, default="UTC")
    enabled = Column(Boolean, default=True)
    payload = Column(Text, nullable=True)  # JSON string
    last_run_at = Column(DateTime, nullable=True)
    next_run_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=dt.datetime.utcnow)
    updated_at = Column(DateTime, default=dt.datetime.utcnow, onupdate=dt.datetime.utcnow)

