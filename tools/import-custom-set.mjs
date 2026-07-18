#!/usr/bin/env node
// Bulk-import a package of custom cards into a custom set, attaching each card's
// image as art. ART-GATED + RESUMABLE: it only imports cards it has art for, and
// is safe to run over and over as more art is generated — each run does just the
// delta (new cards get created, cards that just got art get it attached, cards
// already done are skipped). The server is the source of truth, so there's no
// local state to get out of sync.
//
// PACKAGE LAYOUT (a folder you hand over):
//   my-set/
//     cards.json      (or cards.csv)   — the card data (schema below)
//     images/         — art files (a sibling folder, or images in the same dir)
//
// Art is matched to a card by, in order: the card's explicit "image" field, its
// collector "number" (→ NNN_*.png), then its name (Tear's Guard ↔ 142_Tear_s_Guard.png).
//
// cards.json:
//   { "set": { "name": "Wheel of Time" },
//     "cards": [ { "name":"Rand al'Thor", "number":1, "manaCost":"3 W U",
//                  "types":"Legendary Creature — Human Channeler", "power":"4",
//                  "toughness":"5", "keywords":["Vigilance"], "oracle":"…",
//                  "flavor":"…", "rarity":"M", "frameTheme":"borderless",
//                  "image":"001_Rand.png" } ] }        // image optional if number/name matches
//
// cards.csv header: number,name,manaCost,types,power,toughness,loyalty,keywords,oracle,flavor,rarity,artist,frameTheme,image
//   keywords separated by "|".  image/number optional if the name matches a file.
//
// USAGE:
//   HUB=https://mtg.jsb-emr.us MTG_USER=jason MTG_PASS=… \
//     node tools/import-custom-set.mjs --dir ./my-set --images ~/mtg_wot_images [--set "Wheel of Time"]
//   flags: --dry (preview) --update (re-push card fields) --force-art (re-upload art even if present)
import { readFile, readdir } from "node:fs/promises";
import { join, extname, basename } from "node:path";

const args = Object.fromEntries(process.argv.slice(2).flatMap((a, i, arr) =>
  a.startsWith("--") ? [[a.slice(2), arr[i + 1] && !arr[i + 1].startsWith("--") ? arr[i + 1] : true]] : []));
const DIR = args.dir;
if (!DIR) { console.error("Missing --dir <package folder>"); process.exit(1); }
const IMAGE_DIRS = [args.images, join(DIR, "images"), DIR].filter(Boolean);
const HUB = process.env.HUB || "http://localhost:8477";
const USER = process.env.MTG_USER, PASS = process.env.MTG_PASS;
const DRY = !!args.dry, UPDATE = !!args.update, FORCE_ART = !!args["force-art"], ALL = !!args.all;

const IMG_EXT = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif"]);
const MIME = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".gif": "image/gif" };
const slug = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");

// "{3}{W}{U}" / "3WU" / "3 W U" -> Forge form "3 W U".
function normalizeMana(s) {
  if (!s) return "";
  s = String(s).trim();
  if (s.includes("{")) return (s.match(/\{([^}]+)\}/g) || []).map((t) => t.slice(1, -1)).join(" ");
  if (/\s/.test(s)) return s.replace(/\s+/g, " ");
  return (s.match(/\d+|[WUBRGCXwubrgcx]|./g) || []).join(" ").replace(/\s+/g, " ").trim();
}

function parseCsv(text) {
  const rows = []; let row = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; }
    else if (c === '"') q = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") { if (cell !== "" || row.length) { row.push(cell); rows.push(row); row = []; cell = ""; } if (c === "\r" && text[i + 1] === "\n") i++; }
    else cell += c;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  const header = rows.shift().map((h) => h.trim());
  return rows.filter((r) => r.some((x) => x.trim())).map((r) => Object.fromEntries(header.map((h, i) => [h, (r[i] ?? "").trim()])));
}

