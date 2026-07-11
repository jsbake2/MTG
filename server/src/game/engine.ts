// The framework rules engine. It enforces the card-agnostic skeleton of Magic
// (turns, phases, priority, land drops, timing, summoning sickness, combat +
// damage math, the stack, and state-based checks) over a TableState. Card
// *effects* are performed by players via these same actions — the engine never
// needs to know what any specific card does. See why-not-full-rules-engine memory.
import {
  TURN_STEPS,
  type GameAction,
  type GameObject,
  type ManaColor,
  type TableState,
  type ZoneId,
} from "@mtg/shared";
import { getFormat } from "@mtg/shared";
import {
  effectivePT,
  libraryOrdered,
  log,
  nextLogId,
  nextSeatInTurnOrder,
  objectsIn,
  recountHiddenZones,
} from "./state.js";

export interface CardInfo {
  typeLine: string;
  cardTypes: string[];
  power: string | null;
  toughness: string | null;
  keywords: string[];
  oracleText: string | null;
}
export type CardIndex = Record<string, CardInfo>;

export interface ApplyResult {
  ok: boolean;
  error?: string;
}

const PERMANENT_TYPES = ["Artifact", "Creature", "Enchantment", "Land", "Planeswalker", "Battle"];

function info(ctx: CardIndex, o: GameObject): CardInfo | null {
  return o.cardId ? ctx[o.cardId] ?? null : null;
}
function hasType(ctx: CardIndex, o: GameObject, t: string): boolean {
  const ci = info(ctx, o);
  if (ci) return ci.cardTypes.includes(t);
  // Tokens without card data fall back to what we know.
  return false;
}
function isCreature(ctx: CardIndex, o: GameObject): boolean {
  if (o.isToken && o.ptOverride) return true;
  return hasType(ctx, o, "Creature");
}
function isLand(ctx: CardIndex, o: GameObject): boolean {
  return hasType(ctx, o, "Land");
}
function hasKeyword(ctx: CardIndex, o: GameObject, kw: string): boolean {
  const ci = info(ctx, o);
  if (!ci) return false;
  const k = kw.toLowerCase();
  return ci.keywords.some((x) => x.toLowerCase() === k) || (ci.oracleText ?? "").toLowerCase().includes(k);
}
function isInstantSpeed(ctx: CardIndex, o: GameObject): boolean {
  const ci = info(ctx, o);
  if (!ci) return true; // unknown/token — don't block
  if (ci.cardTypes.includes("Instant")) return true;
  return hasKeyword(ctx, o, "flash");
}
function isPermanentSpell(ctx: CardIndex, o: GameObject): boolean {
  const ci = info(ctx, o);
  if (!ci) return true;
  return ci.cardTypes.some((t) => PERMANENT_TYPES.includes(t));
}
function isMainPhase(state: TableState): boolean {
  return state.phase === "precombat_main" || state.phase === "postcombat_main";
}
function aliveSeats(state: TableState): number[] {
  return state.players.filter((p) => !p.hasLost && !p.hasConceded).map((p) => p.seat);
}

// Returns null when the rule is satisfied OR was bypassed in relaxed mode
// (proceed). Returns an error result only in strict mode on a violation.
function enforce(state: TableState, satisfied: boolean, message: string): ApplyResult | null {
  if (satisfied) return null;
  if (state.enforcement === "strict") return { ok: false, error: message };
  log(state, { seat: null, kind: "system", text: `⚠︎ ${message} (allowed — relaxed mode)` });
  return null;
}

function playerBySeat(state: TableState, seat: number) {
  return state.players.find((p) => p.seat === seat);
}

