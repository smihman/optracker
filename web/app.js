import { h, render } from "https://esm.sh/preact@10.19.6";
import { useEffect, useMemo, useRef, useState } from "https://esm.sh/preact@10.19.6/hooks";
import htm from "https://esm.sh/htm@3.1.1";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import Chart from "https://esm.sh/chart.js@4.4.4/auto";

import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

const html = htm.bind(h);
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const SECTORS_ALL = "Tous secteurs";
const METRICS = [
  { key: "today_change_pct", label: "Auj.", title: "Variation depuis l'ouverture du jour" },
  { key: "week_change_pct", label: "Sem.", title: "Variation vs clôture du vendredi de la semaine dernière" },
  {
    key: "month_change_pct",
    label: "Mois",
    title: "Variation vs clôture du dernier vendredi du mois dernier",
    hideOnMobile: true,
  },
  { key: "drawdown_20d_pct", label: "Creux", title: "Écart au plus-haut glissant sur 20 jours de bourse" },
];

// iOS dark-mode system colors — gardées en JS pour Chart.js, qui ne
// lit pas les classes Tailwind.
const COLOR_POS = "#30d158";
const COLOR_NEG = "#ff453a";
const COLOR_MUTED = "#8e8e93";

function formatPct(value) {
  if (value === null || value === undefined) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

function formatPrice(value) {
  if (value === null || value === undefined) return "—";
  return `$${Number(value).toFixed(2)}`;
}

// isoDate: "YYYY-MM-DD" string from a Postgres `date` column. Built via
// the (year, month, day) constructor rather than parsing the string
// directly, so it's always read as a local calendar date — no risk of
// the day rolling over to the previous one depending on the viewer's
// timezone offset.
function formatCloseDate(isoDate) {
  if (!isoDate) return "—";
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "2-digit",
    month: "long",
  });
}

// null/undefined toujours en dernier, quel que soit le sens du tri.
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

function ChevronIcon({ className }) {
  return html`
    <svg class=${className} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="m7 10 5 5 5-5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  `;
}

function SwapIcon({ className }) {
  return html`
    <svg class=${className} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M7 16V4m0 0L3.5 7.5M7 4l3.5 3.5M17 8v12m0 0 3.5-3.5M17 20l-3.5-3.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  `;
}

