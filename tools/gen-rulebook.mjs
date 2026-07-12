// Rulebook generator. Parses docs/comprehensive-rules.txt into a clean, searchable
// JSON structure the in-app Rulebook modal loads lazily. Written to
// client/public/rulebook.json (bundled with the client; docs/ is dockerignored).
//
// Run:  node tools/gen-rulebook.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const text = readFileSync(join(ROOT, "docs/comprehensive-rules.txt"), "utf8").replace(/^﻿/, "");
const lines = text.split(/\r?\n/);

const effMatch = text.match(/effective as of ([^.]+)\./i);
const effective = effMatch ? effMatch[1].trim() : "";

// The document has a Contents (TOC) block, then the real rules, then Glossary,
// then Credits. Locate the *last* occurrence of each landmark = the real one.
const lastIndexOf = (re) => { let idx = -1; lines.forEach((l, i) => { if (re.test(l)) idx = i; }); return idx; };
const rulesStart = lastIndexOf(/^1\.\s+Game Concepts\s*$/);
const glossaryStart = lastIndexOf(/^Glossary\s*$/);
const creditsStart = lastIndexOf(/^Credits\s*$/);

// --- parse numbered rules ---------------------------------------------------
const sections = [];
let section = null;
let subsection = null;
let rule = null;

for (let i = rulesStart; i < glossaryStart; i++) {
  const line = lines[i];
  if (line == null) continue;
  const t = line.trimEnd();
  if (!t.trim()) { rule = null; continue; }

  let m;
  if ((m = t.match(/^(\d{3}\.\d+[a-z]?)\.?\s+(.*)$/))) {
    // a rule / subrule
    rule = { n: m[1], text: m[2] };
    subsection?.rules.push(rule);
  } else if ((m = t.match(/^(\d{3})\.\s+(\S.*)$/))) {
    // a subsection header, e.g. "100. General"
    subsection = { id: m[1], title: m[2], rules: [] };
    section?.subsections.push(subsection);
    rule = null;
  } else if ((m = t.match(/^([1-9])\.\s+(\S.*)$/))) {
    // a top-level section, e.g. "1. Game Concepts"
    section = { id: m[1], title: m[2], subsections: [] };
    sections.push(section);
    subsection = null;
    rule = null;
  } else if (rule) {
    // continuation / example line under the current rule
    rule.text += "\n" + t.trim();
  }
}

// --- parse glossary ---------------------------------------------------------
const glossary = [];
if (glossaryStart >= 0 && creditsStart > glossaryStart) {
  const block = lines.slice(glossaryStart + 1, creditsStart).join("\n").trim();
  for (const entry of block.split(/\n\s*\n/)) {
    const parts = entry.split("\n");
    const term = (parts.shift() || "").trim();
    const def = parts.join(" ").trim();
    if (term && def) glossary.push({ term, def });
  }
}

const out = { effective, sections, glossary };
const ruleCount = sections.reduce((n, s) => n + s.subsections.reduce((m, ss) => m + ss.rules.length, 0), 0);
const outPath = join(ROOT, "client/public/rulebook.json");
writeFileSync(outPath, JSON.stringify(out));
console.log(`Wrote ${outPath}`);
console.log(`  sections ${sections.length}, rules ${ruleCount}, glossary terms ${glossary.length}, effective ${effective}`);
