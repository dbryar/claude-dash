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

- **"Asked you" is a heuristic.** Claude Code does not record that it is waiting for an answer, so the wording of the last reply stands in for it. A wrong guess costs a glance, not lost work.
- **A question mark at the very end is not enough.** Replies often close with a request worded as a statement ("Task 10 still needs your approval.", "let me know where you'd like them stored", "Once your key is unlocked, run `! git push`"), and a question is often followed by a closing sentence. On 18-11-2026, eight of eleven live sessions were labelled idle while four of them were waiting on the user, and no session had shown as waiting on you for a day. The rule therefore reads the whole last paragraph, and looks for a question or one of a short, literal list of request phrases. The list is kept literal so a mislabelled card can be traced to the phrase that caused it.
- **Busy always means working.** This was originally justified by the registry having only `idle` and `busy`, which is not true: a third value, `shell`, was observed on 16-11-2026 on Claude Code 2.1.220. It was not seen again on 2.1.325 the same day, which proves nothing either way — a status that appears only while a session is shelled out cannot be shown absent by a snapshot. The rule stands on its own terms (a busy session is mid-turn), but it is not the only value that is not `idle`, and the registry's set of statuses is undocumented and may grow again.
- **Anything that is not `busy` is treated as not working.** An unrecognised status falls through to the `asked you` and `idle` rules. That keeps an unknown status visible on the board rather than hiding it, at the cost of labelling it as something it may not be — see the known gap on `shell` below.

## Acceptance criteria

1. Given a session that is not live, then its label is `closed`.
2. Given a live session with status `busy`, then its label is `working`.
2a. Given a live session with a status that is neither `idle` nor `busy`, then it is labelled by the rules below as though it were `idle`. This is current behaviour, recorded so the gap below is checkable; it is not the intended end state.
3. Given a live, non-busy session, the last paragraph of its last assistant text is the text after the last blank line, limited to its final 600 characters. If that paragraph contains a question (a `?` followed by whitespace or the end of the text, optionally after up to three closing characters such as `)`, `"` or `*`), then its label is `asked you`. A `?` inside a word or URL, such as `?query=1`, is not a question.
3a. Given the same paragraph contains, case-insensitively, any of: "let me know", "shall I", "should I", "do you want", "would you like", "want me to", "your approval", "your go-ahead", "your call", "your decision", "your confirmation", "waiting on you", "waiting for you", "waiting for your", "needs your", "need your", "once you", "please confirm", "please approve", "please review", "please check", "please run", or a command for you to run (`` `! ``), then its label is `asked you`.
4. Given any other live session, then its label is `idle`.

## Known implementation gaps

- Permission prompts: a session stopped at a tool approval prompt reports `busy`, so it shows as `working`. A Claude Code `Notification` hook writing a marker file would let it show as `asked you`; not built.
- A session whose registry status is neither `idle` nor `busy`, such as `shell`, is still labelled `idle` by criterion 2a, which is an approximation: a shelled-out session is not waiting on you in the way an idle one is. It is no longer offered a reply box, because replyability is owned by [Prompt delivery](prompt-delivery.md) and published as `canReply` rather than inferred from this label, and its card shows the raw status. Giving such a session a label of its own was rejected for now: it would add a column for a state whose meaning in Claude Code is undocumented, and the label is no longer load-bearing for anything the user can act on.
- The request phrases are English and match Claude's usual wording. A reply that asks for something in other words is labelled idle.
- No automated tests cover these criteria yet. Criterion 2a was checked by hand on 16-11-2026 against a `shell` session. Criteria 3 and 3a were checked by hand on 18-11-2026 against the live sessions' last replies.

## Change history

Recorded in [`../changelog.md`](../changelog.md).
