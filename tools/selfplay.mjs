// Two-bot self-play harness. Drives a real guided game over the live WebSocket
// protocol to surface flow/rules problems a human would hit. It plays a
// naive-but-legal game: play a land, tap for mana, cast the cheapest castable
// spell, move to combat, attack with what it can, end the turn. Every server
// error and phase transition is logged so we can SEE where the flow fights back.
//
// Run:  node tools/selfplay.mjs
import { WebSocket } from "ws";
import { readFileSync } from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:8477";
const WS = BASE.replace(/^http/, "ws") + "/ws";
const MODE = process.env.MODE ?? "guided";
const ENFORCE = process.env.ENFORCE ?? "relaxed";
const MAX_TURNS = Number(process.env.MAX_TURNS ?? 8);

const CARD = JSON.parse(readFileSync("/tmp/cardinfo.json", "utf8")); // oracleId -> {name,types,cmc,cost,tl}
const DECK_A = "94c0d72d-aca3-43a8-a000-b756409a25da";
const DECK_B = "327162bd-49f0-4059-bf96-6fc65e66c93f";
const TOK = { 0: "selfplay-bot_alice", 1: "selfplay-bot_bob" };

const problems = [];
const note = (s) => { console.log(s); };
const problem = (s) => { problems.push(s); console.log("  ⚠️  " + s); };

function isLand(o) { return CARD[o.oracleId]?.types?.includes("Land"); }
function cmcOf(o) { return CARD[o.oracleId]?.cmc ?? 99; }
function typesOf(o) { return CARD[o.oracleId]?.types ?? []; }

// A tiny per-connection client over the WS protocol.
function connect(seat) {
  return new Promise((resolve) => {
    const ws = new WebSocket(WS, { headers: { Cookie: `mtg_session=${TOK[seat]}` } });
    const waiters = [];
    let last = null;
    const client = {
      seat, ws, get state() { return last?.state ?? null; }, get you() { return last?.you ?? seat; },
      get hands() { return last?.hands ?? {}; },
      send: (msg) => ws.send(JSON.stringify(msg)),
      act: (action) => ws.send(JSON.stringify({ type: "action", action })),
      // Resolve on the next state/lobby/error message.
      next: (pred = () => true, ms = 2500) =>
        new Promise((res) => {
          const t = setTimeout(() => { const i = waiters.indexOf(w); if (i >= 0) waiters.splice(i, 1); res(null); }, ms);
          const w = (m) => { if (pred(m)) { clearTimeout(t); res(m); return true; } return false; };
          waiters.push(w);
        }),
    };
    ws.on("message", (raw) => {
      const m = JSON.parse(raw.toString());
      if (m.type === "state" || m.type === "lobby") last = m;
      if (m.type === "error") problem(`seat ${seat} server error: ${m.message}`);
      for (let i = waiters.length - 1; i >= 0; i--) if (waiters[i](m)) waiters.splice(i, 1);
    });
    ws.on("open", () => resolve(client));
  });
}

