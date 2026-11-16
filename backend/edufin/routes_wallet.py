"""Balance (coins and trading cash) and the rewards shop."""
import secrets
import string

from flask import Blueprint, g, jsonify

from .core import ApiError, body, db, fresh_user, iso, login_required, now, number, oid, public_user, req_date, spend

bp = Blueprint("wallet", __name__)

COIN_TO_RUPEE = 1  # one coin buys one rupee of virtual trading cash


@bp.get("/api/balance")
@login_required
def balance():
    rows = db().ledger.find({"user_id": g.user["_id"]}).sort("ts", -1).limit(60)
    return jsonify({
        "user": public_user(g.user),
        "rate": COIN_TO_RUPEE,
        "ledger": [{"id": str(r["_id"]), "ts": iso(r["ts"]), "amount": r["amount"], "kind": r["kind"], "note": r["note"]}
                   for r in rows],
    })


@bp.post("/api/balance/convert")
@login_required
def convert():
    data = body()
    coins = number(data, "coins", "Coins", 1, 10_000_000)
    if coins != int(coins):
        raise ApiError("Convert a whole number of coins")
    coins = int(coins)
    rupees = coins * COIN_TO_RUPEE
    if not spend(g.user["_id"], coins, "convert", f"Moved to trading cash (₹{rupees:,})", req_date(data)):
        raise ApiError("You don't have that many coins", 409)
    db().users.update_one({"_id": g.user["_id"]}, {"$inc": {"cash_paise": rupees * 100}})
    return jsonify({"user": public_user(fresh_user())})


def _code() -> str:
    alphabet = string.ascii_uppercase + string.digits
    return "EDU-" + "-".join("".join(secrets.choice(alphabet) for _ in range(4)) for _ in range(2))


def _redemption_json(r: dict) -> dict:
    return {"id": str(r["_id"]), "title": r["title"], "code": r["code"], "cost": r["cost"], "ts": iso(r["ts"])}


@bp.get("/api/rewards")
@login_required
def rewards():
    mine = db().redemptions.find({"user_id": g.user["_id"]}).sort("ts", -1).limit(50)
    return jsonify({
        "rewards": [{"id": str(r["_id"]), "title": r["title"], "brand": r.get("brand"),
                     "discount": r.get("discount"), "cost": r["cost"]}
                    for r in db().rewards.find({"active": True}).sort("cost", 1)],
        "redeemed": [_redemption_json(r) for r in mine],
    })


@bp.post("/api/rewards/<reward_id>/redeem")
@login_required
def redeem(reward_id):
    reward = db().rewards.find_one({"_id": oid(reward_id), "active": True})
    if not reward:
        raise ApiError("That offer is no longer available", 404)
    if not spend(g.user["_id"], reward["cost"], "reward", f"Redeemed: {reward['title']}", req_date(body())):
        short = reward["cost"] - fresh_user().get("coins", 0)
        raise ApiError(f"You need {short:,} more coins for this offer", 409)
    record = {"user_id": g.user["_id"], "reward_id": reward["_id"], "title": reward["title"],
              "code": _code(), "cost": reward["cost"], "ts": now()}
    db().redemptions.insert_one(record)
    return jsonify({"redemption": _redemption_json(record), "user": public_user(fresh_user())}), 201
