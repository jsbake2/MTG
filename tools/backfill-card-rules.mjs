// Deterministic card-rules backfill (C3 bulk, phase 1).
//
// Runs the EXISTING shared effect compiler over every real card and populates
// the card_rules table with: behaviour tags, compiled EffectOp lists per hook,
// a coverage status, and the list of clauses it could NOT model (which drives
// the blocked-cards review report). Zero LLM cost — pure deterministic reuse of
// the compiler that already backs the 22.9% coverage number.
//
// This is phase 1 of "both, in order": the deterministic bulk pass. The exotic
// tail (status='blocked'/'partial') is what the later multi-agent workflow and
// hand-authoring attack.
//
// Prereqs: mtg-postgres up; shared built (npm run build in shared/).
// Run:  node tools/backfill-card-rules.mjs
import { execFileSync, execSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { ISSUES } from "./rulings-data.mjs";

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const eff = require(join(ROOT, "shared/dist/effects.js"));
const scr = require(join(ROOT, "shared/dist/cardScripts.js"));
const vocab = require(join(ROOT, "shared/dist/tags.generated.js"));
const KW = new Set(vocab.KEYWORD_ABILITIES);

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");

// --- export real cards (one representative printing per oracle_id) ----------
const CARDS = "/tmp/cards_full.jsonl";
console.log("Exporting cards from Postgres…");
// NOTE: use a plain SELECT with -tA, NOT `COPY ... TO STDOUT`. COPY's text
// format backslash-escapes the JSON (turning \" into \\" ), which corrupts any
// record whose oracle_text contains a quote or newline. Plain psql output does
// not escape, and json_build_object already escapes newlines, so each card is
// exactly one valid JSON line. (tools/coverage.sh has this COPY bug — it silently
// drops ~2.2k quote-bearing cards; fix separately.)
execSync(
  `docker exec mtg-postgres psql -U mtg -d mtg -tA -c "
     SELECT json_build_object('oracle_id',oracle_id,'name',name,'type_line',type_line,
       'card_types',card_types,'keywords',keywords,'oracle_text',coalesce(oracle_text,''))
     FROM (SELECT DISTINCT ON (oracle_id) * FROM cards
           WHERE oracle_id IS NOT NULL AND layout <> 'art_series'
             AND type_line NOT IN ('Card','Card // Card')
           ORDER BY oracle_id, (oracle_text IS NOT NULL) DESC, released_at DESC NULLS LAST) s
   " > ${CARDS}`,
  { shell: "/bin/bash", stdio: "inherit" },
);
const lines = readFileSync(CARDS, "utf8").split("\n").filter((l) => l.trim());
console.log(`  ${lines.length} cards`);

// --- compiler-coverage helpers (mirror tools/coverage.mjs) ------------------
const stripReminder = (t) => t.replace(/\([^)]*\)/g, " ");
const clauses = (t) => stripReminder(t).split(/\n|(?<=[.!])\s+/).map((c) => c.trim()).filter(Boolean);
function isKeywordClause(c) {
  const parts = c.toLowerCase().replace(/\.$/, "").split(/,|\band\b/).map((p) => p.trim()).filter(Boolean);
  return parts.length > 0 && parts.every((p) => KW.has(slug(p)));
}
const opsOf = (compiled) => (!compiled ? [] : compiled.modes ? compiled.modes.flatMap((m) => m.ops || []) : compiled.ops || []);

const OP_TAG = {
  draw: "draw", damage: "damage", mass_damage: "damage", gain_life: "lifegain", lose_life: "lifeloss",
  destroy: "destroy", mass_destroy: "destroy", exile: "exile", mass_exile: "exile", bounce: "bounce",
  counter: "counter", tap: "tap", tap_all: "tap", untap: "untap", plus_counter: "counters",
  mass_counter: "counters", pump: "pump", mass_pump: "pump", grant: "grant_keyword", mass_grant: "grant_keyword",
  gain_control: "steal", tuck: "tuck", add_mana: "mana", token: "token", mill: "mill", manual: "needs_review",
};

