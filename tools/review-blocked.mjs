// Blocked / backlog REVIEW REPORT (item #6).
//
// Renders the cards the deterministic compiler can't yet fully model, GROUPED BY
// their unmodeled clause template — so the shape of the remaining work is visible
// and answering one clause resolves a whole cluster (Jason's review insight).
// Each group shows the clause template, how many cards share it, and a gallery of
// example cards with pictures.
//
// This is the authoring backlog (status blocked/partial), not a "cards I don't
// understand" list — that smaller set is produced during authoring itself.
//
// Run:  node tools/review-blocked.mjs
// Out:  docs/review/blocked-backlog.html
import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(ROOT, "docs/review");
const TMP = "/tmp/blocked_rows.jsonl";
const TOP_TEMPLATES = 250; // groups to render
const EXAMPLES_PER = 8; // card thumbnails per group

// Plain SELECT (not COPY — avoids the backslash-escape JSON corruption).
console.log("Exporting blocked/partial cards…");
execSync(
  `docker exec mtg-postgres psql -U mtg -d mtg -tA -c "
     SELECT json_build_object('name',cr.name,'status',cr.status,'unmodeled',cr.unmodeled,'img',img.url)
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

// Normalize a clause into a template key (mirrors tools/coverage.mjs).
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

const groups = new Map(); // key -> { example, count, cards:[{name,img,status}] }
let cardCount = 0;
for (const line of readFileSync(TMP, "utf8").split("\n").filter((l) => l.trim())) {
  let row;
  try { row = JSON.parse(line); } catch { continue; }
  cardCount++;
  const seenKeys = new Set();
  for (const clause of row.unmodeled || []) {
    const key = normalizeClause(row.name, clause);
    if (!key || seenKeys.has(key)) continue;
    seenKeys.add(key);
    let g = groups.get(key);
    if (!g) { g = { example: clause, count: 0, cards: [] }; groups.set(key, g); }
    g.count++;
    if (g.cards.length < EXAMPLES_PER) g.cards.push({ name: row.name, img: row.img, status: row.status });
  }
}

const sorted = [...groups.values()].sort((a, b) => b.count - a.count);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function cardCell(c) {
  const img = c.img ? `<img loading="lazy" src="${esc(c.img)}" alt="${esc(c.name)}">` : `<div class="noimg">no image</div>`;
  return `<figure class="${c.status}">${img}<figcaption>${esc(c.name)}</figcaption></figure>`;
}

const shown = sorted.slice(0, TOP_TEMPLATES);
const groupHtml = shown
  .map(
    (g, i) => `
  <section class="group">
    <h3><span class="rank">#${i + 1}</span> <span class="cnt">${g.count} card${g.count === 1 ? "" : "s"}</span></h3>
    <p class="clause">${esc(g.example)}</p>
    <div class="grid">${g.cards.map(cardCell).join("")}</div>
  </section>`,
  )
  .join("\n");

const stamp = execSync("date -u +'%Y-%m-%d %H:%M UTC'", { shell: "/bin/bash" }).toString().trim();
const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Guided-rules authoring backlog — review</title>
<style>
  :root { color-scheme: dark; }
  body { margin:0; font:15px/1.45 system-ui,sans-serif; background:#14140f; color:#e9e6dc; }
  header { padding:20px 24px; border-bottom:1px solid #33322a; position:sticky; top:0; background:#14140fee; backdrop-filter:blur(4px); z-index:2; }
  h1 { margin:0 0 6px; font-size:20px; }
  .meta { color:#9c9885; font-size:13px; max-width:80ch; }
  .group { padding:16px 24px; border-bottom:1px solid #201f16; }
  h3 { margin:0 0 4px; font-size:15px; display:flex; align-items:center; gap:10px; }
  .rank { color:#736f5f; font-variant-numeric:tabular-nums; }
  .cnt { background:#e0b34d; color:#14140f; border-radius:20px; padding:1px 10px; font-size:12px; font-weight:700; }
  .clause { margin:2px 0 12px; color:#cfc9b4; font-family:ui-monospace,monospace; font-size:13px; background:#1c1b13; border:1px solid #2c2b20; border-radius:6px; padding:8px 10px; max-width:100ch; }
  .grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(120px,1fr)); gap:10px; max-width:1200px; }
  figure { margin:0; background:#1e1d15; border:1px solid #33322a; border-radius:8px; overflow:hidden; }
  figure.partial { border-color:#4a6b3a; }
  figure img { width:100%; display:block; aspect-ratio:63/88; object-fit:cover; background:#000; }
  .noimg { aspect-ratio:63/88; display:flex; align-items:center; justify-content:center; color:#6b6857; background:#111; font-size:11px; }
  figcaption { padding:5px 7px; font-size:11px; color:#c8c3b1; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
</style></head><body>
<header>
  <h1>Guided-rules authoring backlog</h1>
  <div class="meta">${cardCount.toLocaleString()} cards not yet fully modeled, grouped into ${groups.size.toLocaleString()} distinct clause templates. Showing the top ${shown.length}. Green border = partially working (some of the card already plays); no border = blocked. Each group = one rule/primitive to build; the count is how many cards it unlocks. Generated ${stamp}.</div>
  <div class="meta" style="margin-top:6px">This is the work queue, not a "please explain these" list — most are ordinary MTG mechanics I'll author against the engine. I'll surface a separate, smaller list of genuinely ambiguous cards during authoring.</div>
</header>
${groupHtml}
</body></html>`;

mkdirSync(OUT_DIR, { recursive: true });
const outPath = join(OUT_DIR, "blocked-backlog.html");
writeFileSync(outPath, html);
console.log(`Wrote ${outPath}`);
console.log(`  cards in backlog: ${cardCount}`);
console.log(`  distinct clause templates: ${groups.size}`);
console.log(`  top template: "${sorted[0]?.example}" (${sorted[0]?.count} cards)`);