async function main() {
  note(`\n=== SELF-PLAY  mode=${MODE} enforcement=${ENFORCE}  ===`);
  // 1. Create a table as Alice.
  const createRes = await fetch(`${BASE}/api/tables`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: `mtg_session=${TOK[0]}` },
    body: JSON.stringify({ name: "Self-play", formatId: "house", maxPlayers: 2, enforcement: ENFORCE, mode: MODE }),
  });
  const { table } = await createRes.json();
  if (!table) { console.error("table create failed", await createRes.text?.()); return; }
  note(`table ${table.id}`);

  const A = await connect(0), B = await connect(1);
  A.send({ type: "hello", tableId: table.id });
  await A.next((m) => m.type === "lobby");
  B.send({ type: "hello", tableId: table.id });
  await B.next((m) => m.type === "lobby");
  A.send({ type: "take_seat", seat: 0, deckId: DECK_A });
  await A.next((m) => m.type === "lobby" && m.seats?.some((s) => s.seat === 0 && s.deckId));
  B.send({ type: "take_seat", seat: 1, deckId: DECK_B });
  await B.next((m) => m.type === "lobby" && m.seats?.some((s) => s.seat === 1 && s.deckId));
  // Confirm both seats are filled before starting.
  const lob = await A.next((m) => m.type === "lobby");
  const seated = (A.state?.players?.length) ?? (lob?.seats?.filter((s) => s.deckId).length ?? 0);
  note(`seats filled: ${lob?.seats?.filter((s) => s.deckId).length ?? "?"}`);

  // 2. Start.
  A.send({ type: "start_game" });
  const started = await A.next((m) => m.type === "state", 6000);
  if (!started) { problem("game never produced a state after start_game"); return dump(); }
  note(`game started — status=${A.state?.status} phase=${A.state?.step}`);

  // 3. Play turns.
  const seatClient = (s) => (s === 0 ? A : B);
  let lastTurn = -1;
  for (let guard = 0; guard < MAX_TURNS * 40; guard++) {
    const st = A.state;
    if (!st || st.status === "finished") break;
    if (st.turnNumber > MAX_TURNS) break;
    // If a non-active player holds priority (e.g. an end-of-turn response window),
    // the naive bot just passes so play continues.
    if (st.prioritySeat !== st.activeSeat) {
      const pc = seatClient(st.prioritySeat);
      const rev = pc.state?.revision ?? -1;
      pc.act({ type: "pass_priority", seat: st.prioritySeat });
      await pc.next((m) => m.type === "state" && (m.state?.revision ?? -1) > rev);
      continue;
    }
    const me = seatClient(st.activeSeat);
    const seat = st.activeSeat;
    if (st.turnNumber !== lastTurn) {
      lastTurn = st.turnNumber;
      note(`\n--- Turn ${st.turnNumber}: seat ${seat} (${st.players[seat]?.name})  life ${st.players.map((p) => p.life).join("/")} ---`);
    }
    if (["begin_combat", "declare_attackers", "declare_blockers", "combat_damage", "end_combat"].includes(st.step)) {
      const atkrs = Object.values(st.objects).filter((o) => o.attacking !== null && o.attacking !== undefined);
      note(`    [${st.step}] life ${st.players.map((p) => p.life).join("/")}  attackers=${atkrs.map((a) => `${a.name}->${a.attacking}`).join(",") || "none"}`);
    }
    // hands is { [seat]: objectId[] } — map ids to the real objects in our view.
    const hand = (me.hands?.[seat] ?? []).map((id) => me.state.objects[id]).filter(Boolean);
    const bf = Object.values(st.objects).filter((o) => o.zone === "battlefield" && o.controllerSeat === seat);

    if (st.step === "main1" || st.step === "main2") {
      // Play a land if we haven't this turn.
      const landsThisTurn = st.players[seat]?.landsPlayedThisTurn ?? 0;
      const landInHand = hand.find(isLand);
      if (landInHand && landsThisTurn < 1) {
        note(`  seat ${seat} plays land ${landInHand.name}`);
        me.act({ type: "move_card", objectId: landInHand.id, toZone: "battlefield" });
        await me.next((m) => m.type === "state");
      }
      // Try to cast the cheapest nonland we can (mana is on the honor system; add it).
      if (st.step === "main1") {
        const spell = hand.filter((o) => !isLand(o)).sort((a, b) => cmcOf(a) - cmcOf(b))[0];
        if (spell && cmcOf(spell) <= (bf.filter(isLand).length)) {
          note(`  seat ${seat} casts ${spell.name} (cmc ${cmcOf(spell)})`);
          me.act({ type: "cast", objectId: spell.id });
          await me.next((m) => m.type === "state");
          // Resolve it off the stack.
          me.act({ type: "resolve_top" });
          await me.next((m) => m.type === "state");
        }
      }
    }

    if (st.step === "declare_attackers") {
      const attackers = bf.filter((o) => typesOf(o).includes("Creature") && !o.tapped && !o.summoningSick);
      for (const atk of attackers) {
        note(`  seat ${seat} attacks with ${atk.name}`);
        me.act({ type: "declare_attacker", objectId: atk.id, defendingSeat: seat === 0 ? 1 : 0 });
        await me.next((m) => m.type === "state");
      }
    }

    // Progress: end the turn from main2, otherwise step forward. Detect "stuck"
    // via the ACTING client's own revision counter (avoids cross-client races).
    const revBefore = me.state?.revision ?? -1;
    const posBefore = `${st.turnNumber}/${st.step}`;
    me.act(st.step === "main2" ? { type: "end_turn" } : { type: "advance_step" });
    await me.next((m) => m.type === "state" && (m.state?.revision ?? -1) > revBefore);
    // Let both clients settle, then judge progress off the shared observer (A).
    await new Promise((r) => setTimeout(r, 60));
    const posAfter = `${A.state?.turnNumber}/${A.state?.step}/p${A.state?.prioritySeat}`;
    if (`${posBefore}/p${st.prioritySeat}` === posAfter) problem(`no progress (stuck at ${posBefore})`);
  }

  note(`\n=== game ended: status=${A.state?.status} turn=${A.state?.turnNumber} life=${A.state?.players.map((p) => p.life).join("/")} ===`);
  dump();
  A.ws.close(); B.ws.close();
  process.exit(0);
}

function dump() {
  note(`\n===== PROBLEMS (${problems.length}) =====`);
  const counts = {};
  for (const p of problems) counts[p] = (counts[p] ?? 0) + 1;
  for (const [p, n] of Object.entries(counts)) note(`  ${n}× ${p}`);
  if (!problems.length) note("  (none)");
}

main().catch((e) => { console.error(e); process.exit(1); });
