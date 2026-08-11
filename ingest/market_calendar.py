"""NYSE trading-day check via exchange_calendars — no hardcoded market
hours, no manual DST/holiday handling. Ingestion now runs once a day
after close, so all we need is "was today a session", not the exact
open/close times (that only mattered for filtering intraday bars).
"""

from __future__ import annotations

from datetime import date, datetime
from zoneinfo import ZoneInfo

import exchange_calendars as xcals
import pandas as pd

NYSE_TZ = ZoneInfo("America/New_York")


def today_et(now_utc: datetime) -> date:
    return now_utc.astimezone(NYSE_TZ).date()


def is_trading_day(now_utc: datetime) -> bool:
    calendar = xcals.get_calendar("XNYS")
    # pd.Timestamp explicitly, rather than a raw datetime.date: exchange_calendars
    # expects its own Date type and is stricter about it across versions.
    session_date = pd.Timestamp(today_et(now_utc))
    return bool(calendar.is_session(session_date))
