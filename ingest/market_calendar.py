"""NYSE session lookup via exchange_calendars — no hardcoded market
hours, no manual DST/holiday handling. The library returns the real
open/close for the current date, including early closes (e.g. day
before Thanksgiving, Dec 24).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Optional
from zoneinfo import ZoneInfo

import exchange_calendars as xcals
import pandas as pd

NYSE_TZ = ZoneInfo("America/New_York")


@dataclass
class Session:
    open: datetime  # tz-aware, UTC
    close: datetime  # tz-aware, UTC


def today_session(now_utc: datetime) -> Optional[Session]:
    """Return today's NYSE regular session (open/close in UTC), or None
    if the market is closed today (weekend, holiday)."""
    calendar = xcals.get_calendar("XNYS")
    # pd.Timestamp explicitly, rather than a raw datetime.date: exchange_calendars
    # expects its own Date type and is stricter about it across versions.
    session_date = pd.Timestamp(now_utc.astimezone(NYSE_TZ).date())

    if not calendar.is_session(session_date):
        return None

    open_ts = calendar.session_open(session_date)
    close_ts = calendar.session_close(session_date)
    return Session(open=open_ts.to_pydatetime(), close=close_ts.to_pydatetime())


def is_market_open(now_utc: datetime) -> bool:
    session = today_session(now_utc)
    if session is None:
        return False
    return session.open <= now_utc <= session.close
