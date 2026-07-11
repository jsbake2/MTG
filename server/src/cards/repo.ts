import {
  parseQuery,
  type Card,
  type CardFace,
  type CardSummary,
  type Color,
  type Legality,
  type Rarity,
  type SearchGroup,
  type SearchRequest,
  type SearchResponse,
} from "@mtg/shared";
import { query } from "../db/pool.js";
import {
  buildQuery,
  Params,
  termAnyExpr,
  termAreExpr,
  termRefExpr,
} from "./search.js";

interface CardDbRow {
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
  faces: Array<Omit<CardFace, "imageUrl"> & { imageUrl: string | null }>;
  image_normal: string | null;
  image_small: string | null;
  layout: string | null;
}

function imgPath(id: string, hasImage: boolean, face?: number): string | null {
  if (!hasImage) return null;
  return face !== undefined ? `/api/cards/${id}/image?face=${face}` : `/api/cards/${id}/image`;
}

export function rowToCard(r: CardDbRow): Card {
  return {
    id: r.id,
    oracleId: r.oracle_id ?? r.id,
    name: r.name,
    imageUrl: imgPath(r.id, !!r.image_normal),
    manaCost: r.mana_cost,
    cmc: r.cmc,
    typeLine: r.type_line,
    oracleText: r.oracle_text,
    flavorText: r.flavor_text,
    power: r.power,
    toughness: r.toughness,
    loyalty: r.loyalty,
    colors: r.colors as Color[],
    colorIdentity: r.color_identity as Color[],
    keywords: r.keywords,
    supertypes: r.supertypes,
    cardTypes: r.card_types,
    subtypes: r.subtypes,
    setCode: r.set_code,
    setName: r.set_name,
    collectorNumber: r.collector_number,
    rarity: r.rarity as Rarity,
    releasedAt: r.released_at ?? "",
    year: r.year ?? 0,
    artist: r.artist,
    legalities: r.legalities as Record<string, Legality>,
    reserved: r.reserved,
    faces: (r.faces ?? []).map((f, i) => ({
      ...f,
      colors: (f.colors ?? []) as Color[],
      imageUrl: f.imageUrl ? imgPath(r.id, true, i) : null,
    })),
  };
}

function rowToSummary(r: CardDbRow): CardSummary {
  return {
    id: r.id,
    oracleId: r.oracle_id ?? r.id,
    name: r.name,
    imageUrl: imgPath(r.id, !!r.image_normal),
    manaCost: r.mana_cost,
    cmc: r.cmc,
    typeLine: r.type_line,
    colors: r.colors as Color[],
    cardTypes: r.card_types,
    rarity: r.rarity as Rarity,
    setCode: r.set_code,
    year: r.year ?? 0,
  };
}

// Keep browse/deck results to real, playable cards: no tokens/emblems/etc, and
// no joke cards (un-sets = set_type 'funny'), test/playtest cards, or
// gold-bordered collector reprints (set_type 'memorabilia' / silver borders).
const EXCLUDE_NONCARD =
  "coalesce(layout,'') NOT IN ('art_series','double_faced_token','token','emblem','scheme','planar','vanguard','sticker','augment','host') " +
  "AND coalesce(set_type,'') NOT IN ('funny','memorabilia') " +
  "AND coalesce(border_color,'') NOT IN ('silver')";

const SUMMARY_COLS =
  "id, oracle_id, name, mana_cost, cmc, type_line, colors, card_types, rarity, set_code, year, image_normal, image_small";
const FULL_COLS = "*";

function orderBy(sort: SearchRequest["sort"], dir: SearchRequest["dir"]): string {
  const d = dir === "desc" ? "DESC" : "ASC";
  switch (sort) {
    case "cmc":
      return `cmc ${d}, name ASC`;
    case "released":
      return `released_at ${d} NULLS LAST, name ASC`;
    case "rarity":
      return `array_position(ARRAY['common','uncommon','rare','mythic','special','bonus'], rarity) ${d} NULLS LAST, name ASC`;
    case "color":
      return `array_length(colors,1) ${d} NULLS FIRST, name ASC`;
    case "name":
    default:
      return `name ${d}`;
  }
}

