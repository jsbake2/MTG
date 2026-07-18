import { test } from "node:test";
import assert from "node:assert/strict";
import { applyReplacements, type ReplEvent, type ReplacementEffect } from "./replace.js";

interface MoveEvent extends ReplEvent {
  type: "moved";
  cardId: string;
  destination: string;
  tapped: boolean;
  counters: number;
}

test("enters-tapped modifies the event (updated, not consumed)", () => {
  const e: MoveEvent = { type: "moved", appliedIds: [], cardId: "x", destination: "battlefield", tapped: false, counters: 0 };
  const entersTapped: ReplacementEffect<MoveEvent> = {
    id: "tapland",
    checksEventType: (ev) => ev.type === "moved",
    applies: (ev) => ev.destination === "battlefield" && !ev.tapped,
    replace: (ev) => { ev.tapped = true; },
  };
  applyReplacements(e, [entersTapped]);
  assert.equal(e.tapped, true);
  assert.ok(e.appliedIds.includes("tapland"));
});

test("each effect applies at most once (no infinite loop)", () => {
  const e: MoveEvent = { type: "moved", appliedIds: [], cardId: "x", destination: "battlefield", tapped: false, counters: 0 };
  let n = 0;
  const eff: ReplacementEffect<MoveEvent> = {
    id: "counters",
    checksEventType: (ev) => ev.type === "moved",
    applies: () => true, // always "applies" — the applied-id guard must stop re-runs
    replace: (ev) => { ev.counters += 1; n++; },
  };
  applyReplacements(e, [eff]);
  assert.equal(n, 1);
  assert.equal(e.counters, 1);
});

test("full replacement consumes the event", () => {
  interface DrawEvent extends ReplEvent { type: "draw"; won: boolean }
  const e: DrawEvent = { type: "draw", appliedIds: [], won: false };
  const labManiac: ReplacementEffect<DrawEvent> = {
    id: "lab",
    checksEventType: (ev) => ev.type === "draw",
    applies: () => true,
    replace: (ev) => { ev.won = true; ev.consumed = true; },
  };
  const other: ReplacementEffect<DrawEvent> = {
    id: "other", checksEventType: () => true, applies: () => true, replace: () => { throw new Error("should not run after consume"); },
  };
  applyReplacements(e, [labManiac, other]);
  assert.equal(e.won, true);
});

test("choose-order hook is used when several apply", () => {
  const e: MoveEvent = { type: "moved", appliedIds: [], cardId: "x", destination: "battlefield", tapped: false, counters: 0 };
  const seq: string[] = [];
  const mk = (id: string): ReplacementEffect<MoveEvent> => ({ id, checksEventType: () => true, applies: () => !e.appliedIds.includes(id), replace: () => { seq.push(id); } });
  applyReplacements(e, [mk("a"), mk("b")], (apps) => apps.find((r) => r.id === "b")!); // prefer b first
  assert.deepEqual(seq, ["b", "a"]);
});
