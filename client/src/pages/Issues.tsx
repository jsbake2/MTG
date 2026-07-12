import { useEffect, useState } from "react";
import { api } from "@/api/client";

interface Issue {
  id: number;
  card_id: string | null;
  oracle_id: string | null;
  card_name: string;
  table_id: string | null;
  description: string;
  status: "open" | "reviewing" | "resolved" | "wontfix";
  resolution: string | null;
  reporter_name: string | null;
  image: string | null;
  created_at: string;
}

const STATUSES: Issue["status"][] = ["open", "reviewing", "resolved", "wontfix"];
const STATUS_COLOR: Record<Issue["status"], string> = {
  open: "bg-amber-500/20 text-amber-300 border-amber-500/40",
  reviewing: "bg-sky-500/20 text-sky-300 border-sky-500/40",
  resolved: "bg-emerald-500/20 text-emerald-300 border-emerald-500/40",
  wontfix: "bg-table-panel2 text-table-muted border-table-border",
};

export function Issues() {
  const [issues, setIssues] = useState<Issue[]>([]);
  const [filter, setFilter] = useState<"all" | Issue["status"]>("open");
  const [notes, setNotes] = useState<Record<number, string>>({});
  const [loaded, setLoaded] = useState(false);

  function load() {
    const q = filter === "all" ? "" : `?status=${filter}`;
    api.get<{ issues: Issue[] }>(`/api/issues${q}`).then((r) => { setIssues(r.issues); setLoaded(true); });
  }
  useEffect(load, [filter]);

  async function update(id: number, patch: { status?: Issue["status"]; resolution?: string }) {
    await api.post(`/api/issues/${id}`, patch);
    load();
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-5">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="font-display text-xl text-table-accentSoft">Reported card issues</h1>
        <div className="flex gap-1">
          {(["open", "reviewing", "resolved", "wontfix", "all"] as const).map((f) => (
            <button
              key={f}
              className={`chip ${filter === f ? "border-table-accent text-table-accentSoft" : ""}`}
              onClick={() => setFilter(f)}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {loaded && issues.length === 0 && (
        <div className="panel p-8 text-center text-table-muted">No {filter === "all" ? "" : filter} issues. 🎉</div>
      )}

      <div className="space-y-3">
        {issues.map((it) => (
          <div key={it.id} className="panel flex gap-3 p-3">
            {it.image ? (
              <img src={it.image} alt={it.card_name} className="h-44 shrink-0 rounded-lg border border-table-border" />
            ) : (
              <div className="flex h-44 w-32 shrink-0 items-center justify-center rounded-lg border border-dashed border-table-border text-xs text-table-muted">no image</div>
            )}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h2 className="font-display text-lg text-table-ink">{it.card_name}</h2>
                <span className={`rounded border px-2 py-0.5 text-[11px] font-semibold ${STATUS_COLOR[it.status]}`}>{it.status}</span>
              </div>
              <div className="text-xs text-table-muted">
                #{it.id} · reported by {it.reporter_name ?? "?"} · {new Date(it.created_at).toLocaleString()}
                {it.table_id ? ` · game ${it.table_id.slice(0, 8)}` : ""}
              </div>
              <p className="mt-2 whitespace-pre-wrap text-sm text-table-ink">{it.description}</p>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                {STATUSES.map((s) => (
                  <button
                    key={s}
                    className={`chip text-xs ${it.status === s ? "border-table-accent text-table-accentSoft" : ""}`}
                    onClick={() => update(it.id, { status: s })}
                  >
                    {s}
                  </button>
                ))}
              </div>
              <div className="mt-2 flex gap-2">
                <textarea
                  className="input min-h-[40px] flex-1 text-sm"
                  placeholder="Resolution notes…"
                  defaultValue={it.resolution ?? ""}
                  onChange={(e) => setNotes((n) => ({ ...n, [it.id]: e.target.value }))}
                />
                <button className="btn-ghost self-start" onClick={() => update(it.id, { resolution: notes[it.id] ?? it.resolution ?? "" })}>
                  Save note
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
