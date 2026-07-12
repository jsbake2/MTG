// In-memory table manager: lobby, seating, starting games, applying actions with
// undo history, and producing per-seat redacted state views (hidden zones).
import { randomUUID } from "node:crypto";
import type { GameAction, TableMode, TableState, TableSummary } from "@mtg/shared";
import { getFormat, getRuleset } from "@mtg/shared";
import { getCardsByIds } from "../cards/repo.js";
import { getAvatarForUser } from "../auth/users.js";
import { getDeckDetail, getDeckRow } from "../decks/repo.js";
import { recordResult } from "./results.js";
import { validateDeck } from "../decks/validate.js";
import { applyAction, checkStateBased, type ApplyResult, type CardIndex } from "./engine.js";
import { buildInitialState, log, type SeatDeck } from "./state.js";
import { appendGameLog } from "./gameLog.js";

export interface SeatAssignment {
  seat: number;
  userId: string;
  name: string;
  deckId: string | null;
  avatarCardId: string | null;
}

export class Table {
  id = randomUUID();
  name: string;
  formatId: string;
  maxPlayers: number;
  enforcement: "relaxed" | "strict";
  mode: TableMode;
  ruleset: string;
  enforceBans: boolean;
  hostUserId: string;
  seats: SeatAssignment[] = [];
  state: TableState | null = null;
  cardIndex: CardIndex = {};
  history: TableState[] = [];
  listeners = new Set<() => void>();
  private recorded = false;

  constructor(opts: { name: string; formatId: string; maxPlayers: number; enforcement: "relaxed" | "strict"; mode?: TableMode; ruleset?: string; enforceBans?: boolean; hostUserId: string }) {
    this.name = opts.name;
    this.formatId = opts.formatId;
    this.maxPlayers = opts.maxPlayers;
    this.enforcement = opts.enforcement;
    this.mode = opts.mode ?? "guided";
    this.ruleset = opts.ruleset ?? defaultRulesetFor(opts.formatId);
    this.enforceBans = opts.enforceBans ?? true;
    this.hostUserId = opts.hostUserId;
  }

  summary(): TableSummary {
    return {
      id: this.id,
      name: this.name,
      formatId: this.formatId,
      ruleset: this.ruleset,
      enforceBans: this.enforceBans,
      status: this.state?.status ?? "lobby",
      playerCount: this.seats.length,
      maxPlayers: this.maxPlayers,
      mode: this.mode,
      seats: this.seats.map((s) => ({ seat: s.seat, name: s.name, userId: s.userId })),
    };
  }

  // The legality override this table enforces (from its ruleset + ban toggle).
  legalityOverride() {
    const rs = getRuleset(this.ruleset);
    return { legalityKey: rs?.legalityKey ?? null, enforceBans: this.enforceBans, rulesetName: rs?.name ?? this.ruleset };
  }

  notify(): void {
    for (const fn of this.listeners) fn();
  }

  takeSeat(userId: string, name: string, seat: number, deckId: string | null, avatarCardId: string | null): { ok: boolean; error?: string } {
    if (this.state && this.state.status !== "lobby") return { ok: false, error: "Game already started." };
    if (seat < 0 || seat >= this.maxPlayers) return { ok: false, error: "Invalid seat." };
    // Remove any existing seat for this user, then claim.
    this.seats = this.seats.filter((s) => s.userId !== userId);
    if (this.seats.some((s) => s.seat === seat)) return { ok: false, error: "Seat taken." };
    this.seats.push({ seat, userId, name, deckId, avatarCardId });
    this.seats.sort((a, b) => a.seat - b.seat);
    this.notify();
    return { ok: true };
  }

  leaveSeat(userId: string): void {
    this.seats = this.seats.filter((s) => s.userId !== userId);
    this.notify();
  }

  seatForUser(userId: string): number | null {
    return this.seats.find((s) => s.userId === userId)?.seat ?? null;
  }

