// Scryfall bulk-data importer. Streams a (large) bulk JSON array without loading
// it all into memory, maps each card to our schema, and upserts in batches.
//
// Usage (via cli.ts):
//   import:cards                      -> download the "default_cards" bulk file
//   import:cards --type all_cards     -> download a different bulk type
//   import:cards --file ./cards.json  -> import a local file you already have
//
// Scryfall bulk data + usage: https://scryfall.com/docs/api/bulk-data

import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { parseTypeLine, type Color } from "@mtg/shared";
import { pool } from "../db/pool.js";

const BULK_INDEX_URL = "https://api.scryfall.com/bulk-data";
const USER_AGENT = "MtgPvP-selfhosted/0.1 (private family game)";

interface ScryfallImageUris {
  small?: string;
  normal?: string;
  large?: string;
  art_crop?: string;
  png?: string;
}
interface ScryfallFace {
  name: string;
  mana_cost?: string;
  type_line?: string;
  oracle_text?: string;
  flavor_text?: string;
  power?: string;
  toughness?: string;
  loyalty?: string;
  colors?: string[];
  image_uris?: ScryfallImageUris;
}
interface ScryfallCard {
  id: string;
  oracle_id?: string;
  name: string;
  mana_cost?: string;
  cmc?: number;
  type_line?: string;
  oracle_text?: string;
  flavor_text?: string;
  power?: string;
  toughness?: string;
  loyalty?: string;
  colors?: string[];
  color_identity?: string[];
  keywords?: string[];
  set?: string;
  set_name?: string;
  collector_number?: string;
  rarity?: string;
  released_at?: string;
  artist?: string;
  reserved?: boolean;
  digital?: boolean;
  layout?: string;
  legalities?: Record<string, string>;
  image_uris?: ScryfallImageUris;
  card_faces?: ScryfallFace[];
}

export interface CardRow {
  id: string;
  oracle_id: string | null;
  name: string;
  mana_cost: string | null;
  cmc: number;
  type_line: string;
  oracle_text: string | null;
  flavor_text: string | null;
  power: string | null;
  toughness: string | null;
  loyalty: string | null;
  colors: string[];
  color_identity: string[];
  keywords: string[];
  supertypes: string[];
  card_types: string[];
  subtypes: string[];
  set_code: string;
  set_name: string;
  collector_number: string;
  rarity: string;
  released_at: string | null;
  year: number | null;
  artist: string | null;
  reserved: boolean;
  legalities: Record<string, string>;
  faces: unknown;
  image_normal: string | null;
  image_small: string | null;
  image_art_crop: string | null;
  layout: string | null;
  digital: boolean;
}

function pickImages(c: ScryfallCard): { normal: string | null; small: string | null; artCrop: string | null } {
  const top = c.image_uris;
  const face = c.card_faces?.[0]?.image_uris;
  const src = top ?? face;
  return {
    normal: src?.normal ?? src?.large ?? src?.png ?? null,
    small: src?.small ?? src?.normal ?? null,
    artCrop: src?.art_crop ?? null,
  };
}

const WUBRG = new Set(["W", "U", "B", "R", "G"]);
function cleanColors(arr: string[] | undefined): string[] {
  return (arr ?? []).filter((c) => WUBRG.has(c));
}

