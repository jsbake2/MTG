-- Forge ability/keyword catalog, mined from Forge's card scripts, to power the
-- guided card creator: pick a keyword or copy an ability from a real card.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Every Forge card script (raw text) so we can search abilities across all cards
-- ("find a card that does what you want and copy its ability" — Forge's own tip).
CREATE TABLE IF NOT EXISTS forge_scripts (
  name_key text PRIMARY KEY,
  name     text NOT NULL,
  letter   text NOT NULL,
  script   text NOT NULL
);
-- Full-text over the script body for ability search.
CREATE INDEX IF NOT EXISTS idx_forge_scripts_fts ON forge_scripts USING gin (to_tsvector('simple', script));
CREATE INDEX IF NOT EXISTS idx_forge_scripts_name_trgm ON forge_scripts USING gin (lower(name) gin_trgm_ops);

-- Distinct keyword catalog (K: lines): base keyword, a representative full form,
-- how many cards use it, and an example card. Drives the keyword picker.
CREATE TABLE IF NOT EXISTS forge_keywords (
  keyword   text PRIMARY KEY,     -- base, e.g. "Crew", "Saddle", "Flying"
  sample    text NOT NULL,        -- representative full K: payload, e.g. "Crew:3"
  hits      int  NOT NULL DEFAULT 0,
  example   text                  -- an example card name
);
