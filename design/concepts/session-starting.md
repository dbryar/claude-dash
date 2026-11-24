# Concept: Session starting

Part of `claude-dash`'s design. See [`../README.md`](../README.md) for how this folder is used.

## Purpose

Start a new Claude Code session from the dashboard, in a directory you choose, or resume a recently closed one, as a new tab in Terminal and in the permission mode you work in, so starting or picking up work does not mean switching to Terminal, opening a tab, changing directory and typing flags by hand.

## Boundaries

**Owns:**

- Checking that the requested directory is an existing absolute directory.
- Opening a new tab in the frontmost Terminal window, or a new window when a tab cannot be opened.
- Recognising the new tab, so the command is never typed into a tab that is already in use.
- For a resume: checking the session is not running and has a transcript, and taking its directory from the transcript.
- Turning the requested permission mode into `claude` flags.
- Typing `cd <directory> && claude [--resume <id>] [<permission flags>]` into the new tab's shell, with every word shell-quoted.

**Does not own:**

- Who may call it, owned by [HTTP API](http-api.md).
- The "new session" form, its directory suggestions and the resume button, owned by [Dashboard UI](dashboard-ui.md).
- The default permission mode, owned by [Configuration](configuration.md).
- Which sessions count as recently closed, owned by [Session discovery](session-discovery.md).
- Listing the new session, which [Session discovery](session-discovery.md) does once Claude Code registers it.
- Anything Claude Code asks on start-up, such as whether to trust a new folder. That appears in the new tab like any other session.

## Interactions

| Interacts with | Nature of the interaction | Status |
| --- | --- | --- |
| [HTTP API](http-api.md) | Receives a directory or a session id to resume, and a permission mode; returns where the session was opened (`tab` or `window`) or a reason for refusal | `implemented` |
| [Configuration](configuration.md) | Reads the default permission mode, `SESSION_BOARD_PERMISSION_MODE` | `implemented` |
| [Session discovery](session-discovery.md) | Resolves a session id to its transcript and its working directory, and checks it has no live process | `implemented` |
| macOS Terminal (external) | `osascript terminal.applescript new <directory>`: `do script` with no tab when macOS merges new windows into tabs; otherwise Cmd-T, then `do script` in the tab with a new tty, or a new window | `implemented` |
| macOS System Events (external) | Sends Cmd-T to Terminal when macOS does not merge windows into tabs; needs Accessibility permission for the server | `implemented` |
| macOS window tabbing preference (external) | Reads `defaults read -g AppleWindowTabbingMode` (System Settings > Desktop & Dock > Prefer tabs when opening documents) | `implemented` |
| [Session discovery](session-discovery.md) | Lists the started session on a later refresh, once its registry entry exists | `implemented` |

## Design decisions

- **Terminal's own windows are tabs when macOS prefers tabs.** With "Prefer tabs when opening documents" set to Always (`AppleWindowTabbingMode` = `always`), a window Terminal opens with `do script` joins the front window as a tab. That is the cheapest way to a tab: no key press, no Accessibility permission, and Terminal is not brought to the front. Measured on 24-11-2026: one real window with 8 tabs gained a ninth from `do script`.
- **Otherwise a tab, by key press.** Terminal's AppleScript dictionary has no command that makes a tab: `do script` without a target opens a window. A tab is made the way you make one, by bringing Terminal to the front, waiting until it is frontmost (activation returns before it is, and a key press sent sooner goes to another application) and sending Cmd-T through System Events, which needs the server to have Accessibility permission as well as Automation permission for Terminal.
- **The new tab opens behind, and never takes your typing.** A new tab is selected when it opens, so whatever you were typing in Terminal went into it: reported on 24-11-2026, the first time the feature was used. The script notes the front Terminal window (with tabs merged, the selected tab) before opening and brings it back to the front afterwards (`set index of window id <id> to 1`), which selects that tab again.
- **Restore the front application only where the script moved it.** `do script` does not bring Terminal to the front, so on the merged-tab route nothing else is done. An earlier version watched for Terminal coming forward and brought the previous application back with `open -b`; measured on 24-11-2026, that watcher was itself what brought Terminal forward, three times in two seconds, and with it removed the previous application stayed in front for the whole 8 seconds sampled, across two starts in a row. The Cmd-T route does bring Terminal forward, because the key press must go to it, so it reads the frontmost application with `lsappinfo` first and brings it back once with `open -b <bundle id>` after typing. Neither asks for a permission.
- **Recognise the new tab by its tty, not by counting tabs.** Terminal's AppleScript lists each native tab as a window of its own with one tab, so a window's tab count never goes up. Measured on 24-11-2026: System Events saw one window with 8 tabs where Terminal's dictionary reported 8 windows of one tab each, and a first version that waited for the front window's tab count to rise always fell back to a window. The script records every tab's tty before Cmd-T and types only into a tab whose tty is new. If none appears within 2 seconds, it opens a window with `do script` and says so, rather than typing into a tab already in use. If Terminal has no window, a window is opened directly.
- **Every word is quoted by AppleScript, not by hand.** The command typed is `cd <directory> && claude <arguments>`, with the directory and each argument passed through `quoted form of`, which produces a single-quoted shell word, so spaces, quotes and `$` in a directory name stay part of the name. They reach `osascript` as arguments, never as script source. The arguments themselves are built by the server from a fixed list, never from request text: the only request value that becomes an argument is a session id, and only after it has matched the UUID form and a transcript on disk.
- **Three permission modes, by name.** `skip` adds `--dangerously-skip-permissions`; `auto` adds `--permission-mode auto`; `ask` adds nothing, so Claude Code applies its own default from your settings. Any other value is refused. A session started with plain `claude` asked for approval on every tool call, which is not how this board's user works. The default is `auto`, the least permissive mode that does not prompt for every call; `SESSION_BOARD_PERMISSION_MODE` changes it.
- **Resume in the session's own directory, and only if it is closed.** `claude --resume <id>` is run in the working directory recorded in the session's transcript, so the resumed session sees the same project, settings and `CLAUDE.md` it had. A session id with a live process is refused, because Claude Code would start a copy of a session that is still running. A session whose directory no longer exists is refused, as a new session would be.
- **The permission mode applies to a resume too.** It is not carried over from the closed session: Claude Code does not record it in the transcript in a form this design relies on, and the mode you want now is the one on the form.
- **Only an existing absolute directory.** The server resolves the path and checks it is a directory before any key is pressed, so a mistyped path fails on the card rather than leaving a tab with a `cd` error. A path containing a control character is refused.
- **`claude` from your login shell.** The command is typed into an interactive shell in the new tab, so it finds `claude` on your own `PATH` and runs with your shell's environment, exactly as if you had typed it.
- **Suggestions come from sessions the board already knows.** The form suggests the working directories of live and recently closed sessions, most recent first. Any other directory can be typed.

