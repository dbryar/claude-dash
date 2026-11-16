# Concept: Dashboard UI

Part of `claude-dash`'s design. See [`../README.md`](../README.md) for how this folder is used.

## Purpose

Show every session on one page, ordered by what needs you, so you can find the tab that wants an answer and close the ones that don't.

## Boundaries

**Owns:**

- `index.html`: layout, columns, filtering, refresh, view state and the copy-resume action.
- How times and dates are displayed.

**Does not own:**

- The data or the attention labels, which arrive from [HTTP API](http-api.md).

## Interactions

| Interacts with | Nature of the interaction | Status |
| --- | --- | --- |
| [HTTP API](http-api.md) | Fetches `/api/sessions` on load and every 5 seconds | `implemented` |
| [Attention classification](attention-classification.md) | Uses the label to pick the card's column and colour | `implemented` |

## Design decisions

- **One column per state, left to right in order of urgency**: waiting on you, working, idle. A session moving between states moves between columns, so a glance across the page shows what changed. Closed sessions get a fourth column only when asked for, so they don't crowd out open ones.
- **On a narrow screen, one column at a time, swiped left and right.** This uses CSS scroll snapping, so the browser handles the gesture and no gesture library is needed. A tab strip above the columns shows which column is in view and how many cards each holds.
- **Refreshing must not disturb what you're reading.** Cards are keyed by session id and only replaced when their content changes. An expanded last reply stays expanded, and keeps its scroll position, when its card is replaced.
- **The card leads with Claude Code's own title and away summary**, the fastest answer to "what was this doing?".
- **Copy resume, not a resume button.** The page cannot open a terminal, and the command is what you need to paste.
- **A single static file** with inline styles and script, light and dark themes, and no external requests.

## Acceptance criteria

1. Live sessions appear in three columns, left to right: "Waiting on you", "Working", "Idle". Each column heading shows its card count, cards within a column are sorted by last activity (most recent first), and an empty column stays in place with a note that it is empty.
2. Given a viewport wider than 720 px, then all columns are side by side and each column scrolls vertically on its own.
3. Given a viewport 720 px wide or narrower, then one column fills the width, swiping left or right moves to the neighbouring column and snaps to it, and a tab strip shows each column's name and count, highlights the column in view, and scrolls to a column when its tab is tapped.
4. Given "show recently closed" is ticked, then a fourth column, "Closed, resumable", appears to the right of "Idle" with the sessions from `closed`; unticked, it is not shown.
5. Each card shows, where present: session name, repository, attention label, ticket keys, title (falling back to the first prompt, then "(untitled)"), away summary with its age, last prompt, last activity, start time, pid, cost, and the last reply (collapsed by default, last 3,000 characters).
6. Given a card's last reply is expanded, when the data refreshes, the filter changes or the card moves to another column, then it is still expanded and its scroll position is unchanged.
7. Given a card's content has not changed, when the data refreshes, then its element is not replaced, so text selected in it stays selected.
8. The header shows counts of open sessions by label and the time of the last refresh.
9. Typing in the filter box shows only cards whose name, repository, title, away summary, last prompt, tickets or first prompt contain the text, case-insensitively.
10. Clicking "copy resume" copies `claude --resume <session id>` to the clipboard.
11. The page refreshes data every 5 seconds without reloading; when the server is unreachable, the header says so.
12. Dates display as `DD-MM-YYYY HH:mm` in 24-hour time.
13. All session text is HTML-escaped before display.

## Known implementation gaps

- No automated tests cover these criteria yet.

## Change history

Recorded in [`../changelog.md`](../changelog.md).
