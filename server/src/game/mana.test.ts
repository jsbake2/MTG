import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCost, sourceProduction, planPayment, selectionPays, type ManaSource } from "./mana.js";

const src = (id: string, colors: string[], amount = 1): ManaSource => ({ id, name: id, colors, amount });

test("parseCost splits coloured pips from generic", () => {
  assert.deepEqual(parseCost("{1}{G}{G}", 0, 0), { pips: ["G", "G"], generic: 1 });
  assert.deepEqual(parseCost("{2}{W}{U}", 0, 0), { pips: ["W", "U"], generic: 2 });
  assert.deepEqual(parseCost("{X}{R}", 3, 0), { pips: ["R"], generic: 3 }); // X arrives via extraGeneric
  assert.deepEqual(parseCost(null, 0, 4), { pips: [], generic: 4 }); // no cost string → cmc fallback
  assert.deepEqual(parseCost("{G/U}", 0, 0), { pips: [], generic: 1 }); // hybrid → payable by anything
});

test("sourceProduction reads basics, rocks, and any-colour", () => {
  assert.deepEqual(sourceProduction("Basic Land — Forest", null), { colors: ["G"], amount: 1 });
  assert.deepEqual(sourceProduction("Artifact", "{T}: Add {C}{C}."), { colors: ["C"], amount: 2 });
  const any = sourceProduction("Land", "{T}: Add one mana of any color.")!;
  assert.equal(any.amount, 1);
  assert.equal(any.colors.length, 5);
  assert.equal(sourceProduction("Creature — Bear", null), null);
});

test("forced: three greens for {G}{G}{G} auto-taps all three", () => {
  const p = planPayment([src("f1", ["G"]), src("f2", ["G"]), src("f3", ["G"])], { pips: ["G", "G", "G"], generic: 0 });
  assert.equal(p.status, "forced");
  assert.equal(p.tap.length, 3);
});

test("forced even with a dual when green is the only way to make the pips", () => {
  // G/R + G + G, cost {G}{G}{G} — the dual MUST make green; no choice of which to tap.
  const p = planPayment([src("gr", ["G", "R"]), src("g1", ["G"]), src("g2", ["G"])], { pips: ["G", "G", "G"], generic: 0 });
  assert.equal(p.status, "forced");
});

test("insufficient / wrong colours is rejected", () => {
  assert.equal(planPayment([src("i1", ["U"]), src("i2", ["U"]), src("i3", ["U"])], { pips: ["G", "G", "G"], generic: 0 }).status, "insufficient");
  assert.equal(planPayment([src("f", ["G"])], { pips: ["G", "G"], generic: 0 }).status, "insufficient");
});

test("uniform surplus stays forced (which identical basic is immaterial)", () => {
  const p = planPayment([src("f1", ["G"]), src("f2", ["G"]), src("f3", ["G"]), src("f4", ["G"])], { pips: ["G", "G"], generic: 0 });
  assert.equal(p.status, "forced");
  assert.equal(p.tap.length, 2);
});

test("mixed options are a player choice", () => {
  // Many green-capable sources for {G}{G}{G} → which three to tap is a real choice.
  const p = planPayment(
    [src("gw", ["G", "W"]), src("gu", ["G", "U"]), src("gb", ["G", "B"]), src("g1", ["G"]), src("g2", ["G"]), src("g3", ["G"])],
    { pips: ["G", "G", "G"], generic: 0 },
  );
  assert.equal(p.status, "choice");
  // and a green pip + 2 generic with a spare source is also a choice
  assert.equal(planPayment([src("g", ["G"]), src("f", ["G"]), src("w", ["W"])], { pips: ["G"], generic: 1 }).status, "choice");
});

test("selectionPays validates an explicit pick", () => {
  const cost = { pips: ["G", "G", "G"], generic: 0 };
  assert.equal(selectionPays([src("gw", ["G", "W"]), src("f1", ["G"]), src("f2", ["G"])], cost), true);
  assert.equal(selectionPays([src("gw", ["G", "W"]), src("f1", ["G"])], cost), false); // only 2 for 3
  assert.equal(selectionPays([src("w1", ["W"]), src("w2", ["W"]), src("w3", ["W"])], cost), false); // wrong colour
});
