// Builds client/public/rulings-issues.json for the rulings wizard:
//   - the authored mechanic ISSUES (tools/rulings-data.mjs), each with a live
//     card count + example cards (name + image) pulled from card_rules, and
//   - the top long-tail clause templates NOT covered by an authored mechanic,
//     appended as extra issues (empty candidates → owner writes the ruling),
//     up to TOTAL issues so we cover the whole meaningful backlog.
//
// Run:  node tools/gen-rulings.mjs
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { ISSUES } from "./rulings-data.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const TMP = "/tmp/rulings_rows.jsonl";
const TOTAL = 251; // target number of issues (authored + long-tail)
const EX = 16; // example cards per issue

console.log("Exporting blocked/partial cards…");
execSync(
  `docker exec mtg-postgres psql -U mtg -d mtg -tA -c "
     SELECT json_build_object('name',cr.name,'unmodeled',cr.unmodeled,'img',img.url)
     FROM card_rules cr
     LEFT JOIN LATERAL (
       SELECT coalesce(image_normal, image_art_crop) url FROM cards c
       WHERE c.oracle_id = cr.oracle_id AND coalesce(image_normal, image_art_crop) IS NOT NULL
       ORDER BY released_at DESC NULLS LAST LIMIT 1
     ) img ON true
     WHERE cr.status IN ('blocked','partial') AND jsonb_array_length(cr.unmodeled) > 0
   " > ${TMP}`,
  { shell: "/bin/bash", stdio: "inherit" },
);
const rows = readFileSync(TMP, "utf8").split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
console.log(`  ${rows.length} cards`);

const norm = (name, c) => {
  let n = " " + c.toLowerCase() + " ";
  if (name) n = n.split(name.toLowerCase()).join(" ~ ");
  return n.replace(/\{[^}]+\}/g, "{M}").replace(/\b\d+\b/g, "N").replace(/[’']s\b/g, "s").replace(/[.,;:"“”]/g, " ").replace(/\s+/g, " ").trim();
};

// --- authored issues: count + examples, and mark matched clauses -----------
const authored = ISSUES.map((iss) => ({ ...iss, match: undefined, count: 0, examples: [] }));
const matchedTemplateKeys = new Set();

for (const r of rows) {
  const seenIssue = new Set();
  for (const c of r.unmodeled || []) {
    for (let i = 0; i < ISSUES.length; i++) {
      if (!ISSUES[i].match.test(c)) continue;
      matchedTemplateKeys.add(norm(r.name, c));
      if (seenIssue.has(i)) continue;
      seenIssue.add(i);
      authored[i].count++;
      if (authored[i].examples.length < EX && r.img) authored[i].examples.push({ name: r.name, img: r.img });
    }
  }
}

// --- long-tail templates not covered by any authored mechanic --------------
const tmpl = new Map();
for (const r of rows) {
  const seen = new Set();
  for (const c of r.unmodeled || []) {
    if (ISSUES.some((iss) => iss.match.test(c))) continue; // covered by a mechanic
    const key = norm(r.name, c);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    let t = tmpl.get(key);
    if (!t) { t = { example: c, count: 0, examples: [] }; tmpl.set(key, t); }
    t.count++;
    if (t.examples.length < EX && r.img) t.examples.push({ name: r.name, img: r.img });
  }
}

const authoredSorted = authored.sort((a, b) => b.count - a.count);
const longtail = [...tmpl.entries()].sort((a, b) => b[1].count - a[1].count);

const issues = [];
const usedIds = new Set();
// Ensure ids are unique and non-empty; a clause of only mana symbols/numbers
// would otherwise slug to "" (collapsing every such clause onto one "cl-" id).
const uniqueId = (base) => {
  let id = base && base !== "cl-" ? base : "cl-clause";
  if (!usedIds.has(id)) { usedIds.add(id); return id; }
  for (let n = 2; ; n++) { const cand = `${id}-${n}`; if (!usedIds.has(cand)) { usedIds.add(cand); return cand; } }
};
for (const a of authoredSorted) {
  usedIds.add(a.id);
  issues.push({ id: a.id, title: a.title, blurb: a.blurb, count: a.count, examples: a.examples, candidates: a.candidates, recommended: a.recommended, kind: "mechanic" });
}
for (const [key, t] of longtail) {
  if (issues.length >= TOTAL) break;
  // Stable id derived from the normalized clause template, so re-generating (to
  // fill in candidate guesses) preserves any answers already saved for it.
  const id = uniqueId("cl-" + key.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 52));
  issues.push({
    id,
    title: t.example.replace(/\s+/g, " ").slice(0, 90),
    blurb: `${t.count} card${t.count === 1 ? "" : "s"} share this clause.`,
    count: t.count,
    examples: t.examples,
    candidates: [],
    recommended: null,
    kind: "clause",
  });
}

const out = { generated: new Date().toISOString().slice(0, 10), total: issues.length, issues };
writeFileSync(join(ROOT, "client/public/rulings-issues.json"), JSON.stringify(out));
console.log(`Wrote client/public/rulings-issues.json`);
console.log(`  ${issues.length} issues (${authored.length} authored mechanics + ${issues.length - authored.length} long-tail)`);
console.log(`  top: ${authoredSorted.slice(0, 3).map((a) => `${a.title}=${a.count}`).join(", ")}`);
