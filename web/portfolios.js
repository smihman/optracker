import { h, render } from "https://esm.sh/preact@10.19.6";
import { useEffect, useMemo, useState } from "https://esm.sh/preact@10.19.6/hooks";
import htm from "https://esm.sh/htm@3.1.1";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

const html = htm.bind(h);
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const MOVE_LABELS = {
  NEW: "Nouvelle",
  INCREASED: "Renforcée",
  DECREASED: "Réduite",
  CLOSED: "Sortie",
  UNCHANGED: "Inchangée",
};

const FILTERS = [
  { key: "ALL", label: "Tout" },
  { key: "NEW", label: "Nouvelles" },
  { key: "INCREASED", label: "Renforcées" },
  { key: "DECREASED", label: "Réduites" },
  { key: "CLOSED", label: "Sorties" },
  { key: "UNCHANGED", label: "Inchangées" },
];

function formatDate(isoDate) {
  if (!isoDate) return "—";
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" });
}

function formatUsdCompact(value) {
  if (value === null || value === undefined) return "—";
  const abs = Math.abs(value);
  if (abs >= 1e9) return `${(value / 1e9).toLocaleString("fr-FR", { maximumFractionDigits: 2 })} Mds $`;
  if (abs >= 1e6) return `${(value / 1e6).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} M$`;
  return `${Number(value).toLocaleString("fr-FR", { maximumFractionDigits: 0 })} $`;
}

function formatShares(value) {
  if (value === null || value === undefined) return "—";
  return Number(value).toLocaleString("fr-FR");
}

