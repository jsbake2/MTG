import { test } from "node:test";
import assert from "node:assert/strict";
import { evalCount, resolveAmount } from "./count.js";
import type { ValidObject } from "./valid.js";

const src: ValidObject = { id: "s", kind: "permanent", cardTypes: ["Creature"], power: 3, toughness: 2, cmc: 4, counters: { P1P1: 2 } };
const pool: ValidObject[] = [
  { id: "a", kind: "permanent", cardTypes: ["Creature"], controllerSeat: 0 },
  { id: "b", kind: "permanent", cardTypes: ["Creature"], controllerSeat: 0 },
  { id: "c", kind: "permanent", cardTypes: ["Creature"], controllerSeat: 1 },
  { id: "d", kind: "permanent", cardTypes: ["Land"], controllerSeat: 0 },
];

test("xPaid and literals", () => {
  assert.equal(evalCount("xPaid", { xPaid: 5 }), 5);
  assert.equal(evalCount("3"), 3);
});

test("card characteristics + counters", () => {
  assert.equal(evalCount("CardPower", { source: src }), 3);
  assert.equal(evalCount("CardCMC", { source: src }), 4);
  assert.equal(evalCount("CardCounters.P1P1", { source: src }), 2);
});

test("Valid counting", () => {
  assert.equal(evalCount("Valid Creature.YouCtrl", { objects: pool, validCtx: { youSeat: 0 } }), 2);
  assert.equal(evalCount("Valid Creature", { objects: pool }), 3);
});

test("math suffixes", () => {
  assert.equal(evalCount("xPaid.Twice", { xPaid: 3 }), 6);
  assert.equal(evalCount("xPaid.Plus2", { xPaid: 3 }), 5);
  assert.equal(evalCount("CardPower.HalfUp", { source: src }), 2); // ceil(3/2)
  assert.equal(evalCount("Valid Creature.YouCtrl.Plus1", { objects: pool, validCtx: { youSeat: 0 } }), 3);
  assert.equal(evalCount("CardCounters.P1P1.Twice", { source: src }), 4);
  assert.equal(evalCount("xPaid.NMinus10", { xPaid: 4 }), 6);
});

test("resolveAmount with literal, Count$, and SVar", () => {
  assert.equal(resolveAmount("3", {}), 3);
  assert.equal(resolveAmount(4, {}), 4);
  assert.equal(resolveAmount("Count$xPaid", { xPaid: 7 }), 7);
  assert.equal(resolveAmount("X", { xPaid: 2 }, { X: "Count$xPaid" }), 2);
  assert.equal(resolveAmount("Y", { objects: pool, validCtx: { youSeat: 0 } }, { Y: "Count$Valid Creature.YouCtrl" }), 2);
});
