// Records finished games and aggregates the leaderboard (wins by player + deck).
import type { LeaderboardEntry } from "@mtg/shared";
import { query } from "../db/pool.js";

export async function recordResult(r: {
  formatId: string;
  winnerUserId: string | null;
  winnerName: string;
  deckId: string | null;
  deckName: string | null;
  playerCount: number;
}): Promise<void> {
  await query(
    `INSERT INTO game_results (format_id, winner_user_id, winner_name, deck_id, deck_name, player_count)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [r.formatId, r.winnerUserId, r.winnerName, r.deckId, r.deckName, r.playerCount],
  );
}

export async function getLeaderboard(): Promise<LeaderboardEntry[]> {
  const totals = (
    await query<{ name: string; wins: string; last_win: string }>(
      `SELECT winner_name AS name, count(*)::text AS wins, max(finished_at) AS last_win
       FROM game_results GROUP BY winner_name ORDER BY count(*) DESC, max(finished_at) DESC LIMIT 100`,
    )
  ).rows;
  const byDeck = (
    await query<{ name: string; deck_name: string | null; wins: string }>(
      `SELECT winner_name AS name, deck_name, count(*)::text AS wins
       FROM game_results GROUP BY winner_name, deck_name ORDER BY count(*) DESC`,
    )
  ).rows;
  return totals.map((t) => ({
    name: t.name,
    wins: Number(t.wins),
    lastWin: t.last_win,
    decks: byDeck
      .filter((d) => d.name === t.name)
      .map((d) => ({ deckName: d.deck_name ?? "(no deck)", wins: Number(d.wins) })),
  }));
}
