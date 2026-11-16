# claude-dash

A local dashboard for keeping track of Claude Code CLI sessions.

## Why this exists

I run a lot of Claude Code sessions at once, each in its own terminal tab. Most of them sit there for one of two reasons. Either the session is blocked waiting on something (a reply from another team, a change window, a ticket), or I've lost track of what it was doing and I won't close it in case I lose the context for a job I'm still on the hook for. Ten or more open tabs is normal, and working out which one needs me means clicking through all of them.

The Claude desktop app would solve some of this, but it isn't always an option: plenty of workplaces only allow the CLI. So this is a small, locally hosted dashboard that reads what Claude Code already writes to disk and shows every session on one page.

Claude Code already writes a short AI title for each session and a "while you were away" summary. They're a good answer to "what was this tab doing?", but they're stuck inside each tab. The dashboard puts them all side by side.

## What it shows

Open sessions are grouped by what they need from you:

- **Waiting on you**: the session is idle and its last reply ended with a question.
- **Working**: the session is busy.
- **Idle**: the session is idle and isn't asking anything.

Each card shows the session name and repository, the AI title, the latest away summary, the last thing you asked, the ticket keys it mentions most recently, how long since anything happened, the cost so far, and the last reply (expandable). The page refreshes every 5 seconds and the filter box searches across all of it, so typing a ticket key finds every tab working on that ticket.

Each waiting or idle card has a **reply** button. Type the next prompt there and press **Send** (or Cmd+Enter), and the dashboard types it into that session's Terminal tab and submits it, exactly as if you had typed it in the tab yourself. The reply box keeps what you've written through refreshes. A busy session can't be sent to until it's idle again.

Each open card also has a **×** in its top-right corner. It stops that session's Claude process and closes its Terminal window. An idle session closes straight away; one that is waiting on you or still working asks first. The conversation isn't lost: the session moves to the closed column, where **copy resume** brings it back.

Tick **show recently closed** to list sessions closed in the last 7 days (change this with `SESSION_BOARD_RECENT_DAYS`). Each one has a **copy resume** button that copies `claude --resume <session id>`. Closing a tab doesn't throw anything away: the whole conversation stays on disk and comes back with that command. That's what lets you close tabs you're only keeping open "just in case".

## How it works

The dashboard sends nothing off the machine. The server only listens on `127.0.0.1`, and apart from sending a reply it only reads local files.

Sending a reply makes a Claude Code session act with your permissions, and closing one stops a process, so both routes only accept requests from the dashboard page itself. It checks the `Host` and `Origin` headers and only accepts JSON, which stops another website you visit (or one using DNS rebinding) from using it. Replies are typed into the session's Terminal tab with AppleScript, after removing control characters, so a reply can only ever arrive as text.

| Source | What it provides |
| --- | --- |
| `~/.claude/sessions/<pid>.json` | Every running session: name, working directory, idle or busy |
| `~/.claude/projects/*/<session id>.jsonl` | Each session's transcript: AI title, away summaries, last prompt, cost |
| Terminal (AppleScript) | The tab whose tty matches a session's process, for typing a reply |

Neither file is a documented interface. They're Claude Code's own internal state, so a Claude Code release can change them and break the dashboard. It was built against Claude Code 2.1.325.

Three pieces run on macOS:

- `server.ts` is a [Bun](https://bun.sh) server with five routes: `/` for the dashboard, `/api/sessions` for the data as JSON, `POST /api/sessions/<id>/prompt` for sending a reply, `POST /api/sessions/<id>/close` for closing a session, and `/healthz` for health. `/healthz` reports the process id, the start time and a hash of the code and `.env` the process loaded.
- `local.session-board` is a per-user LaunchAgent that runs the server. It starts at login, and launchd restarts it whenever it exits.
- `local.session-board.watchdog` is a second LaunchAgent that runs `watchdog.sh` every 30 seconds and whenever `server.ts`, `index.html` or `.env` changes. It restarts the server if `/healthz` stops answering (the process has hung) or if the hash no longer matches the files on disk. Editing the code or the settings reloads the dashboard within a few seconds.

Both agents run as you, only while you're logged in. There is no system-wide daemon and nothing needs `sudo`.

## Requirements

- macOS
- [Bun](https://bun.sh) on your `PATH`
- Claude Code CLI

## Install

```sh
git clone git@github.com:dbryar/claude-dash.git ~/.claude/tools/session-board
cd ~/.claude/tools/session-board
cp .env.example .env    # then edit .env
./install.sh
```

Open <http://127.0.0.1:7377>.

The first reply you send makes macOS ask whether `bun` may control Terminal. Allow it. To change your mind later, see System Settings > Privacy & Security > Automation.

`install.sh` copies `.env.example` to `.env` if you haven't made one. It fills your paths into the two templates in `launchd/`, writes them to `~/Library/LaunchAgents`, and loads them. Run it again after moving the folder or changing the templates. macOS will show a "Background Items Added" notice the first time.

The clone can live anywhere. `~/.claude/tools/session-board` is only a suggestion.

## Configure

Settings go in `.env`, which git ignores. `.env.example` lists them:

| Setting | Default | Purpose |
| --- | --- | --- |
| `TICKET_PREFIXES` | any `ABC-123` key | Comma-separated ticket prefixes to show on cards, e.g. `ABC,OPS`. A prefix matches with or without a hyphen, so `OPS` matches both `OPS-12` and `OPS0012345`. |
| `SESSION_BOARD_PORT` | `7377` | Port to listen on |
| `SESSION_BOARD_RECENT_DAYS` | `7` | How far back the closed list goes |

Saving `.env` restarts the server with the new values.

## Operate

| Task | Command |
| --- | --- |
| Check health | `curl -s http://127.0.0.1:7377/healthz` |
| Restart by hand | `launchctl kickstart -k gui/$(id -u)/local.session-board` |
| Check agent state | `launchctl print gui/$(id -u)/local.session-board` |
| Read logs | `~/Library/Logs/session-board/server.log` and `watchdog.log` |
| Run without launchd | `bun server.ts` (stop the agent first, or set another port) |
| Uninstall | `./install.sh --uninstall` |

## Design

The code is built against the design in [`design/`](design/README.md): one file per concept, each with its acceptance criteria, and a coordination map showing how they connect. Change the design first, then the code, in the same commit.

## Limitations

- "Waiting on you" is a guess: it means the last reply ended with a question mark.
- A session stopped at a tool approval prompt shows as "Working", because the session registry only records idle or busy.
- Replies only work for sessions running in macOS Terminal. Sessions in iTerm2, tmux or an editor's terminal show the reply button but are refused with a message saying so.
- Closing only closes the window when the session's tab is the window's only tab. In a window with several tabs it types `exit` into the shell, and the tab closes only if your Terminal profile closes tabs when the shell exits. A window still running something else after Claude stops is left open.
- A reply is added to anything already typed, but not sent, in that tab's input box.
- A reply starting with `/` or `!` runs as a slash command or shell command, the same as typing it.
- Long replies (dozens of lines) reach the session as pasted content, the same as pasting them into the tab yourself.
- The server reads each transcript in full and caches it until the file changes, so very long sessions slow the first load.
- The install only works on macOS, because it uses launchd. The server itself runs anywhere Bun does.
