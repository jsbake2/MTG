// REST API DTOs shared between client and server.

import type { Card, CardSummary } from "./cards.js";
import type { DeckValidationIssue } from "./formats.js";
import type { TableMode } from "./game.js";

export interface User {
  id: string;
  username: string;
  displayName: string;
  isAdmin: boolean;
  avatarCardId: string | null;
  createdAt: string;
}

export interface LoginRequest {
  username: string;
  password: string;
}

export interface RegisterRequest {
  username: string;
  displayName: string;
  password: string;
  inviteCode?: string;
}

export interface AuthResponse {
  user: User;
}

// ---- Cards / search ----

export interface SearchRequest {
  q: string;
  page?: number;
  pageSize?: number;
  sort?: "name" | "cmc" | "released" | "color" | "rarity";
  dir?: "asc" | "desc";
  // When true, a bare term is split into ARE vs REFERENCES buckets.
  group?: boolean;
  // When true, free-text terms match card NAMES only (not type line or rules text).
  nameOnly?: boolean;
}

export interface SearchGroup {
  key: "are" | "references" | "all";
  label: string;
  total: number;
  cards: CardSummary[];
}

export interface SearchResponse {
  total: number;
  page: number;
  pageSize: number;
  groups: SearchGroup[];
  // Echo of how the server understood the query, for the UI to display.
  interpreted: string[];
  error?: string;
}

export interface SetInfo {
  code: string;
  name: string;
  setType: string; // expansion, core, commander, masters, … (the "subset" category)
  released: string | null;
  count: number;
}

export interface CardDetailResponse {
  card: Card;
  // Other printings of the same oracle card (for alternate-art selection).
  printings: CardSummary[];
  decks?: Array<{ id: string; name: string; isPrecon: boolean; quantity: number; board: string }>;
}

// ---- Decks ----

export interface DeckCardEntry {
  cardId: string;
  quantity: number;
  // Which board the card belongs to.
  board: "main" | "sideboard" | "commander";
}

export interface Deck {
  id: string;
  ownerId: string;
  ownerName: string;
  name: string;
  formatId: string;
  description: string;
  colors: string[];
  cardCount: number;
  isPrecon: boolean;
  isStarred: boolean;
  tags: string[];
  updatedAt: string;
  createdAt: string;
}

// A dynamically-derived deck tag with a strength based on how much support it has.
export interface DeckTag {
  tag: string; // e.g. "Goblin", "Elves", "Lifegain"
  strength: "weak" | "medium" | "strong";
  count: number;
}

export interface LeaderboardEntry {
  name: string;
  wins: number;
  decks: Array<{ deckName: string; wins: number }>;
  lastWin: string;
}

export interface ImportDeckRequest {
  name: string;
  formatId: string;
  text: string;
}
export interface ImportDeckResponse {
  id: string | null;
  resolved: number;
  unresolved: string[];
}

export interface DeckDetail extends Deck {
  cards: Array<DeckCardEntry & { card: Card }>;
}

export interface DeckValidation {
  valid: boolean;
  issues: DeckValidationIssue[];
  stats: DeckStats;
}

export interface DeckStats {
  total: number;
  lands: number;
  creatures: number;
  instants: number;
  sorceries: number;
  artifacts: number;
  enchantments: number;
  planeswalkers: number;
  other: number;
  manaCurve: Record<number, number>; // cmc -> count (nonland)
  colorCounts: Record<string, number>; // W U B R G C -> pip count
  averageCmc: number;
}

export interface SaveDeckRequest {
  name: string;
  formatId: string;
  description?: string;
  cards: DeckCardEntry[];
}

// ---- Tables / lobby ----

export interface TableSummary {
  id: string;
  name: string;
  formatId: string;
  ruleset: string;
  enforceBans: boolean;
  status: string;
  playerCount: number;
  maxPlayers: number;
  mode: TableMode;
  seats: Array<{ seat: number; name: string | null; userId: string | null }>;
}

export interface CreateTableRequest {
  name: string;
  formatId: string;
  ruleset: string; // legality tier id (all|standard|modern|legacy|commander|none)
  enforceBans: boolean;
  maxPlayers: number;
  enforcement: "relaxed" | "strict";
  mode: TableMode;
}
