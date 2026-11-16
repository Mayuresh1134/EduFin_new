"""Sign up, sign in, Google sign-in, password reset, and the profile screen."""
import hashlib
import hmac
import secrets
from datetime import timedelta

import requests
from flask import Blueprint, current_app, g, jsonify
from pymongo.errors import DuplicateKeyError

from .core import (ApiError, body, check_password, db, email_of, fresh_user, hash_password,
                   login_required, make_token, now, password_of, phone_of, public_user, text)

bp = Blueprint("auth", __name__)

RESET_MINUTES = 15
RESET_ATTEMPTS = 5
MAX_AVATAR_CHARS = 120_000  # a ~160px JPEG as a data: URL is well under this


def _session(user: dict, remember: bool = False, status: int = 200):
    return jsonify({"token": make_token(user, remember), "user": public_user(user)}), status


def _create_user(username: str, email: str, phone: str = "", password: str | None = None) -> dict:
    user = {
        "username": username,
        "email": email,
        "phone": phone,
        "password_hash": hash_password(password) if password else None,
        "password_version": 0,
        "avatar": None,
        "coins": 0,
        "lifetime_coins": 0,
        "cash_paise": current_app.config["STARTING_CASH"] * 100,
        "created_at": now(),
    }
    try:
        user["_id"] = db().users.insert_one(user).inserted_id
    except DuplicateKeyError:
        raise ApiError("An account with this email already exists. Log in instead.", 409)
    return user


@bp.get("/api/config")
def public_config():
    return jsonify({"google_client_id": current_app.config["GOOGLE_CLIENT_ID"] or None})


@bp.post("/api/auth/register")
def register():
    data = body()
    user = _create_user(
        text(data, "username", "Username", 2, 40), email_of(data), phone_of(data), password_of(data)
    )
    return _session(user, status=201)


@bp.post("/api/auth/login")
def login():
    data = body()
    email = str(data.get("email") or "").strip().lower()
    user = db().users.find_one({"email": email})
    if not user or not check_password(data.get("password"), user.get("password_hash")):
        raise ApiError("Email or password is incorrect", 401)
    return _session(user, remember=bool(data.get("remember")))


@bp.post("/api/auth/google")
def google():
    """The browser gets an access token from Google; we check with Google who it belongs to."""
    client_id = current_app.config["GOOGLE_CLIENT_ID"]
    if not client_id:
        raise ApiError("Google sign-in is not set up on this server", 501)
    access_token = text(body(), "access_token", "access_token", 10, 4096)
    try:
        info = requests.get("https://oauth2.googleapis.com/tokeninfo",
                            params={"access_token": access_token}, timeout=8)
        profile = requests.get("https://www.googleapis.com/oauth2/v3/userinfo",
                               headers={"Authorization": f"Bearer {access_token}"}, timeout=8)
    except requests.RequestException:
        raise ApiError("Could not reach Google. Try again.", 502)
    if not (info.ok and profile.ok):
        raise ApiError("Google did not accept that sign-in. Try again.", 401)
    info, profile = info.json(), profile.json()
    # The token must have been issued to *this* app, not to some other site.
    if info.get("aud") != client_id or not profile.get("email") or not profile.get("email_verified"):
        raise ApiError("Google did not accept that sign-in. Try again.", 401)

    email = profile["email"].lower()
    user = db().users.find_one({"email": email})
    if not user:
        name = (profile.get("name") or email.split("@")[0])[:40]
        user = _create_user(name, email)
    return _session(user, remember=True)


# ---------- forgotten password ----------

def deliver_reset_code(email: str, code: str) -> None:
    """Hook for sending the code to the user.

    No mail service is connected, so the code is printed in the server's terminal.
    Replace the body of this function with a call to your email provider.
    """
    print(f"\n[EduFin] Password reset code for {email}: {code}  (valid {RESET_MINUTES} minutes)\n", flush=True)


def _code_hash(email: str, code: str) -> str:
    key = current_app.config["JWT_SECRET"].encode()
    return hmac.new(key, f"{email}:{code}".encode(), hashlib.sha256).hexdigest()


@bp.post("/api/auth/forgot")
def forgot():
    email = email_of(body())
    user = db().users.find_one({"email": email})
    if user:
        code = f"{secrets.randbelow(1_000_000):06d}"
        db().users.update_one({"_id": user["_id"]}, {"$set": {"reset": {
            "hash": _code_hash(email, code), "expires": now() + timedelta(minutes=RESET_MINUTES), "attempts": 0}}})
        deliver_reset_code(email, code)
    # Same answer either way, so this can't be used to discover who has an account.
    return jsonify({"ok": True})


@bp.post("/api/auth/reset")
def reset():
    data = body()
    email, new_password = email_of(data), password_of(data)
    code = str(data.get("code") or "").strip()
    user = db().users.find_one({"email": email})
    pending = (user or {}).get("reset")
    wrong = ApiError("That code is wrong or has expired. Request a new one.", 400)
    if not pending:
        raise wrong
    expires = pending["expires"]
    if expires.tzinfo is None:
        expires = expires.replace(tzinfo=now().tzinfo)
    if expires < now() or pending.get("attempts", 0) >= RESET_ATTEMPTS:
        db().users.update_one({"_id": user["_id"]}, {"$unset": {"reset": ""}})
        raise wrong
    if not hmac.compare_digest(pending["hash"], _code_hash(email, code)):
        db().users.update_one({"_id": user["_id"]}, {"$inc": {"reset.attempts": 1}})
        raise wrong
    db().users.update_one(
        {"_id": user["_id"]},
        {"$set": {"password_hash": hash_password(new_password)}, "$inc": {"password_version": 1}, "$unset": {"reset": ""}},
    )
    return jsonify({"ok": True})


# ---------- profile ----------

@bp.get("/api/me")
@login_required
def me():
    return jsonify({"user": public_user(g.user)})


@bp.put("/api/profile")
@login_required
def update_profile():
    data = body()
    changes = {}
    if "username" in data:
        changes["username"] = text(data, "username", "Name", 2, 40)
    if "phone" in data:
        changes["phone"] = phone_of(data)
    if "avatar" in data:
        avatar = data["avatar"]
        if avatar is not None and not (
            isinstance(avatar, str) and avatar.startswith("data:image/") and len(avatar) <= MAX_AVATAR_CHARS
        ):
            raise ApiError("That picture is too large or not an image")
        changes["avatar"] = avatar
    if changes:
        db().users.update_one({"_id": g.user["_id"]}, {"$set": changes})
    return jsonify({"user": public_user(fresh_user())})


def _confirm_password(data: dict) -> None:
    if g.user.get("password_hash") and not check_password(data.get("current_password"), g.user["password_hash"]):
        raise ApiError("Current password is incorrect", 403)


@bp.put("/api/profile/email")
@login_required
def change_email():
    data = body()
    _confirm_password(data)
    try:
        db().users.update_one({"_id": g.user["_id"]}, {"$set": {"email": email_of(data)}})
    except DuplicateKeyError:
        raise ApiError("Another account already uses that email", 409)
    return jsonify({"user": public_user(fresh_user())})


@bp.put("/api/profile/password")
@login_required
def change_password():
    data = body()
    _confirm_password(data)
    db().users.update_one(
        {"_id": g.user["_id"]},
        {"$set": {"password_hash": hash_password(password_of(data, "new_password"))}, "$inc": {"password_version": 1}},
    )
    user = fresh_user()
    # Old tokens stop working now, so hand this browser a new one.
    return jsonify({"token": make_token(user, remember=bool(data.get("remember"))), "user": public_user(user)})
