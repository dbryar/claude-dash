# Working notes: claude-dash

Design first. Before changing any code, read [`design/README.md`](design/README.md) and follow its "Working with this folder" steps: name the concepts the change touches, update their concept files, coordination map and changelog, then change the code. Design and code land in the same commit.

- Acceptance criteria in `design/concepts/` are the test contract.
- Keep organisation-specific values (ticket prefixes, hostnames, people) out of the repository. They belong in `.env`, with a placeholder in `.env.example`.
- `~/.claude/sessions` and `~/.claude/projects` are Claude Code internals, not a published interface. Check the real files before assuming a field exists.
