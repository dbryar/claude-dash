# Concept: Attention classification

Part of `claude-dash`'s design. See [`../README.md`](../README.md) for how this folder is used.

## Purpose

Sort sessions by what they need from you, so the tab that is waiting on an answer stands out from the ten that are not.

## Boundaries

**Owns:**

- The four labels and the rule for each: `asked you`, `working`, `idle`, `closed`.

**Does not own:**

- Whether a session is idle or busy, which Claude Code records in the session registry.
- The fields the rule reads, produced by [Transcript digest](transcript-digest.md).

## Interactions

| Interacts with | Nature of the interaction | Status |
| --- | --- | --- |
| [Session discovery](session-discovery.md) | Receives registry status and digest, returns a label | `implemented` |
| [Dashboard UI](dashboard-ui.md) | Labels drive the grouping and colour | `implemented` |
| Permission prompts in Claude Code (external) | Would let a session stopped for tool approval show as waiting on you | `designed` |

## Design decisions

- **"Asked you" is a heuristic.** Claude Code does not record that it is waiting for an answer, so a question mark at the end of the last reply stands in for it. A wrong guess costs a glance, not lost work.
- **Busy always means working**, because the registry has only idle and busy.

## Acceptance criteria

1. Given a session that is not live, then its label is `closed`.
2. Given a live session with status `busy`, then its label is `working`.
3. Given a live, non-busy session whose last assistant text ends in `?` (ignoring trailing whitespace, or followed by up to three non-space characters within the last 40), then its label is `asked you`.
4. Given any other live session, then its label is `idle`.

## Known implementation gaps

- Permission prompts: a session stopped at a tool approval prompt reports `busy`, so it shows as `working`. A Claude Code `Notification` hook writing a marker file would let it show as `asked you`; not built.
- No automated tests cover these criteria yet.

## Change history

Recorded in [`../changelog.md`](../changelog.md).
