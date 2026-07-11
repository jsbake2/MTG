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
import { getFormat, compileEffects, compileEtbEffects, type EffectOp, type EffectWho, type MassFilter } from "@mtg/shared";
import { KEYWORD_ACTIONS } from "./rules.js";
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
  const k = kw.toLowerCase();
  if (o.grantedKeywords?.some((x) => x.toLowerCase() === k)) return true; // until-end-of-turn grants
  const ci = info(ctx, o);
  if (!ci) return false;
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
  // Lethal-damage / zero-toughness creature death (auto damage math promise),
  // respecting indestructible and deathtouch.
  for (const o of objectsIn(state, "battlefield")) {
    if (!isCreature(ctx, o)) continue;
    const ci = info(ctx, o);
    const { toughness } = effectivePT(state, o, ci ?? undefined);
    const indestructible = hasKeyword(ctx, o, "indestructible");
    const lethalDamage = o.damage > 0 && o.damage >= toughness;
    const deathtouchKill = o.deathtouched && o.damage > 0;
    if (toughness <= 0 || ((lethalDamage || deathtouchKill) && !indestructible)) {
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
  // Enter-the-battlefield triggers auto-run when a permanent enters.
  if (toZone === "battlefield" && fromZone !== "battlefield") runEtb(state, ctx, o);
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
  } else if (state.step === "combat_damage") {
    // Auto-resolve all combat damage/keywords when reaching the damage step.
    resolveCombat(state, ctx);
  } else if (state.step === "cleanup") {
    // Empty mana, remove combat damage marks, clear combat.
    for (const p of state.players) p.manaPool = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
    for (const o of objectsIn(state, "battlefield")) {
      o.damage = 0;
      o.attacking = null;
      o.blocking = null;
      o.deathtouched = false;
      o.tempBoost = { power: 0, toughness: 0 }; // "until end of turn" pump wears off
      o.grantedKeywords = [];
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
    // Permanent spells enter the battlefield (any ETB effects are separate).
    moveObject(state, ctx, o, "battlefield", o.controllerSeat, {});
    log(state, { seat: o.controllerSeat, kind: "action", text: `${o.name} resolves and enters the battlefield.` });
  } else {
    // Instant/sorcery: auto-execute compiled effects, then to the graveyard.
    const applied = applyEffects(state, ctx, o);
    moveObject(state, ctx, o, "graveyard", o.ownerSeat, {});
    log(state, {
      seat: o.controllerSeat,
      kind: "action",
      text: applied ? `${o.name} resolves.` : `${o.name} resolves — perform its effect, then it goes to the graveyard.`,
    });
  }
}

// ---- oracle-text effect execution --------------------------------------
function whoOf(op: EffectOp): EffectWho | undefined {
  return (op as { to?: EffectWho }).to ?? (op as { what?: EffectWho }).what ?? (op as { who?: EffectWho }).who;
}
function resolveWho(
  state: TableState,
  source: GameObject,
  w: EffectWho | undefined,
  nextTarget: () => string | undefined,
): { seats: number[]; object: GameObject | null } {
  if (!w) return { seats: [], object: null };
  switch (w.scope) {
    case "you":
    case "controller":
      return { seats: [source.controllerSeat], object: null };
    case "each_opponent":
      return { seats: state.players.filter((p) => p.seat !== source.controllerSeat && !p.hasLost).map((p) => p.seat), object: null };
    case "each_player":
      return { seats: state.players.filter((p) => !p.hasLost).map((p) => p.seat), object: null };
    case "target": {
      const id = nextTarget();
      if (!id) return { seats: [], object: null };
      if (id.startsWith("seat:")) return { seats: [Number(id.slice(5))], object: null };
      return { seats: [], object: state.objects[id] ?? null };
    }
  }
}

// Route a permanent/spell to a zone using the rules table (destroy/exile/etc.).
function routeZone(state: TableState, ctx: CardIndex, o: GameObject, action: keyof typeof KEYWORD_ACTIONS): void {
  if (action === "destroy" && hasKeyword(ctx, o, "indestructible")) return;
  const rule = KEYWORD_ACTIONS[action];
  moveObject(state, ctx, o, rule.dest, rule.toOwner ? o.ownerSeat : o.controllerSeat, { toTop: rule.toTop });
}

function applyEffects(state: TableState, ctx: CardIndex, source: GameObject): boolean {
  const ci = info(ctx, source);
  const comp = compileEffects(ci?.oracleText ?? null, source.name);
  if (!comp.matched) return false;
  applyOps(state, ctx, source, comp.ops, source.targets);
  return true;
}

// Run an enter-the-battlefield trigger's auto-effects (the non-targeted ones;
// targeted ETB effects are left for the player to resolve). Applies to any
// permanent that enters — thousands of cards, no per-card work.
function runEtb(state: TableState, ctx: CardIndex, source: GameObject): void {
  const ci = info(ctx, source);
  if (!ci?.oracleText) return;
  const comp = compileEtbEffects(ci.oracleText, source.name);
  if (!comp.matched) return;
  const auto = comp.ops.filter((op) => {
    const w = whoOf(op);
    return op.op !== "manual" && !(w && w.scope === "target");
  });
  if (auto.length > 0) {
    applyOps(state, ctx, source, auto, []);
    log(state, { seat: source.controllerSeat, kind: "action", text: `${source.name} enters — its ability resolves.` });
  }
  if (comp.ops.length > auto.length) {
    log(state, { seat: source.controllerSeat, kind: "system", text: `${source.name}'s enter ability needs a target/choice — resolve it manually.` });
  }
}

function applyOps(state: TableState, ctx: CardIndex, source: GameObject, ops: EffectOp[], targetIds: string[]): void {
  let ti = 0;
  const nextTarget = () => targetIds[ti++];
  for (const op of ops) {
    const tgt = resolveWho(state, source, whoOf(op), nextTarget);
    switch (op.op) {
      case "draw":
        for (const s of tgt.seats) drawCards(state, s, op.count);
        break;
      case "damage":
        for (const s of tgt.seats) {
          const p = playerBySeat(state, s);
          if (p) p.life -= op.amount;
        }
        if (tgt.object && isCreature(ctx, tgt.object)) tgt.object.damage += op.amount;
        else if (tgt.object) {
          const p = playerBySeat(state, tgt.object.controllerSeat);
          void p;
        }
        log(state, { seat: source.controllerSeat, kind: "action", text: `${source.name} deals ${op.amount} damage.` });
        break;
      case "gain_life":
        for (const s of tgt.seats) {
          const p = playerBySeat(state, s);
          if (p) p.life += op.amount;
        }
        break;
      case "lose_life":
        for (const s of tgt.seats) {
          const p = playerBySeat(state, s);
          if (p) p.life -= op.amount;
        }
        break;
      case "destroy":
        if (tgt.object) routeZone(state, ctx, tgt.object, "destroy");
        break;
      case "exile":
        if (tgt.object) routeZone(state, ctx, tgt.object, "exile");
        break;
      case "bounce":
        if (tgt.object) routeZone(state, ctx, tgt.object, "bounce");
        break;
      case "counter":
        if (tgt.object) {
          state.stackOrder = state.stackOrder.filter((id) => id !== tgt.object!.id);
          routeZone(state, ctx, tgt.object, "counter");
        }
        break;
      case "tap":
        if (tgt.object) tgt.object.tapped = true;
        break;
      case "untap":
        if (tgt.object) tgt.object.tapped = false;
        break;
      case "plus_counter":
        if (tgt.object) addCounter(tgt.object, op.kind, op.count);
        break;
      case "pump":
        if (tgt.object) {
          tgt.object.tempBoost.power += op.power;
          tgt.object.tempBoost.toughness += op.toughness;
        }
        break;
      case "grant":
        if (tgt.object && !tgt.object.grantedKeywords.includes(op.keyword)) tgt.object.grantedKeywords.push(op.keyword);
        break;
      case "gain_control":
        if (tgt.object) {
          tgt.object.controllerSeat = source.controllerSeat;
          tgt.object.summoningSick = true;
          log(state, { seat: source.controllerSeat, kind: "action", text: `${playerBySeat(state, source.controllerSeat)?.name} gains control of ${tgt.object.name}.` });
        }
        break;
      case "tuck":
        if (tgt.object) moveObject(state, ctx, tgt.object, "library", tgt.object.ownerSeat, { toTop: op.top });
        break;
      case "mass_damage":
        for (const o of massObjects(state, ctx, source, op.filter)) o.damage += op.amount;
        log(state, { seat: source.controllerSeat, kind: "action", text: `${source.name} deals ${op.amount} to each ${op.filter.controller === "all" ? "" : op.filter.controller + "'s "}creature.` });
        break;
      case "mass_destroy":
        for (const o of massObjects(state, ctx, source, op.filter)) routeZone(state, ctx, o, "destroy");
        log(state, { seat: source.controllerSeat, kind: "action", text: `${source.name} destroys permanents.` });
        break;
      case "mass_exile":
        for (const o of massObjects(state, ctx, source, op.filter)) routeZone(state, ctx, o, "exile");
        break;
      case "mass_pump":
        for (const o of massObjects(state, ctx, source, op.filter)) {
          o.tempBoost.power += op.power;
          o.tempBoost.toughness += op.toughness;
        }
        break;
      case "mass_grant":
        for (const o of massObjects(state, ctx, source, op.filter)) if (!o.grantedKeywords.includes(op.keyword)) o.grantedKeywords.push(op.keyword);
        break;
      case "mass_counter":
        for (const o of massObjects(state, ctx, source, op.filter)) addCounter(o, op.kind, op.count);
        break;
      case "tap_all":
        for (const o of massObjects(state, ctx, source, op.filter)) o.tapped = op.tapped;
        break;
      case "manual":
        log(state, { seat: source.controllerSeat, kind: "action", text: `${source.name}: ${op.hint} — finish manually.` });
        break;
      case "token":
        for (const s of tgt.seats.length ? tgt.seats : [source.controllerSeat]) {
          for (let i = 0; i < op.count; i++) {
            const tok = newTokenObject(s, op.name);
            tok.ptOverride = { power: op.power, toughness: op.toughness };
            state.objects[tok.id] = tok;
          }
        }
        log(state, { seat: source.controllerSeat, kind: "action", text: `${source.name} creates ${op.count} ${op.name}.` });
        break;
      case "mill":
        for (const s of tgt.seats) {
          const lib = libraryOrdered(state, s);
          for (let i = 0; i < op.count && i < lib.length; i++) moveObject(state, ctx, lib[i]!, "graveyard", s, {});
        }
        break;
    }
  }
}

function addCounter(o: GameObject, kind: "+1/+1" | "-1/-1", count: number): void {
  const existing = o.counters.find((c) => c.type === kind);
  if (existing) existing.count += count;
  else o.counters.push({ type: kind, count });
}

function massObjects(state: TableState, ctx: CardIndex, source: GameObject, filter: MassFilter): GameObject[] {
  return objectsIn(state, "battlefield").filter((o) => {
    if (filter.creaturesOnly && !isCreature(ctx, o)) return false;
    if (filter.types.length > 0 && !info(ctx, o)?.cardTypes.some((t) => filter.types.includes(t))) return false;
    if (filter.controller === "you" && o.controllerSeat !== source.controllerSeat) return false;
    if (filter.controller === "opponents" && o.controllerSeat === source.controllerSeat) return false;
    return true;
  });
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
      o.targets = action.targets ?? [];
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
      if (action.defendingSeat < 0) {
        o.attacking = null;
        return null;
      }
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
      const c4 = enforce(
        state,
        !hasKeyword(ctx, attacker, "flying") || hasKeyword(ctx, blocker, "flying") || hasKeyword(ctx, blocker, "reach"),
        `${blocker.name} can't block ${attacker.name} — it has flying.`,
      );
      if (c4) return c4;
      blocker.blocking = action.attackerId;
      log(state, { seat, kind: "combat", text: `${blocker.name} blocks ${attacker.name}.` });
      return null;
    }
    case "assign_combat_damage": {
      resolveCombat(state, ctx);
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
    case "keyword_action": {
      const o = findObj(state, action.objectId);
      if (!o) return { ok: false, error: "Card not found" };
      const rule = KEYWORD_ACTIONS[action.action];
      // Destroy is prevented by indestructible; sacrifice/exile are not.
      if (action.action === "destroy" && hasKeyword(ctx, o, "indestructible")) {
        log(state, { seat, kind: "action", text: `${o.name} is indestructible — not destroyed.` });
        return null;
      }
      const verb: Record<string, string> = {
        destroy: "destroys",
        sacrifice: "sacrifices",
        exile: "exiles",
        bounce: "returns to hand",
        counter: "counters",
        tuck_top: "puts on top of library",
        tuck_bottom: "puts on bottom of library",
      };
      const toSeat = rule.toOwner ? o.ownerSeat : o.controllerSeat;
      moveObject(state, ctx, o, rule.dest, toSeat, { toTop: rule.toTop });
      log(state, { seat, kind: "action", text: `${playerBySeat(state, seat)?.name} ${verb[action.action]}: ${o.name}.` });
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
    deathtouched: false,
    targets: [],
    tempBoost: { power: 0, toughness: 0 },
    grantedKeywords: [],
    cardTypes: null,
    keywords: null,
  };
}

function cryptoRandomId(): string {
  return "tok_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function pow(state: TableState, ctx: CardIndex, o: GameObject): number {
  return effectivePT(state, o, info(ctx, o) ?? undefined).power;
}
function tou(state: TableState, ctx: CardIndex, o: GameObject): number {
  return effectivePT(state, o, info(ctx, o) ?? undefined).toughness;
}
function dealToCreature(state: TableState, ctx: CardIndex, source: GameObject, target: GameObject, amount: number): void {
  if (amount <= 0) return;
  target.damage += amount;
  if (hasKeyword(ctx, source, "deathtouch")) target.deathtouched = true;
  if (hasKeyword(ctx, source, "lifelink")) {
    const c = playerBySeat(state, source.controllerSeat);
    if (c) c.life += amount;
  }
}
function dealToPlayer(state: TableState, ctx: CardIndex, source: GameObject, seat: number, amount: number): void {
  if (amount <= 0) return;
  const p = playerBySeat(state, seat);
  if (p) {
    p.life -= amount;
    if (source.isCommander) p.commanderDamage[source.controllerSeat] = (p.commanderDamage[source.controllerSeat] ?? 0) + amount;
  }
  if (hasKeyword(ctx, source, "lifelink")) {
    const c = playerBySeat(state, source.controllerSeat);
    if (c) c.life += amount;
  }
}

// Full keyword-aware combat resolution: first-strike/regular sub-steps, deathtouch,
// trample, lifelink, and commander damage — the "do all the math" automation.
function resolveCombat(state: TableState, ctx: CardIndex): void {
  const attackers = objectsIn(state, "battlefield").filter((o) => o.attacking !== null);
  if (attackers.length === 0) return;
  const blockedIds = new Set(
    objectsIn(state, "battlefield").filter((o) => o.blocking !== null).map((o) => o.blocking as string),
  );

  const dealsInStep = (o: GameObject, step: "first" | "regular"): boolean => {
    const fs = hasKeyword(ctx, o, "first strike");
    const ds = hasKeyword(ctx, o, "double strike");
    return step === "first" ? fs || ds : !fs || ds;
  };

  for (const step of ["first", "regular"] as const) {
    // Only run the first-strike step if someone actually has (double) first strike.
    if (step === "first") {
      const anyFS = objectsIn(state, "battlefield").some(
        (o) => (o.attacking !== null || o.blocking !== null) && (hasKeyword(ctx, o, "first strike") || hasKeyword(ctx, o, "double strike")),
      );
      if (!anyFS) continue;
    }
    // Attackers deal damage.
    for (const atk of attackers) {
      if (atk.zone !== "battlefield" || !dealsInStep(atk, step)) continue;
      const power = Math.max(0, pow(state, ctx, atk));
      const blockers = objectsIn(state, "battlefield").filter((o) => o.blocking === atk.id && o.zone === "battlefield");
      if (blockers.length === 0) {
        if (!blockedIds.has(atk.id)) {
          dealToPlayer(state, ctx, atk, atk.attacking!, power);
        } else if (hasKeyword(ctx, atk, "trample")) {
          // Blockers all died; trample the rest through.
          dealToPlayer(state, ctx, atk, atk.attacking!, power);
        }
      } else {
        let remaining = power;
        for (const b of blockers) {
          const lethal = hasKeyword(ctx, atk, "deathtouch") ? 1 : Math.max(0, tou(state, ctx, b) - b.damage);
          const assign = Math.min(remaining, lethal > 0 ? lethal : remaining);
          dealToCreature(state, ctx, atk, b, assign);
          remaining -= assign;
        }
        if (remaining > 0 && hasKeyword(ctx, atk, "trample")) dealToPlayer(state, ctx, atk, atk.attacking!, remaining);
      }
    }
    // Blockers deal damage back to their attacker.
    for (const b of objectsIn(state, "battlefield").filter((o) => o.blocking !== null && o.zone === "battlefield")) {
      if (!dealsInStep(b, step)) continue;
      const atk = b.blocking ? state.objects[b.blocking] : undefined;
      if (!atk || atk.zone !== "battlefield") continue;
      dealToCreature(state, ctx, b, atk, Math.max(0, pow(state, ctx, b)));
    }
    // State-based checks (first-strike deaths happen before the regular step).
    checkStateBased(state, ctx);
  }
  log(state, { seat: state.activeSeat, kind: "combat", text: "Combat damage resolved." });
}
