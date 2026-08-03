"""Week/month boundary computation (America/New_York, tz-aware) and the
call to the `recompute_metrics` SQL function (see
supabase/migrations/0003_metrics_function.sql). The heavy aggregation
runs in Postgres, not in Python — no need to pull the whole intraday
history over the wire just to take a max().
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

NYSE_TZ = ZoneInfo("America/New_York")


def week_start_utc(now_utc: datetime) -> datetime:
    """Monday 00:00 ET of the current week, as a UTC instant."""
    now_et = now_utc.astimezone(NYSE_TZ)
    monday_et = (now_et - timedelta(days=now_et.weekday())).replace(
        hour=0, minute=0, second=0, microsecond=0
    )
    return monday_et.astimezone(timezone.utc)


def month_start_utc(now_utc: datetime) -> datetime:
    """1st of the current month, 00:00 ET, as a UTC instant."""
    now_et = now_utc.astimezone(NYSE_TZ)
    first_of_month_et = now_et.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    return first_of_month_et.astimezone(timezone.utc)


def recompute_metrics(client, now_utc: datetime) -> None:
    client.rpc(
        "recompute_metrics",
        {
            "week_start": week_start_utc(now_utc).isoformat(),
            "month_start": month_start_utc(now_utc).isoformat(),
        },
    ).execute()
