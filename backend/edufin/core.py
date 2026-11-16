"""Shared helpers: errors, validation, dates, login tokens and the coin ledger."""
import math
import re
from datetime import date as date_cls
from datetime import datetime, timedelta, timezone
from functools import wraps

import bcrypt
import jwt
from bson import ObjectId
from bson.errors import InvalidId
from flask import current_app, g, request

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
LEVELS = [("Basic", 0), ("Silver", 2500), ("Gold", 10000)]  # by lifetime coins earned


class ApiError(Exception):
    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.message = message
        self.status = status


def db():
    return current_app.extensions["edufin_db"]


def now() -> datetime:
    return datetime.now(timezone.utc)


def iso(value):
    if value is None:
        return None
    if value.tzinfo is None:  # MongoDB hands back naive UTC datetimes
        value = value.replace(tzinfo=timezone.utc)
    return value.isoformat()


def oid(value) -> ObjectId:
    """MongoDB ids are ObjectIds, not strings. A malformed id is simply 'not found'."""
    try:
        return ObjectId(value)
    except (InvalidId, TypeError):
        raise ApiError("Not found", 404)


# ---------- request parsing ----------

def body() -> dict:
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        raise ApiError("Send the request as JSON")
    return data


def text(data: dict, key: str, label: str, lo: int = 1, hi: int = 80) -> str:
    value = data.get(key)
    if not isinstance(value, str) or not (lo <= len(value.strip()) <= hi):
        if lo == hi:
            raise ApiError(f"{label} must be {lo} characters")
        raise ApiError(f"{label} must be {lo} to {hi} characters")
    return value.strip()


def number(data: dict, key: str, label: str, lo: float, hi: float) -> float:
    value = data.get(key)
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ApiError(f"{label} must be a number")
    if not (lo <= value <= hi):
        raise ApiError(f"{label} must be between {lo:g} and {hi:g}")
    return value


def choice(data: dict, key: str, label: str, options):
    value = data.get(key)
    if value not in options:
        raise ApiError(f"{label} must be one of: {', '.join(options)}")
    return value


def email_of(data: dict) -> str:
    value = data.get("email")
    if not isinstance(value, str) or not EMAIL_RE.match(value.strip()) or len(value) > 254:
        raise ApiError("Enter a valid email address")
    return value.strip().lower()


def password_of(data: dict, key: str = "password") -> str:
    value = data.get(key)
    # bcrypt only reads the first 72 bytes, so longer passwords are refused rather than truncated
    if not isinstance(value, str) or len(value) < 8 or len(value.encode()) > 72:
        raise ApiError("Password must be 8 to 72 characters")
    return value


def phone_of(data: dict) -> str:
    value = data.get("phone") or ""
    if not isinstance(value, str):
        raise ApiError("Enter a valid phone number")
    value = value.strip()
    if value and not (re.fullmatch(r"[+\d][\d\s-]*", value) and 7 <= len(re.sub(r"\D", "", value)) <= 15):
        raise ApiError("Enter a valid phone number")
    return value


# ---------- dates ----------
# "Today" depends on where the user is, so the browser sends its local date.

def req_date(source: dict | None = None) -> str:
    raw = (source or {}).get("date") or request.args.get("date")
    today = now().date()
    if not raw:
        return today.isoformat()
    try:
        day = date_cls.fromisoformat(str(raw))
    except ValueError:
        raise ApiError("date must look like 2026-01-31")
    if day > today + timedelta(days=1):
        raise ApiError("That date is in the future")
    return day.isoformat()


def require_today(day: str) -> None:
    """Earning actions only apply to the current day (±1 day covers every timezone)."""
    if abs((date_cls.fromisoformat(day) - now().date()).days) > 1:
        raise ApiError("Past days can be viewed but not changed", 409)


# ---------- passwords and tokens ----------

def hash_password(password: str) -> bytes:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt())


def check_password(password, hashed) -> bool:
    if not isinstance(password, str) or not hashed or len(password.encode()) > 72:
        return False
    return bcrypt.checkpw(password.encode(), bytes(hashed))


def make_token(user: dict, remember: bool = False) -> str:
    lifetime = timedelta(days=30) if remember else timedelta(hours=12)
    payload = {
        "sub": str(user["_id"]),
        "pv": user.get("password_version", 0),  # changing the password signs out old tokens
        "iat": now(),
        "exp": now() + lifetime,
    }
    return jwt.encode(payload, current_app.config["JWT_SECRET"], algorithm="HS256")


def login_required(view):
    @wraps(view)
    def wrapper(*args, **kwargs):
        header = request.headers.get("Authorization", "")
        if not header.startswith("Bearer "):
            raise ApiError("Sign in to continue", 401)
        try:
            claims = jwt.decode(header[7:], current_app.config["JWT_SECRET"], algorithms=["HS256"])
            user = db().users.find_one({"_id": ObjectId(claims["sub"])})
        except (jwt.PyJWTError, InvalidId, KeyError):
            raise ApiError("Your session has expired. Sign in again.", 401)
        if not user or user.get("password_version", 0) != claims.get("pv", 0):
            raise ApiError("Your session has expired. Sign in again.", 401)
        g.user = user
        return view(*args, **kwargs)

    return wrapper


def level_of(lifetime: int) -> dict:
    name, nxt = LEVELS[0][0], None
    for i, (label, need) in enumerate(LEVELS):
        if lifetime >= need:
            name = label
            nxt = LEVELS[i + 1] if i + 1 < len(LEVELS) else None
    return {"name": name, "next": {"name": nxt[0], "at": nxt[1]} if nxt else None}


def public_user(user: dict) -> dict:
    return {
        "id": str(user["_id"]),
        "username": user["username"],
        "email": user["email"],
        "phone": user.get("phone", ""),
        "avatar": user.get("avatar"),
        "coins": user.get("coins", 0),
        "lifetime_coins": user.get("lifetime_coins", 0),
        "cash": user.get("cash_paise", 0) / 100,
        "level": level_of(user.get("lifetime_coins", 0)),
        "has_password": bool(user.get("password_hash")),
        "created_at": iso(user.get("created_at")),
    }


def fresh_user() -> dict:
    return db().users.find_one({"_id": g.user["_id"]})


# ---------- coin ledger ----------
# Every change to a coin balance is written to the ledger, so balances can be explained.

EARNING_KINDS = ("task", "task_undo", "budget")


def _log(user_id, amount: int, kind: str, note: str, day: str) -> None:
    db().ledger.insert_one(
        {"user_id": user_id, "amount": amount, "kind": kind, "note": note, "date": day, "ts": now()}
    )


def award(user_id, amount: int, kind: str, note: str, day: str) -> None:
    if amount <= 0:
        return
    db().users.update_one({"_id": user_id}, {"$inc": {"coins": amount, "lifetime_coins": amount}})
    _log(user_id, amount, kind, note, day)


def spend(user_id, amount: int, kind: str, note: str, day: str, *, undo_earning: bool = False) -> bool:
    """Take coins only if the balance covers it. The check and the update are one atomic step."""
    change = {"coins": -amount}
    if undo_earning:
        change["lifetime_coins"] = -amount
    updated = db().users.find_one_and_update(
        {"_id": user_id, "coins": {"$gte": amount}}, {"$inc": change}
    )
    if not updated:
        return False
    _log(user_id, -amount, kind, note, day)
    return True
