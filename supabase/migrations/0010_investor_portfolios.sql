-- ============================================================
-- 0010_investor_portfolios.sql
-- Suivi des positions déclarées en 13F par une liste choisie
-- d'investisseurs/fonds publics (dépôts SEC EDGAR, trimestriels,
-- jusqu'à 45 jours de retard après la clôture du trimestre — pas un
-- signal temps réel, voir ingest/fetch_portfolios.py et le README).
--
-- CUSIP, pas le symbole, comme clé de rapprochement entre deux
-- trimestres : c'est ce qu'un 13F rapporte nativement, et un symbole
-- peut changer alors que le CUSIP reste stable. `matched_symbol` est
-- une correspondance best-effort (nom normalisé) vers `tickers`,
-- nullable — beaucoup de lignes n'auront pas de correspondance et
-- c'est attendu (titres hors S&P 500, noms trop différents).
-- ============================================================

create table if not exists investors (
  cik         text primary key,
  name        text not null,
  slug        text not null unique,
  is_active   boolean not null default true,
  added_at    timestamptz not null default now()
);

create table if not exists portfolio_filings (
  id                bigint generated always as identity primary key,
  investor_cik      text not null references investors(cik) on delete cascade,
  period_of_report  date not null,
  filed_date        date not null,
  accession_number  text not null,
  total_value_usd   numeric,
  created_at        timestamptz not null default now(),
  unique (investor_cik, period_of_report)
);

create table if not exists portfolio_holdings (
  id                bigint generated always as identity primary key,
  filing_id         bigint not null references portfolio_filings(id) on delete cascade,
  cusip             text not null,
  issuer_name       text not null,
  matched_symbol    text references tickers(symbol),
  shares            numeric,
  value_usd         numeric,
  share_type        text,
  put_call          text,
  pct_of_portfolio  numeric
);

create index if not exists portfolio_holdings_filing_idx on portfolio_holdings (filing_id);
create index if not exists portfolio_holdings_cusip_idx on portfolio_holdings (cusip);

alter table investors enable row level security;
alter table portfolio_filings enable row level security;
alter table portfolio_holdings enable row level security;

create policy "public read investors" on investors
  for select to anon, authenticated using (true);

create policy "public read portfolio_filings" on portfolio_filings
  for select to anon, authenticated using (true);

create policy "public read portfolio_holdings" on portfolio_holdings
  for select to anon, authenticated using (true);

-- Pour activer/désactiver un investisseur suivi depuis la page admin,
-- même schéma de droits que pour les tickers (0002_admin_write.sql).
create policy "authenticated can update investors" on investors
  for update to authenticated using (true) with check (true);

create policy "authenticated can insert investors" on investors
  for insert to authenticated with check (true);

-- Rapprochement entre les deux derniers dépôts d'un investisseur.
-- FULL OUTER JOIN sur le CUSIP plutôt qu'une simple LAG() en fenêtre,
-- pour aussi détecter les positions totalement sorties du portefeuille :
-- un 13F omet simplement les lignes clôturées, il n'y a jamais de ligne
-- à zéro part à comparer.
create or replace function portfolio_moves(p_investor_cik text)
returns table (
  cusip             text,
  issuer_name       text,
  matched_symbol    text,
  shares_now        numeric,
  shares_prev       numeric,
  value_usd_now     numeric,
  value_usd_prev    numeric,
  pct_of_portfolio  numeric,
  move              text
)
language sql
stable
as $$
  with latest as (
    select id, period_of_report from portfolio_filings
    where investor_cik = p_investor_cik
    order by period_of_report desc
    limit 1
  ),
  previous as (
    select id from portfolio_filings
    where investor_cik = p_investor_cik
      and period_of_report < (select period_of_report from latest)
    order by period_of_report desc
    limit 1
  ),
  cur as (
    select * from portfolio_holdings where filing_id = (select id from latest)
  ),
  prev as (
    select * from portfolio_holdings where filing_id = (select id from previous)
  )
  select
    coalesce(cur.cusip, prev.cusip) as cusip,
    coalesce(cur.issuer_name, prev.issuer_name) as issuer_name,
    coalesce(cur.matched_symbol, prev.matched_symbol) as matched_symbol,
    cur.shares as shares_now,
    prev.shares as shares_prev,
    cur.value_usd as value_usd_now,
    prev.value_usd as value_usd_prev,
    cur.pct_of_portfolio as pct_of_portfolio,
    case
      when prev.cusip is null then 'NEW'
      when cur.cusip is null then 'CLOSED'
      when cur.shares > prev.shares then 'INCREASED'
      when cur.shares < prev.shares then 'DECREASED'
      else 'UNCHANGED'
    end as move
  from cur
  full outer join prev on cur.cusip = prev.cusip;
$$;

-- Warren Buffett / Berkshire Hathaway comme premier investisseur suivi
-- (CIK SEC : 1067983). Pour en suivre d'autres plus tard : chercher le
-- CIK sur https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany
-- et insérer une ligne du même type dans `investors` (voir README).
insert into investors (cik, name, slug) values
  ('0001067983', 'Warren Buffett — Berkshire Hathaway', 'berkshire-hathaway')
on conflict (cik) do nothing;
