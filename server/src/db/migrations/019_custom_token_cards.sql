-- Token cards: printable/visible token entries in a set (e.g. a 1/1 Aes Sedai
-- token). They are NOT real deck cards — excluded from the deck-builder pool and
-- from the Forge card bundle (Forge makes tokens from tokenscripts, not cards).
ALTER TABLE custom_cards ADD COLUMN IF NOT EXISTS is_token boolean NOT NULL DEFAULT false;
