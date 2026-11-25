# Design index: `claude-dash`

This folder is the design that the code is built against. Code is generated from the design, not the other way round: AI-generated code is not deterministic, so the design has to be, or there is nothing stable for tests, reviews or the next regeneration to check against.

## Working with this folder

1. **Name the concepts a change touches** before writing code. A concept not in the table below is a new concept.
2. **Update the design first.** Change the concept file's boundaries, interactions and acceptance criteria. New concepts start from [`templates/concept.md`](templates/concept.md). Any new or changed interaction also goes in the coordination map below. Record the change in [`changelog.md`](changelog.md).
3. **Build against the updated design.** If an interaction isn't fully built, mark it `designed` or `partial` and list it under the concept's "Known implementation gaps". Never leave something marked `implemented` that isn't.
4. **Tests come from acceptance criteria.** Unit tests from one concept's criteria, integration tests from the edges in the coordination map. When fixing a defect, correct the criterion first, add the regression test, then fix the code.
5. **Design and code land in the same commit.**

## Concepts

| Concept | File | One-line purpose |
| --- | --- | --- |
| Session discovery | [`concepts/session-discovery.md`](concepts/session-discovery.md) | Finds the open sessions and the recently closed ones, and the transcript for each |
| Transcript digest | [`concepts/transcript-digest.md`](concepts/transcript-digest.md) | Reduces a session transcript to what a card needs: title, summary, last prompt, tickets, cost |
| Attention classification | [`concepts/attention-classification.md`](concepts/attention-classification.md) | Decides whether a session is waiting on you, working, idle or closed |
| Configuration | [`concepts/configuration.md`](concepts/configuration.md) | Local settings in `.env`, kept out of the repository |
| HTTP API | [`concepts/http-api.md`](concepts/http-api.md) | The localhost server: dashboard page, session data and health |
| Dashboard UI | [`concepts/dashboard-ui.md`](concepts/dashboard-ui.md) | The page that groups, filters and refreshes session cards, and composes replies |
| Session view | [`concepts/session-view.md`](concepts/session-view.md) | Opens one card as a modal or full-screen view with the whole last reply and a larger reply box |
| Prompt delivery | [`concepts/prompt-delivery.md`](concepts/prompt-delivery.md) | Types a reply into a waiting session's Terminal tab, as if you had typed it |
| Question answering | [`concepts/question-answering.md`](concepts/question-answering.md) | Shows a question Claude asked with options, read from the terminal screen, and answers it by pressing keys |
| Session closing | [`concepts/session-closing.md`](concepts/session-closing.md) | Stops a session's process and closes its Terminal window, leaving it resumable |
| Session starting | [`concepts/session-starting.md`](concepts/session-starting.md) | Starts a new session, or resumes a closed one, in a new Terminal tab and a chosen permission mode |
| Service supervision | [`concepts/service-supervision.md`](concepts/service-supervision.md) | Runs the server as a per-user LaunchAgent that restarts on exit |
| Watchdog | [`concepts/watchdog.md`](concepts/watchdog.md) | Restarts the server when it hangs or when its code or settings change |

## Coordination map

