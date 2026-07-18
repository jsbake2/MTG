import { test } from "node:test";
import assert from "node:assert/strict";
import { parseValid, type ValidObject } from "./valid.js";

const bear: ValidObject = { id: "bear", kind: "permanent", cardTypes: ["Creature"], subtypes: ["Bear"], colors: ["G"], power: 2, toughness: 2, controllerSeat: 0, ownerSeat: 0, cmc: 2, keywords: ["vigilance"] };
const oppDragon: ValidObject = { id: "drag", kind: "permanent", cardTypes: ["Creature"], subtypes: ["Dragon"], colors: ["R"], power: 5, toughness: 5, controllerSeat: 1, ownerSeat: 1, cmc: 6, keywords: ["flying"], attacking: true, counters: { P1P1: 2 } };
const island: ValidObject = { id: "isl", kind: "permanent", cardTypes: ["Land"], subtypes: ["Island"], colors: [], controllerSeat: 0, ownerSeat: 0, tapped: true };
const bolt: ValidObject = { id: "b", kind: "spell", cardTypes: ["Instant"], colors: ["R"], cmc: 1, controllerSeat: 0 };
const you = { youSeat: 0 };

test("base types", () => {
  assert.equal(parseValid("Creature")(bear), true);
  assert.equal(parseValid("Creature")(island), false);
  assert.equal(parseValid("Land")(island), true);
  assert.equal(parseValid("Card")(island), true);
  assert.equal(parseValid("Spell")(bolt), true);
  assert.equal(parseValid("Spell")(bear), false);
});

test("comma = OR", () => {
  const p = parseValid("Artifact,Enchantment,Land");
  assert.equal(p(island), true);
  assert.equal(p(bear), false);
});

test("subtype base", () => {
  assert.equal(parseValid("Dragon")(oppDragon), true);
  assert.equal(parseValid("Bear")(oppDragon), false);
});

test("control qualifiers", () => {
  assert.equal(parseValid("Creature.YouCtrl")(bear, you), true);
  assert.equal(parseValid("Creature.YouCtrl")(oppDragon, you), false);
  assert.equal(parseValid("Creature.OppCtrl")(oppDragon, you), true);
  assert.equal(parseValid("Creature.YouCtrl")(bear, { youSeat: 1 }), false);
});

test("AND of qualifiers with +", () => {
  assert.equal(parseValid("Creature.OppCtrl+powerGE4")(oppDragon, you), true);
  assert.equal(parseValid("Creature.OppCtrl+powerGE6")(oppDragon, you), false);
  assert.equal(parseValid("Creature.YouCtrl+powerGE4")(bear, you), false);
});

test("negation with !", () => {
  assert.equal(parseValid("Land.!token")(island), true);
  assert.equal(parseValid("Creature.!attacking")(bear), true);
  assert.equal(parseValid("Creature.!attacking")(oppDragon), false);
});

test("colors", () => {
  assert.equal(parseValid("Creature.Red")(oppDragon), true);
  assert.equal(parseValid("Creature.Green")(oppDragon), false);
  assert.equal(parseValid("Permanent.Colorless")(island), true);
});

test("numeric + counters + keywords", () => {
  assert.equal(parseValid("Creature.cmcLE2")(bear), true);
  assert.equal(parseValid("Creature.cmcLE2")(oppDragon), false);
  assert.equal(parseValid("Creature.counters_GE1_P1P1")(oppDragon), true);
  assert.equal(parseValid("Creature.counters_GE1_P1P1")(bear), false);
  assert.equal(parseValid("Creature.withFlying")(oppDragon), true);
  assert.equal(parseValid("Creature.withFlying")(bear), false);
});

test("Self / Other", () => {
  assert.equal(parseValid("Creature.Self")(bear, { sourceId: "bear" }), true);
  assert.equal(parseValid("Creature.Other")(bear, { sourceId: "bear" }), false);
  assert.equal(parseValid("Creature.Other")(oppDragon, { sourceId: "bear" }), true);
});

test("composed real-world expression", () => {
  // 'creature you control with power >= 4' union 'a red creature'
  const p = parseValid("Creature.YouCtrl+powerGE4,Creature.Red");
  assert.equal(p(oppDragon, you), true); // red creature branch
  assert.equal(p(bear, you), false);
});
