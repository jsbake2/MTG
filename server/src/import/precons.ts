// Import preconstructed decks from MTGJSON. MTGJSON publishes official decklists
// (Commander precons, Planeswalker decks, Challenger decks, …) with a Scryfall id
// for every card, so we can map them straight onto our catalog and store them as
// shared "precon" decks that any player can browse, play, or copy.
//
// Run via: docker compose run --rm app npm run import:precons
import { runMigrations } from "../db/migrate.js";
import { pool, query } from "../db/pool.js";
import { createDeck } from "../decks/repo.js";
import type { DeckCardEntry } from "@mtg/shared";

const DECKLIST_URL = "https://mtgjson.com/api/v5/DeckList.json";
const DECK_URL = (fileName: string) => `https://mtgjson.com/api/v5/decks/${encodeURIComponent(fileName)}.json`;
const UA = "MtgPvP-selfhosted/0.1 (private family game)";

interface DeckListEntry {
  code: string;
  fileName: string;
  name: string;
  releaseDate: string;
  type: string;
}
interface MtgjsonCard {
  count: number;
  name: string;
  identifiers?: { scryfallId?: string };
}
interface MtgjsonDeck {
  name: string;
  code: string;
  type: string;
  releaseDate: string;
  commander?: MtgjsonCard[];
  mainBoard?: MtgjsonCard[];
  sideBoard?: MtgjsonCard[];
}

// Deck types we consider "precons" worth importing (a broad, fun bunch).
const WANTED = /commander|planeswalker|challenger|starter|theme|intro|brawl|duel deck|event deck|clash/i;

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } });
  if (!res.ok) throw new Error(`${res.status} for ${url}`);
  return (await res.json()) as T;
}

async function existingCardIds(ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const rows = (await query<{ id: string }>(`SELECT id FROM cards WHERE id = ANY($1)`, [ids])).rows;
  return new Set(rows.map((r) => r.id));
}

function collect(board: MtgjsonCard[] | undefined, boardName: DeckCardEntry["board"], out: { scry: string; entry: DeckCardEntry }[]) {
  for (const c of board ?? []) {
    const scry = c.identifiers?.scryfallId;
    if (!scry) continue;
    out.push({ scry, entry: { cardId: scry, quantity: c.count, board: boardName } });
  }
}

export async function importPrecons(opts: { limit?: number } = {}): Promise<{ made: number; skipped: number }> {
  const limit = opts.limit ?? 500;
  const admin = (await query<{ id: string }>(`SELECT id FROM users WHERE is_admin = true ORDER BY created_at ASC LIMIT 1`)).rows[0];
  if (!admin) throw new Error("No admin user to own the precons.");

  const list = (await getJson<{ data: DeckListEntry[] }>(DECKLIST_URL)).data.filter((d) => WANTED.test(d.type));
  // Commander decks first (most fun), then the rest, capped at `limit`.
  list.sort((a, b) => {
    const ca = /commander/i.test(a.type) ? 0 : 1;
    const cb = /commander/i.test(b.type) ? 0 : 1;
    return ca - cb || b.releaseDate.localeCompare(a.releaseDate);
  });
  const wanted = list.slice(0, limit);

  const existingNames = new Set(
    (await query<{ name: string }>(`SELECT name FROM decks WHERE is_precon = true`)).rows.map((r) => r.name),
  );

  let made = 0;
  let skipped = 0;
  const CONCURRENCY = 6;
  let idx = 0;

  async function worker() {
    while (idx < wanted.length) {
      const item = wanted[idx++]!;
      if (existingNames.has(item.name)) {
        skipped++;
        continue;
      }
      try {
        const deck = (await getJson<{ data: MtgjsonDeck }>(DECK_URL(item.fileName))).data;
        const pairs: { scry: string; entry: DeckCardEntry }[] = [];
        collect(deck.commander, "commander", pairs);
        collect(deck.mainBoard, "main", pairs);
        collect(deck.sideBoard, "sideboard", pairs);
        const present = await existingCardIds(pairs.map((p) => p.scry));
        const cards = pairs.filter((p) => present.has(p.scry)).map((p) => p.entry);
        const mainCount = cards.filter((c) => c.board === "main").reduce((n, c) => n + c.quantity, 0);
        if (mainCount < 20) {
          skipped++;
          continue;
        }
        const formatId = /commander/i.test(deck.type) ? "commander" : "house";
        await createDeck(
          admin!.id,
          { name: deck.name, formatId, description: `${deck.type} · ${deck.code} · ${deck.releaseDate}`, cards },
          true,
        );
        made++;
        if (made % 25 === 0) console.log(`[precons] imported ${made}…`);
      } catch (e) {
        skipped++;
        console.warn(`[precons] skip ${item.name}: ${e instanceof Error ? e.message : e}`);
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
  console.log(`[precons] done: ${made} imported, ${skipped} skipped`);
  return { made, skipped };
}

// CLI entry.
if (import.meta.url === `file://${process.argv[1]}`) {
  const limitArg = process.argv.indexOf("--limit");
  const limit = limitArg >= 0 ? Number(process.argv[limitArg + 1]) : undefined;
  runMigrations()
    .then(() => importPrecons({ limit }))
    .then(() => pool.end())
    .then(() => process.exit(0))
    .catch((e) => {
      console.error("[precons] failed:", e);
      process.exit(1);
    });
}