```mermaid
flowchart LR
    cc["Claude Code<br/>~/.claude/sessions, ~/.claude/projects<br/>(external, read only)"]
    launchd["macOS launchd<br/>(external)"]

    config["Configuration"]
    discovery["Session discovery"]
    digest["Transcript digest"]
    attention["Attention classification"]
    api["HTTP API"]
    ui["Dashboard UI"]
    view["Session view"]
    supervision["Service supervision"]
    watchdog["Watchdog"]
    delivery["Prompt delivery"]
    closing["Session closing"]
    answering["Question answering"]
    starting["Session starting"]
    sysevents["macOS System Events<br/>(external)"]
    terminal["macOS Terminal<br/>(external)"]

    discovery -.->|"reads registry and transcripts, checks each pid is a claude process"| cc
    delivery -->|"resolves a session id to its live entry"| discovery
    closing -->|"resolves a session id to its live entry"| discovery
    digest -.->|"reads transcript lines"| cc
    discovery -->|"asks for a digest per transcript"| digest
    discovery -->|"passes status and digest"| attention
    config -->|"ticket prefixes"| digest
    config -->|"closed-list window"| discovery
    config -->|"port"| api
    config -->|"port"| watchdog
    api -->|"calls on each /api/sessions request"| discovery
    ui -->|"polls /api/sessions every 5 s"| api
    ui -->|"POST /api/sessions/&lt;id&gt;/prompt"| api
    ui -->|"opens for a card; current session on each refresh; lends composer and question form"| view
    view -->|"POST prompt and answer, through the borrowed composer and form"| api
    api -->|"session id and text"| delivery
    ui -->|"POST /api/sessions/&lt;id&gt;/close"| api
    api -->|"session id and confirmation"| closing
    closing -->|"is it idle?"| attention
    ui -->|"POST /api/sessions/&lt;id&gt;/answer"| api
    api -->|"menus for waiting sessions; one page's answer"| answering
    answering -.->|"reads status and waitingFor"| cc
    answering -.->|"osascript: read screen, send keys"| terminal
    ui -->|"POST /api/sessions/new"| api
    api -->|"directory or session to resume, and permission mode"| starting
    config -->|"default permission mode"| starting
    starting -->|"is it closed? its transcript directory"| discovery
    starting -.->|"Cmd-T, unless macOS merges windows into tabs"| sysevents
    starting -.->|"osascript: do script cd and claude in the new tab, or a new window"| terminal
    closing -.->|"SIGTERM, then SIGKILL"| cc
    closing -.->|"osascript: close window or exit shell"| terminal
    delivery -.->|"reads pid and status"| cc
    delivery -.->|"osascript: do script in the tab with the session's tty"| terminal
    supervision -.->|"installs agents into"| launchd
    launchd -.->|"starts and restarts"| api
    launchd -.->|"runs every 30 s and on file change"| watchdog
    watchdog -->|"reads /healthz, compares code hash"| api
    watchdog -.->|"launchctl kickstart -k"| launchd
```

Dotted edges cross the boundary of this repository.

## Concepts owned elsewhere, referenced here

| Concept | Owner | Why this project depends on it |
| --- | --- | --- |
| Session registry (`~/.claude/sessions/<pid>.json`) | Claude Code (internal, undocumented) | The only source of which sessions are running and whether each is idle or busy |
| Session transcripts (`~/.claude/projects/*/<session id>.jsonl`) | Claude Code (internal, undocumented) | The source of titles, away summaries, prompts and cost |
| LaunchAgents | macOS launchd | Starts, restarts and schedules the two processes |
| Terminal scripting | macOS Terminal | Typing a prompt into a session's tab, reading it and pressing keys to answer a question, and starting a session in a new tab; needs your permission for the server to control Terminal |
| Key presses | macOS System Events | Pressing Cmd-T to open a new Terminal tab when macOS does not already open windows as tabs; needs Accessibility permission for the server |

Both Claude Code sources are internal state, not a published interface. The design was written against Claude Code 2.1.325.

Where a version has been observed to differ, the concept records it rather than the design assuming one version. Measured 16-11-2026 against both versions installed that day:

| Observation | Versions | Concept | Effect |
| --- | --- | --- | --- |
| `cost-state` records absent | 2.1.220 | [Transcript digest](concepts/transcript-digest.md) | No cost is shown on any card |
| `cost-state` records present, carrying `totalCostUSD` and a `modelUsage` breakdown | 2.1.325 | [Transcript digest](concepts/transcript-digest.md) | Cost is shown; a recorded zero shows as `US$0.00`, an absent record shows nothing |
| Registry `status` can be `shell`, not just `idle` or `busy`: idle, with a background bash task still running | 2.1.220, 2.1.331 | [Attention classification](concepts/attention-classification.md), [Prompt delivery](concepts/prompt-delivery.md) | Labelled idle and replied to as idle; the card says a background task is running |
| The process name is rewritten: a background job reports `claude bg-spare`, and `ps -o ucomm=` reports the version string | 2.1.220, 2.1.325 | [Session discovery](concepts/session-discovery.md) | Session identity is checked against `procStart`, never the process name |
| One transcript can hold records from several versions when a session is resumed across an upgrade | 2.1.220 + 2.1.325 | [Transcript digest](concepts/transcript-digest.md) | A record's presence is a property of the record, not of the installed version |