function formatPct(value) {
  if (value === null || value === undefined) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}%`;
}

// null/undefined toujours en dernier, quel que soit le sens du tri —
// même convention que web/app.js.
function compareRows(a, b, key, dir) {
  const av = a[key];
  const bv = b[key];
  let cmp;
  if (av === null || av === undefined) cmp = bv === null || bv === undefined ? 0 : 1;
  else if (bv === null || bv === undefined) cmp = -1;
  else if (typeof av === "string") cmp = av.localeCompare(bv);
  else cmp = av - bv;
  return dir === "asc" ? cmp : -cmp;
}

function SpinnerIcon({ className }) {
  return html`
    <svg class=${"animate-spin " + (className ?? "")} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="12" cy="12" r="9" stroke="currentColor" stroke-opacity="0.25" stroke-width="2.5" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" />
    </svg>
  `;
}

function SearchIcon({ className }) {
  return html`
    <svg class=${className} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="11" cy="11" r="7" stroke="currentColor" stroke-width="2" />
      <path d="m20 20-3.5-3.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
    </svg>
  `;
}

const NAV_ITEMS = [
  { href: "./index.html", label: "Dashboard" },
  { href: "./portfolios.html", label: "Portefeuilles" },
  { href: "./admin.html", label: "Administration" },
];

function NavPills({ current }) {
  return html`
    <nav class="flex items-center gap-1 p-1 bg-app-surface border border-app-border rounded-full">
      ${NAV_ITEMS.map(
        (item) => html`
          <a
            href=${item.href}
            class=${"px-3 py-1.5 rounded-full text-xs sm:text-sm transition-all whitespace-nowrap " +
            (item.label === current
              ? "bg-app-text text-app-bg font-medium"
              : "text-app-muted hover:text-app-text")}
          >
            ${item.label}
          </a>
        `
      )}
    </nav>
  `;
}

function PctText({ value }) {
  if (value === null || value === undefined) return html`<span class="text-app-muted">—</span>`;
  const cls = value > 0 ? "text-pos" : value < 0 ? "text-neg" : "text-app-muted";
  return html`<span class=${"font-semibold tabular-nums " + cls}>${formatPct(value)}</span>`;
}

function MoveBadge({ move }) {
  return html`<span
    class="inline-flex items-center px-2 py-0.5 rounded-full border border-app-border text-xs text-app-muted whitespace-nowrap"
    >${MOVE_LABELS[move] ?? move}</span
  >`;
}

function SortableTh({ label, sortKey, align, tableSort, onSort, hideOnMobile }) {
  const active = tableSort.key === sortKey;
  return html`
    <th
      class=${"px-2 sm:px-3 py-3 cursor-pointer select-none whitespace-nowrap text-xs uppercase tracking-wide font-medium hover:text-app-text transition-colors " +
      (align === "right" ? "text-right" : "text-left") +
      (active ? " text-app-text" : " text-app-muted") +
      (hideOnMobile ? " hidden sm:table-cell" : "")}
      onClick=${() => onSort(sortKey)}
    >
      ${label}
      <span
        class=${"inline-block transition-all duration-200 ease-out ml-0.5 " +
        (active ? "opacity-100" : "opacity-0 -translate-y-0.5") +
        (active && tableSort.dir === "desc" ? " rotate-180" : "")}
        >▲</span>
    </th>
  `;
}

function StatCard({ label, value, delay }) {
  return html`
    <div class="bg-app-surface border border-app-border rounded-2xl p-4 animate-fade-in-up" style=${{ animationDelay: `${delay}ms` }}>
      <div class="text-xs text-app-muted mb-1">${label}</div>
      <div class="text-xl font-bold text-app-text tabular-nums">${value}</div>
    </div>
  `;
}

function App() {
  const [investors, setInvestors] = useState([]);
  const [investorsLoaded, setInvestorsLoaded] = useState(false);
  const [selectedCik, setSelectedCik] = useState(null);
  const [filings, setFilings] = useState([]);
  const [moves, setMoves] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("ALL");
  const [tableSort, setTableSort] = useState({ key: "value_usd_now", dir: "desc" });

  useEffect(() => {
    supabase
      .from("investors")
      .select("cik, name")
      .eq("is_active", true)
      .order("added_at", { ascending: true })
      .then(({ data }) => {
        setInvestors(data || []);
        setInvestorsLoaded(true);
        if (data && data.length) setSelectedCik(data[0].cik);
      });
  }, []);

  async function load(cik) {
    setLoading(true);
    setError(null);
    const [filingsRes, movesRes] = await Promise.all([
      supabase
        .from("portfolio_filings")
        .select("period_of_report, filed_date, total_value_usd")
        .eq("investor_cik", cik)
        .order("period_of_report", { ascending: false })
        .limit(2),
      supabase.rpc("portfolio_moves", { p_investor_cik: cik }),
    ]);
    const err = filingsRes.error || movesRes.error;
    if (err) {
      setError(err.message);
      setLoading(false);
      return;
    }
    setFilings(filingsRes.data || []);
    setMoves(
      (movesRes.data || []).map((r) => ({
        ...r,
        shares_delta_pct: r.shares_prev ? (((r.shares_now ?? 0) - r.shares_prev) / r.shares_prev) * 100 : null,
      }))
    );
    setLoading(false);
  }

  useEffect(() => {
    if (selectedCik) load(selectedCik);
  }, [selectedCik]);

  const visible = useMemo(() => {
    let rows = moves;
    if (filter !== "ALL") rows = rows.filter((r) => r.move === filter);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      rows = rows.filter(
        (r) => r.issuer_name.toLowerCase().includes(q) || (r.matched_symbol ?? "").toLowerCase().includes(q)
      );
    }
    return [...rows].sort((a, b) => compareRows(a, b, tableSort.key, tableSort.dir));
  }, [moves, filter, search, tableSort]);

  function onSort(key) {
    setTableSort((s) => (s.key === key ? { key, dir: s.dir === "desc" ? "asc" : "desc" } : { key, dir: "desc" }));
  }

  const latest = filings[0];
  const previous = filings[1];

  return html`
    <div class="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
      <header class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 rounded-xl bg-app-surface border border-app-border flex items-center justify-center flex-shrink-0">
            <img src="./logo.png" alt="" class="w-5 h-5 invert" />
          </div>
          <div>
            <h1 class="text-2xl font-bold tracking-tight text-app-text leading-tight">Portefeuilles</h1>
            <p class="text-sm text-app-muted">Dépôts 13F (SEC EDGAR) — trimestriel, pas un signal temps réel.</p>
          </div>
        </div>
        <${NavPills} current="Portefeuilles" />
      </header>

      ${investorsLoaded &&
      investors.length === 0 &&
      html`
        <div class="bg-app-surface border border-app-border rounded-2xl p-6 text-sm text-app-muted animate-fade-in-up">
          Aucun investisseur suivi pour l'instant. Ajoute une ligne dans la table <code class="text-app-text">investors</code>
          (voir le README, section "Portefeuilles suivis").
        </div>
      `}

      ${investors.length > 1 &&
      html`
        <div class="flex flex-wrap gap-2 mb-6">
          ${investors.map(
            (inv) => html`
              <button
                class=${"px-3.5 py-1.5 rounded-full border text-sm transition-all active:scale-95 whitespace-nowrap " +
                (inv.cik === selectedCik
                  ? "bg-app-text text-app-bg border-app-text"
                  : "border-app-border text-app-muted hover:text-app-text")}
                onClick=${() => setSelectedCik(inv.cik)}
              >
                ${inv.name}
              </button>
            `
          )}
        </div>
      `}

      ${selectedCik &&
      !loading &&
      !error &&
      filings.length === 0 &&
      html`
        <div class="bg-app-surface border border-app-border rounded-2xl p-6 text-sm text-app-muted animate-fade-in-up">
          Pas encore de dépôt ingéré pour cet investisseur — le workflow
          <span class="text-app-text">"Fetch investor portfolios (13F)"</span> doit encore passer au moins une fois
          (Actions → Run workflow pour le lancer manuellement plutôt que d'attendre le cron hebdomadaire).
        </div>
      `}

      ${error && html`<div class="bg-app-surface border border-app-border rounded-2xl p-6 text-sm text-neg animate-fade-in-up">${error}</div>`}

      ${latest &&
      html`
        <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          <${StatCard} label="Dernier trimestre déclaré" value=${formatDate(latest.period_of_report)} delay=${0} />
          <${StatCard} label="Déposé le" value=${formatDate(latest.filed_date)} delay=${40} />
          <${StatCard}
            label="Comparé à"
            value=${previous ? formatDate(previous.period_of_report) : "Aucun historique"}
            delay=${80}
          />
          <${StatCard} label="Valeur totale déclarée" value=${formatUsdCompact(latest.total_value_usd)} delay=${120} />
        </div>
        ${!previous &&
        html`
          <p class="text-xs text-app-muted mb-6 animate-fade-in">
            Premier relevé pour cet investisseur — pas encore d'historique pour comparer, toutes les lignes
            apparaissent comme "Nouvelle" jusqu'au prochain dépôt trimestriel.
          </p>
        `}
      `}

      ${filings.length > 0 &&
      html`
        <div class="flex flex-wrap items-center gap-2.5 mb-4">
          <div class="relative w-full sm:w-auto sm:flex-1 sm:min-w-[220px]">
            <${SearchIcon} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-app-muted" />
            <input
              type="text"
              placeholder="Rechercher un titre ou un symbole…"
              class="w-full bg-app-surface border border-app-border rounded-full pl-10 pr-9 py-2.5 text-sm text-app-text placeholder-app-muted transition-shadow focus:outline-none focus:ring-4 focus:ring-white/5 focus:border-app-muted"
              value=${search}
              onInput=${(e) => setSearch(e.target.value)}
            />
          </div>
          <div class="flex flex-wrap gap-2">
            ${FILTERS.map(
              (f) => html`
                <button
                  class=${"px-3 py-1.5 rounded-full border text-xs sm:text-sm transition-all active:scale-95 whitespace-nowrap " +
                  (filter === f.key
                    ? "bg-app-text text-app-bg border-app-text"
                    : "border-app-border text-app-muted hover:text-app-text")}
                  onClick=${() => setFilter(f.key)}
                >
                  ${f.label}
                </button>
              `
            )}
          </div>
        </div>

        <div class="border border-app-border rounded-2xl overflow-hidden">
          <table class="w-full text-sm">
            <thead class="bg-app-surface">
              <tr>
                <${SortableTh} label="Titre" sortKey="issuer_name" tableSort=${tableSort} onSort=${onSort} />
                <${SortableTh} label="Mouvement" sortKey="move" tableSort=${tableSort} onSort=${onSort} />
                <th class="hidden sm:table-cell px-2 sm:px-3 py-3 text-xs uppercase tracking-wide font-medium text-app-muted text-right">
                  Parts (avant → après)
                </th>
                <${SortableTh} label="Var. parts" sortKey="shares_delta_pct" align="right" tableSort=${tableSort} onSort=${onSort} />
                <${SortableTh} label="Valeur" sortKey="value_usd_now" align="right" tableSort=${tableSort} onSort=${onSort} />
                <${SortableTh}
                  label="% portefeuille"
                  sortKey="pct_of_portfolio"
                  align="right"
                  tableSort=${tableSort}
                  onSort=${onSort}
                  hideOnMobile=${true}
                />
              </tr>
            </thead>
            <tbody class="divide-y divide-app-border/60">
              ${loading &&
              [...Array(8)].map(
                () => html`
                  <tr class="animate-pulse">
                    <td class="px-2 sm:px-3 py-3"><div class="h-3.5 w-32 bg-app-surface rounded"></div></td>
                    <td class="px-2 sm:px-3 py-3"><div class="h-3.5 w-16 bg-app-surface rounded"></div></td>
                    <td class="hidden sm:table-cell px-2 sm:px-3 py-3"><div class="h-3.5 w-28 bg-app-surface rounded ml-auto"></div></td>
                    <td class="px-2 sm:px-3 py-3"><div class="h-3.5 w-14 bg-app-surface rounded ml-auto"></div></td>
                    <td class="px-2 sm:px-3 py-3"><div class="h-3.5 w-16 bg-app-surface rounded ml-auto"></div></td>
                    <td class="hidden sm:table-cell px-2 sm:px-3 py-3"><div class="h-3.5 w-12 bg-app-surface rounded ml-auto"></div></td>
                  </tr>
                `
              )}
              ${!loading &&
              visible.map(
                (row) => html`
                  <tr class="hover:bg-app-surface/60 transition-colors">
                    <td class="px-2 sm:px-3 py-3">
                      <div class="font-medium text-app-text">${row.issuer_name}</div>
                      ${row.matched_symbol &&
                      html`<div class="text-xs text-app-muted">${row.matched_symbol}</div>`}
                    </td>
                    <td class="px-2 sm:px-3 py-3"><${MoveBadge} move=${row.move} /></td>
                    <td class="hidden sm:table-cell px-2 sm:px-3 py-3 text-right text-app-muted tabular-nums whitespace-nowrap">
                      ${formatShares(row.shares_prev)} → ${formatShares(row.shares_now)}
                    </td>
                    <td class="px-2 sm:px-3 py-3 text-right"><${PctText} value=${row.shares_delta_pct} /></td>
                    <td class="px-2 sm:px-3 py-3 text-right text-app-text tabular-nums whitespace-nowrap">
                      ${formatUsdCompact(row.value_usd_now ?? row.value_usd_prev)}
                    </td>
                    <td class="hidden sm:table-cell px-2 sm:px-3 py-3 text-right text-app-muted tabular-nums">
                      ${row.pct_of_portfolio !== null && row.pct_of_portfolio !== undefined
                        ? `${row.pct_of_portfolio.toFixed(1)}%`
                        : "—"}
                    </td>
                  </tr>
                `
              )}
              ${!loading &&
              visible.length === 0 &&
              html`
                <tr>
                  <td colspan="6" class="px-2 sm:px-3 py-8 text-center text-app-muted text-sm">Aucun résultat.</td>
                </tr>
              `}
            </tbody>
          </table>
        </div>
      `}

      <footer class="mt-10 text-xs text-app-muted">
        <p>
          Estimation issue des dépôts publics SEC 13F — publiés jusqu'à 45 jours après la clôture du trimestre,
          jamais en temps réel. La correspondance avec un symbole S&amp;P 500 est faite au mieux (nom normalisé) :
          l'absence de symbole ne veut pas dire que le titre n'existe pas. Ce n'est pas un conseil d'achat.
        </p>
      </footer>
    </div>
  `;
}

render(html`<${App} />`, document.getElementById("app"));
