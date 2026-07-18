// Forge catalog search — powers the guided card creator's ability picker:
//  - keyword search (Flying, Crew, Saddle, …) from the mined keyword catalog
//  - card search across all 33k Forge scripts, returning the ability lines so a
//    user can copy an ability from a real card (Forge's own recommended workflow)
import { Router } from "express";
import { requireAuth, requireAdmin } from "../auth/sessions.js";
import { query } from "../db/pool.js";

export const forgeRouter = Router();
forgeRouter.use(requireAuth);

// ---- "cards we want in Forge" queue ------------------------------------
// forge_unsupported holds both auto-detected cards (logged when a deck export
// hits a card Forge can't script) and explicit user requests. One shared list.
const REQ_NAME_OK = /^[\w '’,./:!?&+-]{1,80}$/;

forgeRouter.get("/requests", async (req, res) => {
  const status = String(req.query.status ?? "").trim();
  const rows = (await query(
    `SELECT u.name, u.hits, u.status, u.note, u.first_seen, u.last_seen, u.forge_version, us.display_name AS requested_by
       FROM forge_unsupported u LEFT JOIN users us ON us.id = u.requested_by
      ${status && status !== "all" ? "WHERE u.status = $1" : ""}
      ORDER BY (u.status = 'open') DESC, u.hits DESC, u.last_seen DESC
      LIMIT 500`,
    status && status !== "all" ? [status] : [],
  )).rows;
  res.json({ requests: rows });
});

// Any signed-in user can request a card be added to Forge.
forgeRouter.post("/requests", async (req, res) => {
  const name = String(req.body?.name ?? "").trim();
  const note = String(req.body?.note ?? "").trim() || null;
  if (!REQ_NAME_OK.test(name)) return res.status(400).json({ error: "Enter a valid card name." });
  await query(
    `INSERT INTO forge_unsupported (name, note, requested_by, status)
     VALUES ($1, $2, $3, 'open')
     ON CONFLICT (name) DO UPDATE SET hits = forge_unsupported.hits + 1, last_seen = now(),
       note = COALESCE(EXCLUDED.note, forge_unsupported.note),
       requested_by = COALESCE(forge_unsupported.requested_by, EXCLUDED.requested_by)`,
    [name, note, req.user!.id],
  );
  res.json({ ok: true });
});

// Admin: triage a request (open | scripted | wontfix), optionally attach a script.
forgeRouter.post("/requests/:name/status", requireAdmin, async (req, res) => {
  const status = String(req.body?.status ?? "");
  if (!["open", "scripted", "wontfix"].includes(status)) return res.status(400).json({ error: "Bad status" });
  await query(`UPDATE forge_unsupported SET status = $2 WHERE name = $1`, [String(req.params.name), status]);
  res.json({ ok: true });
});

// Keyword catalog. ?q= filters by keyword; empty = most-used first.
forgeRouter.get("/keywords", async (req, res) => {
  const q = String(req.query.q ?? "").trim();
  const rows = q
    ? (await query(`SELECT keyword, sample, hits, example FROM forge_keywords WHERE keyword ILIKE '%' || $1 || '%' ORDER BY hits DESC LIMIT 60`, [q])).rows
    : (await query(`SELECT keyword, sample, hits, example FROM forge_keywords ORDER BY hits DESC LIMIT 60`)).rows;
  res.json({ keywords: rows });
});

// The Forge "ability" lines from a script (what the card does).
function abilityLines(script: string): string[] {
  return script
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => /^(K:|A:|T:|S:|R:|SVar:)/.test(l));
}

// Card search across Forge scripts. Matches card name and script text so you can
// search by what a card DOES ("create a Treasure") and copy its ability.
forgeRouter.get("/cards", async (req, res) => {
  const q = String(req.query.q ?? "").trim();
  if (!q) { res.json({ cards: [] }); return; }
  const rows = (
    await query<{ name: string; script: string }>(
      `SELECT name, script FROM forge_scripts
       WHERE lower(name) LIKE '%' || lower($1) || '%'
          OR to_tsvector('simple', script) @@ plainto_tsquery('simple', $1)
       ORDER BY (lower(name) LIKE '%' || lower($1) || '%') DESC, length(name) ASC
       LIMIT 30`,
      [q],
    )
  ).rows;
  res.json({ cards: rows.map((r) => ({ name: r.name, abilities: abilityLines(r.script), script: r.script })) });
});

// The full raw script for one card (for the advanced editor / copy-all).
forgeRouter.get("/card/:name", async (req, res) => {
  const row = (await query<{ name: string; script: string }>(`SELECT name, script FROM forge_scripts WHERE name_key = lower($1)`, [String(req.params.name)])).rows[0];
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json({ name: row.name, script: row.script, abilities: abilityLines(row.script) });
});
