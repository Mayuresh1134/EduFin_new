"""Earn: the time tracker, the expense tracker and the savings assistant."""
import calendar
from datetime import date as date_cls
from datetime import timedelta

from flask import Blueprint, g, jsonify, request

from .core import (EARNING_KINDS, ApiError, award, body, choice, db, fresh_user, login_required,
                   now, number, oid, public_user, req_date, require_today, spend, text)

bp = Blueprint("earn", __name__)

# rate = coins per minute of a finished task
TASK_CATEGORIES = {
    "work": {"label": "Office work / School work", "rate": 1.5},
    "skill": {"label": "Skill development", "rate": 1.5},
    "sports": {"label": "Sports", "rate": 1.0},
    "leisure": {"label": "Entertainment / Leisure activities", "rate": 0.5},
}
EXPENSE_CATEGORIES = {"food": "Food / Groceries", "travel": "Travel", "misc": "Miscellaneous", "luxury": "Luxury"}
DEFAULT_HOURS = {"sleep": 8, "work": 8, "misc": 2}
BUDGET_BONUS_BASE, BUDGET_BONUS_PER_RUPEE, BUDGET_BONUS_MAX = 100, 0.4, 500


def budget_bonus(goal: float, spent: float) -> int:
    """Coins for ending a day at or under the spending goal: 100, plus 0.4 per rupee saved, up to 500."""
    if not goal or goal <= 0 or spent > goal:
        return 0
    return min(BUDGET_BONUS_MAX, BUDGET_BONUS_BASE + int((goal - spent) * BUDGET_BONUS_PER_RUPEE))


def _uid():
    return g.user["_id"]


def _day(day: str):
    return db().days.find_one({"user_id": _uid(), "date": day}) or {}


def _done(payload: dict, status: int = 200):
    payload["user"] = public_user(fresh_user())  # so the coin counter in the header stays right
    return jsonify(payload), status


# ---------------- time tracker ----------------

def _hours(day: str, doc: dict) -> dict:
    if doc.get("hours"):
        return doc["hours"]
    earlier = db().days.find_one(
        {"user_id": _uid(), "date": {"$lt": day}, "hours": {"$exists": True}}, sort=[("date", -1)]
    )
    return dict(earlier["hours"]) if earlier else dict(DEFAULT_HOURS)


def _tasks(day: str) -> list[dict]:
    return list(db().tasks.find({"user_id": _uid(), "date": day}).sort("created_at", 1))


def _time_payload(day: str) -> dict:
    hours, tasks = _hours(day, _day(day)), _tasks(day)
    free = round((24 - sum(hours.values())) * 60)
    scheduled = sum(t["minutes"] for t in tasks)
    return {
        "date": day,
        "hours": hours,
        "free_minutes": free,
        "scheduled_minutes": scheduled,
        "remaining_minutes": free - scheduled,
        "earned": sum(t["coins"] for t in tasks if t["done"]),
        "possible": sum(t["coins"] for t in tasks),
        "categories": [{"key": k, **v} for k, v in TASK_CATEGORIES.items()],
        "tasks": [
            {"id": str(t["_id"]), "category": t["category"], "title": t["title"],
             "minutes": t["minutes"], "coins": t["coins"], "done": t["done"]}
            for t in tasks
        ],
    }


@bp.get("/api/time")
@login_required
def get_time():
    return jsonify(_time_payload(req_date()))


@bp.put("/api/time")
@login_required
def set_time():
    data = body()
    day = req_date(data)
    require_today(day)
    raw = data.get("hours")
    if not isinstance(raw, dict):
        raise ApiError("hours is missing")
    labels = {"sleep": "Sleep", "work": "Work/School hours", "misc": "Miscellaneous"}
    hours = {key: number(raw, key, label, 0, 24) for key, label in labels.items()}
    if any((h * 2) % 1 for h in hours.values()):
        raise ApiError("Use whole or half hours")
    if sum(hours.values()) > 24:
        raise ApiError("A day only has 24 hours")
    scheduled = sum(t["minutes"] for t in _tasks(day))
    if (24 - sum(hours.values())) * 60 < scheduled:
        raise ApiError(f"You've already scheduled {scheduled} minutes of free time. Remove a task first.", 409)
    db().days.update_one({"user_id": _uid(), "date": day}, {"$set": {"hours": hours}}, upsert=True)
    return jsonify(_time_payload(day))


