# The rules model (hybrid enforcement)

This game is deliberately a **hybrid**. It is **not** a full automated rules engine (correctly implementing every one of ~28,000 cards is the XMage/Forge scope — a decade of work for large teams), and it is **not** a free-for-all virtual tabletop. Instead:

## The software enforces the framework (card-agnostic)

These rules are the same for every card and are driven by structured data (mana cost, type line, keywords, power/toughness), so one body of code covers the whole game:

- **Turn structure** — untap → upkeep → draw → main → combat (begin / attackers / blockers / damage / end) → main 2 → end → cleanup.
- **Priority** — passing priority around the table; when all pass, the top of the stack resolves or the step advances.
- **Automatic step actions** — untap your permanents and reset your land drop at untap; draw for the turn (the starting player skips their first draw in a 2-player game); empty mana and clear combat at cleanup.
- **Land drops** — one per turn, only on your main phase with an empty stack.
- **Timing** — sorcery-speed cards (creatures, sorceries, etc.) only on your main phase with an empty stack; instants/flash any time you have priority.
- **Summoning sickness** — a creature can't attack or tap for an ability the turn it enters, unless it has **Haste** (read from the card's keywords).
- **Combat** — only untapped, non-sick creatures attack; attackers tap unless they have **Vigilance**; damage is assigned and applied automatically, and lethal damage / zero toughness kills creatures.
- **The stack** — LIFO; cast spells go on the stack and resolve in order.
- **State-based checks** — a player at 0 life (or 10 poison, or 21 commander damage) loses; the last player standing wins.
- **Hidden zones** — you can't see opponents' hands or anyone's library.

## The players perform card effects

What a card actually *does* ("destroy target creature", "Vampires get +1/+1", "draw two cards") is done by the humans using the table controls — move cards between zones, add counters, set power/toughness, make tokens, adjust life, etc. This is the teaching moment, and it's why every card works the day it's imported.

## Escape valves

- **Undo** — steps the whole game back one action (history of 50).
- **Override** — an action wrapper that bypasses a framework check for a genuinely weird card, written loudly to the game log.
- **Enforcement level** — *relaxed* (nudges but allows anything; great for little kids) vs *strict* (blocks framework violations). Set per table, changeable mid-game.

## Growth path (future)

An opt-in per-card **effect-scripting layer** can later let the cards your family plays most execute themselves ("click, it happens") — script the ~100 cards in a deck, not all 28,000. The architecture keeps this additive: unscripted cards keep working the manual way.
