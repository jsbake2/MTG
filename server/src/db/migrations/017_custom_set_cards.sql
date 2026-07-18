-- Reprints: real (or other) cards pulled into a custom set as filler, the way a
-- real set reprints older cards. References the main `cards` pool; the card is
-- NOT copied — only its membership + this set's rarity/number are stored.
CREATE TABLE IF NOT EXISTS custom_set_cards (
  set_id           uuid NOT NULL REFERENCES custom_sets(id) ON DELETE CASCADE,
  card_id          uuid NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  rarity           text NOT NULL DEFAULT 'C',   -- C U R M S L, this set's rarity
  collector_number int,
  added_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (set_id, card_id)
);
CREATE INDEX IF NOT EXISTS idx_custom_set_cards_set ON custom_set_cards(set_id);
