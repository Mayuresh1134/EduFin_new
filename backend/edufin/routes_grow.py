"""Grow: the investment assistant and paper trading on the simulated market."""
import math
import time

from flask import Blueprint, g, jsonify, request

from . import market
from .core import ApiError, body, choice, db, fresh_user, iso, login_required, now, number, public_user

bp = Blueprint("grow", __name__)

# ---------------- investment assistant ----------------
# Teaching assumptions, not forecasts: a round long-run yearly return for each asset class.
ASSET_CLASSES = {
    "stocks": {"label": "Stocks", "return": 12.0},
    "mutual_funds": {"label": "Mutual Funds", "return": 9.0},
    "gold": {"label": "Gold Fund", "return": 7.0},
    "crypto": {"label": "Crypto", "return": 20.0},
}
# For each risk level: the most cautious and the most adventurous mix it allows (percent).
RISK_BANDS = {
    "low": ({"stocks": 5, "mutual_funds": 45, "gold": 50, "crypto": 0},
            {"stocks": 25, "mutual_funds": 50, "gold": 25, "crypto": 0}),
    "moderate": ({"stocks": 30, "mutual_funds": 40, "gold": 25, "crypto": 5},
                 {"stocks": 50, "mutual_funds": 30, "gold": 10, "crypto": 10}),
    "high": ({"stocks": 50, "mutual_funds": 20, "gold": 10, "crypto": 20},
             {"stocks": 45, "mutual_funds": 5, "gold": 5, "crypto": 45}),
}


def _r1(x: float) -> float:
    """Round to one decimal with halves going up, so 9.25 is 9.3 everywhere it is shown."""
    return math.floor(x * 10 + 0.5 + 1e-9) / 10


def _expected(mix: dict) -> float:
    return sum(mix[k] * ASSET_CLASSES[k]["return"] for k in mix) / 100


def suggest_portfolio(amount: float, risk: str, target: float) -> dict:
    """Slide between the cautious and adventurous mix until the expected return meets the target."""
    cautious, bold = RISK_BANDS[risk]
    lo, hi = _expected(cautious), _expected(bold)
    blend = min(1.0, max(0.0, (target - lo) / (hi - lo)))
    mix = {k: cautious[k] + (bold[k] - cautious[k]) * blend for k in cautious}

    # Round to 0.1% and give any rounding leftover to the largest slice so it totals exactly 100.
    rounded = {k: round(v, 1) for k, v in mix.items()}
    biggest = max(rounded, key=rounded.get)
    rounded[biggest] = round(rounded[biggest] + 100 - sum(rounded.values()), 1)

    expected = _r1(_expected(rounded))
    return {
        "amount": amount,
        "risk": risk,
        "target": target,
        "expected_return": expected,
        "range": {"min": _r1(lo), "max": _r1(hi)},
        "reachable": lo - 0.05 <= target <= hi + 0.05,
        "value_in_5_years": round(amount * (1 + expected / 100) ** 5, 2),
        "allocation": [
            {"key": k, "label": ASSET_CLASSES[k]["label"], "pct": rounded[k],
             "amount": round(amount * rounded[k] / 100, 2), "assumed_return": ASSET_CLASSES[k]["return"]}
            for k in ASSET_CLASSES
        ],
    }


@bp.post("/api/invest/suggest")
@login_required
def invest_suggest():
    data = body()
    return jsonify(suggest_portfolio(
        round(number(data, "amount", "Investment amount", 100, 1_000_000_000), 2),
        choice(data, "risk", "Risk level", RISK_BANDS),
        number(data, "target", "Return percentage", 0, 100),
    ))


# ---------------- market ----------------

def _asset(code: str) -> str:
    if code not in market.ASSETS:
        raise ApiError("Unknown asset", 404)
    return code


@bp.get("/api/market")
@login_required
def market_list():
    return jsonify({"assets": market.snapshot(), "simulated": True})


@bp.get("/api/market/<code>/history")
@login_required
def market_history(code):
    range_name = request.args.get("range", "1D").upper()
    if range_name not in market.RANGES:
        raise ApiError("range must be one of: " + ", ".join(market.RANGES))
    return jsonify({"code": _asset(code), "range": range_name, "points": market.history(code, range_name)})


# ---------------- paper trading ----------------
# Money is stored in paise (whole numbers) so repeated trades never drift by fractions of a rupee.

