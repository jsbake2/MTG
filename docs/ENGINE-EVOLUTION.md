# Breaking the rules-engine ceiling — lessons from Forge & XMage

Studied the two mature open-source engines (2026-07-14) to see how they scale rules to
all of Magic. Both were sparse-cloned and read directly (Forge card DSL + interpreter;
XMage OO ability/effect/layer model). This doc records what's transferable and the plan
to evolve **our TypeScript engine** — we are NOT switching languages (see the last
section for why).

## The two architectures

**Forge — data-driven card DSL.** One text file per card; a fixed catalog of ~205 effect
primitives interprets typed parameters.
```
Name:Lightning Bolt
A:SP$ DealDamage | ValidTgts$ Any | NumDmg$ 3
```
```
Name:Luminarch Aspirant
T:Mode$ Phase | Phase$ BeginCombat | ValidPlayer$ You | Execute$ TrigPutCounter
SVar:TrigPutCounter:DB$ PutCounter | ValidTgts$ Creature.YouCtrl | CounterType$ P1P1 | CounterNum$ 1
```
Key ideas: a **uniform ability node** `Api | Param$ Value | …` reused for spells (`SP$`),
activated (`AB$`), sub-abilities/triggers/replacements (`DB$`); a **`Valid` filter DSL**
(`Creature.YouCtrl+powerGE4`, `Card.EnchantedBy`, `Artifact,Enchantment`) used everywhere;
a **Cost mini-language** (`Cost$ T Sac<1/Creature>`); **`Count$` dynamic values** for X
(`SVar:X:Count$xPaid`, `Count$Valid Creature.YouCtrl.Plus1`); **layers implied by which
param is set** (`SetPower` = 7b, `AddPower` = 7c, `AddKeyword` = 6). This is why ~1000 cards
in a single folder share machinery.

**XMage — CR-accurate OO engine.** One Java class per card composing `Ability` + `Effect`
objects; a single recalc pipeline rebuilds all characteristics through the CR-613 layers.
Key ideas we should match for correctness:
- **One authoritative recalc** (`ContinuousEffects.apply`) run before every priority, after
  every action, after every effect during resolution. Never mutate P/T incrementally.
- **Layers 1→2→3→4→5→6→7→players→rules**, re-fetching the effect list between layers
  (esp. a **fixpoint loop at layer 6** because granted abilities create new layer-6 effects).
- **P/T sublayers 7a CDA → 7b setP/T → 7c ±N/N → 7d counters → 7e switch**, counters folded
  in by a dedicated pass, CDAs gated on the source still having the ability.
- **Ordering = timestamp (assigned when the effect becomes active) + dependency** (a small
  enumerated dependency-type set, waiting-list for dependents).
- **Affected-objects lock-in (CR 611.2c):** resolution-created effects snapshot their targets
  and freeze dynamic values; static-ability effects stay dynamic.
- **Replacement selection (CR 616):** filter by `checksEventType` then `applies`, track
  applied-effect-ids *on the event*, loop letting the affected player choose order.
- **Keywords:** singleton marker abilities for O(1) detection; evasion = marker +
  `RestrictionEffect.canBeBlocked`; "whenever X, +N/+N" = triggered + boost effect.

## Where our engine is today (the ceiling)

Regex → a ~40-member `EffectOp` union compiled from oracle text. ~13.7k/38k auto-playable,
16.5k blocked. The ceiling is structural, not linguistic:
- op vocabulary too small (Forge has ~205 primitives);
- **no composable target/filter DSL** — our `who()` is a handful of hard-coded cases;
- no cost mini-language, no `Count$`/X dynamic-value system, no trigger→sub-ability chaining;
- partial layer system (`continuous.ts` has some of 613, missing full sublayers/dependency/
  lock-in);
- regex-from-oracle is lossy and can't reach the long tail.

## The plan (port the architecture, keep TypeScript)

Highest leverage first. Each is a self-contained, testable step; none require a rewrite.

1. **`Valid` predicate DSL** — the single biggest lever. Compile `Base.qual+qual,alt`
   into a predicate over a card/player/spell property bag. Reuse it for targets, mass
   effects, static affected-sets, conditions, and counts. Unblocks huge swaths at once.
2. **Uniform ability-node IR** — replace the flat `EffectOp` union with `{api, params}`
   nodes (a TS discriminated union is perfect) usable as spell / activated / triggered /
   replacement / sub-ability, with `subAbility` chaining. Keep the current ops as the first
   ~40 `api`s and grow toward Forge's set as needed.
2b. **`Count$` dynamic values** — X, counters, counts-of-Valid, with `.Plus/.Twice/.HalfUp`
   math suffixes. Removes a whole class of "can't do X" gaps.