// ---- state-based checks -------------------------------------------------
export function checkStateBased(state: TableState, ctx: CardIndex): void {
  const format = getFormat(state.formatId);
  for (const p of state.players) {
    if (p.hasLost) continue;
    if (p.life <= 0) {
      p.hasLost = true;
      log(state, { seat: p.seat, kind: "system", text: `${p.name} loses (life ${p.life}).` });
    } else if (p.poison >= 10) {
      p.hasLost = true;
      log(state, { seat: p.seat, kind: "system", text: `${p.name} loses to poison.` });
    } else if (format?.commanderDamageLethal) {
      for (const [from, dmg] of Object.entries(p.commanderDamage)) {
        if (dmg >= format.commanderDamageLethal) {
          p.hasLost = true;
          log(state, { seat: p.seat, kind: "system", text: `${p.name} loses to commander damage.` });
          break;
        }
      }
    }
  }
  // Lethal-damage / zero-toughness creature death (auto damage math promise).
  for (const o of objectsIn(state, "battlefield")) {
    if (!isCreature(ctx, o)) continue;
    const ci = info(ctx, o);
    const { toughness } = effectivePT(state, o, ci ?? undefined);
    if (toughness <= 0 || (o.damage > 0 && o.damage >= toughness)) {
      moveObject(state, ctx, o, "graveyard", o.ownerSeat, {});
      log(state, { seat: o.controllerSeat, kind: "combat", text: `${o.name} dies.` });
    }
  }
  const alive = aliveSeats(state);
  if (alive.length === 1 && state.status === "playing") {
    state.winnerSeat = alive[0]!;
    state.status = "finished";
    log(state, { seat: alive[0]!, kind: "system", text: `${playerBySeat(state, alive[0]!)?.name} wins the game!` });
  }
}

// ---- core mutation: move an object between zones -------------------------
function moveObject(
  state: TableState,
  ctx: CardIndex,
  o: GameObject,
  toZone: ZoneId,
  toSeat: number,
  opts: { x?: number; y?: number; toTop?: boolean },
): void {
  const fromZone = o.zone;
  // Leaving the battlefield/stack resets transient permanent state.
  if (fromZone === "battlefield" && toZone !== "battlefield") {
    o.tapped = false;
    o.counters = [];
    o.damage = 0;
    o.attachedTo = null;
    o.attacking = null;
    o.blocking = null;
    o.ptOverride = null;
    o.summoningSick = false;
  }
  o.zone = toZone;
  if (toZone === "battlefield") {
    o.controllerSeat = toSeat;
    o.x = opts.x ?? o.x;
    o.y = opts.y ?? o.y;
    if (isCreature(ctx, o)) o.summoningSick = !hasKeyword(ctx, o, "haste");
  } else {
    o.controllerSeat = o.ownerSeat;
  }
  if (toZone === "library") {
    const lib = libraryOrdered(state, o.ownerSeat).filter((x) => x.id !== o.id);
    const minY = lib.length ? lib[0]!.y : 0;
    const maxY = lib.length ? lib[lib.length - 1]!.y : 0;
    o.y = opts.toTop ? minY - 1 : maxY + 1;
  }
  recountHiddenZones(state);
}

// ---- turn / step advancement -------------------------------------------
function advanceStep(state: TableState, ctx: CardIndex): void {
  const idx = TURN_STEPS.findIndex((s) => s.phase === state.phase && s.step === state.step);
  const next = idx + 1;
  state.passStreak = 0;
  if (next >= TURN_STEPS.length) {
    // New turn.
    const nextActive = nextSeatInTurnOrder(state, state.activeSeat);
    state.turnNumber += 1;
    state.activeSeat = nextActive;
    state.phase = "beginning";
    state.step = "untap";
    state.turnStartedAt = Date.now();
    onEnterStep(state, ctx);
    return;
  }
  const step = TURN_STEPS[next]!;
  state.phase = step.phase;
  state.step = step.step;
  onEnterStep(state, ctx);
}

// Automatic actions that happen when a step begins.
function onEnterStep(state: TableState, ctx: CardIndex): void {
  const active = playerBySeat(state, state.activeSeat);
  state.prioritySeat = state.activeSeat;
  state.passStreak = 0;
  if (state.step === "untap") {
    if (active) active.landsPlayedThisTurn = 0;
    for (const o of objectsIn(state, "battlefield", state.activeSeat)) {
      o.tapped = false;
      o.summoningSick = false; // controlled since last turn
    }
    log(state, { seat: state.activeSeat, kind: "phase", text: `Turn ${state.turnNumber}: ${active?.name}'s untap.` });
  } else if (state.step === "draw") {
    // First player skips their first draw in a 2-player game.
    const skip = state.turnNumber === 1 && state.activeSeat === state.startingPlayerSeat && aliveSeats(state).length === 2;
    if (!skip && active) {
      drawCards(state, state.activeSeat, 1);
      log(state, { seat: state.activeSeat, kind: "phase", text: `${active.name} draws for the turn.` });
    }
  } else if (state.step === "cleanup") {
    // Empty mana, remove combat damage marks, clear combat.
    for (const p of state.players) p.manaPool = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
    for (const o of objectsIn(state, "battlefield")) {
      o.damage = 0;
      o.attacking = null;
      o.blocking = null;
    }
  } else if (state.step === "end_combat") {
    for (const o of objectsIn(state, "battlefield")) {
      o.attacking = null;
      o.blocking = null;
    }
  }
}

