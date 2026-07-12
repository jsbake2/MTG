-- Card RULES store (rules-engine plan "C2").
-- One row per oracle_id holding the structured, engine-executable behaviour of a
-- card: its behaviour TAGS (grounded in the CR keyword vocabulary), the compiled
-- EffectOp lists per hook (spell resolution, ETB, triggers, activated abilities,
-- modal modes), a coverage STATUS, and provenance. This is what makes guided play
-- tie to each card individually, and it is human-correctable + versioned.
--
-- Card *data* already lives in `cards` (Scryfall import). This table is the
-- separately-authored rules layer keyed to it by oracle_id.

CREATE TABLE IF NOT EXISTS card_rules (
  oracle_id     uuid PRIMARY KEY,
  name          text NOT NULL,

  -- Lifecycle of this card's rules:
  --   vanilla  — no rules text (basic land / vanilla creature): plays as-is
  --   covered  — every clause compiles to real engine ops
  --   partial  — some clauses model, some fall back to manual/ask
  --   blocked  — nothing (or almost nothing) models: needs authoring/review
  --   authored — hand/LLM-authored script, verified
  --   discard  — art/token/placeholder object, excluded from play (pending review)
  status        text NOT NULL DEFAULT 'blocked',

  -- How coverage was achieved: vanilla | keyword | compiled | script | authored
  coverage      text,
  -- Where the rules came from: compiler | script | llm | human
  source        text NOT NULL DEFAULT 'compiler',

  -- Behaviour tags (CR keyword abilities/actions + effect primitives), e.g.
  --   {counter, draw}  {trample, flying}  {destroy, mass}
  tags          text[] NOT NULL DEFAULT '{}',

  -- Compiled EffectOp lists per engine hook (shape = shared/src/effects.ts).
  ops           jsonb NOT NULL DEFAULT '[]',   -- spell / resolution effect
  etb           jsonb NOT NULL DEFAULT '[]',   -- enters-the-battlefield effect
  triggers      jsonb NOT NULL DEFAULT '[]',   -- triggered abilities
  abilities     jsonb NOT NULL DEFAULT '[]',   -- activated abilities
  modes         jsonb,                          -- modal ("choose one —") modes, or null

  -- Clauses the compiler could NOT model (drives the blocked-cards review report).
  unmodeled     jsonb NOT NULL DEFAULT '[]',

  version       int NOT NULL DEFAULT 1,
  tests_passing boolean NOT NULL DEFAULT false,
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_card_rules_status ON card_rules(status);
CREATE INDEX IF NOT EXISTS idx_card_rules_source ON card_rules(source);
CREATE INDEX IF NOT EXISTS idx_card_rules_tags   ON card_rules USING gin(tags);

-- Append-only version history (the plan requires scripts be versioned so a
-- regressing change can be rolled back and sessions can pin a known-good version).
CREATE TABLE IF NOT EXISTS card_rules_versions (
  id         bigserial PRIMARY KEY,
  oracle_id  uuid NOT NULL,
  version    int NOT NULL,
  snapshot   jsonb NOT NULL,   -- full card_rules row at this version
  source     text,
  note       text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (oracle_id, version)
);
CREATE INDEX IF NOT EXISTS idx_card_rules_versions_oracle ON card_rules_versions(oracle_id);
