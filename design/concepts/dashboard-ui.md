# Concept: Dashboard UI

Part of `claude-dash`'s design. See [`../README.md`](../README.md) for how this folder is used.

## Purpose

Show every session on one page, ordered by what needs you, so you can find the tab that wants an answer and close the ones that don't.

## Boundaries

**Owns:**

- `index.html`: layout, columns, filtering, refresh, view state, the copy-resume action, the reply composer and the close button.
- How times and dates are displayed.

**Does not own:**

- The data or the attention labels, which arrive from [HTTP API](http-api.md).

## Interactions

| Interacts with | Nature of the interaction | Status |
| --- | --- | --- |
| [HTTP API](http-api.md) | Fetches `/api/sessions` on load and every 5 seconds | `implemented` |
| [Attention classification](attention-classification.md) | Uses the label to pick the card's column and colour | `implemented` |
| [HTTP API](http-api.md) | Posts a reply to `/api/sessions/<id>/prompt` | `implemented` |
| [HTTP API](http-api.md) | Posts a close to `/api/sessions/<id>/close` | `implemented` |

## Design decisions

- **One column per state, left to right in order of urgency**: waiting on you, working, idle. A session moving between states moves between columns, so a glance across the page shows what changed. Closed sessions get a fourth column only when asked for, so they don't crowd out open ones.
- **On a narrow screen, one column at a time, swiped left and right.** This uses CSS scroll snapping, so the browser handles the gesture and no gesture library is needed. A tab strip above the columns shows which column is in view and how many cards each holds.
- **Refreshing must not disturb what you're reading or writing.** Each session keeps one card element for its lifetime. The card's content is only re-rendered when it changes, and the reply composer sits outside that content, so it is never re-rendered at all. An expanded last reply stays expanded, and keeps its scroll position, when its card is replaced.
- **The card leads with Claude Code's own title and away summary**, the fastest answer to "what was this doing?".
- **Reply from the card.** A session waiting on you can be answered without finding its tab. The composer is part of the card's view state, so a half-written reply survives refreshes and the card changing columns.
- **Copy resume, not a resume button.** The page cannot open a terminal, and the command is what you need to paste.
- **A single static file** with inline styles and script, light and dark themes, and no external requests.

## Acceptance criteria

1. Live sessions appear in three columns, left to right: "Waiting on you", "Working", "Idle". Each column heading shows its card count, cards within a column are sorted by last activity (most recent first), and an empty column stays in place with a note that it is empty.
2. Given a viewport wider than 720 px, then all columns are side by side and each column scrolls vertically on its own.
3. Given a viewport 720 px wide or narrower, then one column fills the width, swiping left or right moves to the neighbouring column and snaps to it, and a tab strip shows each column's name and count, highlights the column in view, and scrolls to a column when its tab is tapped.
4. Given "show recently closed" is ticked, then a fourth column, "Closed, resumable", appears to the right of "Idle" with the sessions from `closed`; unticked, it is not shown.
5. Each card shows, where present: session name, repository, attention label, ticket keys, title (falling back to the first prompt, then "(untitled)"), away summary with its age, last prompt, last activity, start time, pid, cost, and the last reply (collapsed by default, last 3,000 characters). A field absent from the data is omitted from the card rather than shown as a zero or an empty value, so a session with no cost recorded shows no cost.
6. Given a card's last reply is expanded, when the data refreshes, the filter changes or the card moves to another column, then it is still expanded and its scroll position is unchanged.
7. Given a card's content has not changed, when the data refreshes, then its content is not re-rendered, so text selected in it stays selected.
8. The header shows counts of open sessions by label and the time of the last refresh.
9. Typing in the filter box shows only cards whose name, repository, title, away summary, last prompt, tickets or first prompt contain the text, case-insensitively.
10. Clicking "copy resume" copies `claude --resume <session id>` to the clipboard.
11. The page refreshes data every 5 seconds without reloading; when the server is unreachable, the header says so.
12. Dates display as `DD-MM-YYYY HH:mm` in 24-hour time.
13. All session text is HTML-escaped before display.
14. A live card has a "reply" button, opening a text box with a "Send" button, exactly when its session's `canReply` is true; every other card, including closed ones, has none. The button follows `canReply` and not the column, so a session the server would refuse is never offered a composer.
14a. Given a live session whose registry status is neither `idle` nor `busy`, then its card shows that status, so a card with no reply button says why.
15. Given the reply box has text, when "Send" is clicked or Cmd+Enter (Ctrl+Enter) is pressed, then the text is posted for that session; on success the box is cleared and closed; on failure the reason is shown and the text is kept.
16. Given text is typed in a reply box or the box has focus, when the data refreshes or the card moves column, then the text, cursor and focus are unchanged.
17. While a reply is being sent, its "Send" button is disabled.
18. Every live card has a close button ("×") in its top-right corner; closed cards have none.
19. Given an idle card, when its close button is clicked, then the close is posted without asking. Given a card waiting on you or working, then the page first asks for confirmation, naming the session, and only posts (with `confirmed: true`) if the user agrees.
20. Given a close succeeds, then "show recently closed" is ticked so the closed column is visible, and the data refreshes. Given it fails, then the reason is shown on the card.

## Known implementation gaps

- No automated tests cover these criteria yet. Criteria 14 to 20 were checked by hand on the Android emulator on 16-11-2026.

## Change history

Recorded in [`../changelog.md`](../changelog.md).
