import { query } from "../db/pool.js";
import { customCardToForgeScript, type CustomCard, type CustomSet } from "@mtg/shared";

interface SetRow { id: string; code: string; name: string; release_date: string; owner_id: string | null; card_count?: string }
interface CardRow {
  id: string; set_id: string; name: string; mana_cost: string | null; types: string;
  power: string | null; toughness: string | null; loyalty: string | null; keywords: string[];
  oracle: string; flavor: string | null; rarity: string; artist: string | null;
  collector_number: number | null; art_path: string | null; forge_script: string; advanced: boolean;
  frame_theme: string; is_token: boolean;
}

const fmtDate = (d: unknown): string =>
  d instanceof Date ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}` : String(d).slice(0, 10);
const toSet = (r: SetRow): CustomSet => ({ id: r.id, code: r.code, name: r.name, releaseDate: fmtDate(r.release_date), ownerId: r.owner_id, cardCount: r.card_count != null ? Number(r.card_count) : undefined });
const toCard = (r: CardRow): CustomCard => ({
  id: r.id, setId: r.set_id, name: r.name, manaCost: r.mana_cost, types: r.types, power: r.power, toughness: r.toughness,
  loyalty: r.loyalty, keywords: r.keywords ?? [], oracle: r.oracle, flavor: r.flavor, rarity: r.rarity, artist: r.artist,
  collectorNumber: r.collector_number, artPath: r.art_path, forgeScript: r.forge_script, advanced: r.advanced,
  frameTheme: r.frame_theme ?? "classic",
  isToken: r.is_token ?? false,
});

export async function listSets(): Promise<CustomSet[]> {
  const rows = (await query<SetRow>(
    `SELECT s.*, count(c.id) AS card_count FROM custom_sets s LEFT JOIN custom_cards c ON c.set_id = s.id GROUP BY s.id ORDER BY s.name`,
  )).rows;
  return rows.map(toSet);
}

export async function setNameOrCodeTaken(name: string, code: string, exceptId?: string): Promise<boolean> {
  const rows = (await query<{ id: string }>(
    `SELECT id FROM custom_sets WHERE (lower(name) = lower($1) OR lower(code) = lower($2)) AND ($3::uuid IS NULL OR id <> $3)`,
    [name, code, exceptId ?? null],
  )).rows;
  return rows.length > 0;
}

export async function createSet(name: string, code: string, releaseDate: string, ownerId: string): Promise<CustomSet> {
  const r = (await query<SetRow>(
    `INSERT INTO custom_sets (name, code, release_date, owner_id) VALUES ($1,$2,$3,$4) RETURNING *`,
    [name, code, releaseDate, ownerId],
  )).rows[0]!;
  return toSet(r);
}

export async function listCards(setId: string): Promise<CustomCard[]> {
  return (await query<CardRow>(`SELECT * FROM custom_cards WHERE set_id = $1 ORDER BY collector_number NULLS LAST, name`, [setId])).rows.map(toCard);
}

export async function getCard(id: string): Promise<CustomCard | null> {
  const r = (await query<CardRow>(`SELECT * FROM custom_cards WHERE id = $1`, [id])).rows[0];
  return r ? toCard(r) : null;
}

export async function cardNameTaken(setId: string, name: string, exceptId?: string): Promise<boolean> {
  const rows = (await query<{ id: string }>(
    `SELECT id FROM custom_cards WHERE set_id = $1 AND lower(name) = lower($2) AND ($3::uuid IS NULL OR id <> $3)`,
    [setId, name, exceptId ?? null],
  )).rows;
  return rows.length > 0;
}

async function nextCollector(setId: string): Promise<number> {
  const r = (await query<{ n: number | null }>(`SELECT max(collector_number) AS n FROM custom_cards WHERE set_id = $1`, [setId])).rows[0];
  return (r?.n ?? 0) + 1;
}

export type CardInput = Omit<CustomCard, "id" | "collectorNumber"> & { collectorNumber?: number | null };

function scriptFor(c: CardInput): string {
  return customCardToForgeScript({
    name: c.name, manaCost: c.manaCost, types: c.types, power: c.power, toughness: c.toughness,
    loyalty: c.loyalty, keywords: c.keywords, oracle: c.oracle, flavor: c.flavor, advanced: c.advanced, forgeScript: c.forgeScript,
  });
}

export async function createCard(input: CardInput, createdBy: string): Promise<CustomCard> {
  const collector = input.collectorNumber ?? (await nextCollector(input.setId));
  const forge = scriptFor(input);
  const r = (await query<CardRow>(
    `INSERT INTO custom_cards (set_id,name,mana_cost,types,power,toughness,loyalty,keywords,oracle,flavor,rarity,artist,collector_number,forge_script,advanced,created_by,frame_theme,is_token)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING *`,
    [input.setId, input.name, input.manaCost, input.types, input.power, input.toughness, input.loyalty, input.keywords, input.oracle, input.flavor, input.rarity, input.artist, collector, forge, input.advanced, createdBy, input.frameTheme || "classic", input.isToken ?? false],
  )).rows[0]!;
  return toCard(r);
}

export async function updateCard(id: string, input: CardInput): Promise<CustomCard | null> {
  const forge = scriptFor(input);
  const r = (await query<CardRow>(
    `UPDATE custom_cards SET name=$2,mana_cost=$3,types=$4,power=$5,toughness=$6,loyalty=$7,keywords=$8,oracle=$9,flavor=$10,rarity=$11,artist=$12,forge_script=$13,advanced=$14,frame_theme=$15,updated_at=now()
     WHERE id=$1 RETURNING *`,
    [id, input.name, input.manaCost, input.types, input.power, input.toughness, input.loyalty, input.keywords, input.oracle, input.flavor, input.rarity, input.artist, forge, input.advanced, input.frameTheme || "classic"],
  )).rows[0];
  return r ? toCard(r) : null;
}

export async function setArtPath(id: string, artPath: string): Promise<void> {
  await query(`UPDATE custom_cards SET art_path = $2, updated_at = now() WHERE id = $1`, [id, artPath]);
}

export async function deleteCard(id: string): Promise<void> {
  await query(`DELETE FROM custom_cards WHERE id = $1`, [id]);
}

export async function copyCard(id: string, createdBy: string): Promise<CustomCard | null> {
  const c = await getCard(id);
  if (!c) return null;
  let name = `${c.name} (copy)`;
  for (let i = 2; await cardNameTaken(c.setId, name); i++) name = `${c.name} (copy ${i})`;
  return createCard({ ...c, name, artPath: null, collectorNumber: undefined }, createdBy);
}
