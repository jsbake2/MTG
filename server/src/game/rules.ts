// ---------------------------------------------------------------------------
// The RULES REFERENCE — a single, ordered source of truth for the automated
// engine's order of operations and zone semantics. There is no public
// machine-readable MTG rules dataset (the Comprehensive Rules are prose; XMage
// and Forge encode them in code), so this module encodes the structure the
// engine sequences through: zones, keyword actions and their destinations,
// state-based actions (in order), the cast/resolve sequence, priority order,
// and the continuous-effect layer system. CR references in comments.
// ---------------------------------------------------------------------------
import type { ZoneId } from "@mtg/shared";

// --- Zones (CR 400) ---------------------------------------------------------
export interface ZoneRule {
  id: ZoneId;
  public: boolean; // contents visible to all
  ordered: boolean; // order matters (library/graveyard/stack)
  perPlayer: boolean; // each player has their own (vs shared)
}
export const ZONES: Record<ZoneId, ZoneRule> = {
  library: { id: "library", public: false, ordered: true, perPlayer: true },
  hand: { id: "hand", public: false, ordered: false, perPlayer: true },
  battlefield: { id: "battlefield", public: true, ordered: false, perPlayer: false },
  graveyard: { id: "graveyard", public: true, ordered: true, perPlayer: true },
  stack: { id: "stack", public: true, ordered: true, perPlayer: false },
  exile: { id: "exile", public: true, ordered: false, perPlayer: true },
  command: { id: "command", public: true, ordered: false, perPlayer: true },
};

// --- Keyword actions and where they send an object (CR 701) ------------------
// This is the crux of "getting order of operations right": each removal/movement
// verb has a specific destination, owner vs controller, and what can stop it.
export type KeywordAction =
  | "destroy"
  | "sacrifice"
  | "exile"
  | "counter"
  | "bounce"
  | "tuck_top"
  | "tuck_bottom"
  | "mill"
  | "discard";

export interface KeywordActionRule {
  dest: ZoneId;
  toOwner: boolean; // owner's zone (true) vs controller's (false)
  toTop?: boolean; // for library destinations
  preventableBy: string[]; // keywords/effects that can stop it
  triggersLeaveBattlefield: boolean; // does it fire "leaves the battlefield" / dies triggers
  note: string;
}
export const KEYWORD_ACTIONS: Record<KeywordAction, KeywordActionRule> = {
  // CR 701.7 — Destroy: to owner's graveyard; indestructible/regeneration can prevent.
  destroy: { dest: "graveyard", toOwner: true, preventableBy: ["indestructible", "regeneration"], triggersLeaveBattlefield: true, note: "Destroyed → owner's graveyard; indestructible/regen prevents." },
  // CR 701.16 — Sacrifice: to owner's graveyard; NOT stopped by indestructible.
  sacrifice: { dest: "graveyard", toOwner: true, preventableBy: [], triggersLeaveBattlefield: true, note: "Sacrificed → owner's graveyard; indestructible does NOT prevent." },
  // CR 701.19 — Exile: to the exile zone; no 'dies' trigger (it didn't go to graveyard).
  exile: { dest: "exile", toOwner: true, preventableBy: [], triggersLeaveBattlefield: true, note: "Exiled → exile zone; no death trigger; often returnable." },
  // CR 701.5 — Counter: a spell on the stack goes to its owner's graveyard (unless an effect exiles it instead).
  counter: { dest: "graveyard", toOwner: true, preventableBy: ["can't be countered"], triggersLeaveBattlefield: false, note: "Countered spell → owner's graveyard from the stack (unless exiled)." },
  // Return to hand ("bounce").
  bounce: { dest: "hand", toOwner: true, preventableBy: [], triggersLeaveBattlefield: true, note: "Return → owner's hand." },
  tuck_top: { dest: "library", toOwner: true, toTop: true, preventableBy: [], triggersLeaveBattlefield: true, note: "Put on top of owner's library." },
  tuck_bottom: { dest: "library", toOwner: true, toTop: false, preventableBy: [], triggersLeaveBattlefield: true, note: "Put on bottom of owner's library." },
  mill: { dest: "graveyard", toOwner: true, preventableBy: [], triggersLeaveBattlefield: false, note: "Top of library → graveyard." },
  discard: { dest: "graveyard", toOwner: true, preventableBy: [], triggersLeaveBattlefield: false, note: "From hand → graveyard." },
};

