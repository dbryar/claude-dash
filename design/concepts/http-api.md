# Concept: HTTP API

Part of `claude-dash`'s design. See [`../README.md`](../README.md) for how this folder is used.

## Purpose

Serve the dashboard and its data to a browser on the same machine, and report the server's health to the watchdog.

## Boundaries

**Owns:**

- The routes `/`, `/api/sessions` and `/healthz`, and the listening address.
- The code hash reported by `/healthz`.

**Does not own:**

- The session data, assembled by [Session discovery](session-discovery.md).
- The page's behaviour, owned by [Dashboard UI](dashboard-ui.md).
- Keeping the process running, owned by [Service supervision](service-supervision.md) and [Watchdog](watchdog.md).

## Interactions

| Interacts with | Nature of the interaction | Status |
| --- | --- | --- |
| [Session discovery](session-discovery.md) | Calls it on every `/api/sessions` request | `implemented` |
| [Dashboard UI](dashboard-ui.md) | Serves `index.html` at `/`; answers its polling | `implemented` |
| [Watchdog](watchdog.md) | Answers `/healthz` | `implemented` |
| [Configuration](configuration.md) | Reads the port | `implemented` |

## Design decisions

- **Localhost only, read only.** Transcripts hold whole conversations, so the server binds `127.0.0.1` and has no write routes.
- **No dependencies beyond Bun.** Nothing to install, nothing to keep patched.
- **The code hash is taken at start-up** over `server.ts`, `index.html` and `.env` in that order (an absent `.env` contributes nothing). It describes the code the process is running, which may differ from the files on disk.

## Acceptance criteria

1. The server listens on `127.0.0.1` only, on the configured port.
2. `GET /` returns `index.html` as `text/html; charset=utf-8`.
3. `GET /api/sessions` returns JSON with `generatedAt`, `live` and `closed`.
4. `GET /healthz` returns JSON with `ok: true`, `pid`, `startedAt` and `codeHash`.
5. `codeHash` equals the SHA-256 of the bytes of `server.ts`, `index.html` and `.env` (if present), concatenated in that order, as they were when the process started.
6. Any other path returns 404.

## Known implementation gaps

- No automated tests cover these criteria yet.

## Change history

Recorded in [`../changelog.md`](../changelog.md).
