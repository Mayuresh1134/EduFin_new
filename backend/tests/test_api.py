"""End-to-end tests of the API against an in-memory MongoDB.  Run:  python -m pytest"""
from datetime import date, datetime, timedelta, timezone

import pytest

from edufin import create_app, market, routes_auth
from edufin.routes_earn import budget_bonus
from edufin.routes_grow import suggest_portfolio

TODAY = datetime.now(timezone.utc).date().isoformat()
YESTERDAY = (datetime.now(timezone.utc).date() - timedelta(days=1)).isoformat()


@pytest.fixture
def app():
    return create_app({"TESTING": True, "DB_MODE": "memory", "JWT_SECRET": "test-secret-that-is-long-enough-for-hs256", "JWT_SECRET_GENERATED": False})


@pytest.fixture
def client(app):
    return app.test_client()


@pytest.fixture
def auth(client):
    """Register a user and return headers that sign requests in as them."""
    r = client.post("/api/auth/register", json={"username": "Asha", "email": "asha@example.com", "password": "secret123"})
    assert r.status_code == 201
    return {"Authorization": f"Bearer {r.json['token']}"}


def coins(client, auth):
    return client.get("/api/me", headers=auth).json["user"]["coins"]


# ---------------- accounts ----------------

def test_register_login_and_me(client):
    r = client.post("/api/auth/register", json={"username": "Ravi", "email": "Ravi@Example.com", "password": "secret123", "phone": "+91 98765 43210"})
    assert r.status_code == 201 and r.json["user"]["email"] == "ravi@example.com"
    assert r.json["user"]["cash"] == 100_000 and r.json["user"]["level"]["name"] == "Basic"
    assert "password_hash" not in r.json["user"]

    dup = client.post("/api/auth/register", json={"username": "Ravi", "email": "ravi@example.com", "password": "secret123"})
    assert dup.status_code == 409

    assert client.post("/api/auth/login", json={"email": "ravi@example.com", "password": "wrong-password"}).status_code == 401
    ok = client.post("/api/auth/login", json={"email": "RAVI@example.com", "password": "secret123", "remember": True})
    assert ok.status_code == 200
    me = client.get("/api/me", headers={"Authorization": f"Bearer {ok.json['token']}"})
    assert me.json["user"]["username"] == "Ravi"


@pytest.mark.parametrize("payload", [
    {"username": "A", "email": "a@example.com", "password": "secret123"},        # name too short
    {"username": "Asha", "email": "not-an-email", "password": "secret123"},
    {"username": "Asha", "email": "a@example.com", "password": "short"},
    {"username": "Asha", "email": "a@example.com", "password": "x" * 73},        # past bcrypt's limit
    {"username": "Asha", "email": "a@example.com", "password": "secret123", "phone": "abc"},
])
def test_register_rejects_bad_input(client, payload):
    assert client.post("/api/auth/register", json=payload).status_code == 400


def test_protected_routes_need_a_valid_token(client):
    assert client.get("/api/me").status_code == 401
    assert client.get("/api/time", headers={"Authorization": "Bearer nonsense"}).status_code == 401


def test_profile_email_and_password_changes(client, auth):
    r = client.put("/api/profile", headers=auth, json={"username": "Asha K", "phone": "9876543210", "avatar": "data:image/jpeg;base64,AAAA"})
    assert r.json["user"]["username"] == "Asha K" and r.json["user"]["avatar"].startswith("data:image/")
    assert client.put("/api/profile", headers=auth, json={"avatar": "https://example.com/x.png"}).status_code == 400

    assert client.put("/api/profile/email", headers=auth, json={"email": "new@example.com", "current_password": "nope"}).status_code == 403
    assert client.put("/api/profile/email", headers=auth, json={"email": "new@example.com", "current_password": "secret123"}).json["user"]["email"] == "new@example.com"

    r = client.put("/api/profile/password", headers=auth, json={"current_password": "secret123", "new_password": "brand-new-pass"})
    assert r.status_code == 200
    assert client.get("/api/me", headers=auth).status_code == 401  # the old token is signed out
    assert client.get("/api/me", headers={"Authorization": f"Bearer {r.json['token']}"}).status_code == 200
    assert client.post("/api/auth/login", json={"email": "new@example.com", "password": "brand-new-pass"}).status_code == 200


