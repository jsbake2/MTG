// The shared game-state model plus the action/message protocol. The framework
// rules engine (server/src/game) enforces the card-agnostic rules over this
// state; card-specific effects are performed by players via manual actions.

export type ZoneId =
  | "library"
  | "hand"
  | "graveyard"
  | "exile"
  | "battlefield"
  | "command"
  | "stack";

export const PLAYER_ZONES: ZoneId[] = ["library", "hand", "graveyard", "exile", "command"];
export const SHARED_ZONES: ZoneId[] = ["battlefield", "stack"];

export type ManaColor = "W" | "U" | "B" | "R" | "G" | "C";
export const MANA_COLORS: ManaColor[] = ["W", "U", "B", "R", "G", "C"];

export interface Counter {
  type: string; // e.g. "+1/+1", "loyalty", "charge"
  count: number;
}

// An instance of a card (or token) inside a game.
export interface GameObject {
  id: string; // instance id (unique within the table)
  cardId: string | null; // scryfall printing id; null for pure tokens
  oracleId: string | null;
  name: string;
  ownerSeat: number;
  controllerSeat: number;
  zone: ZoneId;
  // Free layout position on the battlefield (or ordering hint elsewhere).
  x: number;
  y: number;
  tapped: boolean;
  faceDown: boolean;
  faceIndex: number; // which face is up for multi-face cards
  summoningSick: boolean;
  counters: Counter[];
  damage: number;
  attachedTo: string | null; // instance id this is attached to (aura/equipment)
  isToken: boolean;
  isCommander: boolean;
  note: string | null;
  // A manual P/T the players can set for the session (e.g. after a pump spell).
  ptOverride: { power: number; toughness: number } | null;
  // Combat state (cleared at end of combat). attacking = defending seat.
  attacking: number | null;
  blocking: string | null; // attacker instance id this creature is blocking
  // Marked as having taken damage from a deathtouch source this turn.
  deathtouched: boolean;
  // Chosen targets for an auto-effect while on the stack. Object ids, or
  // "seat:<n>" for a player target.
  targets: string[];
  // "Until end of turn" pump and granted keywords (cleared at cleanup).
  tempBoost: { power: number; toughness: number };
  grantedKeywords: string[];
  // Chosen mode for a modal spell on the stack (-1 = none).
  castMode: number;
  // Chosen value of X for an X spell on the stack.
  xValue: number;
  // Card type/keyword info surfaced to the client for public objects (populated
  // on send for battlefield/stack cards; used for combat UX + land/creature rows).
  cardTypes: string[] | null;
  keywords: string[] | null;
}

export type Phase =
  | "beginning"
  | "precombat_main"
  | "combat"
  | "postcombat_main"
  | "ending";

export type Step =
  | "untap"
  | "upkeep"
  | "draw"
  | "main1"
  | "begin_combat"
  | "declare_attackers"
  | "declare_blockers"
  | "combat_damage"
  | "end_combat"
  | "main2"
  | "end"
  | "cleanup";

// Ordered walk of steps within a turn; the engine advances through this list.
export const TURN_STEPS: { phase: Phase; step: Step }[] = [
  { phase: "beginning", step: "untap" },
  { phase: "beginning", step: "upkeep" },
  { phase: "beginning", step: "draw" },
  { phase: "precombat_main", step: "main1" },
  { phase: "combat", step: "begin_combat" },
  { phase: "combat", step: "declare_attackers" },
  { phase: "combat", step: "declare_blockers" },
  { phase: "combat", step: "combat_damage" },
  { phase: "combat", step: "end_combat" },
  { phase: "postcombat_main", step: "main2" },
  { phase: "ending", step: "end" },
  { phase: "ending", step: "cleanup" },
];

export interface PlayerState {
  seat: number;
  userId: string | null;
  name: string;
  life: number;
  poison: number;
  // commanderDamage[fromSeat] = damage this player has taken from that seat's commander(s)
  commanderDamage: Record<number, number>;
  manaPool: Record<ManaColor, number>;
  landsPlayedThisTurn: number;
  hasLost: boolean;
  hasConceded: boolean;
  connected: boolean;
  // how many cards are in the player's hand/library — sent to opponents without
  // revealing contents.
  handCount: number;
  libraryCount: number;
  avatarCardId: string | null;
}

// The most recent dice/coin roll at the table, so every client can animate it.
export interface RollResult {
  id: number;
  seat: number | null;
  label: string; // e.g. "d20", "coin", "to go first"
  sides: number; // 6, 20, 2 (coin), ...
  values: number[];
  total: number;
  text: string;
  ts: number;
}

export type EnforcementLevel = "relaxed" | "strict";
export type TableStatus = "lobby" | "mulligan" | "playing" | "finished";

export interface LogEntry {
  id: number;
  seat: number | null; // acting seat, null for system
  text: string;
  ts: number;
  // "override" entries are highlighted so the table can see a rule was bypassed.
  kind: "action" | "system" | "override" | "chat" | "combat" | "phase";
}

