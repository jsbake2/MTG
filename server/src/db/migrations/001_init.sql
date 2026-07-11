-- MTG-PvP initial schema.
-- Card data foundation + users/sessions/decks. Tables/games are held in
-- server memory at runtime, so they are not persisted here (yet).

CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------- users/auth
CREATE TABLE IF NOT EXISTS users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username      text UNIQUE NOT NULL,
  display_name  text NOT NULL,
  password_hash text NOT NULL,
  is_admin      boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  token      text PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

-- ---------------------------------------------------------------------- cards
-- One row per printing (scryfall id). oracle_id groups printings of one card.
CREATE TABLE IF NOT EXISTS cards (
  id               uuid PRIMARY KEY,
  oracle_id        uuid,
  name             text NOT NULL,
  mana_cost        text,
  cmc              real NOT NULL DEFAULT 0,
  type_line        text NOT NULL DEFAULT '',
  oracle_text      text,
  flavor_text      text,
  power            text,
  toughness        text,
  loyalty          text,
  colors           text[] NOT NULL DEFAULT '{}',
  color_identity   text[] NOT NULL DEFAULT '{}',
  keywords         text[] NOT NULL DEFAULT '{}',
  supertypes       text[] NOT NULL DEFAULT '{}',
  card_types       text[] NOT NULL DEFAULT '{}',
  subtypes         text[] NOT NULL DEFAULT '{}',
  set_code         text NOT NULL DEFAULT '',
  set_name         text NOT NULL DEFAULT '',
  collector_number text NOT NULL DEFAULT '',
  rarity           text NOT NULL DEFAULT 'common',
  released_at      date,
  year             int,
  artist           text,
  reserved         boolean NOT NULL DEFAULT false,
  legalities       jsonb NOT NULL DEFAULT '{}',
  faces            jsonb NOT NULL DEFAULT '[]',
  image_normal     text,
  image_small      text,
  image_art_crop   text,
  layout           text,
  digital          boolean NOT NULL DEFAULT false,
  -- Full text search over name + type + oracle text.
  tsv tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(name, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(type_line, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(oracle_text, '')), 'C')
  ) STORED
);

CREATE INDEX IF NOT EXISTS idx_cards_tsv        ON cards USING gin(tsv);
CREATE INDEX IF NOT EXISTS idx_cards_name_trgm  ON cards USING gin(lower(name) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_cards_oracle_trgm ON cards USING gin(lower(oracle_text) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_cards_type_trgm  ON cards USING gin(lower(type_line) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_cards_subtypes   ON cards USING gin(subtypes);
CREATE INDEX IF NOT EXISTS idx_cards_cardtypes  ON cards USING gin(card_types);
CREATE INDEX IF NOT EXISTS idx_cards_keywords   ON cards USING gin(keywords);
CREATE INDEX IF NOT EXISTS idx_cards_colors     ON cards USING gin(colors);
CREATE INDEX IF NOT EXISTS idx_cards_identity   ON cards USING gin(color_identity);
CREATE INDEX IF NOT EXISTS idx_cards_legalities ON cards USING gin(legalities);
CREATE INDEX IF NOT EXISTS idx_cards_oracle_id  ON cards(oracle_id);
CREATE INDEX IF NOT EXISTS idx_cards_cmc        ON cards(cmc);
CREATE INDEX IF NOT EXISTS idx_cards_year       ON cards(year);
CREATE INDEX IF NOT EXISTS idx_cards_set        ON cards(set_code);
CREATE INDEX IF NOT EXISTS idx_cards_rarity     ON cards(rarity);
-- For "one printing per oracle card" default listing, prefer newest.
CREATE INDEX IF NOT EXISTS idx_cards_oracle_released ON cards(oracle_id, released_at DESC);

-- ---------------------------------------------------------------------- decks
CREATE TABLE IF NOT EXISTS decks (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        text NOT NULL,
  format_id   text NOT NULL DEFAULT 'house',
  description text NOT NULL DEFAULT '',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_decks_owner ON decks(owner_id);

CREATE TABLE IF NOT EXISTS deck_cards (
  deck_id  uuid NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
  card_id  uuid NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  board    text NOT NULL DEFAULT 'main',  -- main | sideboard | commander
  quantity int NOT NULL DEFAULT 1,
  PRIMARY KEY (deck_id, card_id, board)
);

-- Import bookkeeping so we can show when the catalog was last refreshed.
CREATE TABLE IF NOT EXISTS import_meta (
  id         int PRIMARY KEY DEFAULT 1,
  imported_at timestamptz,
  card_count int NOT NULL DEFAULT 0,
  source     text,
  CONSTRAINT import_meta_singleton CHECK (id = 1)
);