function drawCards(state: TableState, seat: number, count: number): number {
  const lib = libraryOrdered(state, seat);
  let drawn = 0;
  for (let i = 0; i < count && i < lib.length; i++) {
    lib[i]!.zone = "hand";
    drawn++;
  }
  recountHiddenZones(state);
  return drawn;
}

function resolveTop(state: TableState, ctx: CardIndex): void {
  const topId = state.stackOrder[state.stackOrder.length - 1];
  if (!topId) return;
  state.stackOrder.pop();
  const o = state.objects[topId];
  if (!o) return;
  if (isPermanentSpell(ctx, o)) {
    moveObject(state, ctx, o, "battlefield", o.controllerSeat, {});
    log(state, { seat: o.controllerSeat, kind: "action", text: `${o.name} resolves and enters the battlefield.` });
  } else {
    moveObject(state, ctx, o, "graveyard", o.ownerSeat, {});
    log(state, { seat: o.controllerSeat, kind: "action", text: `${o.name} resolves (perform its effect), then to the graveyard.` });
  }
}

// ---- main dispatcher ----------------------------------------------------
export function applyAction(state: TableState, ctx: CardIndex, seat: number, action: GameAction): ApplyResult {
  if (state.status === "finished") return { ok: false, error: "The game is over." };

  // Override wrapper: bypass framework checks, but log it loudly.
  if (action.type === "override") {
    const prev = state.enforcement;
    state.enforcement = "relaxed";
    log(state, { seat, kind: "override", text: `Override by ${playerBySeat(state, seat)?.name}: ${action.description}` });
    const r = applyAction(state, ctx, seat, action.inner);
    state.enforcement = prev;
    return r;
  }

  const res = dispatch(state, ctx, seat, action);
  if (res && !res.ok) return res;
  checkStateBased(state, ctx);
  state.revision += 1;
  return { ok: true };
}

function findObj(state: TableState, id: string): GameObject | undefined {
  return state.objects[id];
}

