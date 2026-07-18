import { Router } from "express";
import { z } from "zod";
import { getRuleset, type DeckValidation } from "@mtg/shared";
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
  preconSets,
  starDeck,
  updateDeck,
  getDecksCards,
} from "./repo.js";
import { analyzeDeckTags, validateDeck, type DeckEntryWithCard } from "./validate.js";
import { resolveDecklist } from "./import.js";
import { buildDck, checkForgeSupport, forgeVersionInfo, logUnsupported } from "./forge.js";

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
// Optional ?set=CODE filters to precons from that set (for "play a precon from
// an old set").
decksRouter.get("/public", async (req, res) => {
  const set = typeof req.query.set === "string" && req.query.set ? req.query.set : undefined;
  res.json({ decks: await listPrecons(set) });
});

// Sets that have precons, with counts — drives a set picker for precon play.
decksRouter.get("/precon-sets", async (_req, res) => {
  res.json({ sets: await preconSets() });
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
  // Optional ruleset override (used by the lobby to check decks against a table's
  // chosen legality tier + ban setting rather than the deck's own format label).
  const rulesetId = typeof req.body?.ruleset === "string" ? req.body.ruleset : undefined;
  const rs = getRuleset(rulesetId);
  const override = rs ? { legalityKey: rs.legalityKey, enforceBans: req.body?.enforceBans !== false, rulesetName: rs.name } : undefined;
  const result: DeckValidation = validateDeck(parsed.data.formatId, entries, override);
  res.json({ validation: result, dynamicTags: analyzeDeckTags(entries) });
});

// Check a saved deck's legality for a given game type + ruleset (used by the lobby
// to show only decks a player can actually field at this table). One round-trip.
decksRouter.post("/:id/check", async (req, res) => {
  const detail = await getDeckDetail(String(req.params.id));
  if (!detail) {
    res.status(404).json({ error: "Deck not found" });
    return;
  }
  const gameType = typeof req.body?.formatId === "string" ? req.body.formatId : detail.formatId;
  const rs = getRuleset(typeof req.body?.ruleset === "string" ? req.body.ruleset : undefined);
  const override = rs ? { legalityKey: rs.legalityKey, enforceBans: req.body?.enforceBans !== false, rulesetName: rs.name } : undefined;
  const entries: DeckEntryWithCard[] = detail.cards.map((c) => ({ card: c.card, quantity: c.quantity, board: c.board }));
  const v = validateDeck(gameType, entries, override);
  res.json({ valid: v.valid });
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

// Export a deck to Forge (.dck) with support validation. Returns the file text,
// the list of cards Forge doesn't support, and version info. Unsupported cards
// are logged (under rulings) so we can write our own Forge scripts for them.
decksRouter.get("/:id/forge-export", async (req, res) => {
  const detail = await getDeckDetail(String(req.params.id));
  if (!detail) { res.status(404).json({ error: "Deck not found" }); return; }
  if (detail.ownerId !== req.user!.id && !req.user!.isAdmin && !detail.isPrecon) { res.status(403).json({ error: "Not your deck" }); return; }
  const names = detail.cards.map((c) => c.card.name);
  const { unsupported } = await checkForgeSupport(names);
  const forge = await forgeVersionInfo();
  // Only log as "needs a script" when we're already on the latest Forge — an
  // out-of-date Forge might simply not have imported the card yet.
  if (unsupported.length && !forge.updateAvailable) await logUnsupported(unsupported, forge.installed);
  const dck = buildDck(detail, { omit: new Set(unsupported) });
  res.json({ deckName: detail.name, dck, total: names.length, unsupported, forge });
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