const RARITY = { common: "C", uncommon: "U", rare: "R", mythic: "M", special: "S", land: "L", basic: "L" };
function cardFromCsvRow(r) {
  // Support both the verbose WoT headers ("Card Name", "Mana Cost", …) and the
  // simple ones ("name", "manaCost", …).
  const g = (verbose, simple) => (r[verbose] ?? r[simple] ?? "");
  const [p, t] = String(g("Power/Toughness", "pt")).split("/").map((x) => x.trim());
  const rar = String(g("Rarity", "rarity") || "C");
  return {
    number: g("Card #", "number") ? Number(g("Card #", "number")) : null,
    // DFC cards are stored under their front-face name (server rejects "//").
    name: String(g("Card Name", "name")).split(" // ")[0].trim(),
    manaCost: g("Mana Cost", "manaCost"),
    types: g("Type Line", "types"),
    power: p || null, toughness: t || null, loyalty: null,
    keywords: String(g("Keywords", "keywords")).split(/[,|;]/).map((k) => k.trim()).filter(Boolean),
    oracle: g("Rules Text", "oracle"), flavor: g("Flavor Text", "flavor") || null,
    rarity: RARITY[rar.toLowerCase()] || (rar.length === 1 ? rar.toUpperCase() : "C"),
    artist: g("Artist", "artist") || null, frameTheme: g("frameTheme", "frameTheme") || "borderless",
    image: g("image", "image") || null,
  };
}

async function loadManifest() {
  const files = await readdir(DIR);
  if (files.includes("cards.json")) {
    const j = JSON.parse(await readFile(join(DIR, "cards.json"), "utf8"));
    return { setName: j.set?.name, cards: j.cards.map((c) => ({ keywords: [], ...c })) };
  }
  if (files.includes("cards.csv")) return { setName: null, cards: parseCsv(await readFile(join(DIR, "cards.csv"), "utf8")).map(cardFromCsvRow) };
  throw new Error("No cards.json or cards.csv in " + DIR);
}

// Index every art file once: by exact filename, by leading number, by name-slug.
async function buildArtIndex() {
  const byName = new Map(), byNum = new Map(), byFile = new Map();
  const seen = new Set();
  for (const dir of IMAGE_DIRS) {
    let entries; try { entries = await readdir(dir); } catch { continue; }
    for (const f of entries) {
      if (!IMG_EXT.has(extname(f).toLowerCase())) continue;
      const path = join(dir, f);
      if (seen.has(path)) continue; seen.add(path);
      byFile.set(f.toLowerCase(), path);
      const stem = basename(f, extname(f));
      const m = stem.match(/^(\d+)[_\- ]*(.*)$/); // "142_Tear_s_Guard"
      if (m) { if (!byNum.has(Number(m[1]))) byNum.set(Number(m[1]), path); if (m[2]) byName.set(slug(m[2]), path); }
      byName.set(slug(stem), path); // whole-stem slug too
    }
  }
  return { byName, byNum, byFile };
}

function matchArt(idx, card) {
  if (card.image) {
    const hit = idx.byFile.get(String(card.image).toLowerCase()) || idx.byName.get(slug(basename(String(card.image), extname(String(card.image)))));
    if (hit) return hit;
  }
  if (card.number != null && idx.byNum.has(Number(card.number))) return idx.byNum.get(Number(card.number));
  return idx.byName.get(slug(card.name)) || null;
}

