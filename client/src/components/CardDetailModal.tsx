import { useEffect, useState } from "react";
import type { CardDetailResponse } from "@mtg/shared";
import { api } from "@/api/client";
import { CardImage } from "@/components/CardTile";
import { ManaCost } from "@/components/ManaCost";

const LEGAL_FORMATS = ["standard", "pioneer", "modern", "pauper", "legacy", "vintage", "commander"];

export function CardDetailModal({
  cardId,
  onClose,
  onAdd,
}: {
  cardId: string;
  onClose: () => void;
  onAdd?: (cardId: string) => void;
}) {
  const [data, setData] = useState<CardDetailResponse | null>(null);
  const [face, setFace] = useState(0);
  const [activeId, setActiveId] = useState(cardId);

  useEffect(() => {
    setData(null);
    api.get<CardDetailResponse>(`/api/cards/${activeId}`).then(setData).catch(() => setData(null));
  }, [activeId]);

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div className="panel flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden md:flex-row" onClick={(e) => e.stopPropagation()}>
        <div className="flex shrink-0 items-start justify-center bg-table-bg p-4 md:w-72">
          {data ? <CardImage id={data.card.id} name={data.card.name} face={face} className="max-w-[240px]" /> : <div className="card-aspect w-56 animate-pulse rounded-lg bg-table-panel2" />}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {data ? (
            <>
              <div className="flex items-start justify-between gap-2">
                <h2 className="font-display text-xl text-table-accentSoft">{data.card.name}</h2>
                <ManaCost cost={data.card.manaCost} />
              </div>
              <div className="mt-1 text-sm text-table-muted">{data.card.typeLine}</div>
              {data.card.faces.length > 1 && (
                <div className="mt-2 flex gap-1">
                  {data.card.faces.map((f, i) => (
                    <button key={i} className={`chip ${face === i ? "border-table-accent text-table-accentSoft" : ""}`} onClick={() => setFace(i)}>
                      {f.name}
                    </button>
                  ))}
                </div>
              )}
              {data.card.oracleText && <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed">{data.card.oracleText}</p>}
              {data.card.flavorText && <p className="mt-3 whitespace-pre-wrap border-l-2 border-table-border pl-3 text-sm italic text-table-muted">{data.card.flavorText}</p>}
              {(data.card.power || data.card.loyalty) && (
                <div className="mt-3 text-sm">
                  {data.card.power !== null && <span className="chip mr-2">{data.card.power}/{data.card.toughness}</span>}
                  {data.card.loyalty !== null && <span className="chip">Loyalty {data.card.loyalty}</span>}
                </div>
              )}
              <div className="mt-4">
                <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-table-muted">Legality</div>
                <div className="flex flex-wrap gap-1.5">
                  {LEGAL_FORMATS.map((f) => {
                    const l = data.card.legalities[f] ?? "not_legal";
                    const cls =
                      l === "legal" ? "bg-green-900/50 text-green-200" : l === "banned" ? "bg-red-900/50 text-red-200" : l === "restricted" ? "bg-amber-900/50 text-amber-200" : "bg-table-panel2 text-table-muted";
                    return (
                      <span key={f} className={`rounded px-2 py-0.5 text-xs capitalize ${cls}`}>
                        {f}: {l.replace("_", " ")}
                      </span>
                    );
                  })}
                </div>
              </div>
              {data.decks && data.decks.length > 0 && (
                <div className="mt-4">
                  <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-table-muted">Associated Decks</div>
                  <div className="flex flex-wrap gap-1">
                    {data.decks.map((dk) => (
                      <span
                        key={dk.id}
                        className={`rounded px-2 py-0.5 text-xs font-semibold ${dk.isPrecon ? "bg-indigo-950/40 text-indigo-300 border border-indigo-500/20" : "bg-table-panel2/60 text-table-accentSoft border border-table-border/60"}`}
                        title={`${dk.name} (${dk.board === "commander" ? "commander" : dk.board === "sideboard" ? "sideboard" : "mainboard"})`}
                      >
                        {dk.name} ({dk.quantity}x {dk.board !== "main" ? dk.board : ""})
                      </span>
                    ))}
                  </div>
                </div>
              )}
              <div className="mt-4 text-xs text-table-muted">
                {data.card.setName} ({data.card.setCode.toUpperCase()}) · #{data.card.collectorNumber} · {data.card.rarity} · {data.card.year}
                {data.card.artist ? ` · illus. ${data.card.artist}` : ""}
              </div>
              {data.printings.length > 1 && (
                <div className="mt-4">
                  <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-table-muted">Other printings</div>
                  <div className="flex flex-wrap gap-1.5">
                    {data.printings.map((p) => (
                      <button key={p.id} className={`chip ${p.id === activeId ? "border-table-accent" : ""}`} onClick={() => setActiveId(p.id)}>
                        {p.setCode.toUpperCase()} {p.year || ""}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <div className="mt-5 flex gap-2">
                {onAdd && (
                  <button className="btn-primary" onClick={() => onAdd(activeId)}>
                    + Add to deck
                  </button>
                )}
                <button className="btn-ghost" onClick={onClose}>
                  Close
                </button>
              </div>
            </>
          ) : (
            <div className="text-table-muted">Loading…</div>
          )}
        </div>
      </div>
    </div>
  );
}
