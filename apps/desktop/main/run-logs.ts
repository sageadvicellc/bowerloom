/**
 * The reader of an engine's own session log, for the figures of one recorded run (beta.2). It answers numbers and short words only: when the log began and ended, how long that was, how many tokens
 * were counted, the model's name, and whether the log ends in a finished turn. It never returns, stores or logs a line of a chat, and it reads only what those figures need from each line.
 *
 * Where the logs are, and what a line holds, is NOT verified: this repository holds no vendor page and no real log that states them, only the names of the two folders that the folder reader skips
 * on purpose (shared/real/adapters.ts: `projects` in the Claude Code home, `sessions` in the Codex home). The reader is written to be tolerant of that. It looks for:
 *  - Claude Code: `<home>/.claude/projects/<folder name>/*.jsonl`, where the folder name is the project path with each character that is not a letter or a digit written as a dash. A line is a JSON
 *    object with an ISO `timestamp`, a `cwd`, and `message` holding `id`, `model`, `stop_reason` and `usage` (`input_tokens`, `output_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`).
 *  - Codex: `<home>/.codex/sessions/<year>/<month>/<day>/*.jsonl`. A line is a JSON object with an ISO `timestamp`, a `type` and a `payload`: `session_meta` (with `cwd`), `turn_context` (with `model`),
 *    and `event_msg` whose payload type is `token_count` (`info.total_token_usage`), `task_complete` or `turn_aborted`.
 * A log that does not have these shapes is not an error: a figure it does not hold is null, a log that no line can place in time is "unreadable", and no log is "not found". Never a zero for a figure
 * that is not there.
 *
 * Safety: only files under those two folders are opened; a link is never followed (not the folders, not the files); a file is opened without following a link and checked as a plain file after it is
 * open; a file over the size cap is "unreadable"; a line over the line cap is skipped; only the newest few hundred logs of a folder are looked at; `history.jsonl` is never read.
 */
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { NO_FIGURES } from '../shared/api/runs.js';
import type { RunFigures, RunOutcome } from '../shared/api/runs.js';

export interface FigureQuery { readonly engine: string; readonly projectDir: string; readonly startedAt: string }
export interface LogReaderDeps { readonly home: string; /** The most bytes a log may hold to be read. Default 64 MB. */ readonly maxBytes?: number }

/** A log is the one of a run when it began no more than this long before the recorded start, or this long after it. */
const BEFORE_MS = 10 * 60_000, AFTER_MS = 60 * 60_000;
const DEFAULT_MAX_BYTES = 64 * 1024 * 1024;
const LINE_MAX = 1_000_000;
const HEAD_LINES = 50, HEAD_BYTES = 4 * 1024 * 1024;
const CANDIDATES = 300;
const TOKEN_MAX = 1e12;
const MODEL = /^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,79}$/;

/** Claude Code's folder name for a project: every character that is not a letter or a digit is a dash. */
export const claudeFolderName = (projectDir: string): string => projectDir.replace(/[^A-Za-z0-9]/g, '-');

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const tokens = (v: unknown): number | null => (typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 && v <= TOKEN_MAX ? v : null);
const modelOf = (v: unknown): string | null => (typeof v === 'string' && MODEL.test(v) ? v : null);
const timeOf = (v: unknown): number | null => {
  if (typeof v !== 'string' || v.length > 40 || !/^\d{4}-\d{2}-\d{2}T/.test(v)) return null;
  const ms = Date.parse(v);
  return Number.isFinite(ms) ? ms : null;
};

/** A plain folder of ours: not a link, and a folder. */
function isFolder(path: string): boolean { try { const s = lstatSync(path); return !s.isSymbolicLink() && s.isDirectory(); } catch { return false; } }

/** Reads a file line by line without following a link. A line over the cap is skipped. Stops when `onLine` says false, or after `limit` bytes. Throws when the file cannot be opened or is not a plain file. */
function scanLines(file: string, limit: number, onLine: (line: string) => boolean): void {
  const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    if (!fstatSync(fd).isFile()) throw new Error('not a plain file');
    const chunk = Buffer.allocUnsafe(64 * 1024);
    let pending: Buffer[] = [], pendingBytes = 0, skipping = false, total = 0;
    for (;;) {
      const n = readSync(fd, chunk, 0, chunk.length, null);
      if (n === 0) break;
      total += n;
      let from = 0;
      while (from < n) {
        const nl = chunk.indexOf(0x0a, from);
        const end = nl === -1 || nl >= n ? n : nl;
        if (!skipping) {
          const part = chunk.subarray(from, end);
          if (pendingBytes + part.length > LINE_MAX) { skipping = true; pending = []; pendingBytes = 0; } else { pending.push(Buffer.from(part)); pendingBytes += part.length; }
        }
        if (end < n) {
          if (!skipping && pendingBytes > 0 && !onLine(Buffer.concat(pending).toString('utf8'))) return;
          pending = []; pendingBytes = 0; skipping = false; from = end + 1;
        } else from = n;
      }
      if (total > limit) return;
    }
    if (!skipping && pendingBytes > 0) onLine(Buffer.concat(pending).toString('utf8'));
  } finally { closeSync(fd); }
}

