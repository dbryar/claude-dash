# Concept: Service supervision

Part of `claude-dash`'s design. See [`../README.md`](../README.md) for how this folder is used.

## Purpose

Keep the dashboard running for the logged-in user without a terminal tab of its own, and make installing and removing it one command.

## Boundaries

**Owns:**

- `install.sh` (install, reinstall, `--uninstall`).
- The two LaunchAgent templates in `launchd/` and the plists generated from them.
- Restarting the server when it exits.

**Does not own:**

- Detecting a hung server or changed code, owned by [Watchdog](watchdog.md).
- Settings, owned by [Configuration](configuration.md).

## Interactions

| Interacts with | Nature of the interaction | Status |
| --- | --- | --- |
| macOS launchd (external) | Bootstraps and boots out `local.session-board` and `local.session-board.watchdog` in the user's GUI domain | `implemented` |
| [HTTP API](http-api.md) | launchd runs `bun server.ts` with the repository as working directory | `implemented` |
| [Watchdog](watchdog.md) | Installs its agent with a 30-second interval and watched paths | `implemented` |
| [Configuration](configuration.md) | Creates `.env` from `.env.example` when missing | `implemented` |

## Design decisions

- **Per-user LaunchAgents, not a system LaunchDaemon.** The dashboard reads one user's files and only matters while that user is logged in, so it runs as them and never needs `sudo`.
- **Templates are committed; generated plists are not.** The plists hold machine paths, so `install.sh` fills `{{BUN}}`, `{{DIR}}` and `{{LOGS}}` at install time.
- **`KeepAlive` with a 10-second throttle** restarts a crashed server without spinning on a broken one.

## Acceptance criteria

1. Running `install.sh` removes any existing agents, writes both plists to `~/Library/LaunchAgents`, validates them with `plutil`, and loads them; afterwards `/healthz` answers.
2. Running `install.sh` twice leaves exactly one instance of each agent.
3. Given `.env` is missing, then `install.sh` copies `.env.example` to `.env`.
4. Given `bun` is not on `PATH`, then `install.sh` exits non-zero with a message and installs nothing.
5. Given a repository path containing `&`, `<` or `|`, then the generated plists are still valid.
6. Given the server process is killed, then launchd starts it again within about 10 seconds.
7. Running `install.sh --uninstall` unloads both agents and deletes both plists.
8. Server and watchdog output go to `~/Library/Logs/session-board/`.

## Known implementation gaps

- No automated tests cover these criteria yet. Criteria 1 and 6 were checked by hand on 16-11-2026.

## Change history

Recorded in [`../changelog.md`](../changelog.md).
