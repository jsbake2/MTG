// ---------------------------------------------------------------------------
// Oracle-text EFFECT COMPILER. Parses common Magic rules-text patterns into a
// structured list of EffectOps the engine executes automatically on resolution
// (mapping onto the rules table in game/rules.ts). Covers the high-frequency
// templates; anything it can't parse falls back to manual play (matched=false),
// so every card still works. Shared so client (targeting) and server (execute)
// use one source of truth.
// ---------------------------------------------------------------------------

import { scriptFor } from "./cardScripts.js";

export type TargetKind =
  | "creature"
  | "permanent"
  | "player"
  | "any"
  | "spell"
  | "artifact"
  | "enchantment"
  | "planeswalker"
  | "land"
  | "opponent";

export type EffectWho =
  | { scope: "target"; kind: TargetKind }
  | { scope: "you" }
  | { scope: "controller" }
  | { scope: "each_opponent" }
  | { scope: "each_player" };

// Set filter for mass effects ("all creatures", "creatures you control", …).
export interface MassFilter {
  creaturesOnly: boolean;
  types: string[]; // e.g. ["Artifact"] for "destroy all artifacts"
  controller: "you" | "opponents" | "all";
}

export type EffectOp =
  | { op: "draw"; who: EffectWho; count: number; xScaled?: boolean }
  | { op: "damage"; to: EffectWho; amount: number; xScaled?: boolean }
  | { op: "gain_life"; who: EffectWho; amount: number; xScaled?: boolean }
  | { op: "lose_life"; who: EffectWho; amount: number; xScaled?: boolean }
  | { op: "destroy"; what: EffectWho }
  | { op: "exile"; what: EffectWho }
  | { op: "bounce"; what: EffectWho }
  | { op: "counter"; what: EffectWho }
  | { op: "tap"; what: EffectWho }
  | { op: "untap"; what: EffectWho }
  | { op: "plus_counter"; what: EffectWho; count: number; kind: "+1/+1" | "-1/-1" }
  | { op: "pump"; what: EffectWho; power: number; toughness: number }
  | { op: "grant"; what: EffectWho; keyword: string }
  | { op: "gain_control"; what: EffectWho }
  | { op: "tuck"; what: EffectWho; top: boolean }
  | { op: "add_mana"; mana: Record<string, number> }
  | { op: "token"; who: EffectWho; count: number; power: number; toughness: number; name: string; colors: string[] }
  | { op: "mill"; who: EffectWho; count: number }
  // Mass (no single target) effects over a filtered set of permanents.
  | { op: "mass_damage"; filter: MassFilter; amount: number; xScaled?: boolean }
  | { op: "mass_destroy"; filter: MassFilter }
  | { op: "mass_exile"; filter: MassFilter }
  | { op: "mass_pump"; filter: MassFilter; power: number; toughness: number }
  | { op: "mass_grant"; filter: MassFilter; keyword: string }
  | { op: "mass_counter"; filter: MassFilter; count: number; kind: "+1/+1" | "-1/-1" }
  | { op: "tap_all"; filter: MassFilter; tapped: boolean }
  // Recognized but choice-heavy — engine prompts the player to finish.
  | { op: "manual"; hint: string };

export interface EffectMode {
  label: string;
  ops: EffectOp[];
  targets: { kind: TargetKind; label: string }[];
}
export interface CompiledEffect {
  ops: EffectOp[];
  targets: { kind: TargetKind; label: string }[];
  matched: boolean;
  // Present for modal ("choose one —") spells; the caster picks a mode.
  modes?: EffectMode[];
}

const NUM: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, x: 1 };
function num(w: string | undefined): number {
  if (!w) return 1;
  if (/^[+-]?\d+$/.test(w)) return parseInt(w, 10);
  return NUM[w.toLowerCase()] ?? 1;
}
function isX(w: string | undefined): boolean {
  return (w ?? "").toLowerCase() === "x";
}

const KEYWORDS = ["flying", "first strike", "double strike", "deathtouch", "lifelink", "trample", "vigilance", "haste", "menace", "reach", "hexproof", "indestructible", "flash", "defender", "shroud", "protection", "unblockable", "intimidate", "skulk"];

