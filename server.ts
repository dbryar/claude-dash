// Session board: a read-only, localhost-only dashboard over Claude Code CLI sessions.
// Sources (all local, nothing leaves the machine):
//   ~/.claude/sessions/<pid>.json          live session registry (name, cwd, status)
//   ~/.claude/projects/*/<sessionId>.jsonl transcripts (ai-title, away_summary, last-prompt, cost-state)
// Runs as the LaunchAgent local.session-board (install.sh); open http://127.0.0.1:7377
// Two write routes only accept requests from this page: POST /api/sessions/<id>/prompt types a
// reply into a session's Terminal tab (design/concepts/prompt-delivery.md), and
// POST /api/sessions/<id>/close stops a session and closes its window (design/concepts/session-closing.md).

import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, basename } from "node:path";
import { homedir } from "node:os";
import { createHash } from "node:crypto";

const HOME = homedir();
const SESSIONS = join(HOME, ".claude", "sessions");
const PROJECTS = join(HOME, ".claude", "projects");
const PORT = Number(process.env.SESSION_BOARD_PORT ?? 7377);
const RECENT_DAYS = Number(process.env.SESSION_BOARD_RECENT_DAYS ?? 7);
// Ticket keys to pick out of prompts and titles. TICKET_PREFIXES comes from .env
// (see .env.example). Unset, any Jira-style key (ABC-123) matches.
const PREFIXES = (process.env.TICKET_PREFIXES ?? "")
  .split(",").map((p) => p.trim()).filter((p) => /^[A-Za-z][A-Za-z0-9]*$/.test(p));
const TICKET_RE = PREFIXES.length
  ? new RegExp(`\\b(?:${PREFIXES.join("|")})-?\\d{2,}\\b`, "g")
  : /\b[A-Z][A-Z0-9]{1,9}-\d+\b/g;

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
          for (const m of t.match(TICKET_RE) ?? []) { tickets.delete(m); tickets.add(m); }
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
  if (d.title) for (const m of d.title.match(TICKET_RE) ?? []) { tickets.delete(m); tickets.add(m); }
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

function alive(pid: number) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

// Commands of the given pids, by pid, from one ps call (design/concepts/session-discovery.md).
// A pid ps says nothing about is absent from the map.
function commands(pids: number[]): Map<number, string> {
  const out = new Map<number, string>();
  if (!pids.length) return out;
  const r = Bun.spawnSync(["ps", "-o", "pid=,comm=", "-p", pids.join(",")]);
  for (const line of r.stdout.toString().split("\n")) {
    const m = line.trim().match(/^(\d+)\s+(\S.*)$/);
    if (m) out.set(Number(m[1]), basename(m[2].trim()));
  }
  return out;
}

// Signal 0 only proves that some process the user may signal holds the pid. A registry file
// left by a session that did not exit cleanly keeps its pid, the system reuses it, and the
// dead session reads as live: an entry from September was found holding a pid belonging to
// Terminal.app. The command must therefore be claude. A pid ps names nothing for is kept,
// so an unexpected ps result shows a session that may be dead rather than hiding a live one.
const isClaude = (pid: number, cmds: Map<number, string>) => {
  const c = cmds.get(pid);
  return c === undefined || c === "claude";
};

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
  const cmds = commands(running.map((s) => s.pid));
  const newest = new Map<string, any>();
  for (const s of running) {
    if (!isClaude(s.pid, cmds)) continue;
    const prev = newest.get(s.sessionId);
    if (!prev || (s.startedAt ?? 0) > (prev.startedAt ?? 0)) newest.set(s.sessionId, s);
  }
  return [...newest.values()];
}

function attention(status: string, d: Digest, live: boolean): string {
  if (!live) return "closed";
  if (status === "busy" && d.pendingTool) return "working"; // the registry only records idle/busy, so a permission prompt also reads as busy
  if (status === "busy") return "working";
  const tail = (d.lastAssistant ?? "").trim();
  if (/\?\s*$/.test(tail) || /\?\s*\S{0,3}$/.test(tail.slice(-40))) return "asked you";
  return "idle";
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
      attention: attention(s.status, d as Digest, true), ...d,
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
      let cwd = "";
      try { cwd = JSON.parse(readFileSync(p, "utf8").split("\n").find((l) => l.includes('"cwd"')) ?? "{}").cwd ?? ""; } catch {}
      closed.push({
        live: false, sessionId: id, cwd, repo: cwd ? basename(cwd) : dir,
        attention: "closed", lastAt: d.lastAt ?? new Date(st.mtimeMs).toISOString(), ...d,
      });
    }
  }
  closed.sort((a, b) => (b.lastAt ?? "").localeCompare(a.lastAt ?? ""));
  return { generatedAt: new Date().toISOString(), live, closed };
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
  const comm = (await run(["ps", "-o", "comm=", "-p", String(s.pid)])).out;
  if (basename(comm) !== "claude") return [422, `process ${s.pid} is not a Claude Code process`];
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
  fetch(req) {
    const url = new URL(req.url);
    const write = url.pathname.match(/^\/api\/sessions\/([0-9a-f-]{36})\/(prompt|close)$/);
    if (write && req.method === "POST") return write[2] === "prompt" ? promptRoute(req, write[1]) : closeRoute(req, write[1]);
    if (req.method !== "GET" && req.method !== "HEAD") return new Response("not found", { status: 404 });
    if (url.pathname === "/healthz")
      return Response.json({ ok: true, pid: process.pid, startedAt: STARTED_AT, codeHash: CODE_HASH });
    if (url.pathname === "/api/sessions") return Response.json(collect());
    if (url.pathname === "/") return new Response(page, { headers: { "content-type": "text/html; charset=utf-8" } });
    return new Response("not found", { status: 404 });
  },
});
console.log(`session board on http://127.0.0.1:${PORT}`);
