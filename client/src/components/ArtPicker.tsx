import { useEffect, useState } from "react";
import type { CardDetailResponse, CardSummary } from "@mtg/shared";
import { api } from "@/api/client";
import { CardImage } from "@/components/CardTile";

// Pick which printing/art of a card to use (all printings are in the catalog).
export function ArtPicker({ cardId, onPick, onClose }: { cardId: string; onPick: (printing: CardSummary) => void; onClose: () => void }) {
  const [printings, setPrintings] = useState<CardSummary[]>([]);
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api
      .get<CardDetailResponse>(`/api/cards/${cardId}`)
      .then((r) => {
        setPrintings(r.printings);
        setName(r.card.name);
      })
      .finally(() => setLoading(false));
  }, [cardId]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div className="panel flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 border-b border-table-border p-3">
          <h3 className="font-display text-lg text-table-accentSoft">Choose art — {name}</h3>
          <span className="text-xs text-table-muted">{printings.length} printings</span>
          <button className="btn-ghost ml-auto" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {loading ? (
            <div className="p-6 text-center text-table-muted">Loading printings…</div>
          ) : (
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6">
              {printings.map((p) => (
                <button
                  key={p.id}
                  className={`block text-left transition hover:-translate-y-0.5 hover:brightness-110 ${p.id === cardId ? "rounded-lg ring-2 ring-table-accent" : ""}`}
                  onClick={() => onPick(p)}
                  title={`${p.setCode.toUpperCase()} ${p.year || ""}`}
                >
                  <CardImage id={p.id} name={p.name} />
                  <div className="mt-0.5 truncate text-[10px] text-table-muted">
                    {p.setCode.toUpperCase()} · {p.year || ""}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
