import { useEffect, useState } from "react";
import type { CardDetailResponse, CardRulesInfo } from "@mtg/shared";
import { api } from "@/api/client";
import { CardImage } from "@/components/CardTile";
import { ManaCost } from "@/components/ManaCost";
import { useReportIssue } from "@/store/reportIssue";

const LEGAL_FORMATS = ["standard", "pioneer", "modern", "pauper", "legacy", "vintage", "commander"];

const RULE_STATUS: Record<string, { label: string; cls: string; blurb: string }> = {
  covered: { label: "Covered", cls: "bg-green-900/50 text-green-200 border-green-500/30", blurb: "The engine fully models this card." },
  partial: { label: "Partial", cls: "bg-amber-900/50 text-amber-200 border-amber-500/30", blurb: "Some of this card's text is modeled; the rest is handled manually." },
  blocked: { label: "Manual", cls: "bg-red-900/40 text-red-200 border-red-500/30", blurb: "Not modeled yet — play this card's effects manually." },
  vanilla: { label: "Vanilla", cls: "bg-table-panel2 text-table-muted border-table-border", blurb: "No rules text to model." },
};

// The engine's tags + optional compiled effect code for a card.
function RulesPanel({ rules }: { rules: CardRulesInfo }) {
  const [showCode, setShowCode] = useState(false);
  const st = RULE_STATUS[rules.status] ?? { label: rules.status, cls: "bg-table-panel2 text-table-muted border-table-border", blurb: "" };
  // Each compiled bucket that actually has content, for the raw-code view.
  const codeBuckets: Array<[string, unknown[]]> = [
    ["ops", rules.ops],
    ["etb", rules.etb],
    ["triggers", rules.triggers],
    ["abilities", rules.abilities],
    ...(rules.modes && rules.modes.length ? ([["modes", rules.modes]] as Array<[string, unknown[]]>) : []),
  ];
  const hasCode = codeBuckets.some(([, v]) => Array.isArray(v) && v.length > 0);

  return (
    <div className="mt-4 rounded-lg border border-table-border/60 bg-table-bg/40 p-3">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-xs font-semibold uppercase tracking-wide text-table-muted">Engine rules &amp; tags</div>
        <span className={`rounded border px-2 py-0.5 text-[11px] font-semibold ${st.cls}`} title={st.blurb}>
          {st.label}
        </span>
      </div>

      {rules.tags.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {rules.tags.map((t) => (
            <span key={t} className="rounded bg-table-accent/15 px-2 py-0.5 text-xs font-medium text-table-accentSoft ring-1 ring-table-accent/25">
              {t}
            </span>
          ))}
        </div>
      ) : (
        <div className="text-xs text-table-muted">No behavior tags — {st.blurb || "handled manually."}</div>
      )}

      {rules.unmodeled.length > 0 && (
        <div className="mt-3">
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-amber-300/80">Handled manually</div>
          <ul className="list-disc space-y-0.5 pl-4 text-xs text-table-muted">
            {rules.unmodeled.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-3">
        <button className="chip text-xs hover:border-table-accent" onClick={() => setShowCode((v) => !v)}>
          {showCode ? "▾ Hide engine code" : "▸ Show engine code"}
        </button>
        {showCode && (
          <div className="mt-2 space-y-2">
            {!hasCode && (
              <div className="text-xs text-table-muted">
                No compiled effect code for this card — it's <b>{st.label.toLowerCase()}</b>
                {rules.unmodeled.length > 0 ? " and handled manually (see above)." : "."}
              </div>
            )}
            {codeBuckets
              .filter(([, v]) => Array.isArray(v) && v.length > 0)
              .map(([name, v]) => (
                <div key={name}>
                  <div className="mb-0.5 text-[11px] font-semibold uppercase tracking-wide text-table-muted">{name}</div>
                  <pre className="overflow-x-auto rounded bg-black/50 p-2 text-[11px] leading-snug text-emerald-200/90">
                    {JSON.stringify(v, null, 2)}
                  </pre>
                </div>
              ))}
            {/* Full raw record so there's always something to inspect. */}
            <div>
              <div className="mb-0.5 text-[11px] font-semibold uppercase tracking-wide text-table-muted">raw</div>
              <pre className="overflow-x-auto rounded bg-black/50 p-2 text-[11px] leading-snug text-sky-200/90">
                {JSON.stringify(
                  { status: rules.status, tags: rules.tags, ops: rules.ops, etb: rules.etb, triggers: rules.triggers, abilities: rules.abilities, modes: rules.modes, unmodeled: rules.unmodeled },
                  null,
                  2,
                )}
              </pre>
            </div>
            <div className="text-[10px] text-table-muted">
              source: {rules.source} · v{rules.version}
              {rules.coverage ? ` · ${rules.coverage}` : ""}
              {rules.testsPassing ? " · tests ✓" : ""}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

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
              {data.rules && <RulesPanel rules={data.rules} />}
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
                <button
                  className="btn-ghost"
                  title="Report a rules issue with this card"
                  onClick={() => useReportIssue.getState().openReport({ cardId: data.card.id, oracleId: data.card.oracleId, cardName: data.card.name })}
                >
                  🐞 Report issue
                </button>
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