def _portfolio() -> dict:
    t = time.time()
    user = fresh_user()
    rows, value, invested, value_30d_ago = [], 0.0, 0.0, 0.0
    for h in db().holdings.find({"user_id": user["_id"], "qty": {"$gt": 0}}):
        price = market.price(h["asset"], t)
        worth, cost = h["qty"] * price, h["cost_paise"] / 100
        value, invested = value + worth, invested + cost
        value_30d_ago += h["qty"] * market.price(h["asset"], t - 30 * market.DAY)
        meta = market.ASSETS[h["asset"]]
        rows.append({
            "code": h["asset"], "name": meta["name"], "unit": meta["unit"], "qty": h["qty"], "price": price,
            "value": round(worth, 2), "invested": round(cost, 2), "pl": round(worth - cost, 2),
            "pl_pct": round((worth / cost - 1) * 100, 2) if cost else 0,
        })
    rows.sort(key=lambda r: -r["value"])
    return {
        "cash": user["cash_paise"] / 100,
        "invested": round(invested, 2),
        "value": round(value, 2),
        "pl": round(value - invested, 2),
        "pl_pct": round((value / invested - 1) * 100, 2) if invested else 0,
        # What today's holdings were worth 30 days ago, to show how the market moved under them.
        "growth_30d_pct": round((value / value_30d_ago - 1) * 100, 2) if value_30d_ago else None,
        "holdings": rows,
    }


@bp.get("/api/portfolio")
@login_required
def portfolio():
    return jsonify(_portfolio())


@bp.post("/api/trade")
@login_required
def trade():
    data = body()
    code = _asset(data.get("asset"))
    side = choice(data, "side", "side", ("buy", "sell"))
    price = market.price(code)
    uid = g.user["_id"]
    unit = market.ASSETS[code]["unit"]

    if side == "buy":
        paise = round(number(data, "amount", "Amount", 1, 1_000_000_000) * 100)
        qty = round(paise / 100 / price, 6)
        if qty <= 0:
            raise ApiError("That amount is too small to buy any of this asset")
        # Check the balance and take the cash in one atomic step.
        paid = db().users.find_one_and_update(
            {"_id": uid, "cash_paise": {"$gte": paise}}, {"$inc": {"cash_paise": -paise}}
        )
        if not paid:
            raise ApiError("You don't have enough trading cash for that", 409)
        db().holdings.update_one({"user_id": uid, "asset": code}, {"$inc": {"qty": qty, "cost_paise": paise}}, upsert=True)
        realised = None
    else:
        holding = db().holdings.find_one({"user_id": uid, "asset": code})
        held = holding["qty"] if holding else 0
        if held <= 0:
            raise ApiError(f"You don't hold any {market.ASSETS[code]['name']}", 409)
        if data.get("all") is True:
            qty = held
        elif "qty" in data:
            qty = round(number(data, "qty", "Quantity", 0.000001, 1e12), 6)
        else:
            qty = round(number(data, "amount", "Amount", 1, 1_000_000_000) / price, 6)
        if qty > held + 1e-9:
            raise ApiError(f"You only hold {held:g} {unit}", 409)
        everything = qty >= held - 1e-9
        cost_part = holding["cost_paise"] if everything else round(holding["cost_paise"] * qty / held)
        update = ({"$set": {"qty": 0, "cost_paise": 0}} if everything
                  else {"$inc": {"qty": -qty, "cost_paise": -cost_part}})
        # Only apply if the holding is unchanged since we read it.
        changed = db().holdings.update_one({"_id": holding["_id"], "qty": held}, update)
        if changed.modified_count != 1:
            raise ApiError("Your holdings just changed. Try again.", 409)
        qty = held if everything else qty
        paise = round(qty * price * 100)
        db().users.update_one({"_id": uid}, {"$inc": {"cash_paise": paise}})
        realised = (paise - cost_part) / 100

    record = {"user_id": uid, "ts": now(), "asset": code, "side": side, "qty": qty, "price": price,
              "amount": paise / 100, "realised": realised}
    db().trades.insert_one(record)
    return jsonify({"trade": _trade_json(record), "portfolio": _portfolio(), "user": public_user(fresh_user())}), 201


def _trade_json(t: dict) -> dict:
    return {"id": str(t["_id"]), "ts": iso(t["ts"]), "asset": t["asset"], "name": market.ASSETS[t["asset"]]["name"],
            "unit": market.ASSETS[t["asset"]]["unit"], "side": t["side"], "qty": t["qty"], "price": t["price"],
            "amount": t["amount"], "realised": t.get("realised")}


@bp.get("/api/trades")
@login_required
def trades():
    rows = db().trades.find({"user_id": g.user["_id"]}).sort("ts", -1).limit(100)
    return jsonify({"trades": [_trade_json(t) for t in rows]})
