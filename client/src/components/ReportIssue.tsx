import { useEffect, useRef, useState } from "react";
import type { CardSummary, SearchResponse } from "@mtg/shared";
import { api } from "@/api/client";
import { useReportIssue } from "@/store/reportIssue";

// Floating "report a card issue" button — available on every page, including the
// game table, so a player can flag a card whose rules misbehaved during play.
export function ReportIssueFab() {
  const openReport = useReportIssue((s) => s.openReport);
  return (
    <button
      className="fixed bottom-3 right-16 z-[9990] flex h-10 items-center gap-1.5 rounded-full border border-table-border bg-table-panel/90 px-3 text-sm shadow-lg backdrop-blur hover:bg-table-panel2"
      title="Report a card rules issue"
      onClick={() => openReport()}
    >
      🐞 <span className="hidden sm:inline">Report card</span>
    </button>
  );
}

export function ReportIssue() {
  const { open, prefill, close } = useReportIssue();
  const [name, setName] = useState("");
  const [picked, setPicked] = useState<{ cardId: string | null; oracleId: string | null } | null>(null);
  const [suggest, setSuggest] = useState<CardSummary[]>([]);
  const [desc, setDesc] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const searchSeq = useRef(0);

  useEffect(() => {
    if (!open) return;
    setName(prefill.cardName ?? "");
    setPicked(prefill.cardId || prefill.oracleId ? { cardId: prefill.cardId ?? null, oracleId: prefill.oracleId ?? null } : null);
    setSuggest([]);
    setDesc("");
    setDone(false);
  }, [open, prefill]);

  // Autocomplete card name (skip if it was prefilled from a known card).
  useEffect(() => {
    if (!open || picked || name.trim().length < 2) { setSuggest([]); return; }
    const seq = ++searchSeq.current;
    const t = setTimeout(() => {
      api.get<SearchResponse>(`/api/cards/search?q=${encodeURIComponent(name.trim())}`)
        .then((r) => { if (seq === searchSeq.current) setSuggest(r.groups.flatMap((g) => g.cards).slice(0, 6)); })
        .catch(() => {});
    }, 200);
    return () => clearTimeout(t);
  }, [name, open, picked]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  if (!open) return null;

  const tableId = window.location.pathname.startsWith("/table/") ? window.location.pathname.split("/table/")[1] : null;

  async function submit() {
    if (!name.trim() || !desc.trim()) return;
    setBusy(true);
    try {
      await api.post("/api/issues", {
        cardId: picked?.cardId ?? null,
        oracleId: picked?.oracleId ?? null,
        cardName: name.trim(),
        tableId,
        description: desc.trim(),
      });
      setDone(true);
      setTimeout(close, 1100);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[9997] flex items-center justify-center bg-black/70 p-4" onMouseDown={close}>
      <div className="panel w-full max-w-md p-4" onMouseDown={(e) => e.stopPropagation()}>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="font-display text-lg text-table-accentSoft">🐞 Report a card issue</h2>
          <button className="rounded px-2 py-1 text-table-muted hover:bg-table-panel2" onClick={close}>✕</button>
        </div>

        {done ? (
          <div className="py-8 text-center text-emerald-400">Thanks — logged for review ✓</div>
        ) : (
          <>
            <label className="mb-1 block text-xs text-table-muted">Card</label>
            <div className="relative">
              <input
                className="input w-full"
                placeholder="Card name…"
                value={name}
                onChange={(e) => { setName(e.target.value); setPicked(null); }}
              />
              {suggest.length > 0 && (
                <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-md border border-table-border bg-table-panel shadow-xl">
                  {suggest.map((c) => (
                    <button
                      key={c.id}
                      className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-sm hover:bg-table-panel2"
                      onClick={() => { setName(c.name); setPicked({ cardId: c.id, oracleId: c.oracleId }); setSuggest([]); }}
                    >
                      {c.imageUrl && <img src={c.imageUrl} alt="" className="h-8 w-8 rounded object-cover" />}
                      <span className="flex-1 truncate">{c.name}</span>
                      <span className="text-[10px] text-table-muted">{c.setCode?.toUpperCase()}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            {picked && <div className="mt-1 text-[11px] text-emerald-400">✓ matched a specific card</div>}

            <label className="mb-1 mt-3 block text-xs text-table-muted">What went wrong / what rule is needed?</label>
            <textarea
              className="input min-h-[110px] w-full text-sm"
              placeholder="e.g. This aura should have killed the creature but didn't; or the engine let it attack when it shouldn't…"
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              autoFocus
            />
            {tableId && <div className="mt-1 text-[11px] text-table-muted">Reporting from game table {tableId.slice(0, 8)}…</div>}

            <div className="mt-3 flex justify-end gap-2">
              <button className="btn-ghost" onClick={close}>Cancel</button>
              <button className="btn-primary" disabled={!name.trim() || !desc.trim() || busy} onClick={submit}>
                {busy ? "Sending…" : "Submit report"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
