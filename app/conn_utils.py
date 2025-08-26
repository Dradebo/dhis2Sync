import os
from typing import Dict
from fastapi import HTTPException, Request
from cryptography.fernet import Fernet
from .db import SessionLocal
from .models_db import ConnectionProfile


def _get_cipher() -> Fernet:
    key = os.environ.get("ENCRYPTION_KEY")
    if not key:
        raise HTTPException(500, "ENCRYPTION_KEY not configured")
    return Fernet(key)


def load_connections_from_profile(profile_id: str) -> Dict[str, Dict[str, str]]:
    db = SessionLocal()
    try:
        item = db.query(ConnectionProfile).filter(ConnectionProfile.id == profile_id).first()
        if not item:
            raise HTTPException(404, "Profile not found")
        cipher = _get_cipher()
        return {
            "source": {
                "url": item.source_url,
                "username": item.source_username,
                "password": cipher.decrypt(item.source_password_enc.encode()).decode(),
            },
            "dest": {
                "url": item.dest_url,
                "username": item.dest_username,
                "password": cipher.decrypt(item.dest_password_enc.encode()).decode(),
            },
        }
    finally:
        db.close()


def resolve_connections(request: Request) -> Dict[str, Dict[str, str]]:
    env = (os.environ.get("ENVIRONMENT") or "development").lower()
    profile_id = request.session.get("profile_id")
    if profile_id:
        return load_connections_from_profile(profile_id)
    # Dev fallback for older sessions
    if env != "production":
        existing = request.session.get("connections")
        if existing:
            return existing
    raise HTTPException(400, "No DHIS2 connections found. Please load a profile.")


