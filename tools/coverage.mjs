// Rules-coverage analyzer.
//
// Reads a JSONL dump of every distinct card (one {name,type_line,card_types,
// supertypes,keywords,oracle_text} per line) and classifies each card by how
// well the current rules engine (shared/dist effect compiler + per-card scripts)
// can play it. Produces:
//   docs/rules-coverage.json  — machine-readable snapshot (buckets + histogram)
//   docs/RULES-COVERAGE.md     — human tracking doc (the batch backlog)
//
// Buckets (Jason's three categories):
//   covered  — fully playable now: vanilla, keyword-only, a per-card script, or
//              oracle text that fully compiles to real effect ops.
//   shared   — NOT covered, but its unmodeled clause is shared by many cards, so
//              one new compiler rule ("shared rule") fixes the whole cluster.
//   custom   — NOT covered, and its unmodeled clause is rare/unique, so it likely
//              needs its own per-card script.
//
// Reproduce:  bash tools/coverage.sh    (exports from Postgres, then runs this)
// Or:         node tools/coverage.mjs /tmp/cards.jsonl
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const eff = require(join(ROOT, "shared/dist/effects.js"));
const scr = require(join(ROOT, "shared/dist/cardScripts.js"));

const inputPath = process.argv[2] || "/tmp/cards.jsonl";
const SHARED_THRESHOLD = 8; // an unmodeled clause seen >= this many times = "shared rule" candidate

// Keywords the engine already understands (combat math, static play). A card whose
// only rules text is these keywords is playable today. Keep this list honest — it
// drives the "covered" count. Update it as the engine gains keyword handling.
const KW_OK = new Set(
  [
    "flying", "reach", "first strike", "double strike", "deathtouch", "lifelink",
    "trample", "vigilance", "menace", "haste", "defender", "indestructible",
    "hexproof", "shroud", "infect", "toxic", "flash", "ward", "protection",
  ].map((k) => k.toLowerCase()),
);

