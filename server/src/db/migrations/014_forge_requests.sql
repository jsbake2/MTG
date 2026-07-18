-- Let users request a card that Forge doesn't have a script for. Reuses the
-- forge_unsupported table (already auto-populated by deck export) as the single
-- "cards we want in Forge" queue: add who asked + an optional note.
ALTER TABLE forge_unsupported ADD COLUMN IF NOT EXISTS note text;
ALTER TABLE forge_unsupported ADD COLUMN IF NOT EXISTS requested_by uuid REFERENCES users(id) ON DELETE SET NULL;
