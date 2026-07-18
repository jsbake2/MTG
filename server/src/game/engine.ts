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
import { getFormat, compileEffects, compileEtbEffects, compileTriggers, parseAbilities, type EffectOp, type EffectWho, type MassFilter, type TriggerEvent } from "@mtg/shared";
import { KEYWORD_ACTIONS } from "./rules.js";
import {
  libraryOrdered,
  log,
  nextLogId,
  nextSeatInTurnOrder,
  objectsIn,
  recountHiddenZones,
  shuffle,
} from "./state.js";
import { randomInt } from "node:crypto";
import { parseCost, planPayment, selectionPays, sourceProduction, type ManaSource } from "./mana.js";
import { derivePT, staticKeywordsFor, combatFlagsFor, controlsLandType } from "./continuous.js";
import { entersTappedUnconditional, entersTappedConditional, entersWithCounters } from "./replacements.js";

export interface CardInfo {
  typeLine: string;
  cardTypes: string[];
  power: string | null;
  toughness: string | null;
  keywords: string[];
  oracleText: string | null;
  cmc?: number;
  manaCost?: string | null;
}
export type CardIndex = Record<string, CardInfo>;

export interface ApplyResult {
  ok: boolean;
  error?: string;
  // Set when a cast needs the player to choose which mana sources to tap.
  manaChoice?: {
    objectId: string;
    cardName: string;
    x: number;
    cost: { pips: string[]; generic: number };
    sources: Array<{ id: string; name: string; colors: string[]; amount: number }>;
  };
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
function hasKeyword(state: TableState, ctx: CardIndex, o: GameObject, kw: string): boolean {
  const k = kw.toLowerCase();
  if (o.grantedKeywords?.some((x) => x.toLowerCase() === k)) return true; // until-end-of-turn grants
  // Static grants from auras/equipment/anthems (CR 613 layer 6).
  if (o.zone === "battlefield" && staticKeywordsFor(state, ctx, o).some((x) => x.toLowerCase() === k)) return true;
  const ci = info(ctx, o);
  if (!ci) return false;
  return ci.keywords.some((x) => x.toLowerCase() === k) || (ci.oracleText ?? "").toLowerCase().includes(k);
}
// ---- mana enforcement (guided) ------------------------------------------
// Colour-aware payment: a cost is paid from untapped sources honouring coloured
// pips. When the payment is forced we tap automatically; when the player could
// pay more than one way we hand the choice back (see the cast handler + mana.ts).

// The untapped mana sources a player controls, with the colours each can make.
function manaSourcesOf(state: TableState, ctx: CardIndex, seat: number): ManaSource[] {
  return objectsIn(state, "battlefield", seat).flatMap((o) => {
    if (o.tapped) return [];
    // A summoning-sick creature can't use a {T} mana ability.
    if (isCreature(ctx, o) && o.summoningSick && !hasKeyword(state, ctx, o, "haste")) return [];
    const ci = info(ctx, o);
    if (!ci) return [];
    const prod = sourceProduction(ci.typeLine, ci.oracleText ?? null);
    if (!prod) return [];
    return [{ id: o.id, name: o.name, amount: prod.amount, colors: prod.colors }];
  });
}

function isInstantSpeed(state: TableState, ctx: CardIndex, o: GameObject): boolean {
  const ci = info(ctx, o);
  if (!ci) return true; // unknown/token — don't block
  if (ci.cardTypes.includes("Instant")) return true;
  return hasKeyword(state, ctx, o, "flash");
}

// Does this seat hold anything they could cast at instant speed (so they deserve
// a response window at end of turn)?
function seatHasInstant(state: TableState, ctx: CardIndex, seat: number): boolean {
  return objectsIn(state, "hand", seat).some((o) => {
    const ci = info(ctx, o);
    return !!ci && (ci.cardTypes.includes("Instant") || hasKeyword(state, ctx, o, "flash"));
  });
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
    const { toughness } = derivePT(state, ctx, o, ci ?? undefined);
    const indestructible = hasKeyword(state, ctx, o, "indestructible");
    const lethalDamage = o.damage > 0 && o.damage >= toughness;
    const deathtouchKill = o.deathtouched && o.damage > 0;
    if (toughness <= 0 || ((lethalDamage || deathtouchKill) && !indestructible)) {
      // A regeneration shield replaces destruction by lethal damage — but NOT
      // death from 0-or-less toughness (CR 704.5f), which isn't "destroy".
      if (toughness > 0 && consumeRegen(state, o)) continue;
      moveObject(state, ctx, o, "graveyard", o.ownerSeat, {});
      log(state, { seat: o.controllerSeat, kind: "combat", text: `${o.name} dies.` });
      runTriggers(state, ctx, o, "dies");
    }
  }
  const alive = aliveSeats(state);
  if (state.players.length > 1 && alive.length === 1 && state.status === "playing") {
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
  // Commander recursion (CR 903.9b): in Commander, a commander that would go to
  // the graveyard or exile may instead be put into the command zone. Default to
  // that (the common choice) so commanders stay available; the player can move it
  // to the graveyard/exile manually if they intended that.
  const fmt = getFormat(state.formatId);
  if (o.isCommander && fmt?.requiresCommander && (toZone === "graveyard" || toZone === "exile")) {
    log(state, { seat: o.ownerSeat, kind: "system", text: `${o.name} returns to the command zone (commander).` });
    toZone = "command";
    toSeat = o.ownerSeat;
  }
  // Anything leaving the stack (resolved or countered) leaves the stack order,
  // so countering a counterspell (and cancels-on-cancels) works cleanly.
  if (fromZone === "stack") state.stackOrder = state.stackOrder.filter((id) => id !== o.id);
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
    if (isCreature(ctx, o)) o.summoningSick = !hasKeyword(state, ctx, o, "haste");
    // Replacement effect (CR 614.1c): enters-tapped.
    if (fromZone !== "battlefield") {
      const etbText = info(ctx, o)?.oracleText ?? null;
      if (entersTappedUnconditional(etbText)) o.tapped = true;
      else if (entersTappedConditional(etbText))
        log(state, { seat: o.controllerSeat, kind: "system", text: `${o.name} may enter tapped — tap it manually if its condition applies.` });
      // Replacement (CR 614.1c): enters with +1/+1 or -1/-1 counters. "X" counters
      // use the X chosen when the spell was cast (o.xValue), e.g. Hydras.
      const etbCounters = entersWithCounters(etbText);
      if (etbCounters) {
        const count = etbCounters.xScaled ? o.xValue : etbCounters.count;
        if (count > 0) o.counters.push({ type: etbCounters.kind, count });
      }
    }
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
  let next = idx + 1;
  state.passStreak = 0;

  if (state.step === "declare_attackers") {
    const attackers = objectsIn(state, "battlefield").filter((o) => o.attacking !== null);
    if (attackers.length === 0) {
      // Rule 508.8: Skip blockers and damage steps if 0 attackers are declared.
      state.phase = "postcombat_main";
      state.step = "main2";
      onEnterStep(state, ctx);
      return;
    }
  }

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

// Can this creature legally be declared as an attacker right now?
function canAttackNow(state: TableState, ctx: CardIndex, o: GameObject): boolean {
  if (!isCreature(ctx, o)) return false;
  if (o.tapped) return false;
  if (o.summoningSick && !hasKeyword(state, ctx, o, "haste")) return false;
  if (combatFlagsFor(state, ctx, o).cantAttack) return false;
  return true;
}

// Guided mode: is the step we just entered one where NO player has a real
// decision, so we should roll straight through it? This is what makes a casual
// turn feel like a turn (Main 1 → attack → Main 2 → done) instead of clicking
// "Next step" a dozen times through empty upkeeps and combat sub-steps. Steps
// that already self-advance (untap/draw/cleanup) aren't listed — by the time
// this runs after them, we're already parked on a decision step, so it no-ops.
function guidedShouldSkip(state: TableState, ctx: CardIndex): boolean {
  switch (state.step) {
    case "upkeep":
    case "begin_combat":
    case "end":
      // Nothing to do unless a trigger is waiting on the stack.
      return state.stackOrder.length === 0;
    case "end_combat":
      return true;
    case "combat_damage":
      // Damage was just auto-resolved in onEnterStep; nothing left to choose.
      return true;
    case "declare_attackers":
      // Stop only if the active player actually has a creature that can attack.
      return !objectsIn(state, "battlefield", state.activeSeat).some((o) => canAttackNow(state, ctx, o));
    case "declare_blockers": {
      const attackers = objectsIn(state, "battlefield").filter((o) => o.attacking !== null);
      if (attackers.length === 0) return true;
      // Stop only if a defending player has an untapped creature to block with.
      const canBlock = state.players
        .filter((p) => p.seat !== state.activeSeat)
        .some((p) => objectsIn(state, "battlefield", p.seat).some((o) => isCreature(ctx, o) && !o.tapped));
      return !canBlock;
    }
    default:
      return false;
  }
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
    // Untap step has no priority, immediately advance to Upkeep.
    advanceStep(state, ctx);
  } else if (state.step === "upkeep") {
    for (const o of objectsIn(state, "battlefield", state.activeSeat)) runTriggers(state, ctx, o, "upkeep");
  } else if (state.step === "draw") {
    // First player skips their first draw in a 2-player game.
    const skip = state.turnNumber === 1 && state.activeSeat === state.startingPlayerSeat && aliveSeats(state).length === 2;
    if (!skip && active) {
      drawCards(state, state.activeSeat, 1);
      log(state, { seat: state.activeSeat, kind: "phase", text: `${active.name} draws for the turn.` });
    }
    // Auto-advance to Main 1.
    advanceStep(state, ctx);
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
      o.regenShield = 0; // unused regeneration shields wear off at end of turn
    }
    // Cleanup step immediately transitions to the next turn.
    advanceStep(state, ctx);
  } else if (state.step === "end_combat") {
    for (const o of objectsIn(state, "battlefield")) {
      o.attacking = null;
      o.blocking = null;
    }
  }
  // Guided mode: roll through no-decision steps automatically. Safe to recurse —
  // it always halts at a main phase or a live combat decision. Steps that already
  // called advanceStep above (untap/draw/cleanup) have moved us onto a decision
  // step by now, so this is a no-op for them.
  if (state.mode === "guided" && state.status === "playing" && guidedShouldSkip(state, ctx)) {
    advanceStep(state, ctx);
  }
}