  async start(): Promise<{ ok: boolean; error?: string }> {
    if (this.seats.length < 1) return { ok: false, error: "Need at least one seated player." };
    const format = getFormat(this.formatId);
    // Deck-legality gate: every seated player's deck must satisfy the game type's
    // construction rules AND the table's ruleset (card legality + ban toggle)
    // before the game can start. The House game type is exempt (anything goes).
    const enforceLegality = this.formatId !== "house";
    const override = this.legalityOverride();
    const legalityErrors: string[] = [];
    const seatDecks: SeatDeck[] = [];
    const allCardIds = new Set<string>();
    for (const s of this.seats) {
      const library: SeatDeck["library"] = [];
      const commanders: SeatDeck["commanders"] = [];
      if (s.deckId) {
        const deck = await getDeckDetail(s.deckId);
        if (deck) {
          if (enforceLegality) {
            const validation = validateDeck(this.formatId, deck.cards, override);
            for (const issue of validation.issues) {
              if (issue.severity === "error") legalityErrors.push(`${s.name} — "${deck.name}": ${issue.message}`);
            }
          }
          for (const entry of deck.cards) {
            const target = entry.board === "commander" ? commanders : entry.board === "main" ? library : null;
            if (!target) continue;
            for (let i = 0; i < entry.quantity; i++) {
              target.push({ cardId: entry.cardId, oracleId: entry.card.oracleId, name: entry.card.name });
              allCardIds.add(entry.cardId);
            }
          }
        }
      } else if (enforceLegality) {
        legalityErrors.push(`${s.name} — no deck selected (${format?.name ?? this.formatId} requires a legal deck).`);
      }
      const avatarCardId = await getAvatarForUser(s.userId).catch(() => null);
      seatDecks.push({ seat: s.seat, userId: s.userId, name: s.name, avatarCardId, library, commanders });
    }

    if (legalityErrors.length > 0) {
      const shown = legalityErrors.slice(0, 8);
      const more = legalityErrors.length - shown.length;
      return {
        ok: false,
        error:
          `Can't start — illegal deck${legalityErrors.length > 1 ? "s" : ""} for ${format?.name ?? this.formatId}:\n` +
          shown.map((e) => `• ${e}`).join("\n") +
          (more > 0 ? `\n…and ${more} more issue${more > 1 ? "s" : ""}.` : "") +
          `\nFix the deck(s) in the Deck Builder, or use the House / Kitchen Table format for casual play.`,
      };
    }

    // Build the card index (types/keywords/PT) used by the engine.
    const cards = await getCardsByIds([...allCardIds]);
    this.cardIndex = {};
    for (const [id, c] of cards) {
      this.cardIndex[id] = {
        typeLine: c.typeLine,
        cardTypes: c.cardTypes,
        power: c.power,
        toughness: c.toughness,
        keywords: c.keywords,
        oracleText: c.oracleText,
      };
    }

    this.state = buildInitialState({
      id: this.id,
      name: this.name,
      formatId: this.formatId,
      mode: this.mode,
      ruleset: this.ruleset,
      enforceBans: this.enforceBans,
      enforcement: this.enforcement,
      seats: seatDecks,
    });
    // Opening hands.
    for (const s of seatDecks) {
      this.dealOpeningHand(s.seat);
    }
    this.state.status = "playing";
    log(this.state, { seat: null, kind: "system", text: `Game started — ${format?.name ?? this.formatId}. Good luck!` });
    this.history = [];
    this.recorded = false;
    appendGameLog({
      ts: Date.now(),
      kind: "game_start",
      tableId: this.id,
      format: this.formatId,
      players: this.seats.map((s) => ({ seat: s.seat, name: s.name, deckId: s.deckId })),
    });
    this.notify();
    return { ok: true };
  }

  private dealOpeningHand(seat: number): void {
    if (!this.state) return;
    const lib = Object.values(this.state.objects)
      .filter((o) => o.zone === "library" && o.ownerSeat === seat)
      .sort((a, b) => a.y - b.y);
    for (let i = 0; i < 7 && i < lib.length; i++) lib[i]!.zone = "hand";
  }

  apply(seat: number, action: GameAction): ApplyResult {
    if (!this.state) return { ok: false, error: "Game not started." };
    // Snapshot for undo (cap history).
    this.history.push(structuredClone(this.state));
    if (this.history.length > 50) this.history.shift();
    const logLenBefore = this.state.log.length;
    const card = actionCardName(this.state, action);
    const res = applyAction(this.state, this.cardIndex, seat, action);
    // Persistent audit log: every action, its result, and the resulting state.
    appendGameLog({
      ts: Date.now(),
      kind: "action",
      tableId: this.id,
      seat,
      actor: this.state.players.find((p) => p.seat === seat)?.name,
      action,
      card,
      ok: res.ok,
      error: res.error,
      turn: this.state.turnNumber,
      phase: this.state.phase,
      step: this.state.step,
      activeSeat: this.state.activeSeat,
      revision: this.state.revision,
      life: Object.fromEntries(this.state.players.map((p) => [p.seat, p.life])),
      stack: this.state.stackOrder.map((id) => this.state!.objects[id]?.name ?? "?"),
      events: this.state.log.slice(logLenBefore).map((e) => e.text),
    });
    if (!res.ok) {
      // roll back the snapshot we just took
      this.history.pop();
    } else {
      if (this.state.status === "finished" && !this.recorded) {
        this.recorded = true;
        void this.recordFinish();
      }
      this.notify();
    }
    return res;
  }