// --- Zone-change rules (CR 400.7, 603.6, 608.2m) ----------------------------
export const ZONE_CHANGE_RULES = [
  "A permanent leaving the battlefield becomes a new object: counters, damage, attachments, and continuous effects end.",
  "A resolving spell that's a permanent enters the battlefield; an instant/sorcery goes to its owner's graveyard after resolving.",
  "A countered spell is put into its owner's graveyard from the stack (unless an effect exiles it).",
  "A spell whose targets are all illegal on resolution is countered by the game rules ('fizzles') and does nothing.",
  "A token that leaves the battlefield ceases to exist as a state-based action.",
  "A face-down permanent turns face up when it leaves the battlefield.",
] as const;

// --- State-based actions, checked whenever a player would get priority (CR 704) ---
// Order matters: these are all checked, repeatedly, before any player receives priority.
export const STATE_BASED_ACTIONS = [
  { id: "life", text: "A player at 0 or less life loses." },
  { id: "draw_empty", text: "A player who drew from an empty library loses." },
  { id: "poison", text: "A player with 10+ poison counters loses." },
  { id: "zero_toughness", text: "A creature with 0 or less toughness → owner's graveyard." },
  { id: "lethal_damage", text: "A creature with lethal damage (>= toughness, or any from deathtouch) is destroyed (unless indestructible)." },
  { id: "planeswalker", text: "A planeswalker with 0 loyalty → owner's graveyard." },
  { id: "commander_damage", text: "A player dealt 21+ combat damage by one commander loses." },
  { id: "token_ceases", text: "A token/copy not on the battlefield ceases to exist." },
  { id: "illegal_aura", text: "An Aura attached illegally, or to nothing, → owner's graveyard." },
  { id: "legend_rule", text: "Two legendaries with the same name under one controller: keep one, the rest → graveyard." },
] as const;

// --- Cast & resolve sequences (CR 601, 608) ---------------------------------
export const CAST_SEQUENCE = [
  "Announce: move the spell from hand to the top of the stack.",
  "Choose modes, split/kicker, and targets.",
  "Determine total cost (add/reduce), then pay costs (mana + additional).",
  "The spell is now cast — abilities that trigger 'when you cast' trigger.",
  "Active player gets priority; players may respond.",
] as const;
export const RESOLVE_SEQUENCE = [
  "If all its targets are illegal, the spell is countered by the game rules (does nothing).",
  "Follow the spell's instructions in written order.",
  "A permanent spell enters the battlefield; other spells go to the owner's graveyard.",
  "Check state-based actions, then put triggered abilities on the stack.",
] as const;

// --- Priority & the stack (CR 117, 405, 608) --------------------------------
export const PRIORITY_ORDER = [
  "The active player receives priority at the start of each step/phase (except untap and cleanup).",
  "A player with priority may cast a spell / activate an ability / take a special action, then gets priority again.",
  "When a player passes, the next player in turn order gets priority.",
  "If all players pass in succession with a non-empty stack, the top object resolves; then the active player gets priority.",
  "If all players pass with an empty stack, the current step or phase ends.",
] as const;

// --- Continuous-effect layer system (CR 613) — ordering of overlapping effects ---
export const LAYERS = [
  { n: 1, name: "Copy effects" },
  { n: 2, name: "Control-changing effects" },
  { n: 3, name: "Text-changing effects" },
  { n: 4, name: "Type-changing effects" },
  { n: 5, name: "Color-changing effects" },
  { n: 6, name: "Ability add/remove effects" },
  { n: 7, name: "Power/toughness: 7a CDAs, 7b set P/T, 7c counters, 7d other +N/+N" },
] as const;

// --- Turn structure (CR 500) — the ordered steps the engine walks -----------
export const TURN_STRUCTURE = [
  { phase: "Beginning", steps: ["Untap (no priority)", "Upkeep", "Draw"] },
  { phase: "Precombat Main", steps: ["Main"] },
  { phase: "Combat", steps: ["Beginning of combat", "Declare attackers", "Declare blockers", "Combat damage", "End of combat"] },
  { phase: "Postcombat Main", steps: ["Main"] },
  { phase: "Ending", steps: ["End", "Cleanup (discard to max, remove damage; no priority)"] },
] as const;
