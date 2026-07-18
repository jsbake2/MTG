-- Custom cards & sets. Our DB is the source of truth (nothing lost, easy
-- edit/copy/delete). A "sync to Forge" step writes these into ~/.forge/custom/
-- (editions + card scripts) + the pics cache (art) — which survive Forge updates.

CREATE TABLE IF NOT EXISTS custom_sets (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code       text NOT NULL UNIQUE,           -- Forge edition Code (e.g. WOT, ADVTIME)
  name       text NOT NULL,                  -- "Wheel of Time"
  release_date date NOT NULL DEFAULT current_date,
  owner_id   uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS custom_cards (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  set_id      uuid NOT NULL REFERENCES custom_sets(id) ON DELETE CASCADE,
  name        text NOT NULL,
  mana_cost   text,                          -- Forge form: "1 R" / "no cost"
  types       text NOT NULL DEFAULT 'Creature', -- "Creature Goblin"
  power       text,                          -- kept as text ("*", "2")
  toughness   text,
  loyalty     text,
  keywords    text[] NOT NULL DEFAULT '{}',  -- Flying, Trample, ...
  oracle      text NOT NULL DEFAULT '',      -- rules text
  flavor      text,
  rarity      text NOT NULL DEFAULT 'C',     -- C U R M S L (Forge rarity codes)
  artist      text,
  collector_number int,                      -- unique within a set
  art_path    text,                          -- uploaded image on our server
  -- The compiled Forge card script (.txt). Generated from the fields above, OR
  -- hand-written in the advanced editor (advanced=true means don't regenerate).
  forge_script text NOT NULL DEFAULT '',
  advanced    boolean NOT NULL DEFAULT false,
  created_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (set_id, name)
);
CREATE INDEX IF NOT EXISTS idx_custom_cards_set ON custom_cards(set_id);
