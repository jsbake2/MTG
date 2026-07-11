-- Profile avatars: a card whose art crop is used as the user's avatar.
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_card_id uuid;
