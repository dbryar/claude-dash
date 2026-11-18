# Concept: Question answering

Part of `claude-dash`'s design. See [`../README.md`](../README.md) for how this folder is used.

## Purpose

Show a question Claude asked with options (an `AskUserQuestion` call) on the session's card, and answer it from there, without finding and switching to the session's terminal tab. The answer is recorded exactly as if it had been chosen in the terminal.

## Boundaries

**Owns:**

- Reading the question menu from the session's terminal screen: the question tabs and which are answered, the question on screen, its options and descriptions, whether it is single or multiple choice, the highlighted row, the ticked options, and the review screen.
- Checking that the menu on screen is the one the answer was made for.
- Turning an answer into key presses, sending them one step at a time, and confirming the menu moved on.

**Does not own:**

- Who may call it, owned by [HTTP API](http-api.md).
- The form on the card, owned by [Dashboard UI](dashboard-ui.md).
- Whether the session is waiting on you, owned by [Attention classification](attention-classification.md) from the registry's `waiting` status.

## Interactions

| Interacts with | Nature of the interaction | Status |
| --- | --- | --- |
| [HTTP API](http-api.md) | Supplies the on-screen `menu` for each session waiting on input; receives one page's answer and returns what came next (`next question`, `review` or `answered`) or a reason for refusal | `implemented` |
| Claude Code session registry (external) | Reads `pid`, `status` and `waitingFor`; a menu is only read for `waiting` / `input needed` | `implemented` |
| macOS Terminal (external) | `osascript terminal.applescript screen` reads the tab's text; `keys` sends one step of key presses | `implemented` |

## How the menu behaves

Measured on Claude Code 2.1.327 in Terminal on 18-11-2026, with a throwaway session asking known questions:

- **The open question is not in the transcript.** The `AskUserQuestion` tool call is written to the transcript only once it is answered. In a session that wrote a sentence and then asked, the sentence was written and the question was not, and nothing more was written in six minutes of waiting. A session that had been waiting more than an hour did have the question in its transcript. The screen is the only reliable source for an open question.
- The menu is drawn at the bottom of the tab: a rule (`────`), a tab bar (`☐`/`☒` and each question's header, with `←` and `✔ Submit →` when there are several questions), the question text, the numbered options with their descriptions indented below, "Type something", a rule, "Chat about this", and a footer starting "Enter to select". Multiple-choice options carry `[ ]` or `[✔]`. The highlighted row starts with `❯`.
- Every `do script` write ends with a line feed, which the menu reads as Enter. No write can avoid it, so every step is built to end at the place where Enter does the intended thing.
- Single choice: down-arrows to the option, then Enter, picks it and moves to the next question. A number key also picks an option, but the Enter that follows then lands on the next question and acts there.
- Multiple choice: Enter ticks or unticks the highlighted option and leaves the highlight where it is. Number keys sent in the same write as arrow keys were ignored. Under the options are "Type something", then "Next" (or "Submit" on the last question); Enter on that row moves on.
- "Type something" (single choice): with that row highlighted, typed text goes into it, and Enter submits it as the answer.
- Several questions end with a review screen listing each question (`●`) and its answer (`→`), with "Submit answers" highlighted. A single question has no review screen: answering it submits.
- Up from the first option wraps to the last row ("Chat about this"), which declines the question. The highlight cannot be reset by pressing up repeatedly, so its position is read from the screen.
- The folder-trust prompt shown when starting Claude Code in an untrusted folder ignored a number key and took the line feed as Enter on its highlighted option. It is not a question menu and is not answered by this concept.

## Design decisions

- **The screen is the source.** Because the open question is not in the transcript, the card shows the menu read from the terminal, one page at a time: the question on screen, or the review screen. Answering a page moves the terminal to the next page, and the card follows.
- **Read the screen before every step.** Moves are computed from where the highlight is, and ticks from what is ticked, not from assumptions, so a highlight you moved in the terminal does not cause a wrong answer.
- **Arrows and Enter only.** Number keys behaved differently depending on what followed them; arrows followed by the write's own Enter behaved the same way every time.
- **Refuse rather than guess.** An answer names the question text and option labels it was made for. If the screen shows anything else, nothing is sent. A multiple-choice toggle that does not show up on screen stops the remaining steps.
- **Read menus only for sessions waiting on input,** at most every two seconds each, so a dashboard refresh does not script every Terminal tab.
- **Free text only for single-choice questions.** Typed text has line breaks replaced by spaces, since a line break would submit early, and control characters removed, as in [Prompt delivery](prompt-delivery.md).

## Acceptance criteria

1. Given a live session with status `waiting` and `waitingFor` `input needed` whose Terminal tab shows a question menu, then `/api/sessions` includes `menu` for it: `kind: "question"`, the `tabs` (header and whether answered), the `question` text, `multi`, the `options` (label, description, and for multiple choice whether ticked) and the highlighted row (`cursor`). Given the tab shows the review screen, then `menu` has `kind: "review"`, the `tabs`, each question with its answer, whether any are unanswered, and whether "Submit answers" is highlighted.
2. Given any other session, or a tab whose bottom is not a question menu, then there is no `menu`.
3. Given an answer naming a question text and option labels that match the menu on screen, and a valid choice, then the keys are sent and the request returns what the screen shows next: `next question`, `review`, or `answered` once the menu has gone or the session is no longer waiting.
4. Given the session is not live, or not `waiting`, then nothing is sent and the request is refused.
5. Given the question text or option labels differ from the menu on screen, then nothing is sent and the request is refused as showing a different question.
6. Given a single-choice answer with anything other than exactly one option or a non-empty text, or a multiple-choice answer with no options or with text, or an option number out of range, then nothing is sent and the request is refused as invalid.
7. Given a single-choice answer, then the highlight is moved from its position on screen to the chosen option (or "Type something", followed by the text) and Enter is sent once.
8. Given a multiple-choice answer, then each option whose ticked state on screen differs from the answer is toggled with one move and one Enter, and the screen is re-read to confirm the toggle; then the highlight is moved to the "Next" or "Submit" row and Enter is sent. Given a toggle does not show up on screen, then no further keys are sent and the request fails.
9. Given `{"review": "submit"}` and the review screen with "Submit answers" highlighted, then Enter is sent; otherwise nothing is sent and the request is refused.
10. Given the screen still shows the same page 5 seconds after the last step, then the request fails, saying the keys were sent.
11. Free text has line breaks replaced by spaces and control characters removed, and is at most 1,000 characters.

## Known implementation gaps

- Only Terminal is supported, as for [Prompt delivery](prompt-delivery.md).
- Free text on multiple-choice questions, per-option notes, and "Chat about this" are not offered.
- An option label or question long enough to wrap in the terminal is read as wrapped text; a wrapped label is taken as the start of its description.
- The menu's layout is Claude Code's, not a published interface. A change to its markers or rows makes the board show no `menu` (criterion 2) or refuse (criterion 5) rather than misanswer.
- No automated tests cover these criteria yet. On 18-11-2026 criteria 1 to 3, 5, 7 to 9 and 11 were checked by hand against a throwaway session: through the API (three questions: single choice, multiple choice, typed text; then review) and through the card on the Android emulator (two questions, then review).

## Change history

Recorded in [`../changelog.md`](../changelog.md).
