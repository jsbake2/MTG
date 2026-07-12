# Rules engine — plan of record

Decided with Jason (2026-07-12): **engine-first**, with **structured authored card
scripts** (stored/versioned in the DB, each behavior-tested) replacing the runtime
regex compiler. Goal: climb toward full automation like MTGA/XMage, without silent
incorrectness — anything not yet authored-and-verified falls back to manual play.

## The two systems

- **(A) Engine — card-agnostic, finite, CR-spec'd.** The game loop. Does NOT grow
  with card count. This is ~80% of the difficulty and must be correct first.
- **(B) Content — per-card, ~28k units.** Each card = a composition of reusable
  primitives ("tags done right"), authored once into structured data, not parsed
  from English at runtime.

## Guardrails (the failure mode to fear is silent-wrong, not slow)

1. **Never silently wrong.** If the engine isn't sure, it asks the player or logs
   "resolve manually." The hybrid fallback stays forever.
2. **Every automated card ships with ≥1 behavioral test** (cast it → assert board
   state). "Covered" is measured by tests passing, not by "has ops."
3. **Verify card authoring against an authority** (Scryfall oracle + Gatherer
   rulings) and adversarially re-read; LLM-authored tags are a liability until
   verified. Verify every engine rule against `docs/comprehensive-rules.txt`
   (never memory) — see [[rules-verification]].

## Roadmap

### Engine (do these before scaling content)
- **E1 — Stack, priority, SBAs.** Correct priority passing in APNAP order, the
  stack (cast → respond → resolve), state-based actions checked at every priority.
  Test-backed. (Partly exists in `server/src/game/engine.ts`; harden it.)
- **E2 — Continuous effects / the layer system (CR 613).** 7 layers (copy, control,
  text, type, color, ability, P/T) with timestamps AND dependency. The single
  hardest subsystem; a flat priority list cannot express it.
- **E3 — Replacement effects (CR 614).** Event interception ("instead", "enters
  with"), chaining, player choice of order. Different execution model than "run ops".
- **E4 — Triggered abilities on the stack.** Detect event → build trigger → APNAP
  ordering → player orders own triggers → intervening-if → reflexive triggers.
- **E5 — Targeting/legality/fizzle, modes, X, costs, choices as you cast/resolve.**
  Builds on the `pendingChoice` protocol reserved in `docs/BACKEND-CONTRACT.md`.

### Content model + pipeline
- **C1 — Primitive vocabulary.** Ability types (activated/triggered/static/spell) +
  effect primitives (draw/damage/destroy/exile/+1+1/grant-kw/token/search/scry/…)
  with params (who/count/filter/duration/condition/target). Granularity is the core
  design problem — fine enough that a "weird" clause is ONE new primitive.
- **C2 — Card-script storage.** Structured scripts keyed by oracle id, versioned,
  in the DB, human-correctable. (Migrate/retire `shared/effects.ts` regex + fold in
  `cardScripts.ts`.)
- **C3 — Authoring pipeline.** Template auto-compiler for common patterns (fast
  bulk) + LLM-assisted authoring for the tail, each verified + tested.
- **C4 — Test harness + coverage-by-tests.** Re-point `tools/coverage.mjs` (see
  [[rules-coverage-project]]) to measure correctness (tests passing), not "has ops".

## Pitfalls we accepted going in
Layer system isn't a flat priority list; replacement effects need event interception;
triggers need the APNAP stack loop; regex-on-English caps ~70%; LLM authoring
misreads subtle timing; interactions aren't captured by per-card tags (the engine
primitives must); rules/oracle text change over time (version everything).

## Status
Direction set. Next: implement **E1** (stack/priority/SBA, test-backed) as the first
batch, then E2 (layers). Content authoring (C*) begins once the engine can execute
primitives correctly.