@bp.post("/api/time/tasks")
@login_required
def add_task():
    data = body()
    day = req_date(data)
    require_today(day)
    category = choice(data, "category", "Category", TASK_CATEGORIES)
    title = text(data, "title", "Task name", 1, 80)
    minutes = int(number(data, "minutes", "Minutes", 5, 24 * 60))
    left = _time_payload(day)["remaining_minutes"]
    if minutes > left:
        raise ApiError(f"Only {max(left, 0)} minutes of free time are left today", 409)
    db().tasks.insert_one({
        "user_id": _uid(), "date": day, "category": category, "title": title, "minutes": minutes,
        "coins": round(minutes * TASK_CATEGORIES[category]["rate"]), "done": False, "created_at": now(),
    })
    return jsonify(_time_payload(day)), 201


@bp.patch("/api/time/tasks/<task_id>")
@login_required
def tick_task(task_id):
    done = body().get("done")
    if not isinstance(done, bool):
        raise ApiError("done must be true or false")
    query = {"_id": oid(task_id), "user_id": _uid()}
    task = db().tasks.find_one(query)
    if not task:
        raise ApiError("Task not found", 404)
    require_today(task["date"])
    # Flip the task only if it is still in the other state, so a double click can't pay twice.
    flipped = db().tasks.find_one_and_update({**query, "done": not done}, {"$set": {"done": done}})
    if flipped:
        if done:
            award(_uid(), task["coins"], "task", f"Finished: {task['title']}", task["date"])
        elif not spend(_uid(), task["coins"], "task_undo", f"Unticked: {task['title']}", task["date"], undo_earning=True):
            db().tasks.update_one(query, {"$set": {"done": True}})
            raise ApiError("You've already spent the coins this task earned, so it stays ticked", 409)
    return _done(_time_payload(task["date"]))


@bp.delete("/api/time/tasks/<task_id>")
@login_required
def delete_task(task_id):
    query = {"_id": oid(task_id), "user_id": _uid()}
    task = db().tasks.find_one(query)
    if not task:
        raise ApiError("Task not found", 404)
    if task["done"]:
        raise ApiError("Untick the task before removing it", 409)
    db().tasks.delete_one(query)
    return jsonify(_time_payload(task["date"]))


# ---------------- expense tracker ----------------

def _items(day: str) -> list[dict]:
    return list(db().expenses.find({"user_id": _uid(), "date": day}).sort("created_at", 1))


def _close_day(day: str, spent: float) -> dict | None:
    """Lock a day and pay its bonus. Returns the day as it was, or None if it was not open."""
    doc = db().days.find_one({"user_id": _uid(), "date": day, "closed": {"$ne": True}, "goal": {"$gt": 0}})
    if not doc:
        return None
    bonus = budget_bonus(doc["goal"], spent)
    saved = max(doc["goal"] - spent, 0)
    changed = db().days.update_one(
        {"_id": doc["_id"], "closed": {"$ne": True}},
        {"$set": {"closed": True, "spent": spent, "saved": saved, "bonus": bonus, "closed_at": now()}},
    )
    if changed.modified_count != 1:
        return None
    award(_uid(), bonus, "budget", f"Stayed under your ₹{doc['goal']:,.0f} goal", day)
    return doc


def settle_past_days(today: str) -> None:
    """Days the user never closed are closed for them once the day is over.

    A forgotten day only earns its bonus if something was logged on it.
    """
    for doc in db().days.find({"user_id": _uid(), "date": {"$lt": today}, "closed": {"$ne": True}, "goal": {"$gt": 0}}):
        items = _items(doc["date"])
        if items:
            _close_day(doc["date"], sum(i["amount"] for i in items if i["paid"]))
        else:
            db().days.update_one({"_id": doc["_id"]}, {"$set": {"closed": True, "spent": 0, "saved": 0, "bonus": 0}})


