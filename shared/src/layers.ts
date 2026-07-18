// The CR-613 continuous-effects layer system, modeled on XMage's pipeline. Pure:
// given base characteristics and a list of continuous modifications (each tagged
// with its layer/sublayer + timestamp + optional dependency), it derives the
// final characteristics by applying every effect in the correct order. This
// replaces ad-hoc "add up the bonuses" P/T math with the proven layered model.

export type Layer = 1 | 2 | 3 | 4 | 5 | 6 | 7;
export type Sublayer = "7a" | "7b" | "7c" | "7d" | "7e";

export interface DerivedChars {
  power: number;
  toughness: number;
  cardTypes: string[];
  subtypes: string[];
  colors: string[];
  keywords: string[]; // lowercased
  loseAllAbilities: boolean;
}

export interface ContinuousMod {
  id: string;
  timestamp: number; // assigned when the effect became active (monotonic)
  layer: Layer;
  sublayer?: Sublayer; // required semantic for layer 7
  // Ids of mods this one depends on (must be applied first). CR 613.8.
  dependsOn?: string[];
  apply: (c: DerivedChars) => void;
}

const SUBLAYER_ORDER: Record<Sublayer, number> = { "7a": 0, "7b": 1, "7c": 2, "7d": 3, "7e": 4 };

function orderKey(m: ContinuousMod): [number, number] {
  if (m.layer === 7) return [7, SUBLAYER_ORDER[m.sublayer ?? "7c"]];
  return [m.layer, 0];
}

// Topological-ish ordering within an equal (layer, sublayer) bucket: timestamp
// order, but an effect that depends on another is applied after it.
function orderBucket(mods: ContinuousMod[]): ContinuousMod[] {
  const byId = new Map(mods.map((m) => [m.id, m]));
  const out: ContinuousMod[] = [];
  const done = new Set<string>();
  const visit = (m: ContinuousMod, stack: Set<string>) => {
    if (done.has(m.id) || stack.has(m.id)) return;
    stack.add(m.id);
    for (const dep of m.dependsOn ?? []) {
      const d = byId.get(dep);
      if (d) visit(d, stack);
    }
    stack.delete(m.id);
    if (!done.has(m.id)) { done.add(m.id); out.push(m); }
  };
  for (const m of [...mods].sort((a, b) => a.timestamp - b.timestamp)) visit(m, new Set());
  return out;
}

// Apply all mods over base characteristics in CR-613 order.
export function applyLayers(base: DerivedChars, mods: ContinuousMod[]): DerivedChars {
  const chars: DerivedChars = {
    power: base.power,
    toughness: base.toughness,
    cardTypes: [...base.cardTypes],
    subtypes: [...base.subtypes],
    colors: [...base.colors],
    keywords: [...base.keywords],
    loseAllAbilities: base.loseAllAbilities,
  };
  // Bucket by (layer, sublayer-index), apply buckets in ascending key order.
  const buckets = new Map<string, ContinuousMod[]>();
  for (const m of mods) {
    const [l, s] = orderKey(m);
    const key = `${l}.${s}`;
    (buckets.get(key) ?? buckets.set(key, []).get(key)!).push(m);
  }
  const keys = [...buckets.keys()].sort((a, b) => {
    const [la, sa] = a.split(".").map(Number);
    const [lb, sb] = b.split(".").map(Number);
    return la! - lb! || sa! - sb!;
  });
  for (const key of keys) {
    for (const m of orderBucket(buckets.get(key)!)) m.apply(chars);
  }
  return chars;
}

// ---- helpers to build the common mods ----------------------------------

export const mods = {
  setPT: (id: string, timestamp: number, power: number, toughness: number): ContinuousMod => ({
    id, timestamp, layer: 7, sublayer: "7b",
    apply: (c) => { c.power = power; c.toughness = toughness; },
  }),
  boostPT: (id: string, timestamp: number, dp: number, dt: number): ContinuousMod => ({
    id, timestamp, layer: 7, sublayer: "7c",
    apply: (c) => { c.power += dp; c.toughness += dt; },
  }),
  counters: (id: string, timestamp: number, plus: number, minus: number): ContinuousMod => ({
    id, timestamp, layer: 7, sublayer: "7d",
    apply: (c) => { c.power += plus - minus; c.toughness += plus - minus; },
  }),
  switchPT: (id: string, timestamp: number): ContinuousMod => ({
    id, timestamp, layer: 7, sublayer: "7e",
    apply: (c) => { const p = c.power; c.power = c.toughness; c.toughness = p; },
  }),
  addType: (id: string, timestamp: number, ...types: string[]): ContinuousMod => ({
    id, timestamp, layer: 4,
    apply: (c) => { for (const t of types) if (!c.cardTypes.includes(t)) c.cardTypes.push(t); },
  }),
  setColors: (id: string, timestamp: number, colors: string[]): ContinuousMod => ({
    id, timestamp, layer: 5,
    apply: (c) => { c.colors = [...colors]; },
  }),
  // Note: NOT gated on loseAllAbilities — layer-6 timestamp order already decides
  // precedence (a grant with a later timestamp than a "lose all abilities" wins).
  addKeyword: (id: string, timestamp: number, ...kw: string[]): ContinuousMod => ({
    id, timestamp, layer: 6,
    apply: (c) => { for (const k of kw) if (!c.keywords.includes(k.toLowerCase())) c.keywords.push(k.toLowerCase()); },
  }),
  loseAbilities: (id: string, timestamp: number): ContinuousMod => ({
    id, timestamp, layer: 6,
    apply: (c) => { c.loseAllAbilities = true; c.keywords = []; },
  }),
};
