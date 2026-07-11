import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type { CardSummary, DeckDetail, DeckValidation, FormatDef } from "@mtg/shared";
import { api } from "@/api/client";
import { CardImage } from "@/components/CardTile";
import { CardDetailModal } from "@/components/CardDetailModal";
import { ManaCost } from "@/components/ManaCost";
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
  const [detailId, setDetailId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const search = useCardSearch("");
  const valTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    api.get<{ formats: FormatDef[] }>("/api/formats").then((r) => setFormats(r.formats));
  }, []);

  // Load existing deck.
  useEffect(() => {
    if (!id) return;
    api.get<{ deck: DeckDetail; validation: DeckValidation }>(`/api/decks/${id}`).then((r) => {
      setName(r.deck.name);
      setFormatId(r.deck.formatId);
      setDescription(r.deck.description);
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
          .post<DeckValidation>("/api/decks/validate", { formatId: fmt, cards: es })
          .then(setValidation)
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
      const payload = { name, formatId, description, cards: entries };
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
        <div className="p-3">
          <input
            className="input w-full"
            placeholder='Add cards — "vampire", t:creature c:b, f:commander…'
            value={search.q}
            onChange={(e) => search.setQ(e.target.value)}
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
                  <div key={c.id} className="group relative">
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
            <button className="btn-ghost" onClick={exportText}>
              Export
            </button>
          </div>
          <div className="mt-2 flex items-center gap-3 text-sm text-table-muted">
            <span>
              {mainCount} cards
              {format?.requiresCommander ? ` · ${commanderCount} commander` : ""}
              {format ? ` · min ${format.minDeckSize}` : ""}
            </span>
            {validation && (
              <span className={validation.valid ? "text-green-300" : "text-amber-300"}>
                {validation.valid ? "✓ Legal" : `${validation.issues.filter((i) => i.severity === "error").length} issue(s)`}
              </span>
            )}
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
                  moveLabel="→ main"
                />
              )}
              {Object.keys(grouped).length === 0 && entries.length === 0 && (
                <div className="panel p-6 text-center text-sm text-table-muted">
                  Search on the left and click a card to add it. Set the commander by moving a legendary creature to the Commander row.
                </div>
              )}
              {TYPE_ORDER.filter((t) => grouped[t]?.length).map((t) => (
                <BoardSection
                  key={t}
                  title={`${t} (${grouped[t]!.reduce((n, e) => n + e.quantity, 0)})`}
                  entries={grouped[t]!}
                  cache={cache}
                  onQty={(cid, q) => setQty(cid, "main", q)}
                  onInfo={setDetailId}
                  onMove={format?.requiresCommander ? (cid) => moveBoard(cid, "main", "commander") : undefined}
                  moveLabel="set commander"
                />
              ))}
            </div>

            <div className="space-y-3">
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

      {detailId && <CardDetailModal cardId={detailId} onClose={() => setDetailId(null)} onAdd={(cid) => cache[cid] && addCard(cache[cid]!)} />}
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
  moveLabel,
}: {
  title: string;
  entries: Entry[];
  cache: Record<string, CardSummary>;
  onQty: (cardId: string, q: number) => void;
  onInfo: (id: string) => void;
  onMove?: (cardId: string) => void;
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

function StatsPanel({ validation }: { validation: DeckValidation | null }) {
  const stats = validation?.stats;
  if (!stats) return null;
  const maxCurve = Math.max(1, ...Object.values(stats.manaCurve));
  const colorOrder = ["W", "U", "B", "R", "G", "C"];
  const colorBg: Record<string, string> = { W: "#f8f6d8", U: "#3b7dd8", B: "#4b4b52", R: "#d3452b", G: "#2f9e58", C: "#c9c6be" };
  return (
    <div className="panel p-3">
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-table-muted">Stats</div>
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
