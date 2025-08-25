import uuid
import datetime as dt
from sqlalchemy import Column, String, DateTime
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