const parseLine = (line: string): Json | null => { try { const v: unknown = JSON.parse(line); return isObject(v) ? v : null; } catch { return null; } };

interface Candidate { readonly path: string; readonly mtimeMs: number }
/** The .jsonl files of a folder, newest first, at most CANDIDATES of them. A link, a non-file and `history.jsonl` are left out. */
function logsIn(dir: string, prefix: string | null): Candidate[] {
  let names: string[];
  try { names = readdirSync(dir); } catch { return []; }
  const out: Candidate[] = [];
  for (const name of names) {
    if (!name.endsWith('.jsonl') || name === 'history.jsonl' || (prefix !== null && !name.startsWith(prefix))) continue;
    const path = join(dir, name);
    try { const s = lstatSync(path); if (s.isFile() && !s.isSymbolicLink()) out.push({ path, mtimeMs: s.mtimeMs }); } catch { /* gone */ }
  }
  return out.sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, CANDIDATES);
}

const codexDays = (startMs: number): string[] => [-1, 0, 1].map(d => { const t = new Date(startMs + d * 86_400_000); return `${t.getUTCFullYear()}/${String(t.getUTCMonth() + 1).padStart(2, '0')}/${String(t.getUTCDate()).padStart(2, '0')}`; });

/** The cwd and the message, whatever the vendor's wrapper: the object itself for Claude Code, its `payload` for Codex. */
const cwdOf = (o: Json): string | null => (typeof o.cwd === 'string' ? o.cwd : isObject(o.payload) && typeof o.payload.cwd === 'string' ? o.payload.cwd : null);
const sameDir = (a: string, b: string): boolean => a.replace(/\/+$/, '') === b.replace(/\/+$/, '');

/** The first time and the folder a log names, from its first lines. `readable` is false when the file could not be opened. */
function head(path: string): { readable: boolean; firstMs: number | null; cwd: string | null } {
  let firstMs: number | null = null, cwd: string | null = null, seen = 0;
  try {
    scanLines(path, HEAD_BYTES, line => {
      const o = parseLine(line);
      if (o !== null) { firstMs ??= timeOf(o.timestamp); cwd ??= cwdOf(o); }
      seen += 1;
      return seen < HEAD_LINES && !(firstMs !== null && cwd !== null);
    });
  } catch { return { readable: false, firstMs: null, cwd: null }; }
  return { readable: true, firstMs, cwd };
}

interface Tally {
  firstMs: number | null; lastMs: number | null; model: string | null; outcome: RunOutcome;
  /** Claude Code: the usage of each message, the last line of an id winning. */
  byMessage: Map<string, { input: number | null; output: number | null }>; anon: number;
  /** Codex: the latest totals. */
  totalIn: number | null; totalOut: number | null;
}

function take(t: Tally, o: Json): void {
  const ms = timeOf(o.timestamp);
  if (ms !== null) { t.firstMs = t.firstMs === null ? ms : Math.min(t.firstMs, ms); t.lastMs = t.lastMs === null ? ms : Math.max(t.lastMs, ms); }
  // Claude Code: `message` holds the model, the usage and the stop reason.
  if (isObject(o.message)) {
    const m = o.message;
    const model = modelOf(m.model); if (model !== null) t.model = model;
    if (isObject(m.usage)) {
      const parts = [tokens(m.usage.input_tokens), tokens(m.usage.cache_creation_input_tokens), tokens(m.usage.cache_read_input_tokens)].filter((n): n is number => n !== null);
      const input = parts.length === 0 ? null : parts.reduce((a, b) => a + b, 0), output = tokens(m.usage.output_tokens);
      if (input !== null || output !== null) t.byMessage.set(typeof m.id === 'string' && m.id.length <= 200 ? m.id : `anon-${t.anon++}`, { input, output });
    }
    if (typeof m.stop_reason === 'string') t.outcome = m.stop_reason === 'end_turn' ? 'finished' : m.stop_reason === 'max_tokens' || m.stop_reason === 'refusal' ? 'stopped' : 'unknown';
  }
  // Codex: `payload` holds the model and the events.
  if (isObject(o.payload)) {
    const p = o.payload;
    if (o.type === 'turn_context') { const model = modelOf(p.model); if (model !== null) t.model = model; }
    if (o.type === 'event_msg') {
      if (p.type === 'token_count' && isObject(p.info) && isObject(p.info.total_token_usage)) {
        const u = p.info.total_token_usage, i = tokens(u.input_tokens), out = tokens(u.output_tokens);
        if (i !== null) t.totalIn = i; if (out !== null) t.totalOut = out;
      }
      if (p.type === 'task_complete') t.outcome = 'finished'; else if (p.type === 'turn_aborted') t.outcome = 'stopped';
    }
  }
}

