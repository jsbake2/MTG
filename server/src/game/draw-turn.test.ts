// Regression tests for guided-mode turn control:
//   1. Manual "draw" is HARD-blocked in guided mode (no infinite draw), no matter
//      the relaxed/strict toggle — only an explicit Override lets one through.
//   2. The active player can advance the step manually (progress/end the turn)
//      even in strict mode, as long as the stack is empty.
import { test } from "node:test";
import assert from "node:assert/strict";
import { applyAction, type CardIndex } from "./engine.js";
import { buildInitialState, newObject, objectsIn, type SeatDeck } from "./state.js";
import type { TableState } from "@mtg/shared";

const ctx: CardIndex = {};

function twoPlayerLibrary(seat: number): SeatDeck {
  const library = Array.from({ length: 10 }, (_, i) => ({
    cardId: `c${seat}-${i}`,
    oracleId: `o${seat}-${i}`,
    name: `Card ${seat}-${i}`,
  }));
  return { seat, userId: `u${seat}`, name: `P${seat}`, avatarCardId: null, library, commanders: [] };
}

function guidedGame(enforcement: "relaxed" | "strict"): TableState {
  const state = buildInitialState({
    id: "t1",
    name: "test",
    formatId: "commander",
    mode: "guided",
    enforcement,
    seats: [twoPlayerLibrary(0), twoPlayerLibrary(1)],
  });
  // Past mulligans, into an ordinary main phase, so turn-progression is testable.
  state.status = "playing";
  state.phase = "precombat_main";
  state.step = "main1";
  state.prioritySeat = state.activeSeat;
  return state;
}

function handCount(state: TableState, seat: number): number {
  return objectsIn(state, "hand", seat).length;
}

for (const enforcement of ["relaxed", "strict"] as const) {
  test(`guided mode blocks manual draw (${enforcement})`, () => {
    const state = guidedGame(enforcement);
    const seat = state.activeSeat;
    const before = handCount(state, seat);
    const res = applyAction(state, ctx, seat, { type: "draw", seat, count: 1 });
    assert.equal(res.ok, false, "manual draw must be rejected in guided mode");
    assert.equal(handCount(state, seat), before, "hand size must not change on a blocked draw");
  });

  test(`guided mode blocks repeated draws — no infinite draw (${enforcement})`, () => {
    const state = guidedGame(enforcement);
    const seat = state.activeSeat;
    const before = handCount(state, seat);
    for (let i = 0; i < 20; i++) applyAction(state, ctx, seat, { type: "draw", seat, count: 1 });
    assert.equal(handCount(state, seat), before, "20 draw attempts must draw zero cards");
  });
}

test("explicit Override lets a single manual draw through", () => {
  const state = guidedGame("relaxed");
  const seat = state.activeSeat;
  const before = handCount(state, seat);
  const res = applyAction(state, ctx, seat, {
    type: "override",
    description: "Manual draw 1",
    inner: { type: "draw", seat, count: 1 },
  });
  assert.equal(res.ok, true, "override draw should succeed");
  assert.equal(handCount(state, seat), before + 1, "override should draw exactly one card");
  // And the override flag must be cleared afterwards, so a plain draw is blocked again.
  const after = applyAction(state, ctx, seat, { type: "draw", seat, count: 1 });
  assert.equal(after.ok, false, "plain draw is blocked again after the override completes");
});

test("active player can advance the step in strict mode with an empty stack", () => {
  const state = guidedGame("strict");
  const seat = state.activeSeat;
  const phaseBefore = `${state.phase}/${state.step}`;
  const res = applyAction(state, ctx, seat, { type: "advance_step" });
  assert.equal(res.ok, true, "advance_step must be allowed for the active player");
  assert.notEqual(`${state.phase}/${state.step}`, phaseBefore, "the step should have moved forward");
});

