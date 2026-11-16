#!/bin/bash
# Installs (or reinstalls) the session board as two per-user LaunchAgents:
#   local.session-board           the server, restarted by launchd whenever it exits
#   local.session-board.watchdog  health and code-change checks (watchdog.sh)
# Uninstall: ./install.sh --uninstall
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
AGENTS="$HOME/Library/LaunchAgents"
LOGS="$HOME/Library/Logs/session-board"
DOMAIN="gui/$(id -u)"
BUN="$(command -v bun)"

for label in local.session-board.watchdog local.session-board; do
  launchctl bootout "$DOMAIN/$label" 2>/dev/null || true
  rm -f "$AGENTS/$label.plist"
done
if [ "${1:-}" = "--uninstall" ]; then echo "uninstalled"; exit 0; fi

mkdir -p "$AGENTS" "$LOGS"
chmod +x "$DIR/watchdog.sh"

cat > "$AGENTS/local.session-board.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>local.session-board</string>
  <key>ProgramArguments</key><array><string>$BUN</string><string>$DIR/server.ts</string></array>
  <key>WorkingDirectory</key><string>$DIR</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>ProcessType</key><string>Background</string>
  <key>StandardOutPath</key><string>$LOGS/server.log</string>
  <key>StandardErrorPath</key><string>$LOGS/server.log</string>
</dict>
</plist>
EOF

cat > "$AGENTS/local.session-board.watchdog.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>local.session-board.watchdog</string>
  <key>ProgramArguments</key><array><string>$DIR/watchdog.sh</string></array>
  <key>StartInterval</key><integer>30</integer>
  <key>WatchPaths</key><array><string>$DIR/server.ts</string><string>$DIR/index.html</string><string>$DIR/.env</string></array>
  <key>ProcessType</key><string>Background</string>
  <key>StandardOutPath</key><string>$LOGS/watchdog.log</string>
  <key>StandardErrorPath</key><string>$LOGS/watchdog.log</string>
</dict>
</plist>
EOF

launchctl bootstrap "$DOMAIN" "$AGENTS/local.session-board.plist"
launchctl bootstrap "$DOMAIN" "$AGENTS/local.session-board.watchdog.plist"
echo "installed: http://127.0.0.1:${SESSION_BOARD_PORT:-7377}  logs: $LOGS"
