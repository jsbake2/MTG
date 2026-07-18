#!/usr/bin/env bash
# Forge (Magic: The Gathering) — one-shot installer for CachyOS / Arch (Cosmic DE).
# Installs Java, downloads the latest Forge desktop release, and adds an app-menu
# entry. Run it as your normal user (it uses sudo only for package install).
set -euo pipefail

DEST="$HOME/forge-app"
TOOLS="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"  # this repo's tools/ dir
echo ">> Forge installer — target: $DEST"

# 1. Java 17 runtime (Forge needs Java 17+; 17 is the tested version).
if ! command -v java >/dev/null 2>&1; then
  echo ">> installing Java 17..."
  sudo pacman -Sy --needed --noconfirm jre17-openjdk
fi
# curl/tar/bzip2 for the download; jq/zenity for the sync + login-popup launcher.
sudo pacman -S --needed --noconfirm curl tar bzip2 jq zenity >/dev/null

# 2. Find + download the latest Forge desktop release (~290 MB).
echo ">> finding latest Forge release..."
URL="$(curl -fsSL https://api.github.com/repos/Card-Forge/forge/releases/latest \
  | grep -oE 'https://[^"]*forge-installer-[0-9.]+\.tar\.bz2' | head -1)"
[ -n "$URL" ] || { echo "!! could not find a download URL"; exit 1; }
echo ">> downloading: $URL"
mkdir -p "$DEST"; cd "$DEST"
curl -fL -o forge.tar.bz2 "$URL"

# 3. Extract.
echo ">> extracting..."
tar xjf forge.tar.bz2
rm -f forge.tar.bz2
chmod +x forge.sh

# 4. App-menu entries (show up in Cosmic's launcher).
chmod +x "$TOOLS/forge-play.sh" "$TOOLS/forge-sync.sh" 2>/dev/null || true
mkdir -p "$HOME/.local/share/applications"
# The main icon: sign in → sync all custom cards + decks → launch Forge.
cat > "$HOME/.local/share/applications/mtg-forge.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=Play MTG (Forge)
Comment=Sign in, sync our custom cards & decks, then play
Exec=$TOOLS/forge-play.sh
Path=$DEST
Terminal=false
Categories=Game;CardGame;
EOF
# A plain Forge entry too, for launching without a sync.
cat > "$HOME/.local/share/applications/forge.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=Forge (no sync)
Comment=Launch Forge without syncing
Exec=$DEST/forge.sh
Path=$DEST
Terminal=false
Categories=Game;CardGame;
EOF

echo ""
echo ">> DONE. Click 'Play MTG (Forge)' in your app menu — it signs in,"
echo "   pulls every custom card + deck from the hub, then launches Forge."
echo "   (Or run: $TOOLS/forge-play.sh)"
echo "   Decks land in: ~/.forge/decks/{constructed,commander}/*.dck"
