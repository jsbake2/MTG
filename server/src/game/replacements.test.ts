// Tests for replacement effects (CR 614) — enters-tapped detection.
import { test } from "node:test";
import assert from "node:assert/strict";
import { entersTappedUnconditional, entersTappedConditional, entersWithCounters } from "./replacements.js";

test("unconditional tapland enters tapped", () => {
  assert.equal(entersTappedUnconditional("This land enters tapped."), true);
  assert.equal(entersTappedUnconditional("Selesnya Guildgate enters the battlefield tapped."), true);
  assert.equal(entersTappedUnconditional("Timber Gorge enters tapped.\n{T}: Add {R} or {G}."), true);
});

test("conditional tapland is NOT auto-tapped", () => {
  const txt = "This land enters tapped unless you control two or more other lands.";
  assert.equal(entersTappedUnconditional(txt), false);
  assert.equal(entersTappedConditional(txt), true);
});

test("optional 'you may' enter tapped is NOT auto-tapped", () => {
  const txt = "You may have this land enter the battlefield tapped.";
  assert.equal(entersTappedUnconditional(txt), false);
  assert.equal(entersTappedConditional(txt), true);
});

test("normal cards do not enter tapped", () => {
  assert.equal(entersTappedUnconditional("Flying"), false);
  assert.equal(entersTappedUnconditional(null), false);
  assert.equal(entersTappedUnconditional("{T}: Add {G}."), false);
});

test("enters with +1/+1 counters", () => {
  assert.deepEqual(entersWithCounters("This creature enters with two +1/+1 counters on it."), { kind: "+1/+1", count: 2 });
  assert.deepEqual(entersWithCounters("Kalonian Hydra enters the battlefield with four +1/+1 counters on it."), { kind: "+1/+1", count: 4 });
  assert.deepEqual(entersWithCounters("This creature enters with two -1/-1 counters on it."), { kind: "-1/-1", count: 2 });
});

test("enters with X / variable counters falls back (null)", () => {
  assert.equal(entersWithCounters("This creature enters with X +1/+1 counters on it."), null);
  assert.equal(entersWithCounters("Flying"), null);
  assert.equal(entersWithCounters(null), null);
});
