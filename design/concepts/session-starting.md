# Concept: Session starting

Part of `claude-dash`'s design. See [`../README.md`](../README.md) for how this folder is used.

## Purpose

Start a new Claude Code session from the dashboard, in a directory you choose, as a new tab in Terminal, so starting work does not mean switching to Terminal, opening a tab and changing directory by hand.

## Boundaries

**Owns:**

- Checking that the requested directory is an existing absolute directory.
- Opening a new tab in the frontmost Terminal window, or a new window when a tab cannot be opened.
- Recognising the new tab, so the command is never typed into a tab that is already in use.
- Typing `cd <directory> && claude` into the new tab's shell, with the directory shell-quoted.

**Does not own:**

- Who may call it, owned by [HTTP API](http-api.md).
- The "new session" form and its directory suggestions, owned by [Dashboard UI](dashboard-ui.md).
- Listing the new session, which [Session discovery](session-discovery.md) does once Claude Code registers it.
- Anything Claude Code asks on start-up, such as whether to trust a new folder. That appears in the new tab like any other session.

## Interactions

| Interacts with | Nature of the interaction | Status |
| --- | --- | --- |
| [HTTP API](http-api.md) | Receives a directory; returns where the session was opened (`tab` or `window`) or a reason for refusal | `implemented` |
| macOS Terminal (external) | `osascript terminal.applescript new <directory>`: `do script` with no tab when macOS merges new windows into tabs; otherwise Cmd-T, then `do script` in the tab with a new tty, or a new window | `implemented` |
| macOS System Events (external) | Sends Cmd-T to Terminal when macOS does not merge windows into tabs; needs Accessibility permission for the server | `implemented` |
| macOS window tabbing preference (external) | Reads `defaults read -g AppleWindowTabbingMode` (System Settings > Desktop & Dock > Prefer tabs when opening documents) | `implemented` |
| [Session discovery](session-discovery.md) | Lists the started session on a later refresh, once its registry entry exists | `implemented` |

## Design decisions

- **Terminal's own windows are tabs when macOS prefers tabs.** With "Prefer tabs when opening documents" set to Always (`AppleWindowTabbingMode` = `always`), a window Terminal opens with `do script` joins the front window as a tab. That is the cheapest way to a tab: no key press, no Accessibility permission, and Terminal is not brought to the front. Measured on 24-11-2026: one real window with 8 tabs gained a ninth from `do script`.
- **Otherwise a tab, by key press.** Terminal's AppleScript dictionary has no command that makes a tab: `do script` without a target opens a window. A tab is made the way you make one, by bringing Terminal to the front, waiting until it is frontmost (activation returns before it is, and a key press sent sooner goes to another application) and sending Cmd-T through System Events, which needs the server to have Accessibility permission as well as Automation permission for Terminal.
- **The new tab opens behind, and never takes your typing.** A new tab is selected when it opens, and Terminal comes to the front a moment after `do script` returns, so whatever you were typing went into the new tab: reported on 24-11-2026, the first time the feature was used. The script notes the front Terminal window (with tabs merged, the selected tab) and the frontmost application before opening. Afterwards it brings that window back to the front (`set index of window id <id> to 1`), which selects that tab again, and if Terminal takes the front within 1.5 seconds it brings the previous application back. The frontmost application is read with `lsappinfo` and restored with `open -b <bundle id>`, so neither step asks for a permission. Measured on 24-11-2026: Terminal was not frontmost when `do script` returned but was 3 seconds later; with the restore, the previous application and the previously selected tab were both still in front 3 seconds later.
- **Recognise the new tab by its tty, not by counting tabs.** Terminal's AppleScript lists each native tab as a window of its own with one tab, so a window's tab count never goes up. Measured on 24-11-2026: System Events saw one window with 8 tabs where Terminal's dictionary reported 8 windows of one tab each, and a first version that waited for the front window's tab count to rise always fell back to a window. The script records every tab's tty before Cmd-T and types only into a tab whose tty is new. If none appears within 2 seconds, it opens a window with `do script` and says so, rather than typing into a tab already in use. If Terminal has no window, a window is opened directly.
- **The directory is quoted by AppleScript, not by hand.** The command typed is `cd <quoted form of directory> && claude`. `quoted form of` produces a single-quoted shell word, so spaces, quotes and `$` in a directory name stay part of the name. The directory reaches `osascript` as an argument, never as script source.
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

## Known implementation gaps

- Other terminals: only Terminal is supported, as in [Prompt delivery](prompt-delivery.md).
- Without "prefer tabs always", Terminal comes to the front for a moment, because the Cmd-T key press has to go to it; keys typed in that moment go to Terminal.
- With "prefer tabs always", the result is reported as a tab without checking: the script trusts macOS to merge the window.
- The session does not appear on the board until Claude Code writes its registry entry, usually within a few seconds; the board does not track a start it asked for.
- No automated tests cover these criteria yet. On 24-11-2026 criteria 1, 3, 4, 5 and 6 were checked by hand against a server on a spare port, and 1a by running the script's Cmd-T branch from a shell with Accessibility permission. The directory used was named `it's a $test dir`, and each started `claude` had exactly it as its working directory.

## Change history

Recorded in [`../changelog.md`](../changelog.md).
