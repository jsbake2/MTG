import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { GameObject, PlayerState, TableState } from "@mtg/shared";
import type { TableConn } from "@/game/useTable";
import { CardImage } from "@/components/CardTile";
import { Avatar } from "@/components/Avatar";
import { useSettings } from "@/store/settings";
import { DiceRoller, RollOverlay, TokenPicker, ZoneBrowserModal } from "@/pages/Table";

// Purely-manual virtual tabletop. No automation: players drag cards anywhere, tap,
// add counters, track life, make tokens, and take notes — like an in-person game.
// Everything rides on the same GameActions the engine already supports (move_card
// with x/y, tap, add_counter, flip, adjust_life, create_token, keyword_action…).

const GRID = 12; // snap granularity
const snap = (n: number) => Math.round(n / GRID) * GRID;

// A drag can carry a whole stack (all ids at one position move together).
interface DragState {
  ids: string[];
  offsetX: number;
  offsetY: number;
  x: number;
  y: number;
}

interface Pile {
  key: string;
  seat: number;
  x: number;
  y: number;
  cards: GameObject[]; // bottom -> top
}

export function FreeformBoard({ t, state }: { t: TableConn; state: TableState }) {
  const you = t.you;
  const me = state.players.find((p) => p.seat === you) ?? null;
  const opponents = state.players.filter((p) => p.seat !== you);
  const matRef = useRef<HTMLDivElement>(null);
  const { handCardWidth, setHandCardWidth } = useSettings();
  const [drag, setDrag] = useState<DragState | null>(null);
  const [handDrag, setHandDrag] = useState<{ id: string; cardId: string | null; name: string; x: number; y: number } | null>(null);
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [hover, setHover] = useState<{ id: string; name: string } | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [tokenOpen, setTokenOpen] = useState(false);
  const [browse, setBrowse] = useState<{ zoneId: string; title: string } | null>(null);
  const [notesOpen, setNotesOpen] = useState(false);
  const [chatText, setChatText] = useState("");

  // FIXED mat card size — positions (x/y) are shared between players, so the card
  // size must be identical on every screen or the board looks different for each
  // player. The scalable size lives on the hand instead (that's personal/local).
  const CARD_W = 108;
  const CARD_H = Math.round((CARD_W * 88) / 63);

  const objectsByZone = useMemo(() => {
    const map: Record<string, GameObject[]> = {};
    for (const o of Object.values(state.objects)) {
      const key = o.zone === "battlefield" ? `battlefield:${o.controllerSeat}` : `${o.zone}:${o.ownerSeat}`;
      (map[key] ??= []).push(o);
    }
    return map;
  }, [state.objects]);

  const myHand = you !== null ? ((t.hands[you] ?? []).map((id) => state.objects[id]).filter(Boolean) as GameObject[]) : [];

  // Smart stacking: permanents sharing a position (same seat + x + y) render as one
  // pile with a count. Dropping a card onto another snaps them together.
  const piles = useMemo<Pile[]>(() => {
    const map = new Map<string, Pile>();
    const order: string[] = [];
    for (const o of Object.values(state.objects)) {
      if (o.zone !== "battlefield") continue;
      const gx = o.x || 0;
      const gy = o.y || 0;
      const key = `${o.controllerSeat}:${gx}:${gy}`;
      let g = map.get(key);
      if (!g) {
        g = { key, seat: o.controllerSeat, x: gx, y: gy, cards: [] };
        map.set(key, g);
        order.push(key);
      }
      g.cards.push(o);
    }
    return order.map((k) => map.get(k)!);
  }, [state.objects]);

  // Latest values for the drag listeners (avoids stale closures).
  const env = useRef({ piles, CARD_W, CARD_H, you });
  env.current = { piles, CARD_W, CARD_H, you };

  function matPoint(e: { clientX: number; clientY: number }): { x: number; y: number } {
    const r = matRef.current?.getBoundingClientRect();
    return { x: e.clientX - (r?.left ?? 0), y: e.clientY - (r?.top ?? 0) };
  }
  // Start dragging one card or a whole pile. originX/Y = the group's current spot.
  function startDrag(ids: string[], originX: number, originY: number, e: React.PointerEvent) {
    if (you === null) return;
    e.preventDefault();
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    const p = matPoint(e);
    setExpanded(null);
    setDrag({ ids, offsetX: p.x - originX, offsetY: p.y - originY, x: originX, y: originY });
  }
  useEffect(() => {
    if (!drag) return;
    const move = (e: PointerEvent) => {
      const p = matPoint(e);
      setDrag((d) => (d ? { ...d, x: p.x - d.offsetX, y: p.y - d.offsetY } : d));
    };
    const up = () => {
      setDrag((d) => {
        if (d) {
          const { piles: pl, CARD_W: cw, CARD_H: ch, you: me } = env.current;
          let tx = Math.max(0, snap(d.x));
          let ty = Math.max(0, snap(d.y));
          // Snap onto a nearby pile (not one we're dragging) → stack them.
          for (const target of pl) {
            if (target.cards.some((c) => d.ids.includes(c.id))) continue;
            if (Math.abs(target.x - d.x) < cw * 0.6 && Math.abs(target.y - d.y) < ch * 0.5) {
              tx = target.x;
              ty = target.y;
              break;
            }
          }
          for (const id of d.ids) t.send({ type: "move_card", objectId: id, toZone: "battlefield", toSeat: me ?? undefined, x: tx, y: ty });
        }
        return null;
      });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [drag]);

  // Play a card from hand onto your side of the mat (cascade so they don't stack).
  function playFromHand(o: GameObject) {
    const mine = Object.values(state.objects).filter((b) => b.zone === "battlefield" && b.controllerSeat === you).length;
    const x = 80 + (mine % 8) * Math.round(CARD_W * 1.1);
    const y = 380 + Math.floor(mine / 8) * 44;
    t.send({ type: "move_card", objectId: o.id, toZone: "battlefield", toSeat: you ?? undefined, x, y });
  }

  // Drag a card out of your hand and drop it anywhere on the mat.
  function onHandPointerDown(o: GameObject, e: React.PointerEvent) {
    if (you === null) return;
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    setHandDrag({ id: o.id, cardId: o.cardId, name: o.name, x: e.clientX, y: e.clientY });
  }
  useEffect(() => {
    if (!handDrag) return;
    const move = (e: PointerEvent) => setHandDrag((d) => (d ? { ...d, x: e.clientX, y: e.clientY } : d));
    const up = (e: PointerEvent) => {
      setHandDrag((d) => {
        if (d && you !== null) {
          const r = matRef.current?.getBoundingClientRect();
          const overMat = r && e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
          if (overMat && r) {
            const x = Math.max(0, snap(e.clientX - r.left - CARD_W / 2));
            const y = Math.max(0, snap(e.clientY - r.top - CARD_H / 2));
            t.send({ type: "move_card", objectId: d.id, toZone: "battlefield", toSeat: you, x, y });
          } else {
            const o = state.objects[d.id];
            if (o) playFromHand(o); // released off the mat → default cascade spot
          }
        }
        return null;
      });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [handDrag, you]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-table-bg">
      {/* Top bar */}
      <div className="flex shrink-0 items-center gap-2 border-b border-table-border bg-table-panel px-3 py-1.5 text-sm">
        <Link to="/play" className="text-table-muted hover:text-table-ink">← Leave</Link>
        <span className={`h-2 w-2 rounded-full ${t.connected ? "bg-green-400" : "bg-red-500"}`} />
        <span className="font-display text-table-accentSoft">{state.name}</span>
        <span className="chip">🃏 Tabletop (manual)</span>
        {state.status === "finished" && (
          <span className="rounded bg-table-accent px-2 py-0.5 text-black">{state.players.find((p) => p.seat === state.winnerSeat)?.name} wins!</span>
        )}
        <div className="ml-auto flex items-center gap-1">
          {me && <LifeWidget p={me} t={t} you={you!} />}
          {opponents.map((p) => (
            <LifeWidget key={p.seat} p={p} t={t} you={you} compact />
          ))}
          <button className="btn-ghost !py-1" onClick={() => setTokenOpen(true)}>＋ Token</button>
          {you !== null && <DiceRoller t={t} seat={you} />}
          {you !== null && <button className="btn-ghost !py-1" onClick={() => t.send({ type: "draw", seat: you, count: 1 })}>🃏 Draw</button>}
          <button className={`btn-ghost !py-1 ${notesOpen ? "text-table-accentSoft" : ""}`} onClick={() => setNotesOpen((v) => !v)}>📝 Notes</button>
          <button className="btn-ghost !py-1" onClick={() => t.undo()}>Undo</button>
          {you !== null && state.status !== "finished" && (
            <button className="btn-ghost !py-1 text-red-300 hover:border-red-400" onClick={() => { if (confirm("Resign this game?")) t.send({ type: "concede", seat: you }); }}>
              Resign
            </button>
          )}
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* The mat */}
        <div className="relative min-h-0 flex-1 overflow-auto">
          <div ref={matRef} className="freeform-felt relative" style={{ minWidth: 1200, minHeight: 760, height: "100%" }} onClick={() => setExpanded(null)}>
            {/* subtle midline between your side and the opponents' */}
            <div className="pointer-events-none absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-table-accent/25" />

            {piles.map((pile) => {
              const dragging = !!drag && pile.cards.some((c) => drag.ids.includes(c.id));
              const x = dragging ? drag!.x : pile.x;
              const y = dragging ? drag!.y : pile.y;
              const mine = you !== null && pile.seat === you;
              const top = pile.cards[pile.cards.length - 1]!;
              const count = pile.cards.length;
              const isExpanded = expanded === pile.key && count > 1 && !dragging;
              return (
                <div
                  key={pile.key}
                  className={`absolute ${mine ? "cursor-grab active:cursor-grabbing" : "cursor-pointer"} ${dragging ? "z-30" : isExpanded ? "z-20" : ""}`}
                  style={{ left: x, top: y, width: CARD_W, transition: dragging ? "none" : "left 0.08s, top 0.08s" }}
                  onPointerDown={(e) => mine && startDrag(pile.cards.map((c) => c.id), pile.x, pile.y, e)}
                  onClick={(e) => { e.stopPropagation(); if (count === 1) setMenu({ id: top.id, x: e.clientX, y: e.clientY }); else setExpanded(isExpanded ? null : pile.key); }}
                  onMouseEnter={() => { if (count > 1) setExpanded(pile.key); if (top.cardId && !top.faceDown) setHover({ id: top.cardId, name: top.name }); }}
                  onMouseLeave={() => setHover(null)}
                >
                  {/* depth shadows for a stack */}
                  {count > 1 && <div className="absolute rounded-md bg-black/40 shadow-card" style={{ width: CARD_W, height: CARD_H, left: 5, top: 5 }} />}
                  {count > 2 && <div className="absolute rounded-md bg-black/30 shadow-card" style={{ width: CARD_W, height: CARD_H, left: 2.5, top: 2.5 }} />}
                  <CardFace o={top} w={CARD_W} h={CARD_H} />
                  {count > 1 && (
                    <span className="absolute -right-1.5 -top-1.5 z-10 flex h-6 min-w-6 items-center justify-center rounded-full border border-black/50 bg-table-accent px-1 text-xs font-bold text-black shadow">
                      ×{count}
                    </span>
                  )}

                  {/* Hover/click to fan the stack out into a readable row. */}
                  {isExpanded && (
                    <div
                      className="absolute z-40 flex gap-1 rounded-lg border border-table-border bg-table-panel/95 p-1.5 shadow-panel"
                      style={{ left: 0, top: -(CARD_H * 0.62), transform: "translateY(-8px)" }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      {pile.cards.map((c) => (
                        <div
                          key={c.id}
                          className={`${mine ? "cursor-grab active:cursor-grabbing" : "cursor-pointer"}`}
                          style={{ width: CARD_W * 0.9 }}
                          onPointerDown={(e) => mine && startDrag([c.id], pile.x, pile.y, e)}
                          onClick={(e) => { e.stopPropagation(); setMenu({ id: c.id, x: e.clientX, y: e.clientY }); }}
                          onMouseEnter={() => c.cardId && !c.faceDown && setHover({ id: c.cardId, name: c.name })}
                        >
                          <CardFace o={c} w={CARD_W * 0.9} h={CARD_H * 0.9} />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Right rail: zones + log */}
        <div className="hidden w-52 shrink-0 flex-col border-l border-table-border bg-table-panel md:flex">
          {you !== null && (
            <div className="grid grid-cols-2 gap-1 border-b border-table-border p-2 text-xs">
              <PileButton label="Library" count={(objectsByZone[`library:${you}`] ?? []).length} onClick={() => setBrowse({ zoneId: `library:${you}`, title: "Your Library" })} />
              <button className="chip" onClick={() => t.send({ type: "draw", seat: you, count: 1 })}>Draw</button>
              <PileButton label="Graveyard" count={(objectsByZone[`graveyard:${you}`] ?? []).length} onClick={() => setBrowse({ zoneId: `graveyard:${you}`, title: "Your Graveyard" })} />
              <PileButton label="Exile" count={(objectsByZone[`exile:${you}`] ?? []).length} onClick={() => setBrowse({ zoneId: `exile:${you}`, title: "Your Exile" })} />
              <button className="chip" onClick={() => t.send({ type: "shuffle", seat: you })}>Shuffle</button>
              <button className="chip" onClick={() => t.send({ type: "untap_all", seat: you })}>Untap all</button>
            </div>
          )}
          <div className="min-h-0 flex-1 overflow-y-auto p-2 text-xs">
            {state.log.slice(-120).map((l) => (
              <div key={l.id} className="mb-0.5 leading-snug text-table-muted">{l.text}</div>
            ))}
          </div>
          <form
            className="flex gap-1 border-t border-table-border p-2"
            onSubmit={(e) => { e.preventDefault(); if (chatText.trim()) t.chat(chatText.trim()); setChatText(""); }}
          >
            <input className="input flex-1 !py-1" placeholder="Say something…" value={chatText} onChange={(e) => setChatText(e.target.value)} />
            <button className="btn-ghost">Send</button>
          </form>
        </div>
      </div>

      {/* Your hand — drag cards onto the table, or click to play. Card size here is
          personal (local) and doesn't affect anyone else's view. */}
      {you !== null && (
        <div className="shrink-0 border-t border-table-border bg-table-panel px-3 py-2">
          <div className="mb-1 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-table-muted">
            <span>Your hand ({myHand.length}) — drag onto the table, or click</span>
            <button className="chip normal-case" onClick={() => you !== null && t.send({ type: "draw", seat: you, count: 1 })}>🃏 Draw</button>
            <label className="ml-auto flex items-center gap-1 normal-case" title="Hand card size (only affects your screen)">
              🔍
              <input type="range" min={80} max={240} step={6} value={handCardWidth} onChange={(e) => setHandCardWidth(Number(e.target.value))} className="w-28 accent-table-accent" />
            </label>
          </div>
          <div className="flex items-end gap-1.5 overflow-x-auto pb-1">
            {myHand.map((o) => (
              <div
                key={o.id}
                className="shrink-0 cursor-grab touch-none transition-transform hover:-translate-y-1.5 active:cursor-grabbing"
                style={{ width: handCardWidth, opacity: handDrag?.id === o.id ? 0.4 : 1 }}
                onPointerDown={(e) => onHandPointerDown(o, e)}
                onMouseEnter={() => o.cardId && setHover({ id: o.cardId, name: o.name })}
                onMouseLeave={() => setHover(null)}
                title={`Drag to play ${o.name}`}
              >
                <CardImage id={o.cardId} name={o.name} />
              </div>
            ))}
            {myHand.length === 0 && <div className="py-4 text-xs text-table-muted">Empty — use Draw to pull from your library.</div>}
          </div>
        </div>
      )}
      {/* Floating card that follows the cursor while dragging from hand. */}
      {handDrag && (
        <div className="pointer-events-none fixed z-50" style={{ left: handDrag.x - CARD_W / 2, top: handDrag.y - CARD_H / 2, width: CARD_W }}>
          <CardImage id={handDrag.cardId} name={handDrag.name} className="rounded-md shadow-2xl ring-2 ring-table-accent/60" />
        </div>
      )}

      {menu && <FreeformCardMenu menu={menu} state={state} you={you} t={t} onClose={() => setMenu(null)} />}
      {tokenOpen && you !== null && (
        <TokenPicker
          onClose={() => setTokenOpen(false)}
          onPick={(tk) => {
            const num = (v: string | null) => (v ? parseInt(v.replace(/[^0-9-]/g, ""), 10) || undefined : undefined);
            t.send({ type: "create_token", seat: you, name: tk.name, cardId: tk.id, oracleId: null, power: num(tk.power), toughness: num(tk.toughness) });
            setTokenOpen(false);
          }}
        />
      )}
      {browse && (
        <ZoneBrowserModal
          title={browse.title}
          objects={objectsByZone[browse.zoneId] ?? []}
          onClose={() => setBrowse(null)}
          onSelect={(o) => { setBrowse(null); setMenu({ id: o.id, x: window.innerWidth / 2, y: window.innerHeight / 2 }); }}
        />
      )}
      {notesOpen && <Notepad tableId={state.id} onClose={() => setNotesOpen(false)} />}
      <RollOverlay roll={state.lastRoll} />
      {hover && (
        <div className="pointer-events-none fixed bottom-28 left-4 z-40">
          <img src={`/api/cards/${hover.id}/image`} alt={hover.name} className="w-52 rounded-lg shadow-2xl card-aspect" />
        </div>
      )}
    </div>
  );
}

// A single card face on the mat: tap rotation, counters, commander badge.
function CardFace({ o, w, h }: { o: GameObject; w: number; h: number }) {
  return (
    <div className="relative origin-center" style={{ width: w, height: h, transform: o.tapped ? "rotate(90deg)" : "none", transition: "transform 0.12s" }}>
      <CardImage id={o.faceDown ? null : o.cardId} name={o.faceDown ? "Card" : o.name} className="rounded-md shadow-card" />
      {o.counters.length > 0 && (
        <div className="absolute -bottom-1 left-0 flex flex-wrap gap-0.5">
          {o.counters.map((c) => (
            <span key={c.type} className="rounded bg-black/85 px-1 text-[10px] font-bold text-white ring-1 ring-white/30">
              {c.type} {c.count}
            </span>
          ))}
        </div>
      )}
      {o.isCommander && <span className="absolute left-0 top-0 rounded bg-table-accent px-1 text-[9px] text-black">CMD</span>}
    </div>
  );
}

// ---- life ----------------------------------------------------------------
function LifeWidget({ p, t, you, compact }: { p: PlayerState; t: TableConn; you: number | null; compact?: boolean }) {
  const canEdit = you === p.seat;
  return (
    <div className="flex items-center gap-1 rounded-lg bg-table-panel2 px-1.5 py-0.5">
      <Avatar cardId={p.avatarCardId} name={p.name} size={compact ? 22 : 28} />
      {!compact && <span className="text-xs text-table-muted">{p.name}</span>}
      <button className="btn-ghost h-6 w-6 !px-0" onClick={() => t.send({ type: "adjust_life", seat: p.seat, delta: -1 })}>−</button>
      <span className={`life-diamond text-sm font-bold text-white ${p.life <= 5 ? "border-red-500" : ""}`} style={{ width: 34, height: 34 }}>
        <span>{p.life}</span>
      </span>
      <button className="btn-ghost h-6 w-6 !px-0" onClick={() => t.send({ type: "adjust_life", seat: p.seat, delta: 1 })}>+</button>
      {canEdit && p.poison > 0 && <span className="chip text-green-300">☠{p.poison}</span>}
    </div>
  );
}

function PileButton({ label, count, onClick }: { label: string; count: number; onClick: () => void }) {
  return (
    <button className="chip flex items-center justify-between hover:border-table-accent" onClick={onClick}>
      <span>{label}</span>
      <span className="tabular-nums text-table-accentSoft">{count}</span>
    </button>
  );
}

// ---- per-card manual menu -------------------------------------------------
function FreeformCardMenu({ menu, state, you, t, onClose }: { menu: { id: string; x: number; y: number }; state: TableState; you: number | null; t: TableConn; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    window.addEventListener("mousedown", h);
    return () => window.removeEventListener("mousedown", h);
  }, [onClose]);
  const o = state.objects[menu.id];
  if (!o) return null;
  const mine = you !== null && o.controllerSeat === you;
  const act = (fn: () => void) => () => { fn(); onClose(); };
  const move = (zone: GameObject["zone"], toTop?: boolean) => t.send({ type: "move_card", objectId: o.id, toZone: zone, toSeat: o.ownerSeat, toTop });
  const Item = ({ label, onClick, danger }: { label: string; onClick: () => void; danger?: boolean }) => (
    <button className={`block w-full px-3 py-1.5 text-left text-sm hover:bg-table-panel2 ${danger ? "text-red-300" : ""}`} onClick={act(onClick)}>{label}</button>
  );
  const style: React.CSSProperties = { left: Math.min(menu.x, window.innerWidth - 210), top: Math.min(menu.y, window.innerHeight - 340) };
  return (
    <div ref={ref} className="panel fixed z-50 w-52 overflow-hidden py-1" style={style}>
      <div className="truncate border-b border-table-border px-3 py-1 text-xs text-table-muted">{o.name}{!mine && <span className="ml-1 text-amber-300/80">· opponent's</span>}</div>
      <Item label={o.tapped ? "Untap" : "Tap"} onClick={() => t.send({ type: "tap", objectId: o.id, tapped: !o.tapped })} />
      <Item label="Flip face down/up" onClick={() => t.send({ type: "flip", objectId: o.id, faceDown: !o.faceDown })} />
      <div className="my-1 border-t border-table-border" />
      <Item label="＋ +1/+1 counter" onClick={() => t.send({ type: "add_counter", objectId: o.id, counterType: "+1/+1", delta: 1 })} />
      <Item label="－ +1/+1 counter" onClick={() => t.send({ type: "add_counter", objectId: o.id, counterType: "+1/+1", delta: -1 })} />
      <Item label="＋ -1/-1 counter" onClick={() => t.send({ type: "add_counter", objectId: o.id, counterType: "-1/-1", delta: 1 })} />
      <Item label="＋ loyalty" onClick={() => t.send({ type: "add_counter", objectId: o.id, counterType: "loyalty", delta: 1 })} />
      <div className="my-1 border-t border-table-border" />
      <Item label="→ Hand" onClick={() => move("hand")} />
      <Item label="→ Graveyard" onClick={() => move("graveyard")} danger />
      <Item label="→ Exile" onClick={() => move("exile")} />
      <Item label="→ Library (top)" onClick={() => move("library", true)} />
      <Item label="→ Library (bottom)" onClick={() => move("library", false)} />
    </div>
  );
}

// ---- per-player notepad (local, persists per table) -----------------------
function Notepad({ tableId, onClose }: { tableId: string; onClose: () => void }) {
  const key = `mtg-notes-${tableId}`;
  const [text, setText] = useState(() => localStorage.getItem(key) ?? "");
  useEffect(() => {
    const id = setTimeout(() => localStorage.setItem(key, text), 300);
    return () => clearTimeout(id);
  }, [text, key]);
  return (
    <div className="fixed bottom-24 right-4 z-40 w-72 rounded-lg border border-table-border bg-table-panel shadow-panel">
      <div className="flex items-center gap-2 border-b border-table-border px-3 py-1.5 text-sm">
        <span className="font-semibold text-table-accentSoft">📝 Notes</span>
        <span className="text-[10px] text-table-muted">private · saved on this device</span>
        <button className="ml-auto text-table-muted hover:text-red-300" onClick={onClose}>✕</button>
      </div>
      <textarea
        className="input h-48 w-full resize-none rounded-t-none border-0 text-sm"
        placeholder="Life totals, triggers to remember, turn order, house rules…"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
    </div>
  );
}