test("guided auto-skips empty combat: main1 with no creatures jumps to main2", () => {
  const state = guidedGame("strict");
  assert.equal(state.step, "main1");
  const res = applyAction(state, ctx, state.activeSeat, { type: "advance_step" });
  assert.equal(res.ok, true);
  assert.equal(state.step, "main2", "no attackers → should roll straight past combat to main2");
});

test("guided STOPS at declare_attackers when the active player has a ready attacker", () => {
  const state = guidedGame("strict");
  const seat = state.activeSeat;
  const creature = newObject({ name: "Grizzly Bears", ownerSeat: seat, zone: "battlefield" });
  creature.cardId = "bear1";
  creature.controllerSeat = seat;
  creature.summoningSick = false;
  state.objects[creature.id] = creature;
  const bearCtx: CardIndex = {
    bear1: { typeLine: "Creature — Bear", cardTypes: ["Creature"], power: "2", toughness: "2", keywords: [], oracleText: null },
  };
  const res = applyAction(state, bearCtx, seat, { type: "advance_step" });
  assert.equal(res.ok, true);
  assert.equal(state.step, "declare_attackers", "a ready attacker means the turn must stop for the attack decision");
});

function addToHand(state: TableState, seat: number, cardId: string) {
  const o = newObject({ name: cardId, ownerSeat: seat, zone: "hand" });
  o.cardId = cardId;
  state.objects[o.id] = o;
  return o;
}
function addLand(state: TableState, seat: number, cardId = "forest") {
  const l = newObject({ name: "Forest", ownerSeat: seat, zone: "battlefield" });
  l.cardId = cardId;
  l.controllerSeat = seat;
  state.objects[l.id] = l;
  return l;
}
const SORCERY = (cmc: number) => ({ typeLine: "Sorcery", cardTypes: ["Sorcery"], power: null, toughness: null, keywords: [], oracleText: null, cmc });
const FOREST = { typeLine: "Basic Land — Forest", cardTypes: ["Land"], power: null, toughness: null, keywords: [], oracleText: null };

test("guided enforces mana: cannot cast a spell with no mana sources", () => {
  const state = guidedGame("relaxed");
  const seat = state.activeSeat;
  const spell = addToHand(state, seat, "big");
  const res = applyAction(state, { big: SORCERY(3) }, seat, { type: "cast", objectId: spell.id });
  assert.equal(res.ok, false, "no lands → cast must be rejected");
  assert.equal(state.objects[spell.id]!.zone, "hand", "rejected spell stays in hand");
});

test("guided enforces mana: casts when there are enough lands, and taps them", () => {
  const state = guidedGame("relaxed");
  const seat = state.activeSeat;
  const spell = addToHand(state, seat, "big");
  const lands = [addLand(state, seat), addLand(state, seat), addLand(state, seat)];
  const res = applyAction(state, { big: SORCERY(3), forest: FOREST }, seat, { type: "cast", objectId: spell.id });
  assert.equal(res.ok, true, "3 lands → can pay for a 3-drop");
  assert.equal(lands.filter((l) => state.objects[l.id]!.tapped).length, 3, "all three lands tapped to pay");
});

test("guided enforces mana: two lands can't pay for a three-drop", () => {
  const state = guidedGame("relaxed");
  const seat = state.activeSeat;
  const spell = addToHand(state, seat, "big");
  addLand(state, seat);
  addLand(state, seat);
  const res = applyAction(state, { big: SORCERY(3), forest: FOREST }, seat, { type: "cast", objectId: spell.id });
  assert.equal(res.ok, false, "2 < 3 → rejected");
});

test("Override bypasses mana enforcement", () => {
  const state = guidedGame("relaxed");
  const seat = state.activeSeat;
  const spell = addToHand(state, seat, "big");
  const res = applyAction(state, { big: SORCERY(5) }, seat, {
    type: "override",
    description: "free cast",
    inner: { type: "cast", objectId: spell.id },
  });
  assert.equal(res.ok, true, "override lets a spell through with no mana");
  assert.equal(state.objects[spell.id]!.zone, "stack", "spell reached the stack");
});