export function mapCard(c: ScryfallCard): CardRow {
  const { supertypes, cardTypes, subtypes } = parseTypeLine(c.type_line ?? "");
  const img = pickImages(c);
  const released = c.released_at ?? null;
  const faces = (c.card_faces ?? []).map((f) => ({
    name: f.name,
    manaCost: f.mana_cost ?? null,
    typeLine: f.type_line ?? null,
    oracleText: f.oracle_text ?? null,
    flavorText: f.flavor_text ?? null,
    power: f.power ?? null,
    toughness: f.toughness ?? null,
    loyalty: f.loyalty ?? null,
    colors: cleanColors(f.colors) as Color[],
    imageUrl: f.image_uris?.normal ?? f.image_uris?.large ?? null,
  }));
  return {
    id: c.id,
    oracle_id: c.oracle_id ?? null,
    name: c.name,
    mana_cost: c.mana_cost ?? c.card_faces?.[0]?.mana_cost ?? null,
    cmc: c.cmc ?? 0,
    type_line: c.type_line ?? "",
    oracle_text: c.oracle_text ?? c.card_faces?.map((f) => f.oracle_text).filter(Boolean).join("\n") ?? null,
    flavor_text: c.flavor_text ?? null,
    power: c.power ?? null,
    toughness: c.toughness ?? null,
    loyalty: c.loyalty ?? null,
    colors: cleanColors(c.colors ?? c.card_faces?.flatMap((f) => f.colors ?? [])),
    color_identity: cleanColors(c.color_identity),
    keywords: c.keywords ?? [],
    supertypes,
    card_types: cardTypes,
    subtypes,
    set_code: c.set ?? "",
    set_name: c.set_name ?? "",
    collector_number: c.collector_number ?? "",
    rarity: c.rarity ?? "common",
    released_at: released,
    year: released ? Number(released.slice(0, 4)) : null,
    artist: c.artist ?? null,
    reserved: c.reserved ?? false,
    legalities: c.legalities ?? {},
    faces,
    image_normal: img.normal,
    image_small: img.small,
    image_art_crop: img.artCrop,
    layout: c.layout ?? null,
    digital: c.digital ?? false,
  };
}

// ---- streaming JSON-array parser ---------------------------------------
// Yields each top-level object of a JSON array as a parsed value. Handles
// strings/escapes so braces inside strings don't confuse depth tracking.
export async function* streamJsonArray(stream: Readable): AsyncGenerator<unknown> {
  let buf = "";
  let pos = 0; // persistent scan position into buf (NOT reset per chunk)
  let depth = 0; // brace nesting depth relative to the top-level array
  let inString = false;
  let escaped = false;
  let started = false; // seen the opening '['
  let objStart = -1;

  for await (const chunkRaw of stream) {
    buf += chunkRaw.toString();
    while (pos < buf.length) {
      const ch = buf[pos]!;
      if (!started) {
        if (ch === "[") started = true;
        pos++;
        continue;
      }
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === "\\") escaped = true;
        else if (ch === '"') inString = false;
        pos++;
        continue;
      }
      if (ch === '"') {
        inString = true;
        pos++;
        continue;
      }
      if (ch === "{") {
        if (depth === 0) objStart = pos;
        depth++;
        pos++;
        continue;
      }
      if (ch === "}") {
        depth--;
        pos++;
        if (depth === 0 && objStart >= 0) {
          yield JSON.parse(buf.slice(objStart, pos));
          // Drop the consumed prefix and restart scanning from 0.
          buf = buf.slice(pos);
          pos = 0;
          objStart = -1;
        }
        continue;
      }
      pos++;
    }
  }
}

// ---- batch upsert ------------------------------------------------------
const COLUMNS = [
  "id", "oracle_id", "name", "mana_cost", "cmc", "type_line", "oracle_text",
  "flavor_text", "power", "toughness", "loyalty", "colors", "color_identity",
  "keywords", "supertypes", "card_types", "subtypes", "set_code", "set_name",
  "collector_number", "rarity", "released_at", "year", "artist", "reserved",
  "legalities", "faces", "image_normal", "image_small", "image_art_crop",
  "layout", "digital",
] as const;

function rowValues(r: CardRow): unknown[] {
  return [
    r.id, r.oracle_id, r.name, r.mana_cost, r.cmc, r.type_line, r.oracle_text,
    r.flavor_text, r.power, r.toughness, r.loyalty, r.colors, r.color_identity,
    r.keywords, r.supertypes, r.card_types, r.subtypes, r.set_code, r.set_name,
    r.collector_number, r.rarity, r.released_at, r.year, r.artist, r.reserved,
    JSON.stringify(r.legalities), JSON.stringify(r.faces), r.image_normal,
    r.image_small, r.image_art_crop, r.layout, r.digital,
  ];
}

