-- Generated/uploaded art for custom cards, stored in the DB (persists across
-- container rebuilds; served for preview and written into Forge's pics on sync).
CREATE TABLE IF NOT EXISTS custom_art (
  card_id   uuid PRIMARY KEY REFERENCES custom_cards(id) ON DELETE CASCADE,
  mime      text NOT NULL DEFAULT 'image/jpeg',
  data      bytea NOT NULL,
  prompt    text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- App settings (e.g. the Google AI Studio Gemini API key), so the key can be set
-- via admin UI without a redeploy.
CREATE TABLE IF NOT EXISTS app_settings (
  key   text PRIMARY KEY,
  value text
);