## Acceptance criteria

1. Given macOS prefers tabs always and Terminal has a window, when a session is started, then a new tab opens in the frontmost Terminal window, `claude` runs in it with that directory as its working directory, no key is pressed, and the response is `{"ok": true, "opened": "tab"}`.
1a. Given macOS does not prefer tabs always, Terminal has a window and the server has Accessibility permission, when a session is started, then Cmd-T opens a new tab, `claude` runs in it with that directory as its working directory, and the response is `{"ok": true, "opened": "tab"}`.
2. Given macOS does not prefer tabs always and Terminal has no window, when a session is started, then a new window opens running `claude` in that directory, and the response says `"opened": "window"`.
3. Given Cmd-T produced no tab with a new tty within 2 seconds, then nothing is typed into any existing tab, a new window opens running `claude` in that directory, and the response says `"opened": "window"` with a note that a tab could not be opened, naming Accessibility when that is the reason.
4. Given a directory containing spaces, quotes or `$`, then the new shell changes into exactly that directory.
4a. After a session is started in a new tab, the Terminal tab that was selected before is selected again, and the application that was frontmost before is frontmost again, so keys typed during and after the start go where they were going.
5. Given a path that is not absolute, does not exist, or is not a directory, then nothing is opened and the request is refused as invalid.
6. Given a path containing a control character, or longer than 1,024 characters, then nothing is opened and the request is refused as invalid.
7. Given macOS has not granted permission to control Terminal, then the request fails with a message saying so.
8. A path beginning with `~` is expanded to the home directory before it is checked.
9. Given mode `skip`, then the command typed is `claude --dangerously-skip-permissions`; given `auto`, `claude --permission-mode auto`; given `ask`, `claude` with no permission flag. Given no mode, then the configured default is used.
10. Given a mode other than `skip`, `auto` or `ask`, then nothing is opened and the request is refused as invalid.
11. Given a resume of a session id with a transcript and no live process, then a new tab runs `claude --resume <id>` with the permission flags, in the working directory recorded in the transcript, and the response is as in criteria 1 to 3.
12. Given a resume of a session id that is not a UUID or has no transcript, then nothing is opened and the request is refused as not found; given one with a live process, then it is refused as already running.
13. Given a resume of a session whose recorded directory no longer exists, then nothing is opened and the request is refused, naming the directory.

## Known implementation gaps

- Other terminals: only Terminal is supported, as in [Prompt delivery](prompt-delivery.md).
- Without "prefer tabs always", Terminal comes to the front for a moment, because the Cmd-T key press has to go to it; keys typed in that moment go to Terminal. Why the restore watcher brought Terminal forward was not established; the design avoids needing it rather than explaining it.
- With "prefer tabs always", the result is reported as a tab without checking: the script trusts macOS to merge the window.
- The session does not appear on the board until Claude Code writes its registry entry, usually within a few seconds; the board does not track a start it asked for.
- Only sessions in the closed list (by default the last 7 days) are offered for resuming on the page; the server accepts any closed session with a transcript.
- No automated tests cover these criteria yet. On 24-11-2026 criteria 4a and 9 to 12 were checked by hand through a server on a spare port: a throwaway session made with `claude -p` was resumed with mode `skip` and ran `claude --resume <id> --dangerously-skip-permissions` in its recorded directory; a new session with mode `auto` ran `claude --permission-mode auto`; an unknown mode, a non-UUID, an unknown id and a running session were refused. Earlier that day criteria 1, 3, 4, 5 and 6 were checked by hand against a server on a spare port, and 1a by running the script's Cmd-T branch from a shell with Accessibility permission. The directory used was named `it's a $test dir`, and each started `claude` had exactly it as its working directory.

## Change history

Recorded in [`../changelog.md`](../changelog.md).
