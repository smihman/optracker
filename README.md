# S&P 500 Drawdown Dashboard

Outil de recherche personnel qui surveille les cours des actions du S&P 500 toutes les 30 minutes
pendant les heures de marché, stocke l'historique, et affiche un dashboard classant les actions
qui ont le plus baissé sur la semaine et sur le mois en cours.

Ce n'est **pas** un conseiller financier : une forte baisse peut signaler une opportunité comme un
problème réel ("falling knife"). Le dashboard présente des données factuelles, jamais des
recommandations d'achat.

## Architecture

```
GitHub Actions (cron, Python) --> Yahoo Finance (yfinance, appel groupé)
        |
        v (upsert, service key)
Supabase Postgres (tickers, prices, metrics)
        ^ (lecture, clé anon, RLS)
        |
Front statique sans build (Cloudflare Pages) --> /web
```

Trois composants indépendants :
- **`/ingest`** — script Python exécuté par GitHub Actions : récupère les cours, calcule les
  métriques de drawdown, purge l'historique ancien.
- **`/supabase`** — migrations SQL (schéma + RLS).
- **`/web`** — dashboard + page admin, HTML/JS statique, **aucune étape de build**. Dépendances
  chargées via CDN ESM (esm.sh). À déposer tel quel sur Cloudflare Pages (drag & drop).

## Contrainte : zéro npm en local

