# Future TODO — AI opponent (deferred)

Parked on 2026-07-11 in favor of the manual tabletop mode. Decisions already made
with Jason, so we can resume without re-litigating:

- **Approach chosen:** heuristic bot + a **curated deck** of engine-supported cards
  (mono-color creature deck), NOT an LLM (LLM is a possible phase 2). A bot only
  plays as well as the rules engine automates, so pair it with cards the engine
  fully handles and expand as coverage grows (see `docs/RULES-COVERAGE.md`).
- **Ownership:** build end-to-end (backend + UI), kept in its own `server/src/game/bot.ts`
  module to avoid colliding with the rules-coverage work.

## Architecture (validated against the code)

- A bot is just a **seat with no WebSocket** — a synthetic `userId` (`bot:<uuid>`),
  a curated `deckId`, `isBot: true`. Drive it by calling `table.apply(botSeat, action)`
  server-side after state changes (`Table.apply`/`start` → `scheduleBots()` with a
  small setTimeout delay for watchability). Guard against re-entrancy / infinite loops.
- **The engine is priority-driven.** `advance_step` is blocked in strict mode; steps
  advance when players pass priority on an empty stack (`pass_priority`). So the bot
  must act-or-pass on its own priority — this also naturally gives the human time to
  block. Do NOT drive turns with `advance_step`.
- **Legal-move generator** `legalActions(state, cardIndex, seat): GameAction[]` — the
  engine has `enforce()` checks but no enumerator. Build one; reuse it to show humans
  only-legal actions too.
- **Heuristic policy** (on the bot's priority): play a land (respect `landsPlayedThisTurn`,
  main phase, empty stack); tap N lands + cast the most expensive affordable creature;
  in `declare_attackers` attack with all able creatures then pass; in `declare_blockers`
  (no priority check needed — can block anytime) block to prevent lethal / trade up;
  otherwise `pass_priority`. Mulligan: keep (v1).
- **UI:** "Add AI opponent" button in the lobby (`POST /api/tables/:id/bot`, host-only),
  a 🤖 thinking indicator, difficulty later.

## Milestone order
1. Bot seat infra + curated deck + "Add AI" UI + safe pass-only driver (proves the loop
   never hangs games).
2. Main-phase play (lands + creatures).
3. Combat (attack + block heuristics).
4. Polish (removal targeting, mulligan, difficulty, thinking indicator).
