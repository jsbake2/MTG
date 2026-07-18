// A uniform ability-node IR modeled on Forge's card DSL: one `api` (opcode) plus
// a string-keyed param map, reused for spells / activated / triggered /
// replacement / sub-abilities. Sub-ability chaining is resolved from SVar
// references (SubAbility$ / Execute$ / ReplaceWith$). This is the richer
// intermediate representation the engine and compiler can target, replacing the
// flat regex→op union. Parsing only — execution is the engine's job.

export type AbilityKind = "spell" | "activated" | "sub" | "static" | "trigger" | "replacement";

export interface AbilityNode {
  kind: AbilityKind;
  api: string; // DealDamage, PutCounter, Pump, Mana, Draw, Token, Destroy, ...
  params: Record<string, string>;
  sub?: AbilityNode; // resolved SubAbility$ chain
}

export interface TriggerNode {
  mode: string; // Phase, ChangesZone, Attacks, SpellCast, ...
  params: Record<string, string>;
  execute?: AbilityNode; // resolved from Execute$
}

export interface CardIR {
  name?: string;
  manaCost?: string;
  types: string[];
  pt?: { power: string; toughness: string };
  loyalty?: string;
  keywords: string[]; // K: lines, raw payload
  spells: AbilityNode[]; // A:SP$
  activated: AbilityNode[]; // A:AB$
  triggers: TriggerNode[]; // T:
  statics: AbilityNode[]; // S:
  replacements: AbilityNode[]; // R:
  svars: Record<string, string>; // raw SVar bodies (for Count$ etc.)
  oracle?: string;
}

// Parse a pipe-delimited clause: "SP$ DealDamage | NumDmg$ 3 | ValidTgts$ Any".
// The first segment carries the kind sigil (SP$/AB$/DB$) or a Mode$/Event$ key.
export function parseParams(clause: string): Record<string, string> {
  const params: Record<string, string> = {};
  for (const seg of clause.split("|")) {
    const s = seg.trim();
    if (!s) continue;
    const i = s.indexOf("$");
    if (i === -1) continue;
    const key = s.slice(0, i).trim();
    const val = s.slice(i + 1).trim();
    params[key] = val;
  }
  return params;
}

// Parse "SP$ DealDamage | ..." into an ability node (kind from the sigil).
export function parseAbilityClause(clause: string): AbilityNode | null {
  const params = parseParams(clause);
  let kind: AbilityKind | null = null;
  let api: string | undefined;
  if (params.SP !== undefined) { kind = "spell"; api = params.SP; }
  else if (params.AB !== undefined) { kind = "activated"; api = params.AB; }
  else if (params.DB !== undefined) { kind = "sub"; api = params.DB; }
  if (!kind || !api) return null;
  const { SP: _s, AB: _a, DB: _d, ...rest } = params;
  return { kind, api, params: rest };
}

// Resolve SubAbility$ chains against the card's SVars (recursively, guarded
// against cycles).
function resolveSub(node: AbilityNode, svars: Record<string, string>, seen = new Set<string>()): AbilityNode {
  const subName = node.params.SubAbility;
  if (subName && svars[subName] && !seen.has(subName)) {
    seen.add(subName);
    const child = parseAbilityClause(svars[subName]!);
    if (child) node.sub = resolveSub(child, svars, seen);
  }
  return node;
}

// Parse a full Forge-style card script into a CardIR.
export function parseCardScript(text: string): CardIR {
  const ir: CardIR = { types: [], keywords: [], spells: [], activated: [], triggers: [], statics: [], replacements: [], svars: {} };
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  // First pass: collect SVars so ability lines can resolve references.
  for (const line of lines) {
    if (line.startsWith("SVar:")) {
      const rest = line.slice(5);
      const i = rest.indexOf(":");
      if (i !== -1) ir.svars[rest.slice(0, i)] = rest.slice(i + 1);
    }
  }

  for (const line of lines) {
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    const prefix = line.slice(0, colon);
    const body = line.slice(colon + 1);
    switch (prefix) {
      case "Name": ir.name = body; break;
      case "ManaCost": ir.manaCost = body === "no cost" ? undefined : body; break;
      case "Types": ir.types = body.split(/\s+/).filter(Boolean); break;
      case "Loyalty": ir.loyalty = body; break;
      case "Oracle": ir.oracle = body.replace(/\\n/g, "\n"); break;
      case "PT": {
        const m = body.match(/^(.+?)\/(.+)$/);
        if (m) ir.pt = { power: m[1]!.trim(), toughness: m[2]!.trim() };
        break;
      }
      case "K": ir.keywords.push(body); break;
      case "A": {
        const node = parseAbilityClause(body);
        if (node) {
          resolveSub(node, ir.svars);
          (node.kind === "spell" ? ir.spells : ir.activated).push(node);
        }
        break;
      }
      case "S": ir.statics.push({ kind: "static", api: parseParams(body).Mode ?? "Continuous", params: parseParams(body) }); break;
      case "R": {
        const params = parseParams(body);
        const rep: AbilityNode = { kind: "replacement", api: params.Event ?? "", params };
        const rw = params.ReplaceWith;
        if (rw && ir.svars[rw]) { const child = parseAbilityClause(ir.svars[rw]!); if (child) rep.sub = resolveSub(child, ir.svars); }
        ir.replacements.push(rep);
        break;
      }
      case "T": {
        const params = parseParams(body);
        const trig: TriggerNode = { mode: params.Mode ?? "", params };
        const ex = params.Execute;
        if (ex && ir.svars[ex]) { const child = parseAbilityClause(ir.svars[ex]!); if (child) trig.execute = resolveSub(child, ir.svars); }
        ir.triggers.push(trig);
        break;
      }
      default: break; // SVar handled above; DeckHas/AI/etc. ignored
    }
  }
  return ir;
}
