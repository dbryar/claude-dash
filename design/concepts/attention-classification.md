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
- **Busy always means working.** This was originally justified by the registry having only `idle` and `busy`, which is not true: a third value, `shell`, was observed on 16-11-2026 on Claude Code 2.1.220. The rule stands on its own terms (a busy session is mid-turn), but it is not the only value that is not `idle`, and the registry's set of statuses is undocumented and may grow again.
- **Anything that is not `busy` is treated as not working.** An unrecognised status falls through to the `asked you` and `idle` rules. That keeps an unknown status visible on the board rather than hiding it, at the cost of labelling it as something it may not be — see the known gap on `shell` below.

## Acceptance criteria

1. Given a session that is not live, then its label is `closed`.
2. Given a live session with status `busy`, then its label is `working`.
2a. Given a live session with a status that is neither `idle` nor `busy`, then it is labelled by the rules below as though it were `idle`. This is current behaviour, recorded so the gap below is checkable; it is not the intended end state.
3. Given a live, non-busy session whose last assistant text ends in `?` (ignoring trailing whitespace, or followed by up to three non-space characters within the last 40), then its label is `asked you`.
4. Given any other live session, then its label is `idle`.

## Known implementation gaps

- Permission prompts: a session stopped at a tool approval prompt reports `busy`, so it shows as `working`. A Claude Code `Notification` hook writing a marker file would let it show as `asked you`; not built.
- **The `shell` status is misreported, and the reply button on such a card cannot work.** A session whose registry status is `shell` is labelled `idle`, so [Dashboard UI](dashboard-ui.md) puts it in the Idle column and offers a reply (criterion 14), while [Prompt delivery](prompt-delivery.md) accepts only a status of exactly `idle` (criterion 10) and refuses it with "the session is busy; wait until it is idle". Observed on 16-11-2026 with session `blog-5e` on Claude Code 2.1.220. Three fixes are possible and none is chosen yet: label it its own state and hide the composer; treat it as `idle` in delivery too; or treat it as `working`. What `shell` means in Claude Code is not documented, so the choice needs that answered first.
- No automated tests cover these criteria yet. Criterion 2a was checked by hand on 16-11-2026 against a `shell` session.

## Change history

Recorded in [`../changelog.md`](../changelog.md).
