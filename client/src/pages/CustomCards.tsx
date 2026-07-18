import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ART_STYLES, CARD_TYPES, RARITIES, FRAME_THEMES, customCardToForgeScript,
  type CustomCard, type CustomSet, type CardSummary,
} from "@mtg/shared";

interface SetStats { total: number; byRarity: Record<string, number>; byColor: Record<string, number>; byType: Record<string, number>; curve: number[] }
interface Reprint { card: CardSummary; rarity: string; collectorNumber: number | null }
import { api, ApiError } from "@/api/client";
import { useAuth } from "@/store/auth";

type CardForm = Omit<CustomCard, "id" | "setId" | "forgeScript" | "artPath" | "collectorNumber">;

interface ArtTx { scale: number; dx: number; dy: number }
const IDENTITY_TX: ArtTx = { scale: 1, dx: 0, dy: 0 };
interface HeldArt { dataUrl: string; mime: string; tx: ArtTx; dirty: boolean; prompt?: string }
// Themes whose art fills the whole card (portrait); the rest use the framed
// landscape art window. Aspect = width/height of the art box, matches the server.
const FULLART_THEMES = new Set(["zendikar", "borderless"]);
const artBoxAspect = (themeId: string): number => (FULLART_THEMES.has(themeId) ? 0.71 : 1.4);

const blankForm = (): CardForm => ({
  name: "", manaCost: "", types: "Creature", power: "2", toughness: "2", loyalty: "",
  keywords: [], oracle: "", flavor: "", rarity: "C", artist: "", advanced: false, frameTheme: "classic", isToken: false,
});

