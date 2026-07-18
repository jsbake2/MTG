#!/usr/bin/env node
// Apply hand-authored Forge scripts to the custom set. For each *.txt in
// forge-scripts/, it finds the matching CSV row (by the script's `Name:` line),
// creates-or-updates that card in the set with the CSV fields + the raw script
// (advanced mode). Idempotent + resumable: a card whose stored script already
// matches is skipped. Requires an ADMIN login (advanced scripts are host-only).
//
// USAGE:
//   HUB=https://mtg.jsb-emr.us MTG_USER=jason MTG_PASS=… \
//     node tools/apply-forge-scripts.mjs --dir imports/wheel-of-time [--set "Wheel of Time"] [--dry]
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

const args = Object.fromEntries(process.argv.slice(2).flatMap((a, i, arr) =>
  a.startsWith("--") ? [[a.slice(2), arr[i + 1] && !arr[i + 1].startsWith("--") ? arr[i + 1] : true]] : []));
const DIR = args.dir; if (!DIR) { console.error("Missing --dir"); process.exit(1); }
const SCRIPTS = join(DIR, "forge-scripts");
const HUB = process.env.HUB || "http://localhost:8477";
const USER = process.env.MTG_USER, PASS = process.env.MTG_PASS;
const DRY = !!args.dry;
const RARITY = { common: "C", uncommon: "U", rare: "R", mythic: "M", special: "S", land: "L", basic: "L" };

function parseCsv(text) {
  const rows = []; let row = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) { const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; }
    else if (c === '"') q = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") { if (cell !== "" || row.length) { row.push(cell); rows.push(row); row = []; cell = ""; } if (c === "\r" && text[i+1]==="\n") i++; }
    else cell += c; }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  const h = rows.shift().map((x) => x.trim());
  return rows.filter((r) => r.some((x) => x.trim())).map((r) => Object.fromEntries(h.map((x, i) => [x, (r[i] ?? "").trim()])));
}
const normMana = (s) => !s ? "" : s.includes("{") ? (s.match(/\{([^}]+)\}/g)||[]).map((t)=>t.slice(1,-1)).join(" ") : s.replace(/\s+/g," ").trim();

let cookie = "";
async function api(method, path, body) {
  const res = await fetch(HUB + path, { method, headers: { "Content-Type": "application/json", ...(cookie?{Cookie:cookie}:{}) }, body: body?JSON.stringify(body):undefined });
  const t = await res.text(); let j; try { j = t?JSON.parse(t):{}; } catch { j = {raw:t}; }
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${j.error||t.slice(0,160)}`);
  return j;
}
async function login() {
  if (process.env.MTG_COOKIE) { cookie = process.env.MTG_COOKIE; return; } // pre-minted session
  if (!USER || !PASS) throw new Error("Set MTG_USER and MTG_PASS (admin).");
  const res = await fetch(HUB + "/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: USER, password: PASS }) });
  if (!res.ok) throw new Error("Login failed: " + res.status);
  cookie = (res.headers.get("set-cookie") || "").split(";")[0];
}

async function main() {
  const csvRows = parseCsv(await readFile(join(DIR, "cards.csv"), "utf8"));
  // Index by full name AND by the front face of DFC "A // B" names, so a script
  // whose Name: is just the front face still matches its CSV row.
  const byName = new Map();
  for (const r of csvRows) {
    const full = r["Card Name"];
    byName.set(full.toLowerCase(), r);
    if (full.includes(" // ")) byName.set(full.split(" // ")[0].trim().toLowerCase(), r);
  }
  const files = (await readdir(SCRIPTS)).filter((f) => f.endsWith(".txt"));
  // pair each script with its CSV row via the script's Name: line
  const items = [];
  for (const f of files) {
    const script = await readFile(join(SCRIPTS, f), "utf8");
    const name = (script.match(/^Name:(.+)$/m)?.[1] ?? "").trim();
    const row = byName.get(name.toLowerCase());
    if (!row) { console.warn(`  ! ${f}: Name "${name}" not found in cards.csv`); continue; }
    items.push({ f, name, script, row });
  }
  const setName = args.set || "Wheel of Time";
  console.log(`${items.length} scripts matched to CSV rows; set "${setName}"${DRY ? " (DRY RUN)" : ""}`);
  if (DRY) { for (const it of items) console.log(`  would apply  ${it.name}`); return; }

  await login();
  const { sets } = await api("GET", "/api/custom/sets");
  let set = sets.find((s) => s.name.toLowerCase() === setName.toLowerCase()) || (await api("POST", "/api/custom/sets", { name: setName })).set;
  const existing = new Map((await api("GET", `/api/custom/sets/${set.id}/cards`)).cards.map((c) => [c.name.toLowerCase(), c]));

  let created = 0, updated = 0, skipped = 0, errors = 0;
  for (const { name, script, row } of items) {
    try {
      const [p, t] = (row["Power/Toughness"] || "").split("/").map((x) => x.trim());
      const payload = {
        setId: set.id, name, manaCost: normMana(row["Mana Cost"]), types: row["Type Line"] || "Creature",
        power: p || null, toughness: t || null, loyalty: null,
        keywords: (row["Keywords"] || "").split(",").map((k) => k.trim()).filter(Boolean),
        oracle: row["Rules Text"] || "", flavor: row["Flavor Text"] || null,
        rarity: RARITY[(row["Rarity"] || "common").toLowerCase()] || "C",
        artist: null, frameTheme: "borderless", advanced: true, forgeScript: script,
      };
      const prev = existing.get(name.toLowerCase());
      if (prev && prev.forgeScript === script && prev.advanced && prev.frameTheme === "borderless") { skipped++; continue; }
      if (prev) { await api("PUT", `/api/custom/cards/${prev.id}`, payload); updated++; }
      else { const c = (await api("POST", "/api/custom/cards", payload)).card; existing.set(name.toLowerCase(), c); created++; }
      console.log(`  ✓ ${name}`);
    } catch (e) { errors++; console.error(`  ✗ ${name}: ${e.message}`); }
  }
  console.log(`\nDone: ${created} created, ${updated} updated, ${skipped} unchanged, ${errors} errors.`);
}
main().catch((e) => { console.error("ERROR:", e.message); process.exit(1); });
