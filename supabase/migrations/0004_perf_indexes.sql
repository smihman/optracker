-- ============================================================
-- 0004_perf_indexes.sql
-- Index supplémentaires pour garder les requêtes rapides à mesure que
-- l'historique grossit (~500 actions x ~13 points/jour) :
-- - is_active est filtré à chaque run d'ingestion (tickers actifs) et
--   dans recompute_metrics() ;
-- - week_drawdown_pct / month_drawdown_pct sont utilisés pour trier le
--   dashboard (ORDER BY) à chaque chargement.
-- ============================================================

create index if not exists tickers_is_active_idx on tickers (is_active);

create index if not exists metrics_week_drawdown_idx on metrics (week_drawdown_pct);
create index if not exists metrics_month_drawdown_idx on metrics (month_drawdown_pct);
