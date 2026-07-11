# Backend ⇄ UI contract

**Division of labor:** the rules/logic/engine (this doc's author) owns everything in
`shared/` and `server/`. The UI owns `client/`. This document is the contract the UI
builds against. When the backend changes the contract, this doc changes in the same
commit.

**Canonical source of truth (types are law — read these, don't guess):**

| Concern | File |
|---|---|
| WebSocket messages (client→server, server→client) | `shared/src/game.ts` — `ClientMessage`, `ServerMessage` |
| Player actions the UI can send | `shared/src/game.ts` — `GameAction` union |
| Game state the UI renders | `shared/src/game.ts` — `TableState`, `GameObject`, `PlayerState` |
| Effect model (what a spell/ability does) | `shared/src/effects.ts` — `EffectOp` union |
| Formats & deck rules | `shared/src/formats.ts` |
| Card shape | `shared/src/cards.ts` |

Everything below explains how those pieces fit together. If this prose ever disagrees
with the types, **the types win** — and that's a bug in this doc, please flag it.

---

## 1. Connection & message flow

1. UI opens a WebSocket, sends `{type:"hello", tableId}`.
2. Server streams `{type:"state", state, you, hands}` on every change (`you` = your seat
   number or null if spectating; `hands` = map of seat→objectIds you're allowed to see).
3. UI sends `{type:"action", action}` where `action` is a `GameAction`.
4. Server replies with an updated `state`, or `{type:"error", message, recoverable}`.
   - **Errors are user-facing.** Multi-line error strings use `\n`; render with
     `white-space: pre-line`. (E.g. the deck-legality gate returns a bulleted list.)
5. `{type:"log", entries}` carries the human-readable play-by-play (append to a game log
   panel). Each entry: `{seat, kind, text}`.

State is **fully authoritative and redacted per viewer** — opponents' hands and all
libraries arrive with `cardId:null, name:"Card", faceDown:true`. Never assume hidden info.

## 2. Rendering state

`TableState` gives you `players[]`, `objects{}` (every card/token, keyed by id), the
`stackOrder[]`, `turnNumber`, `phase`, `step`, `activeSeat`, `prioritySeat`, `winnerSeat`.
Each `GameObject` has `zone` (`hand|library|battlefield|graveyard|exile|stack|command`),
`ownerSeat`, `controllerSeat`, `tapped`, `x/y` (layout), `power/toughness` overrides,
`counters`, `targets[]`, plus `cardTypes`/`keywords` surfaced for battlefield & stack
objects so the UI can style rows and drive combat without a second fetch.

## 3. Actions (the important ones)

See the `GameAction` union for the full list. Grouped by intent:

- **Cast / activate:** `cast {objectId, targets?, mode?, x?}`,
  `activate {objectId, abilityIndex, targets?, x?}`. Timing & mana are engine-enforced.
- **Stack:** `pass_priority {seat}` (both players passing resolves the top),
  `resolve_top`, `counter_top`.
- **Combat:** `declare_attacker {objectId, defendingSeat}`,
  `declare_blocker {blockerId, attackerId}`, `assign_combat_damage` (engine does the math —
  first/double strike, deathtouch, trample, lifelink, menace, infect/toxic, indestructible).
- **Turn:** `advance_step`, `skip_combat {seat}`, `untap_all`, `set_active_player`.
- **Manual / override tools:** `move_card`, `set_life`, `adjust_life`, `set_pt`,
  `add_counter`, `create_token`, `draw`, `mill`, `shuffle`, `tap`, `flip`, `attach`, and
  `override {description, inner}` (bypass a framework check, logged). These exist so a human
  can always fix or hand-resolve anything the engine can't do yet. **UI note:** these are
  *escape hatches*, not primary play — they should live in a clearly-labeled "manual"
  affordance, not compete with cast/attack. (The free-standing `draw` button being too
  prominent is why solo testing feels like "infinite draw.")

## 4. Effects & the interactive-choice contract  ← the part that grows

When a spell/ability resolves, the engine executes a list of `EffectOp`s (see the union).
Most ops are fully automatic (`draw`, `damage`, `destroy`, `bounce`, token creation, mass
effects, counters, pump, mana, …). Three kinds need the **player to choose**, and this is
where UI and backend must agree:

**(a) Targets** — a `cast`/`activate` may require targets. The compiled effect exposes
`targets: {kind, label}[]`. UI collects that many object/player ids and puts them in the
action's `targets[]`, in order. Kinds: `creature|permanent|player|any|spell|…`.

**(b) Modes** — modal spells ("Choose one —") expose `modes: {label, ops}[]`. UI shows a
picker and sends the chosen index as `mode`.

**(c) X** — if the effect/cost scales with X, UI prompts for a number and sends `x`.

**(d) `manual` op — the current fallback.** Anything the compiler can't model yet becomes
`{op:"manual", hint}`. Today the engine just logs `"<card>: <hint> — finish manually"` and
moves the spell to the graveyard. The player is expected to use the manual tools in §3.
**This is the gap we're closing** (see `docs/RULES-COVERAGE.md`).

### Planned: `pendingChoice` (agree on this before UI builds it)

As the engine gains real support for "look at top N / scry / surveil / search / discard /
choose a card", resolution can't stay synchronous — it needs a round-trip to the player.
The agreed shape (not yet emitted — this is the reservation):

```ts
// On TableState (null when no choice is pending):
pendingChoice: {
  id: string;               // echo back in the response action
  seat: number;             // whose choice — only this seat acts; others wait
  kind: "look" | "search" | "discard" | "order" | "distribute" | "may";
  prompt: string;           // human text, e.g. "Look at the top 5 — take a creature"
  cards: string[];          // object ids the player may act on (revealed to them only)
  min: number; max: number; // how many to pick
  filter?: string;          // e.g. "creature" — UI may grey out non-matches
  rest?: "bottom" | "top" | "graveyard"; // where unpicked cards go
} | null
```

UI, when `pendingChoice.seat === you`: show the `cards`, let the player pick `min..max`
matching `filter`, then send **`{type:"resolve_choice", id, pickedIds, restOrder?}`** (a new
`GameAction` that will be added alongside the first interactive effect). Until then, no UI
work is needed here — I'll ping this doc + the changelog when the first one ships.

## 5. Changelog for the UI

Append one line per backend change that affects the UI. Antigravity reads this first.

- _2026-07-11_ — Contract established. Deck-legality gate added (`start_game` can fail with a
  multi-line error). No new state fields yet. `pendingChoice`/`resolve_choice` reserved (§4),
  not yet emitted.
