-- User-set deck tags, and game results for the leaderboard.
ALTER TABLE decks ADD COLUMN IF NOT EXISTS tags text[] NOT NULL DEFAULT '{}';

CREATE TABLE IF NOT EXISTS game_results (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  finished_at    timestamptz NOT NULL DEFAULT now(),
  format_id      text NOT NULL DEFAULT '',
  winner_user_id uuid,
  winner_name    text NOT NULL,
  deck_id        uuid,
  deck_name      text,
  player_count   int NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_results_winner ON game_results(lower(winner_name));
CREATE INDEX IF NOT EXISTS idx_results_finished ON game_results(finished_at DESC);
