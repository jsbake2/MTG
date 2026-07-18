# Future TODO — AI opponent (deferred)

Parked 2026-07-11 in favor of manual tabletop mode; **reviewed & refreshed 2026-07-14**
after the game-flow + tournament anti-cheat overhaul. Decisions already made with
Jason, so we can resume without re-litigating:

- **Approach chosen:** heuristic bot + a **curated deck** of engine-supported cards
  (mono-color creature deck), NOT an LLM (LLM is a possible phase 2). A bot only
  plays as well as the rules engine automates, so pair it with cards the engine
  fully handles and expand as coverage grows (`docs/RULES-COVERAGE.md`). Coverage is
  now **~13k covered + ~5.4k partial** cards, so the curated pool is ample.
- **Ownership:** build end-to-end (backend + UI), kept in its own `server/src/game/bot.ts`
  module to avoid colliding with rules-coverage work.

## Head start: the self-play harness IS the reference bot
`tools/selfplay.mjs` already drives two bots through full games over the live WS
protocol: play a land, cast the cheapest affordable spell, resolve, attack, end the
turn, and pass priority when a non-active player holds it (end-of-turn window). It's
priority-aware and runs clean in both relaxed and strict. **v1 = port that policy
into `bot.ts` and drive it server-side.** Don't reinvent the policy; lift it.

## Architecture (validated against the CURRENT code)

- A bot is a **seat with no WebSocket** — synthetic `userId` (`bot:<uuid>`), a curated
  `deckId`, `isBot: true`. Drive it by calling `table.apply(botSeat, action, /*privileged*/ false)`
  server-side after state changes (hook `Table.apply`/`start` → `scheduleBots()` with a
  small `setTimeout` for watchability). Guard against re-entrancy / infinite loops
  (bounded step count per wake, like the harness's guard).
- **FAIRNESS (new, required):** the bot runs inside the server and can see everything,
  so it MUST decide using only `viewFor(botSeat)` — its own redacted view (opponent
  hands/libraries hidden, ephemeral ids, no library order). Never let the policy read
  raw `state.objects` for opponent-hidden cards; that's the same info-leak we just
  closed for humans.
- **AUTH (new):** the bot is **non-privileged** and only ever issues self-scoped
  actions (its own draws/casts/attacks/blocks/passes). The `authorize()` layer in
  engine.ts already permits exactly that and blocks anything else — do NOT wire the
  bot as host/admin.
- **Priority model has changed — simpler now.** In **guided** mode the engine
  auto-skips every no-decision step, `advance_step` works for whoever holds priority,
  and mana is **auto-paid on cast**. So the bot's driver mostly reacts at Main 1,
  declare-attackers, declare-blockers, Main 2, plus passing the end-of-turn window.
  (The old note "advance_step is blocked in strict, drive with pass_priority only" is
  obsolete.) Keep the act-or-pass-on-your-priority discipline so the human still gets
  response windows; don't bulldoze with `advance_step` when the opponent holds priority.
- **Legal-move generator** `legalActions(state, cardIndex, seat): GameAction[]` — still
  worth building (the engine has `enforce()`/`authorize()` checks but no enumerator).
  Reuse it to show humans only-legal actions too. The harness approximates this
  inline; formalize it.
- **Heuristic policy** (on the bot's priority, using its redacted view): play a land
  (respect `landsPlayedThisTurn`, main phase, empty stack); cast the most expensive
  affordable spell (mana auto-pays — just check enough untapped sources); in
  `declare_attackers` attack with all able creatures then pass; in `declare_blockers`
  block to prevent lethal / trade up; otherwise `pass_priority` / advance. Mulligan:
  keep (v1) — note the London-mulligan bottoming is now enforced, so a "keep 7" is fine.

## Milestone order
1. ✅ **DONE (2026-07-14).** Bot seat infra (`server/src/game/bot.ts`, seats whose
   userId starts with `bot:`), curated deck ("AI — Mono-Red Aggro", is_precon, tag
   `ai`), `POST /api/tables/:id/bot` (host-only), 🤖 "Add AI opponent" lobby button,
   and `Table.scheduleBots()` driver (fires from `notify()`, ~650ms think delay,
   per-seat guard). Verified live: full games, AI plays lands/creatures/attacks,
   respects auto-paid mana, no hangs, decided using `viewFor(botSeat)` (fair).
2. ✅ **DONE.** Main-phase play — plays a land, casts the most expensive affordable
   spell each priority window.
3. ~ **Partial.** Attacks with all able creatures. Blocking is v1 only (chump the
   biggest attacker when facing lethal). TODO: smarter blocks (trade up, gang block).
4. **Polish (TODO):** removal/target selection, difficulty tiers, 🤖 thinking
   indicator in the client, mulligan judgement, more curated decks (other colors).
   LLM policy is a possible phase 2.

## Verify with the harness
Any bot change can be regression-tested by pointing `tools/selfplay.mjs` at it (or
reusing its structure): full game, zero server errors, turns progress, no hangs.
