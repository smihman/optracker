# S&P 500 Drawdown Dashboard

Outil de recherche personnel qui relève **une fois par jour** (après clôture NYSE) les cours des
actions du S&P 500, stocke l'historique quotidien, et affiche un dashboard classant les actions
sur 4 métriques : variation du jour (vs ouverture), de la semaine (vs clôture du vendredi
dernier), du mois (vs clôture du dernier vendredi du mois dernier), et un indicateur "Creux"
(écart au plus-haut glissant sur 20 jours de bourse) — pensé pour repérer des creux avant un
rebond (usage options).

Ce n'est **pas** un conseiller financier : une forte baisse peut signaler une opportunité comme un
problème réel ("falling knife"). Le dashboard présente des données factuelles, jamais des
recommandations d'achat.

## Architecture

```
GitHub Actions (cron quotidien, Python) --> Yahoo Finance (yfinance, appel groupé)
        |
        v (upsert, service key)
Supabase Postgres (tickers, daily_closes, metrics)
        ^ (lecture, clé anon, RLS)
        |
Front statique sans build (Cloudflare Pages) --> /web
```

Trois composants indépendants :
- **`/ingest`** — script Python exécuté par GitHub Actions : récupère les clôtures quotidiennes
  (open + close), calcule les métriques de performance (vs ouverture du jour / semaine / mois).
- **`/supabase`** — migrations SQL (schéma + RLS).
- **`/web`** — dashboard + page admin, HTML/JS statique, **aucune étape de build**. Dépendances
  chargées via CDN ESM (esm.sh). À déposer tel quel sur Cloudflare Pages (drag & drop).

### Pourquoi un relevé quotidien plutôt qu'intraday

La première version relevait les cours toutes les 30 minutes en heures de marché. Pour un usage
"un coup d'œil le soir", ça n'apportait rien de plus qu'un relevé après clôture, tout en exposant
le pipeline 13× plus au rate-limiting de Yahoo. Un relevé quotidien dans une table `daily_closes`
(une ligne/symbole/jour avec open + close, ~500 lignes/jour, ~126k/an) suffit largement et reste
assez léger pour ne **jamais avoir besoin d'être purgé**.

## Contrainte : zéro npm en local

Le front ne nécessite jamais `npm install` / `npm run build`, ni sur cette machine ni ailleurs.
Le seul "build" toléré tourne dans GitHub Actions (le script Python d'ingestion), sans rapport
avec le poste local.

---

## Setup (à faire une seule fois)

### 1. Créer le projet Supabase

1. [supabase.com](https://supabase.com) → New project.
2. Une fois créé : **SQL Editor** → coller et exécuter, **dans l'ordre**, le contenu de chaque
   fichier de [`supabase/migrations/`](supabase/migrations/) (0001 à 0009).
3. **Project Settings → API** : noter l'**URL du projet** et la clé **`anon` `public`** (pour le
   front) et la clé **`service_role`** (pour l'ingestion — à garder secrète, jamais dans un
   fichier du repo).
4. **Authentication → Users → Add user** : créer **un seul compte** (le tien) avec email +
   mot de passe. C'est le compte utilisé pour te connecter à la page admin — il n'y a pas
   d'inscription publique.

### 2. Configurer les secrets GitHub Actions

Dans le repo GitHub (Settings → Secrets and variables → Actions), ajouter :
- `SUPABASE_URL`
- `SUPABASE_SERVICE_KEY` (la clé secrète `service_role`, jamais la `anon`/`publishable`)

Yahoo Finance ne demande aucune clé API.

### 3. Remplir `web/config.js`

Éditer [`web/config.js`](web/config.js) avec l'URL du projet et la clé **`anon`/`publishable`**
(jamais la clé secrète) :
```js
export const SUPABASE_URL = "https://xxxx.supabase.co";
export const SUPABASE_ANON_KEY = "eyJ..."; // ou "sb_publishable_..."
```
Ces valeurs sont publiques par design : la sécurité repose sur le RLS, pas sur le secret de cette
clé.

### 4. Premier peuplement de la liste S&P 500

La table `tickers` est vide au départ — il faut la peupler **avant** le premier run
d'ingestion (sinon `ingest.py` n'a rien à récupérer) :

1. Repo GitHub → onglet **Actions** → workflow **"Refresh S&P 500 tickers"** → **Run workflow**.
2. Vérifier dans les logs qu'il a inséré ~500 tickers.

### 5. Backfill initial (historique pour le graphique de détail)

Le dashboard affiche 6 mois de tendance par titre (clic sur une ligne) — sans backfill, ce
graphique met des mois à se remplir jour après jour. Un seul run avec une fenêtre large suffit à
peupler `daily_closes` d'un coup, `yfinance` fournissant aussi l'historique passé :

1. Repo GitHub → **Actions** → workflow **"Ingest daily closes"** → **Run workflow**.
2. Dans le champ `period` proposé par GitHub, saisir par exemple **`1y`** (au lieu de la valeur
   par défaut `5d`) → **Run workflow**.
