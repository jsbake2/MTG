// Translate a ParsedQuery (from @mtg/shared) into SQL WHERE clauses. The server
// composes these into grouped queries (ARE vs REFERENCES) in repo.ts.
import {
  parseColorValue,
  type Comparator,
  type Condition,
  type ParsedQuery,
} from "@mtg/shared";

export class Params {
  values: unknown[] = [];
  add(v: unknown): string {
    this.values.push(v);
    return `$${this.values.length}`;
  }
}

function sqlComparator(op: Comparator): string {
  switch (op) {
    case "=":
    case ":":
      return "=";
    case "!=":
      return "<>";
    default:
      return op; // < <= > >=
  }
}

// A text expression that extracts the integer part of a text column like power
// ("3", "*", "1+*"). Non-numeric -> NULL so numeric comparisons drop them.
function numExpr(col: string): string {
  return `NULLIF(regexp_replace(${col}, '[^0-9-]', '', 'g'), '')::int`;
}

function likeContains(col: string, value: string, p: Params): string {
  return `${col} ILIKE '%' || ${p.add(value)} || '%'`;
}

// Build a SQL boolean expression for a single field condition.
function conditionSql(c: Condition, p: Params): string | null {
  const v = c.value;
  switch (c.field) {
    case "type":
      return likeContains("type_line", v, p);
    case "oracle":
      return `coalesce(oracle_text, '') ILIKE '%' || ${p.add(v)} || '%'`;
    case "name":
      return likeContains("name", v, p);
    case "artist":
      return `coalesce(artist, '') ILIKE '%' || ${p.add(v)} || '%'`;
    case "keyword":
      // keywords array, case-insensitive membership
      return `EXISTS (SELECT 1 FROM unnest(keywords) k WHERE lower(k) = lower(${p.add(v)}))`;
    case "color": {
      const letters = parseColorValue(v);
      if (letters.length === 0) return `colors = '{}'`; // colorless
      if (c.op === "=") return `colors = ${p.add(letters)}::text[] `;
      // ":" / others -> contains all listed colors
      return `colors @> ${p.add(letters)}::text[]`;
    }
    case "identity": {
      const letters = parseColorValue(v);
      if (letters.length === 0) return `color_identity = '{}'`;
      if (c.op === "=") return `color_identity = ${p.add(letters)}::text[]`;
      // subset: the card's identity fits within the given colors (deck/commander)
      return `color_identity <@ ${p.add(letters)}::text[]`;
    }
    case "cmc":
      return `cmc ${sqlComparator(c.op)} ${p.add(Number(v))}`;
    case "year":
      return `year ${sqlComparator(c.op)} ${p.add(Number(v))}`;
    case "power":
      return `${numExpr("power")} ${sqlComparator(c.op)} ${p.add(Number(v))}`;
    case "toughness":
      return `${numExpr("toughness")} ${sqlComparator(c.op)} ${p.add(Number(v))}`;
    case "loyalty":
      return `${numExpr("loyalty")} ${sqlComparator(c.op)} ${p.add(Number(v))}`;
    case "rarity":
      return `rarity = lower(${p.add(v)})`;
    case "set": {
      // Comma-separated set codes = OR (used by the set-filter checkboxes).
      if (v.includes(",")) {
        const codes = v.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
        return `set_code = ANY(${p.add(codes)}::text[])`;
      }
      return `(set_code = lower(${p.add(v)}) OR set_name ILIKE '%' || ${p.add(v)} || '%')`;
    }
    case "format":
      // format-legal (legal or restricted)
      return `(legalities->>lower(${p.add(v)})) IN ('legal', 'restricted')`;
    case "banned":
      return `(legalities->>lower(${p.add(v)})) = 'banned'`;
    case "restricted":
      return `(legalities->>lower(${p.add(v)})) = 'restricted'`;
    case "is":
      return isFilter(v, p);
    default:
      return null;
  }
}

function isFilter(value: string, p: Params): string | null {
  switch (value.toLowerCase()) {
    case "commander":
      return `(type_line ILIKE '%legendary%' AND type_line ILIKE '%creature%')`;
    case "permanent":
      return `card_types && ARRAY['Artifact','Creature','Enchantment','Land','Planeswalker','Battle']`;
    case "spell":
      return `card_types && ARRAY['Instant','Sorcery']`;
    case "creature":
      return `'Creature' = ANY(card_types)`;
    case "land":
      return `'Land' = ANY(card_types)`;
    case "multicolor":
    case "multicolored":
    case "gold":
      return `coalesce(array_length(colors, 1), 0) > 1`;
    case "monocolor":
    case "monocolored":
      return `coalesce(array_length(colors, 1), 0) = 1`;
    case "colorless":
      return `coalesce(array_length(colors, 1), 0) = 0`;
    case "token":
      return `layout ILIKE '%token%'`;
    case "reserved":
      return `reserved = true`;
    case "vanilla":
      return `coalesce(oracle_text, '') = ''`;
    case "dfc":
    case "transform":
      return `coalesce(jsonb_array_length(faces), 0) > 1`;
    case "digital":
      return `digital = true`;
    case "paper":
      return `digital = false`;
    default:
      // Unknown is: filter, ignore rather than error.
      void p;
      return null;
  }
}

export interface BuiltQuery {
  // Clauses that must all hold (field conditions + negated bare terms).
  baseClauses: string[];
  // Positive bare terms drive the ARE / REFERENCES grouping.
  positiveTerms: string[];
  interpreted: string[];
}

export function buildQuery(parsed: ParsedQuery, p: Params): BuiltQuery {
  const baseClauses: string[] = [];
  const interpreted: string[] = [];
  const positiveTerms: string[] = [];

  for (const c of parsed.conditions) {
    const sql = conditionSql(c, p);
    if (!sql) continue;
    baseClauses.push(c.negated ? `NOT (${sql})` : sql);
    interpreted.push(`${c.negated ? "not " : ""}${c.field} ${c.op} ${c.value}`);
  }

  for (const t of parsed.terms) {
    if (t.negated) {
      // Negated bare term: exclude anywhere it appears.
      const nm = likeContains("name", t.value, p);
      const tp = likeContains("type_line", t.value, p);
      const ot = `coalesce(oracle_text,'') ILIKE '%' || ${p.add(t.value)} || '%'`;
      baseClauses.push(`NOT (${nm} OR ${tp} OR ${ot})`);
      interpreted.push(`not "${t.value}"`);
    } else {
      positiveTerms.push(t.value);
      interpreted.push(`"${t.value}"`);
    }
  }

  return { baseClauses, positiveTerms, interpreted };
}

// Expressions for grouping a positive term.
export function termAreExpr(term: string, p: Params): string {
  const nm = likeContains("name", term, p);
  const tp = likeContains("type_line", term, p);
  return `(${nm} OR ${tp})`;
}
export function termRefExpr(term: string, p: Params): string {
  const ot = `coalesce(oracle_text,'') ILIKE '%' || ${p.add(term)} || '%'`;
  const nm = likeContains("name", term, p);
  const tp = likeContains("type_line", term, p);
  return `(${ot} AND NOT (${nm} OR ${tp}))`;
}
export function termNameExpr(term: string, p: Params): string {
  return likeContains("name", term, p);
}
export function termAnyExpr(term: string, p: Params): string {
  const nm = likeContains("name", term, p);
  const tp = likeContains("type_line", term, p);
  const ot = `coalesce(oracle_text,'') ILIKE '%' || ${p.add(term)} || '%'`;
  return `(${nm} OR ${tp} OR ${ot})`;
}
