// ---------------------------------------------------------------------------
// Oracle-text EFFECT COMPILER. Parses common Magic rules-text patterns into a
// structured list of EffectOps that the engine executes automatically on
// resolution (mapping onto the rules table in game/rules.ts). It intentionally
// covers the high-frequency patterns; anything it can't parse falls back to
// manual play (matched=false), so every card still works.
//
// Shared so the client can compile a card to know what targets to ask for, and
// the server compiles the same text to execute it — one source of truth.
// ---------------------------------------------------------------------------

export type TargetKind = "creature" | "permanent" | "player" | "any" | "spell" | "artifact" | "enchantment" | "planeswalker" | "land" | "opponent";

export type EffectWho =
  | { scope: "target"; kind: TargetKind }
  | { scope: "you" }
  | { scope: "controller" }
  | { scope: "each_opponent" }
  | { scope: "each_player" };

export type EffectOp =
  | { op: "draw"; who: EffectWho; count: number }
  | { op: "damage"; to: EffectWho; amount: number }
  | { op: "gain_life"; who: EffectWho; amount: number }
  | { op: "lose_life"; who: EffectWho; amount: number }
  | { op: "destroy"; what: EffectWho }
  | { op: "exile"; what: EffectWho }
  | { op: "bounce"; what: EffectWho }
  | { op: "counter"; what: EffectWho }
  | { op: "tap"; what: EffectWho }
  | { op: "untap"; what: EffectWho }
  | { op: "plus_counter"; what: EffectWho; count: number }
  | { op: "token"; who: EffectWho; count: number; power: number; toughness: number; name: string; colors: string[] }
  | { op: "discard"; who: EffectWho; count: number }
  | { op: "mill"; who: EffectWho; count: number }
  | { op: "scry"; who: EffectWho; count: number };

export interface CompiledEffect {
  ops: EffectOp[];
  // Target specs the caster must choose, in order (from ops with scope 'target').
  targets: { kind: TargetKind; label: string }[];
  matched: boolean;
}

const NUM: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, x: 1 };
function num(w: string | undefined): number {
  if (!w) return 1;
  if (/^\d+$/.test(w)) return parseInt(w, 10);
  return NUM[w.toLowerCase()] ?? 1;
}

function who(phrase: string): EffectWho {
  const p = phrase.trim().toLowerCase();
  const isTarget = p.includes("target") || p.includes("any target");
  if (!isTarget) {
    if (p.includes("each opponent")) return { scope: "each_opponent" };
    if (p.includes("each player")) return { scope: "each_player" };
    return { scope: "you" };
  }
  // A targeted phrase — detect the target kind by the type word (tolerates
  // qualifiers like "nonblack", "another", "you control", "an opponent controls").
  if (p.includes("any target") || p.includes("or player") || p.includes("or planeswalker or player")) return { scope: "target", kind: "any" };
  if (p.includes("player") || p.includes("opponent")) return { scope: "target", kind: "player" };
  if (p.includes("spell")) return { scope: "target", kind: "spell" };
  if (p.includes("planeswalker")) return { scope: "target", kind: "planeswalker" };
  if (p.includes("creature")) return { scope: "target", kind: "creature" };
  if (p.includes("artifact")) return { scope: "target", kind: "artifact" };
  if (p.includes("enchantment")) return { scope: "target", kind: "enchantment" };
  if (p.includes("land")) return { scope: "target", kind: "land" };
  if (p.includes("permanent")) return { scope: "target", kind: "permanent" };
  return { scope: "target", kind: "any" };
}

const COLORS: Record<string, string> = { white: "W", blue: "U", black: "B", red: "R", green: "G" };

