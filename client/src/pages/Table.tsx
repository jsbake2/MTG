import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { Ability, CardDetailResponse, Deck, EffectMode, GameObject, PlayerState, RollResult, TableState, ZoneId } from "@mtg/shared";
import { TURN_STEPS, compileEffects, parseAbilities } from "@mtg/shared";
import { api } from "@/api/client";
import { useAuth } from "@/store/auth";
import { useTable, type TableConn } from "@/game/useTable";
import { CardImage } from "@/components/CardTile";
import { Avatar } from "@/components/Avatar";
import { useSettings } from "@/store/settings";
import { playRoll, playTurnChime, playWarning, unlockAudio } from "@/lib/sound";
import { MANA_HEX, MANA_FG } from "@/lib/mana";

const STEP_LABELS: Record<string, string> = {
  untap: "Untap",
  upkeep: "Upkeep",
  draw: "Draw",
  main1: "Main 1",
  begin_combat: "Combat",
  declare_attackers: "Attackers",
  declare_blockers: "Blockers",
  combat_damage: "Damage",
  end_combat: "End Combat",
  main2: "Main 2",
  end: "End",
  cleanup: "Cleanup",
};

export function TablePage() {
  const { id = "" } = useParams();
  const t = useTable(id);
  if (t.state) return <GameBoard t={t} state={t.state} />;
  return <Lobby t={t} />;
}

// ---- Lobby --------------------------------------------------------------
function Lobby({ t }: { t: TableConn }) {
  const { user } = useAuth();
  const [decks, setDecks] = useState<Deck[]>([]);
  const [precons, setPrecons] = useState<Deck[]>([]);
  const [deckId, setDeckId] = useState<string | null>(null);
  const [onlyStarred, setOnlyStarred] = useState(false);

  const lobby = t.lobby;

  useEffect(() => {
    if (!lobby) return;
    Promise.all([
      api.get<{ decks: Deck[] }>("/api/decks"),
      api.get<{ decks: Deck[] }>("/api/decks/public"),
    ]).then(([mine, pub]) => {
      setDecks(mine.decks);
      setPrecons(pub.decks);
      
      const allowed = lobby.formatId;
      const validMine = mine.decks.filter(d => allowed === "house" || d.formatId === allowed);
      const hasStarred = validMine.some(d => d.isStarred);
      if (hasStarred) {
        setOnlyStarred(true);
        const firstStarred = validMine.find(d => d.isStarred);
        if (firstStarred) setDeckId(firstStarred.id);
      } else {
        setOnlyStarred(false);
        if (validMine[0]) setDeckId(validMine[0].id);
      }
    });
  }, [lobby?.formatId]);
  if (!lobby) return <div className="p-8 text-center text-table-muted">Connecting to table…</div>;

  const isHost = lobby.hostUserId === user?.id;
  const seatByIndex = (i: number) => lobby.seats.find((s) => s.seat === i);

  const allowedFormat = lobby.formatId;
  const filteredDecks = decks
    .filter((d) => allowedFormat === "house" || d.formatId === allowedFormat)
    .filter((d) => !onlyStarred || d.isStarred);
  const filteredPrecons = precons
    .filter((d) => allowedFormat === "house" || d.formatId === allowedFormat)
    .filter((d) => !onlyStarred || d.isStarred);

  return (
    <div className="mx-auto max-w-2xl p-4">
      <div className="mb-3 flex items-center justify-between">
        <h1 className="font-display text-2xl text-table-accentSoft">{lobby.name}</h1>
        <Link to="/play" className="btn-ghost">
          ← Lobby
        </Link>
      </div>
      <div className="panel p-4">
        <div className="mb-3 text-sm text-table-muted">
          Format: <b className="text-table-ink">{lobby.formatId}</b> · pick your seat and deck.
        </div>
        <div className="mb-1 flex items-center justify-between">
          <label className="text-sm font-semibold">Your deck</label>
          {decks.some((d) => (lobby.formatId === "house" || d.formatId === lobby.formatId) && d.isStarred) && (
            <label className="flex items-center gap-1.5 text-xs text-table-muted cursor-pointer select-none">
              <input
                type="checkbox"
                checked={onlyStarred}
                onChange={(e) => setOnlyStarred(e.target.checked)}
              />
              Show only favorites (★)
            </label>
          )}
        </div>
        <label className="mb-3 block text-sm">
          <select className="input mt-1 w-full" value={deckId ?? ""} onChange={(e) => setDeckId(e.target.value || null)}>
            <option value="">— none (spectate / empty) —</option>
            {filteredDecks.length > 0 && (
              <optgroup label="My decks">
                {filteredDecks.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name} ({d.formatId}, {d.cardCount})
                  </option>
                ))}
              </optgroup>
            )}
            {filteredPrecons.length > 0 && (
              <optgroup label="Preconstructed decks">
                {filteredPrecons.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name} ({d.formatId}, {d.cardCount})
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        </label>
        <div className="grid grid-cols-2 gap-2">
          {Array.from({ length: lobby.maxPlayers }, (_, i) => {
            const occupant = seatByIndex(i);
            const mine = lobby.you === i;
            return (
              <button
                key={i}
                className={`rounded-md border p-3 text-left text-sm ${mine ? "border-table-accent bg-table-accent/10" : "border-table-border bg-table-panel2"}`}
                onClick={() => t.takeSeat(i, deckId)}
              >
                <div className="text-xs text-table-muted">Seat {i + 1}</div>
                <div className="flex items-center gap-2">
                  {occupant && <Avatar cardId={occupant.avatarCardId} name={occupant.name} size={28} />}
                  <span className="font-semibold">{occupant ? occupant.name : "— empty —"}</span>
                </div>
              </button>
            );
          })}
        </div>
        <div className="mt-4 flex items-center gap-2">
          {lobby.you !== null && (
            <button className="btn-ghost" onClick={() => t.leaveSeat()}>
              Leave seat
            </button>
          )}
          {isHost ? (
            <button className="btn-primary ml-auto" onClick={() => t.start()} disabled={lobby.seats.length < 1}>
              Start game
            </button>
          ) : (
            <span className="ml-auto text-sm text-table-muted">Waiting for host to start…</span>
          )}
        </div>
      </div>
      {t.error && <div className="mt-3 whitespace-pre-line rounded bg-red-900/40 px-3 py-2 text-sm text-red-200">{t.error}</div>}
    </div>
  );
}

