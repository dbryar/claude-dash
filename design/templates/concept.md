# Concept: `<concept-name>`

Part of `claude-dash`'s design. See [`../README.md`](../README.md) for how this folder is used.

## Purpose

`<One or two sentences: what problem this concept solves, for whom.>`

## Boundaries

**Owns:**

- `<responsibility this concept is fully accountable for>`

**Does not own** (and where that responsibility actually lives):

- `<adjacent responsibility>`, owned by `<concept or module>` instead.

## Interactions

Every row here should also appear as an edge in the coordination map in `design/README.md`.

| Interacts with                                | Nature of the interaction                        | Status                                 |
| --------------------------------------------- | ------------------------------------------------ | -------------------------------------- |
| `<concept-name>` (`<module>` if cross-module) | `<what passes between them, in which direction>` | `designed` / `implemented` / `partial` |

## Design decisions

`<Record the decisions that shaped this concept and, briefly, why. Not a transcript of the discussion, the outcome and its reason.>`

## Acceptance criteria

Each criterion must be a single, checkable statement. Use Given/When/Then where the behaviour is conditional; a plain numbered assertion is fine where it isn't.

1. Given `<precondition>`, when `<action>`, then `<expected outcome>`.
2. `<Plain assertion where Given/When/Then would be unnecessary ceremony.>`

## Known implementation gaps

List anything in "Interactions" marked `designed` or `partial`, with a short note on what's missing. Leave this section explicitly empty (`None currently.`) rather than omitting it, so a reader knows the gap was checked for, not just that none happened to be recorded.

## Change history

Record entries in `design/changelog.md`, not here; this section is a placeholder reminder to actually do that, not a duplicate log.
