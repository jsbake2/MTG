-- Custom token scripts (Forge tokenscript files) that custom cards create, e.g.
-- a 1/1 white Aes Sedai token. Shipped in the sync bundle → each machine writes
-- them to ~/.forge/custom/tokenscripts/. Keyed by slug (= TokenScript$ name).
CREATE TABLE IF NOT EXISTS custom_tokenscripts (
  slug       text PRIMARY KEY,
  content    text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
