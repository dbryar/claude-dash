# Concept: Watchdog

Part of `claude-dash`'s design. See [`../README.md`](../README.md) for how this folder is used.

## Purpose

Catch the two failures launchd cannot see on its own: a server that is running but not answering, and a server still running old code after the code or settings changed.

## Boundaries

**Owns:**

- `watchdog.sh`: the health check, the code-hash comparison and the restart.

**Does not own:**

- Restarting a server that exited, which launchd does under [Service supervision](service-supervision.md).
- When the watchdog runs, which its LaunchAgent sets.

## Interactions

| Interacts with | Nature of the interaction | Status |
| --- | --- | --- |
| [HTTP API](http-api.md) | Reads `/healthz` with a 5-second timeout | `implemented` |
| macOS launchd (external) | Runs it every 30 seconds and when `server.ts`, `index.html` or `.env` changes; it calls `launchctl kickstart -k` | `implemented` |
| [Configuration](configuration.md) | Sources `.env` for the port; hashes `.env` | `implemented` |

## Design decisions

- **Reload by comparing hashes, not with `bun --watch`.** `bun --watch` only follows imported modules, so it misses `index.html` and `.env`. Comparing the running process's hash with the files on disk covers all three and is visible in `/healthz`.
- **Wait before acting.** A 2-second pause lets an editor finish saving, so one save gives one restart. A further 5-second retry before declaring the server dead avoids restarting one that is still starting.

## Acceptance criteria

1. Given `/healthz` answers and its `codeHash` matches the SHA-256 of `server.ts`, `index.html` and `.env` on disk (concatenated in that order), then the watchdog does nothing.
2. Given the hashes differ, then the watchdog logs the old and new hash prefixes and restarts the server.
3. Given `/healthz` does not answer within 5 seconds on two attempts 5 seconds apart, then the watchdog logs it and restarts the server.
4. Given `.env` sets `SESSION_BOARD_PORT`, then the watchdog checks that port.
5. Given a saved change to `server.ts`, `index.html` or `.env`, then the server is running the new code within about 10 seconds.

## Known implementation gaps

- No automated tests cover these criteria yet. Criteria 2, 3 and 5 were checked by hand on 16-11-2026 (edit to `index.html`; server paused with `SIGSTOP`).

## Change history

Recorded in [`../changelog.md`](../changelog.md).