function dispatch(state: TableState, ctx: CardIndex, seat: number, action: GameAction): ApplyResult | null {
  switch (action.type) {
    case "move_card": {
      const o = findObj(state, action.objectId);
      if (!o) return { ok: false, error: "Card not found" };
      // Land drop enforcement: playing a land from hand to the battlefield.
      if (action.toZone === "battlefield" && o.zone === "hand" && isLand(ctx, o)) {
        const p = playerBySeat(state, seat);
        const timing = enforce(state, seat === state.activeSeat && isMainPhase(state) && state.stackOrder.length === 0, "You can only play lands on your own main phase with an empty stack.");
        if (timing) return timing;
        const limit = enforce(state, (p?.landsPlayedThisTurn ?? 0) < 1, "You've already played a land this turn.");
        if (limit) return limit;
        if (p) p.landsPlayedThisTurn += 1;
        log(state, { seat, kind: "action", text: `${playerBySeat(state, seat)?.name} plays ${o.name}.` });
      }
      moveObject(state, ctx, o, action.toZone, action.toSeat ?? seat, { x: action.x, y: action.y, toTop: action.toTop });
      return null;
    }
    case "tap": {
      const o = findObj(state, action.objectId);
      if (!o) return { ok: false, error: "Card not found" };
      o.tapped = action.tapped;
      return null;
    }
    case "untap_all": {
      const s = action.seat ?? seat;
      for (const o of objectsIn(state, "battlefield", s)) o.tapped = false;
      log(state, { seat: s, kind: "action", text: `${playerBySeat(state, s)?.name} untaps.` });
      return null;
    }
    case "draw": {
      const n = drawCards(state, action.seat, action.count);
      log(state, { seat: action.seat, kind: "action", text: `${playerBySeat(state, action.seat)?.name} draws ${n}.` });
      return null;
    }
    case "mill": {
      const lib = libraryOrdered(state, action.seat);
      for (let i = 0; i < action.count && i < lib.length; i++) moveObject(state, ctx, lib[i]!, "graveyard", action.seat, {});
      return null;
    }
    case "shuffle": {
      const lib = libraryOrdered(state, action.seat);
      const ys = lib.map((o) => o.y);
      for (let i = ys.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [ys[i], ys[j]] = [ys[j]!, ys[i]!];
      }
      lib.forEach((o, i) => (o.y = ys[i]!));
      log(state, { seat: action.seat, kind: "action", text: `${playerBySeat(state, action.seat)?.name} shuffles.` });
      return null;
    }
    case "scry": {
      log(state, { seat: action.seat, kind: "action", text: `${playerBySeat(state, action.seat)?.name} scries ${action.count}.` });
      return null;
    }
    case "mulligan": {
      // Return hand to library, shuffle, draw 7 (London mulligan bottoming is manual).
      for (const o of objectsIn(state, "hand", action.seat)) moveObject(state, ctx, o, "library", action.seat, {});
      const lib = libraryOrdered(state, action.seat);
      const ys = lib.map((o) => o.y).sort(() => Math.random() - 0.5);
      lib.forEach((o, i) => (o.y = ys[i]!));
      drawCards(state, action.seat, 7);
      log(state, { seat: action.seat, kind: "action", text: `${playerBySeat(state, action.seat)?.name} mulligans.` });
      return null;
    }
    case "keep_hand": {
      log(state, { seat: action.seat, kind: "action", text: `${playerBySeat(state, action.seat)?.name} keeps.` });
      // When everyone has kept, the host starts the turn via start (status flips in table.ts).
      return null;
    }
    case "set_life": {
      const p = playerBySeat(state, action.seat);
      if (p) p.life = action.life;
      return null;
    }
    case "adjust_life": {
      const p = playerBySeat(state, action.seat);
      if (p) {
        p.life += action.delta;
        log(state, { seat: action.seat, kind: "action", text: `${p.name} ${action.delta >= 0 ? "gains" : "loses"} ${Math.abs(action.delta)} life (now ${p.life}).` });
      }
      return null;
    }
    case "set_poison": {
      const p = playerBySeat(state, action.seat);
      if (p) p.poison = Math.max(0, action.value);
      return null;
    }
    case "commander_damage": {
      const p = playerBySeat(state, action.toSeat);
      if (p) {
        p.commanderDamage[action.fromSeat] = Math.max(0, (p.commanderDamage[action.fromSeat] ?? 0) + action.delta);
      }
      return null;
    }
    case "add_counter": {
      const o = findObj(state, action.objectId);
      if (!o) return { ok: false, error: "Card not found" };
      const existing = o.counters.find((c) => c.type === action.counterType);
      if (existing) existing.count = Math.max(0, existing.count + action.delta);
      else if (action.delta > 0) o.counters.push({ type: action.counterType, count: action.delta });
      o.counters = o.counters.filter((c) => c.count > 0);
      return null;
    }
    case "set_pt": {
      const o = findObj(state, action.objectId);
      if (!o) return { ok: false, error: "Card not found" };
      o.ptOverride = action.power === null || action.toughness === null ? null : { power: action.power, toughness: action.toughness };
      return null;
    }
    case "set_damage": {
      const o = findObj(state, action.objectId);
      if (!o) return { ok: false, error: "Card not found" };
      o.damage = Math.max(0, action.damage);
      return null;
    }
    case "flip": {
      const o = findObj(state, action.objectId);
      if (!o) return { ok: false, error: "Card not found" };
      if (action.faceDown !== undefined) o.faceDown = action.faceDown;
      if (action.faceIndex !== undefined) o.faceIndex = action.faceIndex;
      return null;
    }
    case "attach": {
      const o = findObj(state, action.objectId);
      if (!o) return { ok: false, error: "Card not found" };
      o.attachedTo = action.toObjectId;
      return null;
    }
    case "create_token": {
      const o = {
        ...newTokenObject(action.seat, action.name),
        cardId: action.cardId ?? null,
        oracleId: action.oracleId ?? null,
        ptOverride: action.power !== undefined && action.toughness !== undefined ? { power: action.power, toughness: action.toughness } : null,
      };
      state.objects[o.id] = o;
      log(state, { seat: action.seat, kind: "action", text: `${playerBySeat(state, action.seat)?.name} creates a ${action.name} token.` });
      return null;
    }
    case "cast": {
      const o = findObj(state, action.objectId);
      if (!o) return { ok: false, error: "Card not found" };
      if (o.zone !== "hand" && o.zone !== "command") {
        return { ok: false, error: "You can only cast from your hand or command zone." };
      }
      const instant = isInstantSpeed(ctx, o);
      if (!instant) {
        const timing = enforce(state, seat === state.activeSeat && isMainPhase(state) && state.stackOrder.length === 0, `${o.name} can only be cast on your main phase with an empty stack (it isn't an instant).`);
        if (timing) return timing;
      }
      o.zone = "stack";
      o.controllerSeat = seat;
      state.stackOrder.push(o.id);
      state.passStreak = 0;
      recountHiddenZones(state);
      log(state, { seat, kind: "action", text: `${playerBySeat(state, seat)?.name} casts ${o.name}.` });
      return null;
    }
    case "resolve_top": {
      resolveTop(state, ctx);
      return null;
    }
    case "counter_top": {
      const topId = state.stackOrder.pop();
      if (topId) {
        const o = state.objects[topId];
        if (o) moveObject(state, ctx, o, "graveyard", o.ownerSeat, {});
      }
      return null;
    }
    case "add_mana": {
      const p = playerBySeat(state, action.seat);
      if (p) p.manaPool[action.color] = (p.manaPool[action.color] ?? 0) + action.count;
      return null;
    }
    case "empty_mana": {
      const p = playerBySeat(state, action.seat);
      if (p) p.manaPool = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
      return null;
    }
    case "pay_mana": {
      const p = playerBySeat(state, action.seat);
      if (p) {
        for (const [c, n] of Object.entries(action.cost)) {
          const color = c as ManaColor;
          p.manaPool[color] = Math.max(0, (p.manaPool[color] ?? 0) - (n ?? 0));
        }
      }
      return null;
    }
    case "pass_priority": {
      state.passStreak += 1;
      state.prioritySeat = nextSeatInTurnOrder(state, state.prioritySeat);
      const numAlive = aliveSeats(state).length;
      if (state.passStreak >= numAlive) {
        state.passStreak = 0;
        if (state.stackOrder.length > 0) {
          resolveTop(state, ctx);
          state.prioritySeat = state.activeSeat;
        } else {
          advanceStep(state, ctx);
        }
      }
      return null;
    }
    case "advance_step": {
      const timing = enforce(state, seat === state.activeSeat, "Only the active player can advance the turn.");
      if (timing) return timing;
      advanceStep(state, ctx);
      return null;
    }
    case "set_active_player": {
      state.activeSeat = action.seat;
      state.prioritySeat = action.seat;
      return null;
    }
    case "declare_attacker": {
      const o = findObj(state, action.objectId);
      if (!o) return { ok: false, error: "Card not found" };
      const check1 = enforce(state, o.controllerSeat === state.activeSeat, "Only the active player can attack.");
      if (check1) return check1;
      const check2 = enforce(state, isCreature(ctx, o), `${o.name} isn't a creature.`);
      if (check2) return check2;
      const check3 = enforce(state, !o.tapped, `${o.name} is tapped and can't attack.`);
      if (check3) return check3;
      const check4 = enforce(state, !o.summoningSick || hasKeyword(ctx, o, "haste"), `${o.name} has summoning sickness.`);
      if (check4) return check4;
      o.attacking = action.defendingSeat;
      if (!hasKeyword(ctx, o, "vigilance")) o.tapped = true;
      log(state, { seat, kind: "combat", text: `${o.name} attacks ${playerBySeat(state, action.defendingSeat)?.name}.` });
      return null;
    }
    case "declare_blocker": {
      const blocker = findObj(state, action.blockerId);
      const attacker = findObj(state, action.attackerId);
      if (!blocker || !attacker) return { ok: false, error: "Card not found" };
      const c1 = enforce(state, isCreature(ctx, blocker), `${blocker.name} isn't a creature.`);
      if (c1) return c1;
      const c2 = enforce(state, !blocker.tapped, `${blocker.name} is tapped and can't block.`);
      if (c2) return c2;
      const c3 = enforce(state, attacker.attacking !== null, `${attacker.name} isn't attacking.`);
      if (c3) return c3;
      blocker.blocking = action.attackerId;
      log(state, { seat, kind: "combat", text: `${blocker.name} blocks ${attacker.name}.` });
      return null;
    }
    case "assign_combat_damage": {
      assignCombatDamage(state, ctx);
      return null;
    }
    case "note": {
      const o = findObj(state, action.objectId);
      if (!o) return { ok: false, error: "Card not found" };
      o.note = action.note;
      return null;
    }
    case "concede": {
      const p = playerBySeat(state, action.seat);
      if (p) {
        p.hasConceded = true;
        p.hasLost = true;
        log(state, { seat: action.seat, kind: "system", text: `${p.name} concedes.` });
      }
      return null;
    }
    case "set_enforcement": {
      state.enforcement = action.level;
      log(state, { seat, kind: "system", text: `Enforcement set to ${action.level}.` });
      return null;
    }
    case "roll": {
      const sides = Math.max(2, Math.floor(action.sides));
      const count = Math.min(20, Math.max(1, Math.floor(action.count)));
      const values: number[] = [];
      for (let i = 0; i < count; i++) values.push(1 + Math.floor(Math.random() * sides));
      const total = values.reduce((a, b) => a + b, 0);
      const who = playerBySeat(state, seat)?.name ?? "Someone";
      const label = action.label ?? (sides === 2 ? "coin" : `d${sides}`);
      const text =
        sides === 2
          ? `${who} flips a coin: ${values.map((v) => (v === 1 ? "Heads" : "Tails")).join(", ")}`
          : `${who} rolls ${count > 1 ? count + "× " : ""}${label}: ${values.join(", ")}${count > 1 ? ` (total ${total})` : ""}`;
      state.lastRoll = { id: nextLogId(state), seat, label, sides, values, total, text, ts: Date.now() };
      log(state, { seat, kind: "action", text });
      return null;
    }
    case "roll_first": {
      const rolls = state.players.map((p) => ({ seat: p.seat, name: p.name, v: 1 + Math.floor(Math.random() * 20) }));
      const max = Math.max(...rolls.map((r) => r.v));
      const winners = rolls.filter((r) => r.v === max);
      const winner = winners[Math.floor(Math.random() * winners.length)]!.seat;
      state.activeSeat = winner;
      state.prioritySeat = winner;
      state.startingPlayerSeat = winner;
      const text = `Roll for first — ${rolls.map((r) => `${r.name}: ${r.v}`).join(", ")} → ${playerBySeat(state, winner)?.name} goes first!`;
      state.lastRoll = { id: nextLogId(state), seat: null, label: "to go first", sides: 20, values: rolls.map((r) => r.v), total: max, text, ts: Date.now() };
      log(state, { seat: null, kind: "system", text });
      return null;
    }
    default:
      return { ok: false, error: "Unknown action" };
  }
}

