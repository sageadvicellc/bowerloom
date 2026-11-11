/**
 * The reader of an engine's own session log, for the figures of one recorded run (beta.2). It answers numbers and short words only: when the log began and ended, how long that was, how many input and
 * output counts were found, the model's name, and whether the log ends in a finished turn. It never returns, stores or logs a line of a chat, and it reads only what those figures need from each line.
 *
 * What was observed, on 2026-11-11, on one computer (key names only, no text):
 *  - Claude Code: `<config home>/projects/<project path with "/" and " " written as "-">/<session id>.jsonl`. A line is a JSON object with `timestamp` (ISO), `cwd`, and, for an assistant line, `message` holding
 *    `id`, `model`, `stop_reason` and `usage` (`input_tokens`, `output_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`). The same message id can repeat across lines, so the counts are kept once for each id.
 *  - Codex: `<codex home>/sessions/YYYY/MM/DD/rollout-<time>-<id>.jsonl`. A line is a JSON object with `timestamp`, `type` and `payload`. `session_meta` holds `cwd`, `turn_context` holds `model`, and an `event_msg`
 *    payload of type `token_count` holds `info.total_token_usage` (cumulative: the last one counts, they are not added), `task_complete` or `turn_aborted`.
 * Still NOT verified: how Claude Code writes a folder name that holds non-ASCII characters or is very long (here every character that is not a letter or a digit becomes a dash, which matches what was observed for
 * "/" and " " only), and which time zone the Codex day folders use (the reader looks one day either side of the start, so either is found). A log that does not have these shapes is not an error: a figure it
 * does not hold is null, and each reason a run has no figures has its own state and words. Never a zero for a figure that is not there, and never a count that may be short: a log with a line that could not be read
 * has no counts.
 *
 * Matching: a log belongs to a run when it names the run's folder (Codex needs the folder named; Claude Code's folder name already says it) and began within an hour of the recorded start. Each log is given to at
 * most one run: the runs of one engine in one project are matched together, the smallest gap first. A run with no log of its own has no figures. When another log in the folder also fits, the run says so (`ambiguous`)
 * and reads none, because a wrong log is worse than none.
 *
 * Safety: only files under the two engine homes are opened; each home is resolved to its real place once (`CLAUDE_CONFIG_DIR`, `CODEX_HOME` and the home folder may be links), and below it a link is never followed;
 * a file is opened without following a link and checked as a plain file after it is open; a file over the size cap is "too large"; a line over the line cap is skipped and counted; only the newest few hundred logs
 * of a folder that are new enough are looked at; `history.jsonl` is never read. All reads are asynchronous, so the main process is never held.
 */
import { constants } from 'node:fs';
import { lstat, open, readdir, realpath } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { join } from 'node:path';
import { LOG_CANDIDATE_CAP, LOG_WINDOW_MINUTES, NO_FIGURES } from '../shared/api/runs.js';
import type { FiguresReason, RunFigures, RunOutcome } from '../shared/api/runs.js';

export interface FigureQuery {
  readonly engine: string; readonly projectDir: string; readonly startedAt: string;
  /** The other runs of the same engine in the same project (their start times), so each log is given to one run only. */
  readonly siblings?: readonly { readonly startedAt: string }[];
}
export interface LogReaderDeps {
  readonly home: string;
  /** `CLAUDE_CONFIG_DIR` and `CODEX_HOME`, when set. Only an absolute path is used. */
  readonly env?: { readonly CLAUDE_CONFIG_DIR?: string | undefined; readonly CODEX_HOME?: string | undefined };
  /** The most bytes a log may hold to be read. Default 64 MB. */
  readonly maxBytes?: number;
  /** For a test: the call that opens a file. */
  readonly openFile?: typeof open;
}

const WINDOW_MS = LOG_WINDOW_MINUTES * 60_000;
const DEFAULT_MAX_BYTES = 64 * 1024 * 1024;
const LINE_MAX = 1_000_000;
const HEAD_LINES = 50, HEAD_BUDGET = 64 * 1024, HEAD_HARD_CAP = 4 * 1024 * 1024;
const TOKEN_MAX = 1e12;
const MAX_MESSAGES = 100_000;
const MODEL = /^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,79}$/;

