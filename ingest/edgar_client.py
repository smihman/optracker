"""SEC EDGAR client for 13F-HR filings — company submissions JSON, the
filing's directory index, and its information-table XML.

SEC requires a descriptive User-Agent identifying the requester (name +
contact) on every request, or it blocks/rate-limits: see
https://www.sec.gov/os/webmaster-faq#developers. No API key involved.
"""

from __future__ import annotations

import xml.etree.ElementTree as ET
from dataclasses import dataclass
from datetime import date, datetime
from typing import Optional

import requests

USER_AGENT = "CODO-OpT personal research dashboard (contact: smihman@gmail.com)"
HEADERS = {"User-Agent": USER_AGENT}

SUBMISSIONS_URL = "https://data.sec.gov/submissions/CIK{cik10}.json"
ARCHIVES_BASE = "https://www.sec.gov/Archives/edgar/data/{cik}/{accession_nodash}/"


@dataclass
class FilingRef:
    accession_number: str
    filed_date: date
    period_of_report: date


@dataclass
class Holding:
    cusip: str
    issuer_name: str
    shares: Optional[float]
    value_usd: Optional[float]
    share_type: Optional[str]
    put_call: Optional[str]


def _get(url: str) -> requests.Response:
    resp = requests.get(url, headers=HEADERS, timeout=30)
    resp.raise_for_status()
    return resp


def list_13f_filings(cik: str) -> list[FilingRef]:
    """Most recent 13F-HR filings for a CIK, newest first. Amendments
    (13F-HR/A) are skipped — they restate a past quarter and would
    otherwise show up as a spurious extra "period" in the diff."""
    cik10 = cik.zfill(10)
    data = _get(SUBMISSIONS_URL.format(cik10=cik10)).json()
    recent = data["filings"]["recent"]
    out = []
    for form, accession, filed, period in zip(
        recent["form"], recent["accessionNumber"], recent["filingDate"], recent["reportDate"]
    ):
        if form != "13F-HR":
            continue
        out.append(
            FilingRef(
                accession_number=accession,
                filed_date=datetime.strptime(filed, "%Y-%m-%d").date(),
                period_of_report=datetime.strptime(period, "%Y-%m-%d").date(),
            )
        )
    out.sort(key=lambda f: f.period_of_report, reverse=True)
    return out


def _strip_ns(tag: str) -> str:
    return tag.split("}", 1)[-1] if "}" in tag else tag


def _find_information_table_url(cik: str, accession_number: str) -> Optional[str]:
    cik_plain = str(int(cik))
    accession_nodash = accession_number.replace("-", "")
    base = ARCHIVES_BASE.format(cik=cik_plain, accession_nodash=accession_nodash)
    index = _get(base + "index.json").json()
    items = index.get("directory", {}).get("item", [])

    def is_info_table(item: dict) -> bool:
        desc = (item.get("type") or "") + " " + (item.get("description") or "")
        return "INFORMATION TABLE" in desc.upper()

    candidates = [i for i in items if is_info_table(i)]
    if not candidates:
        # Repli : le seul autre .xml du dossier que la page de garde du
        # formulaire (primary_doc.xml) est presque toujours le tableau
        # d'informations, même quand son "type" n'est pas renseigné.
        candidates = [
            i for i in items if i["name"].lower().endswith(".xml") and i["name"] != "primary_doc.xml"
        ]
    if not candidates:
        return None
    return base + candidates[0]["name"]


def fetch_holdings(cik: str, accession_number: str) -> list[Holding]:
    """Fetch + parse a single 13F-HR's information table. Returns an
    empty list (logged by the caller) if the filing's structure doesn't
    match what's expected — SEC's filer-submitted XML isn't perfectly
    uniform across firms and years, and a partial failure here should
    never crash the whole run (same tolerance as the Yahoo ingestion)."""
    url = _find_information_table_url(cik, accession_number)
    if url is None:
        return []

    root = ET.fromstring(_get(url).content)
    holdings = []
    for info in root:
        if _strip_ns(info.tag) != "infoTable":
            continue
        fields = {_strip_ns(child.tag): child for child in info}

        def text(name: str) -> Optional[str]:
            el = fields.get(name)
            return el.text.strip() if el is not None and el.text else None

        shares = None
        share_type = None
        shares_el = fields.get("shrsOrPrnAmt")
        if shares_el is not None:
            sub = {_strip_ns(c.tag): c.text for c in shares_el}
            shares = float(sub["sshPrnamt"]) if sub.get("sshPrnamt") else None
            share_type = sub.get("sshPrnamtType")

        cusip = text("cusip")
        if not cusip:
            continue

        value_thousands = text("value")
        holdings.append(
            Holding(
                cusip=cusip,
                issuer_name=text("nameOfIssuer") or "?",
                shares=shares,
                value_usd=float(value_thousands) * 1000 if value_thousands else None,
                share_type=share_type,
                put_call=text("putCall"),
            )
        )
    return holdings
