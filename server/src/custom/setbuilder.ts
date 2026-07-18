// Set-builder support: reprints (real cards pulled into a custom set as filler)
// and set composition stats — plus read-only stats/browse for real official sets
// so you can study what a "complete" set looks like.
import { query } from "../db/pool.js";
import { rowToSummary, type CardDbRow } from "../cards/repo.js";
import type { CardSummary } from "@mtg/shared";

const SUMMARY_COLS = "id, oracle_id, name, mana_cost, cmc, type_line, colors, card_types, rarity, set_code, year, image_normal, image_small";
// Same non-gameplay exclusions the browser uses, so real-set study is clean.
const EXCLUDE_NONCARD =
  "coalesce(layout,'') NOT IN ('art_series','double_faced_token','token','emblem','scheme','planar','vanguard','sticker','augment','host') " +
  "AND coalesce(set_type,'') NOT IN ('funny','memorabilia') AND coalesce(border_color,'') NOT IN ('silver')";

export interface Reprint { card: CardSummary; rarity: string; collectorNumber: number | null }

export async function listReprints(setId: string): Promise<Reprint[]> {
  const rows = (await query<CardDbRow & { r_rarity: string; r_num: number | null }>(
    `SELECT c.*, sc.rarity AS r_rarity, sc.collector_number AS r_num
       FROM custom_set_cards sc JOIN cards c ON c.id = sc.card_id
      WHERE sc.set_id = $1 ORDER BY sc.collector_number NULLS LAST, c.name`,
    [setId],
  )).rows;
  return rows.map((r) => ({ card: rowToSummary(r), rarity: r.r_rarity, collectorNumber: r.r_num }));
}

// Map a Scryfall rarity to our custom C/U/R/M/S/L code (for a sensible default).
const RARITY_CODE: Record<string, string> = { common: "C", uncommon: "U", rare: "R", mythic: "M", special: "S", bonus: "S", land: "L" };

export async function addReprint(setId: string, cardId: string, rarity?: string): Promise<void> {
  const card = (await query<{ rarity: string; type_line: string }>(`SELECT rarity, type_line FROM cards WHERE id = $1`, [cardId])).rows[0];
  if (!card) throw new Error("Card not found");
  const r = rarity || (/\bbasic\b/i.test(card.type_line) ? "L" : RARITY_CODE[card.rarity] ?? "C");
  const next = (await query<{ n: number | null }>(
    `SELECT max(collector_number) AS n FROM (
        SELECT collector_number FROM custom_set_cards WHERE set_id = $1
        UNION ALL SELECT collector_number FROM custom_cards WHERE set_id = $1
     ) t`, [setId],
  )).rows[0]?.n ?? 0;
  await query(
    `INSERT INTO custom_set_cards (set_id, card_id, rarity, collector_number) VALUES ($1,$2,$3,$4)
     ON CONFLICT (set_id, card_id) DO UPDATE SET rarity = EXCLUDED.rarity`,
    [setId, cardId, r, next + 1],
  );
}

export async function removeReprint(setId: string, cardId: string): Promise<void> {
  await query(`DELETE FROM custom_set_cards WHERE set_id = $1 AND card_id = $2`, [setId, cardId]);
}

export async function updateReprint(setId: string, cardId: string, patch: { rarity?: string; collectorNumber?: number | null }): Promise<void> {
  await query(
    `UPDATE custom_set_cards SET rarity = COALESCE($3, rarity), collector_number = COALESCE($4, collector_number)
      WHERE set_id = $1 AND card_id = $2`,
    [setId, cardId, patch.rarity ?? null, patch.collectorNumber ?? null],
  );
}

export interface SetStats {
  total: number;
  byRarity: Record<string, number>;
  byColor: Record<string, number>; // W U B R G + C(olorless) + M(ulti)
  byType: Record<string, number>;
  curve: number[]; // index 0..7, last = 7+
}

function tallyStats(rows: Array<{ colors: string[]; card_types: string[]; cmc: number; rarity: string }>): SetStats {
  const s: SetStats = { total: rows.length, byRarity: {}, byColor: {}, byType: {}, curve: [0, 0, 0, 0, 0, 0, 0, 0] };
  const TYPES = ["Creature", "Instant", "Sorcery", "Artifact", "Enchantment", "Planeswalker", "Land", "Battle"];
  for (const r of rows) {
    s.byRarity[r.rarity] = (s.byRarity[r.rarity] ?? 0) + 1;
    const cols = r.colors ?? [];
    const key = cols.length === 0 ? "C" : cols.length > 1 ? "M" : cols[0]!;
    s.byColor[key] = (s.byColor[key] ?? 0) + 1;
    const t = TYPES.find((x) => (r.card_types ?? []).includes(x)) ?? "Other";
    s.byType[t] = (s.byType[t] ?? 0) + 1;
    s.curve[Math.min(7, Math.max(0, Math.round(r.cmc || 0)))]!++;
  }
  return s;
}

// Stats for a custom set = its native authored cards + its reprints. Native cards
// are mirrored into `cards`, so both sides read from `cards`; rarity is the set's.
export async function customSetStats(setId: string): Promise<SetStats> {
  const rows = (await query<{ colors: string[]; card_types: string[]; cmc: number; rarity: string }>(
    `SELECT c.colors, c.card_types, c.cmc, COALESCE(sc.rarity, cc.rarity) AS rarity
       FROM cards c
       LEFT JOIN custom_set_cards sc ON sc.set_id = $1 AND sc.card_id = c.id
       LEFT JOIN custom_cards cc ON cc.set_id = $1 AND cc.id = c.id
      WHERE sc.card_id IS NOT NULL OR cc.id IS NOT NULL`,
    [setId],
  )).rows;
  return tallyStats(rows);
}

// ---- read-only study of real official sets -----------------------------
export async function listRealSets(): Promise<Array<{ code: string; name: string; count: number; released: string | null }>> {
  return (await query<{ code: string; name: string; count: string; released: string | null }>(
    `SELECT set_code AS code, max(set_name) AS name, count(*) AS count, max(released_at)::text AS released
       FROM cards WHERE ${EXCLUDE_NONCARD} AND coalesce(is_custom,false) = false AND set_code <> ''
      GROUP BY set_code HAVING count(*) >= 20
      ORDER BY max(released_at) DESC NULLS LAST`,
  )).rows.map((r) => ({ code: r.code, name: r.name, count: Number(r.count), released: r.released }));
}

export async function realSetStats(code: string): Promise<SetStats> {
  const rows = (await query<{ colors: string[]; card_types: string[]; cmc: number; rarity: string }>(
    `SELECT colors, card_types, cmc, rarity FROM cards WHERE set_code = $1 AND ${EXCLUDE_NONCARD}`,
    [code],
  )).rows;
  return tallyStats(rows);
}

export async function realSetCards(code: string): Promise<CardSummary[]> {
  const rows = (await query<CardDbRow>(
    `SELECT ${SUMMARY_COLS} FROM cards WHERE set_code = $1 AND ${EXCLUDE_NONCARD}
      ORDER BY array_position(ARRAY['common','uncommon','rare','mythic','special','bonus'], rarity), name`,
    [code],
  )).rows;
  return rows.map(rowToSummary);
}
