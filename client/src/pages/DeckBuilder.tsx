import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type { CardSummary, DeckDetail, DeckTag, DeckValidation, FormatDef } from "@mtg/shared";
import { api } from "@/api/client";
import { CardImage } from "@/components/CardTile";
import { CardDetailModal } from "@/components/CardDetailModal";
import { ArtPicker } from "@/components/ArtPicker";
import { ManaCost } from "@/components/ManaCost";
import { CardFilterBar } from "@/components/CardFilterBar";
import { MANA_HEX } from "@/lib/mana";
import { useCardSearch } from "@/hooks/useCardSearch";

type Board = "main" | "sideboard" | "commander";
interface Entry {
  cardId: string;
  quantity: number;
  board: Board;
}

const TYPE_ORDER = ["Creature", "Planeswalker", "Instant", "Sorcery", "Artifact", "Enchantment", "Battle", "Land"];
function primaryType(cardTypes: string[]): string {
  for (const t of TYPE_ORDER) if (cardTypes.includes(t)) return t;
  return "Other";
}

export function DeckBuilder() {
  const { id } = useParams();
  const nav = useNavigate();
  const isNew = !id;

  const [formats, setFormats] = useState<FormatDef[]>([]);
  const [name, setName] = useState("New Deck");
  const [formatId, setFormatId] = useState("house");
  const [description, setDescription] = useState("");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [cache, setCache] = useState<Record<string, CardSummary>>({});
  const [validation, setValidation] = useState<DeckValidation | null>(null);
  const [dynamicTags, setDynamicTags] = useState<DeckTag[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [detailId, setDetailId] = useState<string | null>(null);
  const [preview, setPreview] = useState<CardSummary | null>(null);
  const [artPickerFor, setArtPickerFor] = useState<{ cardId: string; board: Board } | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [deckView, setDeckView] = useState<"list" | "visual">("list");
  const [saving, setSaving] = useState(false);
  const search = useCardSearch("");
  const valTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    api.get<{ formats: FormatDef[] }>("/api/formats").then((r) => setFormats(r.formats));
  }, []);

  // Load existing deck.
  useEffect(() => {
    if (!id) return;
    api.get<{ deck: DeckDetail; validation: DeckValidation; dynamicTags: DeckTag[] }>(`/api/decks/${id}`).then((r) => {
      setName(r.deck.name);
      setFormatId(r.deck.formatId);
      setDescription(r.deck.description);
      setTags(r.deck.tags ?? []);
      setDynamicTags(r.dynamicTags ?? []);
      setEntries(r.deck.cards.map((c) => ({ cardId: c.cardId, quantity: c.quantity, board: c.board })));
      const cc: Record<string, CardSummary> = {};
      for (const c of r.deck.cards) {
        cc[c.cardId] = {
          id: c.card.id,
          oracleId: c.card.oracleId,
          name: c.card.name,
          imageUrl: c.card.imageUrl,
          manaCost: c.card.manaCost,
          cmc: c.card.cmc,
          typeLine: c.card.typeLine,
          colors: c.card.colors,
          cardTypes: c.card.cardTypes,
          rarity: c.card.rarity,
          setCode: c.card.setCode,
          year: c.card.year,
        };
      }
      setCache(cc);
      setValidation(r.validation);
    });
  }, [id]);

  // Debounced live validation whenever the list or format changes.
  const runValidation = useCallback(
    (fmt: string, es: Entry[]) => {
      if (es.length === 0) {
        setValidation(null);
        return;
      }
      if (valTimer.current) clearTimeout(valTimer.current);
      valTimer.current = setTimeout(() => {
        api
          .post<{ validation: DeckValidation; dynamicTags: DeckTag[] }>("/api/decks/validate", { formatId: fmt, cards: es })
          .then((r) => {
            setValidation(r.validation);
            setDynamicTags(r.dynamicTags);
          })
          .catch(() => setValidation(null));
      }, 300);
    },
    [],
  );
  useEffect(() => {
    runValidation(formatId, entries);
  }, [formatId, entries, runValidation]);

  function addCard(card: CardSummary, board: Board = "main") {
    setCache((c) => ({ ...c, [card.id]: card }));
    setEntries((es) => {
      const idx = es.findIndex((e) => e.cardId === card.id && e.board === board);
      if (idx >= 0) {
        const copy = [...es];
        copy[idx] = { ...copy[idx]!, quantity: copy[idx]!.quantity + 1 };
        return copy;
      }
      return [...es, { cardId: card.id, quantity: 1, board }];
    });
  }
  function setQty(cardId: string, board: Board, q: number) {
    setEntries((es) => es.map((e) => (e.cardId === cardId && e.board === board ? { ...e, quantity: q } : e)).filter((e) => e.quantity > 0));
  }
  function moveBoard(cardId: string, from: Board, to: Board) {
    setEntries((es) => {
      const e = es.find((x) => x.cardId === cardId && x.board === from);
      if (!e) return es;
      const rest = es.filter((x) => !(x.cardId === cardId && x.board === from));
      const existing = rest.find((x) => x.cardId === cardId && x.board === to);
      if (existing) return rest.map((x) => (x === existing ? { ...x, quantity: x.quantity + e.quantity } : x));
      return [...rest, { ...e, board: to }];
    });
  }

  // Swap a deck entry to a different printing/art of the same card.
  function swapArt(oldCardId: string, board: Board, printing: CardSummary) {
    setCache((c) => ({ ...c, [printing.id]: printing }));
    setEntries((es) => {
      const idx = es.findIndex((e) => e.cardId === oldCardId && e.board === board);
      if (idx < 0) return es;
      const qty = es[idx]!.quantity;
      const rest = es.filter((_, i) => i !== idx);
      const existing = rest.find((e) => e.cardId === printing.id && e.board === board);
      if (existing) return rest.map((e) => (e === existing ? { ...e, quantity: e.quantity + qty } : e));
      return [...rest, { cardId: printing.id, quantity: qty, board }];
    });
    setArtPickerFor(null);
  }

  const format = formats.find((f) => f.id === formatId);
  const mainCount = entries.filter((e) => e.board === "main").reduce((n, e) => n + e.quantity, 0);
  const commanderCount = entries.filter((e) => e.board === "commander").reduce((n, e) => n + e.quantity, 0);

  const grouped = useMemo(() => {
    const g: Record<string, Entry[]> = {};
    for (const e of entries.filter((x) => x.board === "main")) {
      const c = cache[e.cardId];
      const t = c ? primaryType(c.cardTypes) : "Other";
      (g[t] ??= []).push(e);
    }
    return g;
  }, [entries, cache]);

  async function save() {
    setSaving(true);
    try {
      const payload = { name, formatId, description, tags, cards: entries };
      if (isNew) {
        const r = await api.post<{ id: string }>("/api/decks", payload);
        nav(`/decks/${r.id}`, { replace: true });
      } else {
        await api.put(`/api/decks/${id}`, payload);
      }
    } finally {
      setSaving(false);
    }
  }

  function exportText() {
    const lines: string[] = [];
    for (const board of ["commander", "main", "sideboard"] as Board[]) {
      const es = entries.filter((e) => e.board === board);
      if (es.length === 0) continue;
      if (board !== "main") lines.push(`// ${board}`);
      for (const e of es) lines.push(`${e.quantity} ${cache[e.cardId]?.name ?? e.cardId}`);
    }
    navigator.clipboard.writeText(lines.join("\n"));
    alert("Deck list copied to clipboard.");
  }

  return (
    <div className="flex h-full min-h-0 flex-col lg:flex-row">
      {/* Search panel */}
      <div className="flex min-h-0 flex-col border-b border-table-border lg:w-[42%] lg:border-b-0 lg:border-r">
        <div className="border-b border-table-border p-3">
          <CardFilterBar
            onQuery={search.setQ}
            opts={search.opts}
            setOpts={search.setOpts}
            interpreted={search.q ? search.resp?.interpreted : undefined}
            queryError={search.resp?.error}
            compact
          />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
          {search.loading && <div className="p-4 text-center text-sm text-table-muted">Searching…</div>}
          {search.resp?.groups.map((group) => (
            <div key={group.key} className="mb-3">
              <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-table-muted">
                {group.label} ({group.total})
              </div>
              <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4 lg:grid-cols-4">
                {group.cards.map((c) => (
                  <div key={c.id} className="group relative" onMouseEnter={() => setPreview(c)}>
                    <button onClick={() => addCard(c)} className="block w-full" title={`Add ${c.name}`}>
                      <CardImage id={c.id} name={c.name} />
                    </button>
                    <button
                      className="absolute right-1 top-1 hidden rounded bg-black/70 px-1.5 text-xs text-table-ink group-hover:block"
                      onClick={() => setDetailId(c.id)}
                    >
                      i
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Deck panel */}
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="border-b border-table-border p-3">
          <div className="flex flex-wrap items-center gap-2">
            <input className="input flex-1" value={name} onChange={(e) => setName(e.target.value)} placeholder="Deck name" />
            <select className="input" value={formatId} onChange={(e) => setFormatId(e.target.value)}>
              {formats.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
            <button className="btn-primary" onClick={save} disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </button>
            <button className="btn-ghost" onClick={() => setImportOpen(true)}>
              Import
            </button>
            <button className="btn-ghost" onClick={exportText}>
              Export
            </button>
          </div>
          <div className="mt-2 flex items-center gap-3 text-sm text-table-muted">
            <span
              title={
                format
                  ? `Enforced: ${format.minDeckSize}${format.maxDeckSize ? "–" + format.maxDeckSize : "+"} cards · max ${format.singleton ? 1 : format.maxCopiesPerCard} of any card (basics unlimited)${format.requiresCommander ? " · commander + color identity" : ""}${format.legalityKey ? " · " + format.name + " legality (banned/restricted)" : " · no restrictions"}. Rarity is NOT a deck rule.`
                  : ""
              }
            >
              {mainCount} cards
              {format?.requiresCommander ? ` · ${commanderCount} commander` : ""}
              {format ? ` · min ${format.minDeckSize} · max ${format.singleton ? 1 : format.maxCopiesPerCard}-of` : ""}
            </span>
            {validation ? (
              <span
                className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                  validation.valid ? "bg-green-900/50 text-green-200" : "bg-red-900/50 text-red-200"
                }`}
              >
                {validation.valid
                  ? `✓ Legal in ${format?.name ?? formatId}`
                  : `✕ Not legal · ${validation.issues.filter((i) => i.severity === "error").length} problem(s)`}
              </span>
            ) : (
              <span className="text-table-muted">Empty deck</span>
            )}
            <div className="ml-auto flex gap-1">
              <button className={`chip ${deckView === "list" ? "border-table-accent text-table-accentSoft" : ""}`} onClick={() => setDeckView("list")}>
                ☰ List
              </button>
              <button className={`chip ${deckView === "visual" ? "border-table-accent text-table-accentSoft" : ""}`} onClick={() => setDeckView("visual")}>
                ▦ Visual
              </button>
            </div>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          <div className="grid gap-4 md:grid-cols-[1fr_240px]">
            <div>
              {format?.requiresCommander && (
                <BoardSection
                  title="Commander"
                  entries={entries.filter((e) => e.board === "commander")}
                  cache={cache}
                  onQty={(cid, q) => setQty(cid, "commander", q)}
                  onInfo={setDetailId}
                  onMove={(cid) => moveBoard(cid, "commander", "main")}
                  onArt={(cid) => setArtPickerFor({ cardId: cid, board: "commander" })}
                  moveLabel="→ main"
                />
              )}
              {Object.keys(grouped).length === 0 && entries.length === 0 && (
                <div className="panel p-6 text-center text-sm text-table-muted">
                  Search on the left and click a card to add it. Set the commander by moving a legendary creature to the Commander row.
                </div>
              )}
              {deckView === "list"
                ? TYPE_ORDER.filter((t) => grouped[t]?.length).map((t) => (
                    <BoardSection
                      key={t}
                      title={`${t} (${grouped[t]!.reduce((n, e) => n + e.quantity, 0)})`}
                      entries={grouped[t]!}
                      cache={cache}
                      onQty={(cid, q) => setQty(cid, "main", q)}
                      onInfo={setDetailId}
                      onMove={format?.requiresCommander ? (cid) => moveBoard(cid, "main", "commander") : undefined}
                      onArt={(cid) => setArtPickerFor({ cardId: cid, board: "main" })}
                      moveLabel="set commander"
                    />
                  ))
                : TYPE_ORDER.filter((t) => grouped[t]?.length).map((t) => (
                    <VisualSection
                      key={t}
                      title={`${t} (${grouped[t]!.reduce((n, e) => n + e.quantity, 0)})`}
                      entries={grouped[t]!}
                      cache={cache}
                      onQty={(cid, q) => setQty(cid, "main", q)}
                      onInfo={setDetailId}
                      onHover={setPreview}
                      onArt={(cid) => setArtPickerFor({ cardId: cid, board: "main" })}
                    />
                  ))}
            </div>

            <div className="space-y-3">
              {/* Card preview (MTG-Arena style) */}
              <div className="panel overflow-hidden p-2">
                {preview ? (
                  <>
                    <CardImage id={preview.id} name={preview.name} />
                    <div className="mt-1 flex items-center justify-between gap-1 px-0.5">
                      <span className="truncate text-xs font-semibold">{preview.name}</span>
                      <ManaCost cost={preview.manaCost} size={13} />
                    </div>
                  </>
                ) : (
                  <div className="card-aspect flex items-center justify-center rounded text-center text-xs text-table-muted">
                    Hover a card to preview it
                  </div>
                )}
              </div>

              <TagBar tags={tags} setTags={setTags} tagInput={tagInput} setTagInput={setTagInput} dynamicTags={dynamicTags} />

              <StatsPanel validation={validation} />
              {validation && validation.issues.length > 0 && (
                <div className="panel p-3">
                  <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-table-muted">Deck check</div>
                  <ul className="space-y-1 text-xs">
                    {validation.issues.slice(0, 30).map((i, idx) => (
                      <li key={idx} className={i.severity === "error" ? "text-red-300" : "text-amber-300"}>
                        • {i.message}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <textarea
                className="input h-24 w-full resize-none"
                placeholder="Notes / description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
          </div>
        </div>
      </div>

      {artPickerFor && (
        <ArtPicker cardId={artPickerFor.cardId} onPick={(p) => swapArt(artPickerFor.cardId, artPickerFor.board, p)} onClose={() => setArtPickerFor(null)} />
      )}
      {detailId && <CardDetailModal cardId={detailId} onClose={() => setDetailId(null)} onAdd={(cid) => cache[cid] && addCard(cache[cid]!)} />}
      {importOpen && (
        <ImportModal
          defaultFormat={formatId}
          onClose={() => setImportOpen(false)}
          onImported={(newId) => {
            setImportOpen(false);
            nav(`/decks/${newId}`);
          }}
        />
      )}
    </div>
  );
}

const STRENGTH_STYLE: Record<string, string> = {
  strong: "bg-green-900/50 text-green-200 border-green-700/50",
  medium: "bg-amber-900/40 text-amber-200 border-amber-700/50",
  weak: "bg-table-panel2 text-table-muted border-table-border",
};

function TagBar({
  tags,
  setTags,
  tagInput,
  setTagInput,
  dynamicTags,
}: {
  tags: string[];
  setTags: (t: string[]) => void;
  tagInput: string;
  setTagInput: (s: string) => void;
  dynamicTags: DeckTag[];
}) {
  function addTag() {
    const t = tagInput.trim();
    if (t && !tags.includes(t)) setTags([...tags, t]);
    setTagInput("");
  }
  return (
    <div className="panel p-3">
      <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-table-muted">Your tags</div>
      <div className="flex flex-wrap gap-1">
        {tags.map((t) => (
          <span key={t} className="chip">
            {t}
            <button className="ml-1 text-table-muted hover:text-red-300" onClick={() => setTags(tags.filter((x) => x !== t))}>
              ✕
            </button>
          </span>
        ))}
        <input
          className="input !w-28 !py-0.5 text-xs"
          placeholder="+ add tag"
          value={tagInput}
          onChange={(e) => setTagInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addTag()}
          onBlur={addTag}
        />
      </div>
      {dynamicTags.length > 0 && (
        <>
          <div className="mb-1 mt-3 text-xs font-semibold uppercase tracking-wide text-table-muted">Detected themes</div>
          <div className="flex flex-wrap gap-1">
            {dynamicTags.map((d) => (
              <span key={d.tag} className={`rounded-full border px-2 py-0.5 text-xs ${STRENGTH_STYLE[d.strength]}`} title={`${d.count} cards`}>
                {d.strength} {d.tag} · {d.count}
              </span>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function ImportModal({ defaultFormat, onClose, onImported }: { defaultFormat: string; onClose: () => void; onImported: (id: string) => void }) {
  const [name, setName] = useState("Imported Deck");
  const [formatId, setFormatId] = useState(defaultFormat);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ resolved: number; unresolved: string[] } | null>(null);

  async function doImport() {
    setBusy(true);
    setResult(null);
    try {
      const r = await api.post<{ id: string | null; resolved: number; unresolved: string[] }>("/api/decks/import", { name, formatId, text });
      if (r.id && r.unresolved.length === 0) {
        onImported(r.id);
      } else {
        setResult({ resolved: r.resolved, unresolved: r.unresolved });
        if (r.id) setTimeout(() => onImported(r.id!), 1500);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div className="panel w-full max-w-lg p-4" onClick={(e) => e.stopPropagation()}>
        <h3 className="mb-2 font-display text-lg text-table-accentSoft">Import a decklist</h3>
        <p className="mb-3 text-xs text-table-muted">
          Paste from MTG Arena, MTGGoldfish, or plain text (e.g. <code>4 Lightning Bolt</code>). Section headers like <code>Deck</code>,{" "}
          <code>Commander</code>, <code>Sideboard</code> are recognized.
        </p>
        <div className="flex gap-2">
          <input className="input flex-1" value={name} onChange={(e) => setName(e.target.value)} placeholder="Deck name" />
          <select className="input" value={formatId} onChange={(e) => setFormatId(e.target.value)}>
            {["house", "standard", "pioneer", "modern", "pauper", "commander"].map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </div>
        <textarea
          className="input mt-2 h-56 w-full resize-none font-mono text-xs"
          placeholder={"Deck\n4 Lightning Bolt\n2 Mountain (M21) 275\n..."}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        {result && (
          <div className="mt-2 text-xs">
            <div className="text-green-300">Resolved {result.resolved} cards.</div>
            {result.unresolved.length > 0 && (
              <div className="mt-1 text-amber-300">
                Couldn't find {result.unresolved.length}: {result.unresolved.slice(0, 8).join(", ")}
                {result.unresolved.length > 8 ? "…" : ""}
              </div>
            )}
          </div>
        )}
        <div className="mt-3 flex gap-2">
          <button className="btn-primary" onClick={doImport} disabled={busy || !text.trim()}>
            {busy ? "Importing…" : "Import"}
          </button>
          <button className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function BoardSection({
  title,
  entries,
  cache,
  onQty,
  onInfo,
  onMove,
  onArt,
  moveLabel,
}: {
  title: string;
  entries: Entry[];
  cache: Record<string, CardSummary>;
  onQty: (cardId: string, q: number) => void;
  onInfo: (id: string) => void;
  onMove?: (cardId: string) => void;
  onArt?: (cardId: string) => void;
  moveLabel?: string;
}) {
  return (
    <div className="mb-4">
      <h3 className="mb-1 font-display text-sm text-table-accentSoft">{title}</h3>
      <div className="divide-y divide-table-border/60 rounded-md border border-table-border">
        {entries.map((e) => {
          const c = cache[e.cardId];
          return (
            <div key={e.cardId} className="flex items-center gap-2 px-2 py-1 text-sm hover:bg-table-panel2/50">
              <div className="flex items-center gap-1">
                <button className="btn-ghost h-6 w-6 !px-0" onClick={() => onQty(e.cardId, e.quantity - 1)}>
                  −
                </button>
                <span className="w-6 text-center tabular-nums">{e.quantity}</span>
                <button className="btn-ghost h-6 w-6 !px-0" onClick={() => onQty(e.cardId, e.quantity + 1)}>
                  +
                </button>
              </div>
              <button className="flex-1 truncate text-left hover:text-table-accentSoft" onClick={() => onInfo(e.cardId)}>
                {c?.name ?? e.cardId}
              </button>
              <span className="text-[10px] text-table-muted">{c?.setCode.toUpperCase()}</span>
              {onArt && (
                <button className="text-xs text-table-muted hover:text-table-accentSoft" title="Choose art / printing" onClick={() => onArt(e.cardId)}>
                  🎨
                </button>
              )}
              <ManaCost cost={c?.manaCost ?? null} size={13} />
              {onMove && (
                <button className="text-xs text-table-muted hover:text-table-accentSoft" onClick={() => onMove(e.cardId)}>
                  {moveLabel}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function VisualSection({
  title,
  entries,
  cache,
  onQty,
  onInfo,
  onHover,
  onArt,
}: {
  title: string;
  entries: Entry[];
  cache: Record<string, CardSummary>;
  onQty: (cardId: string, q: number) => void;
  onInfo: (id: string) => void;
  onHover: (c: CardSummary | null) => void;
  onArt: (cardId: string) => void;
}) {
  return (
    <div className="mb-4">
      <h3 className="mb-1 font-display text-sm text-table-accentSoft">{title}</h3>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5">
        {entries.map((e) => {
          const c = cache[e.cardId];
          return (
            <div key={e.cardId} className="group relative" onMouseEnter={() => c && onHover(c)}>
              <button className="block w-full" onClick={() => onInfo(e.cardId)} title={c?.name}>
                <CardImage id={e.cardId} name={c?.name ?? e.cardId} />
              </button>
              <span className="absolute left-1 top-1 rounded bg-black/80 px-1.5 text-xs font-bold text-white">{e.quantity}×</span>
              <button
                className="absolute right-1 top-1 hidden rounded bg-black/80 px-1 text-xs group-hover:block"
                title="Choose art / printing"
                onClick={() => onArt(e.cardId)}
              >
                🎨
              </button>
              <div className="absolute bottom-1 left-1 right-1 hidden items-center justify-between group-hover:flex">
                <button className="rounded bg-black/80 px-1.5 text-sm text-white hover:bg-red-700" onClick={() => onQty(e.cardId, e.quantity - 1)}>
                  −
                </button>
                <button className="rounded bg-black/80 px-1.5 text-sm text-white hover:bg-green-700" onClick={() => onQty(e.cardId, e.quantity + 1)}>
                  +
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function StatsPanel({ validation }: { validation: DeckValidation | null }) {
  const stats = validation?.stats;
  if (!stats) return null;
  const maxCurve = Math.max(1, ...Object.values(stats.manaCurve));
  const colorOrder = ["W", "U", "B", "R", "G", "C"];
  const colorBg = MANA_HEX;
  return (
    <div className="panel p-3">
      <div className="mb-2 flex items-stretch gap-2">
        <div className="flex-1 rounded-md bg-table-panel2 p-2 text-center">
          <div className="font-display text-2xl leading-none text-table-accentSoft">{stats.averageCmc}</div>
          <div className="mt-0.5 text-[10px] uppercase tracking-wide text-table-muted">Avg mana value</div>
        </div>
        <div className="flex-1 rounded-md bg-table-panel2 p-2 text-center">
          <div className="font-display text-2xl leading-none text-table-ink">{stats.total}</div>
          <div className="mt-0.5 text-[10px] uppercase tracking-wide text-table-muted">Cards</div>
        </div>
        <div className="flex-1 rounded-md bg-table-panel2 p-2 text-center">
          <div className="font-display text-2xl leading-none text-table-ink">{stats.lands}</div>
          <div className="mt-0.5 text-[10px] uppercase tracking-wide text-table-muted">Lands</div>
        </div>
      </div>
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-table-muted">Breakdown</div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs">
        <Stat label="Total" v={stats.total} />
        <Stat label="Lands" v={stats.lands} />
        <Stat label="Creatures" v={stats.creatures} />
        <Stat label="Instants" v={stats.instants} />
        <Stat label="Sorceries" v={stats.sorceries} />
        <Stat label="Artifacts" v={stats.artifacts} />
        <Stat label="Enchant." v={stats.enchantments} />
        <Stat label="Planesw." v={stats.planeswalkers} />
        <Stat label="Avg MV" v={stats.averageCmc} />
      </div>
      <div className="mt-3 text-xs text-table-muted">Mana curve</div>
      <div className="mt-1 flex h-16 items-end gap-1">
        {Array.from({ length: 8 }, (_, i) => i).map((i) => (
          <div key={i} className="flex flex-1 flex-col items-center gap-0.5">
            <div className="w-full rounded-t bg-table-accent/80" style={{ height: `${((stats.manaCurve[i] ?? 0) / maxCurve) * 100}%` }} />
            <span className="text-[10px] text-table-muted">{i === 7 ? "7+" : i}</span>
          </div>
        ))}
      </div>
      <div className="mt-3 text-xs text-table-muted">Colors</div>
      <div className="mt-1 flex gap-1">
        {colorOrder.map((c) => (
          <div key={c} className="flex flex-1 flex-col items-center">
            <span className="h-3 w-3 rounded-full border border-black/40" style={{ background: colorBg[c] }} />
            <span className="text-[10px] tabular-nums text-table-muted">{stats.colorCounts[c] ?? 0}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Stat({ label, v }: { label: string; v: number }) {
  return (
    <>
      <span className="text-table-muted">{label}</span>
      <span className="text-right tabular-nums">{v}</span>
    </>
  );
}
