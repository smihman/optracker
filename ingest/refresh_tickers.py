"""Monthly refresh of the S&P 500 constituent list, run by
.github/workflows/refresh-tickers.yml. Diffs the current Wikipedia
table against the `tickers` table:
- new entrants are inserted (is_active=true)
- removals are soft-deleted (is_active=false) to keep their price
  history intact
- symbols returning to the index are reactivated

Also used to seed the `tickers` table on first setup — run this once
manually (workflow_dispatch, or locally) before the first price
ingestion, otherwise ingest.py has nothing to fetch.
"""

from __future__ import annotations

import logging
import sys

import pandas as pd
import requests

from supabase_client import get_client

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("refresh_tickers")

WIKI_URL = "https://en.wikipedia.org/wiki/List_of_S%26P_500_companies"
# Wikipedia returns 403 for the default urllib/requests user agent used by
# pandas.read_html — fetch the page ourselves with a browser-like UA first.
USER_AGENT = (
    "Mozilla/5.0 (compatible; sp500-drawdown-dashboard/1.0; "
    "personal research tool, not a bot farm)"
)

# Yahoo Finance uses '-' where the official ticker uses '.', e.g. BRK.B -> BRK-B.
# Add to this map if another symbol turns out to need a specific override.
SYMBOL_OVERRIDES = {
    "BRK.B": "BRK-B",
    "BF.B": "BF-B",
}


def fetch_current_constituents() -> list[dict]:
    resp = requests.get(WIKI_URL, headers={"User-Agent": USER_AGENT}, timeout=30)
    resp.raise_for_status()
    tables = pd.read_html(resp.text)
    df = tables[0]
    out = []
    for _, row in df.iterrows():
        raw_symbol = str(row["Symbol"]).strip()
        symbol = SYMBOL_OVERRIDES.get(raw_symbol, raw_symbol.replace(".", "-"))
        out.append(
            {
                "symbol": symbol,
                "name": str(row["Security"]).strip(),
                "sector": str(row["GICS Sector"]).strip(),
            }
        )
    return out


def main() -> int:
    client = get_client()

    current = fetch_current_constituents()
    if not current:
        logger.error("fetched 0 constituents from Wikipedia, aborting to avoid wiping tickers")
        return 1
    current_symbols = {row["symbol"] for row in current}
    logger.info("fetched %d constituents from Wikipedia", len(current_symbols))

    existing = client.table("tickers").select("symbol, is_active").execute().data
    existing_symbols = {row["symbol"] for row in existing}
    existing_active = {row["symbol"] for row in existing if row["is_active"]}

    new_entrants = [row for row in current if row["symbol"] not in existing_symbols]
    returning = [s for s in current_symbols if s in existing_symbols and s not in existing_active]
    leaving = [s for s in existing_active if s not in current_symbols]

    if new_entrants:
        client.table("tickers").upsert(new_entrants, on_conflict="symbol").execute()
        logger.info(
            "inserted %d new entrants: %s", len(new_entrants), ", ".join(r["symbol"] for r in new_entrants)
        )

    for symbol in returning:
        client.table("tickers").update({"is_active": True}).eq("symbol", symbol).execute()
    if returning:
        logger.info("reactivated %d returning tickers: %s", len(returning), ", ".join(returning))

    for symbol in leaving:
        client.table("tickers").update({"is_active": False}).eq("symbol", symbol).execute()
    if leaving:
        logger.info("deactivated %d departing tickers: %s", len(leaving), ", ".join(leaving))

    logger.info(
        "refresh summary: %d total, %d new, %d reactivated, %d deactivated",
        len(current_symbols), len(new_entrants), len(returning), len(leaving),
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