def _expense_payload(day: str) -> dict:
    doc, items = _day(day), _items(day)
    goal, closed = doc.get("goal"), bool(doc.get("closed"))
    spent = sum(i["amount"] for i in items if i["paid"])
    earlier = db().days.find_one(
        {"user_id": _uid(), "date": {"$lt": day}, "goal": {"$gt": 0}}, sort=[("date", -1)]
    )
    return {
        "date": day,
        "goal": goal,
        "suggested_goal": earlier["goal"] if earlier else None,
        "closed": closed,
        "spent": spent,
        "planned": sum(i["amount"] for i in items),
        "remaining": max(goal - spent, 0) if goal else None,
        "over_by": max(spent - goal, 0) if goal else 0,
        "bonus": doc.get("bonus", 0) if closed else budget_bonus(goal, spent),
        "by_category": {k: sum(i["amount"] for i in items if i["paid"] and i["category"] == k) for k in EXPENSE_CATEGORIES},
        "categories": [{"key": k, "label": v} for k, v in EXPENSE_CATEGORIES.items()],
        "items": [
            {"id": str(i["_id"]), "category": i["category"], "title": i["title"], "amount": i["amount"], "paid": i["paid"]}
            for i in items
        ],
    }


def _open_day(day: str) -> None:
    require_today(day)
    if _day(day).get("closed"):
        raise ApiError("This day is closed. Its expenses can no longer change.", 409)


@bp.get("/api/expenses")
@login_required
def get_expenses():
    day = req_date()
    settle_past_days(day)
    return jsonify(_expense_payload(day))


@bp.put("/api/expenses/goal")
@login_required
def set_goal():
    data = body()
    day = req_date(data)
    _open_day(day)
    goal = round(number(data, "goal", "Today's goal", 1, 10_000_000), 2)
    db().days.update_one({"user_id": _uid(), "date": day}, {"$set": {"goal": goal}}, upsert=True)
    return jsonify(_expense_payload(day))


@bp.post("/api/expenses/items")
@login_required
def add_expense():
    data = body()
    day = req_date(data)
    _open_day(day)
    db().expenses.insert_one({
        "user_id": _uid(), "date": day,
        "category": choice(data, "category", "Category", EXPENSE_CATEGORIES),
        "title": text(data, "title", "Expense name", 1, 80),
        "amount": round(number(data, "amount", "Amount", 0.01, 10_000_000), 2),
        "paid": bool(data.get("paid", False)), "created_at": now(),
    })
    return jsonify(_expense_payload(day)), 201


def _expense(item_id):
    query = {"_id": oid(item_id), "user_id": _uid()}
    item = db().expenses.find_one(query)
    if not item:
        raise ApiError("Expense not found", 404)
    _open_day(item["date"])
    return query, item


@bp.patch("/api/expenses/items/<item_id>")
@login_required
def tick_expense(item_id):
    paid = body().get("paid")
    if not isinstance(paid, bool):
        raise ApiError("paid must be true or false")
    query, item = _expense(item_id)
    db().expenses.update_one(query, {"$set": {"paid": paid}})
    return jsonify(_expense_payload(item["date"]))


@bp.delete("/api/expenses/items/<item_id>")
@login_required
def delete_expense(item_id):
    query, item = _expense(item_id)
    db().expenses.delete_one(query)
    return jsonify(_expense_payload(item["date"]))


@bp.post("/api/expenses/close")
@login_required
def close_day():
    day = req_date(body())
    require_today(day)
    doc = _day(day)
    if doc.get("closed"):
        raise ApiError("This day is already closed", 409)
    if not doc.get("goal"):
        raise ApiError("Set today's goal before closing the day")
    _close_day(day, sum(i["amount"] for i in _items(day) if i["paid"]))
    return _done(_expense_payload(day))


# ---------------- savings assistant ----------------

def _pct(current: float, previous: float):
    return round((current - previous) / previous * 100, 1) if previous else None


def _coins_by_date(start: str, end: str) -> dict:
    totals: dict[str, int] = {}
    for row in db().ledger.find({"user_id": _uid(), "kind": {"$in": list(EARNING_KINDS)}, "date": {"$gte": start, "$lte": end}}):
        totals[row["date"]] = totals.get(row["date"], 0) + row["amount"]
    return totals


def _saved_by_date(start: str, end: str) -> dict:
    """Rupees kept under the goal per day. Closed days are final; an open day counts as it stands."""
    out = {}
    for doc in db().days.find({"user_id": _uid(), "date": {"$gte": start, "$lte": end}, "goal": {"$gt": 0}}):
        if doc.get("closed"):
            out[doc["date"]] = doc.get("saved", 0)
        else:
            spent = sum(i["amount"] for i in _items(doc["date"]) if i["paid"])
            out[doc["date"]] = max(doc["goal"] - spent, 0)
    return out