export interface TableState {
  id: string;
  name: string;
  formatId: string;
  status: TableStatus;
  players: PlayerState[];
  activeSeat: number;
  prioritySeat: number;
  turnNumber: number;
  phase: Phase;
  step: Step;
  stackOrder: string[]; // object ids, last = top of stack
  objects: Record<string, GameObject>;
  enforcement: EnforcementLevel;
  startingPlayerSeat: number;
  log: LogEntry[];
  revision: number;
  winnerSeat: number | null;
  // How many players have passed priority in a row (priority loop bookkeeping).
  passStreak: number;
  // Last dice/coin roll, for shared animation. Null until someone rolls.
  lastRoll: RollResult | null;
  // Epoch ms when the current turn began (for the shared turn timer).
  turnStartedAt: number;
}

// ---- Actions (client -> engine) ----------------------------------------

export type GameAction =
  | { type: "move_card"; objectId: string; toZone: ZoneId; toSeat?: number; x?: number; y?: number; toTop?: boolean; position?: number }
  | { type: "tap"; objectId: string; tapped: boolean }
  | { type: "untap_all"; seat?: number }
  | { type: "draw"; seat: number; count: number }
  | { type: "mill"; seat: number; count: number }
  | { type: "shuffle"; seat: number }
  | { type: "scry"; seat: number; count: number }
  | { type: "mulligan"; seat: number }
  | { type: "keep_hand"; seat: number }
  | { type: "set_life"; seat: number; life: number }
  | { type: "adjust_life"; seat: number; delta: number }
  | { type: "set_poison"; seat: number; value: number }
  | { type: "commander_damage"; toSeat: number; fromSeat: number; delta: number }
  | { type: "add_counter"; objectId: string; counterType: string; delta: number }
  | { type: "set_pt"; objectId: string; power: number | null; toughness: number | null }
  | { type: "set_damage"; objectId: string; damage: number }
  | { type: "flip"; objectId: string; faceIndex?: number; faceDown?: boolean }
  | { type: "attach"; objectId: string; toObjectId: string | null }
  | { type: "create_token"; seat: number; name: string; power?: number; toughness?: number; typeLine?: string; colors?: string[]; cardId?: string | null; oracleId?: string | null }
  | { type: "cast"; objectId: string; targets?: string[]; mode?: number; x?: number } // move to stack (framework: timing/mana enforced)
  | { type: "resolve_top" } // resolve top of stack (player then performs the effect manually)
  | { type: "counter_top" } // remove top of stack to graveyard
  | { type: "add_mana"; seat: number; color: ManaColor; count: number }
  | { type: "empty_mana"; seat: number }
  | { type: "pay_mana"; seat: number; cost: Partial<Record<ManaColor, number>> }
  | { type: "pass_priority"; seat: number }
  | { type: "advance_step" } // move to next step/turn (only when allowed)
  | { type: "set_active_player"; seat: number }
  | { type: "declare_attacker"; objectId: string; defendingSeat: number }
  | { type: "declare_blocker"; blockerId: string; attackerId: string }
  | { type: "assign_combat_damage" } // engine computes and applies combat damage math
  | { type: "note"; objectId: string; note: string | null }
  | { type: "concede"; seat: number }
  | { type: "set_enforcement"; level: EnforcementLevel }
  // Semantic zone change routed through the rules table (correct destination +
  // nuance: destroy respects indestructible, counter→graveyard from stack, etc.)
  | { type: "keyword_action"; objectId: string; action: "destroy" | "sacrifice" | "exile" | "bounce" | "counter" | "tuck_top" | "tuck_bottom" }
  | { type: "roll"; seat: number; sides: number; count: number; label?: string } // dice/coin roll
  | { type: "roll_first" } // roll for each seated player; highest becomes active
  | { type: "override"; description: string; inner: GameAction }; // bypass a framework check, logged

// ---- WebSocket protocol -------------------------------------------------

export interface ChatMessage {
  seat: number | null;
  name: string;
  text: string;
  ts: number;
}

export type ClientMessage =
  | { type: "hello"; tableId: string }
  | { type: "take_seat"; seat: number; deckId: string | null }
  | { type: "leave_seat" }
  | { type: "start_game" }
  | { type: "action"; action: GameAction; clientRev?: number }
  | { type: "undo" }
  | { type: "chat"; text: string }
  | { type: "ping" };

export interface LobbySeat {
  seat: number;
  name: string;
  userId: string;
  deckId: string | null;
  avatarCardId: string | null;
}

export type ServerMessage =
  | { type: "state"; state: TableState; you: number | null; hands: Record<number, string[]> }
  | {
      type: "lobby";
      seats: LobbySeat[];
      maxPlayers: number;
      formatId: string;
      name: string;
      hostUserId: string;
      you: number | null;
    }
  | { type: "log"; entries: LogEntry[] }
  | { type: "chat"; message: ChatMessage }
  | { type: "error"; message: string; recoverable: boolean }
  | { type: "pong" };

export function emptyManaPool(): Record<ManaColor, number> {
  return { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
}
