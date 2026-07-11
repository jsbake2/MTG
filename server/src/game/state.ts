// Helpers to build and reason about a TableState. Pure/card-agnostic — the
// framework rules engine (engine.ts) uses these.
import { randomUUID } from "node:crypto";
import {
  emptyManaPool,
  TURN_STEPS,
  type GameObject,
  type LogEntry,
  type PlayerState,
  type TableState,
  type ZoneId,
} from "@mtg/shared";
import { getFormat } from "@mtg/shared";

export interface SeatDeck {
  seat: number;
  userId: string | null;
  name: string;
  // main-board cards expanded per copy: { cardId, oracleId, name }
  library: Array<{ cardId: string; oracleId: string; name: string }>;
  commanders: Array<{ cardId: string; oracleId: string; name: string }>;
}

export function newObject(partial: Partial<GameObject> & Pick<GameObject, "name" | "ownerSeat" | "zone">): GameObject {
  return {
    id: randomUUID(),
    cardId: null,
    oracleId: null,
    faceIndex: 0,
    controllerSeat: partial.ownerSeat,
    x: 0,
    y: 0,
    tapped: false,
    faceDown: false,
    summoningSick: false,
    counters: [],
    damage: 0,
    attachedTo: null,
    isToken: false,
    isCommander: false,
    note: null,
    ptOverride: null,
    attacking: null,
    blocking: null,
    ...partial,
  };
}

// Seeded shuffle would be nicer for reproducibility, but a plain shuffle is fine
// for a family game; each player's library is private anyway.
function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

export function buildInitialState(opts: {
  id: string;
  name: string;
  formatId: string;
  enforcement: "relaxed" | "strict";
  seats: SeatDeck[];
}): TableState {
  const format = getFormat(opts.formatId);
  const startingLife = format?.startingLife ?? 20;
  const players: PlayerState[] = [];
  const objects: Record<string, GameObject> = {};

  for (const seat of opts.seats) {
    const commanderDamage: Record<number, number> = {};
    for (const other of opts.seats) commanderDamage[other.seat] = 0;
    players.push({
      seat: seat.seat,
      userId: seat.userId,
      name: seat.name,
      life: startingLife,
      poison: 0,
      commanderDamage,
      manaPool: emptyManaPool(),
      landsPlayedThisTurn: 0,
      hasLost: false,
      hasConceded: false,
      connected: true,
      handCount: 0,
      libraryCount: 0,
    });

    // Library
    const lib = shuffle(seat.library);
    for (const card of lib) {
      const obj = newObject({ name: card.name, ownerSeat: seat.seat, zone: "library" });
      obj.cardId = card.cardId;
      obj.oracleId = card.oracleId;
      objects[obj.id] = obj;
    }
    // Commanders -> command zone
    for (const card of seat.commanders) {
      const obj = newObject({ name: card.name, ownerSeat: seat.seat, zone: "command" });
      obj.cardId = card.cardId;
      obj.oracleId = card.oracleId;
      obj.isCommander = true;
      objects[obj.id] = obj;
    }
  }

  const startingSeat = opts.seats[0]?.seat ?? 0;
  const state: TableState = {
    id: opts.id,
    name: opts.name,
    formatId: opts.formatId,
    status: "mulligan",
    players,
    activeSeat: startingSeat,
    prioritySeat: startingSeat,
    turnNumber: 1,
    phase: "beginning",
    step: "untap",
    stackOrder: [],
    objects,
    enforcement: opts.enforcement,
    startingPlayerSeat: startingSeat,
    log: [],
    revision: 0,
    winnerSeat: null,
    passStreak: 0,
  };
  recountHiddenZones(state);
  return state;
}

export function recountHiddenZones(state: TableState): void {
  for (const p of state.players) {
    p.handCount = 0;
    p.libraryCount = 0;
  }
  for (const o of Object.values(state.objects)) {
    const p = state.players.find((pp) => pp.seat === o.ownerSeat);
    if (!p) continue;
    if (o.zone === "hand") p.handCount++;
    else if (o.zone === "library") p.libraryCount++;
  }
}

export function objectsIn(state: TableState, zone: ZoneId, seat?: number): GameObject[] {
  return Object.values(state.objects).filter(
    (o) => o.zone === zone && (seat === undefined || (zone === "battlefield" ? o.controllerSeat === seat : o.ownerSeat === seat)),
  );
}

export function libraryOrdered(state: TableState, seat: number): GameObject[] {
  // Library ordering is implicit by insertion order via a `y` position we keep
  // updated on move. We store top-of-library as the lowest y.
  return objectsIn(state, "library", seat).sort((a, b) => a.y - b.y);
}

export function nextLogId(state: TableState): number {
  return state.log.length ? state.log[state.log.length - 1]!.id + 1 : 1;
}

export function log(state: TableState, entry: Omit<LogEntry, "id" | "ts">): void {
  state.log.push({ ...entry, id: nextLogId(state), ts: Date.now() });
  if (state.log.length > 500) state.log.splice(0, state.log.length - 500);
}

export function stepIndex(phase: TableState["phase"], step: TableState["step"]): number {
  return TURN_STEPS.findIndex((s) => s.phase === phase && s.step === step);
}

// Effective power/toughness from printed values + counters + manual override.
export function effectivePT(state: TableState, o: GameObject, printed?: { power: string | null; toughness: string | null }): { power: number; toughness: number } {
  const parse = (v: string | null | undefined): number => {
    if (!v) return 0;
    const n = parseInt(v.replace(/[^0-9-]/g, ""), 10);
    return Number.isFinite(n) ? n : 0;
  };
  let power = o.ptOverride ? o.ptOverride.power : parse(printed?.power);
  let toughness = o.ptOverride ? o.ptOverride.toughness : parse(printed?.toughness);
  for (const c of o.counters) {
    if (c.type === "+1/+1") {
      power += c.count;
      toughness += c.count;
    } else if (c.type === "-1/-1") {
      power -= c.count;
      toughness -= c.count;
    }
  }
  return { power, toughness };
}

export function connectedPlayers(state: TableState): PlayerState[] {
  return state.players.filter((p) => !p.hasLost && !p.hasConceded);
}

export function nextSeatInTurnOrder(state: TableState, seat: number): number {
  const alive = state.players.filter((p) => !p.hasLost && !p.hasConceded).map((p) => p.seat).sort((a, b) => a - b);
  if (alive.length === 0) return seat;
  const idx = alive.indexOf(seat);
  return alive[(idx + 1) % alive.length]!;
}
