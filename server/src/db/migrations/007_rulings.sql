-- Rulings-wizard answers. One row per backlog "issue" (a mechanic/clause family),
-- holding the game owner's decision on how the guided engine should implement it:
-- either the index of the chosen candidate ruling, or a custom write-in, plus an
-- optional "this is the best answer" flag and free-text detail. Drives authoring.
CREATE TABLE IF NOT EXISTS rule_rulings (
  issue_id    text PRIMARY KEY,
  chosen      int,           -- index into the issue's candidate rulings, or null for custom
  custom_text text,          -- write-in ruling when none of the guesses fit
  best        boolean NOT NULL DEFAULT false,
  details     text,          -- extra clarification the owner wants applied
  user_id     uuid,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
