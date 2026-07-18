// Autonomous UI playtest. Plays a real guided game vs the AI through the actual
// browser DOM (Playwright). Reads the client's authoritative state from
// window.__mtg (exposed by TablePage), so it can tell "clicked Play land but
// nothing moved" from a working action — the real UI bugs the protocol harness
// can't see. Run: node tools/playtest.mjs  (needs a fresh 'pw-alice' session).
import { chromium } from "playwright";
import { WebSocket } from "ws";

const TOK = "pw-alice";
const BASE = "http://localhost:8477";
const DECK = process.env.DECK ?? "94c0d72d-aca3-43a8-a000-b756409a25da";
const TARGET_TURN = Number(process.env.TARGET_TURN ?? 4);
const log = [];
const problem = (s) => { if (!log.includes("❌ " + s)) { log.push("❌ " + s); console.log("  ❌ " + s); } };
const note = (s) => { console.log("  • " + s); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function setup() {
  const r = await fetch(`${BASE}/api/tables`, { method: "POST", headers: { "Content-Type": "application/json", Cookie: `mtg_session=${TOK}` }, body: JSON.stringify({ name: "playtest", formatId: "house", maxPlayers: 2, enforcement: "relaxed", mode: "guided" }) });
  const { table } = await r.json();
  const ws = new WebSocket(`${BASE.replace("http", "ws")}/ws`, { headers: { Cookie: `mtg_session=${TOK}` } });
  await new Promise((res) => ws.on("open", res));
  const send = (m) => ws.send(JSON.stringify(m));
  send({ type: "hello", tableId: table.id });
  await sleep(300);
  send({ type: "take_seat", seat: 0, deckId: DECK });
  await sleep(300);
  await fetch(`${BASE}/api/tables/${table.id}/bot`, { method: "POST", headers: { "Content-Type": "application/json", Cookie: `mtg_session=${TOK}` }, body: "{}" });
  await sleep(300);
  send({ type: "start_game" });
  await sleep(700);
  ws.close();
  return table;
}

async function main() {
  const table = await setup();
  console.log(`=== PLAYTEST table ${table.id} ===`);
  const browser = await chromium.launch({ executablePath: "/usr/bin/chromium", args: ["--no-sandbox"] });
  const ctx = await browser.newContext({ baseURL: BASE, viewport: { width: 1400, height: 900 } });
  await ctx.addCookies([{ name: "mtg_session", value: TOK, url: BASE }]);
  const page = await ctx.newPage();
  let crashed = null;
  page.on("pageerror", (e) => { crashed = (e.message || String(e)).slice(0, 300); problem("PAGE CRASH: " + crashed); });
  page.on("console", (m) => { if (m.type() === "error") problem("CONSOLE: " + m.text().slice(0, 160)); });
  page.on("dialog", async (d) => { note(`native dialog(${d.type()}): "${d.message().slice(0, 40)}" → accept "1"`); await d.accept("1").catch(() => {}); });

  await page.goto(`/table/${table.id}`, { waitUntil: "networkidle" }).catch((e) => problem("GOTO: " + e.message));
  await sleep(1500);

  const me = 0;
  const read = async () => (await page.evaluate(() => window.__mtg || {})) || {};
  const shot = (n) => page.screenshot({ path: `/tmp/pt-${n}.png` }).catch(() => {});
  const objs = (s) => Object.values(s?.objects ?? {});
  const myHand = (s) => objs(s).filter((o) => o.zone === "hand" && o.ownerSeat === me);
  const myBf = (s) => objs(s).filter((o) => o.zone === "battlefield" && o.controllerSeat === me);
  const landsInPlay = (s) => myBf(s).filter((o) => o.cardTypes?.includes("Land")).length;
  const isLandObj = (o) => o.cardTypes?.includes("Land") || /gate|citadel|plains|island|swamp|mountain|forest|\bland\b/i.test(o.name);

  {
    const snap = await read();
    if (!snap.state) { problem("client never loaded game state (window.__mtg.state is null)"); await shot("noload"); }
    else note(`loaded: turn ${snap.state.turnNumber}/${snap.state.step}, my hand ${myHand(snap.state).length}`);
  }

  async function cardMenuAction(objName, itemRegex) {
    const before = (await read()).state?.revision ?? 0;
    const img = page.locator(`.hand-card img[alt="${objName}"], img[alt="${objName}"]`).first();
    if (!(await img.count())) { problem(`card not found in DOM: ${objName}`); return false; }
    await img.click({ timeout: 3000 }).catch((e) => problem(`click card ${objName}: ${e.message}`));
    await sleep(350);
    const item = page.getByRole("button", { name: itemRegex }).first();
    if (!(await item.count())) { problem(`menu item ${itemRegex} not offered for ${objName}`); await page.keyboard.press("Escape").catch(() => {}); return false; }
    await item.click({ timeout: 3000 }).catch((e) => problem(`click menu ${itemRegex} for ${objName}: ${e.message}`));
    await sleep(700);
    return ((await read()).state?.revision ?? 0) !== before;
  }

  async function handleManaPicker() {
    if (!(await read()).manaChoice) return false;
    note("mana picker required");
    for (let i = 0; i < 10; i++) {
      const txt = await page.locator("text=/selected \\d+\\/\\d+/").first().innerText().catch(() => "");
      const m = txt.match(/selected (\d+)\/(\d+)/);
      if (m && Number(m[1]) >= Number(m[2])) break;
      const src = page.locator(".panel button:has(span.rounded-sm)").nth(i);
      if (!(await src.count())) { break; }
      await src.click().catch(() => {});
      await sleep(150);
    }
    const castBtn = page.getByRole("button", { name: /^Cast$/ });
    if (await castBtn.count()) await castBtn.click({ timeout: 2000 }).catch((e) => problem("mana picker Cast: " + e.message));
    await sleep(500);
    return true;
  }

  async function advance() { const b = page.getByRole("button", { name: /^Next step$/ }); if ((await b.count()) && (await b.isEnabled())) { await b.click().catch(() => {}); await sleep(500); return true; } return false; }
  async function endTurn() { const b = page.getByRole("button", { name: /End turn/ }); if ((await b.count()) && (await b.isEnabled())) { await b.click().catch(() => {}); await sleep(700); return true; } return false; }
  async function resolveStack() { const b = page.getByRole("button", { name: /Resolve/i }); if (await b.count()) { await b.first().click().catch(() => {}); await sleep(400); } }

  let stuck = 0, lastKey = "", castedThisTurn = -1;
  for (let iter = 0; iter < 220; iter++) {
    if (crashed) break;
    const s = (await read()).state;
    if (!s) { await sleep(400); if (iter > 5) { problem("no state after load"); break; } continue; }
    if (s.status !== "playing") { note(`status=${s.status}`); break; }
    if (s.turnNumber > TARGET_TURN) { note(`reached turn ${s.turnNumber} — target met`); break; }

    const key = `${s.turnNumber}/${s.step}/${s.prioritySeat}/${s.revision}`;
    if (key === lastKey) { if (++stuck > 10) { problem(`STUCK at turn ${s.turnNumber} step ${s.step} (prio ${s.prioritySeat}) — no progress`); await shot("stuck"); break; } }
    else { stuck = 0; lastKey = key; }

    if (await handleManaPicker()) continue;
    if (s.prioritySeat !== me) { await sleep(500); continue; } // AI acting

    if (s.activeSeat === me && (s.step === "main1" || s.step === "main2")) {
      if ((s.players[me]?.landsPlayedThisTurn ?? 0) < 1) {
        const land = myHand(s).find(isLandObj);
        if (land) { const ok = await cardMenuAction(land.name, /Play land/); if (ok) note(`✓ played land ${land.name} (t${s.turnNumber})`); else problem(`play-land did nothing: ${land.name}`); continue; }
      }
      if (s.step === "main1" && castedThisTurn !== s.turnNumber) {
        const spell = myHand(s).find((o) => !isLandObj(o));
        if (spell && landsInPlay(s) >= 1) {
          castedThisTurn = s.turnNumber;
          const ok = await cardMenuAction(spell.name, /^Cast/);
          await handleManaPicker();
          await resolveStack();
          if (ok) note(`✓ cast ${spell.name}`); else note(`cast ${spell.name}: no immediate change (targets/mana/stack?)`);
          continue;
        }
      }
      if (s.step === "main2") { if (!(await endTurn())) problem("End turn button did nothing in main2"); continue; }
      if (!(await advance())) { if (!(await endTurn())) problem(`can't advance or end from ${s.step}`); }
      continue;
    }

    if (s.activeSeat === me && s.step === "declare_attackers") {
      const atkr = myBf(s).find((o) => o.cardTypes?.includes("Creature") && !o.tapped && !o.summoningSick && o.attacking == null);
      if (atkr) {
        const img = page.locator(`img[alt="${atkr.name}"]`).first();
        if (await img.count()) { await img.click().catch(() => {}); await sleep(300); const a = page.getByRole("button", { name: /Attack /i }).first(); if (await a.count()) { await a.click().catch(() => {}); note(`✓ attacked with ${atkr.name}`); await sleep(400); continue; } await page.keyboard.press("Escape").catch(() => {}); }
      }
      if (!(await advance())) await endTurn();
      continue;
    }

    if (s.activeSeat === me) { if (!(await advance())) await endTurn(); continue; }
    await sleep(400);
  }

  const s = (await read()).state;
  console.log(`\n=== RESULT: turn ${s?.turnNumber}, status ${s?.status}, my board ${myBf(s).length} (${landsInPlay(s)} lands) ===`);
  console.log(`crashed: ${crashed ? "YES — " + crashed : "no"}`);
  const probs = log.filter((l) => l.startsWith("❌"));
  console.log(`\n===== ${probs.length} problems =====`);
  probs.forEach((p) => console.log("  " + p));
  await shot("final");
  await browser.close();
  process.exit(0);
}

main().catch((e) => { console.error("DRIVER ERROR:", e); process.exit(1); });