export function CustomCards() {
  const { user } = useAuth();
  const isAdmin = user?.isAdmin ?? false;
  const [sets, setSets] = useState<CustomSet[]>([]);
  const [activeSet, setActiveSet] = useState<CustomSet | null>(null);
  const [cards, setCards] = useState<CustomCard[]>([]);
  const [reprints, setReprints] = useState<Reprint[]>([]);
  const [stats, setStats] = useState<SetStats | null>(null);
  const [editing, setEditing] = useState<CustomCard | "new" | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [showStudy, setShowStudy] = useState(false);

  const loadSets = useCallback(async () => {
    const r = await api.get<{ sets: CustomSet[] }>("/api/custom/sets");
    setSets(r.sets);
    setActiveSet((cur) => cur ?? r.sets[0] ?? null);
  }, []);
  useEffect(() => { loadSets(); }, [loadSets]);

  const loadContents = useCallback(async (setId: string) => {
    const [c, s] = await Promise.all([
      api.get<{ native: CustomCard[]; reprints: Reprint[] }>(`/api/custom/sets/${setId}/contents`),
      api.get<{ stats: SetStats }>(`/api/custom/sets/${setId}/stats`),
    ]);
    setCards(c.native); setReprints(c.reprints); setStats(s.stats);
  }, []);
  const loadCards = loadContents; // keep old call-sites working
  useEffect(() => { if (activeSet) loadContents(activeSet.id); }, [activeSet, loadContents]);

  async function addReprint(cardId: string) {
    if (!activeSet) return;
    await api.post(`/api/custom/sets/${activeSet.id}/reprints`, { cardId });
    loadContents(activeSet.id);
  }
  async function removeReprint(cardId: string) {
    if (!activeSet) return;
    await api.del(`/api/custom/sets/${activeSet.id}/reprints/${cardId}`);
    loadContents(activeSet.id);
  }

  async function newSet() {
    const name = prompt("New set name (your Wheel of Time, his Adventure Time…):")?.trim();
    if (!name) return;
    try {
      const r = await api.post<{ set: CustomSet }>("/api/custom/sets", { name });
      await loadSets();
      setActiveSet(r.set);
    } catch (e) { alert((e as ApiError).message); }
  }

  async function del(card: CustomCard) {
    if (!confirm(`Delete "${card.name}"?`)) return;
    await api.del(`/api/custom/cards/${card.id}`);
    if (activeSet) loadCards(activeSet.id);
  }
  async function copy(card: CustomCard) {
    await api.post(`/api/custom/cards/${card.id}/copy`);
    if (activeSet) loadCards(activeSet.id);
  }

  return (
    <div className="mx-auto flex max-w-6xl gap-4 p-4">
      {/* Sets sidebar */}
      <aside className="w-56 shrink-0">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="font-display text-lg text-table-accentSoft">Custom Sets</h2>
          <button className="chip hover:border-table-accent" onClick={newSet}>+ New</button>
        </div>
        <div className="space-y-1">
          {sets.map((s) => (
            <button key={s.id} onClick={() => setActiveSet(s)}
              className={`block w-full rounded-md border px-3 py-2 text-left text-sm ${activeSet?.id === s.id ? "border-table-accent bg-table-accent/10" : "border-table-border hover:bg-table-panel2"}`}>
              <div className="font-semibold">{s.name}</div>
              <div className="text-xs text-table-muted">{s.code} · {s.cardCount ?? 0} cards</div>
            </button>
          ))}
          {sets.length === 0 && <div className="text-sm text-table-muted">No custom sets yet. Create one to start.</div>}
        </div>
        <div className="mt-4 rounded-md border border-table-border/50 bg-table-panel2/40 p-2 text-[11px] text-table-muted">
          After creating cards, run <code className="rounded bg-black/40 px-1">tools/forge-sync.sh</code> on each machine to load them into Forge.
        </div>
      </aside>

      {/* Cards */}
      <main className="min-w-0 flex-1">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h1 className="font-display text-xl text-table-accentSoft">{activeSet ? activeSet.name : "Custom Cards"}</h1>
          <div className="flex gap-2">
            <button className="chip hover:border-table-accent" onClick={() => setShowStudy(true)}>📚 Study real sets</button>
            {activeSet && <button className="chip hover:border-table-accent" onClick={() => setShowAdd((v) => !v)}>{showAdd ? "Close" : "＋ Add reprints"}</button>}
            {activeSet && <button className="btn-primary" onClick={() => setEditing("new")}>+ New card</button>}
          </div>
        </div>
        {!activeSet ? (
          <div className="py-16 text-center text-table-muted">Create or pick a set on the left.</div>
        ) : (
          <>
            {stats && <SetStatsBar stats={stats} />}
            {showAdd && <ReprintSearch onAdd={addReprint} inSet={new Set([...cards.map((c) => c.id), ...reprints.map((r) => r.card.id)])} />}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
              {cards.map((c) => (
                <div key={c.id} className="panel overflow-hidden p-0">
                  <div className="card-aspect flex items-center justify-center bg-table-bg">
                    <img src={`/api/custom/cards/${c.id}/render`} alt={c.name} className="h-full w-full object-contain" />
                  </div>
                  <div className="p-2">
                    <div className="truncate text-sm font-semibold" title={c.name}>{c.name}</div>
                    <div className="truncate text-[11px] text-table-muted">{c.types}{c.manaCost ? ` · ${c.manaCost}` : ""}</div>
                    <div className="mt-1 flex gap-1 text-[11px]">
                      <button className="chip !px-1.5 hover:border-table-accent" onClick={() => setEditing(c)}>Edit</button>
                      <button className="chip !px-1.5 hover:border-table-accent" onClick={() => copy(c)}>Copy</button>
                      <button className="chip !px-1.5 hover:border-red-400 text-red-300" onClick={() => del(c)}>Del</button>
                    </div>
                  </div>
                </div>
              ))}
              {reprints.map((r) => (
                <div key={r.card.id} className="panel overflow-hidden p-0">
                  <div className="card-aspect relative flex items-center justify-center bg-table-bg">
                    <img src={`/api/cards/${r.card.id}/image`} alt={r.card.name} className="h-full w-full object-contain" />
                    <span className="absolute left-1 top-1 rounded bg-black/70 px-1 text-[10px] text-table-muted">reprint</span>
                  </div>
                  <div className="p-2">
                    <div className="truncate text-sm font-semibold" title={r.card.name}>{r.card.name}</div>
                    <div className="truncate text-[11px] text-table-muted">{r.card.typeLine} · {r.rarity}</div>
                    <div className="mt-1 flex gap-1 text-[11px]">
                      <button className="chip !px-1.5 text-red-300 hover:border-red-400" onClick={() => removeReprint(r.card.id)}>Remove</button>
                    </div>
                  </div>
                </div>
              ))}
              {cards.length === 0 && reprints.length === 0 && <div className="col-span-full py-10 text-center text-table-muted">Empty set. Create cards or add reprints to fill it out.</div>}
            </div>
          </>
        )}
      </main>

      {editing && activeSet && (
        <CardEditor
          set={activeSet} isAdmin={isAdmin} card={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); loadCards(activeSet.id); loadSets(); }}
        />
      )}
      {showStudy && <RealSetStudy onClose={() => setShowStudy(false)} />}
    </div>
  );
}