// De-duplicate to one printing per oracle card (newest), so the browser shows a
// card once by default. We keep the newest printing via DISTINCT ON.
function distinctOnOracle(where: string, order: string, limit: string, offset: string): string {
  // Wrap: pick newest printing per oracle_id, then order/paginate.
  return `
    SELECT ${SUMMARY_COLS} FROM (
      SELECT DISTINCT ON (coalesce(oracle_id, id)) ${SUMMARY_COLS}
      FROM cards
      WHERE ${where}
      ORDER BY coalesce(oracle_id, id), released_at DESC NULLS LAST
    ) c
    ORDER BY ${order}
    LIMIT ${limit} OFFSET ${offset}`;
}

async function runGroup(
  label: string,
  key: SearchGroup["key"],
  where: string,
  params: unknown[],
  order: string,
  page: number,
  pageSize: number,
): Promise<SearchGroup> {
  const limitP = `$${params.length + 1}`;
  const offsetP = `$${params.length + 2}`;
  const rows = (
    await query<CardDbRow>(distinctOnOracle(where, order, limitP, offsetP), [
      ...params,
      pageSize,
      (page - 1) * pageSize,
    ])
  ).rows;
  const countRes = await query<{ n: string }>(
    `SELECT count(*)::text AS n FROM (
       SELECT DISTINCT coalesce(oracle_id, id) FROM cards WHERE ${where}
     ) c`,
    params,
  );
  return {
    key,
    label,
    total: Number(countRes.rows[0]?.n ?? 0),
    cards: rows.map(rowToSummary),
  };
}

export async function searchCards(req: SearchRequest): Promise<SearchResponse> {
  const page = Math.max(1, req.page ?? 1);
  const pageSize = Math.min(120, Math.max(1, req.pageSize ?? 60));
  const order = orderBy(req.sort, req.dir);
  const parsed = parseQuery(req.q ?? "");

  try {
    const p = new Params();
    const built = buildQuery(parsed, p);
    // Always exclude non-gameplay layouts (art cards, tokens, emblems, etc.) —
    // e.g. art-series cards like "Marchesa, Dealer of Death // Marchesa..." that
    // are just artwork with no rules text.
    const base = [...built.baseClauses, EXCLUDE_NONCARD];
    const baseWhere = base.length ? base.join(" AND ") : "TRUE";

    // Grouped discovery mode (the "vampire" case): split ARE vs REFERENCES.
    if (req.group && built.positiveTerms.length > 0) {
      // ARE group
      const areParts = [...base];
      for (const t of built.positiveTerms) areParts.push(termAreExpr(t, p));
      const areWhere = areParts.join(" AND ");
      const areParams = [...p.values];
      const are = await runGroup("Cards that ARE this", "are", areWhere, areParams, order, page, pageSize);

      // REFERENCES group (mentions in text, but not one of the ARE cards)
      const p2 = new Params();
      const built2 = buildQuery(parsed, p2);
      const refParts = [...built2.baseClauses];
      for (const t of built2.positiveTerms) {
        refParts.push(`coalesce(oracle_text,'') ILIKE '%' || ${p2.add(t)} || '%'`);
      }
      const notAre = built2.positiveTerms.map((t) => termAreExpr(t, p2)).join(" AND ");
      if (notAre) refParts.push(`NOT (${notAre})`);
      refParts.push(EXCLUDE_NONCARD);
      const refWhere = refParts.join(" AND ");
      const refs = await runGroup(
        "Cards that REFERENCE this",
        "references",
        refWhere,
        p2.values,
        order,
        page,
        pageSize,
      );

      return {
        total: are.total + refs.total,
        page,
        pageSize,
        groups: [are, refs].filter((g) => g.total > 0 || built.positiveTerms.length > 0),
        interpreted: built.interpreted,
      };
    }

    // Flat mode: positive terms match anywhere.
    const flatParts = [...base];
    for (const t of built.positiveTerms) flatParts.push(termAnyExpr(t, p));
    const flatWhere = flatParts.length ? flatParts.join(" AND ") : baseWhere;
    const all = await runGroup("Results", "all", flatWhere, p.values, order, page, pageSize);
    return {
      total: all.total,
      page,
      pageSize,
      groups: [all],
      interpreted: built.interpreted,
    };
  } catch (e) {
    return {
      total: 0,
      page,
      pageSize,
      groups: [],
      interpreted: [],
      error: e instanceof Error ? e.message : "Invalid search query",
    };
  }
}

