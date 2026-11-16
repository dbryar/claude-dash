# Concept: Transcript digest

Part of `claude-dash`'s design. See [`../README.md`](../README.md) for how this folder is used.

## Purpose

Turn a session transcript (often several megabytes of JSON lines) into the handful of fields a dashboard card needs to answer "what was this tab doing?".

## Boundaries

**Owns:**

- Parsing transcript lines and ignoring ones it cannot parse.
- Extracting the AI title, latest away summary, last prompt, last assistant text, first real prompt, last activity time, cost and any unanswered tool call.
- Matching ticket keys and keeping the most recent.
- Caching each digest until its transcript changes.

**Does not own:**

- Which transcripts to digest, owned by [Session discovery](session-discovery.md).
- The ticket prefixes, owned by [Configuration](configuration.md).
- Turning the digest into an attention label, owned by [Attention classification](attention-classification.md).

## Interactions

| Interacts with | Nature of the interaction | Status |
| --- | --- | --- |
| Claude Code transcripts (external) | Reads every line of one `.jsonl` file | `implemented` |
| [Session discovery](session-discovery.md) | Receives a path, returns a digest | `implemented` |
| [Configuration](configuration.md) | Uses the ticket pattern built from `TICKET_PREFIXES` | `implemented` |

## Design decisions

- **Use what Claude Code already wrote.** The `ai-title`, `system/away_summary`, `last-prompt` and `cost-state` records already summarise the session, so the dashboard makes no model calls of its own.
- **Every record is optional, because the transcript format is not a published interface.** A record this concept reads can be absent on a Claude Code version other than the one the design was written against, so each field is reported as absent rather than defaulted. A reader of the digest must distinguish "no cost recorded" from "cost is zero".
- **Later records win.** Titles and summaries are rewritten as a session goes on, so the last one in the file is the current one.
- **Subagent lines are ignored** (`isSidechain`), because they describe delegated work, not the session's own state.
- **Ticket keys are ranked by recency, capped at four**, because long sessions mention dozens and only the recent ones say what the tab is doing now.
- **Cache key is size plus modification time**, which changes whenever Claude Code appends.

## Acceptance criteria

1. Given several `ai-title` records, then `title` is the last one's `aiTitle`.
2. Given several `system` records with subtype `away_summary`, then `away` and `awayAt` come from the last one.
3. Given a `last-prompt` record, then `lastPrompt` is its `lastPrompt`; given a `cost-state` record, then `costUsd` is its `totalCostUSD`; given no `cost-state` record, then `costUsd` is absent, not zero.
4. `lastAssistant` is the text of the last assistant message that has non-empty text.
5. `lastAt` is the timestamp of the last user or assistant record.
6. `firstPrompt` is the first 300 characters of the first user message that is not meta, not empty, and does not start with `<` or `Caveat:`.
7. Lines that are not valid JSON, and lines with `isSidechain` true, are ignored.
8. Given an assistant `tool_use` with no later `tool_result` carrying its id, then `pendingTool` is that tool's name; once the result arrives, `pendingTool` is empty.
9. `tickets` holds at most four keys, most recently mentioned first, drawn from real user prompts and the title, with no duplicates.
10. Given the transcript's size and modification time are unchanged, then the cached digest is returned without re-reading the file.

## Known implementation gaps

- No automated tests cover these criteria yet.
- `cost-state` is not written by every Claude Code version, and the version decides whether any cost is shown. Measured 16-11-2026: absent from every transcript written by 2.1.220 (a survey of all record types across 14 transcripts), present on 2.1.325. So `cost-state` arrived at or before 2.1.325 and after 2.1.220; the exact release is not known and does not need to be, since 2.1.325 is the version this design is written against. Criterion 3's cost clause is verified on 2.1.325 and known not to apply below it.
- The record carries more than this concept reads: `totalCostUSD`, `totalAPIDuration`, `totalAPIDurationWithoutRetries`, `totalToolDuration`, `totalLinesAdded`, `totalLinesRemoved`, `totalDuration`, `startTime`, `modelUsage` and `hasUnknownModelCost`. Only `totalCostUSD` is used. The rest is recorded here because it is the only per-session usage data the CLI writes.
- A session resumed across an upgrade keeps its old records: one transcript observed holding 526 records written by 2.1.220 and 27 by 2.1.325. A record's presence is therefore a property of the record, not of the file or of the installed version.
- `cost-state` is not written on every turn. A session resumed on 2.1.325 and actively working had none after 27 records, while a session freshly started on 2.1.325 had one within seconds. When it is written is not established.
- The whole file is read on every change. A long session costs a full re-parse each time it is appended to.

## Change history

Recorded in [`../changelog.md`](../changelog.md).
