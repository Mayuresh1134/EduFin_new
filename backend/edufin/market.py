"""A simulated market for paper trading.

There is no live price feed. Each asset's price is a fixed mathematical function
of time, so every user sees the same chart, prices survive a server restart, and
any moment in the past can be looked up without storing price history.
"""
import math
import random
import time

EPOCH = 1704067200  # 2024-01-01 00:00 UTC: where every asset's history begins
DAY = 86400
YEAR = 365.25 * DAY

# base: price in rupees at EPOCH. drift: yearly trend. vol: how much it swings.
ASSETS = {
    "BTC": {"name": "Bitcoin", "kind": "Crypto", "unit": "BTC", "base": 3_500_000, "drift": 0.22, "vol": 0.55},
    "NIFTYMF": {"name": "Nifty 50 Index Fund", "kind": "Mutual fund", "unit": "unit", "base": 210, "drift": 0.11, "vol": 0.14},
    "CRUDE": {"name": "Crude Oil", "kind": "Commodity", "unit": "barrel", "base": 6_000, "drift": 0.02, "vol": 0.32},
    "GOLD": {"name": "Gold", "kind": "Commodity", "unit": "gram", "base": 6_300, "drift": 0.09, "vol": 0.13},
    "FD": {"name": "Fixed Deposit", "kind": "Fixed income", "unit": "unit", "base": 1_000, "drift": 0.07, "vol": 0.0},
    "AAPL": {"name": "Apple", "kind": "Stock", "unit": "share", "base": 15_500, "drift": 0.13, "vol": 0.26},
}

# range name -> (how far back in seconds, or None for everything; number of points)
RANGES = {"1D": (DAY, 288), "5D": (5 * DAY, 240), "1M": (30 * DAY, 240), "1Y": (365 * DAY, 244), "ALL": (None, 260)}

# Swings of different lengths, from under an hour to most of a year. Longer swings
# are bigger, which is what makes the line look like a price and not a sine wave.
_PERIODS = [0.026, 0.13, 0.46, 2.3, 9.1, 31.0, 97.0, 290.0]  # in days


def _waves(code: str):
    rng = random.Random(f"edufin:{code}")
    return [(p * DAY, (p / 290.0) ** 0.62 * rng.uniform(0.7, 1.3), rng.uniform(0, math.tau)) for p in _PERIODS]


_WAVES = {code: _waves(code) for code in ASSETS}
_SEEDS = {code: random.Random(f"seed:{code}").randrange(1, 2**31) for code in ASSETS}


def _hash(seed: int, k: int) -> float:
    """A repeatable pseudo-random number in [-1, 1] for lattice point k."""
    x = (k * 374761393 + seed * 668265263) & 0xFFFFFFFF
    x = ((x ^ (x >> 13)) * 1274126177) & 0xFFFFFFFF
    return ((x ^ (x >> 16)) / 2**32) * 2 - 1


def _noise(seed: int, t: float, step: float) -> float:
    """Smooth random jitter: random values every `step` seconds, blended in between."""
    k = math.floor(t / step)
    f = t / step - k
    f = f * f * (3 - 2 * f)
    return _hash(seed, k) * (1 - f) + _hash(seed, k + 1) * f


def price(code: str, t: float | None = None) -> float:
    asset = ASSETS[code]
    t = time.time() if t is None else t
    years = (t - EPOCH) / YEAR
    if asset["vol"] == 0:  # the fixed deposit just accrues interest
        return round(asset["base"] * (1 + asset["drift"]) ** years, 2)
    x = asset["drift"] * years
    swing = sum(amp * math.sin(math.tau * t / period + phase) for period, amp, phase in _WAVES[code])
    jitter = 0.012 * _noise(_SEEDS[code], t, 300) + 0.03 * _noise(_SEEDS[code] + 1, t, 3600)
    x += asset["vol"] * 0.42 * (swing + jitter)
    return round(asset["base"] * math.exp(x), 2)


def history(code: str, range_name: str, t: float | None = None) -> list[dict]:
    t = time.time() if t is None else t
    span, points = RANGES[range_name]
    start = EPOCH if span is None else t - span
    step = (t - start) / (points - 1)
    out, prev = [], None
    for i in range(points):
        ts = start + i * step
        p = price(code, ts)
        move = abs(p / prev - 1) if prev else 0
        # Pretend volume: busier when the price moves more.
        volume = 0 if ASSETS[code]["vol"] == 0 else round(1000 * (0.6 + 0.4 * (_hash(_SEEDS[code] + 7, i + int(start // step)) + 1) + 60 * move))
        out.append({"t": int(ts * 1000), "p": p, "v": volume})
        prev = p
    return out


def snapshot(t: float | None = None) -> list[dict]:
    t = time.time() if t is None else t
    rows = []
    for code, asset in ASSETS.items():
        current, before = price(code, t), price(code, t - DAY)
        rows.append(
            {
                "code": code,
                "name": asset["name"],
                "kind": asset["kind"],
                "unit": asset["unit"],
                "price": current,
                "change_24h_pct": round((current / before - 1) * 100, 2),
            }
        )
    return rows