export async function getCardById(id: string): Promise<Card | null> {
  const r = (await query<CardDbRow>(`SELECT ${FULL_COLS} FROM cards WHERE id = $1`, [id])).rows[0];
  return r ? rowToCard(r) : null;
}

export async function getCardsByIds(ids: string[]): Promise<Map<string, Card>> {
  if (ids.length === 0) return new Map();
  const rows = (await query<CardDbRow>(`SELECT ${FULL_COLS} FROM cards WHERE id = ANY($1)`, [ids])).rows;
  return new Map(rows.map((r) => [r.id, rowToCard(r)]));
}

export async function getPrintings(oracleId: string): Promise<CardSummary[]> {
  const rows = (
    await query<CardDbRow>(
      `SELECT ${SUMMARY_COLS} FROM cards WHERE oracle_id = $1 ORDER BY released_at DESC NULLS LAST`,
      [oracleId],
    )
  ).rows;
  return rows.map(rowToSummary);
}

export async function getImageSource(id: string): Promise<{ url: string; face: number } | null> {
  const r = (
    await query<{ image_normal: string | null; faces: Array<{ imageUrl: string | null }> }>(
      `SELECT image_normal, faces FROM cards WHERE id = $1`,
      [id],
    )
  ).rows[0];
  if (!r) return null;
  return { url: r.image_normal ?? "", face: 0 };
}

export async function getArtCropUrl(id: string): Promise<string | null> {
  const r = (await query<{ image_art_crop: string | null }>(`SELECT image_art_crop FROM cards WHERE id = $1`, [id])).rows[0];
  return r?.image_art_crop ?? null;
}

export async function getFaceImageUrl(id: string, face: number): Promise<string | null> {
  const r = (
    await query<{ image_normal: string | null; faces: Array<{ imageUrl: string | null }> }>(
      `SELECT image_normal, faces FROM cards WHERE id = $1`,
      [id],
    )
  ).rows[0];
  if (!r) return null;
  if (face > 0 && r.faces && r.faces[face]?.imageUrl) return r.faces[face]!.imageUrl;
  if (r.faces && r.faces[face]?.imageUrl) return r.faces[face]!.imageUrl;
  return r.image_normal;
}

export interface TokenCard {
  id: string;
  name: string;
  typeLine: string;
  power: string | null;
  toughness: string | null;
  colors: string[];
  imageUrl: string | null;
}

// Search only token/emblem cards, for the in-game token picker.
export async function searchTokens(q: string): Promise<TokenCard[]> {
  const term = `%${q.trim()}%`;
  const rows = (
    await query<CardDbRow>(
      `SELECT DISTINCT ON (coalesce(oracle_id, id)) ${FULL_COLS} FROM cards
       WHERE layout IN ('token','double_faced_token','emblem')
         AND coalesce(set_type,'') <> 'funny'
         AND ($1 = '%%' OR name ILIKE $1 OR type_line ILIKE $1)
       ORDER BY coalesce(oracle_id, id), released_at DESC NULLS LAST
       LIMIT 60`,
      [term],
    )
  ).rows;
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    typeLine: r.type_line,
    power: r.power,
    toughness: r.toughness,
    colors: r.colors,
    imageUrl: imgPath(r.id, !!r.image_normal),
  }));
}

export async function getImportMeta(): Promise<{ importedAt: string | null; cardCount: number; source: string | null }> {
  const r = (
    await query<{ imported_at: string | null; card_count: number; source: string | null }>(
      `SELECT imported_at, card_count, source FROM import_meta WHERE id = 1`,
    )
  ).rows[0];
  return {
    importedAt: r?.imported_at ?? null,
    cardCount: r?.card_count ?? 0,
    source: r?.source ?? null,
  };
}