function figuresOf(path: string, maxBytes: number): RunFigures {
  try {
    const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try { const s = fstatSync(fd); if (!s.isFile() || s.size > maxBytes) return NO_FIGURES('unreadable'); } finally { closeSync(fd); }
    const t: Tally = { firstMs: null, lastMs: null, model: null, outcome: 'unknown', byMessage: new Map(), anon: 0, totalIn: null, totalOut: null };
    scanLines(path, Number.MAX_SAFE_INTEGER, line => { const o = parseLine(line); if (o !== null) take(t, o); return true; });
    const sum = (pick: (v: { input: number | null; output: number | null }) => number | null): number | null => {
      const values = [...t.byMessage.values()].map(pick).filter((n): n is number => n !== null);
      return values.length === 0 ? null : values.reduce((a, b) => a + b, 0);
    };
    const inputTokens = t.totalIn ?? sum(v => v.input), outputTokens = t.totalOut ?? sum(v => v.output);
    const duration = t.firstMs !== null && t.lastMs !== null && t.lastMs >= t.firstMs ? t.lastMs - t.firstMs : null;
    return Object.freeze({
      state: 'found' as const, startedAt: t.firstMs === null ? null : new Date(t.firstMs).toISOString(), endedAt: t.lastMs === null ? null : new Date(t.lastMs).toISOString(),
      durationMs: duration, inputTokens, outputTokens, model: t.model, outcome: t.outcome,
    });
  } catch { return NO_FIGURES('unreadable'); }
}

/**
 * The figures of one run, read from the engine's own session log. Never throws. `not-available` for an engine with no reader here; `not-found` for no log, no folder or an argument that is not usable;
 * `unreadable` for a log that was there and could not be read; `found` with each figure the log held and null for each it did not.
 */
export async function readFigures(deps: LogReaderDeps, query: FigureQuery): Promise<RunFigures> {
  try {
    if (query.engine !== 'claude-code' && query.engine !== 'codex') return NO_FIGURES('not-available');
    const startMs = typeof query.startedAt === 'string' ? Date.parse(query.startedAt) : NaN;
    const ok = (p: unknown): p is string => typeof p === 'string' && p.startsWith('/') && !p.includes('\u0000') && p.length <= 2048;
    if (!Number.isFinite(startMs) || !ok(query.projectDir) || !ok(deps.home)) return NO_FIGURES('not-found');
    const maxBytes = deps.maxBytes ?? DEFAULT_MAX_BYTES;
    let found: Candidate[];
    if (query.engine === 'claude-code') {
      const claude = join(deps.home, '.claude'), projects = join(claude, 'projects'), folder = join(projects, claudeFolderName(query.projectDir));
      if (!isFolder(claude) || !isFolder(projects) || !isFolder(folder)) return NO_FIGURES('not-found');
      found = logsIn(folder, null);
    } else {
      const codex = join(deps.home, '.codex'), sessions = join(codex, 'sessions');
      if (!isFolder(codex) || !isFolder(sessions)) return NO_FIGURES('not-found');
      found = [];
      let at = sessions;
      for (const day of codexDays(startMs)) {
        const [y, m, d] = day.split('/') as [string, string, string];
        at = join(sessions, y);
        if (!isFolder(at)) continue;
        at = join(at, m);
        if (!isFolder(at)) continue;
        at = join(at, d);
        if (isFolder(at)) found.push(...logsIn(at, null));
      }
    }
    let best: { path: string; gap: number; firstMs: number } | null = null, unplaced = 0;
    for (const c of found) {
      const h = head(c.path);
      if (!h.readable || h.firstMs === null) { unplaced += 1; continue; }
      const gap = Math.abs(h.firstMs - startMs);
      if (h.firstMs < startMs - BEFORE_MS || h.firstMs > startMs + AFTER_MS) continue;
      if (h.cwd !== null && !sameDir(h.cwd, query.projectDir)) continue;
      if (best === null || gap < best.gap || (gap === best.gap && h.firstMs < best.firstMs)) best = { path: c.path, gap, firstMs: h.firstMs };
    }
    if (best !== null) return figuresOf(best.path, maxBytes);
    return NO_FIGURES(unplaced > 0 ? 'unreadable' : 'not-found');
  } catch { return NO_FIGURES('unreadable'); }
}
