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
- **The card leads with Claude Code's own title**, the fastest answer to "what was this doing?". The away summary ("we were working on...") is a hint on the title, shown on hover, or on focus or tap where there is no pointer, so it is there when you want it without lengthening every card.
- **Last replies are Markdown, so render them as Markdown.** Claude Code writes its replies in Markdown, and shown as raw text in a fixed-width font they are hard to read. A header toggle switches every card between formatted and raw text, and the choice is remembered in the browser. The renderer is a small one inside the page rather than a library, which keeps the page free of external requests, and it escapes all reply text before adding formatting, so nothing in a reply can become live HTML.
- **Reply from the card.** A session waiting on you can be answered without finding its tab. The composer is part of the card's view state, so a half-written reply survives refreshes and the card changing columns.
- **Copy resume, not a resume button.** The page cannot open a terminal, and the command is what you need to paste.
- **A single static file** with inline styles and script, light and dark themes, and no external requests.

## Acceptance criteria

1. Live sessions appear in three columns, left to right: "Waiting on you", "Working", "Idle". Each column heading shows its card count, cards within a column are sorted by last activity (most recent first), and an empty column stays in place with a note that it is empty.
2. Given a viewport wider than 720 px, then all columns are side by side and each column scrolls vertically on its own.
3. Given a viewport 720 px wide or narrower, then one column fills the width, swiping left or right moves to the neighbouring column and snaps to it, and a tab strip shows each column's name and count, highlights the column in view, and scrolls to a column when its tab is tapped.
4. Given "show recently closed" is ticked, then a fourth column, "Closed, resumable", appears to the right of "Idle" with the sessions from `closed`; unticked, it is not shown.
5. Each card shows, where present: session name, repository, attention label, ticket keys, title (falling back to the first prompt, then "(untitled)"), last prompt, last activity, start time, pid, cost, and the last reply (collapsed by default, last 3,000 characters). A field absent from the data is omitted from the card rather than shown as a zero or an empty value, so a session with no cost recorded shows no cost.
6. Given a card's last reply is expanded, when the data refreshes, the filter changes or the card moves to another column, then it is still expanded and its scroll position is unchanged.
7. Given a card's content has not changed, when the data refreshes, then its content is not re-rendered, so text selected in it stays selected.
8. The header shows counts of open sessions by label and the time of the last refresh.
9. Typing in the filter box shows only cards whose name, repository, title, away summary, last prompt, tickets or first prompt contain the text, case-insensitively.
10. Clicking "copy resume" copies `claude --resume <session id>` to the clipboard.
11. The page refreshes data every 5 seconds without reloading; when the server is unreachable, the header says so.
12. Dates display as `DD-MM-YYYY HH:mm` in 24-hour time.
13. All session text is HTML-escaped before display.
14. A live card has a "reply" button, opening a text box with a "Send" button, exactly when its session's `canReply` is true; every other card, including closed ones, has none. The button follows `canReply` and not the column, so a session the server would refuse is never offered a composer.
14a. Given a live session whose registry status is neither `idle` nor `busy`, then its card shows that status, and its `waitingFor` when present (for example "waiting: input needed"), so a card with no reply button says why.
14b. Given a live session with a `menu`, then the card shows it under "Claude is asking": the question tabs with their answered state, then either the question (with "choose any" for multiple choice) and its options as radio buttons or checkboxes, each with its description, plus a "Type something" box for single choice; or, for the review screen, each question with its answer and a "Submit answers" button.
14c. Given an option is selected (or text typed and its choice selected), then the answer button is enabled; clicking it posts the answer with the question text and option labels it was made for. While sending, the controls are disabled; on success the card says what comes next and refreshes; on failure the reason is shown and the selections are kept.
14d. Given selections are made, when the data refreshes, then they are kept, including typed text and focus; given the menu on screen changes (another question or the review), then the form is rebuilt for it. Multiple-choice options already ticked in the terminal start ticked.
21. Given a session has an away summary, then its title is marked as having a hint (dotted underline), and hovering the title, or focusing or tapping it, shows the summary with its age; moving away or tapping elsewhere hides it. The summary is not otherwise shown on the card, and the filter still searches it.
22. The header has a "formatted replies" toggle, on by default. On, the last reply renders headings, bold, italic, strikethrough, inline code, fenced code blocks, bulleted and numbered lists (including nested ones), tables, block quotes, horizontal rules and links. Off, the last reply is shown as raw text in a fixed-width font.
23. The toggle applies to every card at once, is remembered in the browser across reloads, and falls back to on when browser storage is unavailable. Changing it keeps each reply's expanded state.
24. Formatted replies are built from text that has already been HTML-escaped: HTML in a reply is shown as text, and only `http` and `https` links become links, opening in a new tab.
25. Given the last reply is longer than 3,000 characters, then the shown part starts at the beginning of a line, preceded by "…", and if the cut falls inside a fenced code block, the remainder is still shown as code.

## Known implementation gaps

- No automated tests cover these criteria yet. Criteria 14 to 20 were checked by hand on the Android emulator on 16-11-2026, and 21 to 25 on 18-11-2026.
- The Markdown renderer covers the constructs in criterion 22 only. Images, footnotes, HTML blocks, reference-style links and table column alignment are shown as text or ignored.

## Change history

Recorded in [`../changelog.md`](../changelog.md).