// Compact set-composition readout: total, rarity split, color/type mix, curve.
function SetStatsBar({ stats }: { stats: SetStats }) {
  const COLOR_HEX: Record<string, string> = { W: "#f5e6a0", U: "#3fa9ff", B: "#8a7f78", R: "#ff5a3c", G: "#4cd964", M: "#e9c94a", C: "#b7b7b7" };
  const maxCurve = Math.max(1, ...stats.curve);
  return (
    <div className="mb-3 flex flex-wrap items-center gap-4 rounded-lg border border-table-border bg-table-panel p-3 text-xs">
      <div><span className="text-2xl font-bold text-table-accentSoft">{stats.total}</span> <span className="text-table-muted">cards</span></div>
      <div className="flex gap-2">
        {["M", "R", "U", "C", "S", "L"].filter((r) => stats.byRarity[r]).map((r) => (
          <span key={r} className="rounded border border-table-border px-1.5 py-0.5">{r}: <b>{stats.byRarity[r]}</b></span>
        ))}
      </div>
      <div className="flex items-center gap-1" title="color mix">
        {["W", "U", "B", "R", "G", "M", "C"].filter((c) => stats.byColor[c]).map((c) => (
          <span key={c} className="flex items-center gap-0.5">
            <span className="inline-block h-3 w-3 rounded-full" style={{ background: COLOR_HEX[c] }} />{stats.byColor[c]}
          </span>
        ))}
      </div>
      <div className="flex items-end gap-0.5" title="mana curve (0…7+)">
        {stats.curve.map((n, i) => (
          <div key={i} className="flex w-3 flex-col items-center">
            <div className="w-2 rounded-t bg-table-accent/70" style={{ height: `${(n / maxCurve) * 28}px` }} />
            <span className="text-[9px] text-table-muted">{i === 7 ? "7+" : i}</span>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-1 text-table-muted">
        {Object.entries(stats.byType).sort((a, b) => b[1] - a[1]).map(([t, n]) => <span key={t}>{t} {n}</span>)}
      </div>
    </div>
  );
}

// Search the whole card pool and add cards to the set as reprints (filler).
function ReprintSearch({ onAdd, inSet }: { onAdd: (id: string) => void; inSet: Set<string> }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<CardSummary[]>([]);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!q.trim()) { setResults([]); return; }
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const r = await api.get<{ groups: { cards: CardSummary[] }[] }>(`/api/cards/search?q=${encodeURIComponent(q)}&group=0&pageSize=24`);
        setResults(r.groups.flatMap((g) => g.cards).slice(0, 24));
      } finally { setLoading(false); }
    }, 300);
    return () => clearTimeout(t);
  }, [q]);
  return (
    <div className="mb-3 rounded-lg border border-table-border bg-table-panel p-3">
      <input className="input w-full" placeholder="Search the card pool to add reprints — name, type, 'draw a card'…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
      {loading && <div className="mt-2 text-xs text-table-muted">Searching…</div>}
      {results.length > 0 && (
        <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6">
          {results.map((c) => {
            const added = inSet.has(c.id);
            return (
              <button key={c.id} disabled={added} onClick={() => onAdd(c.id)}
                className={`group relative overflow-hidden rounded border ${added ? "border-emerald-500/60 opacity-60" : "border-table-border hover:border-table-accent"}`}
                title={added ? "Already in set" : `Add ${c.name}`}>
                <img src={`/api/cards/${c.id}/image`} alt={c.name} className="card-aspect w-full object-cover" />
                <span className="absolute inset-x-0 bottom-0 bg-black/70 px-1 py-0.5 text-[9px] text-white">{added ? "✓ in set" : "+ add"}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Read-only browser of real official sets — study what a complete set looks like.
function RealSetStudy({ onClose }: { onClose: () => void }) {
  const [sets, setSets] = useState<Array<{ code: string; name: string; count: number; released: string | null }>>([]);
  const [pick, setPick] = useState<string | null>(null);
  const [stats, setStats] = useState<SetStats | null>(null);
  const [cards, setCards] = useState<CardSummary[]>([]);
  const [q, setQ] = useState("");
  useEffect(() => { api.get<{ sets: typeof sets }>("/api/custom/real-sets").then((r) => setSets(r.sets)); }, []);
  useEffect(() => {
    if (!pick) return;
    api.get<{ stats: SetStats }>(`/api/custom/real-sets/${pick}/stats`).then((r) => setStats(r.stats));
    api.get<{ cards: CardSummary[] }>(`/api/custom/real-sets/${pick}/cards`).then((r) => setCards(r.cards));
  }, [pick]);
  const shownSets = sets.filter((s) => !q || s.name.toLowerCase().includes(q.toLowerCase()) || s.code.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-4" onClick={onClose}>
      <div className="panel my-4 flex h-[85vh] w-full max-w-5xl gap-3 p-4" onClick={(e) => e.stopPropagation()}>
        <aside className="flex w-56 shrink-0 flex-col">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="font-display text-table-accentSoft">Official sets</h3>
            <button className="btn-ghost !px-2" onClick={onClose}>✕</button>
          </div>
          <input className="input mb-2" placeholder="Filter sets…" value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="min-h-0 flex-1 space-y-1 overflow-y-auto">
            {shownSets.map((s) => (
              <button key={s.code} onClick={() => setPick(s.code)}
                className={`block w-full rounded border px-2 py-1 text-left text-xs ${pick === s.code ? "border-table-accent bg-table-accent/10" : "border-table-border hover:bg-table-panel2"}`}>
                <div className="font-semibold">{s.name}</div>
                <div className="text-table-muted">{s.code.toUpperCase()} · {s.count} cards{s.released ? ` · ${s.released.slice(0, 4)}` : ""}</div>
              </button>
            ))}
          </div>
        </aside>
        <div className="min-w-0 flex-1 overflow-y-auto">
          {!pick ? (
            <div className="py-16 text-center text-table-muted">Pick a set to study its composition (read-only).</div>
          ) : (
            <>
              {stats && <SetStatsBar stats={stats} />}
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6">
                {cards.map((c) => (
                  <img key={c.id} src={`/api/cards/${c.id}/image`} alt={c.name} title={`${c.name} · ${c.rarity}`} className="card-aspect w-full rounded object-cover" loading="lazy" />
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ---- the guided creator / editor ---------------------------------------
function CardEditor({ set, card, isAdmin, onClose, onSaved }: { set: CustomSet; card: CustomCard | null; isAdmin: boolean; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState<CardForm>(() => (card ? { ...card } : blankForm()));
  const [savedId, setSavedId] = useState<string | null>(card?.id ?? null);
  const [rawScript, setRawScript] = useState(card?.forgeScript ?? "");
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [rev, setRev] = useState(0); // bumps the rendered full-card preview
  const [held, setHeld] = useState<HeldArt | null>(null); // art held client-side until save
  const up = (patch: Partial<CardForm>) => setF((c) => ({ ...c, ...patch }));
  const isCreature = /\bcreature\b/i.test(f.types) || /\bvehicle\b/i.test(f.types);
  const isPW = /\bplaneswalker\b/i.test(f.types);
  const isLand = /\bland\b/i.test(f.types);

  // "Fully populated" = enough to make a real card. Gates the AI-art button.
  const missing: string[] = [];
  if (!f.name.trim()) missing.push("name");
  if (!f.types.trim()) missing.push("type");
  if (!f.manaCost?.trim() && !isLand) missing.push("mana cost");
  if (isCreature && (!f.power?.trim() || !f.toughness?.trim())) missing.push("power/toughness");
  if (isPW && !f.loyalty?.trim()) missing.push("loyalty");
  const formComplete = missing.length === 0;

  // When editing a card that already has art, load it so it can be re-adjusted.
  useEffect(() => {
    if (!card?.id) return;
    let alive = true;
    api.get<{ hasArt: boolean; mime?: string; dataBase64?: string; tx?: ArtTx }>(`/api/custom/cards/${card.id}/art.json`)
      .then((r) => { if (alive && r.hasArt && r.dataBase64) setHeld({ dataUrl: `data:${r.mime};base64,${r.dataBase64}`, mime: r.mime!, tx: r.tx ?? IDENTITY_TX, dirty: false }); })
      .catch(() => {});
    return () => { alive = false; };
  }, [card?.id]);

  const preview = useMemo(
    () => customCardToForgeScript({ ...f, forgeScript: rawScript, advanced: f.advanced }),
    [f, rawScript],
  );

  async function save() {
    setErr(null); setSaving(true);
    try {
      const body = { ...f, setId: set.id, forgeScript: rawScript };
      const r = savedId
        ? await api.put<{ card: CustomCard }>(`/api/custom/cards/${savedId}`, body)
        : await api.post<{ card: CustomCard }>("/api/custom/cards", body);
      const id = r.card.id;
      setSavedId(id);
      // Persist any newly added/adjusted art with its positioning transform.
      if (held?.dirty) {
        await api.post(`/api/custom/cards/${id}/art/upload`, { dataBase64: held.dataUrl, mime: held.mime, tx: held.tx, prompt: held.prompt });
        setHeld({ ...held, dirty: false });
      }
      setRev((v) => v + 1);
      onSaved();
    } catch (e) { setErr((e as ApiError).message); } finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-4" onClick={onClose}>
      <div className="panel my-4 grid w-full max-w-4xl grid-cols-1 gap-4 p-5 md:grid-cols-2" onClick={(e) => e.stopPropagation()}>
        {/* Left: guided fields */}
        <div className="space-y-3">
          <h3 className="font-display text-lg text-table-accentSoft">{card ? "Edit card" : "New card"} · {set.name}</h3>

          <label className="block text-sm">Name
            <input className="input mt-1 w-full" value={f.name} onChange={(e) => up({ name: e.target.value })} placeholder="Rand al'Thor" />
          </label>

          <label className="block text-sm">Card type
            <select className="input mt-1 w-full" value={f.types.split(" ")[0]} onChange={(e) => {
              const sub = f.types.split(" ").slice(1).join(" ");
              up({ types: [e.target.value, sub].filter(Boolean).join(" ") });
            }}>
              {CARD_TYPES.map((t) => <option key={t}>{t}</option>)}
            </select>
          </label>
          <label className="block text-sm">Subtypes (optional, e.g. “Legendary Human Wizard”)
            <input className="input mt-1 w-full" value={f.types} onChange={(e) => up({ types: e.target.value })} />
          </label>

          <div className="flex gap-2">
            <label className="block flex-1 text-sm">Mana cost (Forge form: “2 R R”)
              <input className="input mt-1 w-full" value={f.manaCost ?? ""} onChange={(e) => up({ manaCost: e.target.value })} placeholder="2 R R" />
            </label>
            <label className="block w-24 text-sm">Rarity
              <select className="input mt-1 w-full" value={f.rarity} onChange={(e) => up({ rarity: e.target.value })}>
                {RARITIES.map((r) => <option key={r.code} value={r.code}>{r.label}</option>)}
              </select>
            </label>
          </div>

          {isCreature && (
            <div className="flex gap-2">
              <label className="block w-20 text-sm">Power<input className="input mt-1 w-full" value={f.power ?? ""} onChange={(e) => up({ power: e.target.value })} /></label>
              <label className="block w-20 text-sm">Toughness<input className="input mt-1 w-full" value={f.toughness ?? ""} onChange={(e) => up({ toughness: e.target.value })} /></label>
            </div>
          )}
          {isPW && <label className="block w-28 text-sm">Loyalty<input className="input mt-1 w-full" value={f.loyalty ?? ""} onChange={(e) => up({ loyalty: e.target.value })} /></label>}

          <KeywordPicker keywords={f.keywords} onChange={(kw) => up({ keywords: kw })} />

          <label className="block text-sm">Rules text (Oracle)
            <textarea className="input mt-1 h-20 w-full" value={f.oracle} onChange={(e) => up({ oracle: e.target.value })} placeholder="Haste, trample" />
          </label>
          <label className="block text-sm">Flavor text (optional)
            <textarea className="input mt-1 h-14 w-full" value={f.flavor ?? ""} onChange={(e) => up({ flavor: e.target.value })} />
          </label>
          <label className="block text-sm">Artist (optional)
            <input className="input mt-1 w-full" value={f.artist ?? ""} onChange={(e) => up({ artist: e.target.value })} />
          </label>

          {isAdmin && (
            <div className="rounded-md border border-amber-500/30 bg-amber-950/20 p-2">
              <label className="flex items-center gap-2 text-xs font-semibold text-amber-200">
                <input type="checkbox" checked={f.advanced} onChange={(e) => { up({ advanced: e.target.checked }); if (e.target.checked && !rawScript) setRawScript(preview); }} />
                Advanced — hand-write the Forge script (host only)
              </label>
              {f.advanced && (
                <>
                  <AbilitySearch onInsert={(line) => setRawScript((s) => s + (s.endsWith("\n") || !s ? "" : "\n") + line + "\n")} />
                  <textarea className="input mt-2 h-40 w-full font-mono text-xs" value={rawScript} onChange={(e) => setRawScript(e.target.value)} />
                </>
              )}
            </div>
          )}

          {err && <div className="text-sm text-red-300">{err}</div>}
          <div className="flex gap-2">
            <button className="btn-primary" onClick={save} disabled={saving || !f.name.trim()}>{saving ? "Saving…" : savedId ? "Save changes" : "Create card"}</button>
            <button className="btn-ghost" onClick={onClose}>Close</button>
          </div>
        </div>

        {/* Right: live preview + art */}
        <div className="space-y-3">
          {savedId && !held?.dirty ? (
            <div>
              <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-table-muted">Card preview (what Forge shows)</div>
              <img src={`/api/custom/cards/${savedId}/render?v=${rev}&theme=${f.frameTheme}`} alt="card preview" className="mx-auto w-56 rounded-lg shadow-lg" />
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-table-border p-3 text-center text-xs text-table-muted">
              {held?.dirty ? "Save to update the full-card preview. Position the art below." : "Fill in the card and add art — hit Create card to see the full render."}
            </div>
          )}
          <div>
            <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-table-muted">Card frame ({FRAME_THEMES.find((t) => t.id === f.frameTheme)?.inspiredBy})</div>
            <div className="grid grid-cols-3 gap-1">
              {FRAME_THEMES.map((t) => (
                <button key={t.id} type="button" onClick={() => up({ frameTheme: t.id })}
                  className={`rounded border px-1.5 py-1 text-[11px] ${f.frameTheme === t.id ? "border-table-accent bg-table-accent/10 text-table-accentSoft" : "border-table-border hover:bg-table-panel2"}`}
                  title={`inspired by ${t.inspiredBy}`}>{t.label}</button>
              ))}
            </div>
          </div>
          <details>
            <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-table-muted">Forge script (live)</summary>
            <pre className="mt-1 max-h-48 overflow-auto rounded bg-black/50 p-2 text-[11px] leading-snug text-emerald-200/90">{preview}</pre>
          </details>
          <ArtPanel held={held} setHeld={setHeld} formComplete={formComplete} missing={missing}
            cardName={f.name} types={f.types} frameTheme={f.frameTheme} />
        </div>
      </div>
    </div>
  );
}

function KeywordPicker({ keywords, onChange }: { keywords: string[]; onChange: (kw: string[]) => void }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Array<{ keyword: string; sample: string; example: string }>>([]);
  useEffect(() => {
    const t = setTimeout(async () => {
      const r = await api.get<{ keywords: typeof results }>(`/api/forge/keywords?q=${encodeURIComponent(q)}`);
      setResults(r.keywords);
    }, 200);
    return () => clearTimeout(t);
  }, [q]);
  return (
    <div className="text-sm">
      <div className="mb-1">Keywords / abilities</div>
      <div className="mb-1 flex flex-wrap gap-1">
        {keywords.map((k, i) => (
          <span key={i} className="chip flex items-center gap-1">{k}
            <button className="text-red-300 hover:text-red-200" onClick={() => onChange(keywords.filter((_, j) => j !== i))}>✕</button>
          </span>
        ))}
      </div>
      <input className="input w-full" placeholder="search Forge keywords (Flying, Crew, Saddle…)" value={q} onChange={(e) => setQ(e.target.value)} />
      {q && (
        <div className="mt-1 max-h-32 overflow-y-auto rounded border border-table-border bg-table-panel2">
          {results.map((r) => (
            <button key={r.keyword} className="block w-full px-2 py-1 text-left text-xs hover:bg-table-panel"
              onClick={() => { onChange([...keywords, r.sample]); setQ(""); }}>
              <b>{r.keyword}</b> <span className="text-table-muted">({r.sample}) · e.g. {r.example}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function AbilitySearch({ onInsert }: { onInsert: (line: string) => void }) {
  const [q, setQ] = useState("");
  const [cards, setCards] = useState<Array<{ name: string; abilities: string[] }>>([]);
  useEffect(() => {
    if (!q.trim()) { setCards([]); return; }
    const t = setTimeout(async () => {
      const r = await api.get<{ cards: typeof cards }>(`/api/forge/cards?q=${encodeURIComponent(q)}`);
      setCards(r.cards);
    }, 300);
    return () => clearTimeout(t);
  }, [q]);
  return (
    <div className="mt-2 text-xs">
      <input className="input w-full" placeholder="find an ability from a real card — 'create a treasure', 'draw a card'…" value={q} onChange={(e) => setQ(e.target.value)} />
      {cards.length > 0 && (
        <div className="mt-1 max-h-40 overflow-y-auto rounded border border-table-border bg-table-panel2 p-1">
          {cards.slice(0, 10).map((c) => (
            <div key={c.name} className="mb-1">
              <div className="font-semibold text-table-accentSoft">{c.name}</div>
              {c.abilities.map((a, i) => (
                <button key={i} className="block w-full truncate px-1 py-0.5 text-left font-mono hover:bg-table-panel" title={a} onClick={() => onInsert(a)}>+ {a}</button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

// Controlled art panel: art is held in the parent until the card is saved, so you
// can build/position it before ever hitting save. Sources: upload or AI; both
// feed the same in-card position adjuster.
function ArtPanel({ held, setHeld, formComplete, missing, cardName, types, frameTheme }: {
  held: HeldArt | null; setHeld: (h: HeldArt | null) => void;
  formComplete: boolean; missing: string[]; cardName: string; types: string; frameTheme: string;
}) {
  const [styleId, setStyleId] = useState(ART_STYLES[0]!.id);
  const [color, setColor] = useState("");
  const [details, setDetails] = useState("");
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [msg, setMsg] = useState<string | null>(null);
  const [refImage, setRefImage] = useState<string | null>(null);
  useEffect(() => { if (cooldown <= 0) return; const t = setTimeout(() => setCooldown((c) => c - 1), 1000); return () => clearTimeout(t); }, [cooldown]);

  const canGen = formComplete && !!details.trim() && !busy && cooldown === 0;

  async function gen() {
    setBusy(true); setMsg(null);
    try {
      const body: Record<string, unknown> = { styleId, color, details, cardName, types };
      if (refImage) { body.refImageBase64 = refImage; body.refMime = "image/jpeg"; }
      const r = await api.post<{ mime: string; dataBase64: string; prompt: string }>("/api/custom/art/generate", body);
      setHeld({ dataUrl: `data:${r.mime};base64,${r.dataBase64}`, mime: r.mime, tx: IDENTITY_TX, dirty: true, prompt: r.prompt });
      setCooldown(30);
    } catch (e) {
      const er = e as ApiError; setMsg(er.message);
      if (er.status === 429 && /wait/.test(er.message)) setCooldown(30);
    } finally { setBusy(false); }
  }

  async function onUpload(file: File) {
    const dataUrl = await fileToDataUrl(file);
    setHeld({ dataUrl, mime: file.type || "image/jpeg", tx: IDENTITY_TX, dirty: true, prompt: "(uploaded)" });
  }

  return (
    <div className="rounded-md border border-table-border/60 p-3">
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-table-muted">Card art — drag to position, scroll/slider to zoom</div>

      {/* in-card position adjuster (WYSIWYG art window for the chosen frame) */}
      {held ? (
        <ArtAdjuster held={held} aspect={artBoxAspect(frameTheme)} onChange={(tx) => setHeld({ ...held, tx, dirty: true })} onClear={() => setHeld(null)} />
      ) : (
        <div className="mb-2 flex aspect-[7/5] items-center justify-center rounded bg-table-bg text-xs text-table-muted">No art yet — upload or generate below.</div>
      )}

      <div className="mt-2 flex gap-1">
        <label className="chip flex-1 cursor-pointer text-center hover:border-table-accent">
          ⬆ Upload your own
          <input type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && onUpload(e.target.files[0])} />
        </label>
      </div>

      <div className="my-2 border-t border-table-border/50 pt-2 text-[11px] font-semibold uppercase tracking-wide text-table-muted">…or generate with AI</div>
      <div className="mb-2 grid grid-cols-2 gap-1">
        {ART_STYLES.map((s) => (
          <button key={s.id} onClick={() => setStyleId(s.id)}
            className={`rounded border px-2 py-1 text-[11px] ${styleId === s.id ? "border-table-accent bg-table-accent/10 text-table-accentSoft" : "border-table-border hover:bg-table-panel2"}`}
            title={`like ${s.exampleCard}`}>{s.label}</button>
        ))}
      </div>
      <input className="input mb-1 w-full" placeholder="main color (red, blue…)" value={color} onChange={(e) => setColor(e.target.value)} />
      <textarea className="input mb-2 h-16 w-full" placeholder="what's on the card — 'a rogue sneaking down a dark alley with a bloody dagger'" value={details} onChange={(e) => setDetails(e.target.value)} />
      <div className="mb-2 flex items-center gap-2">
        {refImage ? (
          <div className="flex items-center gap-1">
            <img src={refImage} alt="ref" className="h-10 w-8 rounded object-cover" />
            <button className="chip !px-1 text-red-300 hover:border-red-400" onClick={() => setRefImage(null)}>✕ ref</button>
          </div>
        ) : (
          <label className="chip cursor-pointer hover:border-table-accent" title="Give the AI a reference image to build from (uses the multimodal model)">
            🖼 Add reference image
            <input type="file" accept="image/*" className="hidden" onChange={async (e) => e.target.files?.[0] && setRefImage(await fileToDataUrl(e.target.files[0]))} />
          </label>
        )}
      </div>
      <button className="btn-primary w-full" onClick={gen} disabled={!canGen}
        title={!formComplete ? `Fill in: ${missing.join(", ")}` : !details.trim() ? "Describe the art first" : ""}>
        {busy ? "Generating…" : cooldown > 0 ? `Wait ${cooldown}s` : refImage ? "Generate (with reference)" : "Generate art"}
      </button>
      {!formComplete && <div className="mt-1 text-[11px] text-table-muted">Add {missing.join(", ")} to enable AI art.</div>}
      {msg && <div className="mt-1 text-[11px] text-amber-300">{msg}</div>}
    </div>
  );
}

// Pan/zoom the held art inside the card's art window (aspect matches the frame).
// Emits a {scale,dx,dy} transform in the SAME coordinate space the server draws.
function ArtAdjuster({ held, aspect, onChange, onClear }: { held: HeldArt; aspect: number; onChange: (tx: ArtTx) => void; onClear: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const drag = useRef<{ x: number; y: number } | null>(null);
  const BW = 260, BH = Math.round(BW / aspect);
  const { scale, dx, dy } = held.tx;

  useEffect(() => { const im = new Image(); im.onload = () => setImg(im); im.src = held.dataUrl; }, [held.dataUrl]);

  // Clamp a candidate transform so the image always covers the box, then emit.
  function emit(ns: number, ndx: number, ndy: number) {
    ns = Math.max(1, Math.min(6, ns));
    if (img) {
      const s = Math.max(BW / img.width, BH / img.height) * ns;
      const dw = img.width * s, dh = img.height * s;
      let px = (BW - dw) / 2 + ndx * BW; px = Math.min(0, Math.max(BW - dw, px)); ndx = (px - (BW - dw) / 2) / BW;
      let py = (BH - dh) / 2 + ndy * BH; py = Math.min(0, Math.max(BH - dh, py)); ndy = (py - (BH - dh) / 2) / BH;
    }
    onChange({ scale: ns, dx: ndx, dy: ndy });
  }

  useEffect(() => {
    const c = canvasRef.current; if (!c) return;
    const ctx = c.getContext("2d")!; ctx.fillStyle = "#0b0f19"; ctx.fillRect(0, 0, BW, BH);
    if (!img) return;
    const s = Math.max(BW / img.width, BH / img.height) * Math.max(1, scale);
    const dw = img.width * s, dh = img.height * s;
    let px = (BW - dw) / 2 + dx * BW; px = Math.min(0, Math.max(BW - dw, px));
    let py = (BH - dh) / 2 + dy * BH; py = Math.min(0, Math.max(BH - dh, py));
    ctx.drawImage(img, px, py, dw, dh);
  }, [img, scale, dx, dy, BW, BH]);

  return (
    <div>
      <canvas ref={canvasRef} width={BW} height={BH} style={{ width: BW, height: BH, cursor: "grab", touchAction: "none" }}
        className="mx-auto rounded border border-table-border"
        onPointerDown={(e) => { drag.current = { x: e.clientX, y: e.clientY }; (e.target as HTMLElement).setPointerCapture(e.pointerId); }}
        onPointerMove={(e) => { if (!drag.current) return; emit(scale, dx + (e.clientX - drag.current.x) / BW, dy + (e.clientY - drag.current.y) / BH); drag.current = { x: e.clientX, y: e.clientY }; }}
        onPointerUp={() => (drag.current = null)}
        onWheel={(e) => emit(scale * (e.deltaY < 0 ? 1.08 : 0.93), dx, dy)}
      />
      <div className="mt-1 flex items-center gap-2 text-xs">
        <span>Zoom</span>
        <input type="range" min={1} max={6} step={0.02} value={scale} onChange={(e) => emit(Number(e.target.value), dx, dy)} className="flex-1" />
        <button className="chip !px-1.5 text-red-300 hover:border-red-400" onClick={onClear} title="Remove art">✕</button>
      </div>
    </div>
  );
}
