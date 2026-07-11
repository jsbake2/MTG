import type { Deck, DeckCardEntry, DeckDetail } from "@mtg/shared";
import { query, withTx } from "../db/pool.js";
import { getCardsByIds } from "../cards/repo.js";
import type { DeckEntryWithCard } from "./validate.js";

interface DeckRow {
  id: string;
  owner_id: string;
  owner_name: string;
  name: string;
  format_id: string;
  description: string;
  is_precon: boolean;
  is_starred: boolean;
  tags: string[];
  created_at: string;
  updated_at: string;
  card_count: string;
}

async function deckColors(deckId: string): Promise<string[]> {
  const rows = (
    await query<{ ci: string }>(
      `SELECT DISTINCT unnest(c.color_identity) AS ci
       FROM deck_cards dc JOIN cards c ON c.id = dc.card_id
       WHERE dc.deck_id = $1`,
      [deckId],
    )
  ).rows;
  const order = ["W", "U", "B", "R", "G"];
  return rows.map((r) => r.ci).filter(Boolean).sort((a, b) => order.indexOf(a) - order.indexOf(b));
}

function toDeck(r: DeckRow, colors: string[]): Deck {
  return {
    id: r.id,
    ownerId: r.owner_id,
    ownerName: r.owner_name,
    name: r.name,
    formatId: r.format_id,
    description: r.description,
    colors,
    cardCount: Number(r.card_count),
    isPrecon: r.is_precon,
    isStarred: r.is_starred,
    tags: r.tags ?? [],
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

const DECK_SELECT = `
  SELECT d.*, u.display_name AS owner_name,
         coalesce((SELECT sum(quantity) FROM deck_cards dc WHERE dc.deck_id = d.id AND dc.board <> 'sideboard'), 0)::text AS card_count
  FROM decks d JOIN users u ON u.id = d.owner_id`;

export async function listDecks(ownerId: string): Promise<Deck[]> {
  // Precons are shared and shown separately, not in the owner's personal list.
  const rows = (await query<DeckRow>(`${DECK_SELECT} WHERE d.owner_id = $1 AND d.is_precon = false ORDER BY d.updated_at DESC`, [ownerId])).rows;
  const decks: Deck[] = [];
  for (const r of rows) decks.push(toDeck(r, await deckColors(r.id)));
  return decks;
}

export async function getDeckRow(id: string): Promise<DeckRow | null> {
  const r = (await query<DeckRow>(`${DECK_SELECT} WHERE d.id = $1`, [id])).rows[0];
  return r ?? null;
}

export async function getDeckDetail(id: string): Promise<DeckDetail | null> {
  const r = await getDeckRow(id);
  if (!r) return null;
  const entries = (
    await query<{ card_id: string; board: DeckCardEntry["board"]; quantity: number }>(
      `SELECT card_id, board, quantity FROM deck_cards WHERE deck_id = $1`,
      [id],
    )
  ).rows;
  const cards = await getCardsByIds(entries.map((e) => e.card_id));
  const detailCards = entries
    .filter((e) => cards.has(e.card_id))
    .map((e) => ({ cardId: e.card_id, board: e.board, quantity: e.quantity, card: cards.get(e.card_id)! }));
  return { ...toDeck(r, await deckColors(id)), cards: detailCards };
}

export async function createDeck(
  ownerId: string,
  data: { name: string; formatId: string; description?: string; cards: DeckCardEntry[]; tags?: string[] },
  isPrecon = false,
): Promise<string> {
  return withTx(async (client) => {
    const deckId = (
      await client.query<{ id: string }>(
        `INSERT INTO decks (owner_id, name, format_id, description, is_precon, tags) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [ownerId, data.name, data.formatId, data.description ?? "", isPrecon, data.tags ?? []],
      )
    ).rows[0]!.id;
    await insertCards(client, deckId, data.cards);
    return deckId;
  });
}

export async function listPrecons(): Promise<Deck[]> {
  const rows = (await query<DeckRow>(`${DECK_SELECT} WHERE d.is_precon = true ORDER BY d.name ASC`)).rows;
  const decks: Deck[] = [];
  for (const r of rows) decks.push(toDeck(r, await deckColors(r.id)));
  return decks;
}

export async function preconCount(): Promise<number> {
  return Number((await query<{ n: string }>(`SELECT count(*)::text AS n FROM decks WHERE is_precon = true`)).rows[0]?.n ?? 0);
}

export async function updateDeck(
  deckId: string,
  data: { name: string; formatId: string; description?: string; cards: DeckCardEntry[]; tags?: string[] },
): Promise<void> {
  await withTx(async (client) => {
    await client.query(`UPDATE decks SET name=$1, format_id=$2, description=$3, tags=$4, updated_at=now() WHERE id=$5`, [
      data.name,
      data.formatId,
      data.description ?? "",
      data.tags ?? [],
      deckId,
    ]);
    await client.query(`DELETE FROM deck_cards WHERE deck_id = $1`, [deckId]);
    await insertCards(client, deckId, data.cards);
  });
}

async function insertCards(client: import("pg").PoolClient, deckId: string, cards: DeckCardEntry[]): Promise<void> {
  // Merge duplicates (same card+board) and drop invalid quantities.
  const merged = new Map<string, DeckCardEntry>();
  for (const c of cards) {
    if (c.quantity <= 0) continue;
    const key = `${c.cardId}|${c.board}`;
    const existing = merged.get(key);
    if (existing) existing.quantity += c.quantity;
    else merged.set(key, { ...c });
  }
  for (const c of merged.values()) {
    await client.query(
      `INSERT INTO deck_cards (deck_id, card_id, board, quantity) VALUES ($1,$2,$3,$4)
       ON CONFLICT (deck_id, card_id, board) DO UPDATE SET quantity = EXCLUDED.quantity`,
      [deckId, c.cardId, c.board, c.quantity],
    );
  }
}

export async function deleteDeck(deckId: string): Promise<void> {
  await query(`DELETE FROM decks WHERE id = $1`, [deckId]);
}

export async function starDeck(deckId: string, starred: boolean): Promise<void> {
  await query(`UPDATE decks SET is_starred = $1 WHERE id = $2`, [starred, deckId]);
}

export async function duplicateDeck(deckId: string, ownerId: string, newName: string): Promise<string | null> {
  const detail = await getDeckDetail(deckId);
  if (!detail) return null;
  return createDeck(ownerId, {
    name: newName,
    formatId: detail.formatId,
    description: detail.description,
    cards: detail.cards.map((c) => ({ cardId: c.cardId, board: c.board, quantity: c.quantity })),
  });
}

export async function getDecksContainingCard(oracleId: string, userId: string | null): Promise<Array<{ id: string; name: string; isPrecon: boolean; quantity: number; board: string }>> {
  const rows = (
    await query<{ id: string; name: string; is_precon: boolean; quantity: number; board: string }>(
      `SELECT d.id, d.name, d.is_precon, dc.quantity, dc.board
       FROM decks d
       JOIN deck_cards dc ON dc.deck_id = d.id
       JOIN cards c ON c.id = dc.card_id
       WHERE c.oracle_id = $1 AND (d.is_precon = true ${userId ? "OR d.owner_id = $2" : ""})
       ORDER BY d.is_precon DESC, d.name ASC`,
      userId ? [oracleId, userId] : [oracleId],
    )
  ).rows;
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    isPrecon: r.is_precon,
    quantity: r.quantity,
    board: r.board,
  }));
}

export async function getDecksCards(deckIds: string[]): Promise<Record<string, DeckEntryWithCard[]>> {
  if (deckIds.length === 0) return {};
  const entries = (
    await query<{ deck_id: string; card_id: string; board: DeckCardEntry["board"]; quantity: number }>(
      `SELECT deck_id, card_id, board, quantity FROM deck_cards WHERE deck_id = ANY($1)`,
      [deckIds],
    )
  ).rows;
  const cardIds = [...new Set(entries.map((e) => e.card_id))];
  const cards = await getCardsByIds(cardIds);
  
  const results: Record<string, DeckEntryWithCard[]> = {};
  for (const deckId of deckIds) results[deckId] = [];
  
  for (const e of entries) {
    const card = cards.get(e.card_id);
    if (card) {
      results[e.deck_id]?.push({ board: e.board, quantity: e.quantity, card });
    }
  }
  return results;
}
