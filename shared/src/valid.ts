// The `Valid` predicate DSL — a compositional filter language over game objects,
// modeled on Forge's `Creature.YouCtrl+powerGE4` / `Card.EnchantedBy` / `A,B`.
// This is the reusable spine for targets, mass effects, static affected-sets,
// conditions, and counts. Pure: it operates on a normalized ValidObject bag plus
// a ValidContext (who "you" is, what the source/enchanted objects are), so both
// the effects compiler and the engine can share it.

export interface ValidObject {
  id?: string;
  kind: "card" | "permanent" | "spell" | "player";
  name?: string;
  cardTypes?: string[]; // Creature, Artifact, Instant, Sorcery, Land, ...
  subtypes?: string[]; // Elf, Aura, Equipment, ...
  supertypes?: string[]; // Legendary, Basic, Snow, ...
  colors?: string[]; // subset of W U B R G (empty = colorless)
  power?: number | null;
  toughness?: number | null;
  cmc?: number;
  controllerSeat?: number | null;
  ownerSeat?: number | null;
  tapped?: boolean;
  attacking?: boolean;
  blocking?: boolean;
  isToken?: boolean;
  counters?: Record<string, number>; // e.g. { "P1P1": 3 }
  keywords?: string[]; // lowercased keyword names
  zone?: string;
}

export interface ValidContext {
  youSeat?: number | null; // controller of the source ("you")
  sourceId?: string; // the source object (for Self/Other/EffectSource)
  enchantedById?: string; // the object this is attached to / enchanted by
  attachedToId?: string;
  rememberedIds?: string[];
}

export type ValidPredicate = (obj: ValidObject, ctx?: ValidContext) => boolean;

const CARD_TYPES = new Set(["creature", "artifact", "enchantment", "land", "instant", "sorcery", "planeswalker", "battle", "tribal", "kindred"]);
const COLOR_WORD: Record<string, string> = { white: "W", blue: "U", black: "B", red: "R", green: "G" };
const CMP: Record<string, (a: number, b: number) => boolean> = {
  GE: (a, b) => a >= b,
  GT: (a, b) => a > b,
  LE: (a, b) => a <= b,
  LT: (a, b) => a < b,
  EQ: (a, b) => a === b,
  NE: (a, b) => a !== b,
};

function num(v: number | null | undefined): number {
  return typeof v === "number" ? v : 0;
}

// Compile a numeric-comparison qualifier like "powerGE4" / "cmcLE2" / "toughnessEQ0".
function numericQual(prop: "power" | "toughness" | "cmc" | "loyalty", rest: string): ((o: ValidObject) => boolean) | null {
  const m = rest.match(/^(GE|GT|LE|LT|EQ|NE)(-?\d+)$/);
  if (!m) return null;
  const cmp = CMP[m[1]!]!;
  const n = parseInt(m[2]!, 10);
  return (o) => cmp(num(prop === "cmc" ? o.cmc : prop === "power" ? o.power : o.toughness), n);
}