function newTokenObject(seat: number, name: string): GameObject {
  return {
    id: cryptoRandomId(),
    cardId: null,
    oracleId: null,
    name,
    ownerSeat: seat,
    controllerSeat: seat,
    zone: "battlefield",
    faceIndex: 0,
    x: 0,
    y: 0,
    tapped: false,
    faceDown: false,
    summoningSick: true,
    counters: [],
    damage: 0,
    attachedTo: null,
    isToken: true,
    isCommander: false,
    note: null,
    ptOverride: null,
    attacking: null,
    blocking: null,
  };
}

function cryptoRandomId(): string {
  return "tok_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function assignCombatDamage(state: TableState, ctx: CardIndex): void {
  const attackers = objectsIn(state, "battlefield").filter((o) => o.attacking !== null);
  for (const atk of attackers) {
    const ci = info(ctx, atk);
    const { power } = effectivePT(state, atk, ci ?? undefined);
    const blockers = objectsIn(state, "battlefield").filter((o) => o.blocking === atk.id);
    if (blockers.length === 0) {
      const p = playerBySeat(state, atk.attacking!);
      if (p) {
        p.life -= power;
        // Track commander damage automatically if the attacker is a commander.
        if (atk.isCommander) p.commanderDamage[atk.controllerSeat] = (p.commanderDamage[atk.controllerSeat] ?? 0) + power;
        log(state, { seat: atk.controllerSeat, kind: "combat", text: `${atk.name} deals ${power} to ${p.name}.` });
      }
    } else {
      let remaining = power;
      for (const b of blockers) {
        const bci = info(ctx, b);
        const bt = effectivePT(state, b, bci ?? undefined).toughness;
        const assign = Math.min(remaining, Math.max(bt, 0));
        b.damage += assign > 0 ? assign : remaining; // if toughness 0, dump rest
        remaining -= assign;
        // Blocker hits attacker.
        const bp = effectivePT(state, b, bci ?? undefined).power;
        atk.damage += bp;
      }
      log(state, { seat: atk.controllerSeat, kind: "combat", text: `${atk.name} trades blows in combat.` });
    }
  }
}
