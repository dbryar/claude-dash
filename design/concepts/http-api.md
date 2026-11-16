# Concept: HTTP API

Part of `claude-dash`'s design. See [`../README.md`](../README.md) for how this folder is used.

## Purpose

Serve the dashboard and its data to a browser on the same machine, accept prompts to send to a waiting session, and report the server's health to the watchdog.

## Boundaries

**Owns:**

- The routes `/`, `/api/sessions`, `POST /api/sessions/<id>/prompt`, `POST /api/sessions/<id>/close` and `/healthz`, and the listening address.
- Refusing requests that do not come from the dashboard page itself.
- The code hash reported by `/healthz`.

**Does not own:**

- The session data, assembled by [Session discovery](session-discovery.md).
- Sending a prompt, done by [Prompt delivery](prompt-delivery.md).
- Closing a session, done by [Session closing](session-closing.md).
- The page's behaviour, owned by [Dashboard UI](dashboard-ui.md).
- Keeping the process running, owned by [Service supervision](service-supervision.md) and [Watchdog](watchdog.md).

## Interactions

| Interacts with | Nature of the interaction | Status |
| --- | --- | --- |
| [Session discovery](session-discovery.md) | Calls it on every `/api/sessions` request | `implemented` |
| [Dashboard UI](dashboard-ui.md) | Serves `index.html` at `/`; answers its polling and its prompt requests | `implemented` |
| [Prompt delivery](prompt-delivery.md) | Passes the session id and text, maps the outcome to a status code | `implemented` |
| [Session closing](session-closing.md) | Passes the session id and confirmation, maps the outcome to a status code | `implemented` |
| [Watchdog](watchdog.md) | Answers `/healthz` | `implemented` |
| [Configuration](configuration.md) | Reads the port | `implemented` |

## Design decisions

- **Localhost only.** Transcripts hold whole conversations, so the server binds `127.0.0.1`.
- **Write routes usable only from the dashboard page.** Sending a prompt makes a session act with your permissions, and closing one stops a process, so no other web page you visit may trigger either. A browser lets any site send a request to `127.0.0.1`, and DNS rebinding can make a hostile site appear to be on `127.0.0.1`. Both routes therefore require the `Host` header to be this server's own address and the `Origin` header to be this server's own origin, and only accepts `application/json` (a cross-site JSON request needs a CORS preflight, which this server never grants). Every other route is read only.
- **Refusals say why**, so the page can show a useful message: 400 invalid, 403 not from the dashboard, 404 no such live session, 409 session busy or confirmation needed, 413 too long, 415 not JSON, 422 not in a Terminal tab or not a Claude Code process, 502 Terminal could not be controlled.
- **No dependencies beyond Bun.** Nothing to install, nothing to keep patched.
- **The code hash is taken at start-up** over `server.ts`, `index.html` and `.env` in that order (an absent `.env` contributes nothing). It describes the code the process is running, which may differ from the files on disk.

## Acceptance criteria

1. The server listens on `127.0.0.1` only, on the configured port.
2. `GET /` returns `index.html` as `text/html; charset=utf-8`.
3. `GET /api/sessions` returns JSON with `generatedAt`, `live` and `closed`.
4. `GET /healthz` returns JSON with `ok: true`, `pid`, `startedAt` and `codeHash`.
5. `codeHash` equals the SHA-256 of the bytes of `server.ts`, `index.html` and `.env` (if present), concatenated in that order, as they were when the process started.
6. `POST /api/sessions/<id>/prompt` with JSON `{"text": "..."}` hands the text to [Prompt delivery](prompt-delivery.md) and returns `{"ok": true}` on success, or `{"ok": false, "error": "<reason>"}` with the status codes listed under design decisions.
7. `POST /api/sessions/<id>/close` with JSON `{"confirmed": true|false}` hands the request to [Session closing](session-closing.md) and returns `{"ok": true, "window": "<what happened to the window>"}` on success, or `{"ok": false, "error": "<reason>"}`.
8. Given a prompt or close request whose `Host` is not `127.0.0.1:<port>` or `localhost:<port>`, or whose `Origin` is missing or not `http://127.0.0.1:<port>` or `http://localhost:<port>`, then it returns 403 and nothing is sent.
9. Given a prompt or close request whose `Content-Type` is not `application/json`, then it returns 415 and nothing is sent.
10. Given a request body over 64 KB, or not valid JSON with a string `text` (prompt) or an optional boolean `confirmed` (close), then it returns 400 or 413 and nothing is done.
11. The server never sends `Access-Control-Allow-Origin` or answers a CORS preflight.
12. Any other path or method returns 404.

## Known implementation gaps

- No automated tests cover these criteria yet.

## Change history

Recorded in [`../changelog.md`](../changelog.md).
