// Art/demo & non-playable-object REVIEW LIST generator.
//
// The user asked to weed out "cards with no text, just art/name" (art/demo
// cards we don't want). But "no oracle text" does NOT mean "art card" — basic
// lands and vanilla creatures (e.g. Grizzly Bears) are real, playable cards
// with no rules text. So this tool does NOT delete anything; it produces a
// reviewable HTML page (with pictures) of *discard candidates*, split into
// clearly-labelled categories, for Jason to verify before any removal.
//
// Categories (all distinct by oracle_id, one representative printing each):
//   1. art_series  — Scryfall "Art Series" cards ("X // X", type "Card // Card")
//   2. tokens      — token / double_faced_token objects (made via the token
//                    drawer in play, not deck cards)
//   3. placeholder — helper objects with type_line "Card" (Poison Counter,
//                    Red Mana, Storm Counter, …) — not real game cards
//
// KEPT (not shown here): normal-layout no-text cards = basic lands + vanilla
// creatures. Those are legitimate and stay.
//
// Run:  node tools/review-art-demo.mjs
// Out:  docs/review/art-demo-candidates.html
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(ROOT, "docs/review");

function query(sql) {
  const out = execFileSync(
    "docker",
    ["exec", "-i", "mtg-postgres", "psql", "-U", "mtg", "-d", "mtg", "-t", "-A", "-c", sql],
    { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 },
  ).trim();
  return out ? JSON.parse(out) : [];
}

// One representative printing per card, preferring one that actually has an image.
function categoryRows(filter) {
  return query(`
    SELECT coalesce(json_agg(row_to_json(t)), '[]') FROM (
      SELECT DISTINCT ON (coalesce(oracle_id::text, name))
        name, set_code, set_name, type_line, image_art_crop, image_normal
      FROM cards
      WHERE ${filter}
      ORDER BY coalesce(oracle_id::text, name),
               (image_art_crop IS NOT NULL OR image_normal IS NOT NULL) DESC,
               released_at DESC NULLS LAST
    ) t
  `);
}

const categories = [
  {
    id: "art_series",
    title: "Art Series cards",
    blurb:
      "Scryfall &ldquo;Art Series&rdquo; printings (oversized art, type line &ldquo;Card // Card&rdquo;). Not playable Magic cards. Recommended: discard.",
    filter: "layout = 'art_series'",
  },
  {
    id: "placeholder",
    title: "Placeholder / helper objects",
    blurb:
      "Objects with type line &ldquo;Card&rdquo; (Poison Counter, Red Mana, Storm Counter, substitute cards). Not real game cards. Recommended: discard.",
    filter:
      "layout NOT IN ('art_series','token','double_faced_token') AND (type_line = 'Card' OR type_line ILIKE 'Card // Card')",
  },
  {
    id: "tokens",
    title: "Token objects",
    blurb:
      "Token / double-faced-token printings. In this app tokens are created via the token drawer during play, not shuffled into decks &mdash; so they don't need per-card deck rules. Review: keep as token art, but exclude from the card-authoring pool?",
    filter: "layout IN ('token','double_faced_token')",
  },
];

function esc(s) {
  return String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

function cardCell(c) {
  const img = c.image_art_crop || c.image_normal || "";
  const imgTag = img
    ? `<img loading="lazy" src="${esc(img)}" alt="${esc(c.name)}">`
    : `<div class="noimg">no image</div>`;
  return `<figure>${imgTag}<figcaption><b>${esc(c.name)}</b><span>${esc(c.type_line)}</span><span class="set">${esc(c.set_code?.toUpperCase())} · ${esc(c.set_name)}</span></figcaption></figure>`;
}

const sections = categories.map((cat) => {
  const rows = categoryRows(cat.filter);
  return { cat, rows };
});

const total = sections.reduce((n, s) => n + s.rows.length, 0);
const stamp = execFileSync("date", ["-u", "+%Y-%m-%d %H:%M UTC"], { encoding: "utf8" }).trim();

const nav = sections
  .map((s) => `<a href="#${s.cat.id}">${esc(s.cat.title)} <b>(${s.rows.length})</b></a>`)
  .join("");

const body = sections
  .map(
    (s) => `
<section id="${s.cat.id}">
  <h2>${esc(s.cat.title)} <span class="count">${s.rows.length}</span></h2>
  <p class="blurb">${s.cat.blurb}</p>
  <div class="grid">${s.rows.map(cardCell).join("")}</div>
</section>`,
  )
  .join("\n");

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Card pool — art/demo discard candidates for review</title>
<style>
  :root { color-scheme: dark; }
  body { margin:0; font:15px/1.4 system-ui,sans-serif; background:#14140f; color:#e9e6dc; }
  header { padding:20px 24px; border-bottom:1px solid #33322a; position:sticky; top:0; background:#14140fee; backdrop-filter:blur(4px); z-index:2; }
  h1 { margin:0 0 6px; font-size:20px; }
  .meta { color:#9c9885; font-size:13px; }
  nav { margin-top:12px; display:flex; gap:8px; flex-wrap:wrap; }
  nav a { text-decoration:none; color:#e9e6dc; background:#26251c; padding:6px 12px; border-radius:6px; border:1px solid #3a3930; font-size:13px; }
  nav a b { color:#e0b34d; }
  section { padding:20px 24px; border-bottom:1px solid #262519; }
  h2 { font-size:17px; display:flex; align-items:center; gap:10px; }
  .count { background:#e0b34d; color:#14140f; border-radius:20px; padding:1px 10px; font-size:13px; font-weight:700; }
  .blurb { color:#b6b2a1; max-width:70ch; margin:2px 0 16px; }
  .grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(150px,1fr)); gap:12px; }
  figure { margin:0; background:#1e1d15; border:1px solid #33322a; border-radius:8px; overflow:hidden; }
  figure img { width:100%; display:block; aspect-ratio:626/457; object-fit:cover; background:#000; }
  .noimg { aspect-ratio:626/457; display:flex; align-items:center; justify-content:center; color:#6b6857; background:#111; font-size:12px; }
  figcaption { padding:7px 9px; font-size:12px; display:flex; flex-direction:column; gap:2px; }
  figcaption span { color:#9c9885; }
  figcaption .set { font-size:11px; color:#736f5f; }
</style></head><body>
<header>
  <h1>Card pool cleanup — discard candidates for review</h1>
  <div class="meta">${total.toLocaleString()} candidates across ${sections.length} categories · generated ${stamp}</div>
  <div class="meta">Nothing has been deleted. These are <b>candidates</b> only — confirm which categories to remove. Basic lands &amp; vanilla creatures (no text but real cards) are NOT listed here and will be kept.</div>
  <nav>${nav}</nav>
</header>
${body}
</body></html>`;

mkdirSync(OUT_DIR, { recursive: true });
const outPath = join(OUT_DIR, "art-demo-candidates.html");
writeFileSync(outPath, html);
console.log(`Wrote ${outPath}`);
for (const s of sections) console.log(`  ${s.cat.id.padEnd(12)} ${s.rows.length}`);
console.log(`  ${"TOTAL".padEnd(12)} ${total}`);