3. Peut être lancé n'importe quel jour (y compris un week-end) : une fenêtre explicite ignore la
   vérification "jour de bourse", contrairement au run quotidien normal.
4. Vérifier dans Supabase (**Table Editor**) que `daily_closes` et `metrics` se remplissent, avec
   `metrics.today_change_pct` / `week_change_pct` / `month_change_pct` / `drawdown_20d_pct`
   renseignés.

Les runs suivants (cron quotidien, ou `workflow_dispatch` sans changer `period`) utilisent la
valeur par défaut `5d` : une petite fenêtre glissante qui rattrape automatiquement un jour de cron
manqué, sans tout re-télécharger.

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
python manual_test.py            # smoke test sur 5 symboles, ne touche pas Supabase
python refresh_tickers.py        # peuple/rafraîchit la table tickers
python ingest.py                 # run quotidien normal (fenêtre 5 jours)
python ingest.py --period 1y     # backfill d'un an (utilisable n'importe quel jour)
python fetch_theta.py            # theta des ~20 titres les plus en "Creux" (nécessite metrics à jour)
```

---

## Page d'administration

`web/admin.html` — protégée par Supabase Auth (le compte créé à l'étape 1.4). Permet :
- de voir des statistiques (nb de tickers actifs, nb de lignes dans `daily_closes`, date du point
  le plus ancien) ;
- d'activer/désactiver manuellement un ticker.

Pas de purge manuelle ici : contrairement à l'ancien relevé intraday, `daily_closes` reste léger
indéfiniment (~126k lignes/an), aucune gestion de rétention n'est nécessaire.

---

## Theta (options)

En cliquant sur un titre, la fiche affiche le **theta estimé** d'un call ATM (strike le plus
proche du cours) à l'échéance la plus proche de ~30-45 jours — combien l'option perd de valeur par
jour, toutes choses égales par ailleurs.

- **Calculé, pas fourni par Yahoo** : Yahoo Finance donne le prix et la volatilité implicite des
  options, jamais les Greeks. Le theta est recalculé côté script via Black-Scholes
  (`ingest/options_theta.py`), à partir de l'IV Yahoo — taux sans risque fixe (non récupéré en
  direct) et dividendes ignorés (q=0). Approximatif, pas garanti identique à ce qu'affiche un
  courtier.
- **Uniquement une short-list d'environ 20 titres/jour** (les plus en "Creux"), pas les 500 :
  `yfinance` n'a pas d'appel groupé pour les chaînes d'options (contrairement aux prix), un run à
  l'échelle du S&P 500 ferait ~1000 appels/jour et casserait la règle "jamais un appel par
  symbole" qui protège le pipeline du rate-limiting. Voir `ingest/fetch_theta.py`.
- **C'est une donnée, pas un conseil** : le theta indique le coût de portage dans le temps, pas si
  le titre va rebondir. Aucune recommandation d'achat n'est faite nulle part dans l'outil.

---

## Limites connues

- **Cron best-effort** : GitHub Actions ne garantit pas le timing exact des workflows planifiés
  (retards possibles en cas de charge). Le script est idempotent (upsert) et récupère une fenêtre
  glissante de 5 jours à chaque run pour tolérer un run manqué.
- **Désactivation après inactivité** : un workflow planifié GitHub Actions est désactivé après
  60 jours sans activité sur le repo. Si le dashboard arrête de se mettre à jour après une longue
  pause, relancer le workflow manuellement (`workflow_dispatch`) pour le réactiver.
- **Yahoo Finance non officiel** : `yfinance` scrape une API non documentée, sujette au
  rate-limiting et aux changements sans préavis. Un run partiel (symboles manquants) est toléré
  et loggé plutôt que de faire échouer tout le run. L'accès aux données passe par l'interface
  `PriceProvider` (`ingest/price_provider.py`), remplaçable par une autre source si Yahoo casse.
- **Scraping Wikipedia pour la liste S&P 500** : `refresh_tickers.py` parse la table Wikipedia des
  constituants. Si la page change de structure, le script peut échouer — corriger le parsing à ce
  moment-là plutôt que d'anticiper tous les cas.
- **Quota Supabase (free tier, ~500 Mo)** : non-sujet avec `daily_closes` (~126k lignes/an, quelques
  Mo/an) — plus besoin de politique de rétention.
- **Theta encore plus fragile que les prix** : les chaînes d'options Yahoo sont moins fiables que
  l'endpoint prix. L'étape `fetch_theta.py` est non-bloquante dans le workflow
  (`continue-on-error`) — si elle échoue un jour, l'ingestion des prix n'est pas affectée.

## Statut

Repo fonctionnel de bout en bout : migrations Supabase, ingestion Python quotidienne + workflows
GitHub Actions, dashboard + page admin statiques (thème sombre). Reste à faire selon usage réel :
ajuster si Yahoo Finance ou le scraping Wikipedia posent problème en pratique.
