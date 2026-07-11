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
      <h1 className="mb-4 font-display text-2xl text-table-accentSoft">Admin — Accounts</h1>
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
