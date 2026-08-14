-- ============================================================
-- 0006_open_and_drop_52w.sql
-- - Ajoute le prix d'ouverture du jour (`daily_closes.open`) pour
--   calculer la performance intraday (vs ouverture), utile pour
--   repérer un creux le jour même plutôt que juste sur la semaine/le
--   mois.
-- - Retire l'indicateur 52 semaines (pas utile pour un usage options
--   court terme) : colonnes, index, et logique de recompute_metrics.
-- - La logique semaine/mois (décote depuis le plus-haut de la
--   fenêtre) est inchangée.
-- ============================================================

alter table daily_closes add column if not exists open numeric;

alter table metrics
  add column if not exists today_change_pct numeric,
  drop column if exists high_52w,
  drop column if exists drawdown_52w_pct;

drop index if exists metrics_drawdown_52w_idx;

-- Signature différente (3 params -> 2) : CREATE OR REPLACE ne
-- remplace pas une fonction avec un nombre d'arguments différent, il
-- faut dropper explicitement l'ancienne version pour ne pas la
-- laisser traîner.
drop function if exists recompute_metrics(date, date, date);

create or replace function recompute_metrics(week_start date, month_start date)
returns void
language sql
as $$
  insert into metrics (
    symbol, last_price, last_date, today_change_pct, week_high, month_high,
    week_drawdown_pct, month_drawdown_pct, updated_at
  )
  select
    t.symbol,
    lp.close,
    lp.date,
    round((lp.close / nullif(lp.open, 0) - 1) * 100, 4),
    wk.week_high,
    mo.month_high,
    round((lp.close / nullif(wk.week_high, 0) - 1) * 100, 4),
    round((lp.close / nullif(mo.month_high, 0) - 1) * 100, 4),
    now()
  from tickers t
  join lateral (
    select close, open, date from daily_closes
    where symbol = t.symbol order by date desc limit 1
  ) lp on true
  join lateral (
    select max(close) as week_high from daily_closes
    where symbol = t.symbol and date >= week_start
  ) wk on true
  join lateral (
    select max(close) as month_high from daily_closes
    where symbol = t.symbol and date >= month_start
  ) mo on true
  where t.is_active
  on conflict (symbol) do update set
    last_price = excluded.last_price,
    last_date = excluded.last_date,
    today_change_pct = excluded.today_change_pct,
    week_high = excluded.week_high,
    month_high = excluded.month_high,
    week_drawdown_pct = excluded.week_drawdown_pct,
    month_drawdown_pct = excluded.month_drawdown_pct,
    updated_at = excluded.updated_at;
$$;
