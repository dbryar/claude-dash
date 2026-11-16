# Concept: Prompt delivery

Part of `claude-dash`'s design. See [`../README.md`](../README.md) for how this folder is used.

## Purpose

Send the next prompt to a session that is waiting on you, from the dashboard, without finding and switching to its terminal tab. The prompt arrives exactly as if it had been typed into that tab.

## Boundaries

**Owns:**

- Checking that the target is a live, idle session.
- Finding the session's terminal tab from its process.
- Cleaning the text so it can only ever be typed as text.
- Typing the text into the tab and submitting it.

**Does not own:**

- Who may call it and from where, owned by [HTTP API](http-api.md).
- The composer on the card, owned by [Dashboard UI](dashboard-ui.md).
- What the session does with the prompt, which is Claude Code's normal handling of typed input, including its own permission prompts.

## Interactions

| Interacts with | Nature of the interaction | Status |
| --- | --- | --- |
| [HTTP API](http-api.md) | Receives a session id and prompt text, returns success or a reason for refusal | `implemented` |
| Claude Code session registry (external) | Reads the session's `pid` and `status` at the moment of sending | `implemented` |
| [Session discovery](session-discovery.md) | Resolves a session id to its live entry by the same rule the dashboard lists it with | `implemented` |
| macOS Terminal (external) | `osascript terminal.applescript`: finds the tab whose `tty` matches and runs `do script <text> in <tab>` | `implemented` |
| Other terminals (iTerm2, tmux, editor terminals) (external) | Would deliver to sessions not running in Terminal | `designed` |

## Design decisions

- **Type into the terminal, not into Claude Code's peer-messaging socket.** Typed text is recorded as an ordinary user prompt and treated as coming from you. The peer socket (`/tmp/cc-socks/<pid>.sock`) is an undocumented internal protocol, and a message arriving through it is presented to the receiving session as coming from another agent, not from you.
- **Find the tab by tty.** The registry gives the session's `pid`; `ps` gives the process's tty; Terminal reports each tab's `tty`. No window titles or positions are involved.
- **Type the text, pause, then submit with a carriage return on its own.** In Claude Code's input box a line feed adds a line and a carriage return submits. A carriage return that arrives in the same burst as the text is read as part of a paste and adds a line instead of submitting: sent that way, a 70-character prompt sat unsubmitted in the input box. `terminal.applescript` therefore types the text, waits 0.4 seconds, and sends the carriage return as a separate write. The line feed `do script` appends to each write is dropped (trailing whitespace) or lands in the empty box after submission. Measured on Claude Code 2.1.325 and Terminal on 16-11-2026.
- **Long replies arrive as a paste.** Claude Code wraps a long burst of input in `<pasted_content>`, as it does for anything you paste yourself. A 42-line, 2,300-character reply was recorded that way, while two-line replies were recorded as plain prompts. The receiving session treats pasted content as material you supplied rather than as instructions you typed, so a long reply should be written as a request about the pasted material.
- **Only idle sessions.** A busy session is mid-turn; typing into it mixes your prompt with whatever it is doing. The check is made against the registry at the moment of sending, not against the dashboard's last refresh.
- **Resolve the session the same way the dashboard lists it.** The registry can hold a stale entry whose pid has been reused, and a resumed session can have two entries for one session id. Resolving a session id by taking the first registry file that matched it sent a reply at whichever entry the filesystem happened to list first: on 16-11-2026 a reply to a live, idle session resolved to a months-old entry whose pid now belonged to Terminal.app, was refused for having no terminal, and never reached the session that was waiting. Delivery therefore resolves a session id through the same rule as [Session discovery](session-discovery.md) — live, a `claude` process, newest entry for that id — so what the card shows and what receives the reply cannot disagree.
- **Text only, never keys.** Control characters other than line feed and tab are removed, so a pasted Escape, Ctrl-C or terminal escape sequence cannot act as a key press.
- **Arguments, not a shell.** `osascript` is spawned with the tty and text as separate arguments, so nothing in the prompt is ever interpreted by a shell or by AppleScript source.

## Acceptance criteria

1. Given a live session with status `idle` whose process runs in a Terminal tab, when a prompt is delivered, then the session's transcript records it as one user prompt identical to the cleaned text, and the session starts a turn.
2. Given text with several lines, then the recorded prompt keeps the line breaks and is submitted once, at the end.
3. Given `\r\n` or `\r` inside the text, then each becomes a line break, not a submission.
4. Given control characters other than line feed and tab (for example `\x1b`, `\x03`, `\x04`), then they are removed before sending.
5. Given text that is empty after cleaning and trimming, then nothing is sent and the request is refused as invalid.
6. Given text longer than 20,000 characters, then nothing is sent and the request is refused as too long.
7. Given a session id that is not in the registry, or whose `pid` is not running, then nothing is sent and the request is refused as not found.
8. Given a session id whose only live registry entry holds a `pid` that `ps` reports as a command other than `claude`, then nothing is sent and the request is refused as not found.
9. Given a session id with two live registry entries, then the prompt is delivered to the process in the entry with the later `startedAt`, which is the one [Session discovery](session-discovery.md) lists.
10. Given a session whose registry status is not `idle`, then nothing is sent and the request is refused as busy.
11. Given a session whose tty matches no Terminal tab, then nothing is sent and the request is refused, saying the session is not in a Terminal tab.
12. Given macOS has not granted permission to control Terminal, then the request fails with a message saying so.
13. After a delivery, the session's input box is empty.

## Known implementation gaps

- Other terminals: only Terminal is supported. Sessions in iTerm2, tmux or an editor's terminal are refused (criterion 11).
- Text already typed but not submitted in the tab's input box is not cleared first; the delivered prompt is appended to it.
- A text that starts with `/` runs as a slash command and one that starts with `!` runs as a shell command, exactly as if typed. This is deliberate (it is your input), but the dashboard does not warn about it.
- No automated tests cover these criteria yet. On 16-11-2026 criteria 1 to 7 and 13 were checked by hand through the running service against a disposable session, and criterion 10 against a busy session. Criteria 8 and 9 were checked by hand the same day against a stale registry entry whose pid had been reused.

## Change history

Recorded in [`../changelog.md`](../changelog.md).
