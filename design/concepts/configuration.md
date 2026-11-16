# Concept: Configuration

Part of `claude-dash`'s design. See [`../README.md`](../README.md) for how this folder is used.

## Purpose

Hold the settings that differ from one machine or employer to the next, outside version control, so the repository carries no organisation-specific data.

## Boundaries

**Owns:**

- `.env` (git-ignored) and `.env.example` (committed, placeholder values only).
- `TICKET_PREFIXES`, `SESSION_BOARD_PORT`, `SESSION_BOARD_RECENT_DAYS` and their defaults.
- Building the ticket-matching pattern from `TICKET_PREFIXES`.

**Does not own:**

- Loading `.env` into the server, which Bun does from the working directory set by [Service supervision](service-supervision.md).
- Reloading after a change, owned by [Watchdog](watchdog.md).

## Interactions

| Interacts with | Nature of the interaction | Status |
| --- | --- | --- |
| [Transcript digest](transcript-digest.md) | Supplies the ticket pattern | `implemented` |
| [Session discovery](session-discovery.md) | Supplies the closed-list window | `implemented` |
| [HTTP API](http-api.md) | Supplies the port | `implemented` |
| [Watchdog](watchdog.md) | Sources `.env` for the port; includes `.env` in the code hash | `implemented` |
| [Service supervision](service-supervision.md) | `install.sh` creates `.env` from `.env.example` when missing | `implemented` |

## Design decisions

- **No organisation data in the repository.** Ticket prefixes identify an employer's projects and change process, so they live only in `.env`.
- **A useful default without configuration.** With no prefixes, any Jira-style key (`ABC-123`) matches.

## Acceptance criteria

1. `.env` is listed in `.gitignore`, and `.env.example` contains placeholder values only.
2. Given `TICKET_PREFIXES=ABC,OPS`, then `ABC-12`, `ABC12`, `OPS-123` and `OPS0012345` match, and `XYZ-12` and `ABC-1` (fewer than two digits) do not.
3. Given `TICKET_PREFIXES` unset or empty, then keys of the form `[A-Z][A-Z0-9]{1,9}-<digits>` match.
4. Given a prefix containing anything other than letters and digits, then that prefix is ignored.
5. Given `SESSION_BOARD_PORT` unset, then the port is 7377; given `SESSION_BOARD_RECENT_DAYS` unset, then the window is 7 days.
6. Given `.env` changes, then the running server picks up the new values (via [Watchdog](watchdog.md)).

## Known implementation gaps

- No automated tests cover these criteria yet.

## Change history

Recorded in [`../changelog.md`](../changelog.md).