def test_password_reset_with_code(client, auth, monkeypatch):
    sent = {}
    monkeypatch.setattr(routes_auth, "deliver_reset_code", lambda email, code: sent.update(email=email, code=code))
    assert client.post("/api/auth/forgot", json={"email": "nobody@example.com"}).json == {"ok": True}
    assert not sent  # unknown email: same answer, nothing sent
    client.post("/api/auth/forgot", json={"email": "asha@example.com"})
    assert sent["email"] == "asha@example.com" and len(sent["code"]) == 6

    wrong = "000000" if sent["code"] != "000000" else "111111"
    assert client.post("/api/auth/reset", json={"email": "asha@example.com", "code": wrong, "password": "another-pass"}).status_code == 400
    assert client.post("/api/auth/reset", json={"email": "asha@example.com", "code": sent["code"], "password": "another-pass"}).status_code == 200
    assert client.post("/api/auth/login", json={"email": "asha@example.com", "password": "another-pass"}).status_code == 200
    # a code works once
    assert client.post("/api/auth/reset", json={"email": "asha@example.com", "code": sent["code"], "password": "third-pass-1"}).status_code == 400


def test_reset_code_locks_after_five_wrong_tries(client, auth, monkeypatch):
    sent = {}
    monkeypatch.setattr(routes_auth, "deliver_reset_code", lambda email, code: sent.update(code=code))
    client.post("/api/auth/forgot", json={"email": "asha@example.com"})
    wrong = "000000" if sent["code"] != "000000" else "111111"
    for _ in range(5):
        client.post("/api/auth/reset", json={"email": "asha@example.com", "code": wrong, "password": "another-pass"})
    assert client.post("/api/auth/reset", json={"email": "asha@example.com", "code": sent["code"], "password": "another-pass"}).status_code == 400


def test_google_sign_in_is_off_without_a_client_id(client):
    assert client.get("/api/config").json == {"google_client_id": None}
    assert client.post("/api/auth/google", json={"access_token": "x" * 20}).status_code == 501


# ---------------- time tracker ----------------

def test_time_tracker_flow(client, auth):
    start = client.get(f"/api/time?date={TODAY}", headers=auth).json
    assert start["hours"] == {"sleep": 8, "work": 8, "misc": 2} and start["free_minutes"] == 360

    r = client.put("/api/time", headers=auth, json={"date": TODAY, "hours": {"sleep": 7.5, "work": 9, "misc": 1.5}})
    assert r.json["free_minutes"] == 360
    assert client.put("/api/time", headers=auth, json={"date": TODAY, "hours": {"sleep": 12, "work": 12, "misc": 1}}).status_code == 400
    assert client.put("/api/time", headers=auth, json={"date": TODAY, "hours": {"sleep": 7.25, "work": 9, "misc": 1}}).status_code == 400

    r = client.post("/api/time/tasks", headers=auth, json={"date": TODAY, "category": "skill", "title": "Python course", "minutes": 120})
    assert r.status_code == 201 and r.json["tasks"][0]["coins"] == 180 and r.json["remaining_minutes"] == 240
    task_id = r.json["tasks"][0]["id"]

    too_long = client.post("/api/time/tasks", headers=auth, json={"date": TODAY, "category": "sports", "title": "Marathon", "minutes": 300})
    assert too_long.status_code == 409
    # shrinking free time below what is scheduled is refused
    assert client.put("/api/time", headers=auth, json={"date": TODAY, "hours": {"sleep": 10, "work": 10, "misc": 3}}).status_code == 409

    done = client.patch(f"/api/time/tasks/{task_id}", headers=auth, json={"done": True})
    assert done.json["earned"] == 180 and done.json["user"]["coins"] == 180
    # ticking twice does not pay twice
    client.patch(f"/api/time/tasks/{task_id}", headers=auth, json={"done": True})
    assert coins(client, auth) == 180
    assert client.delete(f"/api/time/tasks/{task_id}", headers=auth).status_code == 409

    undone = client.patch(f"/api/time/tasks/{task_id}", headers=auth, json={"done": False})
    assert undone.json["user"]["coins"] == 0 and undone.json["user"]["lifetime_coins"] == 0
    assert client.delete(f"/api/time/tasks/{task_id}", headers=auth).json["tasks"] == []