// ---- anti-cheat authorization -------------------------------------------
test("anti-cheat: cannot draw / mill / mulligan / concede for another seat", () => {
  const state = guidedGame("relaxed");
  for (const action of [
    { type: "draw", seat: 1, count: 1 },
    { type: "mill", seat: 1, count: 5 },
    { type: "mulligan", seat: 1 },
    { type: "concede", seat: 1 },
    { type: "shuffle", seat: 1 },
    { type: "adjust_life", seat: 1, delta: -99 },
  ] as const) {
    const res = applyAction(state, ctx, 0, action);
    assert.equal(res.ok, false, `${action.type} for the opponent must be rejected`);
  }
  assert.equal(state.players[1]!.hasConceded ?? false, false, "opponent was not conceded");
});

test("anti-cheat: cannot cast a card you don't own", () => {
  const state = guidedGame("relaxed");
  const oppCard = addToHand(state, 1, "big"); // owned by seat 1
  const res = applyAction(state, { big: SORCERY(0) }, 0, { type: "cast", objectId: oppCard.id });
  assert.equal(res.ok, false, "casting the opponent's card must be rejected");
});

test("anti-cheat: strict blocks manipulating an opponent's permanent; relaxed allows it", () => {
  const mk = (mode: "relaxed" | "strict") => {
    const state = guidedGame(mode);
    const o = newObject({ name: "Bear", ownerSeat: 1, zone: "battlefield" });
    o.cardId = "bear";
    o.controllerSeat = 1;
    state.objects[o.id] = o;
    return { state, id: o.id };
  };
  const strict = mk("strict");
  assert.equal(applyAction(strict.state, {}, 0, { type: "tap", objectId: strict.id, tapped: true }).ok, false, "strict: can't tap opponent's creature");
  const relaxed = mk("relaxed");
  assert.equal(applyAction(relaxed.state, {}, 0, { type: "tap", objectId: relaxed.id, tapped: true }).ok, true, "relaxed: manual manipulation allowed for hybrid resolution");
});

test("anti-cheat: meta-controls are host/judge only", () => {
  const state = guidedGame("relaxed");
  assert.equal(applyAction(state, ctx, 0, { type: "set_enforcement", level: "relaxed" }, false).ok, false, "non-host can't change enforcement");
  assert.equal(applyAction(state, ctx, 0, { type: "set_active_player", seat: 0 }, false).ok, false, "non-host can't seize the turn");
  assert.equal(applyAction(state, ctx, 0, { type: "set_enforcement", level: "strict" }, true).ok, true, "host may change enforcement");
});

test("anti-cheat: override is host/judge-only in a strict (tournament) game", () => {
  const state = guidedGame("strict");
  const spell = addToHand(state, 0, "big");
  const bad = applyAction(state, { big: SORCERY(9) }, 0, { type: "override", description: "free cast", inner: { type: "cast", objectId: spell.id } }, false);
  assert.equal(bad.ok, false, "unprivileged override rejected in strict");
  const good = applyAction(state, { big: SORCERY(9) }, 0, { type: "override", description: "judge cast", inner: { type: "cast", objectId: spell.id } }, true);
  assert.equal(good.ok, true, "host/judge override allowed");
});

test("anti-cheat: override still cannot act for another seat", () => {
  const state = guidedGame("relaxed");
  const res = applyAction(state, ctx, 0, { type: "override", description: "draw for opp", inner: { type: "draw", seat: 1, count: 5 } });
  assert.equal(res.ok, false, "override must not bypass the seat authorization");
});

test("anti-cheat: pass_priority requires holding priority", () => {
  const state = guidedGame("relaxed");
  state.prioritySeat = 0;
  assert.equal(applyAction(state, ctx, 1, { type: "pass_priority", seat: 1 }).ok, false, "non-priority player can't pass");
  assert.equal(applyAction(state, ctx, 0, { type: "pass_priority", seat: 0 }).ok, true, "priority holder can pass");
});

