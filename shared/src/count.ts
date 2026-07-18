// Forge-style dynamic values (`Count$...`). Resolves an amount from game state —
// X paid, count of objects matching a Valid expression, a characteristic of the
// source, a counter tally — with chained math suffixes (.Plus2/.Twice/.HalfUp…).
// This is what lets amounts scale without inventing a new opcode per card.
import { parseValid, type ValidContext, type ValidObject } from "./valid.js";

export interface CountContext {
  xPaid?: number;
  source?: ValidObject; // the object whose CardPower/CardCounters we read
  objects?: ValidObject[]; // pool to count Valid over
  validCtx?: ValidContext;
}

// A trailing math op: .Plus2 .Minus1 .NMinus3 .LimitMax5 .Twice .HalfUp .HalfDown .Negative .Abs
const MATH = /\.(Plus|Minus|NMinus|LimitMax|LimitMin)(\d+)$|\.(Twice|HalfUp|HalfDown|Negative|Abs)$/;

function applyMath(op: string, arg: number | null, v: number): number {
  switch (op) {
    case "Plus": return v + (arg ?? 0);
    case "Minus": return v - (arg ?? 0);
    case "NMinus": return (arg ?? 0) - v;
    case "LimitMax": return Math.min(v, arg ?? 0);
    case "LimitMin": return Math.max(v, arg ?? 0);
    case "Twice": return v * 2;
    case "HalfUp": return Math.ceil(v / 2);
    case "HalfDown": return Math.floor(v / 2);
    case "Negative": return -v;
    case "Abs": return Math.abs(v);
    default: return v;
  }
}

function baseCount(expr: string, ctx: CountContext): number {
  const s = expr.trim();
  if (/^-?\d+$/.test(s)) return parseInt(s, 10);
  if (s === "xPaid" || s === "X") return ctx.xPaid ?? 0;
  if (s === "CardPower") return typeof ctx.source?.power === "number" ? ctx.source.power : 0;
  if (s === "CardToughness") return typeof ctx.source?.toughness === "number" ? ctx.source.toughness : 0;
  if (s === "CardCMC" || s === "CMC") return ctx.source?.cmc ?? 0;
  const cc = s.match(/^CardCounters\.([A-Za-z0-9]+)$/);
  if (cc) return ctx.source?.counters?.[cc[1]!] ?? 0;
  const valid = s.match(/^Valid(?:All|Battlefield)?\s+(.+)$/);
  if (valid) {
    const pred = parseValid(valid[1]!);
    return (ctx.objects ?? []).filter((o) => pred(o, ctx.validCtx)).length;
  }
  return 0;
}

// Evaluate a count expression such as "Valid Creature.YouCtrl.Plus1" or "xPaid.Twice".
export function evalCount(expr: string, ctx: CountContext = {}): number {
  let base = expr.trim();
  const ops: Array<{ op: string; arg: number | null }> = [];
  // Strip trailing math ops from the right (so CardCounters.P1P1 keeps its dot).
  for (;;) {
    const m = base.match(MATH);
    if (!m) break;
    if (m[1]) ops.unshift({ op: m[1], arg: parseInt(m[2]!, 10) });
    else ops.unshift({ op: m[3]!, arg: null });
    base = base.slice(0, m.index);
  }
  let v = baseCount(base, ctx);
  for (const { op, arg } of ops) v = applyMath(op, arg, v);
  return v;
}

// Resolve a param value that is either a literal integer or a `Count$...` /
// SVar-style dynamic value. `svars` maps SVar names to their `Count$...` body.
export function resolveAmount(value: string | number | undefined, ctx: CountContext, svars?: Record<string, string>): number {
  if (value === undefined) return 0;
  if (typeof value === "number") return value;
  const s = value.trim();
  if (/^-?\d+$/.test(s)) return parseInt(s, 10);
  // Direct Count$ body.
  if (s.startsWith("Count$")) return evalCount(s.slice("Count$".length), ctx);
  // An SVar reference (e.g. "X") → look up its Count$ body.
  const body = svars?.[s];
  if (body) return body.startsWith("Count$") ? evalCount(body.slice("Count$".length), ctx) : evalCount(body, ctx);
  return 0;
}
