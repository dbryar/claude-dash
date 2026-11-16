# Concept: Dashboard UI

Part of `claude-dash`'s design. See [`../README.md`](../README.md) for how this folder is used.

## Purpose

Show every session on one page, ordered by what needs you, so you can find the tab that wants an answer and close the ones that don't.

## Boundaries

**Owns:**

- `index.html`: layout, grouping, filtering, refresh and the copy-resume action.
- How times and dates are displayed.

**Does not own:**

- The data or the attention labels, which arrive from [HTTP API](http-api.md).

## Interactions

| Interacts with | Nature of the interaction | Status |
| --- | --- | --- |
| [HTTP API](http-api.md) | Fetches `/api/sessions` on load and every 5 seconds | `implemented` |
| [Attention classification](attention-classification.md) | Uses the label for group and colour | `implemented` |

## Design decisions

- **Groups in order of urgency**: waiting on you, working, idle. Closed sessions are hidden until asked for, so they don't crowd out open ones.
- **The card leads with Claude Code's own title and away summary**, the fastest answer to "what was this doing?".
- **Copy resume, not a resume button.** The page cannot open a terminal, and the command is what you need to paste.
- **A single static file** with inline styles and script, light and dark themes, and no external requests.

## Acceptance criteria

1. Live sessions are grouped as "Waiting on you", "Working", "Idle", in that order, each group sorted by last activity, most recent first, and empty groups are not shown.
2. Each card shows, where present: session name, repository, attention label, ticket keys, title (falling back to the first prompt, then "(untitled)"), away summary with its age, last prompt, last activity, start time, pid, cost, and the last reply (collapsed, last 3,000 characters).
3. The header shows counts of open sessions by label and the time of the last refresh.
4. Typing in the filter box shows only cards whose name, repository, title, away summary, last prompt, tickets or first prompt contain the text, case-insensitively.
5. The "show recently closed" checkbox adds a "Closed, resumable" group from `closed`.
6. Clicking "copy resume" copies `claude --resume <session id>` to the clipboard.
7. The page refreshes data every 5 seconds without reloading; when the server is unreachable, the header says so.
8. Dates display as `DD-MM-YYYY HH:mm` in 24-hour time.
9. All session text is HTML-escaped before display.

## Known implementation gaps

- No automated tests cover these criteria yet.

## Change history

Recorded in [`../changelog.md`](../changelog.md).
