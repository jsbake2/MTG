-- Player-reported card issues. During play (or anywhere), a player can flag a
-- card whose rules behaved wrong or need defining. These accumulate as a queue
-- the owner/I review from time to time (like the rulings wizard, but sourced
-- from real games).
CREATE TABLE IF NOT EXISTS card_issues (
  id          bigserial PRIMARY KEY,
  card_id     uuid,          -- printing id if known
  oracle_id   uuid,          -- oracle id if known (groups printings)
  card_name   text NOT NULL,
  table_id    text,          -- the game table it was reported from, if any
  description text NOT NULL,  -- what went wrong / what rule is needed
  status      text NOT NULL DEFAULT 'open',   -- open | reviewing | resolved | wontfix
  resolution  text,          -- my notes / how it was addressed
  reporter_id uuid,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_card_issues_status ON card_issues(status);
CREATE INDEX IF NOT EXISTS idx_card_issues_oracle ON card_issues(oracle_id);
