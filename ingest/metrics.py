"""Reference-date computation (last Friday, last Friday of last month)
and the call to the `recompute_metrics` SQL function (see
supabase/migrations/0007_period_vs_friday_close.sql).

Working in plain America/New_York calendar dates rather than tz-aware
timestamps: daily closes represent whole trading days, so there's no
time-of-day ambiguity to resolve — DST doesn't affect these boundaries
the way it did when bucketing intraday timestamps.

Performance is measured against fixed reference closes rather than a
rolling high: if the reference Friday itself was a market holiday, the
SQL side falls back to the closest prior trading day (date <= target),
so these functions don't need to know about the NYSE calendar at all.
"""

from __future__ import annotations

from datetime import date, timedelta


def last_week_friday(today: date) -> date:
    """Friday of the week before the current one."""
    return today - timedelta(days=today.weekday() + 3)


def last_month_last_friday(today: date) -> date:
    """Last Friday of the previous calendar month."""
    this_month_start = today.replace(day=1)
    last_month_end = this_month_start - timedelta(days=1)
    days_since_friday = (last_month_end.weekday() - 4) % 7
    return last_month_end - timedelta(days=days_since_friday)


def recompute_metrics(client, today: date) -> None:
    client.rpc(
        "recompute_metrics",
        {
            "last_week_friday": last_week_friday(today).isoformat(),
            "last_month_friday": last_month_last_friday(today).isoformat(),
        },
    ).execute()