// ---- text helpers -------------------------------------------------------
function stripReminder(t) {
  return t.replace(/\([^)]*\)/g, " ");
}
function clauses(text) {
  // Split a card's rules text into individual clauses (by newline and sentence).
  return stripReminder(text)
    .split(/\n|(?<=[.!])\s+/)
    .map((c) => c.trim())
    .filter(Boolean);
}
function isKeywordClause(c) {
  // "Flying", "Trample, haste", "First strike" etc. — comma-separated keyword lists.
  const parts = c.toLowerCase().replace(/\.$/, "").split(/,|\band\b/).map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return false;
  return parts.every((p) => KW_OK.has(p) || [...KW_OK].some((k) => p === k));
}
function normalizeClause(name, c) {
  let n = " " + c.toLowerCase() + " ";
  if (name) n = n.split(name.toLowerCase()).join(" ~ ");
  return n
    .replace(/\{[^}]+\}/g, "{M}")
    .replace(/\b\d+\b/g, "N")
    .replace(/[’']s\b/g, "s")
    .replace(/[.,;:"“”]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ---- per-card classification -------------------------------------------
function opsOf(compiled) {
  if (!compiled) return [];
  if (compiled.modes) return compiled.modes.flatMap((m) => m.ops || []);
  return compiled.ops || [];
}
function compileAll(name, type_line, text) {
  // Union of ops the engine would produce for this card across the relevant hooks.
  const t = type_line || "";
  const isSpell = /Instant|Sorcery/.test(t);
  const ops = [];
  try {
    if (isSpell) ops.push(...opsOf(eff.compileEffects(text, name)));
    else {
      ops.push(...opsOf(eff.compileEtbEffects(text, name)));
      for (const tr of eff.compileTriggers(text, name) || []) ops.push(...opsOf(tr.effect));
      for (const ab of eff.parseAbilities(text, name) || []) ops.push(...opsOf(ab.effect));
    }
  } catch {
    /* compiler threw — treat as no ops */
  }
  return ops;
}

const lines = readFileSync(inputPath, "utf8").split("\n").filter((l) => l.trim());
const buckets = { covered: 0, shared: 0, custom: 0 };
const coveredBy = { vanilla: 0, keyword: 0, script: 0, compiled: 0 };
const unmodeled = new Map(); // normalized clause -> { count, example, cards:Set }
let partial = 0;

for (const line of lines) {
  let card;
  try {
    card = JSON.parse(line);
  } catch {
    continue;
  }
  const name = card.name || "";
  const rawText = (card.oracle_text || "").replace(/\\n/g, "\n");
  const clean = stripReminder(rawText).trim();

  // Vanilla (no rules text): basic lands, French-vanilla handled below.
  if (!clean) {
    buckets.covered++;
    coveredBy.vanilla++;
    continue;
  }
  // Per-card script overrides everything.
  if (scr.scriptFor(name)) {
    buckets.covered++;
    coveredBy.script++;
    continue;
  }

  const cs = clauses(rawText);
  const ops = compileAll(name, card.type_line, rawText);
  const hasReal = ops.some((o) => o.op !== "manual");

  // Which clauses are NOT modeled? A clause is modeled if it is an engine keyword,
  // or compileText() matches it to a non-manual op.
  const unmodeledClauses = [];
  for (const c of cs) {
    if (isKeywordClause(c)) continue;
    let matched = false;
    try {
      const r = eff.compileText(c);
      matched = (r.matched || r.modes) && opsOf(r).some((o) => o.op !== "manual");
    } catch {
      matched = false;
    }
    if (!matched) unmodeledClauses.push(c);
  }

  if (unmodeledClauses.length === 0) {
    buckets.covered++;
    coveredBy.compiled++;
    continue;
  }

  // Not fully covered. Record each unmodeled clause in the histogram.
  if (hasReal) partial++;
  for (const c of unmodeledClauses) {
    const key = normalizeClause(name, c);
    if (!key) continue;
    let rec = unmodeled.get(key);
    if (!rec) {
      rec = { count: 0, example: c, cards: new Set() };
      unmodeled.set(key, rec);
    }
    rec.count++;
    if (rec.cards.size < 6) rec.cards.add(name);
  }
}

// A card is counted once as shared-or-custom by its *rarest-is-most-custom* clause:
// but for the top-line buckets we approximate by clause volume. Simpler + honest:
// classify each uncovered card by whether ANY of its unmodeled clauses is shared.
// Recompute card-level shared/custom using the finished histogram.
{
  const sharedKeys = new Set([...unmodeled.entries()].filter(([, r]) => r.count >= SHARED_THRESHOLD).map(([k]) => k));
  for (const line of lines) {
    let card;
    try {
      card = JSON.parse(line);
    } catch {
      continue;
    }
    const name = card.name || "";
    const rawText = (card.oracle_text || "").replace(/\\n/g, "\n");
    const clean = stripReminder(rawText).trim();
    if (!clean || scr.scriptFor(name)) continue;
    const cs = clauses(rawText);
    const um = [];
    for (const c of cs) {
      if (isKeywordClause(c)) continue;
      let matched = false;
      try {
        const r = eff.compileText(c);
        matched = (r.matched || r.modes) && opsOf(r).some((o) => o.op !== "manual");
      } catch {
        matched = false;
      }
      if (!matched) um.push(normalizeClause(name, c));
    }
    if (um.length === 0) continue;
    if (um.some((k) => sharedKeys.has(k))) buckets.shared++;
    else buckets.custom++;
  }
}

const total = lines.length;
const histogram = [...unmodeled.entries()]
  .map(([key, r]) => ({ key, count: r.count, example: r.example, cards: [...r.cards] }))
  .sort((a, b) => b.count - a.count);

const snapshot = {
  total,
  buckets,
  coveredBy,
  partial,
  distinctUnmodeledClauses: histogram.length,
  sharedThreshold: SHARED_THRESHOLD,
  scriptCount: scr.scriptCount(),
  topUnmodeled: histogram.slice(0, 120),
};
writeFileSync(join(ROOT, "docs/rules-coverage.json"), JSON.stringify(snapshot, null, 2));

// ---- markdown tracking doc ---------------------------------------------
const pct = (n) => ((n / total) * 100).toFixed(1) + "%";
const md = [];
md.push("# Rules coverage tracker");
md.push("");
md.push("_Auto-generated by `tools/coverage.mjs`. Regenerate with `bash tools/coverage.sh`._");
md.push("");
md.push(`**${total.toLocaleString()} distinct cards** (by oracle id).`);
md.push("");
md.push("| Bucket | Cards | Share | Meaning |");
md.push("|---|---:|---:|---|");
md.push(`| ✅ Covered | ${buckets.covered.toLocaleString()} | ${pct(buckets.covered)} | Fully playable now |`);
md.push(`| 🔗 Shared-rule needed | ${buckets.shared.toLocaleString()} | ${pct(buckets.shared)} | Clause shared by ≥${SHARED_THRESHOLD} cards — one rule fixes many |`);
md.push(`| 🧩 Custom-rule needed | ${buckets.custom.toLocaleString()} | ${pct(buckets.custom)} | Rare/unique clause — likely a per-card script |`);
md.push("");
md.push(`Covered breakdown: vanilla ${coveredBy.vanilla.toLocaleString()}, keyword-only ${coveredBy.keyword.toLocaleString()}, per-card script ${coveredBy.script.toLocaleString()}, fully compiled ${coveredBy.compiled.toLocaleString()}. Partially-modeled cards (some effect works, some clause missing): ${partial.toLocaleString()}. Distinct unmodeled clause templates: ${histogram.length.toLocaleString()}.`);
md.push("");
md.push("## Backlog — top unmodeled clauses (attack these first; each covers the most cards)");
md.push("");
md.push("| # | Cards | Template | Examples |");
md.push("|---:|---:|---|---|");
histogram.slice(0, 60).forEach((h, i) => {
  const ex = h.cards.slice(0, 3).join(", ");
  const tmpl = h.example.replace(/\|/g, "\\|").slice(0, 90);
  md.push(`| ${i + 1} | ${h.count} | ${tmpl} | ${ex} |`);
});
md.push("");
writeFileSync(join(ROOT, "docs/RULES-COVERAGE.md"), md.join("\n"));

console.log(`cards=${total} covered=${buckets.covered} (${pct(buckets.covered)}) shared=${buckets.shared} custom=${buckets.custom} clauses=${histogram.length}`);
console.log("wrote docs/rules-coverage.json + docs/RULES-COVERAGE.md");
