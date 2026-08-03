"""Main ingestion entrypoint, run every 30 minutes by GitHub Actions
during a wide UTC window covering both EST and EDT. Idempotent: safe to
re-run, safe to run outside actual session hours (it just exits early
once it checks the real NYSE calendar).
"""

from __future__ import annotations

import logging
import sys
from datetime import datetime, timedelta, timezone

from market_calendar import today_session
from metrics import recompute_metrics
from price_provider import YahooFinanceProvider
from supabase_client import get_client

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("ingest")

PRICE_RETENTION_DAYS = 90
UPSERT_BATCH_SIZE = 500


def load_active_symbols(client) -> list[str]:
    resp = client.table("tickers").select("symbol").eq("is_active", True).execute()
    return [row["symbol"] for row in resp.data]


def upsert_prices(client, points) -> None:
    rows = [
        {
            "symbol": p.symbol,
            "ts": p.ts.isoformat(),
            "price": p.price,
            "volume": p.volume,
        }
        for p in points
    ]
    for i in range(0, len(rows), UPSERT_BATCH_SIZE):
        batch = rows[i : i + UPSERT_BATCH_SIZE]
        client.table("prices").upsert(batch, on_conflict="symbol,ts").execute()


def purge_old_prices(client, now_utc: datetime, retention_days: int = PRICE_RETENTION_DAYS) -> None:
    cutoff = (now_utc - timedelta(days=retention_days)).isoformat()
    client.table("prices").delete().lt("ts", cutoff).execute()


def main() -> int:
    now_utc = datetime.now(timezone.utc)

    session = today_session(now_utc)
    if session is None:
        logger.info("market closed today (weekend/holiday), exiting")
        return 0
    if not (session.open <= now_utc <= session.close):
        logger.info(
            "outside regular session (open=%s close=%s now=%s), exiting",
            session.open, session.close, now_utc,
        )
        return 0

    client = get_client()

    symbols = load_active_symbols(client)
    if not symbols:
        logger.warning("no active tickers found, exiting (run refresh_tickers.py first)")
        return 0
    logger.info("loaded %d active tickers", len(symbols))

    provider = YahooFinanceProvider()
    points = provider.fetch_intraday(symbols)

    in_session = [p for p in points if session.open <= p.ts <= session.close]
    logger.info("fetched %d raw points, %d within session window", len(points), len(in_session))

    seen_symbols = {p.symbol for p in in_session}
    missing = sorted(set(symbols) - seen_symbols)
    if missing:
        logger.warning(
            "no in-session data for %d/%d symbols: %s", len(missing), len(symbols), ", ".join(missing)
        )

    if not in_session:
        logger.warning("no in-session points to upsert, skipping metrics recompute")
        return 0

    upsert_prices(client, in_session)
    logger.info("upserted %d price points", len(in_session))

    recompute_metrics(client, now_utc)
    logger.info("metrics recomputed")

    purge_old_prices(client, now_utc)
    logger.info("purged prices older than %d days", PRICE_RETENTION_DAYS)

    logger.info(
        "run summary: %d/%d symbols ok, session=%s..%s",
        len(seen_symbols), len(symbols), session.open, session.close,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
