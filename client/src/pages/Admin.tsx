import { useEffect, useState } from "react";
import type { User } from "@mtg/shared";
import { api } from "@/api/client";

export function Admin() {
  const [users, setUsers] = useState<User[]>([]);
  const [form, setForm] = useState({ username: "", displayName: "", password: "", isAdmin: false });
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function load() {
    const r = await api.get<{ users: User[] }>("/api/auth/users");
    setUsers(r.users);
  }
  useEffect(() => {
    load();
  }, []);

  async function create() {
    setError(null);
    setMsg(null);
    try {
      await api.post("/api/auth/users", form);
      setMsg(`Created ${form.username}. Give them the username + password to sign in.`);
      setForm({ username: "", displayName: "", password: "", isAdmin: false });
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }

  return (
    <div className="mx-auto max-w-3xl p-4">
      <h1 className="mb-4 font-display text-2xl text-table-accentSoft">Admin</h1>
      <CatalogRefresh />
      <h2 className="mb-3 mt-6 font-display text-lg">Accounts</h2>
      <div className="panel mb-6 p-4">
        <h2 className="mb-3 font-display text-lg">Create an account for a kid</h2>
        <div className="grid gap-2 sm:grid-cols-2">
          <input className="input" placeholder="Username" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
          <input className="input" placeholder="Display name" value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} />
          <input className="input" placeholder="Password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          <label className="flex items-center gap-2 text-sm text-table-muted">
            <input type="checkbox" checked={form.isAdmin} onChange={(e) => setForm({ ...form, isAdmin: e.target.checked })} />
            Make admin
          </label>
        </div>
        {error && <div className="mt-2 text-sm text-red-300">{error}</div>}
        {msg && <div className="mt-2 text-sm text-green-300">{msg}</div>}
        <button className="btn-primary mt-3" onClick={create}>
          Create account
        </button>
      </div>

      <h2 className="mb-2 font-display text-lg">Users</h2>
      <div className="panel divide-y divide-table-border">
        {users.map((u) => (
          <div key={u.id} className="flex items-center gap-3 px-4 py-2 text-sm">
            <span className="font-semibold">{u.displayName}</span>
            <span className="text-table-muted">@{u.username}</span>
            {u.isAdmin && <span className="chip">admin</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

interface RefreshStatus {
  refresh: { running: boolean; lastCount: number; lastError: string | null; lastFinishedAt: number | null };
  catalog: { importedAt: string | null; cardCount: number };
}

function CatalogRefresh() {
  const [status, setStatus] = useState<RefreshStatus | null>(null);

  async function load() {
    try {
      setStatus(await api.get<RefreshStatus>("/api/admin/refresh-status"));
    } catch {
      /* ignore */
    }
  }
  useEffect(() => {
    load();
  }, []);
  useEffect(() => {
    if (!status?.refresh.running) return;
    const iv = setInterval(load, 3000);
    return () => clearInterval(iv);
  }, [status?.refresh.running]);

  async function refresh() {
    await api.post("/api/admin/refresh-cards", {});
    load();
  }

  return (
    <div className="panel p-4">
      <h2 className="mb-1 font-display text-lg">Card catalog</h2>
      <p className="text-sm text-table-muted">
        {status ? (
          <>
            {status.catalog.cardCount.toLocaleString()} cards
            {status.catalog.importedAt ? ` · updated ${new Date(status.catalog.importedAt).toLocaleString()}` : ""}
          </>
        ) : (
          "…"
        )}
      </p>
      <p className="mt-1 text-xs text-table-muted">
        When Wizards releases a new set, click refresh to pull the latest cards from Scryfall (runs in the background, a few minutes).
      </p>
      {status?.refresh.running ? (
        <div className="mt-3 text-sm text-amber-300">⟳ Refreshing from Scryfall…</div>
      ) : (
        <button className="btn-primary mt-3" onClick={refresh}>
          Refresh card catalog
        </button>
      )}
      {status?.refresh.lastError && <div className="mt-2 text-xs text-red-300">Last error: {status.refresh.lastError}</div>}
    </div>
  );
}