// ---- London mulligan + deck integrity -----------------------------------
test("mulligan tracks count and caps at 7", () => {
  const state = guidedGame("strict");
  const seat = state.activeSeat;
  for (let i = 0; i < 7; i++) applyAction(state, ctx, seat, { type: "mulligan", seat });
  assert.equal(state.players[seat]!.mulligansTaken, 7);
  assert.equal(applyAction(state, ctx, seat, { type: "mulligan", seat }).ok, false, "8th mulligan rejected");
});

test("London mulligan: keeping bottoms the owed number of cards", () => {
  const state = guidedGame("strict");
  const seat = state.activeSeat;
  applyAction(state, ctx, seat, { type: "mulligan", seat }); // owe 1
  applyAction(state, ctx, seat, { type: "mulligan", seat }); // owe 2
  assert.equal(objectsIn(state, "hand", seat).length, 7);
  const res = applyAction(state, ctx, seat, { type: "keep_hand", seat });
  assert.equal(res.ok, true);
  assert.equal(objectsIn(state, "hand", seat).length, 5, "kept hand reduced by 2 (mulligan cost applied)");
});

test("London mulligan: strict rejects a wrong bottom count", () => {
  const state = guidedGame("strict");
  const seat = state.activeSeat;
  applyAction(state, ctx, seat, { type: "mulligan", seat }); // owe 1
  const hand = objectsIn(state, "hand", seat);
  const res = applyAction(state, ctx, seat, { type: "keep_hand", seat, bottom: [hand[0]!.id, hand[1]!.id] }); // 2 != 1
  assert.equal(res.ok, false, "must bottom exactly the owed count");
});

test("tournament blocks real-card-backed tokens; casual allows them", () => {
  const strict = guidedGame("strict");
  const s0 = strict.activeSeat;
  assert.equal(applyAction(strict, ctx, s0, { type: "create_token", seat: s0, name: "X", cardId: "realcard" }).ok, false, "strict: no real-card token");
  assert.equal(applyAction(strict, ctx, s0, { type: "create_token", seat: s0, name: "Goblin", power: 1, toughness: 1 }).ok, true, "strict: plain token ok");
  const relaxed = guidedGame("relaxed");
  const r0 = relaxed.activeSeat;
  assert.equal(applyAction(relaxed, ctx, r0, { type: "create_token", seat: r0, name: "X", cardId: "realcard" }).ok, true, "relaxed: token copy allowed");
});

test("Hydra enters with X +1/+1 counters, where X is chosen at cast", () => {
  const state = guidedGame("relaxed");
  const seat = state.activeSeat;
  const hydra = addToHand(state, seat, "hydra");
  for (let i = 0; i < 4; i++) addLand(state, seat); // pay X=4
  const ctxH: CardIndex = {
    hydra: { typeLine: "Creature — Hydra", cardTypes: ["Creature"], power: "0", toughness: "0", keywords: [], oracleText: "This creature enters the battlefield with X +1/+1 counters on it.", cmc: 0 },
    forest: FOREST,
  };
  assert.equal(applyAction(state, ctxH, seat, { type: "cast", objectId: hydra.id, x: 4 }).ok, true, "cast with X=4");
  assert.equal(applyAction(state, ctxH, seat, { type: "resolve_top" }).ok, true, "resolve to battlefield");
  const o = state.objects[hydra.id]!;
  assert.equal(o.zone, "battlefield");
  assert.equal(o.counters.find((c) => c.type === "+1/+1")?.count ?? 0, 4, "entered with X=4 +1/+1 counters");
});

