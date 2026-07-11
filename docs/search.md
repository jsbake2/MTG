# Search language

A local, Scryfall-inspired query language. Type it in the card browser or the deck builder's add-cards box. Conditions are combined with AND; prefix any token with `-` to negate it.

## The tribal / synergy split

A **bare word** (no operator) matches the card's name, type, or text — and when grouping is on, results split into two buckets:

- **Cards that ARE this** — the word appears in the name or type line (e.g. every *Vampire* creature).
- **Cards that REFERENCE this** — the word appears in the rules text but not the type (the instants, enchantments, and artifacts that care about Vampires).

This works for any tribe or theme: `goblin`, `dragon`, `+1/+1 counter`, `sacrifice`, `lifegain`, …

## Operators

| Operator | Meaning | Example |
|---|---|---|
| `t:` / `type:` | type line contains | `t:instant`, `t:"legendary creature"` |
| `o:` / `oracle:` | rules text contains | `o:"draw a card"` |
| `name:` | name contains | `name:bolt` |
| `c:` / `color:` | colors (contains; `=` for exact; `c` = colorless) | `c:rg`, `c=w`, `c:colorless` |
| `id:` / `identity:` | color identity fits within (Commander) | `id:wu` |
| `cmc:` / `mv:` | mana value, with `= != < <= > >=` | `cmc>=5`, `mv=0` |
| `pow:` `tou:` `loy:` | power / toughness / loyalty | `pow>=4`, `tou<2` |
| `r:` / `rarity:` | rarity | `r:mythic` |
| `set:` / `e:` / `s:` | set code or set name | `set:innistrad` |
| `year:` | printing year | `year>=2023` |
| `f:` / `format:` | legal (or restricted) in a format | `f:commander` |
| `banned:` | banned in a format | `banned:modern` |
| `restricted:` | restricted in a format | `restricted:vintage` |
| `kw:` / `keyword:` | has a keyword | `kw:flying` |
| `a:` / `artist:` | artist name | `a:"rebecca guay"` |
| `is:` | flags: `commander`, `creature`, `land`, `permanent`, `spell`, `token`, `reserved`, `vanilla`, `dfc`, `digital`, `paper` | `is:commander` |

## Examples

```
vampire                       every vampire + everything that cares about them
t:instant o:vampire           instants that mention vampires
t:creature c:g pow>=5         big green creatures
f:commander t:dragon          commander-legal dragons
o:"draw a card" c:u           blue card-draw
is:banned f:modern            cards banned in Modern
year>=2023 r:mythic           recent mythics
-c:r t:creature cmc<=2        cheap non-red creatures
```
