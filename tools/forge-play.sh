#!/usr/bin/env bash
# One-click "Play": logs in to the MTG-pvp hub, pulls all custom cards + decks
# into this machine's Forge, then launches Forge. Designed to be the desktop
# icon the kids click — no terminal, no manual copying.
#
#   - First run pops up a login (username + password for the family MTG site).
#   - The session is cached for 30 days, so later runs just sync + launch.
#   - Override the server with:  HUB=https://your-host ./forge-play.sh
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_DIR="$HOME/.config/mtg-forge"
COOKIE_FILE="$CONFIG_DIR/cookie"
HUB_FILE="$CONFIG_DIR/hub"
FORGE="${FORGE_SH:-$HOME/forge-app/forge.sh}"
mkdir -p "$CONFIG_DIR"; chmod 700 "$CONFIG_DIR"

# Hub URL: env > saved > default. Change the default to your server's address.
DEFAULT_HUB="https://mtg.jsb-emr.us"
HUB="${HUB:-$( [ -f "$HUB_FILE" ] && cat "$HUB_FILE" || echo "$DEFAULT_HUB" )}"
echo "$HUB" > "$HUB_FILE"

# --- tiny UI helpers (zenity → kdialog → terminal) -----------------------
have() { command -v "$1" >/dev/null 2>&1; }
say()  { if have zenity; then zenity --info --no-wrap --title="MTG Forge" --text="$1" 2>/dev/null;
         elif have kdialog; then kdialog --msgbox "$1" 2>/dev/null; else echo ">> $1"; fi; }
err()  { if have zenity; then zenity --error --no-wrap --title="MTG Forge" --text="$1" 2>/dev/null;
         elif have kdialog; then kdialog --error "$1" 2>/dev/null; else echo "!! $1" >&2; fi; }

# Ask for username + password, echo "user\npass". Empty on cancel.
ask_login() {
  if have zenity; then
    zenity --forms --title="Sign in to MTG" --text="Log in to load your cards & decks" \
      --add-entry="Username" --add-password="Password" --separator=$'\n' 2>/dev/null
  elif have kdialog; then
    local u p
    u="$(kdialog --inputbox "Username" 2>/dev/null)" || return 1
    p="$(kdialog --password "Password" 2>/dev/null)" || return 1
    printf '%s\n%s\n' "$u" "$p"
  else
    local u p
    read -r -p "MTG username: " u
    read -r -s -p "MTG password: " p; echo
    printf '%s\n%s\n' "$u" "$p"
  fi
}

# --- auth: reuse cached cookie if still valid, else log in ----------------
cookie_valid() {
  [ -f "$COOKIE_FILE" ] || return 1
  curl -fsSL -H "Cookie: $(cat "$COOKIE_FILE")" -o /dev/null "$HUB/api/auth/me"
}

login() {
  local creds user pass body code
  creds="$(ask_login)" || return 1
  user="$(printf '%s' "$creds" | sed -n '1p')"
  pass="$(printf '%s' "$creds" | sed -n '2p')"
  [ -n "$user" ] && [ -n "$pass" ] || { err "Login cancelled."; return 1; }
  # Capture the Set-Cookie session token from the login response headers.
  local hdr; hdr="$(mktemp)"
  code="$(curl -sS -o /dev/null -w '%{http_code}' -D "$hdr" \
    -H 'Content-Type: application/json' \
    -d "$(jq -n --arg u "$user" --arg p "$pass" '{username:$u,password:$p}')" \
    "$HUB/api/auth/login")"
  if [ "$code" != "200" ]; then rm -f "$hdr"; err "Login failed (wrong username or password?)."; return 1; fi
  local token; token="$(grep -i '^set-cookie:' "$hdr" | sed -n 's/.*mtg_session=\([^;]*\).*/mtg_session=\1/p' | head -1)"
  rm -f "$hdr"
  [ -n "$token" ] || { err "Login succeeded but no session returned."; return 1; }
  printf '%s' "$token" > "$COOKIE_FILE"; chmod 600 "$COOKIE_FILE"
}

for dep in curl jq base64; do have "$dep" || { err "Missing required tool: $dep. Install it and retry."; exit 1; }; done

if ! cookie_valid; then
  login || exit 1
  cookie_valid || { err "Could not authenticate to $HUB."; exit 1; }
fi

# --- sync then launch -----------------------------------------------------
export HUB MTG_COOKIE="$(cat "$COOKIE_FILE")"
if ! bash "$HERE/forge-sync.sh"; then
  err "Sync failed — launching Forge with whatever is already installed."
fi

if [ -x "$FORGE" ]; then
  exec "$FORGE"
else
  err "Forge not found at $FORGE. Run tools/install-forge.sh first (or set FORGE_SH)."
  exit 1
fi