def _tips(month_start: str, day: str) -> list[dict]:
    paid = [i for i in db().expenses.find({"user_id": _uid(), "date": {"$gte": month_start, "$lte": day}}) if i["paid"]]
    tips = []
    if paid:
        total = sum(i["amount"] for i in paid)
        by_cat = {k: sum(i["amount"] for i in paid if i["category"] == k) for k in EXPENSE_CATEGORIES}
        top = max(by_cat, key=by_cat.get)
        tips.append({
            "title": f"{EXPENSE_CATEGORIES[top]} is your biggest spend",
            "body": f"₹{by_cat[top]:,.0f} this month, {by_cat[top] / total:.0%} of everything you've paid. "
                    f"Trimming it by a tenth keeps ₹{by_cat[top] * 0.1:,.0f} in your pocket.",
        })
        if top != "luxury" and by_cat["luxury"] / total >= 0.15:
            tips.append({
                "title": "Luxury adds up",
                "body": f"₹{by_cat['luxury']:,.0f} went on luxury this month ({by_cat['luxury'] / total:.0%}). "
                        "It is the easiest category to delay by a week and see if you still want it.",
            })
    over = [d for d in db().days.find({"user_id": _uid(), "date": {"$gte": month_start, "$lte": day}, "closed": True})
            if d.get("spent", 0) > d.get("goal", 0)]
    if over:
        extra = sum(d["spent"] - d["goal"] for d in over)
        tips.append({
            "title": f"{len(over)} day{'s' if len(over) > 1 else ''} over your goal",
            "body": f"You went ₹{extra:,.0f} past your goal in total, and those days earned no coins. "
                    "A slightly higher goal you actually hit beats a strict one you miss.",
        })
    undone = [t for t in db().tasks.find({"user_id": _uid(), "date": {"$gte": month_start, "$lt": day}}) if not t["done"]]
    if undone:
        tips.append({
            "title": "Coins left on the table",
            "body": f"{len(undone)} scheduled task{'s' if len(undone) > 1 else ''} went unticked this month, "
                    f"worth {sum(t['coins'] for t in undone):,} coins. Shorter tasks are easier to finish.",
        })
    if not tips:
        tips = [
            {"title": "Set a goal in the Expense Tracker",
             "body": "Pick what you plan to spend today. Every rupee you stay under it earns coins when you close the day."},
            {"title": "Schedule your free time",
             "body": "Tasks you finish in the Time Tracker pay up to 1.5 coins a minute."},
        ]
    return tips


@bp.get("/api/savings")
@login_required
def savings():
    day = req_date()
    settle_past_days(day)
    d = date_cls.fromisoformat(day)
    month_start = d.replace(day=1)
    prev_end = month_start - timedelta(days=1)
    prev_start = prev_end.replace(day=1)
    # Compare with the same stretch of last month, not the whole of it.
    prev_same = prev_start.replace(day=min(d.day, prev_end.day))
    yesterday = d - timedelta(days=1)

    coins = _coins_by_date(min(prev_start, yesterday).isoformat(), day)
    saved = _saved_by_date(month_start.isoformat(), day)

    def total(source, start, end):
        return sum(v for k, v in source.items() if start.isoformat() <= k <= end.isoformat())

    today_c, yest_c = coins.get(day, 0), coins.get(yesterday.isoformat(), 0)
    month_c, prev_c = total(coins, month_start, d), total(coins, prev_start, prev_same)
    return jsonify({
        "date": day,
        "coins_today": today_c,
        "coins_month": month_c,
        "day": {"delta": today_c - yest_c, "pct": _pct(today_c, yest_c)},
        "month": {"delta": month_c - prev_c, "pct": _pct(month_c, prev_c)},
        "saved_today": saved.get(day, 0),
        "saved_month": sum(saved.values()),
        "has_goal_today": day in saved,
        "tips": _tips(month_start.isoformat(), day),
    })


@bp.get("/api/savings/calendar")
@login_required
def savings_calendar():
    raw = request.args.get("month", "")
    try:
        year, month = (int(part) for part in raw.split("-"))
        first = date_cls(year, month, 1)
    except ValueError:
        raise ApiError("month must look like 2026-01")
    last = first.replace(day=calendar.monthrange(year, month)[1])
    coins = _coins_by_date(first.isoformat(), last.isoformat())
    saved = _saved_by_date(first.isoformat(), last.isoformat())
    return jsonify({
        "month": raw,
        "days": {k: {"coins": coins.get(k, 0), "saved": saved.get(k, 0)} for k in sorted(set(coins) | set(saved))},
    })