// One qualifier (already stripped of a leading "!").
function compileQual(qRaw: string): (o: ValidObject, ctx: ValidContext) => boolean {
  const q = qRaw;
  const lower = q.toLowerCase();

  // control / ownership
  if (q === "YouCtrl") return (o, c) => o.controllerSeat != null && o.controllerSeat === c.youSeat;
  if (q === "YouDontCtrl" || q === "OppCtrl") return (o, c) => o.controllerSeat != null && c.youSeat != null && o.controllerSeat !== c.youSeat;
  if (q === "YouOwn") return (o, c) => o.ownerSeat != null && o.ownerSeat === c.youSeat;
  if (q === "OppOwn") return (o, c) => o.ownerSeat != null && c.youSeat != null && o.ownerSeat !== c.youSeat;

  // identity / relationship
  if (q === "Self") return (o, c) => !!o.id && o.id === c.sourceId;
  if (q === "Other") return (o, c) => !o.id || o.id !== c.sourceId;
  if (q === "EffectSource") return (o, c) => !!o.id && o.id === c.sourceId;
  if (q === "EnchantedBy" || q === "AttachedBy") return (o, c) => !!o.id && (o.id === c.enchantedById || o.id === c.attachedToId);
  if (q === "IsRemembered") return (o, c) => !!o.id && !!c.rememberedIds?.includes(o.id);

  // token / state
  if (q === "token") return (o) => !!o.isToken;
  if (q === "nonToken") return (o) => !o.isToken;
  if (q === "tapped") return (o) => !!o.tapped;
  if (q === "untapped") return (o) => !o.tapped;
  if (q === "attacking") return (o) => !!o.attacking;
  if (q === "blocking") return (o) => !!o.blocking;

  // colors
  if (COLOR_WORD[lower]) return (o) => !!o.colors?.includes(COLOR_WORD[lower]!);
  if (["w", "u", "b", "r", "g"].includes(lower)) return (o) => !!o.colors?.includes(lower.toUpperCase());
  if (q === "Colorless") return (o) => (o.colors?.length ?? 0) === 0;
  if (q === "Multicolor" || q === "Multicolored") return (o) => (o.colors?.length ?? 0) > 1;
  if (q === "Monocolor" || q === "Monocolored") return (o) => (o.colors?.length ?? 0) === 1;

  // numeric comparisons
  for (const [prefix, prop] of [["power", "power"], ["toughness", "toughness"], ["cmc", "cmc"]] as const) {
    if (q.startsWith(prefix)) {
      const f = numericQual(prop, q.slice(prefix.length));
      if (f) return f;
    }
  }

  // counters_<CMP><n>_<TYPE>  e.g. counters_GE1_P1P1
  const cm = q.match(/^counters_(GE|GT|LE|LT|EQ|NE)(\d+)_([A-Za-z0-9]+)$/);
  if (cm) {
    const cmp = CMP[cm[1]!]!;
    const n = parseInt(cm[2]!, 10);
    const type = cm[3]!;
    return (o) => cmp(o.counters?.[type] ?? 0, n);
  }

  // keywords: withFlying / withDeathtouch
  if (q.startsWith("with")) {
    const kw = q.slice(4).toLowerCase().replace(/([a-z])([A-Z])/g, "$1 $2");
    return (o) => !!o.keywords?.some((k) => k.toLowerCase() === kw || k.toLowerCase() === q.slice(4).toLowerCase());
  }

  // named<X> or named_X
  const nm = q.match(/^named[<_](.+?)>?$/);
  if (nm) return (o) => o.name === nm[1];

  // creature/other subtype used as a qualifier (Elf, Aura, Equipment)
  return (o) => !!o.subtypes?.some((s) => s.toLowerCase() === lower) || !!o.supertypes?.some((s) => s.toLowerCase() === lower);
}

// Compile a base type token: "Card"/"Permanent" = any object; "Player"/"Spell";
// a card type (Creature); or a subtype (Elf) used directly as the base.
function compileBase(baseRaw: string): (o: ValidObject) => boolean {
  const base = baseRaw;
  const lower = base.toLowerCase();
  if (base === "Card" || base === "Permanent" || base === "Any") return () => true;
  if (base === "Player") return (o) => o.kind === "player";
  if (base === "Spell") return (o) => o.kind === "spell";
  if (CARD_TYPES.has(lower)) return (o) => !!o.cardTypes?.some((t) => t.toLowerCase() === lower);
  // Otherwise treat as a subtype base (e.g. "Human", "Swamp").
  return (o) =>
    !!o.subtypes?.some((s) => s.toLowerCase() === lower) ||
    !!o.cardTypes?.some((t) => t.toLowerCase() === lower);
}

// Compile one alternative: Base(.qual(+qual)*)?  — AND of base + all qualifiers.
function compileAlternative(alt: string): ValidPredicate {
  const dot = alt.indexOf(".");
  const base = dot === -1 ? alt : alt.slice(0, dot);
  const quals = dot === -1 ? [] : alt.slice(dot + 1).split("+").filter(Boolean);
  const baseFn = compileBase(base);
  const qualFns = quals.map((q) => {
    const neg = q.startsWith("!");
    const fn = compileQual(neg ? q.slice(1) : q);
    return { neg, fn };
  });
  return (o, ctx = {}) => {
    if (!baseFn(o)) return false;
    for (const { neg, fn } of qualFns) {
      const r = fn(o, ctx);
      if (neg ? r : !r) return false;
    }
    return true;
  };
}

// Compile a full Valid expression. Comma = OR across alternatives.
export function parseValid(expr: string): ValidPredicate {
  const alts = expr.split(",").map((a) => a.trim()).filter(Boolean).map(compileAlternative);
  if (alts.length === 0) return () => false;
  if (alts.length === 1) return alts[0]!;
  return (o, ctx) => alts.some((f) => f(o, ctx));
}

// Convenience: does an object match?
export function matchesValid(expr: string, obj: ValidObject, ctx?: ValidContext): boolean {
  return parseValid(expr)(obj, ctx);
}
