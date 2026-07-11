-- Card provenance for filtering out joke/test cards, and a precon flag on decks.
ALTER TABLE cards ADD COLUMN IF NOT EXISTS set_type text;
ALTER TABLE cards ADD COLUMN IF NOT EXISTS border_color text;
CREATE INDEX IF NOT EXISTS idx_cards_set_type ON cards(set_type);

ALTER TABLE decks ADD COLUMN IF NOT EXISTS is_precon boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_decks_precon ON decks(is_precon);
