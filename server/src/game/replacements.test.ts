// Tests for replacement effects (CR 614) — enters-tapped detection.
import { test } from "node:test";
import assert from "node:assert/strict";
import { entersTappedUnconditional, entersTappedConditional } from "./replacements.js";

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
