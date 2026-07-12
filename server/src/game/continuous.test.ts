// Behavioral tests for the continuous-effects layer (CR 613).
// Run: npm run test  (node --import tsx --test src/game/*.test.ts)
import { test } from "node:test";
import assert from "node:assert/strict";
import { compileStatic, type GameObject, type TableState } from "@mtg/shared";
import { newObject } from "./state.js";
import { derivePT, staticKeywordsFor, restrictionsFor, combatFlagsFor, controlsLandType, _clearStaticCache } from "./continuous.js";

// --- minimal fixtures -------------------------------------------------------
interface Info { power: string | null; toughness: string | null; keywords: string[]; oracleText: string | null; cardTypes: string[]; typeLine: string; }
const ctx: Record<string, Info> = {};
let n = 0;
function perm(opts: { cardId: string; power?: string; toughness?: string; oracle?: string; controller?: number; attachedTo?: string; types?: string[] }): GameObject {
  ctx[opts.cardId] = {
    power: opts.power ?? null, toughness: opts.toughness ?? null, keywords: [],
    oracleText: opts.oracle ?? null, cardTypes: opts.types ?? (opts.power ? ["Creature"] : ["Enchantment"]),
    typeLine: "",
  };
  const o = newObject({ name: opts.cardId, ownerSeat: opts.controller ?? 0, zone: "battlefield" });
  o.cardId = opts.cardId;
  o.id = `o${n++}`;
  o.controllerSeat = opts.controller ?? 0;
  if (opts.attachedTo) o.attachedTo = opts.attachedTo;
  return o;
}
function stateOf(...objs: GameObject[]): TableState {
  const objects: Record<string, GameObject> = {};
  for (const o of objs) objects[o.id] = o;
  return { objects } as unknown as TableState;
}
function reset() { for (const k of Object.keys(ctx)) delete ctx[k]; n = 0; _clearStaticCache(); }

// --- compileStatic unit tests ----------------------------------------------
test("compileStatic: equipment +P/+P", () => {
  const e = compileStatic("Equipped creature gets +2/+1.", "Sword");
  assert.deepEqual(e, [{ scope: "attached", power: 2, toughness: 1, keywords: [] }]);
});
test("compileStatic: aura P/T + keyword", () => {
  const e = compileStatic("Enchanted creature gets +1/+1 and has flying.", "Wings");
  assert.equal(e.length, 1);
  assert.equal(e[0]!.power, 1);
  assert.deepEqual(e[0]!.keywords, ["flying"]);
});
test("compileStatic: anthem you-control", () => {
  const e = compileStatic("Creatures you control get +1/+1.", "Anthem");
  assert.deepEqual(e, [{ scope: "anthem", power: 1, toughness: 1, keywords: [], controller: "you", othersOnly: false }]);
});
test("compileStatic: 'other creatures' sets othersOnly", () => {
  const e = compileStatic("Other creatures you control get +1/+1.", "Lord");
  assert.equal(e[0]!.othersOnly, true);
});
test("compileStatic: until-end-of-turn pump is NOT static", () => {
  assert.deepEqual(compileStatic("Creatures you control get +2/+2 until end of turn.", "Overrun"), []);
});

// --- behavioral: derivePT folds statics into P/T ---------------------------
test("equipment buffs the equipped creature only", () => {
  reset();
  const bear = perm({ cardId: "bear", power: "2", toughness: "2" });
  const other = perm({ cardId: "other", power: "1", toughness: "1", controller: 0 });
  const sword = perm({ cardId: "sword", oracle: "Equipped creature gets +2/+1.", attachedTo: bear.id });
  const st = stateOf(bear, other, sword);
  assert.deepEqual(derivePT(st, ctx, bear, ctx.bear), { power: 4, toughness: 3 });
  assert.deepEqual(derivePT(st, ctx, other, ctx.other), { power: 1, toughness: 1 });
});

test("aura grants +1/+1 and flying keyword", () => {
  reset();
  const bear = perm({ cardId: "bear", power: "2", toughness: "2" });
  const wings = perm({ cardId: "wings", oracle: "Enchanted creature gets +1/+1 and has flying.", attachedTo: bear.id });
  const st = stateOf(bear, wings);
  assert.deepEqual(derivePT(st, ctx, bear, ctx.bear), { power: 3, toughness: 3 });
  assert.deepEqual(staticKeywordsFor(st, ctx, bear), ["flying"]);
});

test("anthem buffs only your creatures", () => {
  reset();
  const mine = perm({ cardId: "mine", power: "2", toughness: "2", controller: 0 });
  const theirs = perm({ cardId: "theirs", power: "2", toughness: "2", controller: 1 });
  const anthem = perm({ cardId: "anthem", oracle: "Creatures you control get +1/+1.", controller: 0 });
  const st = stateOf(mine, theirs, anthem);
  assert.deepEqual(derivePT(st, ctx, mine, ctx.mine), { power: 3, toughness: 3 });
  assert.deepEqual(derivePT(st, ctx, theirs, ctx.theirs), { power: 2, toughness: 2 });
});