// --- classify + compile one card -------------------------------------------
function process(card) {
  const name = card.name || "";
  const type = card.type_line || "";
  const rawText = (card.oracle_text || "").replace(/\\n/g, "\n");
  const clean = stripReminder(rawText).trim();
  const isSpell = /Instant|Sorcery/.test(type);

  const tags = new Set();
  for (const k of card.keywords || []) if (KW.has(slug(k))) tags.add(slug(k));

  let ops = [], etb = [], triggers = [], abilities = [], modes = null;
  if (isSpell) {
    const c = eff.compileEffects(rawText, name);
    ops = c.ops || [];
    if (c.modes) modes = c.modes;
  } else {
    etb = opsOf(eff.compileEtbEffects(rawText, name));
    triggers = (eff.compileTriggers(rawText, name) || []).map((t) => ({ event: t.event, ops: opsOf(t.effect) }));
    abilities = (eff.parseAbilities(rawText, name) || []).map((a) => ({ cost: a.cost, mana: a.mana, needsTap: a.needsTap, ops: opsOf(a.effect) }));
  }
  const allOps = [...ops, ...etb, ...triggers.flatMap((t) => t.ops), ...abilities.flatMap((a) => a.ops), ...(modes ? modes.flatMap((m) => m.ops || []) : [])];
  for (const o of allOps) if (OP_TAG[o.op]) tags.add(OP_TAG[o.op]);

  // Static continuous effects (auras/equipment/anthems) — CR 613 layer engine.
  const statics = eff.compileStatic(rawText, name);
  for (const s of statics) {
    tags.add(s.scope === "anthem" ? "anthem" : "aura_grant");
    if (s.power || s.toughness) tags.add("buff");
    for (const k of s.keywords) tags.add(slug(k));
  }
  // Enters-tapped replacement (CR 614) — engine auto-taps on entry.
  const entersTapped = /enters? (?:the battlefield )?tapped/i.test(clean) && !/tapped[^.]*\bunless\b|you may|may have/i.test(clean);
  if (entersTapped) tags.add("enters_tapped");

  // Owner-ruled mechanics (tools/rulings-data.mjs). A clause matching one is a
  // decided/known behaviour: tag it and count it modeled (hybrid — the engine or
  // the player performs it per the ruling in docs/guided-rulings-resolved.md).
  for (const iss of ISSUES) if (iss.match.test(clean)) tags.add("m:" + iss.id);

  // unmodeled clauses (a clause is modeled if it compiles to a real op OR is a
  // recognized static continuous effect)
  const unmodeled = [];
  for (const c of clauses(rawText)) {
    if (isKeywordClause(c)) continue;
    let matched = false;
    try {
      const r = eff.compileText(c);
      matched = (r.matched || r.modes) && opsOf(r).some((o) => o.op !== "manual");
      if (!matched && eff.compileStatic(c, name).length > 0) matched = true;
      if (!matched && /enters? (?:the battlefield )?tapped/i.test(c) && !/\bunless\b|you may|may have/i.test(c)) matched = true;
      // "Enchant creature/permanent/..." — keyword ability (CR 702.5), an attachment
      // restriction the framework enforces on cast/attach, not a resolution effect.
      if (!matched && /^enchant\b/i.test(c.trim())) matched = true;
      // Owner-ruled mechanic clause = decided behaviour, count as modeled.
      if (!matched && ISSUES.some((iss) => iss.match.test(c))) matched = true;
      // Activated-ability line "cost: effect" — parseAbilities handles it, but this
      // per-clause check sees the cost prefix; strip it and test the effect part.
      if (!matched && c.includes(":")) {
        const head = c.slice(0, c.indexOf(":")).trim().toLowerCase();
        if (head.length <= 30 && !/^(when|whenever|at |if |choose|level up|equip|enchant)/.test(head)) {
          const eff2 = eff.compileText(c.slice(c.indexOf(":") + 1));
          if ((eff2.matched || eff2.modes) && opsOf(eff2).some((o) => o.op !== "manual")) matched = true;
        }
      }
    } catch { matched = false; }
    if (!matched) unmodeled.push(c);
  }

  const hasReal = allOps.some((o) => o.op !== "manual") || statics.length > 0;
  let status, coverage;
  if (!clean) { status = "vanilla"; coverage = "vanilla"; }
  else if (scr.scriptFor(name)) { status = "covered"; coverage = "script"; }
  else if (unmodeled.length === 0) { status = "covered"; coverage = allOps.length ? "compiled" : "keyword"; }
  else if (hasReal) { status = "partial"; coverage = "compiled"; }
  else { status = "blocked"; coverage = null; }

  const source = scr.scriptFor(name) ? "script" : "compiler";
  return {
    oracle_id: card.oracle_id, name, status, coverage, source,
    tags: [...tags], ops, etb, triggers, abilities, modes, unmodeled,
  };
}

// --- compute all + load via psql COPY into a temp table, then upsert --------
const rows = [];
const hist = { vanilla: 0, covered: 0, partial: 0, blocked: 0 };
for (const line of lines) {
  let card;
  try { card = JSON.parse(line); } catch { continue; }
  const r = process(card);
  hist[r.status] = (hist[r.status] || 0) + 1;
  rows.push('"' + JSON.stringify(r).replaceAll('"', '""') + '"');
}

const LOAD = "/tmp/load_card_rules.sql";
writeFileSync(LOAD, `\\set ON_ERROR_STOP on
BEGIN;
CREATE TEMP TABLE _load(data jsonb) ON COMMIT DROP;
COPY _load(data) FROM STDIN WITH (FORMAT csv, QUOTE '"');
${rows.join("\n")}
\\.
INSERT INTO card_rules (oracle_id,name,status,coverage,source,tags,ops,etb,triggers,abilities,modes,unmodeled,version,updated_at)
SELECT (data->>'oracle_id')::uuid, data->>'name', data->>'status', data->>'coverage', data->>'source',
       ARRAY(SELECT jsonb_array_elements_text(data->'tags')),
       data->'ops', data->'etb', data->'triggers', data->'abilities',
       CASE WHEN data->'modes' = 'null'::jsonb THEN NULL ELSE data->'modes' END,
       data->'unmodeled', 1, now()
FROM _load
ON CONFLICT (oracle_id) DO UPDATE SET
  name=EXCLUDED.name, status=EXCLUDED.status, coverage=EXCLUDED.coverage, source=EXCLUDED.source,
  tags=EXCLUDED.tags, ops=EXCLUDED.ops, etb=EXCLUDED.etb, triggers=EXCLUDED.triggers,
  abilities=EXCLUDED.abilities, modes=EXCLUDED.modes, unmodeled=EXCLUDED.unmodeled,
  version=card_rules.version+1, updated_at=now();
COMMIT;
`);
console.log(`Loading ${rows.length} rows into card_rules…`);
execSync(`cat ${LOAD} | docker exec -i mtg-postgres psql -U mtg -d mtg -q`, { shell: "/bin/bash", stdio: "inherit" });

const total = rows.length;
const pct = (n) => ((n / total) * 100).toFixed(1) + "%";
console.log("\nStatus histogram:");
for (const [k, v] of Object.entries(hist)) console.log(`  ${k.padEnd(9)} ${String(v).padStart(6)}  ${pct(v)}`);
console.log(`  ${"TOTAL".padEnd(9)} ${String(total).padStart(6)}`);
