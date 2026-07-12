// Formats are data-driven. A format is mostly a legality filter over Scryfall's
// `legalities` object plus a few construction rules and table settings. Adding a
// new real format that Scryfall tracks is just another entry here.

import type { Card, Legality } from "./cards.js";

export interface FormatDef {
  id: string;
  name: string;
  // Key inside a card's `legalities` map. null = no legality filtering (house).
  legalityKey: string | null;
  startingLife: number;
  // Deck construction.
  minDeckSize: number;
  maxDeckSize: number | null;
  // Max copies of any one card by name (basic lands & a few exceptions ignore this).
  maxCopiesPerCard: number;
  singleton: boolean; // Commander-style: 1 of each non-basic.
  // Commander-specific rules.
  requiresCommander: boolean;
  commanderDamageLethal: number | null; // e.g. 21
  enforcesColorIdentity: boolean;
  // Multiplayer sizing hint for the lobby.
  minPlayers: number;
  maxPlayers: number;
  description: string;
}

export const FORMATS: FormatDef[] = [
  {
    id: "standard",
    name: "Standard",
    legalityKey: "standard",
    startingLife: 20,
    minDeckSize: 60,
    maxDeckSize: null,
    maxCopiesPerCard: 4,
    singleton: false,
    requiresCommander: false,
    commanderDamageLethal: null,
    enforcesColorIdentity: false,
    minPlayers: 2,
    maxPlayers: 4,
    description:
      "The rotating standard format: only recent sets are legal. 60-card minimum, up to 4 copies of any card.",
  },
  {
    id: "pioneer",
    name: "Pioneer",
    legalityKey: "pioneer",
    startingLife: 20,
    minDeckSize: 60,
    maxDeckSize: null,
    maxCopiesPerCard: 4,
    singleton: false,
    requiresCommander: false,
    commanderDamageLethal: null,
    enforcesColorIdentity: false,
    minPlayers: 2,
    maxPlayers: 4,
    description: "Everything from Return to Ravnica forward. 60-card minimum, 4 copies max.",
  },
  {
    id: "modern",
    name: "Modern",
    legalityKey: "modern",
    startingLife: 20,
    minDeckSize: 60,
    maxDeckSize: null,
    maxCopiesPerCard: 4,
    singleton: false,
    requiresCommander: false,
    commanderDamageLethal: null,
    enforcesColorIdentity: false,
    minPlayers: 2,
    maxPlayers: 4,
    description: "A large non-rotating format from 8th Edition forward. 60-card minimum, 4 copies max.",
  },
  {
    id: "pauper",
    name: "Pauper",
    legalityKey: "pauper",
    startingLife: 20,
    minDeckSize: 60,
    maxDeckSize: null,
    maxCopiesPerCard: 4,
    singleton: false,
    requiresCommander: false,
    commanderDamageLethal: null,
    enforcesColorIdentity: false,
    minPlayers: 2,
    maxPlayers: 4,
    description: "Commons only — cheap and beginner-friendly. 60-card minimum, 4 copies max.",
  },
  {
    id: "commander",
    name: "Commander",
    legalityKey: "commander",
    startingLife: 40,
    minDeckSize: 100,
    maxDeckSize: 100,
    maxCopiesPerCard: 1,
    singleton: true,
    requiresCommander: true,
    commanderDamageLethal: 21,
    enforcesColorIdentity: true,
    minPlayers: 2,
    maxPlayers: 4,
    description:
      "Multiplayer free-for-all. Exactly 100 cards, singleton, a legendary commander, 40 life, and 21 commander damage is lethal.",
  },
  {
    id: "house",
    name: "House / Kitchen Table",
    legalityKey: null,
    startingLife: 20,
    minDeckSize: 1,
    maxDeckSize: null,
    maxCopiesPerCard: Number.MAX_SAFE_INTEGER,
    singleton: false,
    requiresCommander: false,
    commanderDamageLethal: null,
    enforcesColorIdentity: false,
    minPlayers: 1,
    maxPlayers: 4,
    description:
      "Anything goes. No legality checks, any cards from any era, any number of copies — perfect for building whatever you dream up.",
  },
];

export function getFormat(id: string): FormatDef | undefined {
  return FORMATS.find((f) => f.id === id);
}

// A "ruleset" is the card-legality tier a table enforces, independent of the deck
// construction rules (the game type). It resolves to a Scryfall legality key.
// `null` = no legality filtering (any card). "all" uses Vintage, which marks
// virtually every real card legal.
export interface RulesetDef {
  id: string;
  name: string;
  legalityKey: string | null;
}
export const RULESETS: RulesetDef[] = [
  { id: "all", name: "All cards", legalityKey: "vintage" },
  { id: "standard", name: "Standard (current sets)", legalityKey: "standard" },
  { id: "modern", name: "Modern", legalityKey: "modern" },
  { id: "legacy", name: "Legacy", legalityKey: "legacy" },
  { id: "commander", name: "Commander", legalityKey: "commander" },
  { id: "none", name: "Anything goes", legalityKey: null },
];
export function getRuleset(id: string | undefined): RulesetDef | undefined {
  return RULESETS.find((r) => r.id === id);
}

// Basic lands and a handful of cards are exempt from the copy limit.
export function isCopyLimitExempt(card: Pick<Card, "typeLine" | "oracleText" | "supertypes">): boolean {
  if (card.supertypes.includes("Basic")) return true;
  // "A deck can have any number of cards named ___" appears in oracle text.
  if (card.oracleText && /any number of cards named/i.test(card.oracleText)) return true;
  return false;
}

export interface DeckValidationIssue {
  severity: "error" | "warning";
  message: string;
  cardName?: string;
}
