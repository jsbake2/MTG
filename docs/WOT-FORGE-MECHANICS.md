# Wheel of Time → Forge: mechanic translation guide

Most WoT mechanics are DATA-DRIVEN in Forge (no fork). Verified against Forge
2.0.13 bytecode + data files:
- **Custom counters** (Weave, Seal): `CounterType.getType()` falls back to
  `CounterCustomType` for any unknown name → `CounterType$ WEAVE` works as-is.
- **Custom subtypes** (Aes Sedai, Asha'man, Channeler, Trolloc, Whitecloak…):
  append `Name:Plural` lines to `res/lists/TypeLists.txt` `[CreatureTypes]`
  section. (In the install, not `~/.forge/custom`; the launcher re-appends on each
  run so Forge updates don't wipe it.)
- **Ability words** (Pattern, Anathema): cosmetic text; the effect is a normal
  static/trigger. No engine change.
- **New keyword *actions*** (a literal "Weave"/"Leash" keyword) WOULD need the
  Java `Keyword` enum + effect classes = a fork. NOT required — scripted with
  primitives below. Fork is optional polish; the one real candidate is Leash.

Author custom-mechanic cards in the editor's **advanced (raw script)** mode.
Legend: ✅ verified · ⚠️ needs a live Forge load test.

---

## Weave / weave total  ✅ (as a custom WEAVE player counter)

Weave total = an accumulating per-player count that never resets. Use a real
**custom `WEAVE` player counter** (Forge's `CounterCustomType` — no fork). Cleaner
than reusing experience counters (correct name/display, no collision).

- **"Weave"** (a sub-ability, usually stapled to an ETB/attack/cast):
  `SVar:Weave:DB$ PutCounter | Defined$ You | CounterType$ WEAVE | CounterNum$ 1`
  "Weave twice" → `CounterNum$ 2`.
- **Your weave total** (for any X): `SVar:X:Count$YourCountersWEAVE`
- ⚠️ verify the exact `Count$YourCounters<NAME>` spelling for custom counters on a
  live load (enum ones use `Count$YourCountersExperience`).
- **"Whenever you weave, …"** trigger ⚠️ (counter-added listener):
  `T:Mode$ CounterAdded | CounterType$ Experience | ValidPlayer$ You | Execute$ ... | TriggerZones$ Battlefield | TriggerDescription$ Whenever you weave, ...`
  ("for the first time each turn" → add `ActivationLimit$ 1` / a turn-reset SVar.)

### Pattern N thresholds  ✅
"Pattern N — [bonus]" = a continuous static that turns on at weave ≥ N (Serra
Ascendant pattern). The ability word "Pattern N" is cosmetic (put it in the
Description + Oracle):
```
S:Mode$ Continuous | Affected$ Card.Self | AddPower$ 2 | AddToughness$ 2 | CheckSVar$ X | SVarCompare$ GE3 | Description$ Pattern 3 — CARDNAME gets +2/+2 as long as your weave total is 3 or more.
SVar:X:Count$YourCountersExperience
```

---

## Channeler batch  ⚠️ (Valid OR-list of the 8 subtypes)

"Channeler" = any creature that is one of: Channeler, Aes Sedai, Asha'man, Wise
One, Windfinder, Damane, Dreadlord, Forsaken. Forge Valid uses `,` = OR. Multi-word
subtypes are written **without the space** (Forge convention, e.g. "Time Lord" →
`TimeLord`), so:

- Reusable filter (paste where a "Channeler" is referenced):
  `Creature.Channeler,Creature.AesSedai,Creature.Ashaman,Creature.WiseOne,Creature.Windfinder,Creature.Damane,Creature.Dreadlord,Creature.Forsaken`

⚠️ **Must validate in Forge**: that it accepts these as custom creature subtypes
and that `.AesSedai` filters match "Aes Sedai" type lines. If Forge won't register
new subtypes, fallback = tag each such creature with a marker (e.g. a hidden
keyword) and filter on that instead.

---

## Anathema  ✅ (conditional static vs. an opposing Channeler)

"Anathema — [bonus] as long as an opponent controls a Channeler." Cosmetic word +
conditional static:
```
S:Mode$ Continuous | Affected$ Card.Self | AddPower$ 1 | AddToughness$ 1 | CheckSVar$ Anath | SVarCompare$ GE1 | Description$ Anathema — CARDNAME gets +1/+1 as long as an opponent controls a Channeler.
SVar:Anath:Count$Valid Creature.OppCtrl+<the 8-type OR-list, each with OppCtrl>
```
(Count$Valid with an OR-list; each alternative carries `+OppCtrl`.)

---

## Leash  ⚠️ (GainControl + escalating upkeep tax — hardest)

"Leash target creature (mana value ≤ N optional). Gain control; at each upkeep pay
its leash cost (starts {2}, doubles each time) or it returns." Built from:
- `AB$/DB$ GainControl | ValidTgts$ Creature | LoseControl$ ...` — Forge supports
  gain-control with loss conditions.
- An upkeep trigger that offers the doubling cost and, if unpaid, hands control
  back. The doubling counter tracked per-leashed-creature (a counter on the
  creature, or an SVar) — this is the part to prototype first.

Prototype one Leash card end-to-end before scaling the other 42.

---

## Native Forge support (little/no custom work)  ✅
- **Sagas** (The Bore Opens, etc.) — Forge has full Saga chapter support.
- **Transforming legends / DFCs** (Rand al'Thor, Galad) — Forge DFC transform.
- **Balefire** = exile instead of destroy; "if it would die, exile it" is a
  standard replacement (`R:Event$ Moved ... Destination$ Exile`). Exile inherently
  = no death triggers, no reanimation, matching the guide.
- **True Power** = a black Aura (+5/+0, menace) that enchants only a Channeler and
  sacrifices/kills the bearer after 3 of your upkeeps (upkeep counter → trigger).
- **Custom counters** (Seal counters) — a named counter on a permanent + an
  activated ability that spends them.
- **Tokens** — all 24 tokens in the guide are standard Forge token scripts.

---

## Worked examples (real cards from the CSV)

**#1 Accepted** — `{T}: Add {W}. If you've woven three or more times, add {W}{W} instead.`
```
Name:Accepted
ManaCost:1 W
Types:Creature Human AesSedai
PT:1/2
A:AB$ Mana | Cost$ T | Produced$ W | Amount$ 1 | ConditionCheckSVar$ X | ConditionSVarCompare$ LT3 | SpellDescription$ Add {W}.
A:AB$ Mana | Cost$ T | Produced$ W | Amount$ 2 | ConditionCheckSVar$ X | ConditionSVarCompare$ GE3 | SpellDescription$ If you've woven three or more times, add {W}{W}.
SVar:X:Count$YourCountersExperience
Oracle:{T}: Add {W}. If you've woven three or more times, add {W}{W} instead.
```

**#2 Accepted Fighter** — `Whenever this attacks, you may weave.`
```
Name:Accepted Fighter
ManaCost:1 W
Types:Creature Human AesSedai
PT:2/1
T:Mode$ Attacks | ValidCard$ Card.Self | Execute$ Weave | TriggerDescription$ Whenever CARDNAME attacks, you may weave.
SVar:Weave:AB$ PutCounter | Cost$ 0 | Defined$ You | CounterType$ Experience | CounterNum$ 1 | Optional$ True
Oracle:Whenever Accepted Fighter attacks, you may weave. (Put an experience counter on you.)
```

**Amadician Recruit** — Anathema +1/+1:
```
Name:Amadician Recruit
ManaCost:1 W
Types:Creature Human Whitecloak
PT:2/2
S:Mode$ Continuous | Affected$ Card.Self | AddPower$ 1 | AddToughness$ 1 | CheckSVar$ Anath | SVarCompare$ GE1 | Description$ Anathema — CARDNAME gets +1/+1 as long as an opponent controls a Channeler.
SVar:Anath:Count$Valid Creature.Channeler+OppCtrl,Creature.AesSedai+OppCtrl,Creature.Ashaman+OppCtrl,Creature.WiseOne+OppCtrl,Creature.Windfinder+OppCtrl,Creature.Damane+OppCtrl,Creature.Dreadlord+OppCtrl,Creature.Forsaken+OppCtrl
Oracle:Anathema — Amadician Recruit gets +1/+1 as long as an opponent controls a Channeler.
```

---

## Validation status (2026-07-15, Forge 2.0.13)
**PARSE-LEVEL PASS.** Loaded a 5-card test edition (`~/.forge/custom`, cards
wot_accepted/weaver/pattern_bearer/amadician/collar) + WoT subtypes appended to
`res/lists/TypeLists.txt`. Forge booted headless (xvfb) and read the custom cards
with **zero** errors/exceptions/"unknown counter or type" — so the custom `WEAVE`
counter, the custom subtypes, `Count$YourCountersWEAVE`, the `CounterAdded`
trigger, the Anathema OR-list, Pattern static, and GainControl all **parse and
load**. No fork needed — confirmed. Still TODO: a live **runtime** playtest to
watch the WEAVE counter actually tick + Anathema toggle + the weave trigger fire
(parse-clean ≠ runtime-proven for those two novel bits; standard DSL is low-risk).

## Open risks to validate FIRST (one Forge load test)
1. Does Forge register the custom creature subtypes (Aes Sedai, Asha'man, Wise
   One, Windfinder, Damane, Dreadlord, Forsaken, Channeler, Whitecloak) so
   `.AesSedai` etc. filter correctly? If not → marker-keyword fallback.
2. Exact `CounterAdded` trigger form for "whenever you weave."
3. One full **Leash** card working end-to-end.

Validate these three on ~5 test cards in the installed Forge before mass-scripting.
