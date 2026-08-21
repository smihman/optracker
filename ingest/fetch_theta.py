"""Fetches ATM call theta for a short-list of symbols: the ones
currently furthest below their 20-day high ("Creux"), i.e. the actual
candidates for the "buy the dip" workflow this tool is for.

Deliberately NOT run over the whole S&P 500 — see options_theta.py's
docstring for why (no batched options-chain endpoint in yfinance, one
HTTP call per symbol per chain lookup).

Run once a day, after ingest.py (needs metrics.drawdown_20d_pct to
already be fresh to pick the short-list).
"""

from __future__ import annotations

import argparse
import logging
import sys
from datetime import datetime, timezone

from market_calendar import is_trading_day, today_et
from options_theta import fetch_atm_call_theta
from supabase_client import get_client

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("fetch_theta")

DEFAULT_SHORTLIST_SIZE = 20


def load_shortlist(client, limit: int) -> list[dict]:
    resp = (
        client.table("metrics")
        .select("symbol, last_price, drawdown_20d_pct, tickers!inner(is_active)")
        .eq("tickers.is_active", True)
        .not_.is_("drawdown_20d_pct", "null")
        .order("drawdown_20d_pct", desc=False)
        .limit(limit)
        .execute()
    )
    return [row for row in resp.data if row.get("last_price")]


def upsert_theta(client, results) -> None:
    rows = [
        {
            "symbol": r.symbol,
            "expiration": r.expiration.isoformat(),
            "strike": r.strike,
            "underlying_price": r.underlying_price,
            "option_last_price": r.option_last_price,
            "option_bid": r.option_bid,
            "option_ask": r.option_ask,
            "option_volume": r.option_volume,
            "open_interest": r.open_interest,
            "implied_vol": r.implied_vol,
            "theta_per_day": r.theta_per_day,
        }
        for r in results
    ]
    if rows:
        client.table("option_theta").upsert(rows, on_conflict="symbol").execute()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=DEFAULT_SHORTLIST_SIZE, help="short-list size")
    args = parser.parse_args()

    now_utc = datetime.now(timezone.utc)
    if not is_trading_day(now_utc):
        logger.info("not a trading day, exiting")
        return 0

    client = get_client()
    today = today_et(now_utc)

    shortlist = load_shortlist(client, args.limit)
    if not shortlist:
        logger.warning("empty short-list (metrics.drawdown_20d_pct not populated yet?), exiting")
        return 0
    logger.info("short-list: %s", ", ".join(row["symbol"] for row in shortlist))

    results = []
    failed = []
    for row in shortlist:
        result = fetch_atm_call_theta(row["symbol"], float(row["last_price"]), today)
        if result is None:
            failed.append(row["symbol"])
            continue
        results.append(result)

    if failed:
        logger.warning("no theta computed for %d/%d symbols: %s", len(failed), len(shortlist), ", ".join(failed))

    upsert_theta(client, results)
    logger.info("upserted theta for %d symbols", len(results))
    return 0


if __name__ == "__main__":
    sys.exit(main())
