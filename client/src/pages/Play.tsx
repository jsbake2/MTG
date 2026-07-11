import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { CreateTableRequest, FormatDef, TableSummary } from "@mtg/shared";
import { api } from "@/api/client";
import { useAuth } from "@/store/auth";

export function Play() {
  const [tables, setTables] = useState<TableSummary[]>([]);
  const [formats, setFormats] = useState<FormatDef[]>([]);
  const [form, setForm] = useState<CreateTableRequest>({ name: "", formatId: "commander", maxPlayers: 4, enforcement: "relaxed" });
  const nav = useNavigate();
  const { user } = useAuth();

  async function load() {
    const [t, f] = await Promise.all([
      api.get<{ tables: TableSummary[] }>("/api/tables"),
      api.get<{ formats: FormatDef[] }>("/api/formats"),
    ]);
    setTables(t.tables);
    setFormats(f.formats);
  }
  useEffect(() => {
    load();
    const iv = setInterval(load, 4000);
    return () => clearInterval(iv);
  }, []);

  async function create() {
    const r = await api.post<{ table: TableSummary }>("/api/tables", {
      ...form,
      name: form.name || `${form.formatId} table`,
    });
    nav(`/table/${r.table.id}`);
  }

  async function removeTable(id: string) {
    if (!confirm("Are you sure you want to delete this table?")) return;
    await api.del(`/api/tables/${id}`);
    load();
  }

  return (
    <div className="mx-auto max-w-4xl p-4">
      <h1 className="mb-4 font-display text-2xl text-table-accentSoft">Play</h1>

      <div className="panel mb-6 p-4">
        <h2 className="mb-3 font-display text-lg">New table</h2>
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col text-xs text-table-muted">
            Name
            <input className="input mt-1" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Friday night game" />
          </label>
          <label className="flex flex-col text-xs text-table-muted">
            Format
            <select className="input mt-1" value={form.formatId} onChange={(e) => setForm({ ...form, formatId: e.target.value })}>
              {formats.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col text-xs text-table-muted">
            Players
            <select className="input mt-1" value={form.maxPlayers} onChange={(e) => setForm({ ...form, maxPlayers: Number(e.target.value) })}>
              {[1, 2, 3, 4].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col text-xs text-table-muted">
            Rules
            <select className="input mt-1" value={form.enforcement} onChange={(e) => setForm({ ...form, enforcement: e.target.value as "relaxed" | "strict" })}>
              <option value="relaxed">Relaxed (learning)</option>
              <option value="strict">Strict</option>
            </select>
          </label>
          <button className="btn-primary" onClick={create}>
            Create & sit down
          </button>
        </div>
        <p className="mt-2 text-xs text-table-muted">
          Relaxed mode nudges but lets you do anything (great for little ones). Strict mode enforces the framework rules — turns,
          timing, land drops, summoning sickness, combat.
        </p>
      </div>

      <h2 className="mb-2 font-display text-lg">Open tables</h2>
      {tables.length === 0 ? (
        <div className="panel p-6 text-center text-table-muted">No tables yet — create one above.</div>
      ) : (
        <div className="space-y-2">
          {tables.map((t) => (
            <div key={t.id} className="panel flex items-center gap-3 p-3">
              <div>
                <div className="font-semibold">{t.name}</div>
                <div className="text-xs text-table-muted">
                  {t.formatId} · {t.playerCount}/{t.maxPlayers} seated · {t.status}
                </div>
              </div>
              {user?.isAdmin && (
                <button className="btn-danger ml-auto" onClick={() => removeTable(t.id)}>
                  Delete
                </button>
              )}
              <button className={`${user?.isAdmin ? "" : "ml-auto"} btn-primary`} onClick={() => nav(`/table/${t.id}`)}>
                {t.status === "lobby" ? "Join" : "Open"}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
