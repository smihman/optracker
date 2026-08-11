"""Abstraction over a market data source, so Yahoo Finance can be
swapped for an alternative (Twelve Data, Alpaca, ...) without touching
the ingestion script if it ever breaks.
"""

from __future__ import annotations

import logging
from abc import ABC, abstractmethod
from dataclasses import dataclass
from datetime import date
from typing import Optional

import pandas as pd
import yfinance as yf

logger = logging.getLogger(__name__)


@dataclass
class DailyClose:
    symbol: str
    date: date
    close: float
    volume: Optional[int]


class PriceProvider(ABC):
    @abstractmethod
    def fetch_daily_closes(self, symbols: list[str], period: str = "5d") -> list[DailyClose]:
        """Return daily close prices for the given symbols over `period`
        (a yfinance period string). "5d" is used for the routine daily
        run — a small trailing window so a missed/failed cron day
        self-heals via upsert on the next successful run. "1y" is used
        once for the initial historical backfill (see README).
        """
        raise NotImplementedError


class YahooFinanceProvider(PriceProvider):
    """Wraps yfinance. Always fetches symbols in grouped batches — never
    loop one API call per symbol, Yahoo's unofficial endpoint rate-limits
    hard on that pattern.
    """

    def __init__(self, batch_size: int = 200):
        self.batch_size = batch_size

    def fetch_daily_closes(self, symbols: list[str], period: str = "5d") -> list[DailyClose]:
        if not symbols:
            return []

        closes: list[DailyClose] = []
        failed: list[str] = []

        for batch in _chunk(symbols, self.batch_size):
            try:
                df = yf.download(
                    tickers=batch,
                    period=period,
                    interval="1d",
                    group_by="ticker",
                    auto_adjust=False,
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
                symbol_closes, ok = _extract_symbol_closes(df, symbol)
                if not ok:
                    failed.append(symbol)
                closes.extend(symbol_closes)

        if failed:
            logger.warning(
                "no data for %d/%d symbols: %s", len(failed), len(symbols), ", ".join(failed)
            )

        return closes


def _chunk(items: list[str], size: int):
    for i in range(0, len(items), size):
        yield items[i : i + size]


def _extract_symbol_closes(df: pd.DataFrame, symbol: str) -> tuple[list[DailyClose], bool]:
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

    out: list[DailyClose] = []
    for ts, row in sub.iterrows():
        volume = row.get("Volume")
        out.append(
            DailyClose(
                symbol=symbol,
                date=ts.date(),
                close=float(row["Close"]),
                volume=int(volume) if pd.notna(volume) else None,
            )
        )
    return out, True
