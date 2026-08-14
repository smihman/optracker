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
  { key: "today_change_pct", label: "Auj." },
  { key: "week_drawdown_pct", label: "Sem." },
  { key: "month_drawdown_pct", label: "Mois" },
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

function SortableTh({ label, sortKey, align, tableSort, onSort, hideOnMobile }) {
  const active = tableSort.key === sortKey;
  const arrow = active ? (tableSort.dir === "asc" ? " ▲" : " ▼") : "";
  return html`
    <th
      class=${"px-2 sm:px-3 py-2.5 cursor-pointer select-none whitespace-nowrap text-xs uppercase tracking-wide font-medium hover:text-app-text transition-colors " +
      (align === "right" ? "text-right" : "text-left") +
      (active ? " text-app-text" : " text-app-muted") +
      (hideOnMobile ? " hidden sm:table-cell" : "")}
      onClick=${() => onSort(sortKey)}
    >
      ${label}${arrow}
    </th>
  `;
}

// Pas de fond coloré : uniquement le texte, gras, en vert/rouge — le
// reste de l'interface reste noir/blanc/gris.
function DrawdownText({ value }) {
  if (value === null || value === undefined) {
    return html`<span class="text-app-muted text-sm">—</span>`;
  }
  const color = value < 0 ? "text-neg" : value > 0 ? "text-pos" : "text-app-muted";
  return html`<span class="font-semibold text-sm tabular-nums whitespace-nowrap ${color}">${formatPct(value)}</span>`;
}

