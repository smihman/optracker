import { h, render } from "https://esm.sh/preact@10.19.6";
import { useEffect, useMemo, useRef, useState } from "https://esm.sh/preact@10.19.6/hooks";
import htm from "https://esm.sh/htm@3.1.1";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import Chart from "https://esm.sh/chart.js@4.4.4/auto";

import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

const html = htm.bind(h);
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const SECTORS_ALL = "Tous secteurs";
const FRESHNESS_MARGIN_MS = 45 * 60 * 1000; // cron toutes les 30 min + marge

function formatPct(value) {
  if (value === null || value === undefined) return "—";
  return `${value.toFixed(2)}%`;
}

function formatPrice(value) {
  if (value === null || value === undefined) return "—";
  return `$${Number(value).toFixed(2)}`;
}

function formatDateTime(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return (
    d.toLocaleString("fr-FR", {
      timeZone: "America/New_York",
      hour: "2-digit",
      minute: "2-digit",
      day: "2-digit",
      month: "2-digit",
    }) + " ET"
  );
}

function isFresh(updatedAt) {
  if (!updatedAt) return false;
  return Date.now() - new Date(updatedAt).getTime() < FRESHNESS_MARGIN_MS;
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

function SortableTh({ label, sortKey, align, tableSort, onSort }) {
  const active = tableSort.key === sortKey;
  const arrow = active ? (tableSort.dir === "asc" ? " ▲" : " ▼") : "";
  return html`
    <th
      class=${"px-3 py-2 cursor-pointer select-none hover:text-slate-700 " +
      (align === "right" ? "text-right" : "text-left") +
      (active ? " text-slate-700" : "")}
      onClick=${() => onSort(sortKey)}
    >
      ${label}${arrow}
    </th>
  `;
}

function DrawdownCell({ value }) {
  if (value === null || value === undefined) {
    return html`<td class="px-3 py-2 text-right text-slate-400">—</td>`;
  }
  const color = value < 0 ? "text-red-600" : value > 0 ? "text-emerald-600" : "text-slate-500";
  return html`<td class="px-3 py-2 text-right font-medium ${color}">${formatPct(value)}</td>`;
}

function SymbolDetail({ symbol, onClose }) {
  const canvasRef = useRef(null);
  const chartRef = useRef(null);
  const [points, setPoints] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const { data, error } = await supabase
        .from("prices")
        .select("ts, price")
        .eq("symbol", symbol)
        .gte("ts", since)
        .order("ts", { ascending: true });
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
    chartRef.current = new Chart(canvasRef.current, {
      type: "line",
      data: {
        labels: points.map((p) =>
          new Date(p.ts).toLocaleString("fr-FR", {
            timeZone: "America/New_York",
            day: "2-digit",
            month: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
          })
        ),
        datasets: [
          {
            data: points.map((p) => p.price),
            borderColor: "#0f172a",
            borderWidth: 1.5,
            pointRadius: 0,
            tension: 0.1,
          },
        ],
      },
      options: {
        animation: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { maxTicksLimit: 6, autoSkip: true } },
          y: { ticks: { callback: (v) => `$${v}` } },
        },
      },
    });
    return () => chartRef.current?.destroy();
  }, [points]);

  return html`
    <div class="fixed inset-0 bg-black/30 flex items-center justify-center p-4" onClick=${onClose}>
      <div
        class="bg-white rounded-lg shadow-xl w-full max-w-2xl p-4"
        onClick=${(e) => e.stopPropagation()}
      >
        <div class="flex items-center justify-between mb-3">
          <h2 class="font-semibold text-slate-900">${symbol} — 7 derniers jours</h2>
          <button class="text-slate-400 hover:text-slate-600" onClick=${onClose}>✕</button>
        </div>
        ${loading && html`<div class="text-sm text-slate-400">Chargement…</div>`}
        ${!loading &&
        points.length === 0 &&
        html`<div class="text-sm text-slate-400">Pas de données récentes.</div>`}
        ${!loading && points.length > 0 && html`<canvas ref=${canvasRef} height="120"></canvas>`}
      </div>
    </div>
  `;
}