function SortableTh({ label, title, sortKey, align, tableSort, onSort, hideOnMobile }) {
  const active = tableSort.key === sortKey;
  return html`
    <th
      title=${title}
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

// Pas de fond coloré : uniquement le texte, gras, en vert/rouge — le
// reste de l'interface reste noir/blanc/gris.
function ChangeText({ value }) {
  if (value === null || value === undefined) {
    return html`<span class="text-app-muted text-sm">—</span>`;
  }
  const color = value < 0 ? "text-neg" : value > 0 ? "text-pos" : "text-app-muted";
  return html`<span class="font-semibold text-sm tabular-nums whitespace-nowrap ${color}">${formatPct(value)}</span>`;
}

function ChangeCell({ value, hideOnMobile }) {
  return html`<td class="px-2 sm:px-3 py-3.5 text-right ${hideOnMobile ? "hidden sm:table-cell" : ""}">
    <${ChangeText} value=${value} />
  </td>`;
}

function TableSkeleton() {
  const rows = Array.from({ length: 8 });
  return html`
    <div class="animate-fade-in border border-app-border rounded-2xl divide-y divide-app-border/60">
      ${rows.map(
        () => html`
          <div class="flex items-center gap-3 px-2 sm:px-3 py-3.5 animate-pulse">
            <div class="flex-1 space-y-1.5">
              <div class="h-3 w-16 rounded bg-app-surface"></div>
              <div class="h-2.5 w-24 rounded bg-app-surface/70"></div>
            </div>
            <div class="h-3 w-12 rounded bg-app-surface hidden sm:block"></div>
            <div class="h-3 w-10 rounded bg-app-surface"></div>
            <div class="h-3 w-10 rounded bg-app-surface"></div>
            <div class="h-3 w-10 rounded bg-app-surface"></div>
            <div class="h-3 w-10 rounded bg-app-surface"></div>
          </div>
        `
      )}
    </div>
  `;
}

function Top10Skeleton() {
  const cards = Array.from({ length: 5 });
  return html`
    <div class="flex gap-3 overflow-hidden -mx-4 px-4 sm:mx-0 sm:px-0">
      ${cards.map(
        () => html`
          <div class="flex-shrink-0 w-32 sm:w-36 bg-app-surface border border-app-border rounded-2xl p-4 animate-pulse">
            <div class="h-3.5 w-12 rounded bg-app-border mb-3"></div>
            <div class="h-5 w-16 rounded bg-app-border mb-2"></div>
            <div class="h-2.5 w-20 rounded bg-app-border/70"></div>
          </div>
        `
      )}
    </div>
  `;
}

function SymbolDetail({ symbol, todayChangePct, onClose }) {
  const canvasRef = useRef(null);
  const chartRef = useRef(null);
  const [points, setPoints] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      const since = new Date();
      since.setDate(since.getDate() - 180);
      const sinceIso = since.toISOString().slice(0, 10);
      const { data, error } = await supabase
        .from("daily_closes")
        .select("date, close")
        .eq("symbol", symbol)
        .gte("date", sinceIso)
        .order("date", { ascending: true });
      if (!cancelled) {
        setPoints(error ? [] : data || []);
        setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [symbol]);

  useEffect(() => {
    if (!canvasRef.current || points.length === 0) return;
    if (chartRef.current) chartRef.current.destroy();

    const isUp = points.length > 1 && points[points.length - 1].close >= points[0].close;
    const lineColor = isUp ? COLOR_POS : COLOR_NEG;
    const fillColor = isUp ? "rgba(48,209,88,0.08)" : "rgba(255,69,58,0.08)";

    chartRef.current = new Chart(canvasRef.current, {
      type: "line",
      data: {
        labels: points.map((p) =>
          new Date(p.date + "T12:00:00").toLocaleDateString("fr-FR", { day: "2-digit", month: "short" })
        ),
        datasets: [
          {
            data: points.map((p) => p.close),
            borderColor: lineColor,
            backgroundColor: fillColor,
            fill: true,
            borderWidth: 2,
            pointRadius: 0,
            tension: 0.15,
          },
        ],
      },
      options: {
        animation: { duration: 500, easing: "easeOutQuart" },
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { maxTicksLimit: 5, color: COLOR_MUTED }, grid: { display: false } },
          y: {
            ticks: { color: COLOR_MUTED, callback: (v) => `$${v}` },
            grid: { color: "rgba(142,142,147,0.15)" },
          },
        },
      },
    });
    return () => chartRef.current?.destroy();
  }, [points]);

  const last = points[points.length - 1];

  return html`
    <div class="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-3 sm:p-4 animate-fade-in" onClick=${onClose}>
      <div
        class="bg-app-surface border border-app-border rounded-2xl shadow-2xl w-full max-w-2xl p-5 sm:p-6 max-h-[90vh] overflow-y-auto animate-scale-in"
        onClick=${(e) => e.stopPropagation()}
      >
        <div class="flex items-start justify-between mb-1">
          <div>
            <h2 class="text-lg font-bold text-app-text">${symbol}</h2>
            <div class="flex items-baseline gap-2 mt-1">
              ${last && html`<p class="text-3xl font-bold tabular-nums">${formatPrice(last.close)}</p>`}
              <${ChangeText} value=${todayChangePct} />
            </div>
          </div>
          <button
            class="text-app-muted hover:text-app-text text-lg leading-none w-8 h-8 flex items-center justify-center rounded-full hover:bg-app-border/60 active:scale-90 transition-all"
            onClick=${onClose}
          >
            ✕
          </button>
        </div>
        <p class="text-xs text-app-muted mb-5">6 derniers mois</p>
        ${loading &&
        html`<div class="h-56 sm:h-64 flex items-center justify-center">
          <${SpinnerIcon} className="w-6 h-6 text-app-muted" />
        </div>`}
        ${!loading &&
        points.length === 0 &&
        html`<div class="text-sm text-app-muted">Pas de données récentes.</div>`}
        ${!loading &&
        points.length > 0 &&
        html`<div class="relative h-56 sm:h-64"><canvas ref=${canvasRef}></canvas></div>`}
      </div>
    </div>
  `;
}

function Top10Panel({ rows, loading, metric, onMetricChange, direction, onToggleDirection, onSelect }) {
  const activeIndex = METRICS.findIndex((m) => m.key === metric);
  const metricLabel = METRICS[activeIndex]?.label ?? "";
  const directionLabel = direction === "up" ? "hausses" : "baisses";

  // Le curseur épouse la largeur réelle du bouton actif (mesurée), pas un
  // tiers égal de la largeur totale — "Auj." est bien plus court que
  // "Sem."/"Mois", un partage en tiers laissait un pavé blanc visiblement
  // trop large autour de son texte.
  const btnRefs = useRef([]);
  const [thumb, setThumb] = useState({ left: 0, width: 0 });

  useEffect(() => {
    const el = btnRefs.current[activeIndex];
    if (el) setThumb({ left: el.offsetLeft, width: el.offsetWidth });
  }, [metric, rows.length]);

  return html`
    <section>
      <div class="flex flex-wrap items-center justify-between gap-2 mb-3">
        <div class="flex items-center gap-1.5">
          <h2 class="text-xs font-semibold text-app-muted uppercase tracking-wide">
            Top 10 des plus fortes ${directionLabel} — ${metricLabel}
          </h2>
          <button
            title=${direction === "up" ? "Voir les baisses" : "Voir les hausses"}
            class="text-app-muted hover:text-app-text active:scale-90 transition-all p-0.5 rounded-full"
            onClick=${onToggleDirection}
          >
            <${SwapIcon} className="w-3.5 h-3.5" />
          </button>
        </div>
        <div class="relative flex bg-app-surface rounded-full border border-white/[0.08] p-1 text-sm">
          <div
            class="absolute top-1 bottom-1 rounded-full bg-app-text shadow-[0_2px_8px_rgba(0,0,0,0.4)] transition-all duration-300 ease-juicy"
            style=${{ left: `${thumb.left}px`, width: `${thumb.width}px` }}
          ></div>
          ${METRICS.map(
            (m, i) => html`
              <button
                ref=${(el) => (btnRefs.current[i] = el)}
                title=${m.title}
                class=${"relative z-10 px-4 py-1.5 rounded-full font-medium transition-colors duration-200 " +
                (metric === m.key ? "text-app-bg" : "text-app-muted hover:text-app-text")}
                onClick=${() => onMetricChange(m.key)}
              >
                ${m.label}
              </button>
            `
          )}
        </div>
      </div>
      ${loading && rows.length === 0
        ? html`<${Top10Skeleton} />`
        : rows.length === 0
        ? html`<p class="text-sm text-app-muted">Pas encore de données.</p>`
        : html`
            <div class="no-scrollbar flex gap-3 overflow-x-auto pt-3 pb-1 -mx-4 px-4 sm:mx-0 sm:px-0">
              ${rows.map(
                (r, i) => html`
                  <button
                    key=${r.symbol}
                    class="flex-shrink-0 w-32 sm:w-36 text-left bg-app-surface border border-white/[0.12] rounded-2xl p-4 hover:border-white/25 hover:-translate-y-1.5 active:-translate-y-1.5 hover:shadow-[0_10px_30px_-8px_rgba(255,255,255,0.1)] active:shadow-[0_10px_30px_-8px_rgba(255,255,255,0.1)] active:scale-[0.98] transition-all duration-200 ease-juicy animate-fade-in-up"
                    style=${{ animationDelay: `${i * 35}ms` }}
                    onClick=${() => onSelect(r.symbol)}
                  >
                    <div class="flex items-center justify-between mb-2">
                      <span class="font-bold text-sm text-app-text">${r.symbol}</span>
                      <span class="text-[10px] text-app-muted">#${i + 1}</span>
                    </div>
                    <div class="text-lg font-bold tabular-nums ${r[metric] < 0 ? "text-neg" : r[metric] > 0 ? "text-pos" : "text-app-muted"}">
                      ${formatPct(r[metric])}
                    </div>
                    <div class="text-xs text-app-muted truncate mt-1">${r.name}</div>
                  </button>
                `
              )}
            </div>
          `}
    </section>
  `;
}

function App() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [sector, setSector] = useState(SECTORS_ALL);
  const [search, setSearch] = useState("");
  // "Creux" par défaut : c'est la métrique la plus directe pour repérer
  // un titre actuellement déprimé par rapport à sa normale récente
  // (l'objectif recherché), plutôt qu'un simple déplacement sur la
  // période comme Sem./Mois.
  const [top10Metric, setTop10Metric] = useState("drawdown_20d_pct");
  const [top10Direction, setTop10Direction] = useState("down");
  const [tableSort, setTableSort] = useState({ key: "drawdown_20d_pct", dir: "asc" });
  const [selected, setSelected] = useState(null);

  // Le header du tableau colle juste sous la barre de filtres, elle
  // aussi collante. Sa hauteur change entre mobile (recherche + select
  // sur 2 lignes) et desktop (1 ligne) : on la mesure au runtime au
  // lieu de deviner un décalage en pixels.
  const filterBarRef = useRef(null);
  const [filterBarHeight, setFilterBarHeight] = useState(0);

  useEffect(() => {
    const el = filterBarRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    // offsetHeight (border-box, padding inclus), pas contentRect.height
    // (content-box, padding exclu) : la barre a du padding vertical, donc
    // contentRect sous-évaluait sa vraie hauteur affichée — le tableau se
    // calait trop haut et mordait sur la première ligne.
    const observer = new ResizeObserver(() => setFilterBarHeight(el.offsetHeight));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  function toggleSort(key) {
    setTableSort((prev) => (prev.key === key ? { key, dir: prev.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }));
  }

  async function load() {
    setLoading(true);
    setError(null);
    const { data, error: err } = await supabase
      .from("metrics")
      .select(
        "symbol, last_price, last_date, today_change_pct, week_change_pct, month_change_pct, drawdown_20d_pct, tickers(name, sector, is_active)"
      )
      .order("drawdown_20d_pct", { ascending: true });

    if (err) {
      setError(err.message);
      setLoading(false);
      return;
    }

    const flat = (data || [])
      .filter((r) => r.tickers?.is_active !== false)
      .map((r) => ({
        symbol: r.symbol,
        name: r.tickers?.name ?? "",
        sector: r.tickers?.sector ?? "",
        last_price: r.last_price,
        last_date: r.last_date,
        today_change_pct: r.today_change_pct,
        week_change_pct: r.week_change_pct,
        month_change_pct: r.month_change_pct,
        drawdown_20d_pct: r.drawdown_20d_pct,
      }));

    setRows(flat);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  const sectors = useMemo(() => {
    const set = new Set(rows.map((r) => r.sector).filter(Boolean));
    return [SECTORS_ALL, ...Array.from(set).sort()];
  }, [rows]);

  const visibleRows = useMemo(() => {
    let out = rows;
    if (sector !== SECTORS_ALL) {
      out = out.filter((r) => r.sector === sector);
    }
    const q = search.trim().toLowerCase();
    if (q) {
      out = out.filter((r) => r.symbol.toLowerCase().includes(q) || r.name.toLowerCase().includes(q));
    }
    return [...out].sort((a, b) => compareRows(a, b, tableSort.key, tableSort.dir));
  }, [rows, sector, search, tableSort]);

  // Le top 10 reste indépendant des filtres secteur/recherche/tri du tableau :
  // c'est une vue d'ensemble rapide, le tableau en dessous sert à creuser un
  // sous-ensemble ou à trier par une autre colonne. Auj./Sem./Mois peuvent
  // être positifs ou négatifs, donc "Hausses" a un vrai sens dessus. Creux
  // reste par construction toujours <= 0 (écart à un plus-haut qui inclut
  // le jour même) : "Hausses" y affiche juste les titres les moins loin de
  // leur plus-haut 20 jours.
  const top10 = useMemo(() => {
    const sorted = [...rows].sort((a, b) => (a[top10Metric] ?? 0) - (b[top10Metric] ?? 0));
    return top10Direction === "down" ? sorted.slice(0, 10) : sorted.slice(-10).reverse();
  }, [rows, top10Metric, top10Direction]);

  const lastCloseDate = useMemo(
    () => rows.reduce((max, r) => (r.last_date && (!max || r.last_date > max) ? r.last_date : max), null),
    [rows]
  );

  const selectedRow = selected ? rows.find((r) => r.symbol === selected) : null;
  const showSkeleton = loading && rows.length === 0;
  const isFiltered = sector !== SECTORS_ALL || search.trim() !== "";

  return html`
    <div class="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
      <header class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 rounded-xl bg-app-surface border border-app-border flex items-center justify-center flex-shrink-0">
            <img src="./logo.png" alt="" class="w-5 h-5 invert" />
          </div>
          <div>
            <h1 class="text-2xl font-bold tracking-tight text-app-text leading-tight">S&P 500</h1>
            <p class="text-sm text-app-muted">Vs ouverture, semaine et mois — outil de recherche perso.</p>
          </div>
        </div>
        <div class="flex flex-wrap items-center gap-2 text-xs sm:text-sm">
          <span class="text-app-muted whitespace-nowrap">Clôture du ${formatCloseDate(lastCloseDate)}</span>
          <button
            class="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full border border-app-border text-app-text hover:bg-app-surface active:scale-95 transition-all duration-150 whitespace-nowrap disabled:opacity-60"
            onClick=${load}
            disabled=${loading}
          >
            ${loading && html`<${SpinnerIcon} className="w-3.5 h-3.5" />`}
            Rafraîchir
          </button>
        </div>
      </header>

      <${Top10Panel}
        rows=${top10}
        loading=${loading}
        metric=${top10Metric}
        onMetricChange=${setTop10Metric}
        direction=${top10Direction}
        onToggleDirection=${() => setTop10Direction((d) => (d === "down" ? "up" : "down"))}
        onSelect=${setSelected}
      />

      <div class="border-t border-app-border/60 mt-8 pt-6">
        <div ref=${filterBarRef} class="sticky top-0 z-20 bg-app-bg pt-2 pb-4 -mx-4 px-4 sm:mx-0 sm:px-0">
          <div class="flex flex-wrap items-center gap-2.5">
            <div class="relative w-full sm:w-auto sm:flex-1 sm:min-w-[220px]">
              <${SearchIcon} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-app-muted" />
              <input
                type="text"
                placeholder="Rechercher un symbole ou un nom…"
                class="w-full bg-app-surface border border-app-border rounded-full pl-10 pr-9 py-2.5 text-sm text-app-text placeholder-app-muted transition-shadow focus:outline-none focus:ring-4 focus:ring-white/5 focus:border-app-muted"
                value=${search}
                onInput=${(e) => setSearch(e.target.value)}
              />
              ${search &&
              html`<button
                class="absolute right-3 top-1/2 -translate-y-1/2 text-app-muted hover:text-app-text active:scale-90 transition-transform"
                onClick=${() => setSearch("")}
                aria-label="Effacer la recherche"
              >
                ✕
              </button>`}
            </div>
            <div class="relative flex-1 sm:flex-none">
              <select
                class="appearance-none w-full bg-app-surface border border-app-border rounded-full pl-4 pr-9 py-2.5 text-sm text-app-text transition-shadow focus:outline-none focus:ring-4 focus:ring-white/5 focus:border-app-muted"
                value=${sector}
                onChange=${(e) => setSector(e.target.value)}
              >
                ${sectors.map((s) => html`<option value=${s}>${s}</option>`)}
              </select>
              <${ChevronIcon} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-app-muted" />
            </div>
          </div>
        </div>

        <div class="flex items-baseline justify-between mb-3 mt-1">
          <h2 class="text-xs font-semibold text-app-muted uppercase tracking-wide">
            ${isFiltered ? "Résultats" : "Tous les titres"}
          </h2>
          ${!showSkeleton && html`<span class="text-xs text-app-muted">${visibleRows.length}</span>`}
        </div>

        ${error && html`<div class="mb-3 text-sm text-neg animate-fade-in">Erreur de chargement : ${error}</div>`}
        ${showSkeleton && html`<${TableSkeleton} />`}
        ${!showSkeleton &&
        !error &&
        html`
          <div class="animate-fade-in border border-app-border rounded-2xl">
            <table class="w-full text-sm">
              <thead class="sticky z-10 bg-app-bg" style=${{ top: `${filterBarHeight}px` }}>
                <tr class="border-b border-app-border">
                  <${SortableTh} label="Titre" sortKey="symbol" tableSort=${tableSort} onSort=${toggleSort} />
                  <${SortableTh} label="Secteur" sortKey="sector" hideOnMobile tableSort=${tableSort} onSort=${toggleSort} />
                  <${SortableTh}
                    label="Dernier"
                    sortKey="last_price"
                    align="right"
                    hideOnMobile
                    tableSort=${tableSort}
                    onSort=${toggleSort}
                  />
                  ${METRICS.map(
                    (m) => html`
                      <${SortableTh}
                        label=${m.label}
                        title=${m.title}
                        sortKey=${m.key}
                        align="right"
                        hideOnMobile=${m.hideOnMobile}
                        tableSort=${tableSort}
                        onSort=${toggleSort}
                      />
                    `
                  )}
                </tr>
              </thead>
              <tbody class="divide-y divide-app-border/60">
                ${visibleRows.map(
                  (r) => html`
                    <tr
                      key=${r.symbol}
                      class="relative border-l-2 border-l-transparent hover:border-l-app-text/40 hover:bg-app-surface/60 active:bg-app-surface cursor-pointer hover:-translate-y-0.5 active:-translate-y-0.5 hover:shadow-[0_6px_16px_-6px_rgba(255,255,255,0.1)] active:shadow-[0_6px_16px_-6px_rgba(255,255,255,0.1)] transition-all duration-150 ease-juicy"
                      onClick=${() => setSelected(r.symbol)}
                    >
                      <td class="px-2 sm:px-3 py-3.5">
                        <div class="font-semibold text-app-text">${r.symbol}</div>
                        <div class="text-xs text-app-muted truncate max-w-[140px] sm:max-w-none">${r.name}</div>
                      </td>
                      <td class="px-2 sm:px-3 py-3.5 text-app-muted hidden sm:table-cell">${r.sector}</td>
                      <td class="px-2 sm:px-3 py-3.5 text-right text-app-text tabular-nums hidden sm:table-cell whitespace-nowrap">
                        ${formatPrice(r.last_price)}
                      </td>
                      ${METRICS.map((m) => html`<${ChangeCell} value=${r[m.key]} hideOnMobile=${m.hideOnMobile} />`)}
                    </tr>
                  `
                )}
              </tbody>
            </table>
            ${visibleRows.length === 0 &&
            html`<div class="p-8 text-center text-sm text-app-muted">
              ${rows.length === 0 ? "Aucune donnée pour l'instant." : "Aucun résultat pour ce filtre."}
            </div>`}
          </div>
        `}
      </div>

      ${selected &&
      html`<${SymbolDetail}
        symbol=${selected}
        todayChangePct=${selectedRow?.today_change_pct}
        onClose=${() => setSelected(null)}
      />`}

      <footer class="mt-10 text-xs text-app-muted">
        <a href="./admin.html" class="underline hover:text-app-text transition-colors">Administration</a>
      </footer>
    </div>
  `;
}

render(html`<${App} />`, document.getElementById("app"));
