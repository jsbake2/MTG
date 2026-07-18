// Colour-aware mana payment. The engine calls this to decide how a spell's cost
// is paid from a player's untapped sources:
//   - if there's exactly ONE sensible way to pay, tap it automatically;
//   - if the player could pay in more than one way (duals, surplus of mixed
//     sources), hand the choice back so they pick which sources to tap.
// Pure functions only — the engine builds the inputs and applies the result.

export interface ManaSource {
  id: string;
  name: string;
  amount: number; // mana produced when tapped (usually 1)
  colors: string[]; // producible colours, subset of W U B R G C (all six = "any")
}

export interface ManaCost {
  pips: string[]; // coloured pips required, e.g. ["G","G","G"]
  generic: number; // generic mana required (includes X and commander tax)
}

const BASIC: Record<string, string> = { plains: "W", island: "U", swamp: "B", mountain: "R", forest: "G", wastes: "C" };

// Parse a mana-cost string ("{1}{G}{G}") into pips + generic. Hybrid/Phyrexian
// symbols are treated leniently as generic (payable by anything) so we never
// wrongly block a cast. `extraGeneric` carries X + commander tax; `cmcFallback`
// is used when the card has no cost string (e.g. test fixtures) → all generic.
export function parseCost(manaCost: string | null | undefined, extraGeneric: number, cmcFallback: number): ManaCost {
  if (!manaCost) return { pips: [], generic: Math.max(0, cmcFallback + extraGeneric) };
  const pips: string[] = [];
  let generic = extraGeneric;
  for (const tok of manaCost.match(/\{([^}]+)\}/g) ?? []) {
    const s = tok.slice(1, -1).toUpperCase();
    if (/^\d+$/.test(s)) generic += parseInt(s, 10);
    else if (s === "X") continue; // counted via extraGeneric (xValue)
    else if (/^[WUBRGC]$/.test(s)) pips.push(s);
    else generic += 1; // hybrid / Phyrexian / snow — pay with anything
  }
  return { pips, generic: Math.max(0, generic) };
}

// What colours (and how much) an untapped permanent can produce, or null if it
// isn't a mana source. `typeLine`/`oracleText` come from the card index.
export function sourceProduction(typeLine: string, oracleText: string | null): { colors: string[]; amount: number } | null {
  const tl = typeLine.toLowerCase();
  if (/\bbasic land\b/.test(tl) || (/\bland\b/.test(tl) && /—/.test(tl))) {
    const colors = Object.keys(BASIC).filter((b) => tl.includes(b)).map((b) => BASIC[b]!);
    if (colors.length) return { colors: [...new Set(colors)], amount: 1 };
  }
  const text = (oracleText ?? "").toLowerCase();
  const addClauses = text.match(/add [^.\n]*/g);
  if (!addClauses) return /\bbasic land\b/.test(tl) ? { colors: ["C"], amount: 1 } : null;
  const colors = new Set<string>();
  let amount = 1;
  for (const clause of addClauses) {
    if (/any (colou?r|type)/.test(clause)) {
      for (const c of "WUBRG") colors.add(c);
      if (/any type|or colorless/.test(clause)) colors.add("C");
    }
    const syms = clause.match(/\{([wubrgc])\}/g) ?? [];
    for (const s of syms) colors.add(s.slice(1, -1).toUpperCase());
    amount = Math.max(amount, syms.length || 1);
  }
  if (!colors.size) return null;
  return { colors: [...colors], amount };
}

// Greedily assign sources to a cost, returning the source ids used (a valid
// payment) or null if it can't be paid. Colour pips are filled first from the
// least-flexible sources so we don't waste a dual on a pip a basic could cover.
export function assign(sources: ManaSource[], cost: ManaCost): string[] | null {
  const pool = sources.map((s) => ({ ...s, left: s.amount }));
  const used = new Set<string>();
  const take = (s: { id: string; left: number }) => {
    s.left--;
    used.add(s.id);
  };
  for (const color of cost.pips) {
    const cand = pool
      .filter((s) => s.left > 0 && s.colors.includes(color))
      .sort((a, b) => a.colors.length - b.colors.length)[0];
    if (!cand) return null;
    take(cand);
  }
  let g = cost.generic;
  for (const s of [...pool].sort((a, b) => a.colors.length - b.colors.length)) {
    while (s.left > 0 && g > 0) {
      take(s);
      g--;
    }
  }
  return g > 0 ? null : [...used];
}

// Two sources are interchangeable if tapping either leaves the same options open.
const sig = (s: ManaSource) => `${[...s.colors].sort().join("")}:${s.amount}`;

export type PaymentPlan =
  | { status: "insufficient" }
  | { status: "forced"; tap: string[] }
  | { status: "choice"; tap: string[] }; // tap = a valid default (used by bots/auto)

// Decide how to pay. Auto (forced) when there's no meaningful choice of WHICH
// sources to tap: either every source must be tapped, or the untapped sources
// are all interchangeable. Otherwise it's a player choice.
export function planPayment(sources: ManaSource[], cost: ManaCost): PaymentPlan {
  const needed = cost.pips.length + cost.generic;
  if (needed <= 0) return { status: "forced", tap: [] };
  const tap = assign(sources, cost);
  if (!tap) return { status: "insufficient" };
  const available = sources.reduce((n, s) => n + s.amount, 0);
  if (available === needed) return { status: "forced", tap: sources.map((s) => s.id) };
  const uniform = sources.length > 0 && sources.every((s) => sig(s) === sig(sources[0]!));
  if (uniform) return { status: "forced", tap };
  return { status: "choice", tap };
}

// Validate a player's explicit source selection covers the cost exactly enough
// (every chosen source is used; the cost is fully paid).
export function selectionPays(chosen: ManaSource[], cost: ManaCost): boolean {
  const tap = assign(chosen, cost);
  if (!tap) return false;
  // No idle picks: every chosen source must contribute (can't tap extras for fun).
  return chosen.every((s) => tap.includes(s.id));
}
