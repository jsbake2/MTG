import { useEffect, useState } from "react";
import { api } from "@/api/client";
import { useAuth } from "@/store/auth";

// Cards people want available in Forge — a mix of explicit user requests and
// cards auto-flagged when a deck export hit something Forge can't script yet.
interface ForgeRequest {
  name: string;
  hits: number;
  status: "open" | "scripted" | "wontfix";
  note: string | null;
  requested_by: string | null;
  first_seen: string;
  last_seen: string;
  forge_version: string | null;
}

const STATUS_COLOR: Record<ForgeRequest["status"], string> = {
  open: "bg-amber-500/20 text-amber-300 border-amber-500/40",
  scripted: "bg-emerald-500/20 text-emerald-300 border-emerald-500/40",
  wontfix: "bg-table-panel2 text-table-muted border-table-border",
};

export function ForgeRequests() {
  const { user } = useAuth();
  const isAdmin = user?.isAdmin ?? false;
  const [requests, setRequests] = useState<ForgeRequest[]>([]);
  const [filter, setFilter] = useState<"all" | ForgeRequest["status"]>("open");
  const [loaded, setLoaded] = useState(false);
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function load() {
    const q = filter === "all" ? "" : `?status=${filter}`;
    api.get<{ requests: ForgeRequest[] }>(`/api/forge/requests${q}`).then((r) => { setRequests(r.requests); setLoaded(true); });
  }
  useEffect(load, [filter]);

  async function submit() {
    if (!name.trim()) return;
    setBusy(true); setMsg(null);
    try {
      await api.post("/api/forge/requests", { name: name.trim(), note: note.trim() || undefined });
      setName(""); setNote(""); setMsg("Request added — thanks! We'll get it scripted for Forge.");
      setFilter("open"); load();
    } catch (e) { setMsg((e as { message?: string }).message ?? "Could not submit."); }
    finally { setBusy(false); }
  }

  async function setStatus(n: string, status: ForgeRequest["status"]) {
    await api.post(`/api/forge/requests/${encodeURIComponent(n)}/status`, { status });
    load();
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-5">
      <div className="mb-1 flex items-center justify-between">
        <h1 className="font-display text-xl text-table-accentSoft">Forge card requests</h1>
        <div className="flex gap-1">
          {(["open", "scripted", "wontfix", "all"] as const).map((f) => (
            <button key={f} className={`chip ${filter === f ? "border-table-accent text-table-accentSoft" : ""}`} onClick={() => setFilter(f)}>{f}</button>
          ))}
        </div>
      </div>
      <p className="mb-4 text-sm text-table-muted">Want a card that isn't in Forge yet? Ask for it here. Cards a deck export couldn't match also show up automatically.</p>

      {/* request form */}
      <div className="mb-5 rounded-lg border border-table-border bg-table-panel p-3">
        <div className="flex flex-col gap-2 sm:flex-row">
          <input className="input flex-1" placeholder="Card name (exactly, e.g. “Rhystic Study”)" value={name}
            onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} />
          <input className="input flex-1" placeholder="Note (optional) — why / which printing" value={note} onChange={(e) => setNote(e.target.value)} />
          <button className="btn-primary" onClick={submit} disabled={busy || !name.trim()}>Request</button>
        </div>
        {msg && <div className="mt-2 text-xs text-emerald-300">{msg}</div>}
      </div>

      {loaded && requests.length === 0 && <div className="text-sm text-table-muted">No {filter === "all" ? "" : filter} requests.</div>}

      <div className="space-y-2">
        {requests.map((r) => (
          <div key={r.name} className="flex items-center gap-3 rounded-lg border border-table-border bg-table-panel p-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-table-ink">{r.name}</span>
                <span className={`rounded border px-1.5 py-0.5 text-[11px] ${STATUS_COLOR[r.status]}`}>{r.status}</span>
                {r.hits > 1 && <span className="text-[11px] text-table-muted">×{r.hits}</span>}
              </div>
              {r.note && <div className="text-xs text-table-muted">{r.note}</div>}
              <div className="text-[11px] text-table-muted">{r.requested_by ? `requested by ${r.requested_by}` : "auto-detected from a deck export"}</div>
            </div>
            {isAdmin && (
              <div className="flex shrink-0 gap-1">
                {(["open", "scripted", "wontfix"] as const).filter((s) => s !== r.status).map((s) => (
                  <button key={s} className="chip text-[11px]" onClick={() => setStatus(r.name, s)}>{s}</button>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
