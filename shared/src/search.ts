// A local, Scryfall-inspired search query language. The PARSER lives here (shared
// so the client can preview/validate a query); the server translates the parsed
// AST into SQL. Supported (see docs/search.md):
//   t: type      o: oracle text   c: color       id: color identity
//   cmc/mv       pow  tou  loy     r: rarity      set:/e:/s:  year:
//   f: format-legal   is:banned/is:commander/... kw:/keyword  name:
// Comparators: `:` (contains / equals) plus = != < <= > >=. Prefix `-` negates.
// Bare words match name OR type OR oracle text (the "vampire" case), and the
// server additionally splits them into "cards that ARE X" vs "reference X".

export type Comparator = ":" | "=" | "!=" | "<" | "<=" | ">" | ">=";

export interface Condition {
  field: string; // normalized canonical field name
  op: Comparator;
  value: string;
  negated: boolean;
}

export interface BareTerm {
  value: string;
  negated: boolean;
}

export interface ParsedQuery {
  conditions: Condition[];
  terms: BareTerm[];
  raw: string;
}

const FIELD_ALIASES: Record<string, string> = {
  t: "type",
  type: "type",
  o: "oracle",
  oracle: "oracle",
  text: "oracle",
  c: "color",
  color: "color",
  colors: "color",
  id: "identity",
  identity: "identity",
  ci: "identity",
  cmc: "cmc",
  mv: "cmc",
  pow: "power",
  power: "power",
  tou: "toughness",
  toughness: "toughness",
  loy: "loyalty",
  loyalty: "loyalty",
  r: "rarity",
  rarity: "rarity",
  s: "set",
  set: "set",
  e: "set",
  edition: "set",
  year: "year",
  f: "format",
  format: "format",
  legal: "format",
  banned: "banned",
  restricted: "restricted",
  is: "is",
  kw: "keyword",
  keyword: "keyword",
  name: "name",
  a: "artist",
  artist: "artist",
};

// Split a raw string into tokens, keeping quoted phrases intact.
function tokenize(input: string): string[] {
  const tokens: string[] = [];
  let i = 0;
  const n = input.length;
  while (i < n) {
    while (i < n && /\s/.test(input[i]!)) i++;
    if (i >= n) break;
    let tok = "";
    let negated = false;
    if (input[i] === "-") {
      negated = true;
      tok += "-";
      i++;
    }
    // Optional field prefix "field<op>"
    // Read until we hit a space that is not inside quotes.
    let inQuote = false;
    while (i < n) {
      const ch = input[i]!;
      if (ch === '"') {
        inQuote = !inQuote;
        i++;
        continue;
      }
      if (/\s/.test(ch) && !inQuote) break;
      tok += ch;
      i++;
    }
    void negated;
    if (tok.length > 0) tokens.push(tok);
  }
  return tokens;
}

const COMPARATORS: Comparator[] = ["<=", ">=", "!=", "=", "<", ">", ":"];

function splitFieldOp(token: string): { field: string; op: Comparator; value: string } | null {
  // Find the earliest comparator occurrence.
  let best: { idx: number; op: Comparator } | null = null;
  for (const op of COMPARATORS) {
    const idx = token.indexOf(op);
    if (idx > 0 && (best === null || idx < best.idx || (idx === best.idx && op.length > best.op.length))) {
      if (best === null || idx < best.idx) best = { idx, op };
    }
  }
  if (!best) return null;
  const field = token.slice(0, best.idx).toLowerCase();
  const value = token.slice(best.idx + best.op.length);
  const canonical = FIELD_ALIASES[field];
  if (!canonical) return null;
  return { field: canonical, op: best.op, value: stripQuotes(value) };
}

function stripQuotes(s: string): string {
  return s.replace(/^"(.*)"$/s, "$1");
}

export function parseQuery(raw: string): ParsedQuery {
  const conditions: Condition[] = [];
  const terms: BareTerm[] = [];
  for (let token of tokenize(raw)) {
    let negated = false;
    if (token.startsWith("-")) {
      negated = true;
      token = token.slice(1);
    }
    const parsed = splitFieldOp(token);
    if (parsed) {
      conditions.push({ ...parsed, negated });
    } else {
      const value = stripQuotes(token);
      if (value) terms.push({ value, negated });
    }
  }
  return { conditions, terms, raw };
}

// Normalize a color/identity value like "wu", "azorius", "white blue" into
// a set of WUBRG letters. Card-agnostic helper reused by client & server.
const GUILD_ALIASES: Record<string, string> = {
  white: "W",
  blue: "U",
  black: "B",
  red: "R",
  green: "G",
  azorius: "WU",
  dimir: "UB",
  rakdos: "BR",
  gruul: "RG",
  selesnya: "GW",
  orzhov: "WB",
  izzet: "UR",
  golgari: "BG",
  boros: "RW",
  simic: "GU",
  colorless: "",
  c: "",
};

export function parseColorValue(value: string): string[] {
  const v = value.toLowerCase();
  if (GUILD_ALIASES[v] !== undefined) return GUILD_ALIASES[v].split("").filter(Boolean);
  const letters = v.toUpperCase().split("").filter((ch) => "WUBRG".includes(ch));
  return Array.from(new Set(letters));
}