function drawCards(state: TableState, seat: number, count: number): number {
  const lib = libraryOrdered(state, seat);
  let drawn = 0;
  for (let i = 0; i < count && i < lib.length; i++) {
    lib[i]!.zone = "hand";
    drawn++;
  }
  // CR 704.5b — a player who attempts to draw from an empty library loses.
  if (count > lib.length) {
    const p = playerBySeat(state, seat);
    if (p && !p.hasLost) {
      p.hasLost = true;
      log(state, { seat, kind: "system", text: `${p.name} tried to draw from an empty library and loses (CR 704.5b).` });
    }
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
// Regeneration shield (CR 701.19): if `o` has a shield, spend one to replace a
// destruction — tap it, clear damage, remove from combat — and report true.
function consumeRegen(state: TableState, o: GameObject): boolean {
  if ((o.regenShield ?? 0) <= 0) return false;
  o.regenShield -= 1;
  o.tapped = true;
  o.damage = 0;
  o.attacking = null;
  o.blocking = null;
  o.deathtouched = false;
  log(state, { seat: o.controllerSeat, kind: "combat", text: `${o.name} regenerates.` });
  return true;
}

function routeZone(state: TableState, ctx: CardIndex, o: GameObject, action: keyof typeof KEYWORD_ACTIONS): void {
  if (action === "destroy" && hasKeyword(state, ctx, o, "indestructible")) return;
  if (action === "destroy" && consumeRegen(state, o)) return; // regeneration shield saves it
  const rule = KEYWORD_ACTIONS[action];
  moveObject(state, ctx, o, rule.dest, rule.toOwner ? o.ownerSeat : o.controllerSeat, { toTop: rule.toTop });
}

function applyEffects(state: TableState, ctx: CardIndex, source: GameObject): boolean {
  const ci = info(ctx, source);
  const comp = compileEffects(ci?.oracleText ?? null, source.name);
  if (comp.modes && comp.modes.length > 0) {
    const mode = comp.modes[source.castMode >= 0 ? source.castMode : 0] ?? comp.modes[0]!;
    applyOps(state, ctx, source, mode.ops, source.targets);
    log(state, { seat: source.controllerSeat, kind: "action", text: `${source.name} — mode: ${mode.label}` });
    return true;
  }
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
  const { auto, targetIds, needsManual } = partitionAutoOps(state, source, comp.ops);
  if (auto.length > 0) {
    applyOps(state, ctx, source, auto, targetIds);
    log(state, { seat: source.controllerSeat, kind: "action", text: `${source.name} enters — its ability resolves.` });
  }
  if (needsManual) {
    log(state, { seat: source.controllerSeat, kind: "system", text: `${source.name}'s enter ability needs a target/choice — resolve it manually.` });
  }
}

// Split a triggered ability's ops into those the engine can auto-resolve (non-
// target ops, plus target ops whose target is unambiguous — e.g. "target
// opponent" with a single opponent) and the rest, which need a player choice.
function partitionAutoOps(state: TableState, source: GameObject, ops: EffectOp[]): { auto: EffectOp[]; targetIds: string[]; needsManual: boolean } {
  const auto: EffectOp[] = [];
  const targetIds: string[] = [];
  let needsManual = false;
  for (const op of ops) {
    if (op.op === "manual") { needsManual = true; continue; }
    const w = whoOf(op);
    if (w && w.scope === "target") {
      const at = soleTargetFor(state, source, w);
      if (at) { auto.push(op); targetIds.push(at); }
      else needsManual = true;
    } else {
      auto.push(op);
    }
  }
  return { auto, targetIds, needsManual };
}

// If a target op has exactly one legal target, return its target id (for auto-
// resolving triggered abilities like "when this enters, deal 1 to target
// opponent"). Only players are auto-picked; card targets stay a manual choice.
function soleTargetFor(state: TableState, source: GameObject, w: EffectWho): string | null {
  if (w.scope !== "target") return null;
  if (w.kind === "opponent") {
    const opps = state.players.filter((p) => p.seat !== source.controllerSeat && !p.hasLost);
    return opps.length === 1 ? `seat:${opps[0]!.seat}` : null;
  }
  return null;
}

// Fire a permanent's triggered abilities for a game event (non-targeted ops
// auto-run; targeted ones prompt for manual resolution).
function runTriggers(state: TableState, ctx: CardIndex, o: GameObject, event: TriggerEvent): void {
  const ci = info(ctx, o);
  if (!ci?.oracleText) return;
  for (const tr of compileTriggers(ci.oracleText, o.name)) {
    if (tr.event !== event) continue;
    const ops = tr.effect.modes && tr.effect.modes.length > 0 ? tr.effect.modes[0]!.ops : tr.effect.ops;
    const { auto, targetIds, needsManual } = partitionAutoOps(state, o, ops);
    if (auto.length > 0) {
      applyOps(state, ctx, o, auto, targetIds);
      log(state, { seat: o.controllerSeat, kind: "action", text: `${o.name}'s ${event.replace("_", " ")} ability resolves.` });
    }
    if (needsManual) {
      log(state, { seat: o.controllerSeat, kind: "system", text: `${o.name}'s triggered ability needs a target/choice — resolve manually.` });
    }
  }
}

function applyOps(state: TableState, ctx: CardIndex, source: GameObject, ops: EffectOp[], targetIds: string[]): void {
  let ti = 0;
  const nextTarget = () => targetIds[ti++];
  const amt = (base: number, x?: boolean) => (x ? source.xValue : base);
  for (const op of ops) {
    const tgt = resolveWho(state, source, whoOf(op), nextTarget);
    switch (op.op) {
      case "draw":
        for (const s of tgt.seats) drawCards(state, s, amt(op.count, op.xScaled));
        break;
      case "damage": {
        const dmg = amt(op.amount, op.xScaled);
        for (const s of tgt.seats) {
          const p = playerBySeat(state, s);
          if (p) p.life -= dmg;
        }
        if (tgt.object && isCreature(ctx, tgt.object)) tgt.object.damage += dmg;
        log(state, { seat: source.controllerSeat, kind: "action", text: `${source.name} deals ${dmg} damage.` });
        break;
      }
      case "gain_life":
        for (const s of tgt.seats) {
          const p = playerBySeat(state, s);
          if (p) p.life += amt(op.amount, op.xScaled);
        }
        break;
      case "lose_life":
        for (const s of tgt.seats) {
          const p = playerBySeat(state, s);
          if (p) p.life -= amt(op.amount, op.xScaled);
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
        if (tgt.object) addCounter(tgt.object, op.kind, amt(op.count, op.xScaled));
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
      case "regenerate": {
        // Self-target ("regenerate this creature") applies to the source.
        const target = op.what.scope === "target" ? tgt.object : source;
        if (target) {
          target.regenShield = (target.regenShield ?? 0) + 1;
          log(state, { seat: source.controllerSeat, kind: "action", text: `${target.name} gets a regeneration shield.` });
        }
        break;
      }
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
      case "add_mana": {
        const p = playerBySeat(state, source.controllerSeat);
        if (p) for (const [c, n] of Object.entries(op.mana)) p.manaPool[c as ManaColor] = (p.manaPool[c as ManaColor] ?? 0) + n;
        break;
      }
      case "mass_damage": {
        const md = amt(op.amount, op.xScaled);
        for (const o of massObjects(state, ctx, source, op.filter)) o.damage += md;
        log(state, { seat: source.controllerSeat, kind: "action", text: `${source.name} deals ${md} to each creature.` });
        break;
      }
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
      case "mass_counter": {
        const cc = amt(op.count, op.xScaled);
        for (const o of massObjects(state, ctx, source, op.filter)) addCounter(o, op.kind, cc);
        break;
      }
      case "tap_all":
        for (const o of massObjects(state, ctx, source, op.filter)) o.tapped = op.tapped;
        break;
      case "manual":
        log(state, { seat: source.controllerSeat, kind: "action", text: `${source.name}: ${op.hint} — finish manually.` });
        break;
      case "token": {
        const n = amt(op.count, op.xScaled);
        for (const s of tgt.seats.length ? tgt.seats : [source.controllerSeat]) {
          for (let i = 0; i < n; i++) {
            const tok = newTokenObject(s, op.name);
            tok.ptOverride = { power: op.power, toughness: op.toughness };
            state.objects[tok.id] = tok;
          }
        }
        log(state, { seat: source.controllerSeat, kind: "action", text: `${source.name} creates ${n} ${op.name}.` });
        break;
      }
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

// ---- anti-cheat authorization -------------------------------------------
// Runs BEFORE dispatch for every action and is INDEPENDENT of the strict/relaxed
// toggle and of `override` — there is no legitimate reason, in any mode, to act
// for another seat or manipulate a card you don't control. `enforce()` is for
// rules nuance (timing, land drops) that casual play relaxes; this is the hard
// trust boundary. `privileged` = the table host or a site admin (judge).
function authorize(
  state: TableState,
  seat: number,
  action: GameAction,
  privileged: boolean,
): ApplyResult | null {
  const deny = (m: string): ApplyResult => ({ ok: false, error: m });
  const self = (s: number | undefined) => (s === undefined || s === seat ? null : deny("You can only do that for yourself."));
  const controls = (id: string) => {
    const o = state.objects[id];
    if (!o) return deny("Card not found.");
    return o.controllerSeat === seat ? null : deny("You don't control that permanent.");
  };
  const owns = (id: string) => {
    const o = state.objects[id];
    if (!o) return deny("Card not found.");
    return o.ownerSeat === seat ? null : deny("That card isn't yours.");
  };
  const strict = state.enforcement === "strict";

  switch (action.type) {
    // Self-benefit actions — ALWAYS locked to the acting seat (both modes). No
    // legitimate reason to draw/mill/mulligan/shuffle/gain-mana/concede for
    // someone else; cross-player effects come from resolving a spell, not a raw
    // manual action.
    case "draw": case "mill": case "shuffle": case "scry": case "mulligan":
    case "keep_hand": case "untap_all": case "add_mana": case "empty_mana":
    case "pay_mana": case "set_life": case "adjust_life": case "set_poison":
    case "concede":
      return self((action as { seat?: number }).seat);
    case "create_token": {
      const s = self(action.seat);
      if (s) return s;
      // A token can't be backed by a real card in a tournament game — that would
      // let a player materialize any card not in their sealed deck. (Legit token
      // copies of a real card go through a judge override.)
      if (strict && !privileged && (action.cardId || action.oracleId)) {
        return deny("Tournament play: tokens can't be backed by a real card.");
      }
      return null;
    }
    case "commander_damage":
      return action.fromSeat === seat ? null : deny("You can only record damage from your own commander.");
    case "pass_priority":
      return seat === state.prioritySeat ? null : deny("You don't have priority.");

    // Meta controls — host/judge only.
    case "set_enforcement":
    case "set_active_player":
      return privileged ? null : deny("Only the host can change that.");
    case "roll_first":
      return privileged || state.status === "mulligan" ? null : deny("Re-rolling for first is host-only once the game has begun.");

    // Object actions that are NEVER legitimate on another player's card.
    case "cast":
      return owns(action.objectId);
    case "activate":
      return controls(action.objectId);
    case "declare_attacker":
      return controls(action.objectId);
    case "declare_blocker":
      return controls(action.blockerId);

    // Manual object manipulation. In a tournament (strict) table you may only
    // touch permanents you control; in casual (relaxed) play cross-player manual
    // manipulation stays allowed so unmodeled effects can be resolved by hand.
    case "tap": case "set_pt": case "set_damage": case "add_counter":
    case "flip": case "attach": case "note": case "keyword_action":
    case "move_card": {
      if (!strict || privileged) return null;
      return controls((action as { objectId: string }).objectId);
    }
    default:
      return null;
  }
}

// ---- main dispatcher ----------------------------------------------------
export function applyAction(state: TableState, ctx: CardIndex, seat: number, action: GameAction, privileged = false): ApplyResult {
  if (state.status === "finished") return { ok: false, error: "The game is over." };

  // Override wrapper: relax RULES gates (mana, draw limit, timing) for the actor,
  // logged loudly. In a tournament (strict) table this is host/judge-only so a
  // player can't self-bypass. Note: override does NOT bypass authorize() — you
  // still can't act for another seat or on cards you don't control.
  if (action.type === "override") {
    if (state.enforcement === "strict" && !privileged) {
      return { ok: false, error: "Overrides are host/judge-only in a tournament (strict) game." };
    }
    const prev = state.enforcement;
    const prevOverriding = (state as { overriding?: boolean }).overriding;
    state.enforcement = "relaxed";
    (state as { overriding?: boolean }).overriding = true;
    log(state, { seat, kind: "override", text: `Override by ${playerBySeat(state, seat)?.name}: ${action.description}` });
    const r = applyAction(state, ctx, seat, action.inner, privileged);
    state.enforcement = prev;
    (state as { overriding?: boolean }).overriding = prevOverriding;
    return r;
  }

  // Hard trust boundary — always on, regardless of mode/override.
  const authz = authorize(state, seat, action, privileged);
  if (authz) return authz;

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
        const prio = enforce(state, seat === state.prioritySeat, "You do not have priority.");
        if (prio) return prio;
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
      const prio = enforce(state, seat === state.prioritySeat, "You do not have priority.");
      if (prio) return prio;
      // Guided mode already draws for you at your draw step, and modeled card
      // draw effects call drawCards() directly. So a by-hand "draw" action is
      // never legal here — HARD block it regardless of the relaxed/strict toggle,
      // otherwise a relaxed table could draw infinitely. The only way through is
      // an explicit Override (⚙ Manual override → Draw), which sets `overriding`.
      if (state.mode === "guided" && !(state as { overriding?: boolean }).overriding) {
        return {
          ok: false,
          error: "In guided mode you draw automatically at your draw step; extra draws come from card effects. Use ⚙ Manual override → Draw to force one.",
        };
      }
      const n = drawCards(state, action.seat, action.count);
      log(state, { seat: action.seat, kind: "action", text: `${playerBySeat(state, action.seat)?.name} draws ${n}.` });
      return null;
    }
    case "mill": {
      const prio = enforce(state, seat === state.prioritySeat, "You do not have priority.");
      if (prio) return prio;
      const lib = libraryOrdered(state, action.seat);
      for (let i = 0; i < action.count && i < lib.length; i++) moveObject(state, ctx, lib[i]!, "graveyard", action.seat, {});
      return null;
    }
    case "shuffle": {
      const prio = enforce(state, seat === state.prioritySeat, "You do not have priority.");
      if (prio) return prio;
      const lib = libraryOrdered(state, action.seat);
      const ys = shuffle(lib.map((o) => o.y));
      lib.forEach((o, i) => (o.y = ys[i]!));
      log(state, { seat: action.seat, kind: "action", text: `${playerBySeat(state, action.seat)?.name} shuffles.` });
      return null;
    }
    case "scry": {
      log(state, { seat: action.seat, kind: "action", text: `${playerBySeat(state, action.seat)?.name} scries ${action.count}.` });
      return null;
    }
    case "mulligan": {
      // London mulligan: return hand, shuffle, draw 7. Each mulligan adds one to
      // the "owed bottoms" count applied on keep. Capped so you can't mulligan
      // forever to fish for a perfect hand with no cost.
      const pm = playerBySeat(state, action.seat);
      if (pm && pm.mulligansTaken >= 7) return { ok: false, error: "You can't mulligan any further." };
      for (const o of objectsIn(state, "hand", action.seat)) moveObject(state, ctx, o, "library", action.seat, {});
      const lib = libraryOrdered(state, action.seat);
      const ys = shuffle(lib.map((o) => o.y)); // proper Fisher–Yates, not a biased sort()
      lib.forEach((o, i) => (o.y = ys[i]!));
      drawCards(state, action.seat, 7);
      if (pm) pm.mulligansTaken += 1;
      log(state, { seat: action.seat, kind: "action", text: `${pm?.name} mulligans${pm ? ` (#${pm.mulligansTaken})` : ""}.` });
      return null;
    }
    case "keep_hand": {
      const pk = playerBySeat(state, action.seat);
      const owed = pk?.mulligansTaken ?? 0;
      if (owed > 0) {
        const hand = objectsIn(state, "hand", action.seat);
        let toBottom: GameObject[] = [];
        if (action.bottom && action.bottom.length) {
          const chosen = new Set(action.bottom);
          toBottom = hand.filter((o) => chosen.has(o.id));
          // In tournament play the count must be exactly right.
          if (state.enforcement === "strict" && toBottom.length !== owed) {
            return { ok: false, error: `London mulligan: put exactly ${owed} card${owed > 1 ? "s" : ""} on the bottom.` };
          }
        }
        // Enforce the mulligan cost even without a client picker: auto-bottom the
        // remainder so a mulligan always costs cards.
        if (toBottom.length !== owed) toBottom = hand.slice(0, Math.min(owed, hand.length));
        for (const o of toBottom) moveObject(state, ctx, o, "library", action.seat, { toTop: false });
        log(state, { seat: action.seat, kind: "action", text: `${pk?.name} puts ${toBottom.length} card${toBottom.length !== 1 ? "s" : ""} on the bottom (mulligan).` });
      }
      log(state, { seat: action.seat, kind: "action", text: `${pk?.name} keeps.` });
      return null;
    }
    case "set_life": {
      const isSelf = seat === action.seat;
      const valid = enforce(state, isSelf, "You can only adjust your own life total.");
      if (valid) return valid;
      const p = playerBySeat(state, action.seat);
      if (p) p.life = action.life;
      return null;
    }
    case "adjust_life": {
      const isSelf = seat === action.seat;
      const valid = enforce(state, isSelf, "You can only adjust your own life total.");
      if (valid) return valid;
      const p = playerBySeat(state, action.seat);
      if (p) {
        p.life += action.delta;
        log(state, { seat: action.seat, kind: "action", text: `${p.name} ${action.delta >= 0 ? "gains" : "loses"} ${Math.abs(action.delta)} life (now ${p.life}).` });
      }
      return null;
    }
    case "set_poison": {
      const isSelf = seat === action.seat;
      const valid = enforce(state, isSelf, "You can only adjust your own poison counters.");
      if (valid) return valid;
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
        x: action.x ?? 0,
        y: action.y ?? 0,
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
      const prio = enforce(state, seat === state.prioritySeat, "You do not have priority.");
      if (prio) return prio;
      const instant = isInstantSpeed(state, ctx, o);
      if (!instant) {
        const timing = enforce(state, seat === state.activeSeat && isMainPhase(state) && state.stackOrder.length === 0, `${o.name} can only be cast on your main phase with an empty stack (it isn't an instant).`);
        if (timing) return timing;
      }
      // Commander tax (CR 903.8): {2} more for each previous cast from the command
      // zone.
      const commanderTax = o.zone === "command" && o.isCommander ? 2 * o.commanderCasts : 0;
      // Mana enforcement (guided): pay the cost from untapped sources, respecting
      // colours. Auto-taps when the payment is forced; asks the player which
      // sources to tap when there's a real choice. Bypass via explicit Override.
      if (state.mode === "guided" && !(state as { overriding?: boolean }).overriding) {
        const ci = info(ctx, o);
        const cost = parseCost(ci?.manaCost, Math.max(0, action.x ?? 0) + commanderTax, ci?.cmc ?? 0);
        const sources = manaSourcesOf(state, ctx, seat);
        const byId = new Map(sources.map((s) => [s.id, s]));
        if (action.manaSources && action.manaSources.length) {
          // The player picked their sources explicitly.
          const chosen = action.manaSources.map((id) => byId.get(id)).filter((s): s is ManaSource => !!s);
          if (chosen.length !== action.manaSources.length) return { ok: false, error: "Some chosen mana sources are unavailable." };
          if (!selectionPays(chosen, cost)) return { ok: false, error: `Those sources don't cover ${o.name}'s cost.` };
          for (const s of chosen) { const src = state.objects[s.id]; if (src) src.tapped = true; }
        } else {
          const plan = planPayment(sources, cost);
          if (plan.status === "insufficient") {
            const label = [...cost.pips, cost.generic ? `{${cost.generic}}` : ""].filter(Boolean).join("");
            return { ok: false, error: `Not enough mana to cast ${o.name} (needs ${label || "mana"}). Tap more, or use ⚙ Manual override.` };
          }
          if (plan.status === "choice" && !action.autoMana) {
            // Hand the decision back to the player.
            return {
              ok: false,
              manaChoice: { objectId: o.id, cardName: o.name, x: Math.max(0, action.x ?? 0), cost, sources: sources.map(({ id, name, colors, amount }) => ({ id, name, colors, amount })) },
            };
          }
          for (const id of plan.tap) { const src = state.objects[id]; if (src) src.tapped = true; }
        }
      }
      if (o.zone === "command" && o.isCommander) {
        o.commanderCasts += 1;
        log(state, {
          seat,
          kind: "system",
          text: commanderTax > 0
            ? `Commander tax: {${commanderTax}} extra paid to cast ${o.name} (cast #${o.commanderCasts} from the command zone).`
            : `${o.name} cast from the command zone (no tax yet).`,
        });
      }
      o.zone = "stack";
      o.controllerSeat = seat;
      o.targets = action.targets ?? [];
      o.castMode = action.mode ?? -1;
      o.xValue = action.x ?? 0;
      state.stackOrder.push(o.id);
      state.passStreak = 0;
      recountHiddenZones(state);
      log(state, { seat, kind: "action", text: `${playerBySeat(state, seat)?.name} casts ${o.name}.` });
      return null;
    }
    case "activate": {
      const o = findObj(state, action.objectId);
      if (!o) return { ok: false, error: "Card not found" };
      const ci = info(ctx, o);
      const abilities = parseAbilities(ci?.oracleText ?? null, o.name);
      const ability = abilities[action.abilityIndex];
      if (!ability) return { ok: false, error: "No such ability" };
      const prio = enforce(state, seat === state.prioritySeat, "You do not have priority.");
      if (prio) return prio;
      // Pay the tap cost (framework-enforced); mana/other costs are on the honor
      // system for now (tracked pool). Summoning sickness blocks {T} abilities.
      if (ability.needsTap) {
        const tapCheck = enforce(state, !o.tapped, `${o.name} is already tapped.`);
        if (tapCheck) return tapCheck;
        if (isCreature(ctx, o)) {
          const sick = enforce(state, !o.summoningSick || hasKeyword(state, ctx, o, "haste"), `${o.name} has summoning sickness.`);
          if (sick) return sick;
        }
        o.tapped = true;
      }
      // Apply the ability's effect (respecting a chosen mode / X / targets).
      o.xValue = action.x ?? 0;
      const eff = ability.effect;
      const ops = eff.modes && eff.modes.length > 0 ? eff.modes[0]!.ops : eff.ops;
      applyOps(state, ctx, o, ops, action.targets ?? []);
      log(state, { seat, kind: "action", text: `${playerBySeat(state, seat)?.name} activates ${o.name}: ${ability.cost}.` });
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
      // Whoever holds priority may step forward as long as the stack is empty —
      // this is the primary "progress my turn" control. Gating on priority (not
      // just "active") means a player given an end-of-turn response window can't
      // be bulldozed past it. Previously this hard-errored in strict mode, which
      // left a player with nothing to do unable to move their turn along.
      const who = enforce(state, seat === state.prioritySeat, "You can only advance while you hold priority.");
      if (who) return who;
      const clear = enforce(state, state.stackOrder.length === 0, "Resolve the stack before advancing the step.");
      if (clear) return clear;
      advanceStep(state, ctx);
      return null;
    }
    case "end_turn": {
      const active = enforce(state, seat === state.activeSeat, "Only the active player can end the turn.");
      if (active) return active;
      const startActive = state.activeSeat;
      // If an opponent could respond at instant speed, jump straight to the end
      // step and hand THEM priority so they get a window to act before the turn
      // ends. They pass (or cast + pass) to move on to the next turn.
      const responder = state.players.find(
        (p) => p.seat !== startActive && !p.hasLost && !p.hasConceded && seatHasInstant(state, ctx, p.seat),
      );
      if (responder && state.step !== "end") {
        state.phase = "ending";
        state.step = "end";
        state.prioritySeat = responder.seat;
        state.passStreak = 0;
        log(state, { seat, kind: "phase", text: `${playerBySeat(state, seat)?.name} passes the turn — ${responder.name} may respond.` });
        return null;
      }
      // Otherwise fast-forward through the rest of the turn to the next player's
      // turn (activeSeat changes). Guarded against runaway loops.
      let guard = 0;
      while (state.activeSeat === startActive && state.status === "playing" && guard++ < 60) {
        advanceStep(state, ctx);
      }
      log(state, { seat, kind: "phase", text: `${playerBySeat(state, seat)?.name} ends the turn.` });
      return null;
    }
    case "skip_combat": {
      const timing = enforce(state, state.step === "main1", "You can only skip combat during Main 1.");
      if (timing) return timing;
      const prio = enforce(state, seat === state.activeSeat && seat === state.prioritySeat && state.stackOrder.length === 0, "You can only skip combat when it is your priority and the stack is empty.");
      if (prio) return prio;
      state.phase = "postcombat_main";
      state.step = "main2";
      log(state, { seat, kind: "phase", text: `${playerBySeat(state, seat)?.name} skips combat.` });
      onEnterStep(state, ctx);
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
      const check4 = enforce(state, !o.summoningSick || hasKeyword(state, ctx, o, "haste"), `${o.name} has summoning sickness.`);
      if (check4) return check4;
      const aflags = combatFlagsFor(state, ctx, o);
      const check5 = enforce(state, !aflags.cantAttack, `${o.name} can't attack.`);
      if (check5) return check5;
      if (aflags.attackUnlessDefenderLand) {
        const need = aflags.attackUnlessDefenderLand;
        const c = enforce(state, controlsLandType(state, ctx, action.defendingSeat, need), `${o.name} can't attack unless the defending player controls a ${need}.`);
        if (c) return c;
      }
      o.attacking = action.defendingSeat;
      if (!hasKeyword(state, ctx, o, "vigilance")) o.tapped = true;
      log(state, { seat, kind: "combat", text: `${o.name} attacks ${playerBySeat(state, action.defendingSeat)?.name}.` });
      runTriggers(state, ctx, o, "attack");
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
      const bFlags = combatFlagsFor(state, ctx, blocker);
      const aFlags = combatFlagsFor(state, ctx, attacker);
      const c2b = enforce(state, !bFlags.cantBlock, `${blocker.name} can't block.`);
      if (c2b) return c2b;
      const c3 = enforce(state, attacker.attacking !== null, `${attacker.name} isn't attacking.`);
      if (c3) return c3;
      const c4 = enforce(
        state,
        !hasKeyword(state, ctx, attacker, "flying") || hasKeyword(state, ctx, blocker, "flying") || hasKeyword(state, ctx, blocker, "reach"),
        `${blocker.name} can't block ${attacker.name} — it has flying.`,
      );
      if (c4) return c4;
      const c5 = enforce(state, !aFlags.cantBeBlocked, `${attacker.name} can't be blocked.`);
      if (c5) return c5;
      const c6 = enforce(state, !bFlags.blockOnlyFlying || hasKeyword(state, ctx, attacker, "flying"), `${blocker.name} can only block creatures with flying.`);
      if (c6) return c6;
      const walk = aFlags.landwalk.find((lt) => controlsLandType(state, ctx, blocker.controllerSeat, lt));
      const c7 = enforce(state, !walk, `${attacker.name} has ${walk}walk — it can't be blocked while you control a ${walk}.`);
      if (c7) return c7;
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
      if (action.action === "destroy" && hasKeyword(state, ctx, o, "indestructible")) {
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
      for (let i = 0; i < count; i++) values.push(1 + randomInt(sides));
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
      const rolls = state.players.map((p) => ({ seat: p.seat, name: p.name, v: 1 + randomInt(20) }));
      const max = Math.max(...rolls.map((r) => r.v));
      const winners = rolls.filter((r) => r.v === max);
      const winner = winners[randomInt(winners.length)]!.seat;
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
    regenShield: 0,
    commanderCasts: 0,
    castMode: -1,
    xValue: 0,
    cardTypes: null,
    keywords: null,
  };
}

function cryptoRandomId(): string {
  return "tok_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function pow(state: TableState, ctx: CardIndex, o: GameObject): number {
  return derivePT(state, ctx, o, info(ctx, o) ?? undefined).power;
}
function tou(state: TableState, ctx: CardIndex, o: GameObject): number {
  return derivePT(state, ctx, o, info(ctx, o) ?? undefined).toughness;
}
function toxicAmount(ctx: CardIndex, o: GameObject): number {
  const m = (info(ctx, o)?.oracleText ?? "").match(/toxic (\d+)/i);
  return m ? parseInt(m[1]!, 10) : 0;
}
function dealToCreature(state: TableState, ctx: CardIndex, source: GameObject, target: GameObject, amount: number): void {
  if (amount <= 0) return;
  // Infect deals its combat damage to creatures as -1/-1 counters.
  if (hasKeyword(state, ctx, source, "infect")) {
    const c = target.counters.find((x) => x.type === "-1/-1");
    if (c) c.count += amount;
    else target.counters.push({ type: "-1/-1", count: amount });
  } else {
    target.damage += amount;
  }
  if (hasKeyword(state, ctx, source, "deathtouch")) target.deathtouched = true;
  if (hasKeyword(state, ctx, source, "lifelink")) {
    const c = playerBySeat(state, source.controllerSeat);
    if (c) c.life += amount;
  }
}
function dealToPlayer(state: TableState, ctx: CardIndex, source: GameObject, seat: number, amount: number): void {
  if (amount <= 0) return;
  const p = playerBySeat(state, seat);
  if (p) {
    // Infect deals damage to players as poison counters instead of life loss.
    if (hasKeyword(state, ctx, source, "infect")) {
      p.poison += amount;
    } else {
      p.life -= amount;
      if (source.isCommander) p.commanderDamage[source.controllerSeat] = (p.commanderDamage[source.controllerSeat] ?? 0) + amount;
      // Toxic N adds N poison counters when a creature deals combat damage to a player.
      const tox = toxicAmount(ctx, source);
      if (tox > 0) p.poison += tox;
    }
  }
  if (hasKeyword(state, ctx, source, "lifelink")) {
    const c = playerBySeat(state, source.controllerSeat);
    if (c) c.life += amount;
  }
}

// Full keyword-aware combat resolution: first-strike/regular sub-steps, deathtouch,
// trample, lifelink, and commander damage — the "do all the math" automation.
// Verified vs the Comprehensive Rules (docs/comprehensive-rules.txt): first strike
// 702.7, double strike 702.4, deathtouch 702.2b / SBA 704.5h, trample 702.19b/d,
// lifelink 702.15, vigilance 702.20, flying 702.9, reach 702.17, menace 702.111,
// infect 702.90b/c, toxic 702.164 / 120.3g, indestructible 702.12b.
function resolveCombat(state: TableState, ctx: CardIndex): void {
  const attackers = objectsIn(state, "battlefield").filter((o) => o.attacking !== null);
  if (attackers.length === 0) return;
  // Menace: a creature with menace can't be blocked by exactly one creature.
  for (const atk of attackers) {
    if (!hasKeyword(state, ctx, atk, "menace")) continue;
    const bs = objectsIn(state, "battlefield").filter((o) => o.blocking === atk.id);
    if (bs.length === 1) {
      bs[0]!.blocking = null;
      log(state, { seat: atk.controllerSeat, kind: "combat", text: `${atk.name} has menace — a lone blocker can't block it.` });
    }
  }
  const blockedIds = new Set(
    objectsIn(state, "battlefield").filter((o) => o.blocking !== null).map((o) => o.blocking as string),
  );

  const dealsInStep = (o: GameObject, step: "first" | "regular"): boolean => {
    const fs = hasKeyword(state, ctx, o, "first strike");
    const ds = hasKeyword(state, ctx, o, "double strike");
    return step === "first" ? fs || ds : !fs || ds;
  };

  for (const step of ["first", "regular"] as const) {
    // Only run the first-strike step if someone actually has (double) first strike.
    if (step === "first") {
      const anyFS = objectsIn(state, "battlefield").some(
        (o) => (o.attacking !== null || o.blocking !== null) && (hasKeyword(state, ctx, o, "first strike") || hasKeyword(state, ctx, o, "double strike")),
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
        } else if (hasKeyword(state, ctx, atk, "trample")) {
          // Blockers all died; trample the rest through.
          dealToPlayer(state, ctx, atk, atk.attacking!, power);
        }
      } else {
        let remaining = power;
        for (const b of blockers) {
          const lethal = hasKeyword(state, ctx, atk, "deathtouch") ? 1 : Math.max(0, tou(state, ctx, b) - b.damage);
          const assign = Math.min(remaining, lethal > 0 ? lethal : remaining);
          dealToCreature(state, ctx, atk, b, assign);
          remaining -= assign;
        }
        if (remaining > 0 && hasKeyword(state, ctx, atk, "trample")) dealToPlayer(state, ctx, atk, atk.attacking!, remaining);
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