def test_cannot_untick_a_task_after_spending_its_coins(client, auth):
    r = client.post("/api/time/tasks", headers=auth, json={"date": TODAY, "category": "work", "title": "Report", "minutes": 100})
    task_id = r.json["tasks"][0]["id"]
    client.patch(f"/api/time/tasks/{task_id}", headers=auth, json={"done": True})
    client.post("/api/balance/convert", headers=auth, json={"coins": 100})
    r = client.patch(f"/api/time/tasks/{task_id}", headers=auth, json={"done": False})
    assert r.status_code == 409
    assert client.get(f"/api/time?date={TODAY}", headers=auth).json["tasks"][0]["done"] is True


def test_ids_are_scoped_to_their_owner_and_bad_ids_are_404(client, auth):
    r = client.post("/api/time/tasks", headers=auth, json={"date": TODAY, "category": "work", "title": "Mine", "minutes": 30})
    task_id = r.json["tasks"][0]["id"]
    other = client.post("/api/auth/register", json={"username": "Other", "email": "other@example.com", "password": "secret123"})
    other_auth = {"Authorization": f"Bearer {other.json['token']}"}
    assert client.patch(f"/api/time/tasks/{task_id}", headers=other_auth, json={"done": True}).status_code == 404
    assert client.patch("/api/time/tasks/not-an-id", headers=auth, json={"done": True}).status_code == 404


def test_past_days_are_read_only(client, auth):
    old = (date.fromisoformat(TODAY) - timedelta(days=5)).isoformat()
    assert client.get(f"/api/time?date={old}", headers=auth).status_code == 200
    assert client.post("/api/time/tasks", headers=auth, json={"date": old, "category": "work", "title": "Late", "minutes": 30}).status_code == 409
    future = (date.fromisoformat(TODAY) + timedelta(days=3)).isoformat()
    assert client.get(f"/api/time?date={future}", headers=auth).status_code == 400


# ---------------- expenses and savings ----------------

def test_budget_bonus_rule():
    assert budget_bonus(1000, 0) == 500        # the design's "Earnings Today: 500"
    assert budget_bonus(1000, 600) == 260      # 100 + 0.4 × 400 saved
    assert budget_bonus(1000, 1000) == 100
    assert budget_bonus(1000, 1000.01) == 0
    assert budget_bonus(None, 0) == 0


def test_expense_flow_and_closing_the_day(client, auth):
    assert client.post("/api/expenses/close", headers=auth, json={"date": TODAY}).status_code == 400  # no goal yet
    client.put("/api/expenses/goal", headers=auth, json={"date": TODAY, "goal": 1000})
    a = client.post("/api/expenses/items", headers=auth, json={"date": TODAY, "category": "food", "title": "Lunch", "amount": 250}).json
    assert a["spent"] == 0 and a["planned"] == 250 and a["remaining"] == 1000
    lunch = a["items"][0]["id"]
    b = client.post("/api/expenses/items", headers=auth, json={"date": TODAY, "category": "travel", "title": "Metro", "amount": 150, "paid": True}).json
    assert b["spent"] == 150
    c = client.patch(f"/api/expenses/items/{lunch}", headers=auth, json={"paid": True}).json
    assert c["spent"] == 400 and c["remaining"] == 600 and c["by_category"]["food"] == 250 and c["bonus"] == 340

    closed = client.post("/api/expenses/close", headers=auth, json={"date": TODAY})
    assert closed.json["closed"] is True and closed.json["bonus"] == 340 and closed.json["user"]["coins"] == 340
    assert client.post("/api/expenses/close", headers=auth, json={"date": TODAY}).status_code == 409
    assert client.post("/api/expenses/items", headers=auth, json={"date": TODAY, "category": "food", "title": "Snack", "amount": 50}).status_code == 409
    assert client.patch(f"/api/expenses/items/{lunch}", headers=auth, json={"paid": False}).status_code == 409

    s = client.get(f"/api/savings?date={TODAY}", headers=auth).json
    assert s["coins_today"] == 340 and s["coins_month"] >= 340 and s["saved_today"] == 600 and s["saved_month"] >= 600
    assert s["day"]["delta"] == 340 and s["day"]["pct"] is None  # nothing yesterday to compare with
    assert "Food" in s["tips"][0]["title"]
    cal = client.get(f"/api/savings/calendar?month={TODAY[:7]}", headers=auth).json
    assert cal["days"][TODAY] == {"coins": 340, "saved": 600}