// ---- Game board ---------------------------------------------------------
interface Selection {
  objectId: string;
  x: number;
  y: number;
}

function GameBoard({ t, state }: { t: TableConn; state: TableState }) {
  const you = t.you;
  const me = state.players.find((p) => p.seat === you) ?? null;
  const opponents = state.players.filter((p) => p.seat !== you);
  const [sel, setSel] = useState<Selection | null>(null);
  const [chatText, setChatText] = useState("");
  const [tokenOpen, setTokenOpen] = useState(false);
  const [targeting, setTargeting] = useState<{ name: string; specs: { kind: string; label: string }[]; collected: string[]; send: (targets: string[]) => void } | null>(null);
  const [modePicker, setModePicker] = useState<{ objectId: string; name: string; modes: EffectMode[] } | null>(null);
  const [hoveredCard, setHoveredCard] = useState<{ id: string; name: string; x: number; y: number } | null>(null);
  const [browseZone, setBrowseZone] = useState<{ zoneId: string; title: string } | null>(null);

  const handleHover = (card: { id: string; name: string } | null, e?: React.MouseEvent) => {
    if (!card || !e) {
      setHoveredCard(null);
    } else {
      setHoveredCard({ id: card.id, name: card.name, x: e.clientX, y: e.clientY });
    }
  };

  // Generic targeting: collect N targets then fire `send`.
  function beginTargeting(name: string, specs: { kind: string; label: string }[], send: (targets: string[]) => void) {
    if (specs.length === 0) send([]);
    else setTargeting({ name, specs, collected: [], send });
  }
  function startCast(objectId: string, name: string, specs: { kind: string; label: string }[], mode?: number, x?: number) {
    beginTargeting(name, specs, (targets) => t.send({ type: "cast", objectId, targets, mode, x }));
  }
  function activateAbility(o: GameObject, abilityIndex: number, name: string, specs: { kind: string; label: string }[], x?: number) {
    beginTargeting(name, specs, (targets) => t.send({ type: "activate", objectId: o.id, abilityIndex, targets, x }));
  }
  async function beginCast(o: GameObject) {
    if (!o.cardId) {
      t.send({ type: "cast", objectId: o.id });
      return;
    }
    try {
      const detail = await api.get<CardDetailResponse>(`/api/cards/${o.cardId}`);
      const comp = compileEffects(detail.card.oracleText, detail.card.name);
      if (comp.modes && comp.modes.length > 0) {
        setModePicker({ objectId: o.id, name: o.name, modes: comp.modes });
        return;
      }
      let x: number | undefined;
      const needsX = comp.ops.some((op) => (op as { xScaled?: boolean }).xScaled) || /\{X\}/.test(detail.card.manaCost ?? "");
      if (needsX) x = Math.max(0, Math.floor(Number(prompt(`Choose X for ${o.name}:`, "0")) || 0));
      startCast(o.id, o.name, comp.targets, undefined, x);
    } catch {
      t.send({ type: "cast", objectId: o.id });
    }
  }
  function addTarget(id: string) {
    setTargeting((cur) => {
      if (!cur) return cur;
      const collected = [...cur.collected, id];
      if (collected.length >= cur.specs.length) {
        cur.send(collected);
        return null;
      }
      return { ...cur, collected };
    });
  }
  async function onActivate(o: GameObject, abilityIndex: number, targets: { kind: string; label: string }[], usesX: boolean) {
    let x: number | undefined;
    if (usesX) x = Math.max(0, Math.floor(Number(prompt(`Choose X for ${o.name}:`, "0")) || 0));
    activateAbility(o, abilityIndex, o.name, targets, x);
  }
  function clickObject(o: GameObject, e: React.MouseEvent) {
    if (targeting) addTarget(o.id);
    else setSel({ objectId: o.id, x: e.clientX, y: e.clientY });
  }

  const objectsByZone = useMemo(() => {
    const map: Record<string, GameObject[]> = {};
    for (const o of Object.values(state.objects)) {
      const key = o.zone === "battlefield" ? `battlefield:${o.controllerSeat}` : `${o.zone}:${o.ownerSeat}`;
      (map[key] ??= []).push(o);
    }
    return map;
  }, [state.objects]);

  const myHand = you !== null ? (objectsByZone[`hand:${you}`] ?? []) : [];
  const isActive = you === state.activeSeat;
  const hasPriority = you === state.prioritySeat;

  const { sound, turnLimitSeconds, setTurnLimit } = useSettings();
  // Chime when it becomes your turn.
  const prevActiveSeat = useRef(state.activeSeat);
  useEffect(() => {
    if (state.activeSeat !== prevActiveSeat.current) {
      prevActiveSeat.current = state.activeSeat;
      if (sound && you !== null && state.activeSeat === you && state.status === "playing") playTurnChime();
    }
  }, [state.activeSeat, you, sound, state.status]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-table-bg">
      {/* Top bar */}
      <div className="flex shrink-0 items-center gap-2 border-b border-table-border bg-table-panel px-3 py-1.5 text-sm">
        <Link to="/play" className="text-table-muted hover:text-table-ink">
          ← Leave
        </Link>
        <span className={`h-2 w-2 rounded-full ${t.connected ? "bg-green-400" : "bg-red-500"}`} />
        <span className="font-display text-table-accentSoft">{state.name}</span>
        <span className="text-table-muted">
          Turn {state.turnNumber} · {STEP_LABELS[state.step]}
        </span>
        <TurnTimer startedAt={state.turnStartedAt} limit={turnLimitSeconds} isMine={isActive} sound={sound} />
        <span className="text-xs text-table-muted">{state.players.find((p) => p.seat === state.activeSeat)?.name}'s turn</span>
        <span className="rounded bg-table-panel2 border border-table-border/60 px-2 py-0.5 text-xs text-table-muted flex items-center gap-1.5 ml-2">
          <span className="h-1.5 w-1.5 rounded-full bg-table-accent animate-pulse" />
          Priority: <span className="font-semibold text-table-accentSoft">{state.players.find((p) => p.seat === state.prioritySeat)?.name}</span>
        </span>
        {state.status === "finished" && (
          <span className="rounded bg-table-accent px-2 py-0.5 text-black">
            {state.players.find((p) => p.seat === state.winnerSeat)?.name} wins!
          </span>
        )}
        <div className="ml-auto flex items-center gap-1">
          <button className="btn-ghost" onClick={() => t.raw({ type: "action", action: { type: "roll_first" } })} title="Roll a d20 for each player; highest goes first">
            🎲 Who's first
          </button>
          <button className="btn-ghost" onClick={() => t.undo()}>
            Undo
          </button>
          <select className="input !py-1" value={turnLimitSeconds} onChange={(e) => setTurnLimit(Number(e.target.value))} title="Turn timer limit">
            <option value={0}>No timer</option>
            <option value={60}>1 min</option>
            <option value={120}>2 min</option>
            <option value={300}>5 min</option>
          </select>
          <select
            className="input !py-1"
            value={state.enforcement}
            onChange={(e) => t.send({ type: "set_enforcement", level: e.target.value as "relaxed" | "strict" })}
          >
            <option value="relaxed">Relaxed</option>
            <option value="strict">Strict</option>
          </select>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* Main play area */}
        <div className="mtg-table flex min-h-0 flex-1 flex-col overflow-y-auto p-2">
          {/* Opponents */}
          <div className="mb-2 grid gap-2" style={{ gridTemplateColumns: `repeat(${Math.max(1, opponents.length)}, minmax(0, 1fr))` }}>
            {opponents.map((p) => (
              <PlayerStrip
                key={p.seat}
                p={p}
                state={state}
                you={you}
                t={t}
                objectsByZone={objectsByZone}
                onSelect={(s) => (targeting ? addTarget(s.objectId) : setSel(s))}
                onBrowse={(zoneId, title) => setBrowseZone({ zoneId, title })}
                onHover={handleHover}
                targeting={!!targeting}
                onTargetPlayer={() => addTarget(`seat:${p.seat}`)}
              />
            ))}
          </div>

          {/* Shared stack */}
          {state.stackOrder.length > 0 && (
            <div className="mb-2 rounded-lg border border-table-accent/40 bg-table-panel2 p-2">
              <div className="mb-1 text-xs uppercase tracking-wide text-table-accentSoft">Stack (top last)</div>
              <div className="flex gap-1 overflow-x-auto">
                {state.stackOrder.map((oid) => {
                  const o = state.objects[oid];
                  return o ? <MiniCard key={oid} o={o} onClick={(e) => (targeting ? addTarget(oid) : setSel({ objectId: oid, x: e.clientX, y: e.clientY }))} onHover={handleHover} /> : null;
                })}
              </div>
            </div>
          )}

          {/* The red battle-line between opponents and you (MTG 2015 style). */}
          <div className="battle-line my-2 shrink-0" />

          {/* My battlefield */}
          {you !== null && (
            <div className="relative">
              {state.prioritySeat === you && (
                <div className="absolute right-2 top-2 z-10 animate-pulse rounded bg-table-accent/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-table-accentSoft border border-table-accent/40 backdrop-blur-sm">Your Priority</div>
              )}
              <BattlefieldRow
                title="Your battlefield"
                objects={objectsByZone[`battlefield:${you}`] ?? []}
                onSelect={clickObject}
                onHover={handleHover}
                highlight
              />
            </div>
          )}
        </div>

        {/* Log / chat sidebar */}
        <div className="hidden w-64 shrink-0 flex-col border-l border-table-border bg-table-panel md:flex">
          <div className="min-h-0 flex-1 overflow-y-auto p-2 text-xs">
            {state.log.map((l) => (
              <div key={l.id} className={logClass(l.kind)}>
                {l.text}
              </div>
            ))}
          </div>
          <form
            className="flex gap-1 border-t border-table-border p-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (chatText.trim()) t.chat(chatText.trim());
              setChatText("");
            }}
          >
            <input className="input flex-1 !py-1" placeholder="Say something…" value={chatText} onChange={(e) => setChatText(e.target.value)} />
            <button className="btn-ghost">Send</button>
          </form>
        </div>
      </div>

      {/* Bottom: my hand + controls */}
      {you !== null && me && (
        <div className="border-t border-table-border bg-table-panel shrink-0">
          <div className="flex flex-wrap items-center gap-2 px-3 py-1.5 text-sm">
            <PhaseControls state={state} t={t} isActive={isActive} hasPriority={hasPriority} you={you} />
            <div className="ml-auto flex items-center gap-2">
              <LifeControl p={me} t={t} />
              <ManaControl p={me} t={t} />
              <DiceRoller t={t} seat={you} />
              <button className="chip hover:border-table-accent" onClick={() => setTokenOpen(true)}>
                ＋ Token
              </button>
              <ZoneButtons you={you} t={t} objectsByZone={objectsByZone} onBrowse={(zoneId, title) => setBrowseZone({ zoneId, title })} />
            </div>
          </div>
          <div className="overflow-x-auto px-3 pb-3 pt-2 scrollbar-thin">
            <div className="hand-fan flex justify-center min-w-max px-4">
              {myHand.map((o) => (
                <div key={o.id} className="hand-card w-[92px] shrink-0">
                  <button
                    className="block w-full"
                    onClick={(e) => (targeting ? addTarget(o.id) : setSel({ objectId: o.id, x: e.clientX, y: e.clientY }))}
                    onMouseEnter={(e) => o.cardId && handleHover({ id: o.cardId, name: o.name }, e)}
                    onMouseMove={(e) => o.cardId && handleHover({ id: o.cardId, name: o.name }, e)}
                    onMouseLeave={() => handleHover(null)}
                  >
                    <CardImage id={o.cardId} name={o.name} />
                  </button>
                </div>
              ))}
              {myHand.length === 0 && <div className="py-6 text-sm text-table-muted">Your hand is empty.</div>}
            </div>
          </div>
        </div>
      )}

      {tokenOpen && you !== null && (
        <TokenPicker
          onClose={() => setTokenOpen(false)}
          onPick={(tk) => {
            const num = (v: string | null) => {
              if (!v) return undefined;
              const n = parseInt(v.replace(/[^0-9-]/g, ""), 10);
              return Number.isFinite(n) ? n : undefined;
            };
            t.send({ type: "create_token", seat: you, name: tk.name, cardId: tk.id, oracleId: null, power: num(tk.power), toughness: num(tk.toughness) });
            setTokenOpen(false);
          }}
        />
      )}
      {sel && <CardMenu sel={sel} state={state} you={you} t={t} onCast={beginCast} onActivate={onActivate} onClose={() => setSel(null)} />}
      <RollOverlay roll={state.lastRoll} />
      {modePicker && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4" onClick={() => setModePicker(null)}>
          <div className="panel w-full max-w-md p-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-2 font-display text-lg text-table-accentSoft">{modePicker.name} — choose a mode</h3>
            <div className="space-y-1">
              {modePicker.modes.map((m, i) => (
                <button
                  key={i}
                  className="block w-full rounded-md border border-table-border bg-table-panel2 px-3 py-2 text-left text-sm hover:border-table-accent"
                  onClick={() => {
                    const mode = modePicker.modes[i]!;
                    const obj = modePicker;
                    setModePicker(null);
                    startCast(obj.objectId, obj.name, mode.targets, i);
                  }}
                >
                  • {m.label}
                </button>
              ))}
            </div>
            <button className="btn-ghost mt-3" onClick={() => setModePicker(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {targeting && (
        <div className="fixed left-1/2 top-16 z-40 flex -translate-x-1/2 items-center gap-2 rounded-lg border border-red-500/60 bg-table-panel/95 px-4 py-2 text-sm shadow-panel">
          <span className="text-table-accentSoft">🎯 {targeting.name}:</span>
          <span>
            {targeting.specs[targeting.collected.length]?.label ?? "Choose target"} ({targeting.collected.length}/{targeting.specs.length})
          </span>
          <span className="text-xs text-table-muted">— click a card{["player", "any"].includes(targeting.specs[targeting.collected.length]?.kind ?? "") ? " or a player" : ""}</span>
          <button className="btn-ghost !py-1" onClick={() => setTargeting(null)}>
            Cancel
          </button>
        </div>
      )}
      {t.error && <div className="fixed bottom-4 left-1/2 max-w-[90vw] -translate-x-1/2 whitespace-pre-line rounded bg-red-900/90 px-4 py-2 text-sm text-red-100 shadow-panel">{t.error}</div>}
      
      {browseZone && (
        <ZoneBrowserModal
          title={browseZone.title}
          objects={objectsByZone[browseZone.zoneId] ?? []}
          onClose={() => setBrowseZone(null)}
          onSelect={(o, e) => (targeting ? addTarget(o.id) : setSel({ objectId: o.id, x: e.clientX, y: e.clientY }))}
          onHover={handleHover}
        />
      )}

      {hoveredCard && (
        <div
          className="pointer-events-none fixed z-50 transition-all duration-75 ease-out"
          style={{
            left: hoveredCard.x + 15,
            top: Math.min(window.innerHeight - 340, Math.max(10, hoveredCard.y - 170)),
          }}
        >
          <div className="rounded-lg border border-table-border bg-table-panel/95 p-1.5 shadow-2xl backdrop-blur-md animate-fade-in">
            <img
              src={`/api/cards/${hoveredCard.id}/image`}
              alt={hoveredCard.name}
              className="w-56 rounded-md shadow-lg card-aspect"
            />
          </div>
        </div>
      )}
    </div>
  );
}

function ZoneBrowserModal({
  title,
  objects,
  onClose,
  onSelect,
  onHover,
}: {
  title: string;
  objects: GameObject[];
  onClose: () => void;
  onSelect: (o: GameObject, e: React.MouseEvent) => void;
  onHover?: (card: { id: string; name: string } | null, e: React.MouseEvent) => void;
}) {
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/80 p-4" onClick={onClose}>
      <div className="panel flex max-h-[85vh] w-full max-w-4xl flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-table-border p-4">
          <h2 className="font-display text-lg text-table-accentSoft">{title} ({objects.length} cards)</h2>
          <button className="btn-ghost" onClick={onClose}>Close</button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {objects.length === 0 ? (
            <div className="p-12 text-center text-table-muted">This zone is empty.</div>
          ) : (
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-8">
              {objects.map((o) => (
                <div key={o.id} className="relative flex flex-col items-center">
                  <button
                    className="w-full shrink-0 transition-transform hover:-translate-y-1 hover:brightness-110"
                    onClick={(e) => onSelect(o, e)}
                    onMouseEnter={(e) => o.cardId && onHover?.({ id: o.cardId, name: o.name }, e)}
                    onMouseMove={(e) => o.cardId && onHover?.({ id: o.cardId, name: o.name }, e)}
                    onMouseLeave={() => onHover?.(null, null as any)}
                    title={o.name}
                  >
                    <CardImage id={o.cardId} name={o.name} />
                  </button>
                  <div className="mt-1 truncate w-full text-center text-[10px] text-table-muted" title={o.name}>
                    {o.name}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function logClass(kind: string): string {
  const base = "mb-0.5 leading-snug ";
  if (kind === "override") return base + "text-amber-300";
  if (kind === "system") return base + "text-table-accentSoft";
  if (kind === "combat") return base + "text-red-300";
  if (kind === "chat") return base + "text-table-ink";
  if (kind === "phase") return base + "text-table-muted";
  return base + "text-table-muted";
}

function PlayerStrip({
  p,
  state,
  you,
  t,
  objectsByZone,
  onSelect,
  onBrowse,
  onHover,
  targeting,
  onTargetPlayer,
}: {
  p: PlayerState;
  state: TableState;
  you: number | null;
  t: TableConn;
  objectsByZone: Record<string, GameObject[]>;
  onSelect: (s: Selection) => void;
  onBrowse: (zoneId: string, title: string) => void;
  onHover?: (card: { id: string; name: string } | null, e: React.MouseEvent) => void;
  targeting?: boolean;
  onTargetPlayer?: () => void;
}) {
  const { user } = useAuth();
  const isAdmin = user?.isAdmin ?? false;
  const canEdit = you === p.seat || isAdmin;

  const bf = objectsByZone[`battlefield:${p.seat}`] ?? [];
  const gy = objectsByZone[`graveyard:${p.seat}`] ?? [];
  const ex = objectsByZone[`exile:${p.seat}`] ?? [];
  const active = state.activeSeat === p.seat;
  const hasPriority = state.prioritySeat === p.seat;

  return (
    <div className={`rounded-lg border p-2 ${targeting ? "cursor-crosshair ring-2 ring-red-500/60" : ""} ${active ? "border-table-accent shadow-accent/5 shadow-md" : "border-table-border"} ${p.hasLost ? "opacity-40" : ""}`}>
      <div className="mb-1 flex items-center gap-2 text-sm">
        <button disabled={!targeting} onClick={() => onTargetPlayer?.()} className="flex items-center gap-2">
          <Avatar cardId={p.avatarCardId} name={p.name} size={28} ring={active} />
          <span className={`h-2 w-2 rounded-full ${p.connected ? "bg-green-400" : "bg-gray-500"}`} />
          <span className="font-semibold">{p.name}</span>
        </button>
        {active && (
          <span className="rounded bg-amber-500/20 px-1 py-0.5 text-[9px] font-bold uppercase tracking-wider text-amber-200 border border-amber-500/40">Active</span>
        )}
        {hasPriority && (
          <span className="animate-pulse rounded bg-table-accent/20 px-1 py-0.5 text-[9px] font-bold uppercase tracking-wider text-table-accentSoft border border-table-accent/40">Priority</span>
        )}
        <div className="flex items-center gap-1">
          {canEdit && (
            <button className="btn-ghost h-6 w-6 !px-0" onClick={() => t.send({ type: "adjust_life", seat: p.seat, delta: -1 })} title="−1 life">
              −
            </button>
          )}
          <span className={`life-diamond text-sm font-bold text-white ${p.life <= 5 ? "animate-pulse border-red-500 shadow-red-500/55 shadow-[0_0_12px]" : ""}`}>
            <span>{p.life}</span>
          </span>
          {canEdit && (
            <button className="btn-ghost h-6 w-6 !px-0" onClick={() => t.send({ type: "adjust_life", seat: p.seat, delta: 1 })} title="+1 life">
              +
            </button>
          )}
        </div>
        <span className="text-xs text-table-muted flex gap-2 ml-1">
          <span title="Cards in hand">✋{p.handCount}</span>
          <button className="hover:text-table-accentSoft" onClick={() => onBrowse(`library:${p.seat}`, `${p.name}'s Library`)} title="Search/View library">
            📚{p.libraryCount}
          </button>
          <button className="hover:text-table-accentSoft" onClick={() => onBrowse(`graveyard:${p.seat}`, `${p.name}'s Graveyard`)} title="View graveyard">
            🪦{gy.length}
          </button>
          <button className="hover:text-table-accentSoft" onClick={() => onBrowse(`exile:${p.seat}`, `${p.name}'s Exile`)} title="View exile">
            🌀{ex.length}
          </button>
        </span>
        {p.poison > 0 && (
          <button
            disabled={!canEdit}
            className="chip text-green-300 disabled:opacity-100"
            title={canEdit ? "Poison (right-click −1)" : "Poison counters"}
            onClick={() => canEdit && t.send({ type: "set_poison", seat: p.seat, value: p.poison + 1 })}
            onContextMenu={(e) => { e.preventDefault(); if (canEdit) t.send({ type: "set_poison", seat: p.seat, value: p.poison - 1 }); }}
          >
            ☠{p.poison}
          </button>
        )}
        {state.formatId === "commander" && you !== null && (
          <button
            className="chip"
            title="+1 commander damage from you"
            onClick={() => t.send({ type: "commander_damage", toSeat: p.seat, fromSeat: you, delta: 1 })}
          >
            ⚔{p.commanderDamage[you] ?? 0}
          </button>
        )}
      </div>
      <BattlefieldRow objects={bf} onSelect={(o, e) => onSelect({ objectId: o.id, x: e.clientX, y: e.clientY })} onHover={onHover} compact />
    </div>
  );
}

function BattlefieldRow({
  title,
  objects,
  onSelect,
  onHover,
  highlight,
  compact,
}: {
  title?: string;
  objects: GameObject[];
  onSelect: (o: GameObject, e: React.MouseEvent) => void;
  onHover?: (card: { id: string; name: string } | null, e: React.MouseEvent) => void;
  highlight?: boolean;
  compact?: boolean;
}) {
  const isLand = (o: GameObject) => o.cardTypes?.includes("Land") ?? false;
  const lands = objects.filter(isLand);
  const nonlands = objects.filter((o) => !isLand(o));
  const size = compact ? 72 : 100;
  return (
    <div className={`rounded-lg ${highlight ? "border border-table-accent/30 bg-table-panel2/40 p-2" : ""}`}>
      {title && <div className="mb-1 text-xs uppercase tracking-wide text-table-muted">{title}</div>}
      {objects.length === 0 && <div className="py-3 text-xs text-table-muted">— empty —</div>}
      {/* Creatures / other permanents in front, lands in a tidy back row. */}
      {nonlands.length > 0 && (
        <div className="mb-1 flex flex-wrap gap-1">
          {nonlands.map((o) => (
            <GameCard key={o.id} o={o} onClick={(e) => onSelect(o, e)} onHover={onHover} size={size} />
          ))}
        </div>
      )}
      {lands.length > 0 && (
        <div className="flex flex-wrap gap-1 opacity-95">
          {lands.map((o) => (
            <GameCard key={o.id} o={o} onClick={(e) => onSelect(o, e)} onHover={onHover} size={size * 0.82} />
          ))}
        </div>
      )}
    </div>
  );
}

function GameCard({
  o,
  onClick,
  size,
  onHover,
}: {
  o: GameObject;
  onClick: (e: React.MouseEvent) => void;
  size: number;
  onHover?: (card: { id: string; name: string } | null, e: React.MouseEvent) => void;
}) {
  const w = size * 0.72;
  return (
    <button
      onClick={onClick}
      onMouseEnter={(e) => o.cardId && onHover?.({ id: o.cardId, name: o.name }, e)}
      onMouseMove={(e) => o.cardId && onHover?.({ id: o.cardId, name: o.name }, e)}
      onMouseLeave={() => onHover?.(null, null as any)}
      className="relative shrink-0 transition-transform hover:scale-105 hover:z-10"
      style={{ width: o.tapped ? size : w, height: o.tapped ? w : size }}
      title={o.name}
    >
      <div
        className="absolute left-0 top-0 origin-top-left transition-transform"
        style={{ width: w, height: size, transform: o.tapped ? `rotate(90deg) translateY(-${w}px)` : "none" }}
      >
        <CardImage id={o.cardId} name={o.name} className={o.attacking !== null ? "ring-2 ring-red-500" : o.blocking ? "ring-2 ring-blue-400" : ""} />
        {o.counters.length > 0 && (
          <div className="absolute bottom-0 left-0 flex gap-0.5 p-0.5">
            {o.counters.map((c) => (
              <span key={c.type} className="rounded bg-black/80 px-1 text-[9px] text-white">
                {c.type} {c.count}
              </span>
            ))}
          </div>
        )}
        {o.ptOverride && (
          <span className="absolute bottom-0 right-0 rounded bg-black/80 px-1 text-[10px] font-bold text-white">
            {o.ptOverride.power}/{o.ptOverride.toughness}
          </span>
        )}
        {o.damage > 0 && <span className="absolute right-0 top-0 rounded bg-red-700 px-1 text-[10px] text-white">{o.damage}</span>}
        {o.isCommander && <span className="absolute left-0 top-0 rounded bg-table-accent px-1 text-[9px] text-black">CMD</span>}
      </div>
    </button>
  );
}

function MiniCard({
  o,
  onClick,
  onHover,
}: {
  o: GameObject;
  onClick: (e: React.MouseEvent) => void;
  onHover?: (card: { id: string; name: string } | null, e: React.MouseEvent) => void;
}) {
  return (
    <button
      className="w-[56px] shrink-0 transition-transform hover:scale-105"
      onClick={onClick}
      onMouseEnter={(e) => o.cardId && onHover?.({ id: o.cardId, name: o.name }, e)}
      onMouseMove={(e) => o.cardId && onHover?.({ id: o.cardId, name: o.name }, e)}
      onMouseLeave={() => onHover?.(null, null as any)}
      title={o.name}
    >
      <CardImage id={o.cardId} name={o.name} />
    </button>
  );
}

function PhaseControls({ state, t, isActive, hasPriority, you }: { state: TableState; t: TableConn; isActive: boolean; hasPriority: boolean; you: number }) {
  const idx = TURN_STEPS.findIndex((s) => s.phase === state.phase && s.step === state.step);
  return (
    <div className="flex flex-wrap items-center gap-1">
      <div className="hidden items-center gap-0.5 lg:flex">
        {TURN_STEPS.map((s, i) => (
          <span key={s.step} className={`rounded px-1.5 py-0.5 text-[10px] ${i === idx ? "bg-table-accent text-black" : "text-table-muted"}`}>
            {STEP_LABELS[s.step]}
          </span>
        ))}
      </div>
      <button className="btn-ghost !py-1" onClick={() => t.send({ type: "pass_priority", seat: you })} disabled={!hasPriority}>
        Pass{hasPriority ? " ▸" : ""}
      </button>
      <button className="btn-primary !py-1" onClick={() => t.send({ type: "advance_step" })} disabled={!isActive}>
        Next step
      </button>
      {state.step === "main1" && (
        <button className="btn-ghost !py-1 text-amber-200 border-amber-500/30 hover:border-amber-500/50" onClick={() => t.send({ type: "skip_combat", seat: you })} disabled={!hasPriority}>
          Skip Combat
        </button>
      )}
      <button className="btn-ghost !py-1" onClick={() => t.send({ type: "untap_all", seat: you })}>
        Untap all
      </button>
      <button className="btn-ghost !py-1" onClick={() => t.send({ type: "draw", seat: you, count: 1 })} disabled={!hasPriority}>
        Draw
      </button>
    </div>
  );
}

function LifeControl({ p, t }: { p: PlayerState; t: TableConn }) {
  return (
    <div className="flex items-center gap-1 rounded-lg bg-table-panel2 px-1.5 py-0.5">
      <Avatar cardId={p.avatarCardId} name={p.name} size={30} ring />
      <button className="btn-ghost h-8 w-8 !px-0 text-lg" onClick={() => t.send({ type: "adjust_life", seat: p.seat, delta: -1 })} title="−1 life">
        −
      </button>
      <span className={`life-diamond font-display text-lg font-bold text-white ${p.life <= 5 ? "animate-pulse border-red-500 shadow-red-500/55 shadow-[0_0_12px]" : ""}`} style={{ width: 42, height: 42 }}>
        <span>{p.life}</span>
      </span>
      <button className="btn-ghost h-8 w-8 !px-0 text-lg" onClick={() => t.send({ type: "adjust_life", seat: p.seat, delta: 1 })} title="+1 life">
        +
      </button>
      <button
        className={`chip ${p.poison > 0 ? "text-green-300" : "text-table-muted"}`}
        title="Poison counters (right-click to remove)"
        onClick={() => t.send({ type: "set_poison", seat: p.seat, value: p.poison + 1 })}
        onContextMenu={(e) => {
          e.preventDefault();
          t.send({ type: "set_poison", seat: p.seat, value: p.poison - 1 });
        }}
      >
        ☠{p.poison}
      </button>
    </div>
  );
}

function ManaControl({ p, t }: { p: PlayerState; t: TableConn }) {
  const colors: Array<"W" | "U" | "B" | "R" | "G" | "C"> = ["W", "U", "B", "R", "G", "C"];
  const bg = MANA_HEX;
  return (
    <div className="flex items-center gap-0.5">
      {colors.map((c) => (
        <button
          key={c}
          className="flex h-7 w-7 flex-col items-center justify-center rounded-full border border-black/40 text-[10px] font-bold"
          style={{ background: bg[c], color: MANA_FG[c] ?? "#000000" }}
          onClick={() => t.send({ type: "add_mana", seat: p.seat, color: c, count: 1 })}
          onContextMenu={(e) => {
            e.preventDefault();
            t.send({ type: "add_mana", seat: p.seat, color: c, count: -1 });
          }}
          title={`${c}: ${p.manaPool[c] ?? 0} (right-click to remove)`}
        >
          {p.manaPool[c] ?? 0}
        </button>
      ))}
      <button className="btn-ghost !py-1" onClick={() => t.send({ type: "empty_mana", seat: p.seat })} title="Empty mana pool">
        ∅
      </button>
    </div>
  );
}

function ZoneButtons({
  you,
  t,
  objectsByZone,
  onBrowse,
}: {
  you: number;
  t: TableConn;
  objectsByZone: Record<string, GameObject[]>;
  onBrowse: (zoneId: string, title: string) => void;
}) {
  const gy = objectsByZone[`graveyard:${you}`] ?? [];
  const ex = objectsByZone[`exile:${you}`] ?? [];
  const lib = objectsByZone[`library:${you}`] ?? [];
  return (
    <div className="flex items-center gap-1 text-xs">
      <button className="chip hover:border-table-accent hover:text-table-accentSoft" onClick={() => t.send({ type: "shuffle", seat: you })}>
        Shuffle
      </button>
      <button className="chip hover:border-table-accent hover:text-table-accentSoft text-amber-200" onClick={() => { if (confirm("Mulligan your hand (shuffles hand back and draws 7 new cards)?")) t.send({ type: "mulligan", seat: you }); }}>
        Mulligan
      </button>
      <button className="chip hover:border-table-accent hover:text-table-accentSoft" onClick={() => onBrowse(`graveyard:${you}`, "Your Graveyard")}>
        GY {gy.length}
      </button>
      <button className="chip hover:border-table-accent hover:text-table-accentSoft" onClick={() => onBrowse(`exile:${you}`, "Your Exile")}>
        Exile {ex.length}
      </button>
      <button className="chip hover:border-table-accent hover:text-table-accentSoft" onClick={() => onBrowse(`library:${you}`, "Your Library (Search)")}>
        Library {lib.length}
      </button>
    </div>
  );
}

// ---- turn timer ---------------------------------------------------------
function TurnTimer({ startedAt, limit, isMine, sound }: { startedAt: number; limit: number; isMine: boolean; sound: boolean }) {
  const [now, setNow] = useState(Date.now());
  const warned = useRef(false);
  useEffect(() => {
    const iv = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(iv);
  }, []);
  useEffect(() => {
    warned.current = false;
  }, [startedAt]);
  const elapsed = Math.max(0, Math.floor((now - startedAt) / 1000));
  const over = limit > 0 && elapsed >= limit;
  useEffect(() => {
    if (over && isMine && sound && !warned.current) {
      warned.current = true;
      playWarning();
    }
  }, [over, isMine, sound]);
  const mm = Math.floor(elapsed / 60);
  const ss = String(elapsed % 60).padStart(2, "0");
  return (
    <span className={`rounded px-1.5 py-0.5 font-mono text-xs ${over ? "bg-red-800 text-white" : "bg-table-panel2 text-table-muted"}`} title="Time on the current turn">
      ⏱ {mm}:{ss}
      {limit > 0 ? ` / ${Math.floor(limit / 60)}:${String(limit % 60).padStart(2, "0")}` : ""}
    </span>
  );
}

// ---- dice ---------------------------------------------------------------
function DiceRoller({ t, seat }: { t: TableConn; seat: number }) {
  return (
    <div className="flex items-center gap-0.5">
      <button className="chip hover:border-table-accent" onClick={() => t.send({ type: "roll", seat, sides: 6, count: 1 })} title="Roll a d6">
        d6
      </button>
      <button className="chip hover:border-table-accent" onClick={() => t.send({ type: "roll", seat, sides: 20, count: 1 })} title="Roll a d20">
        d20
      </button>
      <button className="chip hover:border-table-accent" onClick={() => t.send({ type: "roll", seat, sides: 2, count: 1, label: "coin" })} title="Flip a coin">
        🪙
      </button>
    </div>
  );
}

// Shows an animated overlay whenever a new roll appears in the shared state, so
// every player sees the same roll animate.
function RollOverlay({ roll }: { roll: RollResult | null }) {
  const [show, setShow] = useState(false);
  const [current, setCurrent] = useState<RollResult | null>(null);
  const lastId = useRef<number>(-1);
  const { sound } = useSettings();
  useEffect(() => {
    if (roll && roll.id !== lastId.current) {
      lastId.current = roll.id;
      setCurrent(roll);
      setShow(true);
      if (sound) playRoll();
      const to = setTimeout(() => setShow(false), 2200);
      return () => clearTimeout(to);
    }
  }, [roll, sound]);
  if (!show || !current) return null;
  const isCoin = current.sides === 2;
  const faceText = isCoin ? (current.values[0] === 1 ? "Heads" : "Tails") : String(current.total);
  return (
    <div className="pointer-events-none fixed inset-0 z-40 flex items-center justify-center">
      <div className="flex flex-col items-center gap-3">
        <div className="dice-animate flex h-28 w-28 items-center justify-center rounded-3xl bg-table-accent text-4xl font-black text-black shadow-panel">
          {isCoin ? "🪙" : faceText}
        </div>
        <div className="max-w-md rounded-lg bg-black/85 px-4 py-2 text-center text-sm text-table-ink shadow-panel">{current.text}</div>
      </div>
    </div>
  );
}

// ---- token picker -------------------------------------------------------
interface TokenCard {
  id: string;
  name: string;
  typeLine: string;
  power: string | null;
  toughness: string | null;
  colors: string[];
  imageUrl: string | null;
}

function TokenPicker({ onClose, onPick }: { onClose: () => void; onPick: (t: TokenCard) => void }) {
  const [q, setQ] = useState("");
  const [tokens, setTokens] = useState<TokenCard[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const id = setTimeout(() => {
      setLoading(true);
      api
        .get<{ tokens: TokenCard[] }>(`/api/cards/tokens?q=${encodeURIComponent(q)}`)
        .then((r) => !cancelled && setTokens(r.tokens))
        .finally(() => !cancelled && setLoading(false));
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
  }, [q]);

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div className="panel flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 border-b border-table-border p-3">
          <h3 className="font-display text-lg text-table-accentSoft">Create a token</h3>
          <input className="input ml-auto w-64" autoFocus placeholder="Search tokens — soldier, treasure, 1/1 zombie…" value={q} onChange={(e) => setQ(e.target.value)} />
          <button className="btn-ghost" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {loading && tokens.length === 0 ? (
            <div className="p-6 text-center text-table-muted">Searching…</div>
          ) : tokens.length === 0 ? (
            <div className="p-6 text-center text-table-muted">No tokens found. Try "soldier", "treasure", "clue", "zombie"…</div>
          ) : (
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-5 md:grid-cols-6">
              {tokens.map((tk) => (
                <button key={tk.id} className="text-left transition hover:-translate-y-0.5 hover:brightness-110" onClick={() => onPick(tk)} title={`${tk.name} — ${tk.typeLine}`}>
                  <CardImage id={tk.id} name={tk.name} />
                  <div className="mt-0.5 truncate text-[10px] text-table-muted">
                    {tk.power ? `${tk.power}/${tk.toughness} ` : ""}
                    {tk.name}
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

// ---- card action menu ---------------------------------------------------
function CardMenu({
  sel,
  state,
  you,
  t,
  onClose,
  onCast,
  onActivate,
}: {
  sel: Selection;
  state: TableState;
  you: number | null;
  t: TableConn;
  onClose: () => void;
  onCast: (o: GameObject) => void;
  onActivate: (o: GameObject, abilityIndex: number, targets: { kind: string; label: string }[], usesX: boolean) => void;
}) {
  const o = state.objects[sel.objectId];
  const ref = useRef<HTMLDivElement>(null);
  const [abilities, setAbilities] = useState<Ability[]>([]);
  const cardId = o?.cardId;
  const onBattlefield = o?.zone === "battlefield";
  useEffect(() => {
    if (!onBattlefield || !cardId) return;
    let cancelled = false;
    api
      .get<CardDetailResponse>(`/api/cards/${cardId}`)
      .then((d) => !cancelled && setAbilities(parseAbilities(d.card.oracleText, d.card.name)))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [cardId, onBattlefield]);
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    window.addEventListener("mousedown", h);
    return () => window.removeEventListener("mousedown", h);
  }, [onClose]);
  if (!o) return null;

  const act = (fn: () => void) => () => {
    fn();
    onClose();
  };
  const move = (zone: ZoneId, toTop?: boolean) => t.send({ type: "move_card", objectId: o.id, toZone: zone, toSeat: o.ownerSeat, toTop });

  const style: React.CSSProperties = {
    left: Math.min(sel.x, window.innerWidth - 200),
    top: Math.min(sel.y, window.innerHeight - 320),
  };

  const Item = ({ label, onClick, danger }: { label: string; onClick: () => void; danger?: boolean }) => (
    <button className={`block w-full px-3 py-1.5 text-left text-sm hover:bg-table-panel2 ${danger ? "text-red-300" : ""}`} onClick={act(onClick)}>
      {label}
    </button>
  );

  return (
    <div ref={ref} className="panel fixed z-50 w-48 overflow-hidden py-1" style={style}>
      <div className="truncate border-b border-table-border px-3 py-1 text-xs text-table-muted">{o.name}</div>
      {o.zone === "battlefield" && (
        <>
          {abilities.map((ab) => (
            <Item
              key={`ab${ab.index}`}
              label={`▶ ${ab.cost}`}
              onClick={() => onActivate(o, ab.index, ab.effect.targets, ab.effect.ops.some((op) => (op as { xScaled?: boolean }).xScaled))}
            />
          ))}
          {abilities.length > 0 && <div className="my-1 border-t border-table-border" />}
          <Item label={o.tapped ? "Untap" : "Tap"} onClick={() => t.send({ type: "tap", objectId: o.id, tapped: !o.tapped })} />
          {/* Combat: attack (your turn) or block (a defender). The engine does the math. */}
          {you !== null && o.controllerSeat === you && you === state.activeSeat && o.attacking === null &&
            state.players
              .filter((p) => p.seat !== you && !p.hasLost)
              .map((p) => (
                <Item key={`atk${p.seat}`} label={`⚔ Attack ${p.name}`} onClick={() => t.send({ type: "declare_attacker", objectId: o.id, defendingSeat: p.seat })} />
              ))}
          {you !== null && o.controllerSeat === you && you !== state.activeSeat &&
            Object.values(state.objects)
              .filter((a) => a.attacking !== null && a.zone === "battlefield" && a.controllerSeat !== you)
              .map((a) => (
                <Item key={`blk${a.id}`} label={`🛡 Block ${a.name}`} onClick={() => t.send({ type: "declare_blocker", blockerId: o.id, attackerId: a.id })} />
              ))}
          {o.attacking !== null && <Item label="✖ Remove from combat" onClick={() => t.send({ type: "declare_attacker", objectId: o.id, defendingSeat: -1 })} />}
          <Item label="Add +1/+1" onClick={() => t.send({ type: "add_counter", objectId: o.id, counterType: "+1/+1", delta: 1 })} />
          <Item label="Add -1/-1" onClick={() => t.send({ type: "add_counter", objectId: o.id, counterType: "-1/-1", delta: 1 })} />
          <Item label="Flip face down/up" onClick={() => t.send({ type: "flip", objectId: o.id, faceDown: !o.faceDown })} />
          <Item label="Return to hand" onClick={() => t.send({ type: "keyword_action", objectId: o.id, action: "bounce" })} />
          <Item label="Destroy" onClick={() => t.send({ type: "keyword_action", objectId: o.id, action: "destroy" })} danger />
          <Item label="Sacrifice" onClick={() => t.send({ type: "keyword_action", objectId: o.id, action: "sacrifice" })} danger />
          <Item label="Exile" onClick={() => t.send({ type: "keyword_action", objectId: o.id, action: "exile" })} />
        </>
      )}
      {(o.zone === "hand" || o.zone === "command") && (
        <>
          <Item label="Play to battlefield" onClick={() => move("battlefield")} />
          <Item label="Cast (auto-resolve)" onClick={() => onCast(o)} />
          <Item label="→ Graveyard (discard)" onClick={() => move("graveyard")} />
        </>
      )}
      {o.zone === "stack" && (
        <>
          <Item label="Resolve (top)" onClick={() => t.send({ type: "resolve_top" })} />
          <Item label="Counter → graveyard" onClick={() => t.send({ type: "keyword_action", objectId: o.id, action: "counter" })} danger />
          <Item label="Counter → exile" onClick={() => t.send({ type: "keyword_action", objectId: o.id, action: "exile" })} danger />
        </>
      )}
      {(o.zone === "graveyard" || o.zone === "exile" || o.zone.startsWith("library")) && (
        <>
          <Item label="→ Hand" onClick={() => move("hand")} />
          <Item label="→ Battlefield" onClick={() => move("battlefield")} />
          <Item label="→ Library (top)" onClick={() => move("library", true)} />
          <Item label="→ Library (bottom)" onClick={() => move("library", false)} />
        </>
      )}
    </div>
  );
}
