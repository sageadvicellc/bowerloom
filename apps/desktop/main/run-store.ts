/**
 * The file of recorded runs, in the app's private state folder (`<state root>/runs/runs.json`, the same root the usage log and the saved read use; main/engine-state.ts). It holds what the
 * person recorded (the engine, the instruction, the start time, the status, the rating and the notes) and what main knew about the folder when it was recorded (its full path, name and `~`
 * label). It never holds a line of a chat. It is never written into a project.
 *
 * Writing: the folder is for its owner only (0700) and must be a real folder, never a link; the whole file goes to a new temporary file for its owner only (0600) that follows no link, is flushed,
 * and is then renamed over the old file in one step, so a crash leaves the old file or the new one, never half of one. A failed write leaves the old file whole and removes the temporary file.
 *
 * Reading: the file is untrusted. A file that is a link or not a plain file is `unsafe`; a file over the cap, text that is not JSON, a format that is not ours, or any record that does not
 * have exactly the expected fields and values is `damaged`. Nothing from a file is used unless every record passed. A damaged file is never written over: a new record moves it aside first.
 * The store keeps nothing in memory: every call reads the file, so a failed write is never half-remembered.
 */
import { closeSync, constants, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { RECORDED_STATUSES, RUN_INSTRUCTION_LIMIT, RUN_NOTES_LIMIT, RUN_RATINGS, RUN_RECORD_LIMIT } from '../shared/api/runs.js';
import { RUN_ID, isEngineIdValue } from '../shared/api/runs-shape.js';
import type { RecordedStatus, RunPatch, RunRating } from '../shared/api/runs.js';
import type { EngineId } from '../shared/engine/types.js';

const FORMAT = 'bowerloom/runs/v1';
const FOLDER = 'runs', FILE = 'runs.json', ASIDE = 'runs.damaged.json';
/** The most bytes the file may hold. The record limit and the field limits keep a real file far below it. */
export const RUN_FILE_MAX_BYTES = 8_000_000;

export const runsDir = (stateRoot: string): string => join(stateRoot, FOLDER);
export const runsFile = (stateRoot: string): string => join(runsDir(stateRoot), FILE);

export type RunStoreReason = 'damaged' | 'unsafe' | 'write-failed' | 'full' | 'unknown-run' | 'rating-needs-done';
/** An error of the store. `reason` is a short word; the message holds no path and no text of the file. */
export class RunStoreError extends Error {
  constructor(readonly reason: RunStoreReason) { super(reason); this.name = 'RunStoreError'; }
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
    && (v.rating === null || (RUN_RATINGS as readonly unknown[]).includes(v.rating)) && text(v.notes, RUN_NOTES_LIMIT) && (v.rating === null || v.status === 'done');
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

  /** Makes the folder (private, never a link) when it is not there yet. */
  const ensureFolder = (): void => {
    if (folderState() === 'ok') return;
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
    } catch {
      if (fd !== null) { try { closeSync(fd); } catch { /* already closed */ } }
      try { unlinkSync(temp); } catch { /* it was never made, or it is gone */ }
      throw new RunStoreError('write-failed');
    }
  };

  const newestFirst = (runs: readonly StoredRun[]): StoredRun[] => [...runs].sort((a, b) => (a.startedAt === b.startedAt ? Number(b.id.slice(4)) - Number(a.id.slice(4)) : a.startedAt < b.startedAt ? 1 : -1));

  return {
    list: () => newestFirst(load().runs),
    get: id => load().runs.find(r => r.id === id),
    add(run) {
      let saved: Saved;
      try { saved = load(); } catch (error) {
        if (!(error instanceof RunStoreError) || error.reason !== 'damaged') throw error;
        // A damaged file is kept beside the new one, so nothing the person had is lost to a fresh start.
        try { move(file, join(dir, ASIDE)); } catch { throw new RunStoreError('write-failed'); }
        saved = EMPTY;
      }
      if (saved.runs.length >= limit || saved.next > 999_999 || saved.groups > 999_999) throw new RunStoreError('full');
      const same = saved.runs.find(r => r.projectPath === run.projectPath && r.instruction === run.instruction);
      const made: StoredRun = { id: `run-${saved.next}`, ...run, status: 'recorded', groupId: same === undefined ? `group-${saved.groups}` : same.groupId, rating: null, notes: '' };
      save({ next: saved.next + 1, groups: same === undefined ? saved.groups + 1 : saved.groups, runs: [...saved.runs, made] });
      return made;
    },
    update(id, patch) {
      const saved = load();
      const old = saved.runs.find(r => r.id === id);
      if (old === undefined) throw new RunStoreError('unknown-run');
      const status = patch.status ?? old.status;
      let rating: RunRating | null = patch.rating !== undefined ? patch.rating : old.rating;
      if (status !== 'done') { if (patch.rating !== undefined && patch.rating !== null) throw new RunStoreError('rating-needs-done'); rating = null; }
      const made: StoredRun = { ...old, status, rating, notes: patch.notes ?? old.notes };
      save({ ...saved, runs: saved.runs.map(r => (r.id === id ? made : r)) });
      return made;
    },
  };
}
