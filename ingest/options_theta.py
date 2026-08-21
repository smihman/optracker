"""ATM call theta for a single symbol, via yfinance's options chain +
a Black-Scholes calculation — Yahoo Finance exposes option prices and
implied volatility, but no Greeks directly.

Approximate by design: fixed risk-free rate (not fetched live),
dividend yield ignored (q=0 — pulling per-symbol dividend data would
mean yet another per-symbol Yahoo call), implied volatility taken
as-is from Yahoo's (often thin/stale) options quotes. Good enough for
screening, not a substitute for what a broker shows.

Uses only the stdlib `math` module for the normal CDF/PDF — no new
dependency (scipy) just for this.
"""

from __future__ import annotations

import logging
import math
from dataclasses import dataclass
from datetime import date, datetime
from typing import Optional

import yfinance as yf

logger = logging.getLogger(__name__)

# Rough short-term T-bill yield. Not fetched live — update by hand if
# it drifts far from reality; theta is not very sensitive to it.
RISK_FREE_RATE = 0.045

# "~30-45 jours" per the brief: search this window first, fall back to
# whatever expiration is closest to the midpoint if none is in range.
TARGET_DAYS_MIN = 25
TARGET_DAYS_MAX = 50
TARGET_DAYS_MID = 37


@dataclass
class ThetaResult:
    symbol: str
    expiration: date
    strike: float
    underlying_price: float
    option_last_price: Optional[float]
    option_bid: Optional[float]
    option_ask: Optional[float]
    option_volume: Optional[int]
    open_interest: Optional[int]
    implied_vol: Optional[float]
    theta_per_day: Optional[float]


def _norm_cdf(x: float) -> float:
    return 0.5 * (1 + math.erf(x / math.sqrt(2)))


def _norm_pdf(x: float) -> float:
    return math.exp(-x * x / 2) / math.sqrt(2 * math.pi)


def call_theta_per_day(spot: float, strike: float, days_to_expiry: int, sigma: float) -> Optional[float]:
    """Black-Scholes call theta, expressed in $/day (annual theta / 365)."""
    t_years = days_to_expiry / 365
    if t_years <= 0 or sigma is None or sigma <= 0 or spot <= 0 or strike <= 0:
        return None
    sqrt_t = math.sqrt(t_years)
    d1 = (math.log(spot / strike) + (RISK_FREE_RATE + sigma * sigma / 2) * t_years) / (sigma * sqrt_t)
    d2 = d1 - sigma * sqrt_t
    theta_per_year = -spot * _norm_pdf(d1) * sigma / (2 * sqrt_t) - RISK_FREE_RATE * strike * math.exp(
        -RISK_FREE_RATE * t_years
    ) * _norm_cdf(d2)
    return theta_per_year / 365


def _pick_expiration(expirations: list[str], today: date) -> Optional[date]:
    candidates: list[tuple[int, date]] = []
    for raw in expirations:
        try:
            d = datetime.strptime(raw, "%Y-%m-%d").date()
        except ValueError:
            continue
        days_out = (d - today).days
        if days_out <= 0:
            continue
        candidates.append((days_out, d))

    if not candidates:
        return None

    in_window = [c for c in candidates if TARGET_DAYS_MIN <= c[0] <= TARGET_DAYS_MAX]
    pool = in_window or candidates
    pool.sort(key=lambda c: abs(c[0] - TARGET_DAYS_MID))
    return pool[0][1]


def fetch_atm_call_theta(symbol: str, underlying_price: float, today: date) -> Optional[ThetaResult]:
    """One symbol, one options-chain fetch. Never call this in a loop
    over the full universe — see the module docstring."""
    ticker = yf.Ticker(symbol)

    try:
        expirations = list(ticker.options)
    except Exception:
        logger.warning("no options data available for %s", symbol)
        return None
    if not expirations:
        return None

    expiration = _pick_expiration(expirations, today)
    if expiration is None:
        return None

    try:
        chain = ticker.option_chain(expiration.isoformat())
    except Exception:
        logger.warning("failed to fetch option chain for %s (%s)", symbol, expiration)
        return None

    calls = chain.calls
    if calls.empty:
        return None

    calls = calls.assign(strike_diff=(calls["strike"] - underlying_price).abs())
    atm = calls.sort_values("strike_diff").iloc[0]

    iv = float(atm["impliedVolatility"]) if atm.get("impliedVolatility") else None
    days_out = (expiration - today).days
    theta = call_theta_per_day(underlying_price, float(atm["strike"]), days_out, iv) if iv else None

    def _opt_float(col: str) -> Optional[float]:
        val = atm.get(col)
        return float(val) if val is not None and not (isinstance(val, float) and math.isnan(val)) else None

    def _opt_int(col: str) -> Optional[int]:
        val = _opt_float(col)
        return int(val) if val is not None else None

    return ThetaResult(
        symbol=symbol,
        expiration=expiration,
        strike=float(atm["strike"]),
        underlying_price=underlying_price,
        option_last_price=_opt_float("lastPrice"),
        option_bid=_opt_float("bid"),
        option_ask=_opt_float("ask"),
        option_volume=_opt_int("volume"),
        open_interest=_opt_int("openInterest"),
        implied_vol=iv,
        theta_per_day=theta,
    )