def test_going_over_the_goal_earns_nothing(client, auth):
    client.put("/api/expenses/goal", headers=auth, json={"date": TODAY, "goal": 200})
    client.post("/api/expenses/items", headers=auth, json={"date": TODAY, "category": "luxury", "title": "Shoes", "amount": 900, "paid": True})
    r = client.post("/api/expenses/close", headers=auth, json={"date": TODAY}).json
    assert r["bonus"] == 0 and r["over_by"] == 700 and r["user"]["coins"] == 0


def test_a_forgotten_day_is_closed_automatically(client, auth):
    client.put("/api/expenses/goal", headers=auth, json={"date": YESTERDAY, "goal": 500})
    client.post("/api/expenses/items", headers=auth, json={"date": YESTERDAY, "category": "food", "title": "Dinner", "amount": 300, "paid": True})
    today = client.get(f"/api/expenses?date={TODAY}", headers=auth).json
    assert today["suggested_goal"] == 500 and today["goal"] is None
    assert client.get(f"/api/expenses?date={YESTERDAY}", headers=auth).json["closed"] is True
    assert coins(client, auth) == 180  # 100 + 0.4 × 200 saved


def test_savings_starter_tips_for_a_new_account(client, auth):
    s = client.get(f"/api/savings?date={TODAY}", headers=auth).json
    assert s["coins_today"] == 0 and len(s["tips"]) == 2 and s["has_goal_today"] is False


# ---------------- rewards and balance ----------------

def test_rewards_are_seeded_and_redeeming_spends_coins(client, auth, app):
    catalog = client.get("/api/rewards", headers=auth).json["rewards"]
    assert [r["cost"] for r in catalog] == [1000, 4000, 5000]
    amazon = catalog[0]
    short = client.post(f"/api/rewards/{amazon['id']}/redeem", headers=auth, json={})
    assert short.status_code == 409 and "1,000 more coins" in short.json["error"]

    with app.app_context():
        app.extensions["edufin_db"].users.update_one({"email": "asha@example.com"}, {"$set": {"coins": 1500}})
    ok = client.post(f"/api/rewards/{amazon['id']}/redeem", headers=auth, json={"date": TODAY})
    assert ok.status_code == 201 and ok.json["user"]["coins"] == 500 and ok.json["redemption"]["code"].startswith("EDU-")
    assert client.post(f"/api/rewards/{amazon['id']}/redeem", headers=auth, json={}).status_code == 409
    assert len(client.get("/api/rewards", headers=auth).json["redeemed"]) == 1
    ledger = client.get("/api/balance", headers=auth).json["ledger"]
    assert ledger[0]["amount"] == -1000 and ledger[0]["kind"] == "reward"


def test_convert_coins_to_trading_cash(client, auth, app):
    with app.app_context():
        app.extensions["edufin_db"].users.update_one({"email": "asha@example.com"}, {"$set": {"coins": 300}})
    assert client.post("/api/balance/convert", headers=auth, json={"coins": 301}).status_code == 409
    assert client.post("/api/balance/convert", headers=auth, json={"coins": 2.5}).status_code == 400
    r = client.post("/api/balance/convert", headers=auth, json={"coins": 200}).json["user"]
    assert r["coins"] == 100 and r["cash"] == 100_200


# ---------------- grow ----------------