async function upsertBatch(rows: CardRow[]): Promise<void> {
  if (rows.length === 0) return;
  const cols = COLUMNS.length;
  const valuesSql: string[] = [];
  const params: unknown[] = [];
  rows.forEach((r, idx) => {
    const base = idx * cols;
    const placeholders = Array.from({ length: cols }, (_, j) => `$${base + j + 1}`);
    valuesSql.push(`(${placeholders.join(",")})`);
    params.push(...rowValues(r));
  });
  const updates = COLUMNS.filter((c) => c !== "id").map((c) => `${c} = EXCLUDED.${c}`).join(", ");
  const sql =
    `INSERT INTO cards (${COLUMNS.join(",")}) VALUES ${valuesSql.join(",")} ` +
    `ON CONFLICT (id) DO UPDATE SET ${updates}`;
  await pool.query(sql, params as any[]);
}

export interface ImportOptions {
  file?: string;
  type?: string; // bulk data type id, e.g. default_cards
  onProgress?: (count: number) => void;
}

async function openSource(opts: ImportOptions): Promise<{ stream: Readable; source: string }> {
  if (opts.file) {
    return { stream: createReadStream(opts.file, { encoding: "utf8" }), source: `file:${opts.file}` };
  }
  const type = opts.type ?? "default_cards";
  const idxRes = await fetch(BULK_INDEX_URL, { headers: { "User-Agent": USER_AGENT, Accept: "application/json" } });
  if (!idxRes.ok) throw new Error(`Failed to fetch bulk index: ${idxRes.status}`);
  const idx = (await idxRes.json()) as { data: Array<{ type: string; download_uri: string; name: string }> };
  const entry = idx.data.find((d) => d.type === type);
  if (!entry) throw new Error(`Bulk type "${type}" not found. Options: ${idx.data.map((d) => d.type).join(", ")}`);
  console.log(`[import] downloading ${entry.name} …`);
  const dlRes = await fetch(entry.download_uri, { headers: { "User-Agent": USER_AGENT } });
  if (!dlRes.ok || !dlRes.body) throw new Error(`Failed to download bulk file: ${dlRes.status}`);
  const stream = Readable.fromWeb(dlRes.body as any);
  return { stream, source: `scryfall:${type}` };
}

export async function importCards(opts: ImportOptions = {}): Promise<{ count: number; source: string }> {
  const { stream, source } = await openSource(opts);
  const BATCH = 400;
  // Only skip pure-artwork cards (art-series booster inserts like
  // "Marchesa... // Marchesa..." with no rules text). Tokens and emblems ARE
  // kept — they're needed so cards that create tokens can put the real token on
  // the battlefield (see the token picker). They're excluded from normal card
  // browsing via EXCLUDE_NONCARD, not from the database.
  const SKIP_LAYOUTS = new Set(["art_series", "sticker"]);
  let batch: CardRow[] = [];
  let count = 0;
  for await (const obj of streamJsonArray(stream)) {
    const c = obj as ScryfallCard;
    if (!c || !c.id || !c.name) continue;
    if (c.layout && SKIP_LAYOUTS.has(c.layout)) continue;
    batch.push(mapCard(c));
    if (batch.length >= BATCH) {
      await upsertBatch(batch);
      count += batch.length;
      batch = [];
      if (count % 4000 === 0) {
        console.log(`[import] ${count} cards…`);
        opts.onProgress?.(count);
      }
    }
  }
  if (batch.length) {
    await upsertBatch(batch);
    count += batch.length;
  }
  await pool.query(
    `INSERT INTO import_meta(id, imported_at, card_count, source) VALUES (1, now(), $1, $2)
     ON CONFLICT (id) DO UPDATE SET imported_at = now(), card_count = $1, source = $2`,
    [count, source],
  );
  console.log(`[import] done: ${count} cards from ${source}`);
  return { count, source };
}
