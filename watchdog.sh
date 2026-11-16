#!/bin/bash
# Watchdog for local.session-board. Run by the LaunchAgent local.session-board.watchdog
# every 30 seconds and whenever a file in this directory changes.
# Restarts the service when /healthz does not answer, or when the code on disk
# or .env differs from what the running process loaded.
set -u
DIR="$(cd "$(dirname "$0")" && pwd)"
if [ -f "$DIR/.env" ]; then set -a; . "$DIR/.env"; set +a; fi
PORT="${SESSION_BOARD_PORT:-7377}"
LABEL="gui/$(id -u)/local.session-board"
log() { echo "$(date '+%Y-%m-%d %H:%M:%S') $*"; }

# Let an editor finish writing before hashing, so one save gives one restart.
sleep 2

disk_hash="$(cat "$DIR/server.ts" "$DIR/index.html" "$DIR/.env" 2>/dev/null | shasum -a 256 | cut -d' ' -f1)"
health="$(curl -sf --max-time 5 "http://127.0.0.1:$PORT/healthz")"

if [ -z "$health" ]; then
  # Give a fresh start (launchd restart or reload) time to bind before acting.
  sleep 5
  health="$(curl -sf --max-time 5 "http://127.0.0.1:$PORT/healthz")"
  if [ -z "$health" ]; then
    log "healthz not answering, restarting"
    launchctl kickstart -k "$LABEL"
    exit 0
  fi
fi

running_hash="$(printf '%s' "$health" | /usr/bin/python3 -c 'import json,sys; print(json.load(sys.stdin).get("codeHash",""))')"
if [ "$running_hash" != "$disk_hash" ]; then
  log "code changed (${running_hash:0:12} -> ${disk_hash:0:12}), restarting"
  launchctl kickstart -k "$LABEL"
fi
