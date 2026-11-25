# Concept: Session view

Part of `claude-dash`'s design. See [`../README.md`](../README.md) for how this folder is used.

## Purpose

Read one session's whole last reply and answer it from the board, without going back to its Terminal tab. A card is a summary, so it cuts the last reply to its final 3,000 characters and gives the reply box a few lines. A long reply, or a long answer to it, needs the whole screen.

## Boundaries

**Owns:**

- The view: a modal dialog on a wide screen, the whole screen on a narrow one, showing one session at a time.
- Opening and closing it, and what it shows: the session's header, the full last prompt and the full last reply.
- Lending the card's reply composer and question form to the view while it is open, and giving them back when it closes.
- The "copy reply" action.

**Does not own:**

- The session data, which arrives from the board's own 5-second poll ([Dashboard UI](dashboard-ui.md), [HTTP API](http-api.md)). The view makes no requests of its own to read data.
- Sending a reply or an answer. The view uses the card's composer and question form, which post through [HTTP API](http-api.md) to [Prompt delivery](prompt-delivery.md) and [Question answering](question-answering.md) exactly as they do on the card.
- Whether a session can be replied to: `canReply`, owned by [Prompt delivery](prompt-delivery.md).
- The Markdown renderer and the "formatted replies" setting, owned by [Dashboard UI](dashboard-ui.md).
- What `lastAssistant` holds, owned by [Transcript digest](transcript-digest.md). It is the last non-empty assistant text block. Text Claude wrote earlier in the same turn, before a tool call, is not part of it.

## Interactions

| Interacts with | Nature of the interaction | Status |
| --- | --- | --- |
| [Dashboard UI](dashboard-ui.md) | Opened from a card's "open" button or its "show full reply" link; reads the session from the board's current data on every refresh; borrows the card's composer and question form elements | `implemented` |
| [HTTP API](http-api.md) | Through the borrowed composer and form: `POST /api/sessions/<id>/prompt` and `POST /api/sessions/<id>/answer` | `implemented` |

## Design decisions

- **One view, any card.** Live and closed cards can both be opened. A closed session cannot be replied to but its last reply is still worth reading in full.
- **A native `<dialog>` opened with `showModal()`.** The browser provides the dimmed backdrop, keeps keyboard focus inside the dialog, closes it on Esc and returns focus afterwards. No library is needed, and the page stays free of external requests.
- **Modal when wide, full screen when narrow.** The breakpoint is the board's own 720 px. On a phone, a modal with margins would waste the space this feature exists to provide.
- **The reply area is the only part that scrolls.** The header stays at the top and the composer stays at the bottom, so you can read any part of the reply and type at the same time.
- **The composer is moved into the view, not copied.** Each session already has exactly one composer element, which no refresh rebuilds ([Dashboard UI](dashboard-ui.md)). Moving that same element into the view and back means a half-written reply is never in two places, and needs no syncing. A reply started on the card continues in the view and the other way round. The question form is moved the same way, so selections are kept.
- **Inside the view, the reply box grows with its text** from 6 lines up to 40 % of the view's height, then scrolls inside itself. A long reply stays editable without pushing the last reply off the screen.
- **Refreshing behaves as on the card.** The view is only re-rendered when the session's content changes. When the content is unchanged, the reply's scroll position and any selected text stay as they were. A changed reply keeps the scroll position, so new text does not move the part you are reading.
- **The view stays open through state changes.** After you send a reply the session starts working. The view stays open so you can watch it, and the composer area says the session is working until `canReply` is true again. If the session leaves the data altogether, the view says so and keeps the last content it had.
- **"Copy reply" copies the raw Markdown** of the full reply, because pasting it somewhere else is the other common reason to go back to the terminal.

## Acceptance criteria

1. Every card, live or closed, has an "open" button (⤢) beside its close button. Clicking it opens the session view for that session. Only one view is open at a time.
2. Given a viewport wider than 720 px, then the view is a dialog over a dimmed board, centred, at most 1,000 px wide and 90 % of the viewport height. Given 720 px or narrower, then it fills the screen.
3. The view closes on its × button, on Esc, or, on a wide screen, on a click on the backdrop. Focus then returns to the card's open button, if the card is still on the page.
4. The view's header shows the session name, repository, attention label in the label's colour, ticket keys and title. Its body shows the away summary in full with its age, `lastPrompt` unclamped (not cut to two lines as on the card), the last reply, and the card's metadata row without its "reply" and "resume" buttons.
5. The view shows the whole of `lastAssistant`, with no length limit and no "…". It renders formatted or raw according to the "formatted replies" setting ([Dashboard UI](dashboard-ui.md) criteria 22 to 24). The view has its own toggle for that setting, and changing it there also changes the board.
6. The header and the composer stay in place. Only the body scrolls, and it scrolls vertically.
7. Opening the view shows the reply from its first line.
8. Given the view is open, when the data refreshes and the session's content is unchanged, then nothing in the view is re-rendered: the reply's scroll position and any text selected in it are unchanged. When the content has changed, then the view is re-rendered and the reply's scroll position is kept.
9. Given the session's `canReply` is true, then the view's bottom shows the session's composer, which is the same element as the card's. Text typed on the card appears in the view and text typed in the view appears on the card afterwards. Given `canReply` is false, then the bottom of the view says why: "working", the status and `waitingFor` (as on the card), or "closed". It offers no reply box.
10. In the view, the reply box is at least 6 lines high. It grows with its text up to 40 % of the view's height, then scrolls inside itself. Cmd+Enter or Ctrl+Enter sends.
11. Given a reply is sent from the view, then while sending the Send button is disabled. On success the box is emptied and the view stays open. On failure the reason is shown and the text is kept.
12. Given the session has a `menu`, then the view shows the session's question form above the composer, as the same element as on the card, and answering behaves as [Dashboard UI](dashboard-ui.md) criteria 14b to 14d.
13. When the view closes, the composer and question form go back to their places on the card. Given the reply box has text in it, the card's composer is shown open. Otherwise it is shown as it was before the view opened.
14. Given the session is no longer in `live` or `closed` when the data refreshes, then the view stays open with the last content it had. It says the session is no longer on the board and shows no composer.
15. Given a card is hidden by the filter, or moves to another column, while its view is open, then the view is unaffected.
16. A "copy reply" button copies the full `lastAssistant` text, unformatted, to the clipboard.
17. All session text in the view is HTML-escaped before display, as on the card ([Dashboard UI](dashboard-ui.md) criteria 13 and 24).

## Known implementation gaps

- No automated tests. Criteria 1 to 11, 13, 15 and 16 were checked on 25-11-2026 by driving Chrome in the Android emulator over its DevTools protocol, at 1,280 px (by emulating the viewport) and at the phone's own 412 px. The prompt route was intercepted, so nothing was typed into a session. Criteria 12, 14 and 17 were not exercised: no session was showing a question menu, none left the board during the run, and escaping reuses the card's code unchanged.
- `lastPrompt` is not the whole prompt. Claude Code's `last-prompt` record holds about the first 200 characters, ending in "…" (measured 25-11-2026 on 2.1.325). The view shows all of what the record holds. Showing the whole prompt would need [Transcript digest](transcript-digest.md) to read the last real user message instead.

## Change history

Recorded in [`../changelog.md`](../changelog.md).
