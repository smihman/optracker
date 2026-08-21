"""Ingests SEC EDGAR 13F-HR filings for a curated list of investors
(the `investors` table) and stores each quarter's raw holdings — the
quarter-over-quarter diff itself is computed on read, by the
`portfolio_moves` SQL function (see migration 0010).

Cadence: 13F filings are quarterly, published up to 45 days after
quarter end — this is NOT a daily signal like the rest of the pipeline.
A weekly cron (.github/workflows/portfolios.yml) is more than enough to
catch a new filing promptly; idempotent (unique on
investor_cik+period_of_report and a delete+reinsert of that filing's
holdings) so re-running is always safe.
"""

from __future__ import annotations

import logging
import re
import sys

from edgar_client import fetch_holdings, list_13f_filings
from supabase_client import get_client

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("fetch_portfolios")

UPSERT_BATCH_SIZE = 500

_PUNCT = re.compile(r"[^A-Z0-9 ]")
_SUFFIXES = re.compile(
    r"\b(INC|INCORPORATED|CORP|CORPORATION|CO|COMPANY|LTD|LIMITED|PLC|LLC|LP|THE|CLASS [A-Z]|COM|SPONSORED|ADR)\b"
)


def normalize_name(name: str) -> str:
    """Best-effort normalization for matching 13F issuer names (often
    all-caps, abbreviated) against our own `tickers.name` (full legal
    names scraped from Wikipedia). Exact match only after normalizing —
    no fuzzy/edit-distance matching, so most rows will simply have no
    match, and that's fine: the raw issuer name is always shown as-is."""
    n = _PUNCT.sub(" ", name.upper())
    n = _SUFFIXES.sub(" ", n)
    return re.sub(r"\s+", " ", n).strip()


def load_symbol_lookup(client) -> dict[str, str]:
    resp = client.table("tickers").select("symbol, name").execute()
    lookup: dict[str, str] = {}
    for row in resp.data:
        if row.get("name"):
            lookup[normalize_name(row["name"])] = row["symbol"]
    return lookup


def load_investors(client) -> list[dict]:
    resp = client.table("investors").select("cik, name").eq("is_active", True).execute()
    return resp.data


def already_ingested_periods(client, cik: str) -> set:
    resp = client.table("portfolio_filings").select("period_of_report").eq("investor_cik", cik).execute()
    return {row["period_of_report"] for row in resp.data}


def ingest_filing(client, cik: str, filing, symbol_lookup: dict[str, str]) -> None:
    holdings = fetch_holdings(cik, filing.accession_number)
    if not holdings:
        logger.warning("no holdings parsed for CIK %s, accession %s — skipping", cik, filing.accession_number)
        return

    total_value = sum(h.value_usd for h in holdings if h.value_usd) or None

    client.table("portfolio_filings").upsert(
        {
            "investor_cik": cik,
            "period_of_report": filing.period_of_report.isoformat(),
            "filed_date": filing.filed_date.isoformat(),
            "accession_number": filing.accession_number,
            "total_value_usd": total_value,
        },
        on_conflict="investor_cik,period_of_report",
    ).execute()

    # Re-sélectionné plutôt que déduit de la réponse de l'upsert : les
    # clients PostgREST ne renvoient pas systématiquement la ligne
    # (representation) selon comment l'upsert est invoqué, alors qu'un
    # select juste après est sans ambiguïté.
    filing_row = (
        client.table("portfolio_filings")
        .select("id")
        .eq("investor_cik", cik)
        .eq("period_of_report", filing.period_of_report.isoformat())
        .single()
        .execute()
    )
    filing_id = filing_row.data["id"]

    rows = [
        {
            "filing_id": filing_id,
            "cusip": h.cusip,
            "issuer_name": h.issuer_name,
            "matched_symbol": symbol_lookup.get(normalize_name(h.issuer_name)),
            "shares": h.shares,
            "value_usd": h.value_usd,
            "share_type": h.share_type,
            "put_call": h.put_call,
            "pct_of_portfolio": (h.value_usd / total_value * 100) if h.value_usd and total_value else None,
        }
        for h in holdings
    ]
    # Purge + réinsertion plutôt qu'un upsert ligne à ligne : un même
    # CUSIP peut apparaître plusieurs fois dans un même 13F (put et
    # call, classes d'actions différentes) sans clé naturelle unique
    # utilisable en on_conflict, et ré-ingérer un dépôt déjà présent
    # (relance manuelle après correction d'un bug) doit rester idempotent.
    client.table("portfolio_holdings").delete().eq("filing_id", filing_id).execute()
    for i in range(0, len(rows), UPSERT_BATCH_SIZE):
        client.table("portfolio_holdings").insert(rows[i : i + UPSERT_BATCH_SIZE]).execute()

    logger.info("ingested %d holdings for CIK %s, period %s", len(rows), cik, filing.period_of_report)


def main() -> int:
    client = get_client()
    investors = load_investors(client)
    if not investors:
        logger.warning("no active investors configured, exiting")
        return 0

    symbol_lookup = load_symbol_lookup(client)
    logger.info("loaded %d ticker names for best-effort matching", len(symbol_lookup))

    for inv in investors:
        cik = inv["cik"]
        try:
            filings = list_13f_filings(cik)
        except Exception:
            logger.exception("failed to list filings for %s (CIK %s)", inv["name"], cik)
            continue

        if not filings:
            logger.info("no 13F-HR filings found for %s", inv["name"])
            continue

        known_periods = already_ingested_periods(client, cik)
        new_filings = [f for f in filings if f.period_of_report.isoformat() not in known_periods]
        if not new_filings:
            logger.info("%s: already up to date (latest period %s)", inv["name"], filings[0].period_of_report)
            continue

        # D'habitude un seul nouveau trimestre par run (cron hebdo), mais
        # on ingère tout le retard trouvé, du plus ancien au plus récent,
        # pour que le diff trimestre-sur-trimestre reste cohérent même
        # après une longue pause du pipeline.
        for f in sorted(new_filings, key=lambda f: f.period_of_report):
            try:
                ingest_filing(client, cik, f, symbol_lookup)
            except Exception:
                logger.exception("failed to ingest %s period %s", inv["name"], f.period_of_report)

    return 0


if __name__ == "__main__":
    sys.exit(main())
