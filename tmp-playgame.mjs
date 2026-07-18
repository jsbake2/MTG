import { chromium } from "playwright";
import { WebSocket } from "ws";

const TOK = "pw-alice";
const BASE = "http://localhost:8477";
const DECK = "94c0d72d-aca3-43a8-a000-b756409a25da";
const problems = [];

// --- 1. set up a game vs the AI over WS (reliable), so we test the IN-GAME UI ---
async function setup() {
  const r = await fetch(`${BASE}/api/tables`, { method: "POST", headers: { "Content-Type": "application/json", Cookie: `mtg_session=${TOK}` }, body: JSON.stringify({ name: "pwtest", formatId: "house", maxPlayers: 2, enforcement: "relaxed", mode: "guided" }) });
  const { table } = await r.json();
  const ws = new WebSocket(`${BASE.replace("http","ws")}/ws`, { headers: { Cookie: `mtg_session=${TOK}` } });
  await new Promise((res) => ws.on("open", res));
  const send = (m) => ws.send(JSON.stringify(m));
  send({ type: "hello", tableId: table.id });
  await new Promise((r) => setTimeout(r, 300));
  send({ type: "take_seat", seat: 0, deckId: DECK });
  await new Promise((r) => setTimeout(r, 300));
  await fetch(`${BASE}/api/tables/${table.id}/bot`, { method: "POST", headers: { "Content-Type": "application/json", Cookie: `mtg_session=${TOK}` }, body: "{}" });
  await new Promise((r) => setTimeout(r, 300));
  send({ type: "start_game" });
  await new Promise((r) => setTimeout(r, 800));
  return { table, ws };
}

const { table } = await setup();
console.log("game table:", table.id);

const browser = await chromium.launch({ executablePath: "/usr/bin/chromium", args: ["--no-sandbox"] });
const ctx = await browser.newContext({ baseURL: BASE });
await ctx.addCookies([{ name: "mtg_session", value: TOK, url: BASE }]);
const page = await ctx.newPage();
page.on("console", (m) => { if (m.type() === "error") problems.push("CONSOLE ERROR: " + m.text().slice(0, 200)); });
page.on("pageerror", (e) => problems.push("PAGE CRASH: " + (e.message || e).toString().slice(0, 300)));

async function shot(name) { await page.screenshot({ path: `/tmp/pw-${name}.png` }).catch(() => {}); }
const seen = async (sel, ms = 4000) => { try { await page.waitForSelector(sel, { timeout: ms }); return true; } catch { return false; } }

await page.goto(`/table/${table.id}`, { waitUntil: "networkidle" }).catch((e) => problems.push("GOTO FAILED: " + e.message));
await page.waitForTimeout(2000);
await shot("01-loaded");
const bodyText = (await page.locator("body").innerText().catch(() => "")).slice(0, 400);
console.log("--- page text (first 400) ---\n" + bodyText + "\n---");

// Is the board even rendered? Look for phase-control buttons.
const hasNext = await page.getByRole("button", { name: /Next step/i }).count();
const hasEnd = await page.getByRole("button", { name: /End turn/i }).count();
const hasPass = await page.getByRole("button", { name: /^Pass/i }).count();
console.log(`controls present: Next=${hasNext} End=${hasEnd} Pass=${hasPass}`);

// Try to click a hand card (bottom of screen) to see what happens.
const handImgs = await page.locator("img.card-aspect").count();
console.log("card images on screen:", handImgs);
if (handImgs > 0) {
  try { await page.locator("img.card-aspect").last().click({ timeout: 2000 }); await page.waitForTimeout(800); await shot("02-clicked-card"); }
  catch (e) { problems.push("CLICK CARD FAILED: " + e.message); }
}

// Try to advance the turn a few times.
for (let i = 0; i < 6; i++) {
  const next = page.getByRole("button", { name: /Next step|End turn/i }).first();
  if (await next.count()) {
    try { await next.click({ timeout: 2000 }); await page.waitForTimeout(700); }
    catch (e) { problems.push(`ADVANCE ${i} FAILED: ` + e.message); break; }
  } else { problems.push(`no advance button at step ${i}`); break; }
}
await shot("03-after-advances");
const turnText = await page.locator("body").innerText().catch(() => "");
const turnMatch = turnText.match(/Turn\s+(\d+)/i);
console.log("reached:", turnMatch ? turnMatch[0] : "(no Turn indicator found)");

console.log("\n===== PROBLEMS (" + problems.length + ") =====");
for (const p of [...new Set(problems)]) console.log("  " + p);
await browser.close();
process.exit(0);
