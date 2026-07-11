// Card model shared between server and client. This is a trimmed, normalized
// projection of a Scryfall card object — the fields we actually use for search,
// deck building, and the game table. See scryfall-data-source memory / docs.

export type Color = "W" | "U" | "B" | "R" | "G";
export const COLORS: Color[] = ["W", "U", "B", "R", "G"];
export const COLOR_NAMES: Record<Color, string> = {
  W: "White",
  U: "Blue",
  B: "Black",
  R: "Red",
  G: "Green",
};

export type Rarity = "common" | "uncommon" | "rare" | "mythic" | "special" | "bonus";

// Scryfall legality values for a given format.
export type Legality = "legal" | "not_legal" | "restricted" | "banned";

// One physical face of a card (split, transform, modal DFC, adventure, etc.).
export interface CardFace {
  name: string;
  manaCost: string | null;
  typeLine: string | null;
  oracleText: string | null;
  flavorText: string | null;
  power: string | null;
  toughness: string | null;
  loyalty: string | null;
  colors: Color[];
  // Relative path served by the app, e.g. /api/cards/<id>/image?face=0
  imageUrl: string | null;
}

// A card as stored/served by the app. `id` is the Scryfall UUID of the printing.
// `oracleId` groups all printings of the same game piece together.
export interface Card {
  id: string;
  oracleId: string;
  name: string;
  // Convenience: the front face image (or the only image).
  imageUrl: string | null;

  manaCost: string | null;
  cmc: number;
  typeLine: string;
  oracleText: string | null;
  flavorText: string | null;
  power: string | null;
  toughness: string | null;
  loyalty: string | null;

  colors: Color[];
  colorIdentity: Color[];
  keywords: string[];
  // Parsed from the type line: supertypes, card types, subtypes.
  supertypes: string[];
  cardTypes: string[];
  subtypes: string[];

  // Printing/tagging metadata.
  setCode: string;
  setName: string;
  collectorNumber: string;
  rarity: Rarity;
  releasedAt: string; // ISO date
  year: number;
  artist: string | null;

  // Per-format legality straight from Scryfall (format -> legality).
  legalities: Record<string, Legality>;

  reserved: boolean;
  // Multi-face cards. Empty for normal single-face cards.
  faces: CardFace[];
}

// A lighter projection used in search result lists (keeps payloads small).
export interface CardSummary {
  id: string;
  oracleId: string;
  name: string;
  imageUrl: string | null;
  manaCost: string | null;
  cmc: number;
  typeLine: string;
  colors: Color[];
  cardTypes: string[];
  rarity: Rarity;
  setCode: string;
  year: number;
}

export function isLandType(typeLine: string): boolean {
  return /\bLand\b/i.test(typeLine);
}

export function isCreatureType(typeLine: string): boolean {
  return /\bCreature\b/i.test(typeLine);
}

// Parse a Scryfall-style type line ("Legendary Creature — Vampire Noble") into
// its three buckets. Card-agnostic — used by both the deck builder and the
// framework rules engine.
const SUPERTYPES = new Set([
  "Basic",
  "Legendary",
  "Snow",
  "World",
  "Ongoing",
  "Host",
  "Elite",
]);

export function parseTypeLine(typeLine: string): {
  supertypes: string[];
  cardTypes: string[];
  subtypes: string[];
} {
  // Faces are joined with " // "; use the front for type parsing.
  const front = typeLine.split(" // ")[0] ?? typeLine;
  const [left, right] = front.split(/\s+[—–-]\s+/);
  const leftWords = (left ?? "").trim().split(/\s+/).filter(Boolean);
  const supertypes: string[] = [];
  const cardTypes: string[] = [];
  for (const w of leftWords) {
    if (SUPERTYPES.has(w)) supertypes.push(w);
    else cardTypes.push(w);
  }
  const subtypes = (right ?? "").trim().split(/\s+/).filter(Boolean);
  return { supertypes, cardTypes, subtypes };
}
