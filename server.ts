// Session board: a read-only, localhost-only dashboard over Claude Code CLI sessions.
// Sources (all local, nothing leaves the machine):
//   ~/.claude/sessions/<pid>.json          live session registry (name, cwd, status)
//   ~/.claude/projects/*/<sessionId>.jsonl transcripts (ai-title, away_summary, last-prompt, cost-state)
// Runs as the LaunchAgent local.session-board (install.sh); open http://127.0.0.1:7377
// The write routes only accept requests from this page. POST /api/sessions/<id>/prompt types a
// reply into a session's Terminal tab (design/concepts/prompt-delivery.md), and
// POST /api/sessions/<id>/close stops a session and closes its window (design/concepts/session-closing.md).
// POST /api/sessions/new starts claude in a new Terminal tab (design/concepts/session-starting.md).

import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, basename } from "node:path";
import { homedir } from "node:os";
import { createHash } from "node:crypto";

const HOME = homedir();
const SESSIONS = join(HOME, ".claude", "sessions");
const PROJECTS = join(HOME, ".claude", "projects");
const PORT = Number(process.env.SESSION_BOARD_PORT ?? 7377);
const RECENT_DAYS = Number(process.env.SESSION_BOARD_RECENT_DAYS ?? 7);
// Permission mode for sessions started or resumed from the board. See design/concepts/session-starting.md.
const PERMISSION_FLAGS: Record<string, string[]> = {
  skip: ["--dangerously-skip-permissions"],
  auto: ["--permission-mode", "auto"],
  ask: [],
};
const PERMISSION_MODE = Object.hasOwn(PERMISSION_FLAGS, process.env.SESSION_BOARD_PERMISSION_MODE ?? "")
  ? process.env.SESSION_BOARD_PERMISSION_MODE! : "auto";
// Ticket keys to pick out of prompts and titles. TICKET_PREFIXES comes from .env
// (see .env.example). Unset, any Jira-style key (ABC-123) matches.
const PREFIXES = (process.env.TICKET_PREFIXES ?? "")
  .split(",").map((p) => p.trim()).filter((p) => /^[A-Za-z][A-Za-z0-9]*$/.test(p));
// Ordinary technical writing is full of Jira-shaped strings (SHA-256, UTF-8, RFC-2119), so the
// default pattern skips prefixes known not to be ticket systems. An explicit TICKET_PREFIXES
// names the user's own systems and is trusted as given. See design/concepts/configuration.md.
const NOT_TICKETS = /^(?:SHA|UTF|ISO|RFC|AES|RSA|UTC|GMT|HTTP|TLS|SSL|IPV|CVE|COVID)$/;
const TICKET_RE = PREFIXES.length
  ? new RegExp(`\\b(?:${PREFIXES.join("|")})-?\\d{2,}\\b`, "g")
  : /\b[A-Z][A-Z0-9]{1,9}-\d+\b/g;
const isTicket = (key: string) =>
  PREFIXES.length > 0 || !NOT_TICKETS.test(key.slice(0, key.indexOf("-")));

type Digest = {
  title?: string;
  away?: string;
  awayAt?: string;
  lastPrompt?: string;
  lastAssistant?: string;
  lastAt?: string;
  pendingTool?: string;
  costUsd?: number;
  tickets: string[];
  firstPrompt?: string;
};

const cache = new Map<string, { key: string; digest: Digest }>();

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content))
    return content
      .filter((c: any) => c?.type === "text" && typeof c.text === "string")
      .map((c: any) => c.text)
      .join("\n");
  return "";
}

function isNoise(t: string) {
  return !t.trim() || t.startsWith("<") || t.startsWith("Caveat:");
}

