// ---------------------------------------------------------------------------
// PER-CARD SCRIPT HOOK. Exact, hand-authored effect scripts keyed by card name.
// These OVERRIDE the pattern compiler for 100%-correct behavior — this is how a
// card the compiler can't parse (modal, "for each", copy, anaphora, variable
// amounts) gets made correct, one card at a time (the XMage/MTGA model).
//
// A script is just a list of EffectOps, so it plugs straight into the existing
// executor + targeting. Add a card by dropping its ops in here.
// ---------------------------------------------------------------------------
import type { EffectOp } from "./effects.js";

const any = { scope: "target", kind: "any" } as const;
const you = { scope: "you" } as const;
const tCreature = { scope: "target", kind: "creature" } as const;
const tPermanent = { scope: "target", kind: "permanent" } as const;
const allCreatures = { creaturesOnly: true, types: [] as string[], controller: "all" as const };

export const CARD_SCRIPTS: Record<string, EffectOp[]> = {
  "lightning bolt": [{ op: "damage", to: any, amount: 3 }],
  "shock": [{ op: "damage", to: any, amount: 2 }],
  "lightning strike": [{ op: "damage", to: any, amount: 3 }],
  "lightning helix": [{ op: "damage", to: any, amount: 3 }, { op: "gain_life", who: you, amount: 3 }],
  "char": [{ op: "damage", to: any, amount: 3 }, { op: "lose_life", who: you, amount: 1 }],
  "electrolyze": [{ op: "damage", to: any, amount: 2 }, { op: "draw", who: you, count: 1 }],
  "wrath of god": [{ op: "mass_destroy", filter: allCreatures }],
  "day of judgment": [{ op: "mass_destroy", filter: allCreatures }],
  "damnation": [{ op: "mass_destroy", filter: allCreatures }],
  "pyroclasm": [{ op: "mass_damage", filter: allCreatures, amount: 2 }],
  "anger of the gods": [{ op: "mass_damage", filter: allCreatures, amount: 3 }],
  "giant growth": [{ op: "pump", what: tCreature, power: 3, toughness: 3 }],
  "titanic growth": [{ op: "pump", what: tCreature, power: 4, toughness: 4 }],
  "divination": [{ op: "draw", who: you, count: 2 }],
  "murder": [{ op: "destroy", what: tCreature }],
  "doom blade": [{ op: "destroy", what: tCreature }],
  "cancel": [{ op: "counter", what: { scope: "target", kind: "spell" } }],
  "negate": [{ op: "counter", what: { scope: "target", kind: "spell" } }],
  "naturalize": [{ op: "destroy", what: tPermanent }],
  "disenchant": [{ op: "destroy", what: tPermanent }],
  "healing salve": [{ op: "gain_life", who: you, amount: 3 }],
  "mind rot": [{ op: "manual", hint: "target player discards two cards" }],
};

export function scriptFor(name: string): EffectOp[] | null {
  if (!name) return null;
  const key = name.trim().toLowerCase();
  return CARD_SCRIPTS[key] ?? CARD_SCRIPTS[key.split("//")[0]!.trim()] ?? null;
}

export function scriptCount(): number {
  return Object.keys(CARD_SCRIPTS).length;
}
