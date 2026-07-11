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
  updateDeck,
} from "./repo.js";
import { validateDeck, type DeckEntryWithCard } from "./validate.js";

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
  cards: z.array(entrySchema).max(1000),
});

decksRouter.use(requireAuth);

decksRouter.get("/", async (req, res) => {
  res.json({ decks: await listDecks(req.user!.id) });
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
  res.json(result);
});

decksRouter.get("/:id", async (req, res) => {
  const detail = await getDeckDetail(String(req.params.id));
  if (!detail) {
    res.status(404).json({ error: "Deck not found" });
    return;
  }
  if (detail.ownerId !== req.user!.id && !req.user!.isAdmin) {
    res.status(403).json({ error: "Not your deck" });
    return;
  }
  const entries: DeckEntryWithCard[] = detail.cards.map((c) => ({ card: c.card, quantity: c.quantity, board: c.board }));
  res.json({ deck: detail, validation: validateDeck(detail.formatId, entries) });
});

async function assertOwner(req: import("express").Request, res: import("express").Response): Promise<boolean> {
  const row = await getDeckRow(String(req.params.id));
  if (!row) {
    res.status(404).json({ error: "Deck not found" });
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
