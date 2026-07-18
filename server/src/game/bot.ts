// Heuristic AI opponent. A bot is just a seat whose userId starts with "bot:".
// It has no WebSocket; the Table drives it (see scheduleBots) by asking botAction
// for ONE action at a time and applying it.
//
// FAIRNESS: botAction is given the bot's OWN redacted view (viewFor(botSeat)) —
// opponents' hands/libraries are hidden exactly as they are for a human — so the
// bot can't peek. It uses the card index only for properties of cards it can
// legitimately see (its own hand + public permanents).
import type { GameAction, GameObject, TableState } from "@mtg/shared";
import type { CardIndex } from "./engine.js";

export function isBotSeat(userId: string | null | undefined): boolean {
  return !!userId && userId.startsWith("bot:");
}

const inZone = (s: TableState, zone: string, seat: number) =>
  Object.values(s.objects).filter((o) => o.zone === zone && (zone === "hand" ? o.ownerSeat : o.controllerSeat) === seat);

const isLand = (ctx: CardIndex, o: GameObject) => !!o.cardId && !!ctx[o.cardId]?.cardTypes.includes("Land");
const isCreature = (ctx: CardIndex, o: GameObject) => !!o.cardId && !!ctx[o.cardId]?.cardTypes.includes("Creature");
const cmcOf = (ctx: CardIndex, o: GameObject) => (o.cardId ? ctx[o.cardId]?.cmc ?? 99 : 99);
const powOf = (ctx: CardIndex, o: GameObject) => {
  const base = o.cardId ? parseInt((ctx[o.cardId]?.power ?? "0").replace(/[^0-9-]/g, ""), 10) || 0 : 0;
  const counters = o.counters.reduce((n, c) => n + (c.type === "+1/+1" ? c.count : c.type === "-1/-1" ? -c.count : 0), 0);
  return Math.max(0, base + counters + (o.tempBoost?.power ?? 0));
};
// A rough count of mana the bot could produce (untapped lands + obvious rocks).
const manaAvailable = (ctx: CardIndex, seat: number, s: TableState) =>
  inZone(s, "battlefield", seat).filter((o) => !o.tapped && (isLand(ctx, o) || /add \{/i.test(o.cardId ? ctx[o.cardId]?.oracleText ?? "" : ""))).length;

const opponentOf = (s: TableState, seat: number) =>
  s.players.find((p) => p.seat !== seat && !p.hasLost && !p.hasConceded)?.seat ?? seat;

// Decide ONE action for the bot, or null to yield control back to the humans.
export function botAction(view: TableState, ctx: CardIndex, seat: number): GameAction | null {
  if (view.status !== "playing") return null;
  const me = view.players.find((p) => p.seat === seat);
  if (!me || me.hasLost || me.hasConceded) return null;

  // 1. Resolve my own spell on top of the stack; pass on anything else.
  const topId = view.stackOrder[view.stackOrder.length - 1];
  if (topId) {
    const top = view.objects[topId];
    if (top && top.controllerSeat === seat) return { type: "resolve_top" };
    return seat === view.prioritySeat ? { type: "pass_priority", seat } : null;
  }

  // 2. Defense: declare blockers to avoid lethal (v1 only chumps when dying).
  if (view.step === "declare_blockers" && view.activeSeat !== seat) {
    return blockToSurvive(view, ctx, seat);
  }

  // 3. Not my turn: pass priority if I'm holding it (v1 casts nothing at instant
  //    speed), otherwise wait for the humans.
  if (view.activeSeat !== seat) {
    return seat === view.prioritySeat ? { type: "pass_priority", seat } : null;
  }

  // 4. My turn — only act when I hold priority.
  if (seat !== view.prioritySeat) return null;

  const hand = inZone(view, "hand", seat);
  const bf = inZone(view, "battlefield", seat);

  if (view.step === "main1" || view.step === "main2") {
    // Play a land.
    if ((me.landsPlayedThisTurn ?? 0) < 1) {
      const land = hand.find((o) => isLand(ctx, o));
      if (land) return { type: "move_card", objectId: land.id, toZone: "battlefield" };
    }
    // Cast the most expensive affordable spell (mana auto-pays on cast).
    const mana = manaAvailable(ctx, seat, view);
    const castable = hand
      .filter((o) => !isLand(ctx, o) && cmcOf(ctx, o) <= mana)
      .sort((a, b) => cmcOf(ctx, b) - cmcOf(ctx, a));
    if (castable[0]) return { type: "cast", objectId: castable[0].id, autoMana: true };
    // Nothing to play: end the turn from main2, otherwise move toward combat.
    return view.step === "main2" ? { type: "end_turn" } : { type: "advance_step" };
  }

  if (view.step === "declare_attackers") {
    const canAttack = bf.find((o) => isCreature(ctx, o) && !o.tapped && !o.summoningSick && o.attacking === null);
    if (canAttack) return { type: "declare_attacker", objectId: canAttack.id, defendingSeat: opponentOf(view, seat) };
    return { type: "advance_step" };
  }

  // Any other step on my turn with priority: advance.
  return { type: "advance_step" };
}

// v1 blocking: only block when the unblocked attackers would kill me; then chump
// the biggest one with an available creature. One block per call (driver loops).
function blockToSurvive(view: TableState, ctx: CardIndex, seat: number): GameAction | null {
  const me = view.players.find((p) => p.seat === seat);
  if (!me) return null;
  const attackers = Object.values(view.objects).filter((o) => o.attacking === seat && o.zone === "battlefield");
  const isBlocked = (a: GameObject) => Object.values(view.objects).some((b) => b.blocking === a.id);
  const unblocked = attackers.filter((a) => !isBlocked(a));
  const incoming = unblocked.reduce((n, a) => n + powOf(ctx, a), 0);
  if (incoming < me.life) return null; // survivable — take it
  const available = inZone(view, "battlefield", seat).filter((o) => isCreature(ctx, o) && !o.tapped && !o.blocking && !o.attacking);
  const biggest = [...unblocked].sort((a, b) => powOf(ctx, b) - powOf(ctx, a))[0];
  if (available[0] && biggest) return { type: "declare_blocker", blockerId: available[0].id, attackerId: biggest.id };
  return null;
}
