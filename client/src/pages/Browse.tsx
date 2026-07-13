import { useEffect, useState } from "react";
import type { CardSummary } from "@mtg/shared";
import { api } from "@/api/client";
import { CardTile } from "@/components/CardTile";
import { CardDetailModal } from "@/components/CardDetailModal";
import { CardFilterBar } from "@/components/CardFilterBar";
import { useCardSearch } from "@/hooks/useCardSearch";

function ImportBanner() {
  const [meta, setMeta] = useState<{ cardCount: number } | null>(null);
  useEffect(() => {
    api.get<{ cardCount: number }>("/api/cards/import-status").then(setMeta).catch(() => setMeta({ cardCount: 0 }));
  }, []);
  if (!meta || meta.cardCount > 0) return null;
  return (
    <div className="mx-auto mb-4 max-w-2xl rounded-lg border border-amber-700/50 bg-amber-900/30 p-4 text-sm text-amber-100">
      <b>No cards imported yet.</b> On the server run <code className="rounded bg-black/40 px-1">docker compose run --rm app npm run import:cards</code>.
    </div>
  );
}

export function Browse() {
  const { q, setQ, opts, setOpts, resp, loading, page, goPage } = useCardSearch("");
  const [detailId, setDetailId] = useState<string | null>(null);
  const totalPages = resp ? Math.max(1, Math.ceil(resp.total / resp.pageSize)) : 1;
  const toTop = () => window.scrollTo({ top: 0, behavior: "smooth" });

  return (
    <div className="mx-auto max-w-7xl p-4">
      <ImportBanner />
      <div className="panel mb-4 p-3">
        <CardFilterBar
          onQuery={setQ}
          opts={opts}
          setOpts={setOpts}
          interpreted={q ? resp?.interpreted : undefined}
          queryError={resp?.error}
          autoFocus
        />
        <label className="mt-2 flex items-center gap-1.5 text-xs text-table-muted" title="Split results into cards that ARE the search term vs cards that only mention it in their text.">
          <input type="checkbox" checked={opts.group} onChange={(e) => setOpts({ ...opts, group: e.target.checked })} />
          Group by relevance (ARE vs mentions)
        </label>
      </div>

      {loading && <div className="py-8 text-center text-table-muted">Searching…</div>}

      {resp?.groups.map((group) => (
        <section key={group.key} className="mb-6">
          <h2 className="mb-2 flex items-baseline gap-2 font-display text-lg text-table-accentSoft">
            {group.label} <span className="text-sm text-table-muted">({group.total.toLocaleString()})</span>
          </h2>
          {group.cards.length === 0 ? (
            <div className="text-sm text-table-muted">No matches.</div>
          ) : (
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8">
              {group.cards.map((c: CardSummary) => (
                <CardTile key={c.id} card={c} onClick={() => setDetailId(c.id)} />
              ))}
            </div>
          )}
        </section>
      ))}

      {resp && resp.groups.every((g) => g.cards.length === 0) && !loading && (
        <div className="py-10 text-center text-table-muted">No cards found. Try adjusting filters or the search.</div>
      )}

      {resp && resp.total > 0 && totalPages > 1 && (
        <div className="mt-6 flex items-center justify-center gap-4">
          <button className="btn-ghost" disabled={page <= 1 || loading} onClick={() => { goPage(page - 1); toTop(); }}>
            ← Prev
          </button>
          <span className="text-sm text-table-muted">
            Page {page} / {totalPages} · {resp.total.toLocaleString()} cards
          </span>
          <button className="btn-ghost" disabled={page >= totalPages || loading} onClick={() => { goPage(page + 1); toTop(); }}>
            Next →
          </button>
        </div>
      )}

      {detailId && <CardDetailModal cardId={detailId} onClose={() => setDetailId(null)} />}
    </div>
  );
}