function digest(path: string): Digest {
  const st = statSync(path);
  const key = `${st.size}:${st.mtimeMs}`;
  const hit = cache.get(path);
  if (hit && hit.key === key) return hit.digest;

  const d: Digest = { tickets: [] };
  const tickets = new Set<string>();
  let lastToolUse: { id: string; name: string } | undefined;

  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line) continue;
    let o: any;
    try { o = JSON.parse(line); } catch { continue; }
    if (o.isSidechain) continue;
    switch (o.type) {
      case "ai-title": d.title = o.aiTitle; break;
      case "last-prompt": d.lastPrompt = o.lastPrompt; break;
      case "cost-state": d.costUsd = o.totalCostUSD; break;
      case "system":
        if (o.subtype === "away_summary") { d.away = o.content; d.awayAt = o.timestamp; }
        break;
      case "user": {
        if (o.timestamp) d.lastAt = o.timestamp;
        const c = o.message?.content;
        if (Array.isArray(c) && lastToolUse && c.some((x: any) => x?.type === "tool_result" && x.tool_use_id === lastToolUse!.id))
          lastToolUse = undefined;
        const t = textOf(c);
        if (!o.isMeta && !isNoise(t)) {
          if (!d.firstPrompt) d.firstPrompt = t.slice(0, 300);
          for (const m of t.match(TICKET_RE) ?? []) if (isTicket(m)) { tickets.delete(m); tickets.add(m); }
        }
        break;
      }
      case "assistant": {
        if (o.timestamp) d.lastAt = o.timestamp;
        const c = o.message?.content;
        const t = textOf(c);
        if (t.trim()) d.lastAssistant = t;
        if (Array.isArray(c)) {
          const tu = [...c].reverse().find((x: any) => x?.type === "tool_use");
          if (tu) lastToolUse = { id: tu.id, name: tu.name };
        }
        break;
      }
    }
  }
  if (d.title) for (const m of d.title.match(TICKET_RE) ?? []) if (isTicket(m)) { tickets.delete(m); tickets.add(m); }
  d.pendingTool = lastToolUse?.name;
  d.tickets = [...tickets].reverse().slice(0, 4); // most recently mentioned first
  cache.set(path, { key, digest: d });
  return d;
}

function findTranscript(sessionId: string): string | undefined {
  for (const dir of readdirSync(PROJECTS)) {
    const p = join(PROJECTS, dir, `${sessionId}.jsonl`);
    if (existsSync(p)) return p;
  }
}

// The working directory recorded in a transcript: the first record that carries one.
function transcriptCwd(path: string): string {
  try { return JSON.parse(readFileSync(path, "utf8").split("\n").find((l) => l.includes('"cwd"')) ?? "{}").cwd ?? ""; } catch { return ""; }
}

function alive(pid: number) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

// What ps knows about each pid, from one call: when the process really started, and its
// command. A pid ps says nothing about is absent from the map.
type ProcInfo = { start?: number; comm?: string };
function procInfo(pids: number[]): Map<number, ProcInfo> {
  const out = new Map<number, ProcInfo>();
  if (!pids.length) return out;
  const r = Bun.spawnSync(["ps", "-o", "pid=,etime=,comm=", "-p", pids.join(",")]);
  const now = Date.now() / 1000;
  for (const line of r.stdout.toString().split("\n")) {
    const m = line.trim().match(/^(\d+)\s+(\S+)\s+(\S.*)$/);
    if (!m) continue;
    const el = elapsedSeconds(m[2]);
    out.set(Number(m[1]), { start: el === undefined ? undefined : now - el, comm: m[3].trim() });
  }
  return out;
}

// ps reports elapsed time as [[dd-]hh:]mm:ss.
function elapsedSeconds(etime: string): number | undefined {
  const m = /^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)$/.exec(etime);
  if (!m) return;
  return Number(m[1] ?? 0) * 86400 + Number(m[2] ?? 0) * 3600 + Number(m[3]) * 60 + Number(m[4]);
}

// The registry records procStart in UTC, e.g. "Fri Oct 23 13:02:22 2026".
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function parseProcStart(v: unknown): number | undefined {
  if (typeof v !== "string") return;
  const m = /^\w{3}\s+(\w{3})\s+(\d{1,2})\s+(\d{2}):(\d{2}):(\d{2})\s+(\d{4})$/.exec(v.trim());
  if (!m) return;
  const mon = MONTHS.indexOf(m[1]);
  if (mon < 0) return;
  return Date.UTC(Number(m[6]), mon, Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5])) / 1000;
}

