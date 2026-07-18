import { test } from "node:test";
import assert from "node:assert/strict";
import { applyLayers, mods, type DerivedChars } from "./layers.js";

const base = (): DerivedChars => ({ power: 2, toughness: 2, cardTypes: ["Creature"], subtypes: ["Bear"], colors: ["G"], keywords: [], loseAllAbilities: false });

test("setPT (7b) applies before boost (7c) regardless of timestamp", () => {
  // boost registered FIRST (ts 1), setPT registered later (ts 2). Layer order wins.
  const r = applyLayers(base(), [mods.boostPT("boost", 1, 3, 3), mods.setPT("set", 2, 0, 4)]);
  assert.equal(r.power, 3); // 0 (set) + 3 (boost)
  assert.equal(r.toughness, 7); // 4 + 3
});

test("counters (7d) after boosts (7c)", () => {
  const r = applyLayers(base(), [mods.boostPT("b", 1, 1, 1), mods.counters("c", 2, 2, 0)]);
  assert.equal(r.power, 2 + 1 + 2);
  assert.equal(r.toughness, 2 + 1 + 2);
});

test("switch P/T (7e) is last", () => {
  const r = applyLayers(base(), [mods.setPT("s", 1, 1, 4), mods.switchPT("sw", 2)]);
  assert.equal(r.power, 4);
  assert.equal(r.toughness, 1);
});

test("timestamp order within a sublayer (two anthems)", () => {
  const r = applyLayers(base(), [mods.boostPT("a", 2, 1, 1), mods.boostPT("b", 1, 2, 0)]);
  assert.equal(r.power, 2 + 2 + 1); // both apply; order doesn't change sum here
  assert.equal(r.toughness, 2 + 0 + 1);
});

test("type (4) then keyword (6); lose-all-abilities wipes keywords", () => {
  const r = applyLayers(base(), [
    mods.addType("t", 1, "Artifact"),
    mods.addKeyword("k", 2, "Flying"),
    mods.loseAbilities("lose", 3),
  ]);
  assert.ok(r.cardTypes.includes("Artifact"));
  assert.deepEqual(r.keywords, []); // lose-all after keyword grant
});

test("keyword granted AFTER lose-all still lost? (timestamp/layer) — Lignify case", () => {
  // Lose abilities ts1, grant flying ts2 (later) in the same layer 6 → flying survives.
  const r = applyLayers(base(), [mods.loseAbilities("lose", 1), mods.addKeyword("k", 2, "Flying")]);
  assert.deepEqual(r.keywords, ["flying"]);
});

test("dependency overrides timestamp", () => {
  // 'b' depends on 'a' so 'a' applies first even though 'b' has the earlier ts.
  const order: string[] = [];
  const a = { id: "a", timestamp: 5, layer: 6 as const, apply: () => order.push("a") };
  const b = { id: "b", timestamp: 1, layer: 6 as const, dependsOn: ["a"], apply: () => order.push("b") };
  applyLayers(base(), [a, b]);
  assert.deepEqual(order, ["a", "b"]);
});
