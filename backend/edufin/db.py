"""Database connection, indexes and first-run seed data."""
import sys

from pymongo import ASCENDING, DESCENDING, MongoClient
from pymongo.errors import PyMongoError

# The three offers from the design. They are samples: no retailer is connected,
# so redeeming one produces a demonstration code, not a working voucher.
SAMPLE_REWARDS = [
    {"title": "Flipkart 25% off gift card", "brand": "Flipkart", "discount": 25, "cost": 4000},
    {"title": "Amazon 10% off gift card", "brand": "Amazon", "discount": 10, "cost": 1000},
    {"title": "Coursera 25% off gift card", "brand": "Coursera", "discount": 25, "cost": 5000},
]


def connect(config: dict):
    if config["DB_MODE"] == "memory":
        import mongomock

        return mongomock.MongoClient()["edufin"]

    client = MongoClient(config["MONGO_URI"], serverSelectionTimeoutMS=3000)
    try:
        client.admin.command("ping")
    except PyMongoError as exc:
        sys.exit(
            f"Could not reach MongoDB at {config['MONGO_URI']} ({type(exc).__name__}).\n\n"
            "Start MongoDB, or fix MONGO_URI in backend/.env.\n"
            "To try the app without MongoDB, set EDUFIN_DB=memory "
            "(data is then lost when the server stops)."
        )
    return client.get_default_database(default="edufin")


def prepare(db) -> None:
    """Create indexes and seed the rewards catalog. Safe to run on every start."""
    db.users.create_index("email", unique=True)
    db.days.create_index([("user_id", ASCENDING), ("date", ASCENDING)], unique=True)
    db.tasks.create_index([("user_id", ASCENDING), ("date", ASCENDING)])
    db.expenses.create_index([("user_id", ASCENDING), ("date", ASCENDING)])
    db.ledger.create_index([("user_id", ASCENDING), ("date", ASCENDING)])
    db.ledger.create_index([("user_id", ASCENDING), ("ts", DESCENDING)])
    db.holdings.create_index([("user_id", ASCENDING), ("asset", ASCENDING)], unique=True)
    db.trades.create_index([("user_id", ASCENDING), ("ts", DESCENDING)])
    db.redemptions.create_index([("user_id", ASCENDING), ("ts", DESCENDING)])

    if db.rewards.count_documents({}) == 0:
        db.rewards.insert_many([{**r, "active": True} for r in SAMPLE_REWARDS])
