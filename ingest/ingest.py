"""Main ingestion entrypoint, run once a day by GitHub Actions shortly
after the NYSE close. Idempotent: safe to re-run, safe to run on a
closed day (exits early after checking the real NYSE calendar).

Fetches a small trailing window (default 5 days) rather than just
today's close: if a cron run is skipped or fails, the next successful
run automatically backfills the gap via upsert. Pass --period 1y once
for the initial historical backfill (see README) — an explicit period
override always runs regardless of what day it is, so the backfill
can be triggered manually on a weekend.
"""

from __future__ import annotations

import argparse
import logging
import sys
from datetime import datetime, timezone

from market_calendar import is_trading_day, today_et
from metrics import recompute_metrics
from price_provider import YahooFinanceProvider
from supabase_client import get_client

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("ingest")

DEFAULT_PERIOD = "5d"
UPSERT_BATCH_SIZE = 500


def load_active_symbols(client) -> list[str]:
    resp = client.table("tickers").select("symbol").eq("is_active", True).execute()
    return [row["symbol"] for row in resp.data]


def upsert_daily_closes(client, closes) -> None:
    rows = [
        {
            "symbol": c.symbol,
            "date": c.date.isoformat(),
            "close": c.close,
            "volume": c.volume,
        }
        for c in closes
    ]
    for i in range(0, len(rows), UPSERT_BATCH_SIZE):
        batch = rows[i : i + UPSERT_BATCH_SIZE]
        client.table("daily_closes").upsert(batch, on_conflict="symbol,date").execute()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--period",
        default=DEFAULT_PERIOD,
        help='yfinance period to fetch (default "5d" for the routine daily run; use "1y" once for the initial backfill)',
    )
    args = parser.parse_args()

    now_utc = datetime.now(timezone.utc)

    # Only gate on "is today a trading day" for the routine run. An
    # explicit --period override (backfill) should run regardless of
    # what day it's launched on.
    if args.period == DEFAULT_PERIOD and not is_trading_day(now_utc):
        logger.info("not a trading day, exiting")
        return 0

    client = get_client()

    symbols = load_active_symbols(client)
    if not symbols:
        logger.warning("no active tickers found, exiting (run refresh_tickers.py first)")
        return 0
    logger.info("loaded %d active tickers", len(symbols))

    provider = YahooFinanceProvider()
    closes = provider.fetch_daily_closes(symbols, period=args.period)
    logger.info("fetched %d daily close rows (period=%s)", len(closes), args.period)

    seen_symbols = {c.symbol for c in closes}
    missing = sorted(set(symbols) - seen_symbols)
    if missing:
        logger.warning(
            "no data for %d/%d symbols: %s", len(missing), len(symbols), ", ".join(missing)
        )

    if not closes:
        logger.warning("no closes to upsert, skipping metrics recompute")
        return 0

    upsert_daily_closes(client, closes)
    logger.info("upserted %d daily close rows", len(closes))

    recompute_metrics(client, today_et(now_utc))
    logger.info("metrics recomputed")

    logger.info("run summary: %d/%d symbols ok", len(seen_symbols), len(symbols))
    return 0


if __name__ == "__main__":
    sys.exit(main())
