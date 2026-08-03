-- ============================================================
-- 0003_metrics_function.sql
-- Fonction appelée par le script d'ingestion (via .rpc()) pour
-- recalculer last_price / week_high / month_high / drawdowns en une
-- seule requête SQL côté serveur, plutôt que de rapatrier tout
-- l'historique intraday côté Python pour l'agréger.
--
-- week_start / month_start sont calculés côté Python en tz-aware
-- America/New_York puis convertis en UTC avant l'appel (voir
-- ingest/metrics.py) — cette fonction ne fait aucune hypothèse de
-- fuseau, elle compare juste des timestamptz.
-- ============================================================

create or replace function recompute_metrics(week_start timestamptz, month_start timestamptz)
returns void
language sql
as $$
  insert into metrics (symbol, last_price, week_high, month_high, week_drawdown_pct, month_drawdown_pct, updated_at)
  select
    t.symbol,
    lp.last_price,
    wk.week_high,
    mo.month_high,
    round((lp.last_price / nullif(wk.week_high, 0) - 1) * 100, 4),
    round((lp.last_price / nullif(mo.month_high, 0) - 1) * 100, 4),
    now()
  from tickers t
  join lateral (
    select price as last_price
    from prices
    where symbol = t.symbol
    order by ts desc
    limit 1
  ) lp on true
  join lateral (
    select max(price) as week_high
    from prices
    where symbol = t.symbol and ts >= week_start
  ) wk on true
  join lateral (
    select max(price) as month_high
    from prices
    where symbol = t.symbol and ts >= month_start
  ) mo on true
  where t.is_active
  on conflict (symbol) do update set
    last_price = excluded.last_price,
    week_high = excluded.week_high,
    month_high = excluded.month_high,
    week_drawdown_pct = excluded.week_drawdown_pct,
    month_drawdown_pct = excluded.month_drawdown_pct,
    updated_at = excluded.updated_at;
$$;
