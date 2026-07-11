import { Router } from "express";
import { z } from "zod";
import type { DeckValidation } from "@mtg/shared";
import { requireAuth } from "../auth/sessions.js";
import { getCardsByIds } from "../cards/repo.js";
import {
  createDeck,
  deleteDeck,
  duplicateDeck,
  getDeckDetail,
  getDeckRow,
  listDecks,
  listPrecons,
  starDeck,
  updateDeck,
  getDecksCards,
} from "./repo.js";
import { analyzeDeckTags, validateDeck, type DeckEntryWithCard } from "./validate.js";
import { resolveDecklist } from "./import.js";

export const decksRouter = Router();

const entrySchema = z.object({
  cardId: z.string().uuid(),
  quantity: z.number().int().min(0).max(999),
  board: z.enum(["main", "sideboard", "commander"]),
});
const saveSchema = z.object({
  name: z.string().min(1).max(120),
  formatId: z.string().min(1).max(40),
  description: z.string().max(2000).optional(),
  tags: z.array(z.string().max(40)).max(30).optional(),
  cards: z.array(entrySchema).max(1000),
});

decksRouter.use(requireAuth);

decksRouter.get("/", async (req, res) => {
  res.json({ decks: await listDecks(req.user!.id) });
});

decksRouter.get("/legality", async (req, res) => {
  const formatId = String(req.query.formatId || "standard");
  const includePrecon = req.query.precon === "true";
  
  const decks = await listDecks(req.user!.id);
  const precons = includePrecon ? await listPrecons() : [];
  
  const allDecks = [...decks, ...precons];
  const deckIds = allDecks.map((d) => d.id);
  const deckCardsMap = await getDecksCards(deckIds);
  
  const results: Record<string, { valid: boolean; issuesCount: number }> = {};
  for (const d of allDecks) {
    const entries = deckCardsMap[d.id] ?? [];
    const validation = validateDeck(formatId, entries);
    results[d.id] = {
      valid: validation.valid,
      issuesCount: validation.issues.filter((i) => i.severity === "error").length,
    };
  }
  
  res.json({ results });
});

// Preconstructed decks — visible to everyone, copyable to your own account.
decksRouter.get("/public", async (_req, res) => {
  res.json({ decks: await listPrecons() });
});

decksRouter.post("/", async (req, res) => {
  const parsed = saveSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid deck", details: parsed.error.flatten() });
    return;
  }
  const id = await createDeck(req.user!.id, parsed.data);
  res.json({ id });
});

// Validate an arbitrary card list without saving (used live in the builder).
decksRouter.post("/validate", async (req, res) => {
  const parsed = saveSchema.pick({ formatId: true, cards: true }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  const cards = await getCardsByIds(parsed.data.cards.map((c) => c.cardId));
  const entries: DeckEntryWithCard[] = parsed.data.cards
    .filter((c) => cards.has(c.cardId))
    .map((c) => ({ card: cards.get(c.cardId)!, quantity: c.quantity, board: c.board }));
  const result: DeckValidation = validateDeck(parsed.data.formatId, entries);
  res.json({ validation: result, dynamicTags: analyzeDeckTags(entries) });
});

// Import a pasted decklist (MTGA / MTGGoldfish / plain text) as a new deck.
const importSchema = z.object({
  name: z.string().min(1).max(120),
  formatId: z.string().min(1).max(40),
  text: z.string().min(1).max(100_000),
});
decksRouter.post("/import", async (req, res) => {
  const parsed = importSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  const { entries, unresolved } = await resolveDecklist(parsed.data.text);
  if (entries.length === 0) {
    res.json({ id: null, resolved: 0, unresolved });
    return;
  }
  const id = await createDeck(req.user!.id, { name: parsed.data.name, formatId: parsed.data.formatId, cards: entries });
  res.json({ id, resolved: entries.length, unresolved });
});

decksRouter.get("/:id", async (req, res) => {
  const detail = await getDeckDetail(String(req.params.id));
  if (!detail) {
    res.status(404).json({ error: "Deck not found" });
    return;
  }
  if (detail.ownerId !== req.user!.id && !req.user!.isAdmin && !detail.isPrecon) {
    res.status(403).json({ error: "Not your deck" });
    return;
  }
  const entries: DeckEntryWithCard[] = detail.cards.map((c) => ({ card: c.card, quantity: c.quantity, board: c.board }));
  res.json({ deck: detail, validation: validateDeck(detail.formatId, entries), dynamicTags: analyzeDeckTags(entries) });
});

async function assertOwner(req: import("express").Request, res: import("express").Response): Promise<boolean> {
  const row = await getDeckRow(String(req.params.id));
  if (!row) {
    res.status(404).json({ error: "Deck not found" });
    return false;
  }
  if (row.is_precon) {
    res.status(400).json({ error: "Cannot modify or delete preconstructed decks" });
    return false;
  }
  if (row.owner_id !== req.user!.id && !req.user!.isAdmin) {
    res.status(403).json({ error: "Not your deck" });
    return false;
  }
  return true;
}

decksRouter.put("/:id", async (req, res) => {
  if (!(await assertOwner(req, res))) return;
  const parsed = saveSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid deck" });
    return;
  }
  await updateDeck(String(req.params.id), parsed.data);
  res.json({ ok: true });
});

decksRouter.delete("/:id", async (req, res) => {
  if (!(await assertOwner(req, res))) return;
  await deleteDeck(String(req.params.id));
  res.json({ ok: true });
});

decksRouter.post("/:id/duplicate", async (req, res) => {
  const detail = await getDeckDetail(String(req.params.id));
  if (!detail) {
    res.status(404).json({ error: "Deck not found" });
    return;
  }
  const newId = await duplicateDeck(String(req.params.id), req.user!.id, `${detail.name} (copy)`);
  res.json({ id: newId });
});

decksRouter.post("/:id/star", async (req, res) => {
  if (!(await assertOwner(req, res))) return;
  const parsed = z.object({ starred: z.boolean() }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body" });
    return;
  }
  await starDeck(String(req.params.id), parsed.data.starred);
  res.json({ ok: true });
});