3. **Cost mini-language** — parse `T`, `2 B`, `Sac<1/Creature>`, `Discard<1/Card>`,
   `PayLife<2>` into structured costs the engine can verify/charge (dovetails with the new
   colour-aware mana solver).
4. **Complete the layer system** to XMage's shape — sublayers 7a–7e, re-fetch between
   layers, layer-6 fixpoint, timestamp+dependency ordering, affected-objects lock-in.
5. **Replacement-effect framework** — event pre-filter + applies + choose-order loop, ids
   tracked on the event (generalizes the current ETB-tapped / enters-with-counters hacks).

**Authoring to the IR — two paths.** (a) Upgrade the compiler to emit the richer IR from
oracle text for the common patterns; (b) for the long tail, author IR directly (a
Forge-like card script). Forge's scripts are open (GPL) and could *accelerate* the tail by
translation for personal use — but the durable win is our own IR + interpreter; treat Forge
as a design reference, not a dependency.

## Status (2026-07-14): the proven foundation is BUILT and tested

All five cores now exist as pure, tested `shared/src` modules (37 tests):
`valid.ts` (the filter DSL), `count.ts` (dynamic values / X), `ir.ts` (uniform
ability-node IR + Forge-style card-script parser), `cost.ts` (cost mini-language),
`layers.ts` (CR-613 layer system w/ sublayers 7a–7e + timestamp/dependency),
`replace.ts` (CR-614/616 replacement loop). These ARE the "stable, proven" way the
mature engines work — not regex.

## Rip-out plan (replace the fragile regex engine — do it via a bridge, not big-bang)

The fragile part is `shared/src/effects.ts` (regex → ~40-op union). It can't be
deleted today because the live engine (`compileEffects`/`compileText`/`parseAbilities`)
depends on it and the game would break. Sequence:
1. ✅ Build + test the proven foundation (done).
2. **IR interpreter** in the engine: execute an `AbilityNode` over `TableState`
   (map each `api` → a handler; reuse `Valid`/`Count`/`Cost`). Start with the ~30
   most common apis (DealDamage, PutCounter, Pump, Draw, Token, Destroy, ChangeZone,
   Mana, GainLife…) — that's most of Magic.
3. **Adapter**: build a `ValidObject` view of each `GameObject` (already ~half done
   in viewFor/derive) so the engine feeds Valid/Count.
4. **Migrate P/T + statics** onto `layers.ts`; migrate ETB/replacements onto
   `replace.ts` (retire the ad-hoc `replacements.ts` hacks).
5. **Re-base the compiler** to emit the new IR (not the old op union) for common
   oracle-text patterns; keep it far less fragile because the IR is expressive.
6. **Delete `effects.ts`** once the IR interpreter is at parity on the covered set.

## Re-based tagging (keep the idea, change the substrate)

Card tags stop being regex-derived op guesses and become **the IR itself**: a card's
"tags" = the set of `api` primitives + keywords its Forge-style script uses. The
`card_rules` table stores an `AbilityNode[]` (IR) per card instead of the old
ops/etb/triggers blobs. Two authoring paths to that IR: (a) the re-based compiler
emits it from oracle text for common patterns; (b) for the long tail, import/translate
Forge's already-authored open scripts (GPL — fine for personal use; treat as an
accelerator, not a shipped dependency).

## Reality check (is this a stretch?)

The **architecture** is realistic and de-risked — the proven cores are built and
tested. The honest caveat is **coverage**: we will NOT hand-author 38k cards (Forge/
XMage got there over 20 years + hundreds of contributors). We get coverage from the
IR-emitting compiler + Forge-script import, and we grow the covered set incrementally.
So "rip out fragile rules, use proven ones" = YES for the engine; "every card perfect
overnight" = no. The path is: proven engine now, cards migrate steadily.

## Language: stay TypeScript (do NOT rewrite in Java)

Forge/XMage are strong because of their **architecture**, not because they're Java — every
pattern above is a clean fit for TS (discriminated unions model the ability-node IR better
than Java class-per-card). Our whole product — React deckbuilder, Express/ws server, shared
types, Postgres, Docker, the anti-cheat authorization layer, redaction, the bot, the mana
solver, 57 tests — is TypeScript and tightly integrated with the engine. A Java rewrite means
either rebuilding the entire app or running a separate Java rules service (serialize game
state across a boundary, two languages, two deploys) — enormous cost for zero architectural
gain. The only scenario where switching pays is if the goal becomes "maximum card coverage
for minimum authoring," in which case you'd *fork Forge wholesale* and rebuild our unique
parts (search deckbuilder, guided kid-mode, anti-cheat, manual tabletop) on top of it — a
different project, and a bad trade given how much is already built. **Verdict: keep TS,
adopt the IR + Valid DSL + layer architecture above.**
