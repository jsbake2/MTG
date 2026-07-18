import { Router } from "express";
import { z } from "zod";
import { FORMATS } from "@mtg/shared";
import { requireAuth } from "../auth/sessions.js";
import { query } from "../db/pool.js";
import { tables } from "./table.js";

export const tablesRouter = Router();

tablesRouter.use(requireAuth);

tablesRouter.get("/", (_req, res) => {
  res.json({ tables: tables.list() });
});

const createSchema = z.object({
  name: z.string().min(1).max(80),
  formatId: z.string().min(1).max(40),
  ruleset: z.string().min(1).max(40).optional().default("standard"),
  enforceBans: z.boolean().optional().default(true),
  maxPlayers: z.number().int().min(1).max(4),
  enforcement: z.enum(["relaxed", "strict"]),
  mode: z.enum(["guided", "freeform"]).optional().default("guided"),
});

tablesRouter.post("/", (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  const format = FORMATS.find((f) => f.id === parsed.data.formatId);
  if (!format) {
    res.status(400).json({ error: "Unknown format" });
    return;
  }
  const table = tables.create({ ...parsed.data, hostUserId: req.user!.id });
  res.json({ table: table.summary() });
});

tablesRouter.get("/:id", (req, res) => {
  const t = tables.get(String(req.params.id));
  if (!t) {
    res.status(404).json({ error: "Table not found" });
    return;
  }
  res.json({ table: t.summary() });
});

// Add an AI opponent to a table (host/admin only). Defaults to the curated bot
// deck; the engine only automates covered cards, so the bot plays that deck.
tablesRouter.post("/:id/bot", async (req, res) => {
  const t = tables.get(String(req.params.id));
  if (!t) {
    res.status(404).json({ error: "Table not found" });
    return;
  }
  if (t.hostUserId !== req.user!.id && !req.user!.isAdmin) {
    res.status(403).json({ error: "Only the host can add an AI opponent." });
    return;
  }
  let deckId = typeof req.body?.deckId === "string" ? (req.body.deckId as string) : undefined;
  if (!deckId) {
    const { rows } = await query<{ id: string }>("SELECT id FROM decks WHERE 'ai' = ANY(tags) AND is_precon ORDER BY created_at LIMIT 1");
    deckId = rows[0]?.id;
  }
  if (!deckId) {
    res.status(400).json({ error: "No AI deck available." });
    return;
  }
  const r = t.addBot(deckId, typeof req.body?.name === "string" ? req.body.name : "AI opponent");
  if (!r.ok) {
    res.status(400).json({ error: r.error });
    return;
  }
  res.json({ table: t.summary() });
});

tablesRouter.delete("/:id", (req, res) => {
  if (!req.user!.isAdmin) {
    res.status(403).json({ error: "Only admins can delete tables" });
    return;
  }
  const t = tables.get(String(req.params.id));
  if (!t) {
    res.status(404).json({ error: "Table not found" });
    return;
  }
  tables.remove(t.id);
  res.json({ ok: true });
});
