import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import type { Ability, CardDetailResponse, Deck, EffectMode, GameObject, PlayerState, RollResult, TableState, ZoneId } from "@mtg/shared";
import { TURN_STEPS, compileEffects, parseAbilities } from "@mtg/shared";
import { api } from "@/api/client";
import { useAuth } from "@/store/auth";
import { constructionMatches, useLegalDeckIds } from "@/lib/deckLegality";
import { useTable, type TableConn } from "@/game/useTable";
import { CardImage } from "@/components/CardTile";
import { Avatar } from "@/components/Avatar";
import { useSettings } from "@/store/settings";
import { playRoll, playTurnChime, playWarning, unlockAudio } from "@/lib/sound";
import { MANA_HEX, MANA_FG } from "@/lib/mana";
import { FreeformBoard } from "@/pages/FreeformBoard";
import { UndoPrompt } from "@/components/UndoPrompt";

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
  if (t.state)
    return (
      <>
        <UndoPrompt state={t.state} you={t.you} t={t} />
        {t.state.mode === "freeform" ? <FreeformBoard t={t} state={t.state} /> : <GameBoard t={t} state={t.state} />}
      </>
    );
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
      setOnlyStarred(false);
    });
  }, [lobby?.formatId]);

  // Pre-filter to construction-compatible decks, then verify real legality for
  // this table's ruleset (card legality + ban toggle).
  const allowedFormat = lobby?.formatId ?? "house";
  const ruleset = lobby?.ruleset ?? "standard";
  const enforceBans = lobby?.enforceBans ?? true;
  const myMatched = decks.filter((d) => constructionMatches(allowedFormat, d));
  const preconMatched = precons.filter((d) => constructionMatches(allowedFormat, d));
  const { legalIds, loading: checkingLegality } = useLegalDeckIds([...myMatched, ...preconMatched], allowedFormat, ruleset, enforceBans);
  const isLegal = (d: Deck) => allowedFormat === "house" || legalIds.has(d.id);

  // NOTE: we deliberately do NOT auto-pick a deck. Each player must consciously
  // choose their own deck before taking a seat (the seat buttons are gated on it).

  // Switching your deck must update your seat on the server — otherwise the seat
  // keeps the old (or no) deck and the game refuses to start. Re-seat live.
  function chooseDeck(v: string | null) {
    setDeckId(v);
    if (lobby && lobby.you !== null) t.takeSeat(lobby.you, v);
  }

  // If we arrived here from "Create & sit down" with a chosen deck, claim the
  // first open seat with it automatically (once).
  const location = useLocation();
  const autoDeckId = (location.state as { autoDeckId?: string } | null)?.autoDeckId;
  const autoSeated = useRef(false);
  useEffect(() => {
    if (!lobby || autoSeated.current || !autoDeckId) return;
    if (lobby.you !== null) {
      autoSeated.current = true;
      return;
    }
    const taken = new Set(lobby.seats.map((s) => s.seat));
    const seat = Array.from({ length: lobby.maxPlayers }, (_, i) => i).find((i) => !taken.has(i));
    if (seat !== undefined) {
      autoSeated.current = true;
      setDeckId(autoDeckId);
      t.takeSeat(seat, autoDeckId);
    }
  }, [lobby, autoDeckId]);

  if (!lobby) return <div className="p-8 text-center text-table-muted">Connecting to table…</div>;

  const isHost = lobby.hostUserId === user?.id;
  const seatByIndex = (i: number) => lobby.seats.find((s) => s.seat === i);

  const filteredDecks = myMatched.filter(isLegal).filter((d) => !onlyStarred || d.isStarred);
  const filteredPrecons = preconMatched.filter(isLegal);

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
          Format: <b className="text-table-ink">{lobby.formatId}</b>
          {allowedFormat !== "house" ? <> · ruleset <b className="text-table-ink">{ruleset}</b>{!enforceBans && " · bans off"}</> : null}
        </div>
        {lobby.you === null && (
          <div className="mb-3 rounded-md border border-table-accent/40 bg-table-accent/10 px-3 py-2 text-sm text-table-accentSoft">
            👉 To join: <b>pick your deck</b> below, then <b>click an empty seat</b>. Or just watch as a spectator.
          </div>
        )}
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
        <label className="mb-1 block text-sm">
          <select className="input mt-1 w-full" value={deckId ?? ""} onChange={(e) => chooseDeck(e.target.value || null)}>
            <option value="">— none (spectate / empty) —</option>
            {filteredDecks.length > 0 && (
              <optgroup label="My decks">
                {filteredDecks.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name} ({d.cardCount})
                  </option>
                ))}
              </optgroup>
            )}
            {filteredPrecons.length > 0 && (
              <optgroup label="Preconstructed decks">
                {filteredPrecons.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name} ({d.cardCount})
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        </label>
        <div className="mb-3 text-[11px] text-table-muted">
          {checkingLegality
            ? "Checking which decks are legal…"
            : allowedFormat === "house"
              ? "House format — any deck is allowed."
              : `Only ${lobby.formatId}-legal decks are shown. Illegal ones are hidden — fix them in the Deck Builder.`}
        </div>
        {!checkingLegality && filteredDecks.length === 0 && filteredPrecons.length === 0 && (
          <div className="mb-3 rounded-md border border-amber-500/30 bg-amber-950/20 px-3 py-2 text-xs text-amber-200">
            You have no legal <b>{lobby.formatId}</b> decks. Build/fix one in the Deck Builder for this format, or start a House table for casual play. You can still sit as a spectator.
          </div>
        )}
        {/* You can't take a seat without a deck that's legal for this format —
            no grabbing a seat you can't fill. House format is exempt. */}
        {(() => {
          const canSit = allowedFormat === "house" || !!deckId;
          return (
            <>
              <div className="grid grid-cols-2 gap-2">
                {Array.from({ length: lobby.maxPlayers }, (_, i) => {
                  const occupant = seatByIndex(i);
                  const mine = lobby.you === i;
                  const blocked = !canSit && !mine && !occupant;
                  return (
                    <button
                      key={i}
                      disabled={blocked}
                      title={blocked ? `Pick a legal ${lobby.formatId} deck above before taking a seat.` : undefined}
                      className={`rounded-md border p-3 text-left text-sm ${mine ? "border-table-accent bg-table-accent/10" : "border-table-border bg-table-panel2"} ${blocked ? "cursor-not-allowed opacity-40" : ""}`}
                      onClick={() => canSit || mine ? t.takeSeat(i, deckId) : undefined}
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
              {!canSit && (
                <div className="mt-2 text-xs text-amber-300">Select a legal {lobby.formatId} deck above to take a seat (you can still watch as a spectator).</div>
              )}
            </>
          );
        })()}
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
  const [manualOpen, setManualOpen] = useState(false);
  const [handSort, setHandSort] = useState<"none" | "cmc" | "type" | "color" | "name">("none");
  const [handFilter, setHandFilter] = useState("");
  const [handMeta, setHandMeta] = useState<Record<string, { cmc: number; cardTypes: string[]; colors: string[] }>>({});
  const [flyingCards, setFlyingCards] = useState<{ id: string; cardId: string | null; startX: number; startY: number }[]>([]);
  const prevLibCount = useRef<number>(-1);
  const [libraryMenu, setLibraryMenu] = useState<{ seat: number; x: number; y: number } | null>(null);

  useEffect(() => {
    if (you === null || !me) return;
    const count = me.libraryCount;
    if (prevLibCount.current !== -1 && count < prevLibCount.current) {
      const el = document.getElementById("my-library-stack");
      const rect = el?.getBoundingClientRect();
      const parentEl = el?.closest(".mtg-table");
      const parentRect = parentEl?.getBoundingClientRect();
      
      let startX = 1000;
      let startY = 600;
      
      if (rect && parentRect) {
        startX = rect.left - parentRect.left;
        startY = rect.top - parentRect.top;
      }

      const newFly = {
        id: Math.random().toString(),
        cardId: null,
        startX,
        startY,
      };
      setFlyingCards((f) => [...f, newFly]);
      setTimeout(() => {
        setFlyingCards((f) => f.filter((item) => item.id !== newFly.id));
      }, 480);
    }
    prevLibCount.current = count;
  }, [me?.libraryCount, you]);

  const [zoom, setZoom] = useState(1.0);
  const [panX, setPanX] = useState(0);
  const [panY, setPanY] = useState(0);
  const [isPanning, setIsPanning] = useState(false);
  const panStart = useRef({ x: 0, y: 0, panX: 0, panY: 0 });
  const matRef = useRef<HTMLDivElement>(null);

  function matPoint(e: { clientX: number; clientY: number }): { x: number; y: number } {
    const r = matRef.current?.getBoundingClientRect();
    return {
      x: (e.clientX - (r?.left ?? 0)) / zoom,
      y: (e.clientY - (r?.top ?? 0)) / zoom,
    };
  }

  const handleWheel = (e: React.WheelEvent) => {
    if (!(e.target as HTMLElement).closest(".mtg-table-felt")) return;
    const factor = e.deltaY < 0 ? 1.06 : 0.94;
    setZoom((z) => Math.min(2.0, Math.max(0.6, z * factor)));
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    if (e.target !== e.currentTarget && !(e.target as HTMLElement).classList.contains("mtg-table-felt")) return;
    setIsPanning(true);
    panStart.current = { x: e.clientX, y: e.clientY, panX, panY };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isPanning) return;
    const dx = e.clientX - panStart.current.x;
    const dy = e.clientY - panStart.current.y;
    setPanX(panStart.current.panX + dx);
    setPanY(panStart.current.panY + dy);
  };

  const handlePointerUp = () => {
    setIsPanning(false);
  };

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

  const { sound, turnLimitSeconds, setTurnLimit, handCardWidth, setHandCardWidth } = useSettings();
  // Chime when it becomes your turn.
  const prevActiveSeat = useRef(state.activeSeat);
  useEffect(() => {
    if (state.activeSeat !== prevActiveSeat.current) {
      prevActiveSeat.current = state.activeSeat;
      if (sound && you !== null && state.activeSeat === you && state.status === "playing") playTurnChime();
    }
  }, [state.activeSeat, you, sound, state.status]);

  // Fetch light metadata (mana value / types / colors) for hand cards so we can
  // sort and filter them. Cached by cardId; only fetches ones we haven't seen.
  useEffect(() => {
    const missing = myHand.map((o) => o.cardId).filter((id): id is string => !!id && !(id in handMeta));
    if (missing.length === 0) return;
    let cancelled = false;
    Promise.all(
      missing.map((id) =>
        api
          .get<CardDetailResponse>(`/api/cards/${id}`)
          .then((d) => [id, { cmc: d.card.cmc, cardTypes: d.card.cardTypes, colors: d.card.colors }] as const)
          .catch(() => null),
      ),
    ).then((rows) => {
      if (cancelled) return;
      const add: Record<string, { cmc: number; cardTypes: string[]; colors: string[] }> = {};
      for (const r of rows) if (r) add[r[0]] = r[1];
      if (Object.keys(add).length) setHandMeta((m) => ({ ...m, ...add }));
    });
    return () => {
      cancelled = true;
    };
  }, [myHand.map((o) => o.cardId).join(","), handMeta]);

  // Apply the hand filter + sort. Sorting falls back gracefully before metadata loads.
  const displayHand = useMemo(() => {
    const TYPE_RANK = ["Creature", "Planeswalker", "Instant", "Sorcery", "Artifact", "Enchantment", "Battle", "Land"];
    const f = handFilter.trim().toLowerCase();
    let list = myHand;
    if (f) {
      list = list.filter((o) => {
        const meta = o.cardId ? handMeta[o.cardId] : undefined;
        return o.name.toLowerCase().includes(f) || (meta?.cardTypes ?? []).some((t) => t.toLowerCase().includes(f));
      });
    }
    const rank = (o: GameObject) => {
      const meta = o.cardId ? handMeta[o.cardId] : undefined;
      if (handSort === "cmc") return meta?.cmc ?? 99;
      if (handSort === "type") {
        const t = meta?.cardTypes?.find((x) => TYPE_RANK.includes(x));
        return t ? TYPE_RANK.indexOf(t) : 99;
      }
      if (handSort === "color") return (meta?.colors ?? []).length === 0 ? 99 : "WUBRG".indexOf((meta!.colors[0] as string) ?? "");
      return 0;
    };
    if (handSort === "name") return [...list].sort((a, b) => a.name.localeCompare(b.name));
    if (handSort !== "none") return [...list].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
    return list;
  }, [myHand, handMeta, handSort, handFilter]);

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
        <div className="mtg-table flex min-h-0 flex-1 flex-col overflow-hidden p-2 relative" onWheel={handleWheel}>
          {/* Zoom / Pan Floating Controls */}
          <div className="absolute left-4 top-4 z-20 flex flex-col gap-1 bg-black/60 p-1.5 rounded-lg border border-table-border/40 backdrop-blur-sm">
            <button className="btn-ghost !p-1.5 font-bold hover:text-table-accentSoft" onClick={() => setZoom((z) => Math.min(2.0, z + 0.1))} title="Zoom In">＋</button>
            <button className="btn-ghost !p-1.5 font-bold hover:text-table-accentSoft" onClick={() => setZoom((z) => Math.max(0.6, z - 0.1))} title="Zoom Out">－</button>
            <button className="btn-ghost !p-1 text-[9px] hover:text-table-accentSoft uppercase tracking-wider font-semibold" onClick={() => { setZoom(1.0); setPanX(0); setPanY(0); }} title="Reset View">Reset</button>
          </div>

          <div
            ref={matRef}
            className="mtg-table-felt w-full min-h-[900px] flex flex-col justify-start gap-4 p-4 relative"
            style={{
              transform: `translate(${panX}px, ${panY}px) scale(${zoom})`,
              transformOrigin: "0 0",
              transition: "transform 0.05s ease-out",
              cursor: isPanning ? "grabbing" : "grab",
            }}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
          >
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
                <div className="flex gap-3">
                  <div className="flex-1 min-w-0">
                    <BattlefieldRow
                      title="Your battlefield"
                      objects={objectsByZone[`battlefield:${you}`] ?? []}
                      onSelect={clickObject}
                      onHover={handleHover}
                      highlight
                    />
                  </div>
                  <div className="flex shrink-0 items-end gap-1.5 pb-2">
                    <CardStackDeck
                      id="my-library-stack"
                      count={me?.libraryCount ?? 0}
                      label="Library"
                      size={96}
                      onClick={() => t.send({ type: "draw", seat: you, count: 1 })}
                      onRightClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setLibraryMenu({ seat: you, x: e.clientX, y: e.clientY });
                      }}
                    />
                    <CardStackDeck
                      count={objectsByZone[`graveyard:${you}`]?.length ?? 0}
                      faceUpCardId={objectsByZone[`graveyard:${you}`]?.[objectsByZone[`graveyard:${you}`].length - 1]?.cardId}
                      label="Grave"
                      size={96}
                      onClick={() => setBrowseZone({ zoneId: `graveyard:${you}`, title: "Your Graveyard" })}
                    />
                    <CardStackDeck
                      count={objectsByZone[`exile:${you}`]?.length ?? 0}
                      faceUpCardId={objectsByZone[`exile:${you}`]?.[objectsByZone[`exile:${you}`].length - 1]?.cardId}
                      label="Exile"
                      size={96}
                      onClick={() => setBrowseZone({ zoneId: `exile:${you}`, title: "Your Exile" })}
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Smooth flying card animation projection */}
            {flyingCards.map((f) => (
              <div
                key={f.id}
                className="absolute z-50 pointer-events-none rounded-md animate-fly-draw"
                style={{
                  width: 70,
                  height: 96,
                  transformOrigin: "center",
                  "--fly-start-x": `${f.startX}px`,
                  "--fly-start-y": `${f.startY}px`,
                } as any}
              >
                <CardImage id={null} name="Card" className="rounded-md shadow-2xl ring-2 ring-table-accent/60 animate-spin-once" />
              </div>
            ))}
          </div>

          {/* Floating Library Context Menu overlay */}
          {libraryMenu && (
            <LibraryContextMenu
              menu={libraryMenu}
              t={t}
              onClose={() => setLibraryMenu(null)}
              onBrowse={() => {
                setBrowseZone({ zoneId: `library:${libraryMenu.seat}`, title: `${libraryMenu.seat === you ? "Your" : "Opponent's"} Library` });
                setLibraryMenu(null);
              }}
            />
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
              <LifeDisplay p={me} />
              <DiceRoller t={t} seat={you} />
              <button className="chip hover:border-table-accent" onClick={() => setTokenOpen(true)}>
                ＋ Token
              </button>
              <ZoneButtons you={you} t={t} objectsByZone={objectsByZone} onBrowse={(zoneId, title) => setBrowseZone({ zoneId, title })} />
              <button
                className={`chip ${manualOpen ? "border-table-accent text-table-accentSoft" : "hover:border-table-accent"}`}
                onClick={() => setManualOpen((v) => !v)}
                title="Manual override tools — bypass the game engine when it can't do something yet. Every use is logged."
              >
                ⚙ Manual
              </button>
            </div>
          </div>
          {manualOpen && <ManualOverridePanel me={me} t={t} you={you} />}
          {/* Hand toolbar: sort, filter, and size. */}
          <div className="flex flex-wrap items-center gap-2 px-3 pt-1.5 text-xs text-table-muted">
            <span className="font-semibold uppercase tracking-wide">Hand ({myHand.length})</span>
            <select className="input !py-0.5 !px-1" value={handSort} onChange={(e) => setHandSort(e.target.value as typeof handSort)} title="Sort your hand">
              <option value="none">Sort: dealt order</option>
              <option value="cmc">Sort: mana value</option>
              <option value="type">Sort: type</option>
              <option value="color">Sort: color</option>
              <option value="name">Sort: name</option>
            </select>
            <input
              className="input !py-0.5 !px-2 w-36"
              placeholder="Filter — name or type…"
              value={handFilter}
              onChange={(e) => setHandFilter(e.target.value)}
            />
            {handFilter && (
              <button className="hover:text-table-accentSoft" onClick={() => setHandFilter("")}>
                clear ✕
              </button>
            )}
            <label className="ml-auto flex items-center gap-1" title="Card size">
              <span>🔍</span>
              <input
                type="range"
                min={72}
                max={200}
                step={4}
                value={handCardWidth}
                onChange={(e) => setHandCardWidth(Number(e.target.value))}
                className="w-28 accent-table-accent"
              />
            </label>
          </div>
          <div className="overflow-x-auto px-3 pb-3 pt-2 scrollbar-thin">
            <div className="hand-fan flex justify-center min-w-max px-4">
              {displayHand.map((o) => (
                <div key={o.id} className="hand-card shrink-0" style={{ width: handCardWidth }}>
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
              {myHand.length > 0 && displayHand.length === 0 && <div className="py-6 text-sm text-table-muted">No cards match "{handFilter}".</div>}
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

export function ZoneBrowserModal({
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
    <div className={`panel p-3 border-2 ${targeting ? "cursor-crosshair ring-2 ring-red-500/60" : ""} ${active ? "border-table-accent shadow-lg shadow-table-accent/5" : "border-table-border/60"} ${p.hasLost ? "opacity-40" : ""}`}>
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
          <span className={`life-diamond text-sm font-bold text-white ${p.life <= 5 ? "animate-pulse border-red-500 shadow-red-500/55 shadow-[0_0_12px]" : ""}`} title="Life (controlled by the game engine)">
            <span>{p.life}</span>
          </span>
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
      <div className="flex gap-3">
        <div className="flex-1 min-w-0">
          <BattlefieldRow objects={bf} onSelect={(o, e) => onSelect({ objectId: o.id, x: e.clientX, y: e.clientY })} onHover={onHover} compact isOpponent={p.seat !== you} />
        </div>
        <div className="flex shrink-0 items-end gap-1.5 pb-1">
          <CardStackDeck
            count={p.libraryCount}
            label="Library"
            size={76}
            onClick={() => onBrowse(`library:${p.seat}`, `${p.name}'s Library`)}
          />
          <CardStackDeck
            count={gy.length}
            faceUpCardId={gy[gy.length - 1]?.cardId}
            label="Grave"
            size={76}
            onClick={() => onBrowse(`graveyard:${p.seat}`, `${p.name}'s Graveyard`)}
          />
          <CardStackDeck
            count={ex.length}
            faceUpCardId={ex[ex.length - 1]?.cardId}
            label="Exile"
            size={76}
            onClick={() => onBrowse(`exile:${p.seat}`, `${p.name}'s Exile`)}
          />
        </div>
      </div>
    </div>
  );
}

// Group identical, "idle" permanents (same printing, untapped, no counters/damage,
// not in combat) into a single stack with a count — like MTGO/MTGA piling up basic
// lands. Anything with distinct state (tapped, counters, attacking…) stands alone.
function stackGroups(objects: GameObject[]): { rep: GameObject; count: number }[] {
  const idle = (o: GameObject) =>
    !o.tapped && o.counters.length === 0 && o.attacking === null && !o.blocking && !o.ptOverride && o.damage === 0 && !o.faceDown && !o.isCommander;
  const order: string[] = [];
  const groups = new Map<string, GameObject[]>();
  for (const o of objects) {
    const key = idle(o) && o.cardId ? `stk:${o.cardId}` : `id:${o.id}`;
    if (!groups.has(key)) {
      groups.set(key, []);
      order.push(key);
    }
    groups.get(key)!.push(o);
  }
  return order.map((k) => ({ rep: groups.get(k)![0]!, count: groups.get(k)!.length }));
}

function BattlefieldRow({
  title,
  objects,
  onSelect,
  onHover,
  highlight,
  compact,
  isOpponent = false,
}: {
  title?: string;
  objects: GameObject[];
  onSelect: (o: GameObject, e: React.MouseEvent) => void;
  onHover?: (card: { id: string; name: string } | null, e: React.MouseEvent) => void;
  highlight?: boolean;
  compact?: boolean;
  isOpponent?: boolean;
}) {
  const isLand = (o: GameObject) => o.cardTypes?.includes("Land") ?? false;
  const lands = stackGroups(objects.filter(isLand));
  const nonlands = stackGroups(objects.filter((o) => !isLand(o)));
  const size = compact ? 96 : 128;
  const landSize = size * 0.86;
  return (
    <div className={`battlefield-felt rounded-xl p-2 ${highlight ? "ring-1 ring-table-accent/30" : ""}`}>
      {title && <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-table-muted/80">{title}</div>}
      {objects.length === 0 && <div className="py-4 text-center text-xs text-table-muted/70">— no permanents —</div>}
      {/* Creatures / other nonland permanents up front. */}
      {nonlands.length > 0 && (
        <div className="mb-2 flex flex-wrap items-end gap-1.5">
          {nonlands.map(({ rep, count }) => (
            <GameCard key={rep.id} o={rep} count={count} onClick={(e) => onSelect(rep, e)} onHover={onHover} size={size} isOpponent={isOpponent} />
          ))}
        </div>
      )}
      {/* Lands in a tidy back row, stacked by name. */}
      {lands.length > 0 && (
        <div className="flex flex-wrap items-end gap-1.5">
          {lands.map(({ rep, count }) => (
            <GameCard key={rep.id} o={rep} count={count} onClick={(e) => onSelect(rep, e)} onHover={onHover} size={landSize} isOpponent={isOpponent} />
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
  count = 1,
  isOpponent = false,
}: {
  o: GameObject;
  onClick: (e: React.MouseEvent) => void;
  size: number;
  onHover?: (card: { id: string; name: string } | null, e: React.MouseEvent) => void;
  count?: number;
  isOpponent?: boolean;
}) {
  const [isHovered, setIsHovered] = useState(false);
  const w = size * 0.72;
  const stacked = count > 1;

  let rotateVal = "0deg";
  let translateVal = "";
  if (isOpponent && !isHovered) {
    if (o.tapped) {
      rotateVal = "270deg";
      translateVal = `translateY(-${w}px) translateX(-${size}px)`;
    } else {
      rotateVal = "180deg";
      translateVal = `translateY(-${size}px) translateX(-${w}px)`;
    }
  } else {
    if (o.tapped) {
      rotateVal = "90deg";
      translateVal = `translateY(-${w}px)`;
    }
  }

  return (
    <button
      onClick={onClick}
      onMouseEnter={(e) => {
        setIsHovered(true);
        if (o.cardId) onHover?.({ id: o.cardId, name: o.name }, e);
      }}
      onMouseMove={(e) => o.cardId && onHover?.({ id: o.cardId, name: o.name }, e)}
      onMouseLeave={() => {
        setIsHovered(false);
        onHover?.(null, null as any);
      }}
      className={`game-card-wrapper relative shrink-0 transition-transform ${
        isHovered
          ? "scale-125 z-50 shadow-2xl ring-2 ring-table-accent/60"
          : "hover:scale-105 hover:z-10"
      } ${o.tapped ? "opacity-85" : ""}`}
      style={{ width: o.tapped ? size : w, height: o.tapped ? w : size }}
      title={stacked ? `${o.name} ×${count}` : o.name}
    >
      {/* Depth: peek a couple of cards behind when this is a stack. */}
      {stacked && (
        <>
          <div className="absolute rounded-md bg-black/40 shadow-card" style={{ width: w, height: size, left: 5, top: 5 }} />
          <div className="absolute rounded-md bg-black/30 shadow-card" style={{ width: w, height: size, left: 2.5, top: 2.5 }} />
        </>
      )}
      <div
        className="absolute left-0 top-0 origin-top-left transition-transform"
        style={{ width: w, height: size, transform: rotateVal !== "0deg" || translateVal !== "" ? `rotate(${rotateVal}) ${translateVal}` : "none" }}
      >
        <CardImage
          id={o.faceDown ? null : o.cardId}
          name={o.faceDown ? "Card" : o.name}
          className={`rounded-md shadow-card ${
            o.attacking !== null
              ? "ring-2 ring-red-500 card-attacking"
              : o.blocking
                ? "ring-2 ring-sky-400 card-blocking"
                : ""
          }`}
        />
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
      {/* Stack count badge. */}
      {stacked && (
        <span className="absolute -right-1 -top-1 z-10 flex h-5 min-w-5 items-center justify-center rounded-full border border-black/50 bg-table-accent px-1 text-[11px] font-bold text-black shadow">
          ×{count}
        </span>
      )}
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
          <span key={s.step} className={`rounded px-1.5 py-0.5 text-[10px] transition-all duration-150 ${i === idx ? "bg-table-accent text-black font-bold shadow-md shadow-table-accent/20" : "text-table-muted bg-table-panel2/50"}`}>
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
      <button className="btn-ghost !py-1" onClick={() => t.send({ type: "end_turn" })} disabled={!isActive} title="Skip through the rest of your turn to the next player">
        End turn ⏭
      </button>
      {state.step === "main1" && (
        <button className="btn-ghost !py-1 text-amber-200 border-amber-500/30 hover:border-amber-500/50" onClick={() => t.send({ type: "skip_combat", seat: you })} disabled={!hasPriority}>
          Skip Combat
        </button>
      )}
      {/* Draw and untap happen automatically on the draw/untap steps — the manual
          versions live in the ⚙ Manual override panel so they can't be spammed. */}
    </div>
  );
}

// Read-only life for the bottom bar — life is controlled by the game engine
// (combat, effects). Manual adjustment lives in the ⚙ Manual override panel.
function LifeDisplay({ p }: { p: PlayerState }) {
  return (
    <div className="flex items-center gap-1.5 rounded-lg bg-table-panel2 px-2 py-0.5">
      <Avatar cardId={p.avatarCardId} name={p.name} size={30} ring />
      <span className={`life-diamond font-display text-lg font-bold text-white ${p.life <= 5 ? "animate-pulse border-red-500 shadow-red-500/55 shadow-[0_0_12px]" : ""}`} style={{ width: 42, height: 42 }}>
        <span>{p.life}</span>
      </span>
      {p.poison > 0 && <span className="chip text-green-300" title="Poison counters">☠{p.poison}</span>}
    </div>
  );
}

// Escape hatches for when the engine can't yet do something. Clearly separated
// from normal play, and every action here is a logged manual override.
function ManualOverridePanel({ me, t, you }: { me: PlayerState; t: TableConn; you: number }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-amber-500/30 bg-amber-950/20 px-3 py-2 text-sm">
      <span className="text-[10px] font-bold uppercase tracking-wider text-amber-300">⚙ Manual override</span>
      <span className="text-[10px] text-table-muted">— bypasses the engine · logged</span>

      <div className="flex items-center gap-1">
        <span className="text-xs text-table-muted">Life</span>
        <button className="btn-ghost h-7 w-7 !px-0" onClick={() => t.send({ type: "adjust_life", seat: you, delta: -1 })} title="−1 life">−</button>
        <span className="w-7 text-center tabular-nums font-semibold">{me.life}</span>
        <button className="btn-ghost h-7 w-7 !px-0" onClick={() => t.send({ type: "adjust_life", seat: you, delta: 1 })} title="+1 life">+</button>
      </div>

      <div className="flex items-center gap-1">
        <span className="text-xs text-table-muted">Poison</span>
        <button className="btn-ghost h-7 w-7 !px-0" onClick={() => t.send({ type: "set_poison", seat: you, value: Math.max(0, me.poison - 1) })} title="−1 poison">−</button>
        <span className="w-6 text-center tabular-nums font-semibold text-green-300">{me.poison}</span>
        <button className="btn-ghost h-7 w-7 !px-0" onClick={() => t.send({ type: "set_poison", seat: you, value: me.poison + 1 })} title="+1 poison">+</button>
      </div>

      <ManaControl p={me} t={t} />

      <div className="flex items-center gap-1">
        <button className="chip hover:border-table-accent" onClick={() => t.send({ type: "draw", seat: you, count: 1 })}>Draw 1</button>
        <button className="chip hover:border-table-accent" onClick={() => t.send({ type: "untap_all", seat: you })}>Untap all</button>
        <button className="chip hover:border-table-accent" onClick={() => t.send({ type: "shuffle", seat: you })}>Shuffle</button>
      </div>
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
export function DiceRoller({ t, seat }: { t: TableConn; seat: number }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    window.addEventListener("mousedown", h);
    return () => window.removeEventListener("mousedown", h);
  }, []);
  
  return (
    <div ref={ref} className="relative flex items-center">
      <button
        className={`chip hover:border-table-accent font-semibold flex items-center gap-1 ${open ? "border-table-accent text-table-accentSoft" : ""}`}
        onClick={() => setOpen(!open)}
        title="Dice Roller Tray"
      >
        🎲 Dice Tray
      </button>
      
      {open && (
        <div className="absolute bottom-9 right-0 z-50 p-2.5 rounded-lg border border-table-border bg-[#0b0f19] shadow-2xl flex gap-1.5 min-w-max">
          {[4, 6, 8, 10, 12, 20].map((sides) => (
            <button
              key={sides}
              className="btn-ghost !p-1 text-xs font-semibold flex flex-col items-center justify-center border border-table-border/40 bg-table-panel2/30 hover:border-table-accent/40 rounded h-14 w-14"
              onClick={() => {
                t.send({ type: "roll", seat, sides, count: 1 });
                setOpen(false);
              }}
              title={`Roll d${sides}`}
            >
              <div className="w-8 h-8 mb-0.5 pointer-events-none">
                <DiceGraphic sides={sides} result={sides} />
              </div>
              <span className="text-[8px] text-table-muted">d{sides}</span>
            </button>
          ))}
          <button
            className="btn-ghost !p-1 text-xs font-semibold flex flex-col items-center justify-center border border-table-border/40 bg-table-panel2/30 hover:border-table-accent/40 rounded h-14 w-14"
            onClick={() => {
              t.send({ type: "roll", seat, sides: 2, count: 1, label: "coin" });
              setOpen(false);
            }}
            title="Flip a coin"
          >
            <div className="text-xl mb-0.5 pointer-events-none">🪙</div>
            <span className="text-[8px] text-table-muted">coin</span>
          </button>
        </div>
      )}
    </div>
  );
}

// Shows an animated overlay whenever a new roll appears in the shared state, so
// every player sees the same roll animate.
export function RollOverlay({ roll }: { roll: RollResult | null }) {
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
    <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center">
      <div className="flex flex-col items-center gap-3">
        <div className="dice-tumble flex h-24 w-24 items-center justify-center">
          {isCoin ? (
            <div className="flex h-20 w-20 items-center justify-center rounded-full bg-amber-500 border-2 border-amber-600 text-3xl font-bold text-black shadow-panel animate-coin-flip">
              🪙
            </div>
          ) : (
            <DiceGraphic sides={current.sides} result={current.total} />
          )}
        </div>
        <div className="max-w-md rounded-lg bg-black/90 px-4 py-2 text-center text-sm font-semibold text-table-ink shadow-panel border border-table-border/40 backdrop-blur-sm">
          {isCoin ? `${current.text} (Flipped: ${faceText})` : current.text}
        </div>
      </div>
    </div>
  );
}

// ---- token picker -------------------------------------------------------
export interface TokenCard {
  id: string;
  name: string;
  typeLine: string;
  power: string | null;
  toughness: string | null;
  colors: string[];
  imageUrl: string | null;
}

export function TokenPicker({ onClose, onPick }: { onClose: () => void; onPick: (t: TokenCard) => void }) {
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
  const { user } = useAuth();
  const isAdmin = user?.isAdmin ?? false;
  const [abilities, setAbilities] = useState<Ability[]>([]);
  const [detail, setDetail] = useState<CardDetailResponse["card"] | null>(null);
  const cardId = o?.cardId;
  useEffect(() => {
    if (!cardId) return;
    let cancelled = false;
    api
      .get<CardDetailResponse>(`/api/cards/${cardId}`)
      .then((d) => {
        if (cancelled) return;
        setDetail(d.card);
        setAbilities(parseAbilities(d.card.oracleText, d.card.name));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [cardId]);
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

  // Rules-aware flags. Prefer the fetched card's types; fall back to what the
  // engine surfaced on the object. Keywords are matched case-insensitively.
  const types = detail?.cardTypes ?? o.cardTypes ?? [];
  const kw = (detail?.keywords ?? o.keywords ?? []).map((k) => k.toLowerCase());
  const isLand = types.includes("Land");
  const isCreature = types.includes("Creature");
  const isInstantSorcery = types.includes("Instant") || types.includes("Sorcery");
  const hasHaste = kw.includes("haste");
  const hasDefender = kw.includes("defender");

  const mine = you !== null && o.controllerSeat === you;
  const canManipulate = mine || isAdmin; // only your own permanents (admin = referee)

  // Attack only in your combat with a creature that can legally attack.
  const canAttack =
    mine &&
    isCreature &&
    !o.tapped &&
    !hasDefender &&
    (!o.summoningSick || hasHaste) &&
    o.attacking === null &&
    you === state.activeSeat &&
    (state.step === "declare_attackers" || state.step === "begin_combat");
  // Block only during the opponent's declare-blockers step with an untapped creature.
  const attackers = Object.values(state.objects).filter((a) => a.attacking !== null && a.zone === "battlefield" && a.controllerSeat !== you);
  const canBlock = mine && isCreature && !o.tapped && you !== state.activeSeat && state.step === "declare_blockers" && attackers.length > 0;

  return (
    <div ref={ref} className="panel fixed z-50 w-52 overflow-hidden py-1" style={style}>
      <div className="truncate border-b border-table-border px-3 py-1 text-xs text-table-muted">
        {o.name}
        {!mine && o.zone === "battlefield" && <span className="ml-1 text-[10px] text-amber-300/80">· opponent's</span>}
      </div>
      {o.zone === "battlefield" && (
        <>
          {/* Opponent's permanent: no direct manipulation — you affect it through
              your own spells/abilities (targeting), not by hand. */}
          {!canManipulate && (
            <div className="px-3 py-2 text-xs text-table-muted">
              You can't act on an opponent's permanent directly. Target it with a spell or ability instead.
            </div>
          )}
          {canManipulate && (
            <>
              {mine &&
                abilities.map((ab) => (
                  <Item
                    key={`ab${ab.index}`}
                    label={`▶ ${ab.cost}`}
                    onClick={() => onActivate(o, ab.index, ab.effect.targets, ab.effect.ops.some((op) => (op as { xScaled?: boolean }).xScaled))}
                  />
                ))}
              {mine && abilities.length > 0 && <div className="my-1 border-t border-table-border" />}
              {canAttack &&
                state.players
                  .filter((p) => p.seat !== you && !p.hasLost)
                  .map((p) => (
                    <Item key={`atk${p.seat}`} label={`⚔ Attack ${p.name}`} onClick={() => t.send({ type: "declare_attacker", objectId: o.id, defendingSeat: p.seat })} />
                  ))}
              {canBlock &&
                attackers.map((a) => (
                  <Item key={`blk${a.id}`} label={`🛡 Block ${a.name}`} onClick={() => t.send({ type: "declare_blocker", blockerId: o.id, attackerId: a.id })} />
                ))}
              {o.attacking !== null && mine && <Item label="✖ Remove from combat" onClick={() => t.send({ type: "declare_attacker", objectId: o.id, defendingSeat: -1 })} />}
              <Item label={o.tapped ? "Untap" : "Tap"} onClick={() => t.send({ type: "tap", objectId: o.id, tapped: !o.tapped })} />
              <Item label="Add +1/+1" onClick={() => t.send({ type: "add_counter", objectId: o.id, counterType: "+1/+1", delta: 1 })} />
              <Item label="Add -1/-1" onClick={() => t.send({ type: "add_counter", objectId: o.id, counterType: "-1/-1", delta: 1 })} />
              <Item label="Flip face down/up" onClick={() => t.send({ type: "flip", objectId: o.id, faceDown: !o.faceDown })} />
              <Item label="Return to hand" onClick={() => t.send({ type: "keyword_action", objectId: o.id, action: "bounce" })} />
              <Item label="Destroy" onClick={() => t.send({ type: "keyword_action", objectId: o.id, action: "destroy" })} danger />
              <Item label="Sacrifice" onClick={() => t.send({ type: "keyword_action", objectId: o.id, action: "sacrifice" })} danger />
              <Item label="Exile" onClick={() => t.send({ type: "keyword_action", objectId: o.id, action: "exile" })} />
            </>
          )}
        </>
      )}
      {(o.zone === "hand" || o.zone === "command") && mine && (
        <>
          {/* Type-aware: lands are played, everything else is cast. */}
          {isLand ? (
            <Item label="Play land" onClick={() => move("battlefield")} />
          ) : (
            <Item label={isInstantSorcery ? "Cast" : "Cast (to stack)"} onClick={() => onCast(o)} />
          )}
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

// ---- Dice Graphic Polyhedral Shapes ----
function DiceGraphic({ sides, result }: { sides: number; result: number }) {
  if (sides === 4) {
    return (
      <svg width="64" height="64" viewBox="0 0 64 64" className="w-full h-full text-table-accentSoft filter drop-shadow-[0_2px_8px_rgba(var(--c-accent),0.25)]">
        <polygon points="32,6 5,55 59,55" fill="#0f172a" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round" />
        <line x1="32" y1="36" x2="32" y2="6" stroke="currentColor" strokeWidth="1.2" opacity="0.6" />
        <line x1="32" y1="36" x2="5" y2="55" stroke="currentColor" strokeWidth="1.2" opacity="0.6" />
        <line x1="32" y1="36" x2="59" y2="55" stroke="currentColor" strokeWidth="1.2" opacity="0.6" />
        <text x="32" y="47" textAnchor="middle" fill="#fff" fontSize="15" fontWeight="bold" fontFamily="sans-serif">
          {result}
        </text>
      </svg>
    );
  }
  if (sides === 6) {
    return (
      <svg width="64" height="64" viewBox="0 0 64 64" className="w-full h-full text-table-accentSoft filter drop-shadow-[0_2px_8px_rgba(var(--c-accent),0.25)]">
        <rect x="8" y="8" width="48" height="48" rx="6" fill="#0f172a" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round" />
        <text x="32" y="39" textAnchor="middle" fill="#fff" fontSize="20" fontWeight="bold" fontFamily="sans-serif">
          {result}
        </text>
      </svg>
    );
  }
  if (sides === 8) {
    return (
      <svg width="64" height="64" viewBox="0 0 64 64" className="w-full h-full text-table-accentSoft filter drop-shadow-[0_2px_8px_rgba(var(--c-accent),0.25)]">
        <polygon points="32,4 60,32 32,60 4,32" fill="#0f172a" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round" />
        <line x1="4" y1="32" x2="60" y2="32" stroke="currentColor" strokeWidth="1.5" opacity="0.6" />
        <line x1="32" y1="4" x2="32" y2="60" stroke="currentColor" strokeWidth="1" opacity="0.4" />
        <text x="32" y="38" textAnchor="middle" fill="#fff" fontSize="18" fontWeight="bold" fontFamily="sans-serif">
          {result}
        </text>
      </svg>
    );
  }
  if (sides === 10) {
    return (
      <svg width="64" height="64" viewBox="0 0 64 64" className="w-full h-full text-table-accentSoft filter drop-shadow-[0_2px_8px_rgba(var(--c-accent),0.25)]">
        <polygon points="32,4 58,26 48,56 32,60 16,56 6,26" fill="#0f172a" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round" />
        <line x1="32" y1="34" x2="32" y2="4" stroke="currentColor" strokeWidth="1.2" opacity="0.6" />
        <line x1="32" y1="34" x2="58" y2="26" stroke="currentColor" strokeWidth="1.2" opacity="0.6" />
        <line x1="32" y1="34" x2="48" y2="56" stroke="currentColor" strokeWidth="1.2" opacity="0.6" />
        <line x1="32" y1="34" x2="16" y2="56" stroke="currentColor" strokeWidth="1.2" opacity="0.6" />
        <line x1="32" y1="34" x2="6" y2="26" stroke="currentColor" strokeWidth="1.2" opacity="0.6" />
        <text x="32" y="44" textAnchor="middle" fill="#fff" fontSize="16" fontWeight="bold" fontFamily="sans-serif">
          {result}
        </text>
      </svg>
    );
  }
  if (sides === 12) {
    return (
      <svg width="64" height="64" viewBox="0 0 64 64" className="w-full h-full text-table-accentSoft filter drop-shadow-[0_2px_8px_rgba(var(--c-accent),0.25)]">
        <polygon points="32,4 58,23 48,56 16,56 6,23" fill="#0f172a" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round" />
        <polygon points="32,20 44,28 39,44 25,44 20,28" fill="none" stroke="currentColor" strokeWidth="1" opacity="0.7" />
        <line x1="32" y1="4" x2="32" y2="20" stroke="currentColor" strokeWidth="1" opacity="0.6" />
        <line x1="58" y1="23" x2="44" y2="28" stroke="currentColor" strokeWidth="1" opacity="0.6" />
        <line x1="48" y1="56" x2="39" y2="44" stroke="currentColor" strokeWidth="1" opacity="0.6" />
        <line x1="16" y1="56" x2="25" y2="44" stroke="currentColor" strokeWidth="1" opacity="0.6" />
        <line x1="6" y1="23" x2="20" y2="28" stroke="currentColor" strokeWidth="1" opacity="0.6" />
        <text x="32" y="38" textAnchor="middle" fill="#fff" fontSize="15" fontWeight="bold" fontFamily="sans-serif">
          {result}
        </text>
      </svg>
    );
  }
  if (sides === 20) {
    return (
      <svg width="64" height="64" viewBox="0 0 64 64" className="w-full h-full text-table-accentSoft filter drop-shadow-[0_2px_8px_rgba(var(--c-accent),0.25)]">
        <polygon points="32,4 58,19 58,49 32,60 6,49 6,19" fill="#0f172a" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round" />
        <polygon points="32,20 48,42 16,42" fill="none" stroke="currentColor" strokeWidth="1.2" opacity="0.7" />
        <line x1="32" y1="4" x2="32" y2="20" stroke="currentColor" strokeWidth="1" opacity="0.6" />
        <line x1="6" y1="19" x2="16" y2="42" stroke="currentColor" strokeWidth="1" opacity="0.6" />
        <line x1="58" y1="19" x2="48" y2="42" stroke="currentColor" strokeWidth="1" opacity="0.6" />
        <line x1="6" y1="49" x2="16" y2="42" stroke="currentColor" strokeWidth="1" opacity="0.6" />
        <line x1="58" y1="49" x2="48" y2="42" stroke="currentColor" strokeWidth="1" opacity="0.6" />
        <line x1="32" y1="60" x2="16" y2="42" stroke="currentColor" strokeWidth="1" opacity="0.6" />
        <line x1="32" y1="60" x2="48" y2="42" stroke="currentColor" strokeWidth="1" opacity="0.6" />
        <text x="32" y="38" textAnchor="middle" fill="#fff" fontSize="14" fontWeight="bold" fontFamily="sans-serif">
          {result}
        </text>
      </svg>
    );
  }
  return null;
}

// ---- Visual stack representing library / graveyard / exile ----
function CardStackDeck({
  count,
  faceUpCardId,
  label,
  onClick,
  onRightClick,
  size = 96,
  id,
}: {
  count: number;
  faceUpCardId?: string | null;
  label: string;
  onClick?: () => void;
  onRightClick?: (e: React.MouseEvent) => void;
  size?: number;
  id?: string;
}) {
  const w = size * 0.72;
  const layers = Math.min(6, Math.ceil(count / 8));
  return (
    <div
      id={id}
      className="relative cursor-pointer select-none"
      style={{ width: w, height: size }}
      onClick={onClick}
      onContextMenu={onRightClick}
      title={`${label} (${count} cards) - click to interact`}
    >
      {count === 0 ? (
        <div className="w-full h-full rounded-md border-2 border-dashed border-table-border/30 flex flex-col items-center justify-center text-center p-1 text-[9px] text-table-muted bg-black/10">
          <span className="font-semibold uppercase tracking-wider text-[7px] mb-0.5 leading-snug">{label}</span>
          <span className="text-[7px] opacity-60">empty</span>
        </div>
      ) : (
        <>
          {Array.from({ length: layers }).map((_, idx) => {
            const shift = idx * 0.6;
            return (
              <div
                key={idx}
                className="absolute rounded-md border border-black/50 bg-[#0f172a] shadow"
                style={{
                  left: -shift,
                  top: -shift,
                  width: w,
                  height: size,
                  zIndex: idx,
                }}
              />
            );
          })}
          <div
            className="absolute rounded-md"
            style={{
              left: -layers * 0.6,
              top: -layers * 0.6,
              width: w,
              height: size,
              zIndex: layers,
            }}
          >
            <CardImage id={faceUpCardId ?? null} name={faceUpCardId ? "Card" : "Back"} className="rounded-md shadow-card" />
            <span className="absolute -right-1 -top-1 z-10 flex h-4 min-w-4 items-center justify-center rounded-full border border-black/50 bg-table-accent px-0.5 text-[8px] font-bold text-black shadow-lg">
              {count}
            </span>
            <div className="absolute inset-x-0 bottom-0.5 bg-black/75 py-0.5 text-center text-[8px] font-semibold text-table-muted uppercase tracking-wider rounded-b">
              {label}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ---- floating Library Context Menu ----
function LibraryContextMenu({ menu, t, onClose, onBrowse }: { menu: { seat: number; x: number; y: number }; t: TableConn; onClose: () => void; onBrowse: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    window.addEventListener("mousedown", h);
    return () => window.removeEventListener("mousedown", h);
  }, [onClose]);
  const act = (fn: () => void) => () => { fn(); onClose(); };
  return (
    <div ref={ref} className="panel fixed z-50 w-48 overflow-hidden py-1" style={{ left: menu.x, top: menu.y }}>
      <div className="truncate border-b border-table-border px-3 py-1 text-xs text-table-muted font-bold">Library Options</div>
      <button className="block w-full px-3 py-1.5 text-left text-sm hover:bg-table-panel2" onClick={act(() => t.send({ type: "draw", seat: menu.seat, count: 1 }))}>Draw 1 Card</button>
      <button className="block w-full px-3 py-1.5 text-left text-sm hover:bg-table-panel2" onClick={act(() => t.send({ type: "draw", seat: menu.seat, count: 7 }))}>Draw 7 Cards</button>
      <button className="block w-full px-3 py-1.5 text-left text-sm hover:bg-table-panel2" onClick={act(() => t.send({ type: "shuffle", seat: menu.seat }))}>Shuffle Library</button>
      <button className="block w-full px-3 py-1.5 text-left text-sm hover:bg-table-panel2" onClick={act(onBrowse)}>Browse Library</button>
    </div>
  );
}
