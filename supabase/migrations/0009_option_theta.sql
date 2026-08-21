-- ============================================================
-- 0009_option_theta.sql
-- Theta d'un call ATM (échéance ~30-45j) pour une short-list de
-- titres — pas les 500 : yfinance n'a pas d'appel groupé pour les
-- chaînes d'options (contrairement aux prix), un run à l'échelle du
-- S&P 500 ferait ~1000 appels/jour et casserait la règle "jamais un
-- appel par symbole" qui protège tout le pipeline du rate-limiting.
-- Voir ingest/fetch_theta.py pour la sélection de la short-list.
--
-- Table séparée de `metrics` plutôt que des colonnes nullable : seule
-- une vingtaine de titres sur ~500 sont concernés chaque jour.
-- ============================================================

create table if not exists option_theta (
  symbol             text primary key references tickers(symbol) on delete cascade,
  expiration         date not null,
  strike             numeric not null,
  underlying_price   numeric not null,
  option_last_price  numeric,
  option_bid         numeric,
  option_ask         numeric,
  option_volume      bigint,
  open_interest      bigint,
  implied_vol        numeric,
  theta_per_day      numeric,
  updated_at         timestamptz not null default now()
);

alter table option_theta enable row level security;

create policy "public read option_theta" on option_theta
  for select
  to anon, authenticated
  using (true);