// Signal 0 only proves that some process the user may signal holds the pid. A registry file left
// by a session that did not exit cleanly keeps its pid, the system reuses it, and the dead
// session reads as live: an entry from September held a pid belonging to Terminal.app.
// Identity is checked against the process start time the registry recorded, which is exact and
// independent of the process's name. The name cannot carry this: Claude Code rewrites it, so a
// background job reports "claude bg-spare" and ucomm reports the version string, and requiring
// the name to be "claude" hid real sessions. The name is only a fallback for an entry with no
// usable procStart, and when neither can be determined the session is kept -- hiding a live
// session loses the tab the dashboard exists to find, while showing a dead one costs a glance.
const SAME_PROCESS_TOLERANCE_S = 5;
function isSameProcess(s: any, info: ProcInfo | undefined): boolean {
  if (!info) return true;
  const recorded = parseProcStart(s?.procStart);
  if (recorded !== undefined && info.start !== undefined)
    return Math.abs(info.start - recorded) <= SAME_PROCESS_TOLERANCE_S;
  if (info.comm) return basename(info.comm.split(/\s+/)[0]) === "claude";
  return true;
}

function registryEntries(): any[] {
  const out: any[] = [];
  for (const f of readdirSync(SESSIONS).filter((f) => f.endsWith(".json"))) {
    try { out.push(JSON.parse(readFileSync(join(SESSIONS, f), "utf8"))); } catch {}
  }
  return out;
}

// The live sessions, one entry per session id. `claude --resume` starts a new process for an
// existing session id, so a session can have two registry entries and both can be live; the
// later startedAt is the process running now. The dashboard keys cards by session id, so
// returning both would collapse them into one card and hide a session.
function liveEntries(): any[] {
  const running = registryEntries().filter((s) => s?.sessionId && s.pid && alive(s.pid));
  const procs = procInfo(running.map((s) => s.pid));
  const newest = new Map<string, any>();
  for (const s of running) {
    if (!isSameProcess(s, procs.get(s.pid))) continue;
    const prev = newest.get(s.sessionId);
    if (!prev || (s.startedAt ?? 0) > (prev.startedAt ?? 0)) newest.set(s.sessionId, s);
  }
  return [...newest.values()];
}

function attention(status: string, d: Digest, live: boolean): string {
  if (!live) return "closed";
  // Claude Code 2.1.327+ records a dialog that needs you (a question, some permission prompts) as `waiting`.
  if (status === "waiting") return "asked you";
  if (status === "busy") return "working";
  return asksYou(d.lastAssistant) ? "asked you" : "idle";
}

// Replies that need you often end with a statement, so read the whole last paragraph for a
// question or a request phrase. See design/concepts/attention-classification.md, criteria 3 and 3a.
const QUESTION_RE = /\?["'`)\]*_]{0,3}(\s|$)/;
const REQUEST_RE = new RegExp([
  "let me know", "shall i", "should i", "do you want", "would you like", "want me to",
  "your approval", "your go-ahead", "your call", "your decision", "your confirmation",
  "waiting on you", "waiting for you", "waiting for your", "needs your", "need your", "once you",
  "please confirm", "please approve", "please review", "please check", "please run",
].map(p => `\\b${p}\\b`).join("|") + "|`!", "i");

function lastParagraph(text = "") {
  const t = text.trim();
  return t.slice(t.lastIndexOf("\n\n") + 1).slice(-600);
}

function asksYou(text?: string) {
  const p = lastParagraph(text);
  return QUESTION_RE.test(p) || REQUEST_RE.test(p);
}

function collect() {
  const live: any[] = [];
  const liveIds = new Set<string>();
  for (const s of liveEntries()) {
    const tp = findTranscript(s.sessionId);
    const d = tp ? digest(tp) : { tickets: [] };
    liveIds.add(s.sessionId);
    live.push({
      live: true, name: s.name, pid: s.pid, kind: s.kind, status: s.status,
      cwd: s.cwd, repo: basename(s.cwd), sessionId: s.sessionId,
      startedAt: s.startedAt, statusSince: s.statusUpdatedAt,
      waitingFor: typeof s.waitingFor === "string" ? s.waitingFor : undefined,
      attention: attention(s.status, d as Digest, true),
      // Owned by prompt delivery, not inferred from the label: the registry has statuses
      // beyond idle and busy (`shell`), and those are labelled idle but cannot be replied to.
      canReply: s.status === "idle",
      ...d,
    });
  }

  // Recently closed sessions, so a closed tab is never a lost job.
  const cutoff = Date.now() - RECENT_DAYS * 86_400_000;
  const closed: any[] = [];
  for (const dir of readdirSync(PROJECTS)) {
    const full = join(PROJECTS, dir);
    let files: string[];
    try { files = readdirSync(full).filter((f) => f.endsWith(".jsonl")); } catch { continue; }
    for (const f of files) {
      const id = f.slice(0, -6);
      if (liveIds.has(id)) continue;
      const p = join(full, f);
      const st = statSync(p);
      if (st.mtimeMs < cutoff || st.size < 2000) continue;
      const d = digest(p);
      if (!d.title && !d.firstPrompt) continue;
      const cwd = transcriptCwd(p);
      closed.push({
        live: false, sessionId: id, cwd, repo: cwd ? basename(cwd) : dir,
        attention: "closed", lastAt: d.lastAt ?? new Date(st.mtimeMs).toISOString(), ...d,
      });
    }
  }
  closed.sort((a, b) => (b.lastAt ?? "").localeCompare(a.lastAt ?? ""));
  return { generatedAt: new Date().toISOString(), live, closed, permissionMode: PERMISSION_MODE };
}

// ---- Prompt delivery (design/concepts/prompt-delivery.md) ----
const MAX_TEXT = 20_000;
const MAX_BODY = 64 * 1024;
const HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`]);
const ORIGINS = new Set([...HOSTS].map((h) => `http://${h}`));

// Line breaks normalised to \n; every other control character (C0 except tab and \n, DEL, C1) removed,
// so the text can only ever be typed as text, never act as a key press.
function cleanPrompt(text: string) {
  return text.replace(/\r\n?/g, "\n").replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, "").trim();
}

