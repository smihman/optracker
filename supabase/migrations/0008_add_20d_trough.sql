-- ============================================================
-- 0008_add_20d_trough.sql
-- Ajoute un 4e indicateur "Creux" : écart au plus-haut glissant sur
-- les 20 derniers jours de bourse disponibles (fenêtre glissante, pas
-- calendaire — contrairement à semaine/mois, ça évite l'effet "début
-- de mois" où les deux se confondaient faute d'historique).
--
-- Complémentaire du vendredi-à-vendredi (week/month_change_pct) :
-- celui-ci mesure le déplacement sur une période fixe, celui-ci
-- répond directement à "est-ce que ce titre est actuellement déprimé
-- par rapport à sa normale récente" — le signal le plus direct pour
-- repérer un creux à exploiter maintenant.
-- ============================================================

alter table metrics
  add column if not exists high_20d numeric,
  add column if not exists drawdown_20d_pct numeric;

create index if not exists metrics_drawdown_20d_idx on metrics (drawdown_20d_pct);

-- Même signature que la fonction existante (2 dates) : pas besoin de
-- la dropper, create or replace suffit.
create or replace function recompute_metrics(last_week_friday date, last_month_friday date)
returns void
language sql
as $$
  insert into metrics (
    symbol, last_price, last_date, today_change_pct,
    week_ref_close, week_change_pct, month_ref_close, month_change_pct,
    high_20d, drawdown_20d_pct, updated_at
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
    hi.high_20d,
    round((lp.close / nullif(hi.high_20d, 0) - 1) * 100, 4),
    now()
  from tickers t
  join lateral (
    select close, open, date from daily_closes
    where symbol = t.symbol order by date desc limit 1
  ) lp on true
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
  join lateral (
    select max(close) as high_20d
    from (
      select close from daily_closes
      where symbol = t.symbol
      order by date desc
      limit 20
    ) recent
  ) hi on true
  where t.is_active
  on conflict (symbol) do update set
    last_price = excluded.last_price,
    last_date = excluded.last_date,
    today_change_pct = excluded.today_change_pct,
    week_ref_close = excluded.week_ref_close,
    week_change_pct = excluded.week_change_pct,
    month_ref_close = excluded.month_ref_close,
    month_change_pct = excluded.month_change_pct,
    high_20d = excluded.high_20d,
    drawdown_20d_pct = excluded.drawdown_20d_pct,
    updated_at = excluded.updated_at;
$$;
