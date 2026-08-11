"""Manual smoke test for the PriceProvider + market calendar, on a
handful of symbols. Does not touch Supabase.

Run:
    cd ingest
    python manual_test.py
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone

from market_calendar import is_trading_day, today_et
from price_provider import YahooFinanceProvider

logging.basicConfig(level=logging.INFO)

SYMBOLS = ["AAPL", "MSFT", "GOOGL", "AMZN", "NVDA"]


def main() -> None:
    now = datetime.now(timezone.utc)
    print(f"today (ET): {today_et(now)}, trading day: {is_trading_day(now)}")

    provider = YahooFinanceProvider()
    closes = provider.fetch_daily_closes(SYMBOLS, period="5d")
    print(f"got {len(closes)} rows for {len(SYMBOLS)} symbols")
    for c in closes[:10]:
        print(c)


if __name__ == "__main__":
    main()