// Resolved the same way the dashboard lists sessions, so what a card shows and what receives
// a reply (or a close) cannot disagree. See design/concepts/prompt-delivery.md.
function liveSession(id: string) {
  return liveEntries().find((s) => s.sessionId === id);
}

async function run(cmd: string[]) {
  const p = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe" });
  const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  return { out: out.trim(), err: err.trim(), code };
}

async function deliverPrompt(id: string, raw: string): Promise<[number, string | null]> {
  const text = cleanPrompt(raw);
  if (!text) return [400, "the reply is empty"];
  if (text.length > MAX_TEXT) return [413, "the reply is longer than 20,000 characters"];
  const s = liveSession(id);
  if (!s) return [404, "no running session with that id"];
  if (s.status !== "idle") return [409, "the session is busy; wait until it is idle"];
  const tty = (await run(["ps", "-o", "tty=", "-p", String(s.pid)])).out;
  if (!tty || tty.startsWith("?")) return [422, "the session has no terminal"];
  const r = await run(["osascript", join(import.meta.dir, "terminal.applescript"), "type", `/dev/${tty}`, text]);
  if (r.code !== 0) {
    if (/-1743|not allowed|not authori[sz]ed/i.test(r.err))
      return [502, "macOS has not allowed the dashboard to control Terminal (System Settings > Privacy & Security > Automation)"];
    return [502, `Terminal could not be controlled: ${r.err.slice(0, 200)}`];
  }
  if (r.out === "notab") return [422, "the session is not running in a Terminal tab"];
  return [200, null];
}

const fail = (status: number, error: string) => Response.json({ ok: false, error }, { status });

