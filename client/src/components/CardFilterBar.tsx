import { useEffect, useMemo, useState } from "react";
import { MANA_FG, MANA_HEX, WUBRG } from "@/lib/mana";
import { SetFilter } from "@/components/SetFilter";
import type { SearchOpts } from "@/hooks/useCardSearch";

// Shared search + filter bar used by both the card Browser and the Deck Builder
// so the two always offer the exact same controls. It owns the filter state and
// composes it (plus the free-text box) into a single Scryfall-style query string
// that it hands back via `onQuery`.

const EXAMPLES = ["vampire", "t:instant o:vampire", "t:creature pow>=5", "f:commander t:dragon", 'o:"draw a card"', "is:banned f:modern"];
const COLOR_BTN = WUBRG.map((c) => ({ c, label: c, bg: MANA_HEX[c]!, fg: MANA_FG[c]! }));
const RARITIES = ["", "common", "uncommon", "rare", "mythic"];

export interface CardFilterBarProps {
  onQuery: (q: string) => void;
  opts: SearchOpts;
  setOpts: (o: SearchOpts) => void;
  interpreted?: string[];
  queryError?: string;
  compact?: boolean;
  autoFocus?: boolean;
}

export function CardFilterBar({ onQuery, opts, setOpts, interpreted, queryError, compact = false, autoFocus = false }: CardFilterBarProps) {
  const [text, setText] = useState("");
  const [colors, setColors] = useState<Set<string>>(new Set());
  const [colorMode, setColorMode] = useState<"include" | "exact">("include");
  const [multi, setMulti] = useState(false);
  const [colorless, setColorless] = useState(false);
  const [rarity, setRarity] = useState("");
  const [legal, setLegal] = useState("");
  const [sets, setSets] = useState<Set<string>>(new Set());
  const [cmcMin, setCmcMin] = useState("");
  const [cmcMax, setCmcMax] = useState("");

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
    if (cmcMin !== "") parts.push("cmc>=" + cmcMin);
    if (cmcMax !== "") parts.push("cmc<=" + cmcMax);
    return parts.join(" ");
  }, [text, colors, colorMode, multi, colorless, rarity, legal, sets, cmcMin, cmcMax]);

  useEffect(() => {
    onQuery(effective);
  }, [effective, onQuery]);

  function toggleColor(c: string) {
    setColors((prev) => {
      const next = new Set(prev);
      if (next.has(c)) next.delete(c);
      else next.add(c);
      return next;
    });
    setColorless(false);
  }

  const anyActive = colors.size > 0 || multi || colorless || !!rarity || !!legal || sets.size > 0 || !!cmcMin || !!cmcMax || !!text;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <input
          className="input min-w-0 flex-1"
          placeholder='Search — "vampire", t:instant, o:"draw a card", f:commander…'
          value={text}
          onChange={(e) => setText(e.target.value)}
          autoFocus={autoFocus}
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
            title="Has all of: card must contain every selected color (plus maybe others). Exactly: card is precisely those colors."
          >
            {colorMode === "exact" ? "exactly these" : "has all of"}
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

        <div className="flex items-center gap-1 text-xs text-table-muted" title="Mana value (cost to cast)">
          <span>Cost</span>
          <select className="input !py-1 !px-1" value={cmcMin} onChange={(e) => setCmcMin(e.target.value)}>
            <option value="">min</option>
            {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
              <option key={n} value={n}>
                ≥{n}
              </option>
            ))}
          </select>
          <select className="input !py-1 !px-1" value={cmcMax} onChange={(e) => setCmcMax(e.target.value)}>
            <option value="">max</option>
            {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
              <option key={n} value={n}>
                ≤{n}
              </option>
            ))}
          </select>
        </div>

        <label className="chip ml-auto cursor-pointer">
          <input type="checkbox" checked={opts.group} onChange={(e) => setOpts({ ...opts, group: e.target.checked })} />
          Group ARE / references
        </label>
        {anyActive && (
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
              setCmcMin("");
              setCmcMax("");
            }}
          >
            Clear ✕
          </button>
        )}
      </div>

      {!compact && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {EXAMPLES.map((ex) => (
            <button key={ex} className="chip hover:border-table-accent" onClick={() => setText(ex)}>
              {ex}
            </button>
          ))}
        </div>
      )}
      {interpreted && interpreted.length > 0 && <div className="mt-2 text-xs text-table-muted">Understood: {interpreted.join(" · ")}</div>}
      {queryError && <div className="mt-2 text-xs text-red-300">Query error: {queryError}</div>}
    </div>
  );
}
