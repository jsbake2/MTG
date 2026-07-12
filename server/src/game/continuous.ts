// ---------------------------------------------------------------------------
// CONTINUOUS EFFECTS — the layer system (CR 613), applied at read time.
//
// A creature's effective P/T and keywords depend not only on its own printed
// values, counters and until-end-of-turn pumps, but on ongoing static effects
// produced by OTHER permanents: Auras/Equipment attached to it and anthems that
// buff a set of creatures. This module walks the battlefield and folds those in:
//   - Layer 6  — ability grants ("has flying")
//   - Layer 7d — P/T-changing effects that aren't counters (+N/+N)
//
// Verified against docs/comprehensive-rules.txt: 613.4 layer order; 613.4d
// (7a CDAs, 7b set, 7c counters, 7d other +N/+N). effectivePT already applies
// 7b→7c→7d(own tempBoost) in order; static +N/+N is 7d and additive, so folding
// it in after is order-correct. Set-P/T from other permanents (rare) and
// restriction clauses (Pacifism) are NOT modeled here — they fall back to manual.
// ---------------------------------------------------------------------------
import { compileStatic, type GameObject, type StaticEffect, type TableState } from "@mtg/shared";
import { effectivePT, objectsIn } from "./state.js";

// Structural subset of engine's CardInfo — avoids a runtime import cycle.
interface CardInfoLite {
  power: string | null;
  toughness: string | null;
  keywords: string[];
  oracleText: string | null;
  cardTypes: string[];
  typeLine: string;
}
type Ctx = Record<string, CardInfoLite>;

function infoOf(ctx: Ctx, o: GameObject): CardInfoLite | null {
  return o.cardId ? ctx[o.cardId] ?? null : null;
}
function isCreature(ctx: Ctx, o: GameObject): boolean {
  const types = o.cardTypes ?? infoOf(ctx, o)?.cardTypes ?? [];
  return types.includes("Creature");
}

// Compile+cache the static effects a permanent contributes, keyed by cardId.
const cache = new Map<string, StaticEffect[]>();
function staticEffectsOf(ctx: Ctx, o: GameObject): StaticEffect[] {
  const ci = infoOf(ctx, o);
  if (!ci) return [];
  const key = o.cardId!;
  let effs = cache.get(key);
  if (!effs) {
    effs = compileStatic(ci.oracleText, o.name);
    cache.set(key, effs);
  }
  return effs;
}

// Does anthem effect `eff` produced by source `src` apply to creature `target`?
function anthemApplies(eff: StaticEffect, src: GameObject, target: GameObject): boolean {
  if (eff.othersOnly && src.id === target.id) return false;
  if (eff.controller === "you") return target.controllerSeat === src.controllerSeat;
  if (eff.controller === "opponents") return target.controllerSeat !== src.controllerSeat;
  return true; // "all"
}

// Sum the static P/T bonus and collect granted keywords that apply to `target`.
export function staticBonusFor(
  state: TableState,
  ctx: Ctx,
  target: GameObject,
): { power: number; toughness: number; keywords: string[] } {
  let power = 0;
  let toughness = 0;
  const keywords = new Set<string>();
  const creature = isCreature(ctx, target);
  for (const src of objectsIn(state, "battlefield")) {
    const effs = staticEffectsOf(ctx, src);
    if (effs.length === 0) continue;
    for (const eff of effs) {
      let applies = false;
      if (eff.scope === "attached") applies = src.attachedTo === target.id;
      else if (eff.scope === "anthem") applies = creature && anthemApplies(eff, src, target);
      if (!applies) continue;
      power += eff.power;
      toughness += eff.toughness;
      for (const k of eff.keywords) keywords.add(k);
    }
  }
  return { power, toughness, keywords: [...keywords] };
}

// Layer-aware effective P/T: own values (7b/7c/7d) + static +N/+N from others.
export function derivePT(
  state: TableState,
  ctx: Ctx,
  o: GameObject,
  printed?: { power: string | null; toughness: string | null },
): { power: number; toughness: number } {
  const base = effectivePT(state, o, printed);
  const bonus = staticBonusFor(state, ctx, o);
  return { power: base.power + bonus.power, toughness: base.toughness + bonus.toughness };
}

// Keywords granted to `o` by static effects from other permanents (auras/anthems).
export function staticKeywordsFor(state: TableState, ctx: Ctx, o: GameObject): string[] {
  return staticBonusFor(state, ctx, o).keywords;
}

// Combat restrictions imposed on `o` by attached auras/equipment (Pacifism, etc.).
export function restrictionsFor(state: TableState, ctx: Ctx, o: GameObject): { cantAttack: boolean; cantBlock: boolean } {
  let cantAttack = false;
  let cantBlock = false;
  for (const src of objectsIn(state, "battlefield")) {
    if (src.attachedTo !== o.id) continue;
    for (const eff of staticEffectsOf(ctx, src)) {
      if (eff.cantAttack) cantAttack = true;
      if (eff.cantBlock) cantBlock = true;
    }
  }
  return { cantAttack, cantBlock };
}

// Does `seat` control a land whose type line names `landType` (e.g. "Swamp")?
export function controlsLandType(state: TableState, ctx: Ctx, seat: number, landType: string): boolean {
  const t = landType.toLowerCase();
  for (const o of objectsIn(state, "battlefield")) {
    if (o.controllerSeat !== seat) continue;
    const tl = (infoOf(ctx, o)?.typeLine ?? "").toLowerCase();
    if (tl.includes("land") && tl.includes(t)) return true;
  }
  return false;
}

const LAND_TYPES = ["plains", "island", "swamp", "mountain", "forest"];

// Combat restrictions/evasion derived from a creature's OWN oracle text plus any
// attached-aura restrictions. Conditional/ambiguous phrasings are intentionally
// NOT flagged (they fall back to manual) so the engine is never silently wrong.
export function combatFlagsFor(state: TableState, ctx: Ctx, o: GameObject): {
  cantAttack: boolean;
  cantBlock: boolean;
  mustAttack: boolean;
  cantBeBlocked: boolean;
  blockOnlyFlying: boolean;
  landwalk: string[]; // land types that make this attacker unblockable
  attackUnlessDefenderLand: string | null; // reverse landwalk
} {
  const text = (infoOf(ctx, o)?.oracleText ?? "").toLowerCase();
  const aura = restrictionsFor(state, ctx, o);
  const has = (re: RegExp) => re.test(text);

  const cantAttackUnless = /can'?t attack unless defending player controls (?:an?|a) (plains|island|swamp|mountain|forest)/.exec(text);
  const landwalk = LAND_TYPES.filter((lt) => new RegExp(`\\b${lt}walk\\b`).test(text));

  return {
    cantAttack: aura.cantAttack || (has(/\bcan'?t attack\b/) && !has(/can'?t attack unless/) && !has(/can'?t attack you\b/)),
    cantBlock: aura.cantBlock || (has(/\bcan'?t block\b/) && !has(/can'?t block unless/) && !has(/can block only/)),
    mustAttack: has(/attacks each combat if able/),
    cantBeBlocked: has(/\bcan'?t be blocked\b/) && !has(/can'?t be blocked except|can'?t be blocked unless|can'?t be blocked by more than/),
    blockOnlyFlying: has(/can block only creatures with flying/),
    landwalk,
    attackUnlessDefenderLand: cantAttackUnless ? cantAttackUnless[1]! : null,
  };
}

// Clear the compile cache (call if card text can change at runtime; mainly tests).
export function _clearStaticCache(): void {
  cache.clear();
}
