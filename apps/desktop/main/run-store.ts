/**
 * The file of recorded runs, in the app's private state folder (`<state root>/runs/runs.json`, the same root the usage log and the saved read use; main/engine-state.ts). It holds what the
 * person recorded (the engine, the instruction, the start time, the status, the rating and the notes) and what main knew about the folder when it was recorded (its full path, name and `~`
 * label). It never holds a line of a chat. It is never written into a project.
 *
 * Writing: the folder is for its owner only (0700) and must be a real folder, never a link; the whole file goes to a new temporary file for its owner only (0600) that follows no link, is flushed,
 * and is then renamed over the old file in one step, so a crash leaves the old file or the new one, never half of one. A failed write leaves the old file whole and removes the temporary file.
 *
 * Reading: the file is untrusted. A file that is a link or not a plain file is `unsafe`; a file over the cap, text that is not JSON, a format that is not ours, or any record that does not
 * have exactly the expected fields and values is `damaged`. Nothing from a file is used unless every record passed. A damaged file is never written over and never moved aside by a record: `add` and
 * `update` refuse (`damaged`) and write nothing. Only `startNewList`, which the person asks for, moves it aside, under a name with the time in it, so an older aside is never overwritten.
 * The store keeps nothing in memory: every call reads the file, so a failed write is never half-remembered.
 */
import { chmodSync, closeSync, constants, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, unlinkSync, writeSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { RECORDED_STATUSES, RUN_INSTRUCTION_LIMIT, RUN_NOTES_LIMIT, RUN_RATINGS, RUN_RECORD_LIMIT } from '../shared/api/runs.js';
import { RUN_ID, isEngineIdValue } from '../shared/api/runs-shape.js';
import type { RecordedStatus, RunPatch, RunRating } from '../shared/api/runs.js';
import type { EngineId } from '../shared/engine/types.js';

const FORMAT = 'bowerloom/runs/v1';
const FOLDER = 'runs', FILE = 'runs.json';
const TEMP_NAME = /^runs\.\d+\.[0-9a-f]{12}\.tmp$/, TEMP_STALE_MS = 10 * 60 * 1000;
/** The most bytes the file may hold. The record limit and the field limits keep a real file far below it. */
export const RUN_FILE_MAX_BYTES = 16_000_000;
/** The largest bytes one saved run can take: each text counts 3 bytes for every UTF-16 unit (the most UTF-8 needs for one), and the fixed parts are counted with room to spare. */
export const RUN_MAX_BYTES_EACH = (RUN_INSTRUCTION_LIMIT + RUN_NOTES_LIMIT + 2048 + 255 + 2200) * 3 + 400;

export const runsDir = (stateRoot: string): string => join(stateRoot, FOLDER);
export const runsFile = (stateRoot: string): string => join(runsDir(stateRoot), FILE);

export type RunStoreReason = 'damaged' | 'unsafe' | 'write-failed' | 'full' | 'unknown-run' | 'rating-needs-done' | 'not-damaged';
/** An error of the store. `reason` is a short word; the message holds no path and no text of the file. */
/** `code` keeps the errno code of the cause (for example ENOSPC) for the log. It holds no path. */
export class RunStoreError extends Error {
  constructor(readonly reason: RunStoreReason, readonly code: string = '') { super(reason); this.name = 'RunStoreError'; }
}

/** One saved run: what the page sees, and the full path of the folder, which only main uses. */
export interface StoredRun {
  readonly id: string; readonly engine: EngineId; readonly instruction: string;
  readonly projectPath: string; readonly projectName: string; readonly projectLabel: string;
  readonly startedAt: string; readonly status: RecordedStatus; readonly groupId: string; readonly rating: RunRating | null; readonly notes: string;
}
export type NewRun = Pick<StoredRun, 'engine' | 'instruction' | 'projectPath' | 'projectName' | 'projectLabel' | 'startedAt'>;

export interface RunStore {
  /** The saved runs, newest start first. Throws `damaged` or `unsafe`. A folder or file that is not there yet is an empty list, and nothing is made. */
  list(): StoredRun[];
  get(id: string): StoredRun | undefined;
  add(run: NewRun): StoredRun;
  update(id: string, patch: RunPatch): StoredRun;
  /** Moves a damaged file aside under a new name (never over an older aside) and gives the name. Anything that is not a damaged plain file is refused. */
  startNewList(): string;
}

export interface RunStoreDeps {
  readonly stateRoot: string;
  /** For a test: a smaller record limit. */
  readonly limit?: number;
  /** For a test: the call that moves the temporary file over the file. */
  readonly rename?: (from: string, to: string) => void;
}

interface Saved { readonly next: number; readonly groups: number; readonly runs: readonly StoredRun[] }

const GROUP_ID = /^group-[0-9]{1,6}$/;
const KEYS = ['id', 'engine', 'instruction', 'projectPath', 'projectName', 'projectLabel', 'startedAt', 'status', 'groupId', 'rating', 'notes'];
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const text = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max;

/** Whether a parsed value is exactly one stored run. */
function isStoredRun(v: unknown): v is StoredRun {
  if (!isObject(v)) return false;
  const keys = Object.keys(v);
  if (keys.length !== KEYS.length || !KEYS.every(k => Object.hasOwn(v, k))) return false;
  const iso = typeof v.startedAt === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v.startedAt) && Number.isFinite(Date.parse(v.startedAt));
  return typeof v.id === 'string' && RUN_ID.test(v.id) && isEngineIdValue(v.engine) && text(v.instruction, RUN_INSTRUCTION_LIMIT) && v.instruction !== ''
    && text(v.projectPath, 2048) && v.projectPath.startsWith('/') && !v.projectPath.includes('\u0000') && text(v.projectName, 255) && text(v.projectLabel, 2200)
    && iso && (RECORDED_STATUSES as readonly unknown[]).includes(v.status) && typeof v.groupId === 'string' && GROUP_ID.test(v.groupId)
    && (v.rating === null || (RUN_RATINGS as readonly unknown[]).includes(v.rating)) && text(v.notes, RUN_NOTES_LIMIT) ;
}

