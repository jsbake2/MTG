// Seeds a couple of simple ready-to-play House decks the first time the catalog
// is present, so the kids can jump straight into a game. Defensive: if the card
// catalog hasn't been imported yet, or decks already exist, it quietly no-ops.
import { query } from "../db/pool.js";
import { createDeck } from "../decks/repo.js";
import type { DeckCardEntry } from "@mtg/shared";

interface SimpleDeckPlan {
  name: string;
  color: string; // WUBRG letter
  basicLandName: string;
}

const PLANS: SimpleDeckPlan[] = [
  { name: "Red Starter — Fire & Fury", color: "R", basicLandName: "Mountain" },
  { name: "Green Starter — Wild Growth", color: "G", basicLandName: "Forest" },
  { name: "Blue Starter — Deep Waters", color: "U", basicLandName: "Island" },
  { name: "White Starter — Steadfast", color: "W", basicLandName: "Plains" },
];

async function pickBasicLand(name: string): Promise<string | null> {
  const r = (
    await query<{ id: string }>(
      `SELECT id FROM cards WHERE name = $1 AND 'Land' = ANY(card_types) AND digital = false
       ORDER BY released_at DESC NULLS LAST LIMIT 1`,
      [name],
    )
  ).rows[0];
  return r?.id ?? null;
}

async function pickCreatures(color: string, limit: number): Promise<string[]> {
  const rows = (
    await query<{ id: string }>(
      `SELECT DISTINCT ON (oracle_id) id FROM cards
       WHERE 'Creature' = ANY(card_types)
         AND colors = ARRAY[$1]::text[]
         AND cmc <= 5 AND digital = false
         AND coalesce(power,'') ~ '^[0-9]'
       ORDER BY oracle_id, released_at DESC NULLS LAST
       LIMIT $2`,
      [color, limit],
    )
  ).rows;
  return rows.map((r) => r.id);
}

export async function seedStarterDecks(): Promise<void> {
  try {
    const deckCount = Number((await query<{ n: string }>("SELECT count(*)::text AS n FROM decks")).rows[0]?.n ?? 0);
    if (deckCount > 0) return;
    const cardCount = Number((await query<{ n: string }>("SELECT count(*)::text AS n FROM cards")).rows[0]?.n ?? 0);
    if (cardCount === 0) return;
    const admin = (await query<{ id: string }>("SELECT id FROM users WHERE is_admin = true ORDER BY created_at ASC LIMIT 1")).rows[0];
    if (!admin) return;

    let made = 0;
    for (const plan of PLANS) {
      const land = await pickBasicLand(plan.basicLandName);
      const creatures = await pickCreatures(plan.color, 24);
      if (!land || creatures.length < 8) continue;
      const cards: DeckCardEntry[] = [];
      cards.push({ cardId: land, quantity: 24, board: "main" });
      // Fill up toward ~60 with the creatures we found (repeating to reach counts).
      const per = Math.max(1, Math.floor(36 / creatures.length));
      let total = 24;
      for (const c of creatures) {
        const q = Math.min(per, 60 - total);
        if (q <= 0) break;
        cards.push({ cardId: c, quantity: q, board: "main" });
        total += q;
      }
      await createDeck(admin.id, { name: plan.name, formatId: "house", description: "Auto-generated starter deck. Edit me!", cards });
      made++;
    }
    if (made > 0) console.log(`[seed] created ${made} starter decks`);
  } catch (e) {
    console.warn("[seed] starter decks skipped:", e instanceof Error ? e.message : e);
  }
}
