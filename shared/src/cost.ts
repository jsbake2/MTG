// The Forge-style cost mini-language for activated/alternative costs:
// "T Sac<1/Creature>", "2 B", "Discard<1/Card>", "PayLife<2>", "X G XMin1",
// "tapXType<1/Creature>", "AddCounter<1/LOYALTY>". Parses into a structured cost
// the engine can display, verify, and charge. (Card mana COSTS in {G}{G} form are
// handled by mana.ts; this is the bare-token activated-cost grammar.)

export interface CostMana {
  generic: number;
  W: number; U: number; B: number; R: number; G: number; C: number;
  x: boolean;
  xMin1: boolean;
}

export type CostPart =
  | { type: "sacrifice"; count: number; valid: string }
  | { type: "discard"; count: number; valid: string }
  | { type: "exile"; count: number; valid: string; from?: string }
  | { type: "return"; count: number; valid: string }
  | { type: "reveal"; count: number; valid: string }
  | { type: "payLife"; amount: number }
  | { type: "payEnergy"; amount: number }
  | { type: "tapType"; count: number; valid: string }
  | { type: "untapType"; count: number; valid: string }
  | { type: "addCounter"; count: number; counter: string }
  | { type: "subCounter"; count: number; counter: string }
  | { type: "removeCounter"; count: number; counter: string }
  | { type: "mill"; count: number }
  | { type: "chooseColor"; count: number }
  | { type: "chooseCreatureType"; count: number }
  | { type: "flipCoin"; count: number }
  | { type: "rollDice"; count: number }
  | { type: "other"; raw: string };

export interface StructuredCost {
  mana: CostMana;
  tap: boolean;
  untap: boolean;
  parts: CostPart[];
}

function emptyMana(): CostMana {
  return { generic: 0, W: 0, U: 0, B: 0, R: 0, G: 0, C: 0, x: false, xMin1: false };
}

// args of Name<a/b/c> → ["a","b","c"]
function args(inner: string): string[] {
  return inner.split("/").map((s) => s.trim());
}

function part(name: string, inner: string): CostPart {
  const a = args(inner);
  const count = /^\d+$/.test(a[0] ?? "") ? parseInt(a[0]!, 10) : 1;
  const rest = a[1] ?? "";
  switch (name) {
    case "Sac": return { type: "sacrifice", count, valid: rest };
    case "Discard": return { type: "discard", count, valid: rest || "Card" };
    case "Exile": return { type: "exile", count, valid: rest };
    case "ExileFromHand": return { type: "exile", count, valid: rest, from: "Hand" };
    case "ExileFromGrave": return { type: "exile", count, valid: rest, from: "Graveyard" };
    case "ExileFromTop": return { type: "exile", count, valid: rest, from: "Library" };
    case "Return": return { type: "return", count, valid: rest };
    case "Reveal": return { type: "reveal", count, valid: rest || "Hand" };
    case "PayLife": return { type: "payLife", amount: count };
    case "PayEnergy": return { type: "payEnergy", amount: count };
    case "tapXType": return { type: "tapType", count, valid: rest };
    case "untapYType": return { type: "untapType", count, valid: rest };
    case "AddCounter": case "AddCounterYou": return { type: "addCounter", count, counter: rest };
    case "SubCounter": return { type: "subCounter", count, counter: rest };
    case "RemoveAnyCounter": return { type: "removeCounter", count, counter: rest };
    case "Mill": return { type: "mill", count };
    case "ChooseColor": return { type: "chooseColor", count };
    case "ChooseCreatureType": return { type: "chooseCreatureType", count };
    case "FlipCoin": return { type: "flipCoin", count };
    case "RollDice": return { type: "rollDice", count };
    default: return { type: "other", raw: `${name}<${inner}>` };
  }
}

export function parseCostString(cost: string): StructuredCost {
  const out: StructuredCost = { mana: emptyMana(), tap: false, untap: false, parts: [] };
  if (!cost) return out;
  for (const atom of cost.trim().split(/\s+/).filter(Boolean)) {
    if (/^\d+$/.test(atom)) { out.mana.generic += parseInt(atom, 10); continue; }
    if (/^[WUBRGC]$/.test(atom)) { (out.mana as unknown as Record<string, number>)[atom]++; continue; }
    if (atom === "X") { out.mana.x = true; continue; }
    if (atom === "XMin1") { out.mana.x = true; out.mana.xMin1 = true; continue; }
    if (atom === "T") { out.tap = true; continue; }
    if (atom === "Q" || atom === "Untap") { out.untap = true; continue; }
    const m = atom.match(/^([A-Za-z]+)<(.*)>$/);
    if (m) { out.parts.push(part(m[1]!, m[2]!)); continue; }
    out.parts.push({ type: "other", raw: atom });
  }
  return out;
}

// A short human label for a structured cost, e.g. "{2}{B}, {T}, Sacrifice a creature".
export function describeCost(c: StructuredCost): string {
  const bits: string[] = [];
  const m = c.mana;
  const manaStr = (m.x ? "{X}" : "") + (m.generic ? `{${m.generic}}` : "") + (["W", "U", "B", "R", "G", "C"] as const).flatMap((k) => Array(m[k]).fill(`{${k}}`)).join("");
  if (manaStr) bits.push(manaStr);
  if (c.tap) bits.push("{T}");
  if (c.untap) bits.push("{Q}");
  for (const p of c.parts) {
    switch (p.type) {
      case "sacrifice": bits.push(`Sacrifice ${p.count} ${p.valid}`); break;
      case "discard": bits.push(`Discard ${p.count} ${p.valid}`); break;
      case "exile": bits.push(`Exile ${p.count} ${p.valid}${p.from ? ` from ${p.from}` : ""}`); break;
      case "return": bits.push(`Return ${p.count} ${p.valid}`); break;
      case "payLife": bits.push(`Pay ${p.amount} life`); break;
      case "payEnergy": bits.push(`Pay {E}×${p.amount}`); break;
      case "tapType": bits.push(`Tap ${p.count} ${p.valid}`); break;
      case "addCounter": bits.push(`Put ${p.count} ${p.counter} counter`); break;
      case "subCounter": case "removeCounter": bits.push(`Remove ${p.count} ${p.counter} counter`); break;
      default: bits.push(("raw" in p ? p.raw : p.type)); break;
    }
  }
  return bits.join(", ");
}
