-- ============================================================
-- 0005_daily_closes.sql
-- Rework de l'historique : on passe d'un relevé intraday toutes les
-- 30 min (table `prices`, purgée à 90 jours) à un relevé quotidien
-- après clôture (table `daily_closes`, jamais purgée — le volume
-- reste négligeable indéfiniment : ~500 lignes/jour, ~126k/an).
--
-- Ça permet un vrai indicateur 52 semaines et simplifie fortement le
-- calcul des fenêtres : les bornes semaine/mois/52 semaines sont
-- maintenant des dates civiles America/New_York, sans conversion
-- tz-aware sur des timestamps intraday.
-- ============================================================

-- recompute_metrics() est en LANGUAGE SQL : elle a une dépendance dure
-- sur `prices` (pg_depend), il faut la supprimer avant de pouvoir
-- dropper la table.
drop function if exists recompute_metrics(timestamptz, timestamptz);

drop table if exists prices cascade;

create table if not exists daily_closes (
  symbol  text not null references tickers(symbol) on delete cascade,
  date    date not null,
  close   numeric not null,
  volume  bigint,
  primary key (symbol, date)
);

alter table daily_closes enable row level security;

create policy "public read daily_closes" on daily_closes
  for select
  to anon, authenticated
  using (true);

alter table metrics
  add column if not exists last_date date,
  add column if not exists high_52w numeric,
  add column if not exists drawdown_52w_pct numeric;

create index if not exists metrics_drawdown_52w_idx on metrics (drawdown_52w_pct);

create or replace function recompute_metrics(week_start date, month_start date, year_start date)
returns void
language sql
as $$
  insert into metrics (
    symbol, last_price, last_date, week_high, month_high, high_52w,
    week_drawdown_pct, month_drawdown_pct, drawdown_52w_pct, updated_at
  )
  select
    t.symbol,
    lp.close,
    lp.date,
    wk.week_high,
    mo.month_high,
    yr.high_52w,
    round((lp.close / nullif(wk.week_high, 0) - 1) * 100, 4),
    round((lp.close / nullif(mo.month_high, 0) - 1) * 100, 4),
    round((lp.close / nullif(yr.high_52w, 0) - 1) * 100, 4),
    now()
  from tickers t
  join lateral (
    select close, date from daily_closes
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
  join lateral (
    select max(close) as high_52w from daily_closes
    where symbol = t.symbol and date >= year_start
  ) yr on true
  where t.is_active
  on conflict (symbol) do update set
    last_price = excluded.last_price,
    last_date = excluded.last_date,
    week_high = excluded.week_high,
    month_high = excluded.month_high,
    high_52w = excluded.high_52w,
    week_drawdown_pct = excluded.week_drawdown_pct,
    month_drawdown_pct = excluded.month_drawdown_pct,
    drawdown_52w_pct = excluded.drawdown_52w_pct,
    updated_at = excluded.updated_at;
$$;
