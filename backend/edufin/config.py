"""Settings, read from the environment (and from backend/.env if present)."""
import os
import secrets
from pathlib import Path

from dotenv import load_dotenv

BACKEND_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BACKEND_DIR / ".env")


def load_config() -> dict:
    secret = os.getenv("JWT_SECRET", "").strip()
    generated = False
    if not secret:
        # No secret configured: make one up for this run so the app still starts.
        # Everyone is signed out whenever the server restarts.
        secret = secrets.token_hex(32)
        generated = True
    return {
        "JWT_SECRET": secret,
        "JWT_SECRET_GENERATED": generated,
        "MONGO_URI": os.getenv("MONGO_URI", "mongodb://localhost:27017/edufin"),
        "DB_MODE": os.getenv("EDUFIN_DB", "mongo").strip().lower(),
        "GOOGLE_CLIENT_ID": os.getenv("GOOGLE_CLIENT_ID", "").strip(),
        "CORS_ORIGINS": [o.strip() for o in os.getenv("CORS_ORIGINS", "").split(",") if o.strip()],
        "STARTING_CASH": 100_000,  # virtual rupees every new account gets for paper trading
        "FRONTEND_DIST": BACKEND_DIR.parent / "frontend" / "dist",
    }
