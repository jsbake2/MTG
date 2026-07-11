import { useEffect, useState } from "react";
import type { LeaderboardEntry } from "@mtg/shared";
import { api } from "@/api/client";

export function Leaderboard() {
  const [rows, setRows] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get<{ leaderboard: LeaderboardEntry[] }>("/api/leaderboard")
      .then((r) => setRows(r.leaderboard))
      .finally(() => setLoading(false));
  }, []);

  const medal = (i: number) => (i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `${i + 1}.`);

  return (
    <div className="mx-auto max-w-3xl p-4">
      <h1 className="mb-1 font-display text-2xl text-table-accentSoft">🏆 Leaderboard</h1>
      <p className="mb-4 text-sm text-table-muted">Wins are recorded automatically when a game finishes, tracked by player and the deck they used.</p>
      {loading ? (
        <div className="text-table-muted">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="panel p-8 text-center text-table-muted">No games finished yet. Play one and the winner shows up here!</div>
      ) : (
        <div className="space-y-2">
          {rows.map((r, i) => (
            <div key={r.name} className="panel flex items-center gap-3 p-3">
              <div className="w-8 text-center font-display text-lg">{medal(i)}</div>
              <div className="flex-1">
                <div className="font-semibold">{r.name}</div>
                <div className="mt-0.5 flex flex-wrap gap-1">
                  {r.decks.slice(0, 6).map((d) => (
                    <span key={d.deckName} className="chip text-xs">
                      {d.deckName} · {d.wins}W
                    </span>
                  ))}
                </div>
              </div>
              <div className="text-right">
                <div className="font-display text-2xl text-table-accentSoft">{r.wins}</div>
                <div className="text-[10px] uppercase tracking-wide text-table-muted">wins</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
