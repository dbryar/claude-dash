#!/bin/bash
# Installs (or reinstalls) the session board as two per-user LaunchAgents,
# built from the templates in launchd/:
#   local.session-board           the server, restarted by launchd whenever it exits
#   local.session-board.watchdog  health and code-change checks (watchdog.sh)
# Uninstall: ./install.sh --uninstall
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
AGENTS="$HOME/Library/LaunchAgents"
LOGS="$HOME/Library/Logs/session-board"
DOMAIN="gui/$(id -u)"
LABELS=(local.session-board local.session-board.watchdog)

for label in "${LABELS[@]}"; do
  launchctl bootout "$DOMAIN/$label" 2>/dev/null || true
  rm -f "$AGENTS/$label.plist"
done
if [ "${1:-}" = "--uninstall" ]; then echo "uninstalled"; exit 0; fi

BUN="$(command -v bun || true)"
if [ -z "$BUN" ]; then echo "bun not found on PATH (https://bun.sh)" >&2; exit 1; fi
if [ ! -f "$DIR/.env" ]; then
  cp "$DIR/.env.example" "$DIR/.env"
  echo "created .env from .env.example; edit it to set your ticket prefixes"
fi

mkdir -p "$AGENTS" "$LOGS"
chmod +x "$DIR/watchdog.sh"

# Paths are escaped for sed and for XML before substitution.
esc() { printf '%s' "$1" | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/[|\\&]/\\&/g'; }
for label in "${LABELS[@]}"; do
  sed -e "s|{{BUN}}|$(esc "$BUN")|g" -e "s|{{DIR}}|$(esc "$DIR")|g" -e "s|{{LOGS}}|$(esc "$LOGS")|g" \
    "$DIR/launchd/$label.plist.template" > "$AGENTS/$label.plist"
  plutil -lint -s "$AGENTS/$label.plist"
  launchctl bootstrap "$DOMAIN" "$AGENTS/$label.plist"
done

PORT="$(sed -n 's/^SESSION_BOARD_PORT=//p' "$DIR/.env" | tail -1)"
echo "installed: http://127.0.0.1:${PORT:-7377}  logs: $LOGS"