Le front ne nécessite jamais `npm install` / `npm run build`, ni sur cette machine ni ailleurs.
Le seul "build" toléré tourne dans GitHub Actions (le script Python d'ingestion), sans rapport
avec le poste local.

---

## Setup (à faire une seule fois)

### 1. Créer le projet Supabase

1. [supabase.com](https://supabase.com) → New project.
2. Une fois créé : **SQL Editor** → coller et exécuter, dans l'ordre, le contenu de :
   - [`supabase/migrations/0001_init.sql`](supabase/migrations/0001_init.sql) (tables + RLS lecture publique)
   - [`supabase/migrations/0002_admin_write.sql`](supabase/migrations/0002_admin_write.sql) (droits d'écriture pour la page admin)
   - [`supabase/migrations/0003_metrics_function.sql`](supabase/migrations/0003_metrics_function.sql) (fonction de recalcul des métriques)
3. **Project Settings → API** : noter l'**URL du projet** et la clé **`anon` `public`** (pour le
   front) et la clé **`service_role`** (pour l'ingestion — à garder secrète).
4. **Authentication → Users → Add user** : créer **un seul compte** (le tien) avec email +
   mot de passe. C'est le compte utilisé pour te connecter à la page admin — il n'y a pas
   d'inscription publique.

### 2. Configurer les secrets GitHub Actions

Dans le repo GitHub (Settings → Secrets and variables → Actions), ajouter :
- `SUPABASE_URL`
- `SUPABASE_SERVICE_KEY` (la clé `service_role`, jamais la `anon`)

Yahoo Finance ne demande aucune clé API.

### 3. Remplir `web/config.js`

Éditer [`web/config.js`](web/config.js) avec l'URL du projet et la clé **`anon`** (jamais la
`service_role`) :
```js
export const SUPABASE_URL = "https://xxxx.supabase.co";
export const SUPABASE_ANON_KEY = "eyJ...";
```
Ces valeurs sont publiques par design : la sécurité repose sur le RLS, pas sur le secret de cette
clé.

### 4. Premier peuplement de la liste S&P 500

La table `tickers` est vide au départ — il faut la peupler **avant** le premier run
d'ingestion (sinon `ingest.py` n'a rien à récupérer) :

1. Repo GitHub → onglet **Actions** → workflow **"Refresh S&P 500 tickers"** → **Run workflow**.
2. Vérifier dans les logs qu'il a inséré ~500 tickers.

### 5. Premier run d'ingestion manuel

1. Repo GitHub → **Actions** → workflow **"Ingest prices"** → **Run workflow**.
2. Si lancé hors séance NYSE, le script sort proprement sans rien faire (log "market closed" ou
   "outside regular session") — c'est normal, relancer pendant les heures de marché US pour un
   vrai test (voir §5 du brief : 9:30–16:00 heure de New York, jours ouvrés).
3. Vérifier dans Supabase (**Table Editor**) que `prices` et `metrics` se remplissent.

### 6. Déploiement Cloudflare Pages

**A. Drag & drop (le plus simple)**
1. Cloudflare Dashboard → Pages → *Create* → *Upload assets (Direct Upload)*.
2. Glisser-déposer le contenu du dossier `/web`.
3. Pour une mise à jour du front (rare), re-glisser le dossier. Le dashboard lit les données en
   direct depuis Supabase : **les cours se mettent à jour sans redéploiement**.

**B. Dépôt Git connecté (auto à chaque push)**
1. Connecter le repo GitHub à Cloudflare Pages.
2. **Build command : (laisser vide / "None")** · **Output directory : `web`**.
3. Chaque push met le front à jour automatiquement, toujours sans npm.

Une fois déployé : `https://<ton-projet>.pages.dev/` pour le dashboard,
`https://<ton-projet>.pages.dev/admin.html` pour l'administration.

---

## Tester en local (sans npm)

Le front est 100 % statique, mais ouvrir `index.html` directement en `file://` bloque parfois le
chargement des modules ES (restrictions CORS des navigateurs). Utiliser un serveur statique tout
simple — Python est déjà nécessaire pour l'ingestion, donc pas de nouvelle dépendance :

```sh
cd web
python -m http.server 8000
```
Puis ouvrir `http://localhost:8000`.

Pour l'ingestion Python :
```sh
cd ingest
python -m venv .venv && source .venv/bin/activate  # ou .venv\Scripts\activate sous Windows
pip install -r requirements.txt
cp .env.example .env   # puis remplir SUPABASE_URL / SUPABASE_SERVICE_KEY
export $(grep -v '^#' .env | xargs)   # ou set les variables manuellement sous Windows
python manual_test.py      # smoke test sur 5 symboles, ne touche pas Supabase
python refresh_tickers.py  # peuple/rafraîchit la table tickers
python ingest.py           # récupère les prix + recalcule les métriques (si séance ouverte)
```

---

## Page d'administration

`web/admin.html` — protégée par Supabase Auth (le compte créé à l'étape 1.4). Permet :
- de voir des statistiques de stockage (nb de tickers actifs, nb de lignes dans `prices`, date du
  point le plus ancien) ;
- de déclencher une **purge manuelle** de l'historique de prix (au-delà d'un seuil en jours) ;
- d'activer/désactiver manuellement un ticker.

La purge de 90 jours tourne déjà automatiquement à chaque ingestion (voir `ingest/ingest.py`) —
la page admin sert surtout de filet de sécurité si le quota Supabase approche plus vite que prévu.

---

## Limites connues

- **Cron best-effort** : GitHub Actions ne garantit pas le timing exact des workflows planifiés
  (retards possibles en cas de charge). Le script est idempotent (upsert) pour tolérer ça.
- **Désactivation après inactivité** : un workflow planifié GitHub Actions est désactivé après
  60 jours sans activité sur le repo. Si le dashboard arrête de se mettre à jour après une longue
  pause, relancer le workflow manuellement (`workflow_dispatch`) pour le réactiver.
- **Yahoo Finance non officiel** : `yfinance` scrape une API non documentée, sujette au
  rate-limiting et aux changements sans préavis. Un run partiel (symboles manquants) est toléré
  et loggé plutôt que de faire échouer tout le run. L'accès aux données passe par l'interface
  `PriceProvider` (`ingest/price_provider.py`), remplaçable par une autre source si Yahoo casse.
- **Quota Supabase (free tier, ~500 Mo)** : purge automatique de l'historique `prices` au-delà de
  90 jours à chaque run d'ingestion, + purge manuelle disponible sur la page admin.
- **Scraping Wikipedia pour la liste S&P 500** : `refresh_tickers.py` parse la table Wikipedia des
  constituants. Si la page change de structure, le script peut échouer — corriger le parsing à ce
  moment-là plutôt que d'anticiper tous les cas.

## Statut

Repo fonctionnel de bout en bout : migrations Supabase, ingestion Python + workflows GitHub
Actions, dashboard + page admin statiques. Reste à faire selon usage réel : ajuster si Yahoo
Finance ou le scraping Wikipedia posent problème en pratique.
