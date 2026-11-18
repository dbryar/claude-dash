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
| The sessions' processes (external) | Signal 0 for liveness; one `ps -o pid=,etime=,comm=` for every candidate pid, to reject a reused pid | `implemented` |
| Claude Code transcripts (external) | Lists `~/.claude/projects/*/*.jsonl`, reads the first line holding `cwd` | `implemented` |
| [Transcript digest](transcript-digest.md) | Requests a digest for each transcript path | `implemented` |
| [Attention classification](attention-classification.md) | Passes registry status and digest, receives the attention label | `implemented` |
| [Configuration](configuration.md) | Reads `SESSION_BOARD_RECENT_DAYS` | `implemented` |
| [HTTP API](http-api.md) | Called once per `/api/sessions` request | `implemented` |

## Design decisions

- **Liveness comes from the process, not the registry.** A registry file can outlive its process, so a session counts as live only when signal 0 to its `pid` succeeds.
- **Signal 0 is not enough: the pid must still be the process the registry recorded.** A registry file left behind by a session that did not exit cleanly keeps its `pid`, and the operating system reuses that pid for something else. Signal 0 then succeeds against an unrelated process and the dead session is reported as live. Identity is therefore checked against `procStart`, the process start time the registry recorded, compared with the pid's real start time to a tolerance of five seconds. One `ps -o pid=,etime=,comm=` call covers every candidate pid, so the check costs nothing per session.
- **The process's name cannot carry this check.** Requiring the command to be `claude` was tried first and hid real sessions: Claude Code rewrites its own process name, so a background job reports `claude bg-spare` and `ps -o ucomm=` reports the version string (`2.1.325`) rather than a name at all. Measured 16-11-2026. `procStart` is exact and independent of whatever the process calls itself, which is why it is the primary test; the first word of the command is kept only as a fallback for a registry entry with no usable `procStart`.
- **An undeterminable identity is treated as live.** If `ps` reports nothing for a signalable pid, or neither `procStart` nor the command can be used, the session is kept. Wrongly hiding a live session loses the tab the dashboard exists to find, while wrongly showing a dead one costs a glance, so every uncertain case fails towards showing it. This also bounds the damage from a future change to either field: the dashboard degrades to listing a possibly-dead session, never to listing nothing.
- **The newest entry wins for a session id.** `claude --resume` starts a new process for an existing session id, so one session can have two registry entries, and both can be live if the earlier one did not exit cleanly. The entry with the latest `startedAt` is the process running now. Only one entry per session id is returned, because [Dashboard UI](dashboard-ui.md) keys its cards by session id and would otherwise collapse two entries into one card and silently drop a session.
- **`procStart` is read as UTC and compared through elapsed time.** `procStart` is written in UTC (`Fri Oct 23 13:02:22 2026`) in a different field order from `ps -o lstart=`, which is local, so it is parsed explicitly as UTC rather than by a date library's guess. The process's real start time is derived from `ps -o etime=` (`[[dd-]hh:]mm:ss`) subtracted from the current time, because macOS `ps` has no `etimes` keyword. Measured 16-11-2026 across five registry entries: the four whose pids still held their own process agreed to the second, and the one whose pid had been reused was out by 29 days.
- **`startedAt` is not the process start time.** It records when the session began, not when its process did. A background job adopted by an already-running spare process has a `startedAt` of today and a `procStart` from three weeks earlier, both correct. Only `procStart` may be compared against the process.
- **Closed sessions are listed so that closing a tab is safe.** The whole conversation stays on disk and `claude --resume <id>` restores it, so the closed list carries the session id.
- **Transcripts are found by scanning project folders** for `<session id>.jsonl`, not by re-deriving Claude Code's folder-name encoding, which is undocumented.
- **Tiny or empty transcripts are skipped** (under 2,000 bytes, or no title and no real prompt), because they are sessions opened and abandoned.

## Acceptance criteria

1. Given a registry file whose `pid` is running, when `/api/sessions` is requested, then that session appears in `live` with its `name`, `pid`, `kind`, `status`, `cwd`, `repo` (last path segment of `cwd`), `sessionId`, `startedAt`, `statusSince`, `waitingFor` (when the registry has it) and `canReply` (see [Prompt delivery](prompt-delivery.md) criterion 10a).
2. Given a registry file whose `pid` is not running, then that session does not appear in `live`.
3. Given a registry file whose `pid` is running but whose `procStart` differs from that pid's real start time by more than five seconds, then that session does not appear in `live`.
4. Given a registry file whose `pid` is running and whose `procStart` matches that pid's real start time, then that session appears in `live` whatever the process calls itself, including a background job reporting `claude bg-spare`.
5. Given a registry file with no `procStart`, or one that cannot be parsed, then the first word of the pid's command decides: `claude` appears in `live`, anything else does not. Given `ps` reports nothing at all for a signalable pid, then the session appears in `live`.
6. Given two registry files with the same `sessionId` whose pids are both live and verified, then only the one with the later `startedAt` appears in `live`. `live` never contains two entries with the same `sessionId`.
7. Given a registry file that is not valid JSON, then it is skipped and the other sessions are still returned.
8. Given a live session with no transcript on disk, then it still appears in `live` with an empty ticket list.
9. Given a transcript modified within `SESSION_BOARD_RECENT_DAYS` days, at least 2,000 bytes, with a title or a real prompt, and not belonging to a live session, then it appears in `closed` with `sessionId`, `cwd`, `repo` and `lastAt`.
10. Given a transcript older than the window, under 2,000 bytes, or with neither title nor real prompt, then it does not appear in `closed`.
11. `closed` is sorted by `lastAt`, most recent first.
12. A session id never appears in both `live` and `closed`.

## Known implementation gaps

- No automated tests cover these criteria yet. On 16-11-2026 criteria 2 to 7 and 12 were checked by running the server against a crafted registry under a temporary `HOME` — the shape an automated test of this concept would take — covering a matching `procStart`, a mismatched one, a missing one, an unparseable one, a dead pid, a background job named `claude bg-spare`, two entries for one session id, and a malformed file. Criterion 3 was also checked against a real reused pid: an entry from 18-09-2026 whose pid now belongs to Terminal.app.
- The last clause of criterion 5 (`ps` reports nothing for a signalable pid) is not verified. It has not been reproduced.
- A pid reused by a different `claude` process started within five seconds of the original would still pass criterion 3. The window is small enough to ignore.
- Transcripts are only looked for one folder deep under `~/.claude/projects`.

## Change history

Recorded in [`../changelog.md`](../changelog.md).
