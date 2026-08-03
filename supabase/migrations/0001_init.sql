-- ============================================================
-- 0001_init.sql
-- Schéma de base : tickers, prices, metrics + RLS lecture publique.
-- Les écritures se font uniquement via la service key (ingestion
-- GitHub Actions), qui bypass RLS — aucune policy d'écriture ici.
-- ============================================================

create table if not exists tickers (
  symbol      text primary key,
  name        text,
  sector      text,
  added_at    timestamptz not null default now(),
  is_active   boolean not null default true
);

create table if not exists prices (
  symbol      text not null references tickers(symbol) on delete cascade,
  ts          timestamptz not null,
  price       numeric not null,
  volume      bigint,
  primary key (symbol, ts)
);

create index if not exists prices_symbol_ts_desc_idx on prices (symbol, ts desc);

create table if not exists metrics (
  symbol              text primary key references tickers(symbol) on delete cascade,
  last_price          numeric,
  week_high           numeric,
  month_high          numeric,
  week_drawdown_pct   numeric,
  month_drawdown_pct  numeric,
  updated_at          timestamptz not null default now()
);

alter table tickers enable row level security;
alter table prices  enable row level security;
alter table metrics enable row level security;

create policy "public read tickers" on tickers
  for select
  to anon, authenticated
  using (true);

create policy "public read prices" on prices
  for select
  to anon, authenticated
  using (true);

create policy "public read metrics" on metrics
  for select
  to anon, authenticated
  using (true);
