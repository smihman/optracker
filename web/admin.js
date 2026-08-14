import { h, render } from "https://esm.sh/preact@10.19.6";
import { useEffect, useState } from "https://esm.sh/preact@10.19.6/hooks";
import htm from "https://esm.sh/htm@3.1.1";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

const html = htm.bind(h);
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Écriture réservée à un utilisateur Supabase Auth authentifié (voir
// supabase/migrations/0002_admin_write.sql). Ce compte se crée
// manuellement une seule fois : Supabase Dashboard > Authentication >
// Users > Add user. Pas d'inscription publique exposée ici.

function SpinnerIcon({ className }) {
  return html`
    <svg class=${"animate-spin " + (className ?? "")} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="12" cy="12" r="9" stroke="currentColor" stroke-opacity="0.25" stroke-width="2.5" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" />
    </svg>
  `;
}

function LoginForm({ onLoggedIn }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { data, error: err } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (err) {
      setError(err.message);
      return;
    }
    onLoggedIn(data.session);
  }

  return html`
    <form
      class="max-w-sm mx-auto mt-12 sm:mt-24 p-5 sm:p-6 bg-app-surface border border-app-border rounded-2xl animate-scale-in"
      onSubmit=${submit}
    >
      <h1 class="text-lg font-bold text-app-text mb-4">Administration</h1>
      <label class="block text-sm text-app-muted mb-1">Email</label>
      <input
        class="w-full bg-app-bg border border-app-border rounded-lg px-2 py-1.5 mb-3 text-app-text transition-shadow focus:outline-none focus:ring-2 focus:ring-white/10 focus:border-app-muted"
        type="email"
        value=${email}
        onInput=${(e) => setEmail(e.target.value)}
        required
      />
      <label class="block text-sm text-app-muted mb-1">Mot de passe</label>
      <input
        class="w-full bg-app-bg border border-app-border rounded-lg px-2 py-1.5 mb-4 text-app-text transition-shadow focus:outline-none focus:ring-2 focus:ring-white/10 focus:border-app-muted"
        type="password"
        value=${password}
        onInput=${(e) => setPassword(e.target.value)}
        required
      />
      ${error && html`<div class="text-sm text-neg mb-3 animate-fade-in">${error}</div>`}
      <button
        class="w-full flex items-center justify-center gap-2 bg-app-text text-app-bg font-semibold rounded-lg py-2 active:scale-[0.98] transition-transform disabled:opacity-50"
        disabled=${busy}
      >
        ${busy && html`<${SpinnerIcon} className="w-4 h-4" />`}
        ${busy ? "Connexion…" : "Se connecter"}
      </button>
    </form>
  `;
}

function StatCard({ label, value, delay }) {
  return html`
    <div
      class="bg-app-surface border border-app-border rounded-2xl p-3 animate-fade-in-up"
      style=${{ animationDelay: `${delay}ms` }}
    >
      <div class="text-xs text-app-muted">${label}</div>
      <div class="text-lg font-bold text-app-text tabular-nums">${value}</div>
    </div>
  `;
}

