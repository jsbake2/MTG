-- Link a token script to the arted token card whose image Forge should show for
-- it (pics/tokens/<CODE>/<index>_<slug>.jpg). Nullable — unmapped scripts fall
-- back to Forge's auto-rendered token frame.
ALTER TABLE custom_tokenscripts ADD COLUMN IF NOT EXISTS card_id uuid REFERENCES custom_cards(id) ON DELETE SET NULL;
