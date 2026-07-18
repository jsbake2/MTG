-- Custom cards are mirrored into the main `cards` pool (same id) so they work in
-- Browse, the deck builder, deck reading, and Forge export like any other card.
-- This flag marks those rows (image route serves the composited render for them).
ALTER TABLE cards ADD COLUMN IF NOT EXISTS is_custom boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_cards_is_custom ON cards(is_custom);
