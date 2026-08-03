-- ============================================================
-- 0002_admin_write.sql
-- Droits d'écriture pour la page admin, réservés aux utilisateurs
-- authentifiés. Un seul compte admin est créé manuellement dans
-- Supabase Auth (Authentication > Users > Add user) — aucune
-- inscription publique n'est exposée, donc "authenticated" suffit
-- comme condition, pas besoin de vérifier un auth.uid() précis.
-- La service key (ingestion) bypass RLS et n'a pas besoin de ces
-- policies.
-- ============================================================

-- Purge manuelle de l'historique de prix
create policy "authenticated can delete prices" on prices
  for delete
  to authenticated
  using (true);

-- Activer / désactiver un ticker manuellement
create policy "authenticated can update tickers" on tickers
  for update
  to authenticated
  using (true)
  with check (true);
