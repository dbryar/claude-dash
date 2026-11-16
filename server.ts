// Session board: a read-only, localhost-only dashboard over Claude Code CLI sessions.
// Sources (all local, nothing leaves the machine):
//   ~/.claude/sessions/<pid>.json          live session registry (name, cwd, status)
//   ~/.claude/projects/*/<sessionId>.jsonl transcripts (ai-title, away_summary, last-prompt, cost-state)
// Runs as the LaunchAgent local.session-board (install.sh); open http://127.0.0.1:7377

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
  for (const f of readdirSync(SESSIONS).filter((f) => f.endsWith(".json"))) {
    let s: any;
    try { s = JSON.parse(readFileSync(join(SESSIONS, f), "utf8")); } catch { continue; }
    if (!alive(s.pid)) continue;
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
    if (url.pathname === "/healthz")
      return Response.json({ ok: true, pid: process.pid, startedAt: STARTED_AT, codeHash: CODE_HASH });
    if (url.pathname === "/api/sessions") return Response.json(collect());
    if (url.pathname === "/") return new Response(page, { headers: { "content-type": "text/html; charset=utf-8" } });
    return new Response("not found", { status: 404 });
  },
});
console.log(`session board on http://127.0.0.1:${PORT}`);
