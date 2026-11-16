# Concept: Session discovery

Part of `claude-dash`'s design. See [`../README.md`](../README.md) for how this folder is used.

## Purpose

Find every Claude Code session worth showing: the ones running now, and the ones closed recently enough that you may still want to resume them. Pair each with its transcript.

## Boundaries

**Owns:**

- Reading the session registry and deciding which entries are live.
- Locating a session's transcript by session id.
- Listing recently closed sessions and recovering their working directory.
- Assembling the `/api/sessions` payload (`generatedAt`, `live`, `closed`).

**Does not own:**

- What is extracted from a transcript, owned by [Transcript digest](transcript-digest.md).
- The waiting/working/idle decision, owned by [Attention classification](attention-classification.md).
- The registry and transcript formats, owned by Claude Code.

## Interactions

| Interacts with | Nature of the interaction | Status |
| --- | --- | --- |
| Claude Code session registry (external) | Reads `~/.claude/sessions/*.json` | `implemented` |
| The sessions' processes (external) | Signal 0 for liveness; one `ps -o pid=,comm=` for every candidate pid, to reject a reused pid | `implemented` |
| Claude Code transcripts (external) | Lists `~/.claude/projects/*/*.jsonl`, reads the first line holding `cwd` | `implemented` |
| [Transcript digest](transcript-digest.md) | Requests a digest for each transcript path | `implemented` |
| [Attention classification](attention-classification.md) | Passes registry status and digest, receives the attention label | `implemented` |
| [Configuration](configuration.md) | Reads `SESSION_BOARD_RECENT_DAYS` | `implemented` |
| [HTTP API](http-api.md) | Called once per `/api/sessions` request | `implemented` |

## Design decisions

- **Liveness comes from the process, not the registry.** A registry file can outlive its process, so a session counts as live only when signal 0 to its `pid` succeeds.
- **Signal 0 is not enough: the pid must still be Claude Code.** A registry file left behind by a session that did not exit cleanly keeps its `pid`, and the operating system reuses that pid for something else. Signal 0 then succeeds against an unrelated process and the dead session is reported as live. A session therefore counts as live only when `ps` names its pid's command and that command is `claude`, the same test [Session closing](session-closing.md) makes before signalling. One `ps` call covers every candidate pid, so the check costs nothing per session.
- **An unnamed command is treated as live.** If `ps` reports no command for a signalable pid, the session is kept. Wrongly hiding a live session loses the tab the dashboard exists to find, while wrongly showing a dead one costs a glance, so the uncertain case fails towards showing it.
- **The newest entry wins for a session id.** `claude --resume` starts a new process for an existing session id, so one session can have two registry entries, and both can be live if the earlier one did not exit cleanly. The entry with the latest `startedAt` is the process running now. Only one entry per session id is returned, because [Dashboard UI](dashboard-ui.md) keys its cards by session id and would otherwise collapse two entries into one card and silently drop a session.
- **Process start time was considered and not used.** Comparing the registry's `procStart` with the pid's real start time would also catch a reused pid, and would not depend on the command's name. It was rejected for now because `procStart` is written in UTC in a different field order from `ps -o lstart=`, and macOS `ps` has no `etimes` keyword, so the comparison needs timezone-aware parsing to avoid declaring every healthy session dead. Recorded here as the stronger option if the command name ever proves unreliable.
- **Closed sessions are listed so that closing a tab is safe.** The whole conversation stays on disk and `claude --resume <id>` restores it, so the closed list carries the session id.
- **Transcripts are found by scanning project folders** for `<session id>.jsonl`, not by re-deriving Claude Code's folder-name encoding, which is undocumented.
- **Tiny or empty transcripts are skipped** (under 2,000 bytes, or no title and no real prompt), because they are sessions opened and abandoned.

## Acceptance criteria

1. Given a registry file whose `pid` is running, when `/api/sessions` is requested, then that session appears in `live` with its `name`, `pid`, `kind`, `status`, `cwd`, `repo` (last path segment of `cwd`), `sessionId`, `startedAt`, `statusSince` and `canReply` (see [Prompt delivery](prompt-delivery.md) criterion 10a).
2. Given a registry file whose `pid` is not running, then that session does not appear in `live`.
3. Given a registry file whose `pid` is running but whose command, as reported by `ps`, is not `claude`, then that session does not appear in `live`.
4. Given a registry file whose `pid` is running and for which `ps` reports no command at all, then that session still appears in `live`.
5. Given two registry files with the same `sessionId` whose pids are both live `claude` processes, then only the one with the later `startedAt` appears in `live`. `live` never contains two entries with the same `sessionId`.
6. Given a registry file that is not valid JSON, then it is skipped and the other sessions are still returned.
7. Given a live session with no transcript on disk, then it still appears in `live` with an empty ticket list.
8. Given a transcript modified within `SESSION_BOARD_RECENT_DAYS` days, at least 2,000 bytes, with a title or a real prompt, and not belonging to a live session, then it appears in `closed` with `sessionId`, `cwd`, `repo` and `lastAt`.
9. Given a transcript older than the window, under 2,000 bytes, or with neither title nor real prompt, then it does not appear in `closed`.
10. `closed` is sorted by `lastAt`, most recent first.
11. A session id never appears in both `live` and `closed`.

## Known implementation gaps

- No automated tests cover these criteria yet. On 16-11-2026 criterion 3 was checked against two real reused-pid entries (one from 18-09-2026 held a pid belonging to Terminal.app), and criteria 2, 3, 5 and 6 were checked by running the server against a crafted registry under a temporary `HOME`, which is the shape an automated test of this concept would take.
- Criterion 4 is not verified. It needs a signalable pid that `ps` reports nothing for, which has not been reproduced.
- A reused pid belonging to a *different* `claude` process would still pass criterion 3. Only the process start time distinguishes that case, and it is not compared (see design decisions).
- Transcripts are only looked for one folder deep under `~/.claude/projects`.

## Change history

Recorded in [`../changelog.md`](../changelog.md).
