"""Abstraction over a market data source, so Yahoo Finance can be
swapped for an alternative (Twelve Data, Alpaca, ...) without touching
the ingestion script if it ever breaks.
"""

from __future__ import annotations

import logging
from abc import ABC, abstractmethod
from dataclasses import dataclass
from datetime import datetime
from typing import Optional

import pandas as pd
import yfinance as yf

logger = logging.getLogger(__name__)


@dataclass
class PricePoint:
    symbol: str
    ts: datetime  # tz-aware, UTC
    price: float
    volume: Optional[int]


class PriceProvider(ABC):
    @abstractmethod
    def fetch_intraday(self, symbols: list[str]) -> list[PricePoint]:
        """Return every intraday price point available for today for the
        given symbols. Callers are responsible for filtering to the
        actual session window."""
        raise NotImplementedError


class YahooFinanceProvider(PriceProvider):
    """Wraps yfinance. Always fetches symbols in grouped batches — never
    loop one API call per symbol, Yahoo's unofficial endpoint rate-limits
    hard on that pattern.
    """

    def __init__(self, batch_size: int = 200):
        self.batch_size = batch_size

    def fetch_intraday(self, symbols: list[str]) -> list[PricePoint]:
        if not symbols:
            return []

        points: list[PricePoint] = []
        failed: list[str] = []

        for batch in _chunk(symbols, self.batch_size):
            try:
                df = yf.download(
                    tickers=batch,
                    period="1d",
                    interval="1m",
                    group_by="ticker",
                    auto_adjust=False,
                    prepost=False,
                    threads=True,
                    progress=False,
                )
            except Exception:
                logger.exception("yf.download failed for a batch of %d symbols", len(batch))
                failed.extend(batch)
                continue

            if df.empty:
                logger.warning("empty dataframe for a batch of %d symbols", len(batch))
                failed.extend(batch)
                continue

            for symbol in batch:
                symbol_points, ok = _extract_symbol_points(df, symbol)
                if not ok:
                    failed.append(symbol)
                points.extend(symbol_points)

        if failed:
            logger.warning(
                "no data for %d/%d symbols: %s", len(failed), len(symbols), ", ".join(failed)
            )

        return points


def _chunk(items: list[str], size: int):
    for i in range(0, len(items), size):
        yield items[i : i + size]


def _extract_symbol_points(df: pd.DataFrame, symbol: str) -> tuple[list[PricePoint], bool]:
    if isinstance(df.columns, pd.MultiIndex):
        if symbol not in df.columns.get_level_values(0):
            return [], False
        sub = df[symbol]
    else:
        # yfinance sometimes returns flat columns when a batch has a
        # single symbol, regardless of group_by.
        sub = df

    sub = sub.dropna(subset=["Close"])
    if sub.empty:
        return [], False

    out: list[PricePoint] = []
    for ts, row in sub.iterrows():
        ts_utc = ts.tz_convert("UTC") if ts.tzinfo is not None else ts.tz_localize("UTC")
        volume = row.get("Volume")
        out.append(
            PricePoint(
                symbol=symbol,
                ts=ts_utc.to_pydatetime(),
                price=float(row["Close"]),
                volume=int(volume) if pd.notna(volume) else None,
            )
        )
    return out, True
