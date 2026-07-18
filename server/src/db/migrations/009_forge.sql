-- Forge integration: the set of cards Forge supports (from its cardsfolder), a
-- version stamp, and a log of cards a user tried to export that Forge doesn't
-- support yet (so we can attempt our own Forge card scripts).

-- Every card name Forge has a script for. name_key = lower(name) for matching.
CREATE TABLE IF NOT EXISTS forge_cards (
  name_key text PRIMARY KEY,
  name     text NOT NULL
);

-- Which Forge release our supported-set was imported from.
CREATE TABLE IF NOT EXISTS forge_meta (
  id          int PRIMARY KEY DEFAULT 1,
  version     text,
  card_count  int,
  imported_at timestamptz NOT NULL DEFAULT now()
);

-- Cards a deck tried to export but Forge doesn't support — surfaced under rulings
-- so we can write a Forge card script for them.
CREATE TABLE IF NOT EXISTS forge_unsupported (
  name        text PRIMARY KEY,
  first_seen  timestamptz NOT NULL DEFAULT now(),
  last_seen   timestamptz NOT NULL DEFAULT now(),
  hits        int NOT NULL DEFAULT 1,
  forge_version text,
  status      text NOT NULL DEFAULT 'open', -- open | scripted | wontfix
  script      text                          -- our authored Forge .txt script, if any
);
CREATE INDEX IF NOT EXISTS idx_forge_unsupported_status ON forge_unsupported(status);
