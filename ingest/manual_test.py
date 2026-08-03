"""Manual smoke test for the PriceProvider + market calendar, on a
handful of symbols. Does not touch Supabase.

Run:
    cd ingest
    python manual_test.py
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone

from market_calendar import today_session
from price_provider import YahooFinanceProvider

logging.basicConfig(level=logging.INFO)

SYMBOLS = ["AAPL", "MSFT", "GOOGL", "AMZN", "NVDA"]


def main() -> None:
    now = datetime.now(timezone.utc)
    session = today_session(now)
    print(f"session today: {session}")

    provider = YahooFinanceProvider()
    points = provider.fetch_intraday(SYMBOLS)
    print(f"got {len(points)} points for {len(SYMBOLS)} symbols")
    for p in points[:5]:
        print(p)


if __name__ == "__main__":
    main()
