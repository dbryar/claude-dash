# Concept: Configuration

Part of `claude-dash`'s design. See [`../README.md`](../README.md) for how this folder is used.

## Purpose

Hold the settings that differ from one machine or employer to the next, outside version control, so the repository carries no organisation-specific data.

## Boundaries

**Owns:**

- `.env` (git-ignored) and `.env.example` (committed, placeholder values only).
- `TICKET_PREFIXES`, `SESSION_BOARD_PORT`, `SESSION_BOARD_RECENT_DAYS`, `SESSION_BOARD_PERMISSION_MODE` and their defaults.
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
| [Session starting](session-starting.md) | Supplies the default permission mode | `implemented` |
| [Watchdog](watchdog.md) | Sources `.env` for the port; includes `.env` in the code hash | `implemented` |
| [Service supervision](service-supervision.md) | `install.sh` creates `.env` from `.env.example` when missing | `implemented` |

## Design decisions

- **No organisation data in the repository.** Ticket prefixes identify an employer's projects and change process, so they live only in `.env`.
- **A useful default without configuration.** With no prefixes, any Jira-style key (`ABC-123`) matches.
- **The default pattern needs a stop list.** A great deal of ordinary technical writing has the shape of a Jira key: `SHA-256` was shown as a ticket on two cards. The default therefore skips a short list of prefixes that are known not to be ticket systems (`SHA`, `UTF`, `ISO`, `RFC`, `AES`, `RSA`, `UTC`, `GMT`, `HTTP`, `TLS`, `SSL`, `IPV`, `CVE`, `COVID`). The list is deliberately short and literal: it fixes the cases that actually appear without trying to guess what is or is not a ticket.
- **An explicit prefix list is trusted completely.** When `TICKET_PREFIXES` is set, the stop list does not apply, because the prefixes name the user's own ticket systems and a user who sets `SHA` means it.

## Acceptance criteria

1. `.env` is listed in `.gitignore`, and `.env.example` contains placeholder values only.
2. Given `TICKET_PREFIXES=ABC,OPS`, then `ABC-12`, `ABC12`, `OPS-123` and `OPS0012345` match, and `XYZ-12` and `ABC-1` (fewer than two digits) do not.
3. Given `TICKET_PREFIXES` unset or empty, then keys of the form `[A-Z][A-Z0-9]{1,9}-<digits>` match, except that a key whose prefix is in the stop list does not match: `SHA-256`, `UTF-8`, `ISO-8601`, `RFC-2119` and `CVE-2026-1234` are not tickets, while `ABC-123` and `PROJ-45` are.
4. Given `TICKET_PREFIXES` is set, then the stop list does not apply, so `TICKET_PREFIXES=SHA` matches `SHA-256`.
5. Given a prefix containing anything other than letters and digits, then that prefix is ignored.
6. Given `SESSION_BOARD_PORT` unset, then the port is 7377; given `SESSION_BOARD_RECENT_DAYS` unset, then the window is 7 days.
6a. Given `SESSION_BOARD_PERMISSION_MODE` unset, or set to anything other than `skip`, `auto` or `ask`, then the default permission mode is `auto`.
7. Given `.env` changes, then the running server picks up the new values (via [Watchdog](watchdog.md)).

## Known implementation gaps

- No automated tests cover these criteria yet. Criteria 2 to 5 were checked by hand on 16-11-2026 against the pattern builder.
- The stop list is a fixed list in the code, not a setting. A ticket system genuinely named after one of those prefixes has to be named in `TICKET_PREFIXES` to be picked up.
- The two patterns disagree on how many digits a key needs: an explicit prefix requires two or more (criterion 2), the default accepts one (criterion 3), so `ABC-1` is a ticket by default but not when `ABC` is named. Both behaviours are as written here; the asymmetry is unintended and not yet resolved, because requiring two digits by default would stop matching single-digit keys for anyone relying on the default.

## Change history

Recorded in [`../changelog.md`](../changelog.md).
