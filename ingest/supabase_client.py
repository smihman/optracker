"""Thin wrapper around supabase-py, reading credentials from env vars.
Always uses the service key: ingestion writes bypass RLS by design (the
service role is the only writer for tickers/prices/metrics outside the
admin page).
"""

from __future__ import annotations

import os

from supabase import Client, create_client


def get_client() -> Client:
    url = os.environ["SUPABASE_URL"]
    key = os.environ["SUPABASE_SERVICE_KEY"]
    return create_client(url, key)