// Each entry: a regex over a clause, and a builder returning an EffectOp (or null).
type Pattern = { re: RegExp; build: (m: RegExpMatchArray) => EffectOp | null };
const PATTERNS: Pattern[] = [
  // Damage: "deals N damage to <target>"
  {
    re: /deals?\s+(\d+|a|one|two|three|four|five|six|seven|x)\s+damage\s+to\s+(any target|target creature or planeswalker or player|target creature or player|target creature|target planeswalker|target player|each opponent|each player|you)/i,
    build: (m) => ({ op: "damage", amount: num(m[1]), to: who(m[2]!) }),
  },
  // Counter (check before draw so "counter target spell" isn't mis-read)
  { re: /counter\s+target\s+(spell|creature spell|noncreature spell|activated ability|triggered ability|ability)/i, build: () => ({ op: "counter", what: { scope: "target", kind: "spell" } }) },
  // Destroy / Exile / Bounce / Tap / Untap target
  { re: /destroy\s+(target [a-z ]*?(?:creature|permanent|artifact|enchantment|planeswalker|land))/i, build: (m) => ({ op: "destroy", what: who(m[1]!) }) },
  { re: /exile\s+(target [a-z ]*?(?:creature|permanent|artifact|enchantment|planeswalker|land|spell))/i, build: (m) => ({ op: "exile", what: who(m[1]!) }) },
  { re: /return\s+(target [a-z ]*?(?:creature|permanent|artifact|enchantment|land))\s+to\s+(?:its|their) owner['’]s hand/i, build: (m) => ({ op: "bounce", what: who(m[1]!) }) },
  { re: /\btap\s+(target [a-z ]*?(?:creature|permanent|artifact|land))/i, build: (m) => ({ op: "tap", what: who(m[1]!) }) },
  { re: /\buntap\s+(target [a-z ]*?(?:creature|permanent|artifact|land))/i, build: (m) => ({ op: "untap", what: who(m[1]!) }) },
  // +1/+1 counters
  { re: /put\s+(\d+|a|one|two|three|four|five)\s+\+1\/\+1 counters?\s+on\s+(target [a-z ]*?creature)/i, build: (m) => ({ op: "plus_counter", count: num(m[1]), what: who(m[2]!) }) },
  // Draw
  { re: /(you|target player|each player|target opponent)?\s*draws?\s+(\d+|a|one|two|three|four|five|seven)\s+cards?/i, build: (m) => ({ op: "draw", who: who(m[1] ?? "you"), count: num(m[2]) }) },
  // Life
  { re: /(you|target player)?\s*gains?\s+(\d+|one|two|three|four|five)\s+life/i, build: (m) => ({ op: "gain_life", who: who(m[1] ?? "you"), amount: num(m[2]) }) },
  { re: /(you|target player|each opponent|each player)?\s*loses?\s+(\d+|one|two|three|four|five)\s+life/i, build: (m) => ({ op: "lose_life", who: who(m[1] ?? "you"), amount: num(m[2]) }) },
  // Discard / Mill / Scry
  { re: /(you|target player|each player|each opponent)?\s*discards?\s+(\d+|a|one|two|three)\s+cards?/i, build: (m) => ({ op: "discard", who: who(m[1] ?? "you"), count: num(m[2]) }) },
  { re: /(target player|each player|you)?\s*mills?\s+(\d+|one|two|three|four|five)\s+cards?/i, build: (m) => ({ op: "mill", who: who(m[1] ?? "you"), count: num(m[2]) }) },
  { re: /\bscry\s+(\d+)/i, build: (m) => ({ op: "scry", who: { scope: "you" }, count: num(m[1]) }) },
  // Tokens: "create N P/T [colors] <name> creature token(s)"
  {
    re: /create\s+(\d+|a|one|two|three|four|five)\s+(\d+)\/(\d+)\s+([a-z, and]*?)\s*([a-z][a-z '-]*?)\s+creature tokens?/i,
    build: (m) => {
      const colorWords = (m[4] ?? "").toLowerCase();
      const colors = Object.entries(COLORS).filter(([w]) => colorWords.includes(w)).map(([, c]) => c);
      const name = (m[5] ?? "Creature").trim().replace(/\b\w/g, (c) => c.toUpperCase());
      return { op: "token", who: { scope: "you" }, count: num(m[1]), power: parseInt(m[2]!, 10), toughness: parseInt(m[3]!, 10), name: `${name} Token`, colors };
    },
  },
];

export function compileEffects(oracleText: string | null, cardName: string): CompiledEffect {
  const empty: CompiledEffect = { ops: [], targets: [], matched: false };
  if (!oracleText) return empty;
  // Strip reminder text and the card's own name; split into clauses.
  let text = oracleText.replace(/\([^)]*\)/g, " ");
  if (cardName) text = text.split("//")[0]!.replaceAll(cardName, "this").replaceAll(cardName.split(",")[0]!, "this");
  const clauses = text.split(/[.;\n]/).map((c) => c.trim()).filter(Boolean);

  const ops: EffectOp[] = [];
  for (const clause of clauses) {
    // Skip conditional/triggered/keyword-ability clauses we don't model yet.
    if (/^(whenever|when|at the beginning|as long as|if |flying|trample|first strike|deathtouch|lifelink|vigilance|haste|reach|menace|hexproof|ward|defender|indestructible)/i.test(clause)) continue;
    for (const p of PATTERNS) {
      const m = clause.match(p.re);
      if (m) {
        const op = p.build(m);
        if (op) ops.push(op);
        break; // one op per clause (keeps it conservative)
      }
    }
  }

  const targets: CompiledEffect["targets"] = [];
  for (const op of ops) {
    const spec = (op as { to?: EffectWho; what?: EffectWho; who?: EffectWho });
    const w = spec.to ?? spec.what ?? (op.op === "draw" || op.op === "discard" || op.op === "mill" ? spec.who : undefined);
    if (w && w.scope === "target") targets.push({ kind: w.kind, label: targetLabel(op.op, w.kind) });
  }
  return { ops, targets, matched: ops.length > 0 };
}

function targetLabel(op: string, kind: TargetKind): string {
  const verb: Record<string, string> = { damage: "deal damage to", destroy: "destroy", exile: "exile", bounce: "return", counter: "counter", tap: "tap", untap: "untap", plus_counter: "counter up", draw: "draw for" };
  return `Choose ${kind === "any" ? "any target" : `target ${kind}`} to ${verb[op] ?? op}`;
}
