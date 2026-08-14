-- ============================================================
-- 0007_period_vs_friday_close.sql
-- Redéfinit les métriques semaine/mois : au lieu de la décote depuis
-- le plus-haut d'une fenêtre glissante, on compare maintenant la
-- clôture du jour à des points de repère fixes :
--   - week_change_pct  : vs clôture du vendredi de la semaine dernière
--   - month_change_pct : vs clôture du dernier vendredi du mois dernier
-- Comme today_change_pct, ces deux métriques peuvent désormais être
-- positives ou négatives (ce n'est plus un "drawdown" au sens strict) —
-- les 3 métriques sont maintenant symétriques.
-- ============================================================

alter table metrics
  add column if not exists week_ref_close numeric,
  add column if not exists week_change_pct numeric,
  add column if not exists month_ref_close numeric,
  add column if not exists month_change_pct numeric;

alter table metrics
  drop column if exists week_high,
  drop column if exists week_drawdown_pct,
  drop column if exists month_high,
  drop column if exists month_drawdown_pct;

drop index if exists metrics_week_drawdown_idx;
drop index if exists metrics_month_drawdown_idx;

create index if not exists metrics_week_change_idx on metrics (week_change_pct);
create index if not exists metrics_month_change_idx on metrics (month_change_pct);

-- Signature différente (2 dates de bornes -> 2 dates de vendredi de
-- référence) : même nombre d'arguments mais des noms différents, on
-- droppe explicitement l'ancienne pour ne pas la laisser traîner.
drop function if exists recompute_metrics(date, date);

create or replace function recompute_metrics(last_week_friday date, last_month_friday date)
returns void
language sql
as $$
  insert into metrics (
    symbol, last_price, last_date, today_change_pct,
    week_ref_close, week_change_pct, month_ref_close, month_change_pct, updated_at
  )
  select
    t.symbol,
    lp.close,
    lp.date,
    round((lp.close / nullif(lp.open, 0) - 1) * 100, 4),
    wf.close,
    round((lp.close / nullif(wf.close, 0) - 1) * 100, 4),
    mf.close,
    round((lp.close / nullif(mf.close, 0) - 1) * 100, 4),
    now()
  from tickers t
  join lateral (
    select close, open, date from daily_closes
    where symbol = t.symbol order by date desc limit 1
  ) lp on true
  -- LEFT JOIN : un titre récemment ajouté peut ne pas avoir
  -- d'historique jusqu'au vendredi de référence — on veut quand même
  -- sa ligne dans metrics (avec ces deux champs à NULL), pas l'exclure.
  left join lateral (
    select close from daily_closes
    where symbol = t.symbol and date <= last_week_friday
    order by date desc limit 1
  ) wf on true
  left join lateral (
    select close from daily_closes
    where symbol = t.symbol and date <= last_month_friday
    order by date desc limit 1
  ) mf on true
  where t.is_active
  on conflict (symbol) do update set
    last_price = excluded.last_price,
    last_date = excluded.last_date,
    today_change_pct = excluded.today_change_pct,
    week_ref_close = excluded.week_ref_close,
    week_change_pct = excluded.week_change_pct,
    month_ref_close = excluded.month_ref_close,
    month_change_pct = excluded.month_change_pct,
    updated_at = excluded.updated_at;
$$;
