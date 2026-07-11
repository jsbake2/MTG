#!/usr/bin/env bash
# Regenerate the rules-coverage snapshot.
#
# Dumps every distinct card (by oracle id) from the running Postgres container as
# JSONL, then runs the analyzer, which writes docs/rules-coverage.json and
# docs/RULES-COVERAGE.md. Requires the mtg-postgres container to be up and the
# shared package built (npm run build:shared).
set -euo pipefail
cd "$(dirname "$0")/.."

OUT=/tmp/cards.jsonl
echo "Exporting distinct cards from Postgres…"
docker compose exec -T postgres sh -lc \
  'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc "COPY (SELECT json_build_object('\''name'\'',name,'\''type_line'\'',type_line,'\''card_types'\'',card_types,'\''supertypes'\'',supertypes,'\''keywords'\'',keywords,'\''oracle_text'\'',coalesce(oracle_text,'\'''\'')) FROM (SELECT distinct on (coalesce(oracle_id,id)) * FROM cards ORDER BY coalesce(oracle_id,id)) s) TO STDOUT"' \
  > "$OUT"
echo "Wrote $OUT ($(wc -l < "$OUT") cards). Analyzing…"
node tools/coverage.mjs "$OUT"