test("colour-aware mana: ambiguous cast asks for a choice; autoMana pays it", () => {
  const state = guidedGame("relaxed");
  const seat = state.activeSeat;
  const spell = addToHand(state, seat, "gggspell");
  const mkSrc = (id: string) => {
    const o = newObject({ name: id, ownerSeat: seat, zone: "battlefield" });
    o.cardId = id;
    o.controllerSeat = seat;
    state.objects[o.id] = o;
  };
  ["f1", "f2", "f3", "gw", "gu", "gb"].forEach(mkSrc); // 3 forests + 3 green duals → choice for {G}{G}{G}
  const noPT = { power: null, toughness: null, keywords: [] as string[] };
  const ctxM: CardIndex = {
    gggspell: { typeLine: "Sorcery", cardTypes: ["Sorcery"], oracleText: null, cmc: 3, manaCost: "{G}{G}{G}", ...noPT },
    f1: { typeLine: "Basic Land — Forest", cardTypes: ["Land"], oracleText: null, ...noPT },
    f2: { typeLine: "Basic Land — Forest", cardTypes: ["Land"], oracleText: null, ...noPT },
    f3: { typeLine: "Basic Land — Forest", cardTypes: ["Land"], oracleText: null, ...noPT },
    gw: { typeLine: "Land", cardTypes: ["Land"], oracleText: "{T}: Add {G} or {W}.", ...noPT },
    gu: { typeLine: "Land", cardTypes: ["Land"], oracleText: "{T}: Add {G} or {U}.", ...noPT },
    gb: { typeLine: "Land", cardTypes: ["Land"], oracleText: "{T}: Add {G} or {B}.", ...noPT },
  };
  const prompt = applyAction(state, ctxM, seat, { type: "cast", objectId: spell.id });
  assert.equal(prompt.ok, false);
  assert.ok(prompt.manaChoice, "ambiguous payment returns a mana choice");
  assert.equal(prompt.manaChoice!.sources.length, 6);
  assert.equal(state.objects[spell.id]!.zone, "hand", "spell not cast while choosing");
  // autoMana pays a valid way without prompting.
  const auto = applyAction(state, ctxM, seat, { type: "cast", objectId: spell.id, autoMana: true });
  assert.equal(auto.ok, true);
  assert.equal(state.objects[spell.id]!.zone, "stack");
  const tapped = ["f1", "f2", "f3", "gw", "gu", "gb"].map((id) => Object.values(state.objects).find((o) => o.cardId === id)!).filter((o) => o.tapped).length;
  assert.equal(tapped, 3, "exactly three sources tapped for {G}{G}{G}");
});

test("colour-aware mana: explicit source pick pays the cost", () => {
  const state = guidedGame("relaxed");
  const seat = state.activeSeat;
  const spell = addToHand(state, seat, "gg");
  const ids = ["a", "b", "c"];
  ids.forEach((id) => { const o = newObject({ name: id, ownerSeat: seat, zone: "battlefield" }); o.cardId = id; o.controllerSeat = seat; state.objects[o.id] = o; });
  const noPT = { power: null, toughness: null, keywords: [] as string[] };
  const ctxM: CardIndex = {
    gg: { typeLine: "Sorcery", cardTypes: ["Sorcery"], oracleText: null, cmc: 2, manaCost: "{G}{G}", ...noPT },
    a: { typeLine: "Basic Land — Forest", cardTypes: ["Land"], oracleText: null, ...noPT },
    b: { typeLine: "Basic Land — Forest", cardTypes: ["Land"], oracleText: null, ...noPT },
    c: { typeLine: "Basic Land — Forest", cardTypes: ["Land"], oracleText: null, ...noPT },
  };
  const objs = ids.map((id) => Object.values(state.objects).find((o) => o.cardId === id)!);
  // pick exactly two forests
  const res = applyAction(state, ctxM, seat, { type: "cast", objectId: spell.id, manaSources: [objs[0]!.id, objs[1]!.id] });
  assert.equal(res.ok, true);
  assert.equal(objs[0]!.tapped && objs[1]!.tapped, true);
  assert.equal(objs[2]!.tapped, false, "the un-picked forest stays untapped");
});

test("end_turn passes the turn to the next player", () => {
  const state = guidedGame("strict");
  const seat = state.activeSeat;
  const res = applyAction(state, ctx, seat, { type: "end_turn" });
  assert.equal(res.ok, true, "end_turn should succeed for the active player");
  assert.notEqual(state.activeSeat, seat, "active player should change after ending the turn");
});
