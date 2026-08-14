"""Week/month boundary computation and the call to the
`recompute_metrics` SQL function (see
supabase/migrations/0006_open_and_drop_52w.sql).

Working in plain America/New_York calendar dates rather than tz-aware
timestamps: daily closes represent whole trading days, so there's no
time-of-day ambiguity to resolve — DST doesn't affect these boundaries
the way it did when bucketing intraday timestamps.
"""

from __future__ import annotations

from datetime import date, timedelta


def week_start(today: date) -> date:
    """Monday of the current week."""
    return today - timedelta(days=today.weekday())


def month_start(today: date) -> date:
    """1st of the current month."""
    return today.replace(day=1)


def recompute_metrics(client, today: date) -> None:
    client.rpc(
        "recompute_metrics",
        {
            "week_start": week_start(today).isoformat(),
            "month_start": month_start(today).isoformat(),
        },
    ).execute()