let cookie = "";
async function api(method, path, body) {
  const res = await fetch(HUB + path, { method, headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text(); let json; try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${json.error || text.slice(0, 160)}`);
  return json;
}
async function login() {
  if (process.env.MTG_COOKIE) { cookie = process.env.MTG_COOKIE; return; } // pre-minted session
  if (!USER || !PASS) throw new Error("Set MTG_USER and MTG_PASS env vars.");
  const res = await fetch(HUB + "/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: USER, password: PASS }) });
  if (!res.ok) throw new Error("Login failed: " + res.status);
  cookie = (res.headers.get("set-cookie") || "").split(";")[0];
  if (!cookie) throw new Error("No session cookie returned");
}

async function main() {
  const { setName: manifestSet, cards } = await loadManifest();
  const setName = args.set || manifestSet;
  if (!setName) throw new Error("No set name — pass --set \"Name\" or put set.name in cards.json");
  const idx = await buildArtIndex();
  const artFiles = new Set([...idx.byFile.values()]);
  console.log(`Manifest: ${cards.length} cards · art files found: ${artFiles.size} · set "${setName}" · ${HUB}${DRY ? " (DRY RUN)" : ""}`);

  // Resolve art for each card up front; only cards WITH art are candidates.
  const withArt = [], noArt = [];
  for (const c of cards) { const a = matchArt(idx, c); (a ? withArt : noArt).push({ c, art: a }); }
  console.log(`Have art for ${withArt.length}/${cards.length}; waiting on art for ${noArt.length}.`);

  if (DRY) {
    for (const { c, art } of withArt) console.log(`  would import  ${c.name}  ← ${art ? basename(art) : ""}`);
    if (noArt.length) console.log(`  (skipping ${noArt.length} with no art yet: ${noArt.slice(0, 8).map((x) => x.c.name).join(", ")}${noArt.length > 8 ? "…" : ""})`);
    return;
  }
  // --all: create every card (art attached where available); default: art-gated.
  const items = ALL ? [...withArt, ...noArt] : withArt;
  if (items.length === 0) { console.log("Nothing to import."); return; }

  await login();
  const { sets } = await api("GET", "/api/custom/sets");
  let set = sets.find((s) => s.name.toLowerCase() === setName.toLowerCase()) || (await api("POST", "/api/custom/sets", { name: setName })).set;
  // Server state = source of truth for resumability: name -> { id, artPath }.
  const existing = new Map((await api("GET", `/api/custom/sets/${set.id}/cards`)).cards.map((c) => [c.name.toLowerCase(), c]));

  let created = 0, artAdded = 0, fieldsUpdated = 0, alreadyDone = 0, errors = 0;
  for (const { c, art } of items) {
    try {
      const payload = {
        setId: set.id, name: c.name, manaCost: normalizeMana(c.manaCost), types: c.types || "Creature",
        power: c.power ?? null, toughness: c.toughness ?? null, loyalty: c.loyalty ?? null,
        keywords: c.keywords ?? [], oracle: c.oracle ?? "", flavor: c.flavor ?? null,
        rarity: (c.rarity || "C").toUpperCase(), artist: c.artist ?? null, frameTheme: c.frameTheme || "borderless",
      };
      let card = existing.get(c.name.toLowerCase());
      const isNew = !card;
      if (isNew) { card = (await api("POST", "/api/custom/cards", payload)).card; existing.set(c.name.toLowerCase(), card); created++; }
      else if (UPDATE) { await api("PUT", `/api/custom/cards/${card.id}`, payload); fieldsUpdated++; }

      // Attach art only when it's missing (or forced) — this is what makes
      // re-runs cheap and resumable.
      if (art && (!card.artPath || FORCE_ART)) {
        const buf = await readFile(art);
        await api("POST", `/api/custom/cards/${card.id}/art/upload`, { dataBase64: buf.toString("base64"), mime: MIME[extname(art).toLowerCase()] || "image/png", prompt: "(imported)" });
        card.artPath = "db"; artAdded++;
        console.log(`  ✓ ${c.name}  (${isNew ? "created + art" : "art added"})`);
      } else {
        alreadyDone++;
      }
    } catch (e) { errors++; console.error(`  ✗ ${c.name}: ${e.message}`); }
  }
  console.log(`\nDone: ${created} created, ${artAdded} art attached, ${fieldsUpdated} fields updated, ${alreadyDone} already complete, ${errors} errors.`);
  console.log(`Still waiting on art for ${noArt.length} cards — re-run this after more art is generated to pull them in.`);
}

main().catch((e) => { console.error("ERROR:", e.message); process.exit(1); });