function who(phrase: string): EffectWho {
  const p = phrase.trim().toLowerCase();
  const isTarget = p.includes("target") || p.includes("any target");
  if (!isTarget) {
    if (p.includes("each opponent")) return { scope: "each_opponent" };
    if (p.includes("each player")) return { scope: "each_player" };
    return { scope: "you" };
  }
  if (p.includes("any target") || p.includes("or player")) return { scope: "target", kind: "any" };
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

function massFilter(phrase: string): MassFilter {
  const p = phrase.toLowerCase();
  let controller: MassFilter["controller"] = "all";
  if (/you control/.test(p)) controller = "you";
  else if (/you don't control|your opponents control|an opponent controls|opponents? control/.test(p)) controller = "opponents";
  const types: string[] = [];
  for (const [w, t] of [["artifact", "Artifact"], ["enchantment", "Enchantment"], ["land", "Land"], ["planeswalker", "Planeswalker"]] as const) {
    if (p.includes(w)) types.push(t);
  }
  const creaturesOnly = p.includes("creature") || types.length === 0;
  return { creaturesOnly: creaturesOnly && types.length === 0, types, controller };
}

const COLORS: Record<string, string> = { white: "W", blue: "U", black: "B", red: "R", green: "G" };

type Pattern = { re: RegExp; build: (m: RegExpMatchArray) => EffectOp | EffectOp[] | null };
const PATTERNS: Pattern[] = [
  // --- Counter (before draw) ---
  { re: /counter\s+target\s+(spell|creature spell|noncreature spell|activated ability|triggered ability|ability)/i, build: () => ({ op: "counter", what: { scope: "target", kind: "spell" } }) },

  // --- Mass damage / single damage ---
  { re: /deals?\s+(\d+|x)\s+damage\s+to\s+each\s+(creature and player|creature and planeswalker|creature)/i, build: (m) => [{ op: "mass_damage", filter: { creaturesOnly: true, types: [], controller: "all" }, amount: num(m[1]), xScaled: isX(m[1]) }, ...(/player/.test(m[2]!) ? [{ op: "damage" as const, to: { scope: "each_player" as const }, amount: num(m[1]), xScaled: isX(m[1]) }] : [])] },
  { re: /deals?\s+(\d+|a|one|two|three|four|five|six|seven|x)\s+damage\s+to\s+(any target|target creature or planeswalker or player|target creature or player|target creature|target planeswalker|target player|target opponent|each opponent|each player|you)/i, build: (m) => ({ op: "damage", amount: num(m[1]), xScaled: isX(m[1]), to: who(m[2]!) }) },

  // --- Destroy / Exile (mass first, then single) ---
  { re: /destroy\s+all\s+([a-z ]*?(?:creatures|permanents|artifacts|enchantments|lands|planeswalkers))/i, build: (m) => ({ op: "mass_destroy", filter: massFilter(m[1]!) }) },
  { re: /exile\s+all\s+([a-z ]*?(?:creatures|permanents|artifacts|enchantments|lands|planeswalkers))/i, build: (m) => ({ op: "mass_exile", filter: massFilter(m[1]!) }) },
  { re: /destroy\s+(target [a-z ]*?(?:creature|permanent|artifact|enchantment|planeswalker|land))/i, build: (m) => ({ op: "destroy", what: who(m[1]!) }) },
  { re: /exile\s+(target [a-z ]*?(?:creature|permanent|artifact|enchantment|planeswalker|land|spell))/i, build: (m) => ({ op: "exile", what: who(m[1]!) }) },

  // --- Return to hand (bounce) ---
  { re: /return\s+(target[a-z' ]*?(?:creature|permanent|artifact|enchantment|land)[a-z' ]*?)\s+to\s+(?:its owner['’]s|their owner['’]s|your|owner['’]s|their owners['’]?)\s+hand/i, build: (m) => ({ op: "bounce", what: who(m[1]!) }) },
  { re: /return\s+(?:up to\s+)?(?:\w+\s+)?target\s+[a-z ]*?card from (?:a|your|its owner['’]s|their) graveyard/i, build: () => ({ op: "manual", hint: "return from graveyard — pick the card" }) },
  { re: /return\s+all\s+([a-z ]*?(?:creatures|permanents|artifacts|enchantments))\s+to\s+(?:their|its) owners?['’] hands?/i, build: () => ({ op: "manual", hint: "return all to hand" }) },

  // --- Gain control ---
  { re: /gain(s)? control of\s+(target [a-z ]*?(?:creature|permanent|artifact|enchantment|planeswalker|land))/i, build: (m) => ({ op: "gain_control", what: who(m[2]!) }) },

  // --- Put on top/bottom of library (tuck) ---
  { re: /put\s+(target[a-z' ]*?(?:creature|permanent|artifact|enchantment)[a-z' ]*?)\s+on\s+(top|the bottom)\s+of\s+(?:its owner['’]s|their owner['’]s|your|owner['’]s) library/i, build: (m) => ({ op: "tuck", what: who(m[1]!), top: /top/i.test(m[2]!) }) },
  // --- Return up to N target … to hand (bounce one) ---
  { re: /return up to \w+ (target[a-z' ]*?(?:creature|permanent|artifact|enchantment|land)[a-z' ]*?)\s+to\s+(?:their|its) owners?['’]?s? hands?/i, build: (m) => ({ op: "bounce", what: who(m[1]!) }) },

  // --- Tap / Untap (all, then single) ---
  { re: /\btap\s+all\s+([a-z ]*?(?:creatures|permanents|artifacts|lands))/i, build: (m) => ({ op: "tap_all", filter: massFilter(m[1]!), tapped: true }) },
  { re: /\buntap\s+all\s+([a-z ]*?(?:creatures|permanents|artifacts|lands))/i, build: (m) => ({ op: "tap_all", filter: massFilter(m[1]!), tapped: false }) },
  { re: /\btap\s+(target [a-z ]*?(?:creature|permanent|artifact|land))/i, build: (m) => ({ op: "tap", what: who(m[1]!) }) },
  { re: /\buntap\s+(target [a-z ]*?(?:creature|permanent|artifact|land))/i, build: (m) => ({ op: "untap", what: who(m[1]!) }) },

  // --- Pump (mass, then single); optional keyword grant appended ---
  {
    re: /(creatures you control|creatures your opponents control|all creatures|creatures you don't control|each creature you control)\s+get\s+([+-]\d+)\/([+-]\d+)(?:\s+and gains?\s+([a-z ,]+))?/i,
    build: (m) => {
      const ops: EffectOp[] = [{ op: "mass_pump", filter: massFilter(m[1]!), power: num(m[2]), toughness: num(m[3]) }];
      const kw = grantKeyword(m[4]);
      if (kw) ops.push({ op: "mass_grant", filter: massFilter(m[1]!), keyword: kw });
      return ops;
    },
  },
  {
    re: /(target[a-z' ]*?creature[a-z' ]*?)\s+gets\s+([+-]\d+)\/([+-]\d+)(?:\s+and gains?\s+([a-z ,]+))?/i,
    build: (m) => {
      const ops: EffectOp[] = [{ op: "pump", what: who(m[1]!), power: num(m[2]), toughness: num(m[3]) }];
      const kw = grantKeyword(m[4]);
      if (kw) ops.push({ op: "grant", what: who(m[1]!), keyword: kw });
      return ops;
    },
  },

  // --- Grant keyword (no P/T change) ---
  { re: /(target[a-z' ]*?creature[a-z' ]*?)\s+gains?\s+([a-z ,]+)/i, build: (m) => { const kw = grantKeyword(m[2]); return kw ? { op: "grant", what: who(m[1]!), keyword: kw } : null; } },
  { re: /(creatures you control[a-z' ]*?)\s+gains?\s+([a-z ,]+)/i, build: (m) => { const kw = grantKeyword(m[2]); return kw ? { op: "mass_grant", filter: massFilter(m[1]!), keyword: kw } : null; } },

  // --- Counters (+1/+1, -1/-1) single + mass ---
  { re: /put\s+(\d+|a|one|two|three|four|five)\s+(\+1\/\+1|-1\/-1) counters?\s+on\s+(target [a-z ]*?creature)/i, build: (m) => ({ op: "plus_counter", count: num(m[1]), kind: m[2] as "+1/+1" | "-1/-1", what: who(m[3]!) }) },
  { re: /put\s+(\d+|a|one|two|three|four|five)\s+(\+1\/\+1|-1\/-1) counters?\s+on\s+each\s+(creature[a-z ]*)/i, build: (m) => ({ op: "mass_counter", count: num(m[1]), kind: m[2] as "+1/+1" | "-1/-1", filter: massFilter(m[3]!) }) },

  // --- Draw / Life / Mill ---
  { re: /(you|target player|each player|target opponent)?\s*draws?\s+(\d+|a|one|two|three|four|five|six|seven|x)\s+cards?/i, build: (m) => ({ op: "draw", who: who(m[1] ?? "you"), count: num(m[2]), xScaled: isX(m[2]) }) },
  { re: /(you|target player)?\s*gains?\s+(\d+|one|two|three|four|five|six|seven|eight|ten)\s+life/i, build: (m) => ({ op: "gain_life", who: who(m[1] ?? "you"), amount: num(m[2]) }) },
  { re: /(you|target player|each opponent|each player)?\s*loses?\s+(\d+|one|two|three|four|five)\s+life/i, build: (m) => ({ op: "lose_life", who: who(m[1] ?? "you"), amount: num(m[2]) }) },
  { re: /(target player|each player|you)?\s*mills?\s+(\d+|one|two|three|four|five|ten)\s+cards?/i, build: (m) => ({ op: "mill", who: who(m[1] ?? "you"), count: num(m[2]) }) },

  // --- Tokens ---
  {
    re: /create\s+(\d+|a|one|two|three|four|five|x)\s+(\d+)\/(\d+)\s+([a-z, and]*?)\s*([a-z][a-z '-]*?)\s+creature tokens?/i,
    build: (m) => {
      const colorWords = (m[4] ?? "").toLowerCase();
      const colors = Object.entries(COLORS).filter(([w]) => colorWords.includes(w)).map(([, c]) => c);
      const name = (m[5] ?? "Creature").trim().replace(/\b\w/g, (c) => c.toUpperCase());
      return { op: "token", who: { scope: "you" }, count: num(m[1]), power: parseInt(m[2]!, 10), toughness: parseInt(m[3]!, 10), name: `${name} Token`, colors };
    },
  },

  // --- Mana abilities: "Add {G}", "Add {C}{C}", "Add {G}{G}{G}" ---
  {
    re: /^add\s+((?:\{[wubrgc0-9/]+\}\s*)+)/i,
    build: (m) => {
      const mana: Record<string, number> = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
      for (const sym of m[1]!.matchAll(/\{([^}]+)\}/g)) {
        const s = sym[1]!.toUpperCase();
        if (/^\d+$/.test(s)) mana.C += parseInt(s, 10);
        else if ("WUBRG".includes(s)) mana[s] = (mana[s] ?? 0) + 1;
        else mana.C = (mana.C ?? 0) + 1;
      }
      return { op: "add_mana", mana };
    },
  },

  // --- Choice-heavy: recognized, engine prompts to finish (still automation of setup) ---
  { re: /search your library for/i, build: () => ({ op: "manual", hint: "search your library, then shuffle" }) },
  { re: /(look at the top|reveal the top|surveil|scry)\s*\d*/i, build: (m) => ({ op: "manual", hint: m[1]!.toLowerCase() }) },
  { re: /choose one\s*[—-]/i, build: () => ({ op: "manual", hint: "modal: choose one" }) },
  { re: /(target player|target opponent) (discards|reveals)/i, build: (m) => ({ op: "manual", hint: `${m[1]} ${m[2]}` }) },
  { re: /(sacrifices?|discards?)\s+(a|an|\d+|one|two|three)\s+(creature|permanent|artifact|land|card)/i, build: (m) => ({ op: "manual", hint: `${m[1]} ${m[3]}` }) },
  { re: /exile the top \d+ cards? of (?:your|target player['’]s) library/i, build: () => ({ op: "manual", hint: "exile from top of library" }) },
  { re: /prevent all (?:combat )?damage/i, build: () => ({ op: "manual", hint: "prevent damage (fog)" }) },
  { re: /put target [a-z ]*?card from (?:a|your|its owner['’]s|their) graveyard onto the battlefield/i, build: () => ({ op: "manual", hint: "reanimate — pick the graveyard card" }) },
  { re: /each player sacrifices/i, build: () => ({ op: "manual", hint: "each player sacrifices" }) },
  { re: /\bfight(s)? (target [a-z ]*?creature)/i, build: () => ({ op: "manual", hint: "fight — assign both creatures' damage" }) },
];

function grantKeyword(phrase: string | undefined): string | null {
  if (!phrase) return null;
  const p = phrase.toLowerCase();
  for (const k of KEYWORDS) if (p.includes(k)) return k;
  return null;
}

function normalize(oracleText: string, cardName: string): string {
  let text = oracleText.replace(/\([^)]*\)/g, " ");
  if (cardName) text = text.split("//")[0]!.replaceAll(cardName, "this").replaceAll(cardName.split(",")[0]!, "this");
  return text;
}

// Match a set of clauses into ops. When skipTriggers is true, triggered/static
// clauses are ignored (spell-resolution mode); ETB extraction passes false.
function opsFromClauses(clauses: string[], skipTriggers: boolean): EffectOp[] {
  const ops: EffectOp[] = [];
  for (const raw of clauses) {
    if (skipTriggers && /^(whenever|when|at the beginning|as long as|if |flying|trample|first strike|deathtouch|lifelink|vigilance|haste|reach|menace|hexproof|ward|defender|indestructible|flash|convoke|cascade|storm|this spell costs|as an additional cost|kicker|flashback|equip|enchant)/i.test(raw)) continue;
    const clause = raw
      .replace(/\buntil end of turn\b/gi, "")
      .replace(/\bthis turn\b/gi, "")
      .replace(/\byou may\b/gi, "you")
      .replace(/^,\s*/, "")
      .trim();
    for (const p of PATTERNS) {
      const m = clause.match(p.re);
      if (m) {
        const built = p.build(m);
        if (built) Array.isArray(built) ? ops.push(...built) : ops.push(built);
        break;
      }
    }
  }
  return ops;
}

// Modal spells: "Choose one —" / "Choose two —" / "Choose one or both —"
// followed by • bulleted modes. Returns the compiled modes, or null.
function detectModes(oracleText: string, cardName: string): EffectMode[] | null {
  const text = normalize(oracleText, cardName);
  if (!/choose (one|two|one or both|up to)/i.test(text)) return null;
  // Modes are • bullets (or • replaced). Grab everything after "choose … —".
  const after = text.split(/choose [^—\-]*[—-]/i)[1];
  if (!after) return null;
  const parts = after.split(/[•●]/).map((p) => p.trim()).filter((p) => p.length > 3);
  if (parts.length < 2) return null;
  const modes: EffectMode[] = [];
  for (const part of parts.slice(0, 6)) {
    const clauses = part.split(/[.;\n]/).map((c) => c.trim()).filter(Boolean);
    const eff = finalize(opsFromClauses(clauses, false));
    modes.push({ label: part.replace(/\s+/g, " ").slice(0, 70), ops: eff.ops, targets: eff.targets });
  }
  // Only worthwhile if at least one mode compiled to something.
  return modes.some((m) => m.ops.length > 0) ? modes : null;
}

export function compileEffects(oracleText: string | null, cardName: string): CompiledEffect {
  // A hand-authored per-card script always wins (100%-correct override).
  const scripted = scriptFor(cardName);
  if (scripted) return finalize(scripted);
  if (!oracleText) return { ops: [], targets: [], matched: false };
  const modes = detectModes(oracleText, cardName);
  if (modes) return { ops: [], targets: [], matched: true, modes };
  const clauses = normalize(oracleText, cardName).split(/[.;\n]/).map((c) => c.trim()).filter(Boolean);
  return finalize(opsFromClauses(clauses, true));
}

// Compile the effect(s) of "When/Whenever ~ enters the battlefield, <effect>"
// triggers, so permanents' ETB abilities auto-run when they enter.
export function compileEtbEffects(oracleText: string | null, cardName: string): CompiledEffect {
  if (!oracleText) return { ops: [], targets: [], matched: false };
  const text = normalize(oracleText, cardName);
  const clauses: string[] = [];
  const re = /when(?:ever)?\s+(?:this|another|a|an|one or more|[\w' ]+?)\s+enters(?: the battlefield)?(?:\s+under[^,]*)?,\s*([^.]+)\.?/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    // Split the trigger's effect on " and " into sub-clauses too.
    for (const part of m[1]!.split(/,? and /i)) clauses.push(part.trim());
  }
  return finalize(opsFromClauses(clauses, false));
}

// Derive target prompts from ops and package a CompiledEffect.
function finalize(ops: EffectOp[]): CompiledEffect {
  const targets: CompiledEffect["targets"] = [];
  for (const op of ops) {
    const w = (op as { to?: EffectWho }).to ?? (op as { what?: EffectWho }).what ?? ((op.op === "draw" || op.op === "mill") ? (op as { who?: EffectWho }).who : undefined);
    if (w && w.scope === "target") targets.push({ kind: w.kind, label: targetLabel(op.op, w.kind) });
  }
  return { ops, targets, matched: ops.length > 0 };
}

// Compile a raw effect string (no per-card script lookup) — used by modal modes
// and activated abilities.
export function compileText(text: string): CompiledEffect {
  const clean = text.replace(/\([^)]*\)/g, " ");
  const clauses = clean.split(/[.;\n]/).map((c) => c.trim()).filter(Boolean);
  return finalize(opsFromClauses(clauses, false));
}

export type TriggerEvent = "upkeep" | "endstep" | "attack" | "dies" | "combat_damage_player";
export interface Trigger {
  event: TriggerEvent;
  effect: CompiledEffect;
}

// Parse triggered abilities that fire on common game events.
export function compileTriggers(oracleText: string | null, cardName: string): Trigger[] {
  if (!oracleText) return [];
  const text = normalize(oracleText, cardName);
  const triggers: Trigger[] = [];
  const add = (event: TriggerEvent, effectText: string) => {
    const eff = compileText(effectText);
    if (eff.matched || eff.modes) triggers.push({ event, effect: eff });
  };
  const grab = (re: RegExp, event: TriggerEvent) => {
    for (const m of text.matchAll(re)) add(event, m[1]!);
  };
  grab(/at the beginning of (?:your|each) upkeep,\s*([^.]+)\.?/gi, "upkeep");
  grab(/at the beginning of your (?:end step|next end step),\s*([^.]+)\.?/gi, "endstep");
  grab(/whenever this(?: creature)? attacks,\s*([^.]+)\.?/gi, "attack");
  grab(/when this(?: creature)? dies,\s*([^.]+)\.?/gi, "dies");
  grab(/whenever this(?: creature)? deals combat damage to a player,\s*([^.]+)\.?/gi, "combat_damage_player");
  return triggers;
}

export interface Ability {
  index: number;
  cost: string;
  mana: Record<string, number>;
  needsTap: boolean;
  effect: CompiledEffect;
}

// Parse activated abilities ("[cost]: [effect]") from oracle text.
export function parseAbilities(oracleText: string | null, cardName: string): Ability[] {
  if (!oracleText) return [];
  const text = normalize(oracleText, cardName);
  const out: Ability[] = [];
  let idx = 0;
  for (const line of text.split(/\n/)) {
    const m = line.match(/^([^:]+):\s*(.+)$/);
    if (!m) continue;
    const cost = m[1]!.trim();
    // The left of ':' must look like a cost, not "Choose one:" / a trigger.
    const looksCost = /\{[wubrgtcxs0-9/]+\}/i.test(cost) || /^(sacrifice|discard|pay|exile|remove|return)\b/i.test(cost);
    if (!looksCost || /^(choose|when|whenever|at |if |level up|equip|enchant|reconfigure)/i.test(cost)) continue;
    const effect = compileText(m[2]!);
    if (!effect.matched && !effect.modes) continue;
    const mana: Record<string, number> = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0, generic: 0 };
    for (const sym of cost.matchAll(/\{([^}]+)\}/g)) {
      const s = sym[1]!.toUpperCase();
      if (/^\d+$/.test(s)) mana.generic += parseInt(s, 10);
      else if ("WUBRGC".includes(s)) mana[s] = (mana[s] ?? 0) + 1;
    }
    out.push({ index: idx++, cost, mana, needsTap: /\{T\}/i.test(cost), effect });
  }
  return out;
}

function targetLabel(op: string, kind: TargetKind): string {
  const verb: Record<string, string> = { damage: "deal damage to", destroy: "destroy", exile: "exile", bounce: "return", counter: "counter", tap: "tap", untap: "untap", plus_counter: "counter up", pump: "pump", grant: "buff", gain_control: "gain control of", draw: "draw for" };
  return `Choose ${kind === "any" ? "any target" : `target ${kind}`} to ${verb[op] ?? op}`;
}

// ---------------------------------------------------------------------------
// STATIC CONTINUOUS EFFECTS (CR 613, layers 6 & 7). Unlike the one-shot ops
// above, these are ongoing effects a PERMANENT produces while on the battlefield:
//   - Aura/Equipment grants:  "Enchanted/Equipped creature gets +2/+1 and has trample"
//   - Anthems:                "Creatures you control get +1/+1"
// The engine folds these into a creature's effective P/T (layer 7d) and keyword
// set (layer 6). Only additive +N/+N and keyword grants are modeled here; set-P/T
// and restriction clauses (Pacifism, etc.) fall back to manual for now.
// ---------------------------------------------------------------------------
export interface StaticEffect {
  scope: "attached" | "anthem";
  power: number;
  toughness: number;
  keywords: string[];
  // Combat restrictions granted to the affected creature(s) (e.g. Pacifism).
  cantAttack?: boolean;
  cantBlock?: boolean;
  // Anthem-only: which creatures it buffs.
  controller?: "you" | "opponents" | "all";
  othersOnly?: boolean; // "other creatures you control" — excludes the source itself
  tokensOnly?: boolean; // "creature tokens you control get ..." (Intangible Virtue)
}

function parseKeywords(phrase: string | undefined): string[] {
  if (!phrase) return [];
  const p = phrase.toLowerCase();
  return KEYWORDS.filter((k) => new RegExp(`\\b${k}\\b`).test(p));
}

// Compile the static continuous effects a permanent contributes. Returns [] for
// anything not a recognized static grant (the common case).
export function compileStatic(oracleText: string | null, cardName: string): StaticEffect[] {
  if (!oracleText) return [];
  const out: StaticEffect[] = [];
  for (let raw of normalize(oracleText, cardName).split(/[.\n]/)) {
    const clause = raw.trim().toLowerCase();
    if (!clause || /until end of turn/.test(clause)) continue; // that's a one-shot pump, not static

    // Aura / Equipment restriction: "enchanted|equipped creature can't attack/block" (Pacifism)
    let m = clause.match(/(?:enchanted|equipped) creature can't (attack or block|attack|block)/);
    if (m) { const w = m[1]!; out.push({ scope: "attached", power: 0, toughness: 0, keywords: [], cantAttack: /attack/.test(w), cantBlock: /block/.test(w) }); continue; }

    // Aura / Equipment: "enchanted|equipped creature gets +X/+Y[ and has KW]"
    m = clause.match(/(?:enchanted|equipped) creature gets ([+-]\d+)\/([+-]\d+)(?:\s+and (?:has|gains?) ([a-z, ]+?))?$/);
    if (m) { out.push({ scope: "attached", power: parseInt(m[1]!, 10), toughness: parseInt(m[2]!, 10), keywords: parseKeywords(m[3]) }); continue; }
    // Aura / Equipment keyword-only: "enchanted|equipped creature has|gains KW"
    m = clause.match(/(?:enchanted|equipped) creature (?:has|gains?) ([a-z, ]+?)$/);
    if (m) { const kw = parseKeywords(m[1]); if (kw.length) out.push({ scope: "attached", power: 0, toughness: 0, keywords: kw }); continue; }

    // Anthem: "[other] creatures [you control|your opponents control|] get +X/+Y[ and have KW]"
    m = clause.match(/(other )?creatures( you control| your opponents control| an opponent controls)? get ([+-]\d+)\/([+-]\d+)(?:\s+and (?:have|has|gains?) ([a-z, ]+?))?$/);
    if (m) {
      const scopeText = (m[2] || "").trim();
      const controller: StaticEffect["controller"] = /opponent/.test(scopeText) ? "opponents" : /you control/.test(scopeText) ? "you" : "all";
      out.push({ scope: "anthem", power: parseInt(m[3]!, 10), toughness: parseInt(m[4]!, 10), keywords: parseKeywords(m[5]), controller, othersOnly: !!m[1] });
      continue;
    }
    // Anthem keyword-only: "creatures you control have KW"
    m = clause.match(/(other )?creatures( you control| your opponents control)? (?:have|gains?) ([a-z, ]+?)$/);
    if (m) {
      const kw = parseKeywords(m[3]);
      if (!kw.length) continue;
      const scopeText = (m[2] || "").trim();
      const controller: StaticEffect["controller"] = /opponent/.test(scopeText) ? "opponents" : /you control/.test(scopeText) ? "you" : "all";
      out.push({ scope: "anthem", power: 0, toughness: 0, keywords: kw, controller, othersOnly: !!m[1] });
    }
  }
  return out;
}