// Shared guard for the write routes (design/concepts/http-api.md). Returns the parsed body, or a refusal.
async function writeGuard(req: Request): Promise<any | Response> {
  if (!HOSTS.has(req.headers.get("host") ?? "") || !ORIGINS.has(req.headers.get("origin") ?? ""))
    return fail(403, "requests are only accepted from the dashboard page");
  if (!(req.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json"))
    return fail(415, "expected application/json");
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY) return fail(413, "request too large");
  const body = await req.text();
  if (body.length > MAX_BODY) return fail(413, "request too large");
  try {
    const parsed = JSON.parse(body);
    if (parsed && typeof parsed === "object") return parsed;
  } catch {}
  return fail(400, "expected a JSON object");
}

async function promptRoute(req: Request, id: string) {
  const body = await writeGuard(req);
  if (body instanceof Response) return body;
  if (typeof body.text !== "string") return fail(400, "expected {\"text\": \"...\"}");
  const [status, error] = await deliverPrompt(id, body.text);
  return error ? fail(status, error) : Response.json({ ok: true });
}

// ---- Session closing (design/concepts/session-closing.md) ----
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function closeSession(id: string, confirmed: boolean): Promise<[number, string | null, string?]> {
  const s = liveSession(id);
  if (!s) return [404, "no running session with that id"];
  if (!isSameProcess(s, procInfo([s.pid]).get(s.pid)))
    return [422, `process ${s.pid} is not this session's Claude Code process`];
  const tp = findTranscript(id);
  const label = attention(s.status, tp ? digest(tp) : { tickets: [] }, true);
  if (label !== "idle" && !confirmed)
    return [409, `confirmation needed: the session is ${label === "working" ? "working" : "waiting on you"}`];
  const tty = (await run(["ps", "-o", "tty=", "-p", String(s.pid)])).out;

  try { process.kill(s.pid, "SIGTERM"); } catch {}
  for (let i = 0; i < 50 && alive(s.pid); i++) await sleep(100);
  if (alive(s.pid)) {
    try { process.kill(s.pid, "SIGKILL"); } catch {}
    for (let i = 0; i < 20 && alive(s.pid); i++) await sleep(100);
  }
  if (alive(s.pid)) return [502, `process ${s.pid} did not stop`];

  if (!tty || tty.startsWith("?")) return [200, null, "the session had no Terminal window"];
  await sleep(300); // let Terminal notice the process has gone
  const r = await run(["osascript", join(import.meta.dir, "terminal.applescript"), "close", `/dev/${tty}`]);
  if (r.code !== 0) return [200, null, "the window was left open: Terminal could not be controlled"];
  if (r.out === "closed") return [200, null, "the window was closed"];
  if (r.out === "exited") return [200, null, "the shell was exited; the tab shares a window"];
  if (r.out.startsWith("busy:")) return [200, null, `the window was left open: still running ${r.out.slice(5)}`];
  return [200, null, "no Terminal window was found"];
}

async function closeRoute(req: Request, id: string) {
  const body = await writeGuard(req);
  if (body instanceof Response) return body;
  if (body.confirmed !== undefined && typeof body.confirmed !== "boolean") return fail(400, "confirmed must be true or false");
  const [status, error, windowResult] = await closeSession(id, body.confirmed === true);
  return error ? fail(status, error) : Response.json({ ok: true, window: windowResult });
}

// ---- Question answering (design/concepts/question-answering.md) ----
// Claude Code writes a question's tool call to the transcript only once it is answered, so an open
// question is read from the session's Terminal tab. Every write to the tab ends in a line feed, which
// the menu reads as Enter, so each step moves the highlight with arrow keys and lets that Enter act.
// The highlight and ticks are read from the screen before every step: pressing up from the first
// option wraps to "Chat about this" and declines the question, so the highlight cannot be reset blind.
const UP = "\x1b[A", DOWN = "\x1b[B";
const SCRIPT = join(import.meta.dir, "terminal.applescript");
const squash = (t: string) => t.replace(/\s+/g, " ").trim();
const moves = (from: number, to: number) => (to > from ? DOWN : UP).repeat(Math.abs(to - from));

type Tab = { title: string; done: boolean };
type MenuOption = { label: string; description?: string; ticked?: boolean };
type Menu =
  | { kind: "question"; tabs: Tab[]; question: string; multi: boolean; options: MenuOption[]; cursor: number }
  | { kind: "review"; tabs: Tab[]; answers: { question: string; answer: string }[]; unanswered: boolean; onSubmit: boolean };

const OPTION_LINE = /^(❯| ) (\d+)\. (?:\[(.)\] )?(.*)$/;

// Parses the question menu drawn at the bottom of a tab's text, or returns undefined.
function parseMenu(screen: string): Menu | undefined {
  const lines = screen.replace(/\s+$/, "").split("\n").map((l) => l.replace(/\s+$/, ""));
  let top = -1;
  for (let i = lines.length - 2; i >= Math.max(0, lines.length - 150); i--)
    if (/^─{20,}$/.test(lines[i]) && /^(←\s+)?\s*[☐☒] /.test(lines[i + 1])) { top = i; break; }
  if (top < 0) return;
  const tabs = [...lines[top + 1].matchAll(/([☐☒])\s+(.+?)(?=\s{2,}|\s*[☐☒✔→]|$)/g)]
    .map((m) => ({ title: m[2].trim(), done: m[1] === "☒" }));
  const body = lines.slice(top + 2);

  if (body.some((l) => /^Review your answers$/.test(l.trim()))) {
    if (!body.some((l) => l.startsWith("❯ "))) return;
    const answers: { question: string; answer: string }[] = [];
    for (const l of body) {
      const q = l.match(/^\s*● (.*)$/), a = l.match(/^\s*→ (.*)$/);
      if (q) answers.push({ question: q[1].trim(), answer: "" });
      else if (a && answers.length) answers[answers.length - 1].answer = a[1].trim();
    }
    return {
      kind: "review", tabs, answers,
      unanswered: body.some((l) => /questions are unanswered/.test(l)),
      onSubmit: body.some((l) => /^❯ 1\. Submit answers$/.test(l)),
    };
  }

  const footer = body.findIndex((l) => /^Enter to select/.test(l));
  if (footer < 0 || body.slice(footer + 1).some((l) => l.trim())) return; // the menu must be the last thing drawn
  const first = body.findIndex((l) => OPTION_LINE.test(l));
  if (first < 0 || first > footer) return;
  const question = squash(body.slice(0, first).join(" "));
  const options: MenuOption[] = [];
  let cursor = 0, afterType = false;
  for (const line of body.slice(first, footer)) {
    if (/^─{20,}$/.test(line)) break; // "Chat about this" sits below this rule
    const m = line.match(OPTION_LINE);
    if (m) {
      const k = Number(m[2]);
      if (/^Type something/.test(m[4])) { afterType = true; if (m[1] === "❯") cursor = k; continue; }
      if (afterType || k !== options.length + 1) return;
      options.push({ label: m[4], ...(m[3] !== undefined && { ticked: m[3] !== " " }) });
      if (m[1] === "❯") cursor = k;
    } else if (/^❯\s+(Next|Submit)$/.test(line)) cursor = options.length + 2;
    else if (!afterType && options.length && /^\s{4,}\S/.test(line)) {
      const o = options[options.length - 1];
      o.description = squash(`${o.description ?? ""} ${line}`);
    }
  }
  if (!question || !options.length || !cursor) return;
  return { kind: "question", tabs, question, multi: options.some((o) => o.ticked !== undefined), options, cursor };
}

async function ttyOf(pid: number) {
  const t = (await run(["ps", "-o", "tty=", "-p", String(pid)])).out;
  return t && !t.startsWith("?") ? `/dev/${t}` : undefined;
}

async function term(action: "screen" | "keys", tty: string, keys?: string) {
  const r = await run(["osascript", SCRIPT, action, tty, ...(keys === undefined ? [] : [keys])]);
  if (r.code !== 0) throw new Error(/-1743|not allowed|not authori[sz]ed/i.test(r.err)
    ? "macOS has not allowed the dashboard to control Terminal (System Settings > Privacy & Security > Automation)"
    : `Terminal could not be controlled: ${r.err.slice(0, 200)}`);
  if (r.out === "notab") throw new Error("the session is not running in a Terminal tab");
  return r.out;
}

// The open menu of a session waiting on input, read at most every two seconds per session.
const menuCache = new Map<number, { at: number; menu?: Menu }>();
async function menuFor(s: any): Promise<Menu | undefined> {
  if (s.status !== "waiting" || s.waitingFor !== "input needed") return;
  const hit = menuCache.get(s.pid);
  if (hit && Date.now() - hit.at < 2000) return hit.menu;
  let menu: Menu | undefined;
  try {
    const tty = await ttyOf(s.pid);
    if (tty) menu = parseMenu(await term("screen", tty));
  } catch {}
  menuCache.set(s.pid, { at: Date.now(), menu });
  return menu;
}

const cleanAnswerText = (t: string) => cleanPrompt(t).replace(/\s*\n\s*/g, " ");
const sameQuestion = (m: Menu | undefined, question: string, labels: string[]) =>
  m?.kind === "question" && m.question === squash(question) &&
  m.options.length === labels.length && m.options.every((o, i) => o.label === labels[i]);

type AnswerBody = { question?: string; labels?: string[]; choices?: number[]; text?: string; review?: string };

async function answerMenu(id: string, b: AnswerBody): Promise<[number, string | null, string?]> {
  const s = liveSession(id);
  if (!s) return [404, "no running session with that id"];
  if (s.status !== "waiting") return [409, "the session is no longer waiting on you"];
  const tty = await ttyOf(s.pid);
  if (!tty) return [422, "the session has no terminal"];
  menuCache.delete(s.pid);
  const settle = async (from: Menu): Promise<[number, string | null, string?]> => {
    for (let i = 0; i < 25; i++) {
      await sleep(200);
      const now = liveSession(id);
      if (!now || now.status !== "waiting") return [200, null, "answered"];
      const m = parseMenu(await term("screen", tty));
      if (from.kind === "review" ? m?.kind !== "review" : !sameQuestion(m, from.question, from.options.map((o) => o.label)))
        return [200, null, m?.kind === "review" ? "review" : m ? "next question" : "answered"];
    }
    return [502, "the keys were sent but the terminal still shows the same screen; check it there"];
  };

  try {
    const m = parseMenu(await term("screen", tty));
    if (b.review !== undefined) {
      if (b.review !== "submit") return [400, "review must be \"submit\""];
      if (m?.kind !== "review" || !m.onSubmit) return [409, "the terminal is not showing the review screen with \"Submit answers\" highlighted"];
      await term("keys", tty, "");
      return await settle(m);
    }
    if (typeof b.question !== "string" || !Array.isArray(b.labels) || !sameQuestion(m, b.question, b.labels))
      return [409, "the terminal is showing a different question; wait for the board to refresh and try again"];
    const q = m as Extract<Menu, { kind: "question" }>, n = q.options.length;
    const choices = b.choices ?? [], text = b.text === undefined ? undefined : cleanAnswerText(b.text);
    if (!choices.every((c) => Number.isInteger(c) && c >= 0 && c < n) || new Set(choices).size !== choices.length)
      return [400, "an option number is out of range"];
    if (text !== undefined && (!text || text.length > 1000)) return [400, "the typed answer must be 1 to 1,000 characters"];
    if (q.multi ? !choices.length || text !== undefined : choices.length + (text !== undefined ? 1 : 0) !== 1)
      return [400, q.multi ? "choose at least one option" : "choose exactly one option or type an answer"];

    if (!q.multi) {
      await term("keys", tty, moves(q.cursor, text !== undefined ? n + 1 : choices[0] + 1) + (text ?? ""));
      return await settle(q);
    }
    const want = new Set(choices.map((c) => c + 1));
    let cur: Menu | undefined = q;
    for (let k = 1; k <= n; k++) {
      if (cur.kind !== "question") break;
      if (!!cur.options[k - 1].ticked === want.has(k)) continue;
      await term("keys", tty, moves(cur.cursor, k));
      await sleep(400);
      cur = parseMenu(await term("screen", tty));
      if (!sameQuestion(cur, q.question, q.options.map((o) => o.label)) || !!(cur as typeof q).options[k - 1].ticked !== want.has(k))
        return [502, `option ${k} did not change as expected; check the terminal`];
    }
    await term("keys", tty, moves((cur as typeof q).cursor, n + 2));
    return await settle(q);
  } catch (e) {
    return [502, (e as Error).message];
  }
}

async function answerRoute(req: Request, id: string) {
  const b = await writeGuard(req);
  if (b instanceof Response) return b;
  const okArr = (v: unknown, t: string) => v === undefined || (Array.isArray(v) && v.every((x) => typeof x === t));
  if (!(b.review !== undefined || (typeof b.question === "string" && okArr(b.labels, "string") && b.labels &&
        okArr(b.choices, "number") && (b.text === undefined || typeof b.text === "string"))))
    return fail(400, "expected {\"question\", \"labels\", \"choices\" or \"text\"} or {\"review\": \"submit\"}");
  const [status, error, next] = await answerMenu(id, b);
  return error ? fail(status, error) : Response.json({ ok: true, next });
}

// ---- Session starting (design/concepts/session-starting.md) ----
// The directory, a session to resume (or none), and a permission mode, all already checked.
async function openSession(dir: string, args: string[]): Promise<[number, string | null, any?]> {
  const r = await run(["osascript", SCRIPT, "new", dir, ...args]);
  if (r.code !== 0) {
    if (/-1743|not allowed|not authori[sz]ed/i.test(r.err))
      return [502, "macOS has not allowed the dashboard to control Terminal (System Settings > Privacy & Security > Automation)"];
    return [502, `Terminal could not be controlled: ${r.err.slice(0, 200)}`];
  }
  if (r.out === "tab" || r.out === "tab:merged") return [200, null, { opened: "tab" }];
  if (r.out === "window") return [200, null, { opened: "window" }];
  const why = r.out.replace(/^window:notab:?/, "").trim();
  const denied = /-1719|-25211|1002|assistive|not allowed/i.test(why);
  return [200, null, { opened: "window", note: denied || !why
    ? "a tab could not be opened, so a window was; to open tabs, allow bun in System Settings > Privacy & Security > Accessibility"
    : `a tab could not be opened, so a window was: ${why.slice(0, 200)}` }];
}

const isDirectory = (p: string) => { try { return statSync(p).isDirectory(); } catch { return false; } };

async function startSession(raw: string, flags: string[]): Promise<[number, string | null, any?]> {
  if (!raw.trim() || raw.length > 1024 || /[\x00-\x1f\x7f-\x9f]/.test(raw))
    return [400, "the directory must be 1 to 1,024 characters with no control characters"];
  const dir = raw.trim().replace(/^~(?=\/|$)/, HOME);
  if (!dir.startsWith("/")) return [400, "the directory must be an absolute path"];
  if (!isDirectory(dir)) return [400, `${dir} is not a directory`];
  return openSession(dir, flags);
}

// Resumed in the directory its transcript records, and only when no process holds it.
async function resumeSession(id: string, flags: string[]): Promise<[number, string | null, any?]> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) return [404, "no session with that id"];
  const tp = findTranscript(id);
  if (!tp) return [404, "no session with that id"];
  if (liveSession(id)) return [409, "that session is already running"];
  const dir = transcriptCwd(tp);
  if (!dir) return [422, "the session's transcript does not record its directory"];
  if (!isDirectory(dir)) return [422, `the session's directory ${dir} no longer exists`];
  return openSession(dir, ["--resume", id, ...flags]);
}

