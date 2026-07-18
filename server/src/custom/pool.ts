// Mirror custom cards into the main `cards` pool so they're first-class for
// Browse, the deck builder, deck reading, and Forge export. The row shares the
// custom card's id; `is_custom = true` marks it, and the image route serves the
// composited render for those ids.
import { query } from "../db/pool.js";
import type { CustomCard } from "@mtg/shared";
import { getCard } from "./repo.js";
import { renderCard } from "./frame.js";

const SUPERTYPES = new Set(["Legendary", "Basic", "Snow", "World", "Ongoing", "Host", "Elite"]);
const CARD_TYPES = new Set([
  "Creature", "Instant", "Sorcery", "Artifact", "Enchantment", "Planeswalker", "Land", "Battle",
  "Tribal", "Kindred", "Plane", "Phenomenon", "Scheme", "Vanguard", "Conspiracy", "Dungeon",
]);
const RARITY: Record<string, string> = { C: "common", U: "uncommon", R: "rare", M: "mythic", S: "special", L: "common" };

// Custom cards aren't sanctioned in any real format, so every Scryfall legality
// key is "not_legal" — NOT "banned" (they were never in a format to be banned).
// They stay fully playable in casual/home formats (the "house" format and the
// "Anything goes" ruleset have legalityKey=null, so no per-card legality check).
const LEGALITY_KEYS = [
  "standard", "future", "historic", "timeless", "gladiator", "pioneer", "explorer", "modern", "legacy",
  "pauper", "vintage", "penny", "commander", "oathbreaker", "standardbrawl", "brawl", "alchemy",
  "paupercommander", "duel", "oldschool", "premodern", "predh",
];
const NOT_LEGAL_ALL = Object.fromEntries(LEGALITY_KEYS.map((k) => [k, "not_legal"]));

// Forge mana ("3 W U") → Scryfall mana string ("{3}{W}{U}"), colors, and cmc.
function convertMana(cost: string | null): { scryfall: string; colors: string[]; cmc: number } {
  const toks = (cost ?? "").trim().split(/\s+/).filter(Boolean);
  const colors = new Set<string>();
  let cmc = 0;
  const parts: string[] = [];
  for (const t of toks) {
    const u = t.toUpperCase();
    parts.push(`{${u}}`);
    if (/^\d+$/.test(u)) cmc += Number(u);
    else if (u === "X") { /* 0 */ }
    else { cmc += 1; for (const c of ["W", "U", "B", "R", "G"]) if (u.includes(c)) colors.add(c); }
  }
  return { scryfall: parts.join(""), colors: [...colors], cmc };
}

// Split a type line into supertypes / card types / subtypes.
function parseTypes(typeLine: string): { supertypes: string[]; cardTypes: string[]; subtypes: string[] } {
  const [left, right] = typeLine.split(/\s+[—-]\s+|\s+—|—\s+|—/).map((s) => s?.trim() ?? "");
  const supertypes: string[] = [], cardTypes: string[] = [];
  for (const w of (left || typeLine).split(/\s+/).filter(Boolean)) {
    if (SUPERTYPES.has(w)) supertypes.push(w);
    else if (CARD_TYPES.has(w)) cardTypes.push(w);
  }
  const subtypes = (right ?? "").split(/\s+/).filter(Boolean);
  return { supertypes, cardTypes, subtypes };
}

export async function mirrorCard(card: CustomCard): Promise<void> {
  const { scryfall, colors, cmc } = convertMana(card.manaCost);
  const { supertypes, cardTypes, subtypes } = parseTypes(card.types);
  const setRow = (await query<{ code: string; name: string; release_date: unknown }>(
    `SELECT code, name, release_date FROM custom_sets WHERE id = $1`, [card.setId],
  )).rows[0];
  // Real Scryfall set codes are lowercase and the search filter does
  // `set_code = lower(query)`, so mirror the custom code lowercased (the Forge
  // edition code stays uppercase separately in custom_sets.code).
  const setCode = (setRow?.code ?? "CUST").toLowerCase();
  const rd = setRow?.release_date;
  const released = rd instanceof Date ? rd.toISOString().slice(0, 10) : rd ? String(rd).slice(0, 10) : null;
  await query(
    `INSERT INTO cards (
        id, oracle_id, name, mana_cost, cmc, type_line, oracle_text, flavor_text,
        power, toughness, loyalty, colors, color_identity, keywords,
        supertypes, card_types, subtypes, set_code, set_name, collector_number,
        rarity, released_at, year, artist, legalities, image_normal, image_small, image_art_crop, is_custom
     ) VALUES (
        $1,$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11,$12,$13,$14,$15,$16,$17,$18,
        $19,$20,$21,$22,$23,$24,$24,$24,true
     )
     ON CONFLICT (id) DO UPDATE SET
        name=EXCLUDED.name, mana_cost=EXCLUDED.mana_cost, cmc=EXCLUDED.cmc, type_line=EXCLUDED.type_line,
        oracle_text=EXCLUDED.oracle_text, flavor_text=EXCLUDED.flavor_text, power=EXCLUDED.power,
        toughness=EXCLUDED.toughness, loyalty=EXCLUDED.loyalty, colors=EXCLUDED.colors,
        color_identity=EXCLUDED.color_identity, keywords=EXCLUDED.keywords, supertypes=EXCLUDED.supertypes,
        card_types=EXCLUDED.card_types, subtypes=EXCLUDED.subtypes, set_code=EXCLUDED.set_code,
        set_name=EXCLUDED.set_name, collector_number=EXCLUDED.collector_number, rarity=EXCLUDED.rarity,
        released_at=EXCLUDED.released_at, year=EXCLUDED.year, artist=EXCLUDED.artist,
        legalities=EXCLUDED.legalities, image_normal=EXCLUDED.image_normal, is_custom=true`,
    [
      card.id, card.name, scryfall, cmc, card.types, card.oracle || null, card.flavor,
      card.power, card.toughness, card.loyalty, colors, card.keywords,
      supertypes, cardTypes, subtypes, setCode, setRow?.name ?? "Custom", String(card.collectorNumber ?? ""),
      RARITY[card.rarity] ?? "common", released, released ? Number(released.slice(0, 4)) : null,
      card.artist, JSON.stringify(NOT_LEGAL_ALL), `/api/cards/${card.id}/image`,
    ],
  );
}

export async function unmirrorCard(id: string): Promise<void> {
  await query(`DELETE FROM cards WHERE id = $1 AND is_custom = true`, [id]);
}

// The composited full-card image for a custom card id, or null if not custom.
export async function renderCustomCardImage(id: string): Promise<Buffer | null> {
  const card = await getCard(id);
  if (!card) return null;
  const artRow = (await query<{ data: Buffer; tx_scale: number; tx_dx: number; tx_dy: number }>(
    `SELECT data, tx_scale, tx_dx, tx_dy FROM custom_art WHERE card_id = $1`, [id],
  )).rows[0];
  const tx = artRow ? { scale: artRow.tx_scale, dx: artRow.tx_dx, dy: artRow.tx_dy } : undefined;
  return renderCard(card, artRow ? Buffer.from(artRow.data) : null, tx);
}

// Backfill: mirror every existing custom card into the pool (run once on boot).
export async function backfillCustomPool(): Promise<number> {
  const ids = (await query<{ id: string }>(`SELECT id FROM custom_cards`)).rows;
  let n = 0;
  for (const { id } of ids) { const c = await getCard(id); if (c && !c.isToken) { await mirrorCard(c); n++; } }
  return n;
}
