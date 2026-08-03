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
    <form class="max-w-sm mx-auto mt-12 sm:mt-24 p-5 sm:p-6 border border-slate-200 rounded-lg bg-white" onSubmit=${submit}>
      <h1 class="text-lg font-semibold mb-4">Administration</h1>
      <label class="block text-sm text-slate-600 mb-1">Email</label>
      <input
        class="w-full border border-slate-300 rounded-md px-2 py-1.5 mb-3"
        type="email"
        value=${email}
        onInput=${(e) => setEmail(e.target.value)}
        required
      />
      <label class="block text-sm text-slate-600 mb-1">Mot de passe</label>
      <input
        class="w-full border border-slate-300 rounded-md px-2 py-1.5 mb-4"
        type="password"
        value=${password}
        onInput=${(e) => setPassword(e.target.value)}
        required
      />
      ${error && html`<div class="text-sm text-red-600 mb-3">${error}</div>`}
      <button class="w-full bg-slate-900 text-white rounded-md py-2 disabled:opacity-50" disabled=${busy}>
        ${busy ? "Connexion…" : "Se connecter"}
      </button>
    </form>
  `;
}

function StatCard({ label, value }) {
  return html`
    <div class="border border-slate-200 rounded-lg p-3 bg-white">
      <div class="text-xs text-slate-500">${label}</div>
      <div class="text-lg font-semibold text-slate-900">${value}</div>
    </div>
  `;
}

function PurgePanel({ onPurged }) {
  const [days, setDays] = useState(90);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);

  async function purge() {
    if (!confirm(`Supprimer les prix de plus de ${days} jours ? Action irréversible.`)) return;
    setBusy(true);
    setMessage(null);
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const { error } = await supabase.from("prices").delete().lt("ts", cutoff);
    setBusy(false);
    if (error) {
      setMessage(`Erreur : ${error.message}`);
      return;
    }
    setMessage("Purge effectuée.");
    onPurged();
  }

  return html`
    <div class="border border-slate-200 rounded-lg p-4 mb-6 bg-white">
      <h2 class="font-semibold mb-2">Purge manuelle de l'historique</h2>
      <p class="text-sm text-slate-500 mb-3">
        Une purge automatique (90 jours) tourne déjà à chaque ingestion. Utile pour purger plus
        agressivement si le quota Supabase approche.
      </p>
      <div class="flex flex-wrap items-center gap-2">
        <label class="text-sm text-slate-600">Conserver les</label>
        <input
          type="number"
          min="1"
          class="w-20 border border-slate-300 rounded-md px-2 py-1"
          value=${days}
          onInput=${(e) => setDays(Number(e.target.value))}
        />
        <label class="text-sm text-slate-600">derniers jours</label>
        <button
          class="w-full sm:w-auto sm:ml-auto px-3 py-1.5 rounded-md bg-red-600 text-white disabled:opacity-50"
          disabled=${busy}
          onClick=${purge}
        >
          ${busy ? "Purge…" : "Purger"}
        </button>
      </div>
      ${message && html`<div class="text-sm text-slate-500 mt-2">${message}</div>`}
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
    <div class="border border-slate-200 rounded-lg p-4 bg-white">
      <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-3">
        <h2 class="font-semibold">Tickers (${tickers.length})</h2>
        <input
          class="border border-slate-300 rounded-md px-2 py-1 text-sm"
          placeholder="Filtrer…"
          value=${filter}
          onInput=${(e) => setFilter(e.target.value)}
        />
      </div>
      <div class="max-h-80 overflow-y-auto overflow-x-auto text-sm">
        <table class="w-full">
          <thead class="text-xs uppercase text-slate-500 sticky top-0 bg-white">
            <tr>
              <th class="text-left py-1 pr-2">Symbole</th>
              <th class="text-left py-1 pr-2">Nom</th>
              <th class="text-left py-1 pr-2">Actif</th>
              <th></th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-100">
            ${visible.map(
              (t) => html`
                <tr>
                  <td class="py-1 pr-2 font-medium whitespace-nowrap">${t.symbol}</td>
                  <td class="py-1 pr-2 text-slate-600 max-w-[140px] sm:max-w-none truncate">${t.name}</td>
                  <td class="py-1 pr-2">${t.is_active ? "Oui" : "Non"}</td>
                  <td class="py-1 text-right">
                    <button
                      class="text-xs underline text-slate-500 hover:text-slate-800 whitespace-nowrap"
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
  const [stats, setStats] = useState({ activeTickers: "—", priceRows: "—", oldestTs: "—" });
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
    const [tickersRes, pricesRes, oldestRes] = await Promise.all([
      supabase.from("tickers").select("*", { count: "exact", head: true }).eq("is_active", true),
      supabase.from("prices").select("*", { count: "exact", head: true }),
      supabase.from("prices").select("ts").order("ts", { ascending: true }).limit(1),
    ]);
    setStats({
      activeTickers: tickersRes.count ?? "—",
      priceRows: pricesRes.count ?? "—",
      oldestTs: oldestRes.data?.[0]?.ts ? new Date(oldestRes.data[0].ts).toLocaleDateString("fr-FR") : "—",
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
    return html`<div class="p-6 text-sm text-slate-400">Chargement…</div>`;
  }

  if (!session) {
    return html`<${LoginForm} onLoggedIn=${setSession} />`;
  }

  return html`
    <div class="max-w-3xl mx-auto p-4">
      <header class="flex flex-wrap items-center justify-between gap-2 mb-6">
        <h1 class="text-xl font-semibold">Administration</h1>
        <div class="flex items-center gap-3 text-sm">
          <a href="./index.html" class="underline text-slate-500 hover:text-slate-800">← Dashboard</a>
          <button class="text-slate-500 hover:text-slate-800" onClick=${logout}>Déconnexion</button>
        </div>
      </header>
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
        <${StatCard} label="Tickers actifs" value=${stats.activeTickers} />
        <${StatCard} label="Lignes de prix" value=${stats.priceRows} />
        <${StatCard} label="Plus ancien point" value=${stats.oldestTs} />
      </div>
      <${PurgePanel} onPurged=${loadStats} />
      <${TickersPanel} tickers=${tickers} onToggle=${toggleTicker} />
    </div>
  `;
}

render(html`<${AdminApp} />`, document.getElementById("app"));