async function newRoute(req: Request) {
  const body = await writeGuard(req);
  if (body instanceof Response) return body;
  const mode = body.mode ?? PERMISSION_MODE;
  if (typeof mode !== "string" || !Object.hasOwn(PERMISSION_FLAGS, mode))
    return fail(400, "mode must be \"skip\", \"auto\" or \"ask\"");
  const flags = PERMISSION_FLAGS[mode];
  let result: [number, string | null, any?];
  if (typeof body.resume === "string") result = await resumeSession(body.resume, flags);
  else if (typeof body.cwd === "string") result = await startSession(body.cwd, flags);
  else return fail(400, "expected {\"cwd\": \"<directory>\"} or {\"resume\": \"<session id>\"}");
  const [status, error, extra] = result;
  return error ? fail(status, error) : Response.json({ ok: true, mode, ...extra });
}

const page = readFileSync(join(import.meta.dir, "index.html"), "utf8");
const STARTED_AT = new Date().toISOString();
// Hash of the code and .env this process loaded. watchdog.sh compares it with the files on disk
// and restarts the service when they differ.
const envPath = join(import.meta.dir, ".env");
const CODE_HASH = createHash("sha256")
  .update(readFileSync(join(import.meta.dir, "server.ts")))
  .update(readFileSync(join(import.meta.dir, "index.html")))
  .update(existsSync(envPath) ? readFileSync(envPath) : "")
  .digest("hex");