def test_growth_assistant_mixes():
    plan = suggest_portfolio(10_000, "moderate", 10)
    assert round(sum(a["pct"] for a in plan["allocation"]), 1) == 100
    assert round(sum(a["amount"] for a in plan["allocation"]), 2) == 10_000
    assert plan["reachable"] and abs(plan["expected_return"] - 10) < 0.1

    low = suggest_portfolio(10_000, "low", 30)
    assert not low["reachable"] and low["expected_return"] <= low["range"]["max"] + 0.05
    assert next(a for a in low["allocation"] if a["key"] == "crypto")["pct"] == 0

    high = suggest_portfolio(50_000, "high", 15)
    assert next(a for a in high["allocation"] if a["key"] == "crypto")["pct"] > 20


def test_suggest_endpoint_validates(client, auth):
    assert client.post("/api/invest/suggest", headers=auth, json={"amount": 10000, "risk": "moderate", "target": 10}).status_code == 200
    assert client.post("/api/invest/suggest", headers=auth, json={"amount": 10000, "risk": "yolo", "target": 10}).status_code == 400
    assert client.post("/api/invest/suggest", headers=auth, json={"amount": "lots", "risk": "low", "target": 10}).status_code == 400


def test_market_is_repeatable_and_has_every_range(client, auth):
    assert market.price("GOLD", 1_800_000_000) == market.price("GOLD", 1_800_000_000)
    assert market.price("FD", market.EPOCH + market.YEAR) == 1070.0  # 7% a year
    assets = client.get("/api/market", headers=auth).json["assets"]
    assert {a["code"] for a in assets} == {"BTC", "NIFTYMF", "CRUDE", "GOLD", "FD", "AAPL"}
    for name in market.RANGES:
        points = client.get(f"/api/market/GOLD/history?range={name}", headers=auth).json["points"]
        assert len(points) > 200 and all(p["p"] > 0 for p in points)
        assert points == sorted(points, key=lambda p: p["t"])
    assert client.get("/api/market/DOGE/history", headers=auth).status_code == 404
    assert client.get("/api/market/GOLD/history?range=7Y", headers=auth).status_code == 400


def test_buy_and_sell(client, auth, monkeypatch):
    monkeypatch.setattr(market, "price", lambda code, t=None: 2000.0)
    assert client.post("/api/trade", headers=auth, json={"asset": "GOLD", "side": "sell", "qty": 1}).status_code == 409
    assert client.post("/api/trade", headers=auth, json={"asset": "GOLD", "side": "buy", "amount": 100_001}).status_code == 409

    buy = client.post("/api/trade", headers=auth, json={"asset": "GOLD", "side": "buy", "amount": 10_000})
    assert buy.status_code == 201 and buy.json["trade"]["qty"] == 5 and buy.json["user"]["cash"] == 90_000
    p = buy.json["portfolio"]
    assert p["invested"] == 10_000 and p["value"] == 10_000 and p["holdings"][0]["qty"] == 5

    monkeypatch.setattr(market, "price", lambda code, t=None: 2500.0)
    assert client.get("/api/portfolio", headers=auth).json["pl"] == 2500
    assert client.post("/api/trade", headers=auth, json={"asset": "GOLD", "side": "sell", "qty": 6}).status_code == 409

    part = client.post("/api/trade", headers=auth, json={"asset": "GOLD", "side": "sell", "qty": 2}).json
    assert part["trade"]["amount"] == 5000 and part["trade"]["realised"] == 1000 and part["user"]["cash"] == 95_000
    assert part["portfolio"]["invested"] == 6000

    rest = client.post("/api/trade", headers=auth, json={"asset": "GOLD", "side": "sell", "all": True}).json
    assert rest["user"]["cash"] == 102_500 and rest["portfolio"]["holdings"] == [] and rest["portfolio"]["invested"] == 0
    history = client.get("/api/trades", headers=auth).json["trades"]
    assert [t["side"] for t in history] == ["sell", "sell", "buy"]


def test_unknown_api_path_is_json_404(client):
    r = client.get("/api/nope")
    assert r.status_code == 404 and "error" in r.json
