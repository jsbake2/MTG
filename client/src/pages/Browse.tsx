import { useEffect, useMemo, useState } from "react";
import type { CardSummary } from "@mtg/shared";
import { api } from "@/api/client";
import { CardTile } from "@/components/CardTile";
import { CardDetailModal } from "@/components/CardDetailModal";
import { SetFilter } from "@/components/SetFilter";
import { useCardSearch } from "@/hooks/useCardSearch";

const EXAMPLES = ["vampire", "t:instant o:vampire", "t:creature pow>=5", "f:commander t:dragon", 'o:"draw a card"', "is:banned f:modern"];

const COLOR_BTN: Array<{ c: string; label: string; bg: string; fg: string }> = [
  { c: "W", label: "W", bg: "#f8f6d8", fg: "#3a3a1a" },
  { c: "U", label: "U", bg: "#3b7dd8", fg: "#fff" },
  { c: "B", label: "B", bg: "#4b4b52", fg: "#fff" },
  { c: "R", label: "R", bg: "#d3452b", fg: "#fff" },
  { c: "G", label: "G", bg: "#2f9e58", fg: "#fff" },
];
const RARITIES = ["", "common", "uncommon", "rare", "mythic"];

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
  const { q, setQ, opts, setOpts, resp, loading } = useCardSearch("");
  const [text, setText] = useState("");
  const [colors, setColors] = useState<Set<string>>(new Set());
  const [colorMode, setColorMode] = useState<"include" | "exact">("include");
  const [multi, setMulti] = useState(false);
  const [colorless, setColorless] = useState(false);
  const [rarity, setRarity] = useState("");
  const [legal, setLegal] = useState("");
  const [sets, setSets] = useState<Set<string>>(new Set());
  const [detailId, setDetailId] = useState<string | null>(null);

  // Compose the text box + filter controls into one query string.
  const effective = useMemo(() => {
    const parts: string[] = [];
    if (text.trim()) parts.push(text.trim());
    if (colors.size > 0) parts.push((colorMode === "exact" ? "c=" : "c:") + [...colors].join("").toLowerCase());
    if (multi) parts.push("is:multicolor");
    if (colorless) parts.push("is:colorless");
    if (rarity) parts.push("r:" + rarity);
    if (legal) parts.push("f:" + legal);
    if (sets.size > 0) parts.push("set:" + [...sets].join(","));
    return parts.join(" ");
  }, [text, colors, colorMode, multi, colorless, rarity, legal, sets]);

  useEffect(() => {
    setQ(effective);
  }, [effective, setQ]);

  function toggleColor(c: string) {
    setColors((prev) => {
      const next = new Set(prev);
      if (next.has(c)) next.delete(c);
      else next.add(c);
      return next;
    });
    setColorless(false);
  }

  return (
    <div className="mx-auto max-w-7xl p-4">
      <ImportBanner />
      <div className="panel mb-4 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <input
            className="input min-w-0 flex-1"
            placeholder='Search — "vampire", t:instant, o:"draw a card", f:commander…'
            value={text}
            onChange={(e) => setText(e.target.value)}
            autoFocus
          />
          <select className="input" value={opts.sort} onChange={(e) => setOpts({ ...opts, sort: e.target.value })}>
            <option value="name">Sort: Name</option>
            <option value="cmc">Sort: Mana value</option>
            <option value="released">Sort: Newest</option>
            <option value="rarity">Sort: Rarity</option>
            <option value="color">Sort: Color</option>
          </select>
          <select className="input" value={opts.dir} onChange={(e) => setOpts({ ...opts, dir: e.target.value })}>
            <option value="asc">↑ Asc</option>
            <option value="desc">↓ Desc</option>
          </select>
        </div>

        {/* Filter row */}
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
          <div className="flex items-center gap-1">
            <span className="text-xs text-table-muted">Colors</span>
            {COLOR_BTN.map((b) => {
              const on = colors.has(b.c);
              return (
                <button
                  key={b.c}
                  onClick={() => toggleColor(b.c)}
                  className={`flex h-7 w-7 items-center justify-center rounded-full border-2 text-xs font-bold transition ${on ? "border-table-accent scale-110" : "border-transparent opacity-60 hover:opacity-100"}`}
                  style={{ background: b.bg, color: b.fg }}
                  title={b.c}
                >
                  {b.label}
                </button>
              );
            })}
            <button
              className={`chip ml-1 ${colorMode === "exact" ? "border-table-accent text-table-accentSoft" : ""}`}
              onClick={() => setColorMode(colorMode === "exact" ? "include" : "exact")}
              title="Toggle: includes these colors vs. exactly these colors"
            >
              {colorMode === "exact" ? "= exactly" : "⊇ includes"}
            </button>
          </div>

          <label className={`chip cursor-pointer ${multi ? "border-table-accent text-table-accentSoft" : ""}`}>
            <input type="checkbox" className="hidden" checked={multi} onChange={(e) => setMulti(e.target.checked)} />
            Multicolor
          </label>
          <label className={`chip cursor-pointer ${colorless ? "border-table-accent text-table-accentSoft" : ""}`}>
            <input type="checkbox" className="hidden" checked={colorless} onChange={(e) => { setColorless(e.target.checked); if (e.target.checked) setColors(new Set()); }} />
            Colorless
          </label>

          <select className="input !py-1" value={rarity} onChange={(e) => setRarity(e.target.value)}>
            {RARITIES.map((r) => (
              <option key={r} value={r}>
                {r ? `Rarity: ${r}` : "Any rarity"}
              </option>
            ))}
          </select>

          <select className="input !py-1" value={legal} onChange={(e) => setLegal(e.target.value)} title="Only show cards legal in a format">
            {["", "standard", "pioneer", "modern", "pauper", "legacy", "vintage", "commander"].map((f) => (
              <option key={f} value={f}>
                {f ? `Legal: ${f}` : "Any legality"}
              </option>
            ))}
          </select>

          <SetFilter selected={sets} onChange={setSets} />

          <label className="chip ml-auto cursor-pointer">
            <input type="checkbox" checked={opts.group} onChange={(e) => setOpts({ ...opts, group: e.target.checked })} />
            Group ARE / references
          </label>
          {(colors.size > 0 || multi || colorless || rarity || legal || sets.size > 0 || text) && (
            <button
              className="chip hover:border-red-400"
              onClick={() => {
                setText("");
                setColors(new Set());
                setMulti(false);
                setColorless(false);
                setRarity("");
                setLegal("");
                setSets(new Set());
              }}
            >
              Clear ✕
            </button>
          )}
        </div>

        <div className="mt-2 flex flex-wrap gap-1.5">
          {EXAMPLES.map((ex) => (
            <button key={ex} className="chip hover:border-table-accent" onClick={() => setText(ex)}>
              {ex}
            </button>
          ))}
        </div>
        {q && resp?.interpreted && resp.interpreted.length > 0 && (
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
        <div className="py-10 text-center text-table-muted">No cards found. Try adjusting filters or the search.</div>
      )}

      {detailId && <CardDetailModal cardId={detailId} onClose={() => setDetailId(null)} />}
    </div>
  );
}