Bun.serve({
  hostname: "127.0.0.1",
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/api/sessions/new" && req.method === "POST") return newRoute(req);
    const write = url.pathname.match(/^\/api\/sessions\/([0-9a-f-]{36})\/(prompt|close|answer)$/);
    if (write && req.method === "POST")
      return ({ prompt: promptRoute, close: closeRoute, answer: answerRoute } as const)[write[2] as "prompt"](req, write[1]);
    if (req.method !== "GET" && req.method !== "HEAD") return new Response("not found", { status: 404 });
    if (url.pathname === "/healthz")
      return Response.json({ ok: true, pid: process.pid, startedAt: STARTED_AT, codeHash: CODE_HASH });
    if (url.pathname === "/api/sessions") {
      const data = collect();
      // A session waiting on input gets the menu it is showing, read from its Terminal tab.
      const entries = liveEntries();
      await Promise.all(data.live.map(async (s: any) => {
        const raw = entries.find((e) => e.sessionId === s.sessionId);
        const menu = raw && await menuFor(raw);
        if (menu) s.menu = menu;
      }));
      return Response.json(data);
    }
    if (url.pathname === "/") return new Response(page, { headers: { "content-type": "text/html; charset=utf-8" } });
    return new Response("not found", { status: 404 });
  },
});
console.log(`session board on http://127.0.0.1:${PORT}`);
