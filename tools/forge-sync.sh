#!/usr/bin/env bash
# Pull custom cards/sets/art/decks from the MTG-pvp hub into this machine's Forge.
# Usage: HUB=https://your-server ./forge-sync.sh   (default: http://localhost:8477)
# Auth:  set MTG_COOKIE="mtg_session=..." (the launcher forge-play.sh does this
#        for you after a login popup).
# Requires: curl, jq, base64 (all standard).
set -euo pipefail
HUB="${HUB:-http://localhost:8477}"
COOKIE="${MTG_COOKIE:-}"   # mtg_session=... if the hub needs auth
CUSTOM="$HOME/.forge/custom"
PICS="$HOME/.cache/forge/pics"
DECKS="$HOME/.forge/decks"
FORGE_HOME="${FORGE_HOME:-$HOME/forge-app}"        # Forge install (for TypeLists.txt)
TYPELISTS="${FORGE_RES:-$FORGE_HOME/res}/lists/TypeLists.txt"
echo ">> pulling bundle from $HUB"
JSON="$(curl -fsSL ${COOKIE:+-H "Cookie: $COOKIE"} "$HUB/api/custom/bundle")"

mkdir -p "$CUSTOM/editions" "$CUSTOM/cards"
echo "$JSON" | jq -c '.editions[]' | while read -r e; do
  fn="$(echo "$e" | jq -r '.filename')"
  echo "$e" | jq -r '.content' > "$CUSTOM/editions/$fn"
done
echo "$JSON" | jq -c '.cards[]' | while read -r c; do
  letter="$(echo "$c" | jq -r '.letter')"; fn="$(echo "$c" | jq -r '.filename')"
  mkdir -p "$CUSTOM/cards/$letter"
  echo "$c" | jq -r '.content' > "$CUSTOM/cards/$letter/$fn"
done
echo "$JSON" | jq -c '.art[]' | while read -r a; do
  code="$(echo "$a" | jq -r '.setCode')"; fn="$(echo "$a" | jq -r '.filename')"
  mkdir -p "$PICS/cards/$code"
  echo "$a" | jq -r '.dataBase64' | base64 -d > "$PICS/cards/$code/$fn"
done
# Decks straight into Forge's deck folders — no manual .dck copying.
echo "$JSON" | jq -c '.decks[]?' | while read -r d; do
  folder="$(echo "$d" | jq -r '.folder')"; fn="$(echo "$d" | jq -r '.filename')"
  mkdir -p "$DECKS/$folder"
  echo "$d" | jq -r '.content' > "$DECKS/$folder/$fn"
done

# Custom token scripts (1/1 Aes Sedai token, etc.) → Forge's custom tokenscripts.
mkdir -p "$CUSTOM/tokenscripts"
echo "$JSON" | jq -c '.tokenscripts[]?' | while read -r t; do
  slug="$(echo "$t" | jq -r '.slug')"
  echo "$t" | jq -r '.content' > "$CUSTOM/tokenscripts/$slug.txt"
done
# Token images → Forge's token pics cache (keyed to the edition [tokens] index).
echo "$JSON" | jq -c '.tokenart[]?' | while read -r t; do
  code="$(echo "$t" | jq -r '.setCode')"; fn="$(echo "$t" | jq -r '.filename')"
  mkdir -p "$PICS/tokens/$code"
  echo "$t" | jq -r '.dataBase64' | base64 -d > "$PICS/tokens/$code/$fn"
done

# Register custom creature subtypes (Aes Sedai, Channeler, …) in Forge's
# TypeLists.txt so `.AesSedai`-style filters work. Idempotent; re-applied each run
# because Forge updates reset that file. Inserts "Name:Name" before [SpellTypes].
if [ -f "$TYPELISTS" ]; then
  add=""
  while IFS= read -r sub; do
    [ -z "$sub" ] && continue
    grep -qxF "$sub:$sub" "$TYPELISTS" 2>/dev/null || grep -qF "$sub:" "$TYPELISTS" 2>/dev/null || add="${add}${sub}:${sub}"$'\n'
  done < <(echo "$JSON" | jq -r '.subtypes[]?')
  if [ -n "$add" ]; then
    awk -v add="$add" '/^\[SpellTypes\]/ && !d {printf "%s", add; d=1} {print}' "$TYPELISTS" > "$TYPELISTS.tmp" && mv "$TYPELISTS.tmp" "$TYPELISTS"
    echo ">> registered $(printf '%s' "$add" | grep -c . ) new creature subtype(s) in TypeLists.txt"
  fi
else
  echo "!! TypeLists.txt not found at $TYPELISTS — set FORGE_HOME. Custom subtypes NOT registered (Channeler/Anathema filters may not work)."
fi

n_cards=$(echo "$JSON" | jq '.cards | length')
n_art=$(echo "$JSON"   | jq '.art | length')
n_deck=$(echo "$JSON"  | jq '.decks | length')
n_tok=$(echo "$JSON"   | jq '.tokenscripts | length')
n_sub=$(echo "$JSON"   | jq '.subtypes | length')
echo ">> synced: $n_cards cards, $n_art faces, $n_deck decks, $n_tok tokens, $n_sub subtypes registered."