/** Claude Code's folder name for a project: every character that is not a letter or a digit is a dash. */
export const claudeFolderName = (projectDir: string): string => projectDir.normalize('NFC').replace(/[^A-Za-z0-9]/g, '-');

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const tokens = (v: unknown): number | null => (typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 && v <= TOKEN_MAX ? v : null);
const modelOf = (v: unknown): string | null => (typeof v === 'string' && MODEL.test(v) ? v : null);
const timeOf = (v: unknown): number | null => {
  if (typeof v !== 'string' || v.length > 40 || !/^\d{4}-\d{2}-\d{2}T/.test(v)) return null;
  const ms = Date.parse(v);
  return Number.isFinite(ms) ? ms : null;
};
const codeOf = (e: unknown): string => String((e as { code?: unknown } | null)?.code ?? '');
const noPermission = (e: unknown): boolean => codeOf(e) === 'EACCES' || codeOf(e) === 'EPERM';

const real = async (path: string): Promise<string | null> => { try { return await realpath(path); } catch { return null; } };
/** A plain folder of ours: not a link, and a folder. */
async function isFolder(path: string): Promise<boolean> { try { const s = await lstat(path); return !s.isSymbolicLink() && s.isDirectory(); } catch { return false; } }

/** Opens a file without following a link, and checks it is a plain file once it is open. */
async function openPlain(path: string, opener: typeof open = open): Promise<FileHandle> {
  const fh = await opener(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try { if (!(await fh.stat()).isFile()) throw new Error('not a plain file'); } catch (error) { await fh.close(); throw error; }
  return fh;
}

interface ScanEnd { readonly truncated: boolean; readonly overlong: number }
/** Reads an open file line by line. A line over the cap is skipped and counted. Stops when `onLine` says false, or after `limit` bytes (then `truncated` is true). */
async function scanLines(fh: FileHandle, limit: number, onLine: (line: string) => boolean): Promise<ScanEnd> {
  const chunk = Buffer.allocUnsafe(64 * 1024);
  let pending: Buffer[] = [], pendingBytes = 0, skipping = false, total = 0, overlong = 0;
  for (;;) {
    const { bytesRead: n } = await fh.read(chunk, 0, chunk.length, null);
    if (n === 0) break;
    total += n;
    let from = 0;
    while (from < n) {
      const nl = chunk.indexOf(0x0a, from);
      const end = nl === -1 || nl >= n ? n : nl;
      if (!skipping) {
        const part = chunk.subarray(from, end);
        if (pendingBytes + part.length > LINE_MAX) { skipping = true; overlong += 1; pending = []; pendingBytes = 0; } else { pending.push(Buffer.from(part)); pendingBytes += part.length; }
      }
      if (end < n) {
        if (!skipping && pendingBytes > 0 && !onLine(Buffer.concat(pending).toString('utf8'))) return { truncated: false, overlong };
        pending = []; pendingBytes = 0; skipping = false; from = end + 1;
      } else from = n;
    }
    if (total > limit) return { truncated: true, overlong };
  }
  if (!skipping && pendingBytes > 0) onLine(Buffer.concat(pending).toString('utf8'));
  return { truncated: false, overlong };
}

const parseLine = (line: string): Json | null => { try { const v: unknown = JSON.parse(line); return isObject(v) ? v : null; } catch { return null; } };

interface Candidate { readonly path: string; readonly mtimeMs: number }
/** The .jsonl files of a folder. A link, a non-file and `history.jsonl` are left out. */
async function logsIn(dir: string): Promise<Candidate[]> {
  let names: string[];
  try { names = await readdir(dir); } catch { return []; }
  const out: Candidate[] = [];
  for (const name of names) {
    if (!name.endsWith('.jsonl') || name === 'history.jsonl') continue;
    const path = join(dir, name);
    try { const s = await lstat(path); if (s.isFile() && !s.isSymbolicLink()) out.push({ path, mtimeMs: s.mtimeMs }); } catch { /* gone */ }
  }
  return out;
}

const codexDays = (startMs: number): string[] => [-1, 0, 1].map(d => { const t = new Date(startMs + d * 86_400_000); return `${t.getUTCFullYear()}/${String(t.getUTCMonth() + 1).padStart(2, '0')}/${String(t.getUTCDate()).padStart(2, '0')}`; });

const cwdOf = (o: Json): string | null => (typeof o.cwd === 'string' ? o.cwd : isObject(o.payload) && typeof o.payload.cwd === 'string' ? o.payload.cwd : null);
const trimSlash = (p: string): string => p.normalize('NFC').replace(/\/+$/, '');

type Head = { readonly kind: 'placed'; readonly firstMs: number } | { readonly kind: 'other-folder' } | { readonly kind: 'unplaced' } | { readonly kind: 'no-permission' };

/** The first time and the folder a log names, from its first lines. */
async function head(path: string, project: string, engine: string, opener: typeof open): Promise<Head> {
  let firstMs: number | null = null, cwd: string | null = null, seen = 0, kept = 0;
  let fh: FileHandle | null = null;
  try {
    fh = await openPlain(path, opener);
    await scanLines(fh, HEAD_HARD_CAP, line => {
      const o = parseLine(line);
      if (o !== null) { firstMs ??= timeOf(o.timestamp); cwd ??= cwdOf(o); }
      seen += 1; kept += line.length;
      return seen < HEAD_LINES && kept < HEAD_BUDGET && !(firstMs !== null && cwd !== null);
    });
  } catch (error) { return noPermission(error) ? { kind: 'no-permission' } : { kind: 'unplaced' }; } finally { await fh?.close().catch(() => undefined); }
  if (firstMs === null) return { kind: 'unplaced' };
  if (cwd === null) return engine === 'codex' ? { kind: 'other-folder' } : { kind: 'placed', firstMs };
  if (trimSlash(cwd) === project) return { kind: 'placed', firstMs };
  // The same folder written another way (a link, or a case the disk ignores): the real paths are compared.
  const r = await real(cwd);
  return r !== null && trimSlash(r) === project ? { kind: 'placed', firstMs } : { kind: 'other-folder' };
}

interface Tally {
  firstMs: number | null; lastMs: number | null; model: string | null; outcome: RunOutcome; lastStop: string | null;
  /** Claude Code: the known counts of each message id: input, cache creation, cache read, output. The most complete value of each field is kept. */
  byMessage: Map<string, [number | null, number | null, number | null, number | null]>; tokenBroken: boolean; bad: number;
  /** Codex: the latest totals. */
  totalIn: number | null; totalOut: number | null; sawEvent: boolean;
}

const maxKnown = (a: number | null, b: number | null): number | null => (a === null ? b : b === null ? a : Math.max(a, b));

function take(t: Tally, o: Json): void {
  const ms = timeOf(o.timestamp);
  if (ms !== null) { t.firstMs = t.firstMs === null ? ms : Math.min(t.firstMs, ms); t.lastMs = t.lastMs === null ? ms : Math.max(t.lastMs, ms); }
  if (isObject(o.message)) {
    const m = o.message;
    const model = modelOf(m.model); if (model !== null) t.model = model;
    if (isObject(m.usage)) {
      const u = m.usage;
      const fields: [number | null, number | null, number | null, number | null] = [tokens(u.input_tokens), tokens(u.cache_creation_input_tokens), tokens(u.cache_read_input_tokens), tokens(u.output_tokens)];
      if (typeof m.id !== 'string' || m.id === '' || m.id.length > 200) t.tokenBroken = true;
      else {
        const old = t.byMessage.get(m.id);
        if (old === undefined && t.byMessage.size >= MAX_MESSAGES) t.tokenBroken = true;
        else t.byMessage.set(m.id, old === undefined ? fields : [maxKnown(old[0], fields[0]), maxKnown(old[1], fields[1]), maxKnown(old[2], fields[2]), maxKnown(old[3], fields[3])]);
      }
    }
    if (typeof m.stop_reason === 'string') { t.lastStop = m.stop_reason; t.outcome = m.stop_reason === 'end_turn' ? 'finished' : m.stop_reason === 'max_tokens' || m.stop_reason === 'refusal' ? 'stopped' : 'unknown'; }
  }
  if (isObject(o.payload)) {
    const p = o.payload;
    t.sawEvent = true;
    if (o.type === 'turn_context') { const model = modelOf(p.model); if (model !== null) t.model = model; }
    if (o.type === 'event_msg') {
      if (p.type === 'token_count' && isObject(p.info) && isObject(p.info.total_token_usage)) {
        const u = p.info.total_token_usage;
        t.totalIn = tokens(u.input_tokens); t.totalOut = tokens(u.output_tokens);
      }
      if (p.type === 'task_complete') t.outcome = 'finished'; else if (p.type === 'turn_aborted') t.outcome = 'stopped';
    }
  }
}

/** The sum of one count over every message, or null when there is no message or any message lacks a part of it. */
function summed(t: Tally, parts: readonly number[]): number | null {
  if (t.byMessage.size === 0) return null;
  let sum = 0;
  for (const m of t.byMessage.values()) {
    for (const at of parts) { const v = m[at]; if (v === null || v === undefined) return null; sum += v; }
  }
  return sum;
}

async function figuresOf(path: string, engine: string, maxBytes: number, opener: typeof open): Promise<RunFigures> {
  let fh: FileHandle | null = null;
  try {
    fh = await openPlain(path, opener);
    // The size is checked on the open file, and the same file is read, with the same cap, so a file that grows is never read past it.
    if ((await fh.stat()).size > maxBytes) return NO_FIGURES('unreadable', 'too-large');
    const t: Tally = { firstMs: null, lastMs: null, model: null, outcome: 'unknown', lastStop: null, byMessage: new Map(), tokenBroken: false, bad: 0, totalIn: null, totalOut: null, sawEvent: false };
    const end = await scanLines(fh, maxBytes, line => {
      if (line.trim() === '') return true;
      const o = parseLine(line);
      if (o === null) t.bad += 1; else take(t, o);
      return true;
    });
    if (end.truncated) return NO_FIGURES('unreadable', 'too-large');
    t.bad += end.overlong;
    // A line that was skipped could have held counts, so no count is shown: a total that may be short is worse than none.
    const countsOk = !t.tokenBroken && t.bad === 0;
    const inputTokens = !countsOk ? null : engine === 'codex' ? t.totalIn : summed(t, [0, 1, 2]);
    const outputTokens = !countsOk ? null : engine === 'codex' ? t.totalOut : summed(t, [3]);
    const duration = t.firstMs !== null && t.lastMs !== null && t.lastMs > t.firstMs ? t.lastMs - t.firstMs : null;
    let reason: FiguresReason | null = null;
    if (t.bad > 0) reason = 'partial';
    else if (engine === 'codex' ? t.outcome === 'unknown' && t.sawEvent : t.lastStop === 'tool_use') reason = 'still-writing';
    else if (inputTokens === null && outputTokens === null && t.model === null && duration === null) reason = 'no-figures';
    return Object.freeze({
      state: 'found' as const, reason, startedAt: t.firstMs === null ? null : new Date(t.firstMs).toISOString(), endedAt: t.lastMs === null || t.lastMs === t.firstMs ? null : new Date(t.lastMs).toISOString(),
      durationMs: duration, inputTokens, outputTokens, model: t.model, outcome: t.outcome,
    });
  } catch (error) { return noPermission(error) ? NO_FIGURES('unreadable', 'no-permission') : NO_FIGURES('unreadable'); } finally { await fh?.close().catch(() => undefined); }
}

/**
 * The figures of one run, read from the engine's own session log. Never throws. `not-available` for an engine with no reader here; `not-found` for no log, no folder or an argument that is not usable;
 * `unreadable` for a log that was there and could not be read; `ambiguous` when more than one log fits; `found` with each figure the log held and null for each it did not.
 */
export async function readFigures(deps: LogReaderDeps, query: FigureQuery): Promise<RunFigures> {
  try {
    if (query.engine !== 'claude-code' && query.engine !== 'codex') return NO_FIGURES('not-available');
    const startMs = typeof query.startedAt === 'string' ? Date.parse(query.startedAt) : NaN;
    const ok = (p: unknown): p is string => typeof p === 'string' && p.startsWith('/') && !p.includes('\u0000') && p.length <= 2048;
    if (!Number.isFinite(startMs) || !ok(query.projectDir) || !ok(deps.home)) return NO_FIGURES('not-found');
    const maxBytes = deps.maxBytes ?? DEFAULT_MAX_BYTES;
    // The project and the engine home are resolved to their real places once; below them nothing that is a link is followed.
    const projectReal = await real(query.projectDir);
    if (projectReal === null) return NO_FIGURES('not-found');
    const project = trimSlash(projectReal);
    const configured = (v: string | undefined, fallback: string): string => (typeof v === 'string' && ok(v) ? v : fallback);
    const starts = [startMs, ...(query.siblings ?? []).map(s => Date.parse(s.startedAt)).filter(Number.isFinite)];
    const earliest = Math.min(...starts) - WINDOW_MS;
    let found: Candidate[];
    if (query.engine === 'claude-code') {
      const root = await real(configured(deps.env?.CLAUDE_CONFIG_DIR, join(deps.home, '.claude')));
      if (root === null) return NO_FIGURES('not-found');
      const projects = join(root, 'projects'), folder = join(projects, claudeFolderName(project));
      if (!(await isFolder(projects)) || !(await isFolder(folder))) return NO_FIGURES('not-found');
      found = await logsIn(folder);
    } else {
      const root = await real(configured(deps.env?.CODEX_HOME, join(deps.home, '.codex')));
      if (root === null) return NO_FIGURES('not-found');
      const sessions = join(root, 'sessions');
      if (!(await isFolder(sessions))) return NO_FIGURES('not-found');
      found = [];
      const days = new Set(starts.flatMap(codexDays));
      for (const day of days) {
        const [y, m, d] = day.split('/') as [string, string, string];
        const yd = join(sessions, y), md = join(yd, m), dd = join(md, d);
        if ((await isFolder(yd)) && (await isFolder(md)) && (await isFolder(dd))) found.push(...(await logsIn(dd)));
      }
    }
    // A log last changed before the window began cannot have begun inside it. Of the rest, only the newest few hundred are looked at.
    const fresh = found.filter(c => c.mtimeMs >= earliest).sort((a, b) => b.mtimeMs - a.mtimeMs);
    const capped = fresh.length > LOG_CANDIDATE_CAP;
    const looked = fresh.slice(0, LOG_CANDIDATE_CAP);
    const placed: { path: string; firstMs: number }[] = [];
    let unplaced = 0, denied = 0;
    for (const c of looked) {
      const h = await head(c.path, project, query.engine, deps.openFile ?? open);
      if (h.kind === 'placed') placed.push({ path: c.path, firstMs: h.firstMs });
      else if (h.kind === 'unplaced') unplaced += 1;
      else if (h.kind === 'no-permission') denied += 1;
    }
    // Each log goes to one run only: every (run, log) pair that fits the window, the smallest gap first.
    const fits = (firstMs: number, start: number): boolean => firstMs >= start - WINDOW_MS && firstMs <= start + WINDOW_MS;
    const pairs: { run: number; path: string; gap: number; firstMs: number }[] = [];
    starts.forEach((start, run) => { for (const p of placed) if (fits(p.firstMs, start)) pairs.push({ run, path: p.path, gap: Math.abs(p.firstMs - start), firstMs: p.firstMs }); });
    pairs.sort((a, b) => a.gap - b.gap || a.firstMs - b.firstMs || a.run - b.run || (a.path < b.path ? -1 : 1));
    const runOf = new Map<string, number>(), pathOf = new Map<number, string>();
    for (const p of pairs) if (!runOf.has(p.path) && !pathOf.has(p.run)) { runOf.set(p.path, p.run); pathOf.set(p.run, p.path); }
    const mine = pathOf.get(0);
    const fitsMe = placed.filter(p => fits(p.firstMs, startMs));
    if (mine !== undefined) {
      // Another log that fits this run and belongs to no recorded run, or a file that could not be placed beside it, means the choice is a guess.
      if (fitsMe.some(p => p.path !== mine && !runOf.has(p.path)) || unplaced + denied > 0) return NO_FIGURES('ambiguous');
      return await figuresOf(mine, query.engine, maxBytes, deps.openFile ?? open);
    }
    if (fitsMe.length > 0) return NO_FIGURES('not-found');
    if (denied > 0) return NO_FIGURES('unreadable', 'no-permission');
    if (unplaced > 0) return NO_FIGURES('unreadable', 'unplaced');
    return NO_FIGURES('not-found', capped ? 'capped' : null);
  } catch { return NO_FIGURES('unreadable'); }
}
