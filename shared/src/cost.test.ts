import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCostString, describeCost } from "./cost.js";

test("mana + tap", () => {
  const c = parseCostString("2 B");
  assert.equal(c.mana.generic, 2);
  assert.equal(c.mana.B, 1);
  const t = parseCostString("T");
  assert.equal(t.tap, true);
});

test("X and XMin1", () => {
  const c = parseCostString("X G XMin1");
  assert.equal(c.mana.x, true);
  assert.equal(c.mana.xMin1, true);
  assert.equal(c.mana.G, 1);
});

test("tap + sacrifice", () => {
  const c = parseCostString("T Sac<1/Creature>");
  assert.equal(c.tap, true);
  assert.equal(c.parts.length, 1);
  assert.deepEqual(c.parts[0], { type: "sacrifice", count: 1, valid: "Creature" });
});

test("discard / payLife / tapType / counters / exile-from", () => {
  assert.deepEqual(parseCostString("Discard<1/Creature>").parts[0], { type: "discard", count: 1, valid: "Creature" });
  assert.deepEqual(parseCostString("PayLife<2>").parts[0], { type: "payLife", amount: 2 });
  assert.deepEqual(parseCostString("tapXType<1/Creature>").parts[0], { type: "tapType", count: 1, valid: "Creature" });
  assert.deepEqual(parseCostString("AddCounter<1/LOYALTY>").parts[0], { type: "addCounter", count: 1, counter: "LOYALTY" });
  assert.deepEqual(parseCostString("ExileFromGrave<3/Card.Other>").parts[0], { type: "exile", count: 3, valid: "Card.Other", from: "Graveyard" });
});

test("describeCost", () => {
  assert.equal(describeCost(parseCostString("2 B")), "{2}{B}");
  assert.equal(describeCost(parseCostString("T Sac<1/Creature>")), "{T}, Sacrifice 1 Creature");
});