test("'other creatures you control' excludes the source creature", () => {
  reset();
  const lord = perm({ cardId: "lord", power: "2", toughness: "2", oracle: "Other creatures you control get +1/+1.", controller: 0, types: ["Creature"] });
  const buddy = perm({ cardId: "buddy", power: "1", toughness: "1", controller: 0 });
  const st = stateOf(lord, buddy);
  assert.deepEqual(derivePT(st, ctx, lord, ctx.lord), { power: 2, toughness: 2 }); // not self-buffed
  assert.deepEqual(derivePT(st, ctx, buddy, ctx.buddy), { power: 2, toughness: 2 }); // +1/+1
});

test("compileStatic: Pacifism-style restriction", () => {
  const e = compileStatic("Enchanted creature can't attack or block.", "Pacifism");
  assert.equal(e.length, 1);
  assert.equal(e[0]!.cantAttack, true);
  assert.equal(e[0]!.cantBlock, true);
});

test("aura restriction: enchanted creature can't attack or block", () => {
  reset();
  const bear = perm({ cardId: "bear", power: "2", toughness: "2" });
  const pacifism = perm({ cardId: "pacifism", oracle: "Enchanted creature can't attack or block.", attachedTo: bear.id });
  const st = stateOf(bear, pacifism);
  assert.deepEqual(restrictionsFor(st, ctx, bear), { cantAttack: true, cantBlock: true });
});

test("aura restriction: can't block only", () => {
  reset();
  const bear = perm({ cardId: "bear", power: "2", toughness: "2" });
  const chains = perm({ cardId: "chains", oracle: "Enchanted creature can't block.", attachedTo: bear.id });
  const st = stateOf(bear, chains);
  assert.deepEqual(restrictionsFor(st, ctx, bear), { cantAttack: false, cantBlock: true });
});

test("combatFlagsFor: own-text can't block / can't be blocked / must attack", () => {
  reset();
  const wall = perm({ cardId: "wall", power: "0", toughness: "4", oracle: "Defender (This creature can't attack.)\nThis creature can't block." });
  const sneak = perm({ cardId: "sneak", power: "2", toughness: "2", oracle: "This creature can't be blocked." });
  const rager = perm({ cardId: "rager", power: "3", toughness: "1", oracle: "This creature attacks each combat if able." });
  const st = stateOf(wall, sneak, rager);
  assert.equal(combatFlagsFor(st, ctx, wall).cantBlock, true);
  assert.equal(combatFlagsFor(st, ctx, sneak).cantBeBlocked, true);
  assert.equal(combatFlagsFor(st, ctx, rager).mustAttack, true);
});

test("combatFlagsFor: landwalk + reverse landwalk + block-only-flying", () => {
  reset();
  const swampy = perm({ cardId: "swampy", power: "2", toughness: "2", oracle: "Swampwalk (This creature can't be blocked as long as defending player controls a Swamp.)" });
  const isl = perm({ cardId: "isl", power: "1", toughness: "1", oracle: "This creature can't attack unless defending player controls an Island." });
  const spider = perm({ cardId: "spider", power: "1", toughness: "3", oracle: "Reach\nThis creature can block only creatures with flying." });
  const st = stateOf(swampy, isl, spider);
  assert.deepEqual(combatFlagsFor(st, ctx, swampy).landwalk, ["swamp"]);
  assert.equal(combatFlagsFor(st, ctx, isl).attackUnlessDefenderLand, "island");
  assert.equal(combatFlagsFor(st, ctx, spider).blockOnlyFlying, true);
});

test("controlsLandType detects a controlled land by type line", () => {
  reset();
  const swamp = perm({ cardId: "swamp", types: ["Land"] });
  ctx.swamp.typeLine = "Basic Land — Swamp";
  const st = stateOf(swamp);
  assert.equal(controlsLandType(st, ctx, 0, "swamp"), true);
  assert.equal(controlsLandType(st, ctx, 0, "island"), false);
  assert.equal(controlsLandType(st, ctx, 1, "swamp"), false);
});

test("counters and anthem stack correctly (layers 7c + 7d)", () => {
  reset();
  const bear = perm({ cardId: "bear", power: "2", toughness: "2", controller: 0 });
  bear.counters = [{ type: "+1/+1", count: 1 }];
  const anthem = perm({ cardId: "anthem", oracle: "Creatures you control get +1/+1.", controller: 0 });
  const st = stateOf(bear, anthem);
  // 2/2 base + 1/1 counter + 1/1 anthem = 4/4
  assert.deepEqual(derivePT(st, ctx, bear, ctx.bear), { power: 4, toughness: 4 });
});