function TickersPanel({ tickers, onToggle }) {
  const [filter, setFilter] = useState("");
  const visible = tickers.filter(
    (t) =>
      t.symbol.toLowerCase().includes(filter.toLowerCase()) ||
      (t.name ?? "").toLowerCase().includes(filter.toLowerCase())
  );

  return html`
    <div class="bg-app-surface border border-app-border rounded-2xl p-4 animate-fade-in-up" style=${{ animationDelay: "120ms" }}>
      <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-3">
        <h2 class="font-semibold text-app-text">Tickers (${tickers.length})</h2>
        <input
          class="bg-app-bg border border-app-border rounded-full px-3 py-1 text-sm text-app-text transition-shadow focus:outline-none focus:ring-2 focus:ring-white/10 focus:border-app-muted"
          placeholder="Filtrer…"
          value=${filter}
          onInput=${(e) => setFilter(e.target.value)}
        />
      </div>
      <div class="max-h-80 overflow-y-auto overflow-x-auto text-sm">
        <table class="w-full">
          <thead class="text-xs uppercase tracking-wide text-app-muted sticky top-0 bg-app-surface">
            <tr>
              <th class="text-left py-1.5 pr-2">Symbole</th>
              <th class="text-left py-1.5 pr-2">Nom</th>
              <th class="text-left py-1.5 pr-2">Actif</th>
              <th></th>
            </tr>
          </thead>
          <tbody class="divide-y divide-app-border/60">
            ${visible.map(
              (t) => html`
                <tr class="hover:bg-app-bg/60 transition-colors">
                  <td class="py-1.5 pr-2 font-medium text-app-text whitespace-nowrap">${t.symbol}</td>
                  <td class="py-1.5 pr-2 text-app-muted max-w-[140px] sm:max-w-none truncate">${t.name}</td>
                  <td class="py-1.5 pr-2 text-app-muted">${t.is_active ? "Oui" : "Non"}</td>
                  <td class="py-1.5 text-right">
                    <button
                      class="text-xs underline text-app-muted hover:text-app-text active:scale-95 transition-all whitespace-nowrap"
                      onClick=${() => onToggle(t.symbol, !t.is_active)}
                    >
                      ${t.is_active ? "Désactiver" : "Activer"}
                    </button>
                  </td>
                </tr>
              `
            )}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function AdminApp() {
  const [session, setSession] = useState(null);
  const [checkingSession, setCheckingSession] = useState(true);
  const [stats, setStats] = useState({ activeTickers: "—", closeRows: "—", oldestDate: "—" });
  const [tickers, setTickers] = useState([]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setCheckingSession(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  async function loadStats() {
    const [tickersRes, closesRes, oldestRes] = await Promise.all([
      supabase.from("tickers").select("*", { count: "exact", head: true }).eq("is_active", true),
      supabase.from("daily_closes").select("*", { count: "exact", head: true }),
      supabase.from("daily_closes").select("date").order("date", { ascending: true }).limit(1),
    ]);
    setStats({
      activeTickers: tickersRes.count ?? "—",
      closeRows: closesRes.count ?? "—",
      oldestDate: oldestRes.data?.[0]?.date ?? "—",
    });
  }

  async function loadTickers() {
    const { data } = await supabase.from("tickers").select("symbol, name, is_active").order("symbol");
    setTickers(data || []);
  }

  useEffect(() => {
    if (session) {
      loadStats();
      loadTickers();
    }
  }, [session]);

  async function toggleTicker(symbol, isActive) {
    await supabase.from("tickers").update({ is_active: isActive }).eq("symbol", symbol);
    loadTickers();
    loadStats();
  }

  async function logout() {
    await supabase.auth.signOut();
  }

  if (checkingSession) {
    return html`<div class="flex items-center justify-center h-screen">
      <${SpinnerIcon} className="w-6 h-6 text-app-muted" />
    </div>`;
  }

  if (!session) {
    return html`<${LoginForm} onLoggedIn=${setSession} />`;
  }

  return html`
    <div class="max-w-3xl mx-auto p-4">
      <header class="flex flex-wrap items-center justify-between gap-2 mb-6 animate-fade-in-up">
        <div class="flex items-center gap-2.5">
          <img src="./logo.png" alt="" class="w-6 h-6 invert" />
          <h1 class="text-xl font-bold text-app-text">Administration</h1>
        </div>
        <div class="flex items-center gap-3 text-sm">
          <a href="./index.html" class="underline text-app-muted hover:text-app-text transition-colors">← Dashboard</a>
          <button class="text-app-muted hover:text-app-text active:scale-95 transition-all" onClick=${logout}>
            Déconnexion
          </button>
        </div>
      </header>
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
        <${StatCard} label="Tickers actifs" value=${stats.activeTickers} delay=${0} />
        <${StatCard} label="Lignes de clôtures" value=${stats.closeRows} delay=${40} />
        <${StatCard} label="Historique depuis" value=${stats.oldestDate} delay=${80} />
      </div>
      <p class="text-xs text-app-muted mb-6">
        L'historique quotidien reste léger indéfiniment (~500 lignes/jour) — aucune purge n'est
        nécessaire ici, contrairement à l'ancien relevé intraday.
      </p>
      <${TickersPanel} tickers=${tickers} onToggle=${toggleTicker} />
    </div>
  `;
}

render(html`<${AdminApp} />`, document.getElementById("app"));
