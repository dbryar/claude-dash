# Concept: Session closing

Part of `claude-dash`'s design. See [`../README.md`](../README.md) for how this folder is used.

## Purpose

Close a session you no longer need from the dashboard: stop its Claude Code process and close its Terminal window, so the window count comes down while the conversation stays resumable from the closed column.

## Boundaries

**Owns:**

- Checking that the target is a live Claude Code process belonging to that session.
- Requiring confirmation for any session that is not idle.
- Stopping the process, then closing its Terminal window or exiting its shell.

**Does not own:**

- Who may call it, owned by [HTTP API](http-api.md).
- The close button and the confirmation dialog, owned by [Dashboard UI](dashboard-ui.md).
- Listing the session afterwards, which [Session discovery](session-discovery.md) does from the transcript Claude Code leaves on disk.

## Interactions

| Interacts with | Nature of the interaction | Status |
| --- | --- | --- |
| [HTTP API](http-api.md) | Receives a session id and whether the user confirmed; returns success or a reason for refusal | `implemented` |
| Claude Code session registry (external) | Reads the session's `pid` and `status` | `implemented` |
| [Transcript digest](transcript-digest.md) and [Attention classification](attention-classification.md) | Decide whether the session is idle, which decides whether confirmation is needed | `implemented` |
| The session's process (external) | `SIGTERM`, then `SIGKILL` if it has not exited after 5 seconds | `implemented` |
| macOS Terminal (external) | `osascript terminal.applescript close`: closes the window when the session's tab is its only tab, otherwise types `exit` into the shell | `implemented` |
| [Session discovery](session-discovery.md) | Lists the stopped session under `closed` on the next refresh | `implemented` |

## Design decisions

- **Confirmation is enforced by the server, not just the page.** A session that is waiting on you or working may be mid-task or holding an answer you have not read. The server refuses to close it unless the request says the user confirmed. Idle sessions close without asking.
- **SIGTERM first.** Claude Code saves its state and removes its registry entry when asked to stop; `SIGKILL` is the fallback for a process that does not exit within 5 seconds. Either way the transcript stays on disk, so `claude --resume` still works.
- **Only kill what is verifiably the session.** The `pid` must be in the registry under that session id, be running, and be a process named `claude`. A reused `pid` belonging to something else is refused.
- **Close the window only once the shell is all that is left.** After the process stops, the tab's processes must be only `login` and a shell; anything else (a background job, a second program) leaves the window open. If the tab is the window's only tab the window is closed, otherwise `exit` is typed into the shell, and whether that closes the tab depends on the Terminal profile's "When the shell exits" setting.
- **The closed column opens after a close**, so you see the session arrive there.
- **A closed window lingers in AppleScript.** Straight after `close`, Terminal still lists the window, with no tabs and `visible` false. Anything counting windows must count visible ones. Measured on 16-11-2026.

## Acceptance criteria

1. Given a live idle session, when it is closed without confirmation, then its `claude` process receives `SIGTERM` and exits, and the request succeeds.
2. Given a live session waiting on you or working, when it is closed without confirmation, then nothing happens and the request is refused as needing confirmation; with confirmation, it is closed as in criterion 1.
3. Given the process has not exited 5 seconds after `SIGTERM`, then it receives `SIGKILL`.
4. Given a session id that is not in the registry, or whose `pid` is not running, then nothing happens and the request is refused as not found.
5. Given the `pid` belongs to a process not named `claude`, then nothing is signalled and the request is refused.
6. Given the process has exited and its tab holds only `login` and a shell, when the tab is its window's only tab, then the window is closed; otherwise `exit` is typed into the tab.
7. Given the tab holds anything besides `login` and a shell after the process exits, then the window is left open and the response says so.
8. Given the process ran without a Terminal tab, then the process is still stopped and the response says the window could not be found.
9. After a successful close, the session's transcript is kept (Claude Code appends its own exit records as it stops, a few hundred bytes), and the session appears under `closed` on the next refresh, provided it meets the closed-list rules in [Session discovery](session-discovery.md).

## Known implementation gaps

- Windows with several tabs: `exit` ends the shell, but the tab only closes if the Terminal profile closes on shell exit.
- A session closed within moments of starting may have a transcript too small for the closed list (under 2,000 bytes) and so not appear there.
- No automated tests cover these criteria yet. On 16-11-2026 criteria 1, 2, 4, 6 and 9 were checked by hand through the running service against four disposable sessions in their own windows, and the API's refusals (no origin, unknown session, bad `confirmed`, missing confirmation) left the target running.

## Change history

Recorded in [`../changelog.md`](../changelog.md).