  private async recordFinish(): Promise<void> {
    if (!this.state || this.state.winnerSeat === null) return;
    const winnerSeat = this.state.winnerSeat;
    const player = this.state.players.find((p) => p.seat === winnerSeat);
    const seat = this.seats.find((s) => s.seat === winnerSeat);
    let deckName: string | null = null;
    if (seat?.deckId) {
      const row = await getDeckRow(seat.deckId).catch(() => null);
      deckName = row?.name ?? null;
    }
    await recordResult({
      formatId: this.formatId,
      winnerUserId: seat?.userId ?? null,
      winnerName: player?.name ?? "Unknown",
      deckId: seat?.deckId ?? null,
      deckName,
      playerCount: this.state.players.length,
    }).catch((e) => console.error("[results] record failed:", e));
  }

  undo(): boolean {
    if (!this.state || this.history.length === 0) return false;
    this.state = this.history.pop()!;
    this.state.pendingUndo = null;
    checkStateBased(this.state, this.cardIndex);
    this.state.revision += 1;
    appendGameLog({ ts: Date.now(), kind: "undo", tableId: this.id, turn: this.state.turnNumber, revision: this.state.revision });
    this.notify();
    return true;
  }

  // Undo is a request: any OTHER seated player must approve it. With no opponents
  // seated (solo/testing) it just undoes.
  requestUndo(seat: number): void {
    if (!this.state || this.history.length === 0) return;
    const others = this.state.players.filter((p) => p.seat !== seat && p.userId && !p.hasConceded && !p.hasLost);
    if (others.length === 0) {
      this.undo();
      return;
    }
    this.state.pendingUndo = { requesterSeat: seat };
    const name = this.state.players.find((p) => p.seat === seat)?.name ?? "A player";
    log(this.state, { seat, kind: "system", text: `${name} requests an undo — waiting for approval.` });
    this.notify();
  }

  respondUndo(seat: number, approve: boolean): void {
    if (!this.state || !this.state.pendingUndo) return;
    if (this.state.pendingUndo.requesterSeat === seat) return; // can't approve your own
    if (approve) {
      this.undo(); // clears pendingUndo + notifies
      return;
    }
    this.state.pendingUndo = null;
    log(this.state, { seat, kind: "system", text: `Undo request denied.` });
    this.notify();
  }

  // Redacted state for a viewer: opponents' hands and everyone's libraries are
  // hidden (card identity stripped). The viewer's own hand is fully visible.
  viewFor(viewerSeat: number | null): { state: TableState; hands: Record<number, string[]> } {
    if (!this.state) throw new Error("no state");
    const clone: TableState = structuredClone(this.state);
    const hands: Record<number, string[]> = {};
    for (const o of Object.values(clone.objects)) {
      const ownHand = o.zone === "hand" && o.ownerSeat === viewerSeat;
      if (o.zone === "library" || (o.zone === "hand" && o.ownerSeat !== viewerSeat)) {
        o.cardId = null;
        o.oracleId = null;
        o.name = "Card";
        o.faceDown = true;
      }
      if (ownHand) (hands[viewerSeat!] ??= []).push(o.id);
      // Surface type/keyword info for public objects so the client can drive the
      // combat UX and split land/creature rows.
      if ((o.zone === "battlefield" || o.zone === "stack") && o.cardId && this.cardIndex[o.cardId]) {
        o.cardTypes = this.cardIndex[o.cardId]!.cardTypes;
        o.keywords = this.cardIndex[o.cardId]!.keywords;
      }
    }
    return { state: clone, hands };
  }
}

// Resolve the primary card a GameAction affects, for the audit log.
function actionCardName(state: TableState, action: GameAction): string | null {
  const id = (action as { objectId?: string }).objectId;
  if (id && state.objects[id]) return state.objects[id]!.name;
  return null;
}

// ---- global store -------------------------------------------------------
class TableManager {
  private tables = new Map<string, Table>();

  create(opts: { name: string; formatId: string; maxPlayers: number; enforcement: "relaxed" | "strict"; mode?: TableMode; ruleset?: string; enforceBans?: boolean; hostUserId: string }): Table {
    const t = new Table(opts);
    this.tables.set(t.id, t);
    return t;
  }
  get(id: string): Table | undefined {
    return this.tables.get(id);
  }
  list(): TableSummary[] {
    return [...this.tables.values()].map((t) => t.summary());
  }
  remove(id: string): void {
    this.tables.delete(id);
  }
  // Reap finished/empty tables occasionally.
  reap(): void {
    for (const [id, t] of this.tables) {
      const noOne = t.listeners.size === 0 && t.seats.length === 0;
      if (noOne) this.tables.delete(id);
    }
  }
}

export const tables = new TableManager();

// Sensible default legality tier when a table doesn't specify one.
function defaultRulesetFor(formatId: string): string {
  if (formatId === "commander") return "commander";
  if (formatId === "house") return "none";
  return "standard";
}