function parse(textOfFile: string): Saved {
  let value: unknown;
  try { value = JSON.parse(textOfFile); } catch { throw new RunStoreError('damaged'); }
  if (!isObject(value) || value.format !== FORMAT || !Array.isArray(value.runs) || !Number.isSafeInteger(value.next) || !Number.isSafeInteger(value.groups)) throw new RunStoreError('damaged');
  const runs = value.runs as unknown[];
  if (runs.length > RUN_RECORD_LIMIT || !runs.every(isStoredRun) || new Set((runs as StoredRun[]).map(r => r.id)).size !== runs.length) throw new RunStoreError('damaged');
  return { next: value.next as number, groups: value.groups as number, runs: runs as StoredRun[] };
}

const codeOf = (error: unknown): string => String((error as { code?: unknown } | null)?.code ?? '');
const absent = (error: unknown): boolean => codeOf(error) === 'ENOENT' || codeOf(error) === 'ENOTDIR';
const EMPTY: Saved = { next: 1, groups: 1, runs: [] };

export function createRunStore(deps: RunStoreDeps): RunStore {
  const dir = runsDir(deps.stateRoot), file = runsFile(deps.stateRoot), limit = Math.min(deps.limit ?? RUN_RECORD_LIMIT, RUN_RECORD_LIMIT);
  const move = deps.rename ?? ((from: string, to: string): void => { renameSync(from, to); });

  /** The state of the folder: 'none' (not there), 'ok', or it throws `unsafe`. */
  const folderState = (): 'none' | 'ok' => {
    let stat;
    try { stat = lstatSync(dir); } catch (error) { if (absent(error)) return 'none'; throw new RunStoreError('unsafe'); }
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new RunStoreError('unsafe');
    return 'ok';
  };

  /** The saved file, or an empty one when none is there. Throws `unsafe` or `damaged`. */
  const load = (): Saved => {
    if (folderState() === 'none') return EMPTY;
    sweep();
    let stat;
    try { stat = lstatSync(file); } catch (error) { if (absent(error)) return EMPTY; throw new RunStoreError('unsafe'); }
    if (stat.isSymbolicLink() || !stat.isFile()) throw new RunStoreError('unsafe');
    if (stat.size > RUN_FILE_MAX_BYTES) throw new RunStoreError('damaged');
    let fd: number;
    try { fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW); } catch { throw new RunStoreError('unsafe'); }
    try {
      if (!fstatSync(fd).isFile()) throw new RunStoreError('unsafe');
      return parse(readFileSync(fd, 'utf8'));
    } catch (error) {
      throw error instanceof RunStoreError ? error : new RunStoreError('damaged');
    } finally { closeSync(fd); }
  };

  /** Removes a temporary file that a crash left, when it is old enough not to belong to a save in progress. Never throws. */
  const sweep = (): void => {
    try {
      for (const name of readdirSync(dir)) {
        if (!TEMP_NAME.test(name)) continue;
        try { const s = lstatSync(join(dir, name)); if (s.isFile() && Date.now() - s.mtimeMs > TEMP_STALE_MS) unlinkSync(join(dir, name)); } catch { /* gone */ }
      }
    } catch { /* nothing to sweep */ }
  };

  /** Makes the folder (private, never a link) when it is not there yet. */
  const ensureFolder = (): void => {
    if (folderState() === 'ok') { try { chmodSync(dir, 0o700); } catch { /* not ours to change: the folder was checked as a folder, and the file is 0600 */ } return; }
    try { mkdirSync(deps.stateRoot, { recursive: true, mode: 0o700 }); mkdirSync(dir, { mode: 0o700 }); } catch { throw new RunStoreError('write-failed'); }
    folderState();
  };

  const save = (saved: Saved): void => {
    ensureFolder();
    const temp = join(dir, `runs.${process.pid}.${randomBytes(6).toString('hex')}.tmp`);
    let fd: number | null = null;
    try {
      fd = openSync(temp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      const bytes = Buffer.from(JSON.stringify({ format: FORMAT, next: saved.next, groups: saved.groups, runs: saved.runs }), 'utf8');
      let at = 0;
      while (at < bytes.length) at += writeSync(fd, bytes, at, bytes.length - at);
      fsyncSync(fd); closeSync(fd); fd = null;
      move(temp, file);
      // The folder is flushed too, so the rename itself survives a crash.
      try { const dfd = openSync(dir, constants.O_RDONLY); try { fsyncSync(dfd); } finally { closeSync(dfd); } } catch { /* a system that cannot flush a folder */ }
    } catch (error) {
      if (fd !== null) { try { closeSync(fd); } catch { /* already closed */ } }
      try { unlinkSync(temp); } catch { /* it was never made, or it is gone */ }
      throw new RunStoreError('write-failed', codeOf(error));
    }
  };

  const newestFirst = (runs: readonly StoredRun[]): StoredRun[] => [...runs].sort((a, b) => (a.startedAt === b.startedAt ? Number(b.id.slice(4)) - Number(a.id.slice(4)) : a.startedAt < b.startedAt ? 1 : -1));

  return {
    list: () => newestFirst(load().runs),
    get: id => load().runs.find(r => r.id === id),
    add(run) {
      const saved = load();
      if (saved.runs.length >= limit || saved.next > 999_999 || saved.groups > 999_999) throw new RunStoreError('full');
      // Compare is one task across engines: a run joins the first group of its instruction and project that has no run of its engine yet. With the same engine in every such group, it starts a new one.
      const sameTask = saved.runs.filter(r => r.projectPath === run.projectPath && r.instruction === run.instruction);
      const join = [...new Set(sameTask.map(r => r.groupId))].find(g => !sameTask.some(r => r.groupId === g && r.engine === run.engine));
      const made: StoredRun = { id: `run-${saved.next}`, ...run, status: 'recorded', groupId: join === undefined ? `group-${saved.groups}` : join, rating: null, notes: '' };
      save({ next: saved.next + 1, groups: join === undefined ? saved.groups + 1 : saved.groups, runs: [...saved.runs, made] });
      return made;
    },
    startNewList() {
      try { load(); throw new RunStoreError('not-damaged'); } catch (error) { if (!(error instanceof RunStoreError) || error.reason !== 'damaged') throw error; }
      const stamp = new Date().toISOString().replace(/[-:.]/g, '');
      for (let n = 0; n < 100; n += 1) {
        const name = `runs.damaged-${stamp}${n === 0 ? '' : `-${n}`}.json`;
        try { lstatSync(join(dir, name)); continue; } catch (error) { if (!absent(error)) throw new RunStoreError('write-failed', codeOf(error)); }
        try { move(file, join(dir, name)); } catch (error) { throw new RunStoreError('write-failed', codeOf(error)); }
        return name;
      }
      throw new RunStoreError('write-failed');
    },
    update(id, patch) {
      const saved = load();
      const old = saved.runs.find(r => r.id === id);
      if (old === undefined) throw new RunStoreError('unknown-run');
      const status = patch.status ?? old.status;
      // A rating that was given stays when the run is marked not done: it is locked, never wiped.
      const rating: RunRating | null = patch.rating !== undefined ? patch.rating : old.rating;
      if (status !== 'done' && patch.rating !== undefined && patch.rating !== null) throw new RunStoreError('rating-needs-done');
      const made: StoredRun = { ...old, status, rating, notes: patch.notes ?? old.notes };
      save({ ...saved, runs: saved.runs.map(r => (r.id === id ? made : r)) });
      return made;
    },
  };
}
