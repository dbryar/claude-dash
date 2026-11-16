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
| Claude Code transcripts (external) | Lists `~/.claude/projects/*/*.jsonl`, reads the first line holding `cwd` | `implemented` |
| [Transcript digest](transcript-digest.md) | Requests a digest for each transcript path | `implemented` |
| [Attention classification](attention-classification.md) | Passes registry status and digest, receives the attention label | `implemented` |
| [Configuration](configuration.md) | Reads `SESSION_BOARD_RECENT_DAYS` | `implemented` |
| [HTTP API](http-api.md) | Called once per `/api/sessions` request | `implemented` |

## Design decisions

- **Liveness comes from the process, not the registry.** A registry file can outlive its process, so a session counts as live only when signal 0 to its `pid` succeeds.
- **Closed sessions are listed so that closing a tab is safe.** The whole conversation stays on disk and `claude --resume <id>` restores it, so the closed list carries the session id.
- **Transcripts are found by scanning project folders** for `<session id>.jsonl`, not by re-deriving Claude Code's folder-name encoding, which is undocumented.
- **Tiny or empty transcripts are skipped** (under 2,000 bytes, or no title and no real prompt), because they are sessions opened and abandoned.

## Acceptance criteria

1. Given a registry file whose `pid` is running, when `/api/sessions` is requested, then that session appears in `live` with its `name`, `pid`, `kind`, `status`, `cwd`, `repo` (last path segment of `cwd`), `sessionId`, `startedAt` and `statusSince`.
2. Given a registry file whose `pid` is not running, then that session does not appear in `live`.
3. Given a registry file that is not valid JSON, then it is skipped and the other sessions are still returned.
4. Given a live session with no transcript on disk, then it still appears in `live` with an empty ticket list.
5. Given a transcript modified within `SESSION_BOARD_RECENT_DAYS` days, at least 2,000 bytes, with a title or a real prompt, and not belonging to a live session, then it appears in `closed` with `sessionId`, `cwd`, `repo` and `lastAt`.
6. Given a transcript older than the window, under 2,000 bytes, or with neither title nor real prompt, then it does not appear in `closed`.
7. `closed` is sorted by `lastAt`, most recent first.
8. A session id never appears in both `live` and `closed`.

## Known implementation gaps

- No automated tests cover these criteria yet.
- Transcripts are only looked for one folder deep under `~/.claude/projects`.

## Change history

Recorded in [`../changelog.md`](../changelog.md).
