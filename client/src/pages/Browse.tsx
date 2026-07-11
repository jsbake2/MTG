import { useEffect, useState } from "react";
import type { CardSummary } from "@mtg/shared";
import { api } from "@/api/client";
import { CardTile } from "@/components/CardTile";
import { CardDetailModal } from "@/components/CardDetailModal";
import { useCardSearch } from "@/hooks/useCardSearch";

const EXAMPLES = [
  "vampire",
  "t:instant o:vampire",
  "t:creature c:g pow>=5",
  "f:commander t:dragon",
  "o:\"draw a card\" c:u",
  "is:banned f:modern",
  "year>=2023 r:mythic",
];

function ImportBanner() {
  const [meta, setMeta] = useState<{ cardCount: number } | null>(null);
  useEffect(() => {
    api.get<{ cardCount: number }>("/api/cards/import-status").then(setMeta).catch(() => setMeta({ cardCount: 0 }));
  }, []);
  if (!meta || meta.cardCount > 0) return null;
  return (
    <div className="mx-auto mb-4 max-w-2xl rounded-lg border border-amber-700/50 bg-amber-900/30 p-4 text-sm text-amber-100">
      <b>No cards imported yet.</b> On the server run <code className="rounded bg-black/40 px-1">npm run import:cards</code> (or{" "}
      <code className="rounded bg-black/40 px-1">docker compose run --rm app npm run import:cards</code>) to download the full catalog from Scryfall.
    </div>
  );
}

export function Browse() {
  const { q, setQ, opts, setOpts, resp, loading } = useCardSearch("");
  const [detailId, setDetailId] = useState<string | null>(null);

  return (
    <div className="mx-auto max-w-7xl p-4">
      <ImportBanner />
      <div className="panel mb-4 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <input
            className="input min-w-0 flex-1"
            placeholder='Search cards — try "vampire", t:instant, c:g pow>=5, f:commander…'
            value={q}
            onChange={(e) => setQ(e.target.value)}
            autoFocus
          />
          <select className="input" value={opts.sort} onChange={(e) => setOpts({ ...opts, sort: e.target.value })}>
            <option value="name">Name</option>
            <option value="cmc">Mana value</option>
            <option value="released">Newest</option>
            <option value="rarity">Rarity</option>
            <option value="color">Color</option>
          </select>
          <label className="chip cursor-pointer">
            <input type="checkbox" checked={opts.group} onChange={(e) => setOpts({ ...opts, group: e.target.checked })} />
            Group ARE / references
          </label>
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {EXAMPLES.map((ex) => (
            <button key={ex} className="chip hover:border-table-accent" onClick={() => setQ(ex)}>
              {ex}
            </button>
          ))}
        </div>
        {resp?.interpreted && resp.interpreted.length > 0 && (
          <div className="mt-2 text-xs text-table-muted">Understood: {resp.interpreted.join(" · ")}</div>
        )}
        {resp?.error && <div className="mt-2 text-xs text-red-300">Query error: {resp.error}</div>}
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
        <div className="py-10 text-center text-table-muted">No cards found. Try a simpler search.</div>
      )}

      {detailId && <CardDetailModal cardId={detailId} onClose={() => setDetailId(null)} />}
    </div>
  );
}