function Top10Panel({ rows, metric, onSelect }) {
  if (rows.length === 0) return null;
  const label = metric === "week_drawdown_pct" ? "cette semaine" : "ce mois-ci";
  return html`
    <div class="mb-4">
      <h2 class="text-sm font-semibold text-slate-600 mb-2">Top 10 des plus fortes baisses — ${label}</h2>
      <div class="flex gap-2 overflow-x-auto pb-1">
        ${rows.map(
          (r, i) => html`
            <button
              class="flex-shrink-0 w-36 text-left border border-slate-200 rounded-lg p-2.5 bg-white hover:border-slate-300"
              onClick=${() => onSelect(r.symbol)}
            >
              <div class="flex items-center justify-between">
                <span class="text-xs text-slate-400">#${i + 1}</span>
                <span class="font-semibold text-sm text-slate-900">${r.symbol}</span>
              </div>
              <div class="text-red-600 font-medium text-sm mt-1">${formatPct(r[metric])}</div>
              <div class="text-xs text-slate-500 truncate">${r.name}</div>
            </button>
          `
        )}
      </div>
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
        "symbol, last_price, week_drawdown_pct, month_drawdown_pct, updated_at, tickers(name, sector, is_active)"
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
        week_drawdown_pct: r.week_drawdown_pct,
        month_drawdown_pct: r.month_drawdown_pct,
        updated_at: r.updated_at,
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

  const latestUpdate = useMemo(
    () => rows.reduce((max, r) => (r.updated_at && (!max || r.updated_at > max) ? r.updated_at : max), null),
    [rows]
  );

  const marketOpen = isFresh(latestUpdate);

  return html`
    <div class="max-w-6xl mx-auto p-4">
      <header class="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <h1 class="text-xl font-semibold text-slate-900">S&P 500 — Décotes</h1>
          <p class="text-sm text-slate-500">
            Outil de recherche personnel. Données factuelles, pas une recommandation d'achat.
          </p>
        </div>
        <div class="flex items-center gap-3 text-sm">
          <span
            class=${"inline-flex items-center gap-1.5 px-2 py-1 rounded-full " +
            (marketOpen ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500")}
          >
            <span class=${"w-1.5 h-1.5 rounded-full " + (marketOpen ? "bg-emerald-500" : "bg-slate-400")}></span>
            ${marketOpen ? "Marché ouvert" : "Marché fermé / données figées"}
          </span>
          <span class="text-slate-400">MAJ ${formatDateTime(latestUpdate)}</span>
          <button class="px-3 py-1.5 rounded-md border border-slate-300 text-slate-700 hover:bg-slate-50" onClick=${load}>
            Rafraîchir
          </button>
        </div>
      </header>

      <${Top10Panel} rows=${top10} metric=${top10Metric} onSelect=${setSelected} />

      <div class="flex flex-wrap items-center gap-3 mb-3 text-sm">
        <input
          type="search"
          placeholder="Rechercher un symbole ou un nom…"
          class="border border-slate-300 rounded-md px-2 py-1.5 flex-1 min-w-[200px]"
          value=${search}
          onInput=${(e) => setSearch(e.target.value)}
        />
        <select
          class="border border-slate-300 rounded-md px-2 py-1.5"
          value=${sector}
          onChange=${(e) => setSector(e.target.value)}
        >
          ${sectors.map((s) => html`<option value=${s}>${s}</option>`)}
        </select>
        <span class="text-slate-400">Top 10 :</span>
        <div class="flex rounded-md border border-slate-300 overflow-hidden">
          <button
            class=${"px-3 py-1.5 " + (top10Metric === "week_drawdown_pct" ? "bg-slate-900 text-white" : "bg-white text-slate-700")}
            onClick=${() => setTop10Metric("week_drawdown_pct")}
          >
            Semaine
          </button>
          <button
            class=${"px-3 py-1.5 " + (top10Metric === "month_drawdown_pct" ? "bg-slate-900 text-white" : "bg-white text-slate-700")}
            onClick=${() => setTop10Metric("month_drawdown_pct")}
          >
            Mois
          </button>
        </div>
      </div>

      ${error && html`<div class="mb-3 text-sm text-red-600">Erreur de chargement : ${error}</div>`}
      ${loading && html`<div class="text-sm text-slate-400">Chargement…</div>`}
      ${!loading &&
      !error &&
      html`
        <div class="overflow-x-auto border border-slate-200 rounded-lg">
          <table class="w-full text-sm">
            <thead class="bg-slate-50 text-slate-500 text-xs uppercase">
              <tr>
                <${SortableTh} label="Symbole" sortKey="symbol" tableSort=${tableSort} onSort=${toggleSort} />
                <${SortableTh} label="Nom" sortKey="name" tableSort=${tableSort} onSort=${toggleSort} />
                <${SortableTh} label="Secteur" sortKey="sector" tableSort=${tableSort} onSort=${toggleSort} />
                <${SortableTh} label="Dernier" sortKey="last_price" align="right" tableSort=${tableSort} onSort=${toggleSort} />
                <${SortableTh} label="% Semaine" sortKey="week_drawdown_pct" align="right" tableSort=${tableSort} onSort=${toggleSort} />
                <${SortableTh} label="% Mois" sortKey="month_drawdown_pct" align="right" tableSort=${tableSort} onSort=${toggleSort} />
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100">
              ${visibleRows.map(
                (r) => html`
                  <tr class="hover:bg-slate-50 cursor-pointer" onClick=${() => setSelected(r.symbol)}>
                    <td class="px-3 py-2 font-medium text-slate-900">${r.symbol}</td>
                    <td class="px-3 py-2 text-slate-600">${r.name}</td>
                    <td class="px-3 py-2 text-slate-500">${r.sector}</td>
                    <td class="px-3 py-2 text-right text-slate-700">${formatPrice(r.last_price)}</td>
                    <${DrawdownCell} value=${r.week_drawdown_pct} />
                    <${DrawdownCell} value=${r.month_drawdown_pct} />
                  </tr>
                `
              )}
            </tbody>
          </table>
          ${visibleRows.length === 0 &&
          html`<div class="p-6 text-center text-sm text-slate-400">
            ${rows.length === 0 ? "Aucune donnée pour l'instant." : "Aucun résultat pour ce filtre."}
          </div>`}
        </div>
      `}
      ${selected && html`<${SymbolDetail} symbol=${selected} onClose=${() => setSelected(null)} />`}

      <footer class="mt-6 text-xs text-slate-400">
        <a href="./admin.html" class="underline hover:text-slate-600">Administration</a>
      </footer>
    </div>
  `;
}

render(html`<${App} />`, document.getElementById("app"));