function DrawdownCell({ value }) {
  return html`<td class="px-2 sm:px-3 py-3 text-right"><${DrawdownText} value=${value} /></td>`;
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
        animation: false,
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
    <div class="fixed inset-0 bg-black/60 flex items-center justify-center p-3 sm:p-4" onClick=${onClose}>
      <div
        class="bg-app-surface border border-app-border rounded-2xl shadow-2xl w-full max-w-2xl p-4 sm:p-5 max-h-[90vh] overflow-y-auto"
        onClick=${(e) => e.stopPropagation()}
      >
        <div class="flex items-start justify-between mb-1">
          <div>
            <h2 class="text-lg font-bold text-app-text">${symbol}</h2>
            <div class="flex items-baseline gap-2 mt-0.5">
              ${last && html`<p class="text-2xl font-bold tabular-nums">${formatPrice(last.close)}</p>`}
              <${DrawdownText} value=${todayChangePct} />
            </div>
          </div>
          <button class="text-app-muted hover:text-app-text text-lg leading-none px-1" onClick=${onClose}>✕</button>
        </div>
        <p class="text-xs text-app-muted mb-4">6 derniers mois</p>
        ${loading && html`<div class="text-sm text-app-muted">Chargement…</div>`}
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

function Top10Panel({ rows, metric, onMetricChange, onSelect }) {
  const metricLabel = METRICS.find((m) => m.key === metric)?.label ?? "";
  return html`
    <div class="mb-6">
      <div class="flex items-center justify-between mb-2">
        <h2 class="text-xs font-semibold text-app-muted uppercase tracking-wide">
          Top 10 des plus fortes baisses — ${metricLabel}
        </h2>
        <div class="flex rounded-full border border-app-border overflow-hidden text-xs">
          ${METRICS.map(
            (m) => html`
              <button
                class=${"px-2.5 py-1 " + (metric === m.key ? "bg-app-text text-app-bg" : "text-app-muted hover:text-app-text")}
                onClick=${() => onMetricChange(m.key)}
              >
                ${m.label}
              </button>
            `
          )}
        </div>
      </div>
      ${rows.length === 0
        ? html`<p class="text-sm text-app-muted">Pas encore de données.</p>`
        : html`
            <div class="flex gap-2.5 overflow-x-auto pb-1 -mx-4 px-4 sm:mx-0 sm:px-0">
              ${rows.map(
                (r, i) => html`
                  <button
                    class="flex-shrink-0 w-32 sm:w-36 text-left bg-app-surface border border-app-border rounded-2xl p-3 hover:border-app-muted/60 transition-colors"
                    onClick=${() => onSelect(r.symbol)}
                  >
                    <div class="flex items-center justify-between mb-1.5">
                      <span class="font-bold text-sm text-app-text">${r.symbol}</span>
                      <span class="text-[10px] text-app-muted">#${i + 1}</span>
                    </div>
                    <div class="text-lg font-bold tabular-nums ${r[metric] < 0 ? "text-neg" : r[metric] > 0 ? "text-pos" : "text-app-muted"}">
                      ${formatPct(r[metric])}
                    </div>
                    <div class="text-xs text-app-muted truncate mt-0.5">${r.name}</div>
                  </button>
                `
              )}
            </div>
          `}
    </div>
  `;
}

function App() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [sector, setSector] = useState(SECTORS_ALL);
  const [search, setSearch] = useState("");
  const [top10Metric, setTop10Metric] = useState("week_drawdown_pct");
  const [tableSort, setTableSort] = useState({ key: "week_drawdown_pct", dir: "asc" });
  const [selected, setSelected] = useState(null);

  function toggleSort(key) {
    setTableSort((prev) => (prev.key === key ? { key, dir: prev.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }));
  }

  async function load() {
    setLoading(true);
    setError(null);
    const { data, error: err } = await supabase
      .from("metrics")
      .select(
        "symbol, last_price, last_date, today_change_pct, week_drawdown_pct, month_drawdown_pct, tickers(name, sector, is_active)"
      )
      .order("week_drawdown_pct", { ascending: true });

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
        week_drawdown_pct: r.week_drawdown_pct,
        month_drawdown_pct: r.month_drawdown_pct,
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
  // sous-ensemble ou à trier par une autre colonne.
  const top10 = useMemo(
    () => [...rows].sort((a, b) => (a[top10Metric] ?? 0) - (b[top10Metric] ?? 0)).slice(0, 10),
    [rows, top10Metric]
  );

  const lastCloseDate = useMemo(
    () => rows.reduce((max, r) => (r.last_date && (!max || r.last_date > max) ? r.last_date : max), null),
    [rows]
  );

  const selectedRow = selected ? rows.find((r) => r.symbol === selected) : null;

  return html`
    <div class="max-w-6xl mx-auto p-4">
      <header class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
        <div>
          <h1 class="text-2xl font-bold tracking-tight text-app-text">S&P 500</h1>
          <p class="text-sm text-app-muted">Vs ouverture / semaine / mois — recherche perso, pas un conseil.</p>
        </div>
        <div class="flex flex-wrap items-center gap-2 text-xs sm:text-sm">
          <span class="text-app-muted whitespace-nowrap">Clôture du ${formatCloseDate(lastCloseDate)}</span>
          <button
            class="px-3 py-1.5 rounded-full border border-app-border text-app-text hover:bg-app-surface transition-colors whitespace-nowrap"
            onClick=${load}
          >
            Rafraîchir
          </button>
        </div>
      </header>

      <${Top10Panel} rows=${top10} metric=${top10Metric} onMetricChange=${setTop10Metric} onSelect=${setSelected} />

      <div class="flex flex-wrap items-center gap-2 mb-4">
        <input
          type="search"
          placeholder="Rechercher un symbole ou un nom…"
          class="bg-app-surface border border-app-border rounded-full px-4 py-2 text-sm text-app-text placeholder-app-muted w-full sm:w-auto sm:flex-1 sm:min-w-[200px] focus:outline-none focus:border-app-muted"
          value=${search}
          onInput=${(e) => setSearch(e.target.value)}
        />
        <select
          class="bg-app-surface border border-app-border rounded-full px-3 py-2 text-sm text-app-text flex-1 sm:flex-none focus:outline-none focus:border-app-muted"
          value=${sector}
          onChange=${(e) => setSector(e.target.value)}
        >
          ${sectors.map((s) => html`<option value=${s}>${s}</option>`)}
        </select>
      </div>

      ${error && html`<div class="mb-3 text-sm text-neg">Erreur de chargement : ${error}</div>`}
      ${loading && html`<div class="text-sm text-app-muted">Chargement…</div>`}
      ${!loading &&
      !error &&
      html`
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead>
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
                <${SortableTh}
                  label="Auj."
                  sortKey="today_change_pct"
                  align="right"
                  tableSort=${tableSort}
                  onSort=${toggleSort}
                />
                <${SortableTh}
                  label="Sem."
                  sortKey="week_drawdown_pct"
                  align="right"
                  tableSort=${tableSort}
                  onSort=${toggleSort}
                />
                <${SortableTh}
                  label="Mois"
                  sortKey="month_drawdown_pct"
                  align="right"
                  tableSort=${tableSort}
                  onSort=${toggleSort}
                />
              </tr>
            </thead>
            <tbody class="divide-y divide-app-border/60">
              ${visibleRows.map(
                (r) => html`
                  <tr class="hover:bg-app-surface/60 cursor-pointer transition-colors" onClick=${() => setSelected(r.symbol)}>
                    <td class="px-2 sm:px-3 py-3">
                      <div class="font-semibold text-app-text">${r.symbol}</div>
                      <div class="text-xs text-app-muted truncate max-w-[140px] sm:max-w-none">${r.name}</div>
                    </td>
                    <td class="px-2 sm:px-3 py-3 text-app-muted hidden sm:table-cell">${r.sector}</td>
                    <td class="px-2 sm:px-3 py-3 text-right text-app-text tabular-nums hidden sm:table-cell whitespace-nowrap">
                      ${formatPrice(r.last_price)}
                    </td>
                    <${DrawdownCell} value=${r.today_change_pct} />
                    <${DrawdownCell} value=${r.week_drawdown_pct} />
                    <${DrawdownCell} value=${r.month_drawdown_pct} />
                  </tr>
                `
              )}
            </tbody>
          </table>
          ${visibleRows.length === 0 &&
          html`<div class="p-6 text-center text-sm text-app-muted">
            ${rows.length === 0 ? "Aucune donnée pour l'instant." : "Aucun résultat pour ce filtre."}
          </div>`}
        </div>
      `}
      ${selected &&
      html`<${SymbolDetail}
        symbol=${selected}
        todayChangePct=${selectedRow?.today_change_pct}
        onClose=${() => setSelected(null)}
      />`}

      <footer class="mt-8 text-xs text-app-muted">
        <a href="./admin.html" class="underline hover:text-app-text">Administration</a>
      </footer>
    </div>
  `;
}

render(html`<${App} />`, document.getElementById("app"));
