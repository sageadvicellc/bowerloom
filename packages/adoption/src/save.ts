/**
 * Save (0.8.0-beta.1, option C): each folder saves its own harness definition. The input is the folder's full target
 * file set, a path relative to `.bowerloom` mapped to its bytes. The save replaces, creates, and deletes files in
 * `.bowerloom` until the folder holds exactly that set. Files the loader does not read (0.7 names, `.DS_Store`, an
 * empty `.gitkeep`) are never touched.
 *
 * - The plan reads only. It refuses a path outside `.bowerloom`, a hidden name, a 0.7 name, a link, a path that clashes
 *   with another in letter case or Unicode form, a secret value in any file it writes, and a target the loader rejects
 *   (it loads the target in a scratch folder outside the project). Its revision binds the state of every file it
 *   touches and the revision of the definition now.
 * - Apply plans again under the project lock and writes only when the revision is the one approved. It writes
 *   creates and updates, then deletes, then removes the folders the deletes emptied, and writes `harness.json` last.
 *   It then loads the definition again and checks it is the planned target.
 * - The journal, `save-pending.json` in the adoption state folder, is written before the first write. It holds the
 *   state before and after of each file, the bytes it replaces, and the bytes it writes. A failure puts every original
 *   back; a crash leaves the journal, and every later save plan refuses SAVE_RECOVERY_REQUIRED until a person approves
 *   a save recovery, which either undoes the save or finishes it.
 * - This copies the reviewed journal pattern of `merge.ts`, as the save plan asks, rather than sharing one.
 * - Every write goes through the portable projection's write layer: the folders above the path are checked just before
 *   the write, a new file is linked into place, and a replaced or deleted file must still hold the planned bytes.
 */
import fs from 'node:fs';
import os from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';
import { DefinitionError, oneLine } from '../../contracts/src/index.js';
import { DEFINITION_LIMITS, INCOMPLETE_RULES, LEGACY_NAMES, loadDefinition, parseStrictJson, scanSecrets } from '../../harness-definition/src/index.js';
import type { Problem } from '../../harness-definition/src/index.js';
import { decodeText } from '../../harness-definition/src/json.js';
import { withProjectLock } from '../../project-context/src/index.js';
import {
  PortableRefusal, byBytes, caseClashes, checkAncestors, makeDir, readProject, removeEmptyDirs, revisionOf, sameState, sha, syncDir, uid, writeAbs,
} from '../../project-sync/src/portable-files.js';
import type { FileState } from '../../project-sync/src/portable-files.js';
import { checkPaths, stateExists } from '../../project-sync/src/portable-state.js';
import { adoptionStopped } from './journal.js';
import { mergeStopped } from './merge.js';

export const SAVE_PLAN_FORMAT = 'bowerloom/definition-save-plan/v1beta1' as const;
export const SAVE_JOURNAL = 'save-pending.json';
export const SAVE_JOURNAL_FORMAT = 'bowerloom/definition-save-pending/v1beta1' as const;
export const SAVE_RECOVERY_FORMAT = 'bowerloom/definition-save-recovery-plan/v1beta1' as const;
/** The bytes a save may replace and write together: the journal holds both. */
export const SAVE_PAYLOAD_LIMIT = 32 * 1024 * 1024;
/** The largest journal a recovery reads: the payload in base64, and the file list. */
export const SAVE_JOURNAL_LIMIT = 48 * 1024 * 1024;
const JOURNAL_ENTRIES = 2 * DEFINITION_LIMITS.files;

// ---- refusals ----------------------------------------------------------------------------------------------------------

const MESSAGES = {
  SAVE_USAGE: 'The save input is not valid. It takes a project folder, a state folder, and a target that maps each path in .bowerloom to its bytes.',
  SAVE_STALE: 'The definition changed after the save was planned, or the approval is for another plan. Nothing more was written. Plan again to see the new plan.',
  SAVE_DEFINITION_INVALID: 'The definition does not load now, or would not load after the save, so the save writes nothing.',
  SAVE_SECRET_FOUND: 'A file the save would write holds a secret value. Use a ${NAME} reference instead. Nothing was written.',
  SAVE_RECOVERY_REQUIRED: 'An earlier adoption, merge, or save of this folder stopped part way, and its journal is in the state folder. Recover it first. Nothing was changed.',
  SAVE_PARTIAL: 'The save stopped part way and could not put every original back. The journal stays in the state folder, so plan a save recovery. The paths listed are left over.',
  SAVE_PATH_UNSAFE: 'A path the save would read or write is outside .bowerloom, hidden, a 0.7 name, a link, not yours, or clashes with another path in letter case or Unicode form. Nothing more was changed.',
  SAVE_TOO_LARGE: 'The target holds more than a definition may: the limits match the definition loader (files, bytes per file, total bytes, folder depth), and the bytes a save replaces and writes together are at most 32 MiB. Nothing was written.',
  SAVE_STATE_UNSAFE: 'The state folder must be a normalized absolute path outside the project, and a private folder of yours (mode 0700) when it exists. The journal in it must be private too.',
  SAVE_ABORTED: 'The save was stopped. It put back every file it had written.',
  SAVE_RECOVER_NOTHING: 'No save of this folder is unfinished, so there is nothing to recover.',
  SAVE_FINISH_BLOCKED: 'The stopped save cannot be finished: its journal cannot be trusted, or a file changed since it stopped. Undo it instead, then save again. Nothing was changed.',
} as const;
export type SaveCode = keyof typeof MESSAGES;
export const SAVE_REFUSAL_CODES: readonly SaveCode[] = Object.freeze(Object.keys(MESSAGES) as SaveCode[]);

/** A save refusal. `paths` are relative to `.bowerloom`; `problems` are the loader's. A message never repeats a value from a file. */
export class SaveRefusal extends DefinitionError {
  /** For SAVE_PARTIAL: the code of the error that stopped the run. */
  readonly original?: string;
  constructor(code: SaveCode, readonly paths: readonly string[] = [], readonly problems: readonly Problem[] = [], original?: string) {
    const cause = original !== undefined ? ` The run stopped on ${/^[A-Z][A-Z0-9_]{0,63}$/.test(original) ? original : 'an error'}.` : '';
    super(code, `${MESSAGES[code]}${cause}${paths.length ? ` ${oneLine(paths.slice(0, 20).join(', '))}${paths.length > 20 ? `, and ${paths.length - 20} more` : ''}.` : ''}`);
    if (original !== undefined) this.original = original;
    this.name = 'SaveRefusal';
  }
}
function refuse(code: SaveCode, paths: readonly string[] = [], problems: readonly Problem[] = [], original?: string): never { throw new SaveRefusal(code, paths, problems, original); }

// ---- shapes ------------------------------------------------------------------------------------------------------------

export interface SaveInput {
  /** The real absolute path of the project folder. Its definition is `.bowerloom`. */
  readonly projectDir: string;
  /** The private state folder of adoption, outside the project. The save journal goes there, beside the adoption and merge journals. */
  readonly stateDir: string;
}
/** The full target file set of the folder's definition: a path relative to `.bowerloom`, to its bytes. */
export type SaveTarget = ReadonlyMap<string, Uint8Array> | Readonly<Record<string, Uint8Array>>;
/** One change, relative to `.bowerloom`. */
export interface SaveChange {
  readonly path: string;
  readonly action: 'create' | 'update' | 'delete';
  readonly before: FileState | null;
  readonly after: (FileState & { readonly bytes: number }) | null;
}
export interface SavePlan {
  readonly format: typeof SAVE_PLAN_FORMAT;
  readonly projectDir: string;
  /** In write order: creates and updates, then deletes, then `harness.json`. Each group in byte order of path. */
  readonly changes: readonly SaveChange[];
  /** Folders the deletes empty, relative to `.bowerloom`. The save removes them before it writes `harness.json`. */
  readonly emptied: readonly string[];
  /** The definition revision now. */
  readonly currentRevision: string;
  /** The definition revision after the save. */
  readonly targetRevision: string;
  readonly writesAuthorized: false;
  /** The approval: pass it to `applySave`. */
  readonly revision: string;
}
export interface SaveResult {
  readonly planRevision: string;
  /** The changed paths, relative to `.bowerloom`, in write order. */
  readonly written: readonly string[];
  /** The definition revision now. */
  readonly revision: string;
  readonly plan: SavePlan;
}
/** Test hooks. Not exported from the package index. An error with `crash: true` stands for a killed process. Paths are relative to `.bowerloom`. */
export interface SaveHooks { readonly beforeWrite?: (rel: string) => void; readonly afterWrite?: (rel: string) => void }

/** A journal step. `path` is relative to the project; `original` and `bytes` are base64. */
interface JournalStep { readonly path: string; readonly from: FileState | null; readonly to: FileState | null; readonly original: string | null; readonly bytes: string | null }
interface SaveJournal {
  readonly format: typeof SAVE_JOURNAL_FORMAT; readonly projectDir: string; readonly planRevision: string; readonly targetRevision: string;
  readonly files: readonly JournalStep[];
  /** Folders the save creates, relative to the project. */
  readonly dirs: readonly string[];
  /** Folders the save removes when empty, relative to the project. */
  readonly emptied: readonly string[];
}

const DEF = '.bowerloom';
const HARNESS = 'harness.json';
const HEX = /^[a-f0-9]{64}$/;
const DEF_REVISION = /^sha256:[a-f0-9]{64}$/;
const LEGACY = new Set<string>(LEGACY_NAMES);
const inProject = (rel: string): string => `${DEF}/${rel}`;
const inDef = (rel: string): string => rel.startsWith(`${DEF}/`) ? rel.slice(DEF.length + 1) : rel;

// ---- stopped runs ------------------------------------------------------------------------------------------------------

/** True when a save stopped part way: its journal file is in the adoption state folder, whether it can be read or not. */
export function saveStopped(stateDir: string): boolean {
  try { fs.lstatSync(join(stateDir, SAVE_JOURNAL)); return true; } catch (e) { return (e as NodeJS.ErrnoException).code !== 'ENOENT'; }
}
/** Refuses SAVE_RECOVERY_REQUIRED while a save is stopped. An install, a removal, an adoption, or a merge must not run on a half-saved definition. */
export function refuseWhileSaveStopped(stateDir: string): void {
  if (saveStopped(stateDir)) refuse('SAVE_RECOVERY_REQUIRED');
}

// ---- input -------------------------------------------------------------------------------------------------------------

function checkInput(input: SaveInput): { projectDir: string; stateDir: string } {
  if (input === null || typeof input !== 'object' || Object.keys(input).some(k => k !== 'projectDir' && k !== 'stateDir')) return refuse('SAVE_USAGE');
  const { projectDir, stateDir } = input;
  if (typeof projectDir !== 'string' || !isAbsolute(projectDir) || projectDir.includes('\0') || typeof stateDir !== 'string') refuse('SAVE_USAGE');
  let real: string, st: fs.Stats;
  try { real = fs.realpathSync(projectDir); st = fs.lstatSync(projectDir); } catch { return refuse('SAVE_PATH_UNSAFE'); }
  if (real !== projectDir || !st.isDirectory() || st.uid !== uid()) refuse('SAVE_PATH_UNSAFE');
  try { checkPaths(projectDir, stateDir); stateExists(stateDir); } catch (e) {
    if (e instanceof PortableRefusal) refuse(e.code === 'PORTABLE_USAGE' ? 'SAVE_USAGE' : 'SAVE_STATE_UNSAFE');
    throw e;
  }
  return { projectDir, stateDir };
}

/** Copies the target into a fresh map, so a caller that changes its buffers later cannot change what was checked. */
function readTarget(target: unknown): Map<string, Buffer> {
  let entries: [unknown, unknown][];
  if (target instanceof Map) entries = [...target.entries()];
  else if (target !== null && typeof target === 'object' && !Array.isArray(target) && [Object.prototype, null].includes(Object.getPrototypeOf(target))) entries = Object.entries(target);
  else return refuse('SAVE_USAGE');
  if (entries.length > DEFINITION_LIMITS.files) refuse('SAVE_TOO_LARGE');
  const out = new Map<string, Buffer>();
  let total = 0;
  for (const [k, v] of entries) {
    if (typeof k !== 'string' || !(v instanceof Uint8Array)) refuse('SAVE_USAGE');
    if (v.length > DEFINITION_LIMITS.fileBytes) refuse('SAVE_TOO_LARGE', [k]);
    total += v.length;
    if (total > DEFINITION_LIMITS.totalBytes) refuse('SAVE_TOO_LARGE');
    out.set(k, Buffer.from(v));
  }
  return out;
}

/**
 * True when a path relative to `.bowerloom` is a plain path inside it: no empty, `.`, `..`, or hidden segment, no
 * control, format (zero-width, direction), or line separator character, no backslash, not under a 0.7 name, and within
 * the loader's depth.
 */
function plainPath(rel: unknown): rel is string {
  if (typeof rel !== 'string' || rel.length === 0 || rel.length > 1024 || /[\p{Cc}\p{Cf}\u2028\u2029\\]/u.test(rel)) return false;
  const parts = rel.split('/');
  if (parts.length - 1 > DEFINITION_LIMITS.depth || LEGACY.has(parts[0]!)) return false;
  return parts.every(s => s !== '' && s !== '.' && s !== '..' && !s.startsWith('.') && Buffer.byteLength(s) <= 255);
}
/** A project-relative journal path: `.bowerloom/` and a plain path. */
const journalPath = (p: unknown): p is string => typeof p === 'string' && p.startsWith(`${DEF}/`) && plainPath(p.slice(DEF.length + 1));

/** Refuses two target paths that name one file or folder on a case-insensitive or normalizing file system, and a file where a folder must be. */
function checkClashes(paths: readonly string[]): void {
  const files = new Set(paths), folded = new Map<string, string>();
  for (const rel of paths) {
    const parts = rel.split('/');
    for (let i = 1; i <= parts.length; i++) {
      const prefix = parts.slice(0, i).join('/'), key = prefix.normalize('NFC').toLowerCase();
      const seen = folded.get(key);
      if (seen !== undefined && seen !== prefix) refuse('SAVE_PATH_UNSAFE', [seen, prefix]);
      folded.set(key, prefix);
      if (i < parts.length && files.has(prefix)) refuse('SAVE_PATH_UNSAFE', [prefix]);
    }
  }
}

/** Runs a read of the portable layer, and maps its refusal: a path it cannot read safely is SAVE_PATH_UNSAFE. */
function guarded<T>(read: () => T): T {
  try { return read(); } catch (e) { if (e instanceof PortableRefusal) return refuse('SAVE_PATH_UNSAFE', e.paths.map(inDef)); throw e; }
}
const invalid = (problems: readonly Problem[]): never => refuse('SAVE_DEFINITION_INVALID', [...new Set(problems.map(p => `${p.path} (${p.code})`))], problems);

// ---- the folder as it is -----------------------------------------------------------------------------------------------

/**
 * Every folder and file under `.bowerloom`, relative to it, skipping the 0.7 names at the top and never following a
 * link. Bounded by the loader's limits.
 */
function walk(projectDir: string): { dirs: string[]; files: string[] } {
  const dirs: string[] = [], files: string[] = [];
  const visit = (rel: string, depth: number): void => {
    if (depth > DEFINITION_LIMITS.depth + 1 || dirs.length + files.length > 2 * DEFINITION_LIMITS.files) refuse('SAVE_TOO_LARGE');
    let names: string[];
    try { names = fs.readdirSync(join(projectDir, DEF, rel)).sort(byBytes); } catch { return refuse('SAVE_PATH_UNSAFE', [rel || '.']); }
    if (names.length > DEFINITION_LIMITS.folderEntries) refuse('SAVE_TOO_LARGE');
    for (const name of names) {
      if (rel === '' && LEGACY.has(name)) continue;
      const child = rel ? `${rel}/${name}` : name;
      let st: fs.Stats;
      try { st = fs.lstatSync(join(projectDir, DEF, child)); } catch { continue; }
      if (st.isDirectory() && !st.isSymbolicLink()) { dirs.push(child); visit(child, depth + 1); } else files.push(child);
    }
  };
  visit('', 1);
  return { dirs, files };
}

/** The top-level names that the target `harness.json` points to. `engines/` needs no pointer. */
function pointedTop(harness: Buffer | undefined): Set<string> {
  const out = new Set<string>(['engines']);
  const text = harness === undefined ? null : decodeText(harness);
  const parsed = text === null ? null : parseStrictJson(text);
  if (!parsed?.ok || parsed.value === null || typeof parsed.value !== 'object' || Array.isArray(parsed.value)) return out;
  const parts = (parsed.value as Record<string, unknown>).parts;
  if (parts === null || typeof parts !== 'object' || Array.isArray(parts)) return out;
  for (const v of Object.values(parts)) for (const s of Array.isArray(v) ? v : [v]) if (typeof s === 'string') out.add(s.split(/[/#]/)[0]!);
  return out;
}

/**
 * The folders the deletes empty, deepest first. A folder goes when a delete is under it and nothing stays under it: no
 * target file, no other file, and no folder that stays. A top-level folder that the target `harness.json` points to stays,
 * because the loader needs it.
 */
function emptiedDirs(dirs: readonly string[], files: readonly string[], deleted: ReadonlySet<string>, target: ReadonlyMap<string, Buffer>): string[] {
  const kept = new Set<string>([...target.keys(), ...files.filter(f => !deleted.has(f))]);
  const pointed = pointedTop(target.get(HARNESS));
  const under = (d: string, set: Iterable<string>): boolean => { for (const f of set) if (f.startsWith(`${d}/`)) return true; return false; };
  const removed = new Set<string>();
  for (const d of [...dirs].sort(byBytes).reverse()) {
    if (!d.includes('/') && pointed.has(d)) continue;
    if (!under(d, deleted) || under(d, kept)) continue;
    if (dirs.some(sub => sub.startsWith(`${d}/`) && !removed.has(sub))) continue;
    removed.add(d);
  }
  return [...removed].sort(byBytes);
}

/** Loads the target in a scratch folder outside the project, laid out as the folder will be. Returns its revision, or refuses with the loader's problems. */
function targetRevision(target: ReadonlyMap<string, Buffer>, modes: ReadonlyMap<string, number>, dirs: readonly string[]): string {
  const scratch = fs.mkdtempSync(join(os.tmpdir(), 'bowerloom-save-check-'));
  try {
    const at = join(scratch, DEF);
    fs.mkdirSync(at, { mode: 0o700 });
    for (const d of [...dirs].sort(byBytes)) fs.mkdirSync(join(at, d), { recursive: true, mode: 0o700 });
    for (const [rel, bytes] of target) {
      const p = join(at, rel), mode = modes.get(rel) ?? 0o644;
      fs.mkdirSync(dirname(p), { recursive: true, mode: 0o700 });
      fs.writeFileSync(p, bytes, { mode }); fs.chmodSync(p, mode);
    }
    const r = loadDefinition(at);
    return r.ok ? r.definition.revision : invalid(r.problems);
  } finally { fs.rmSync(scratch, { recursive: true, force: true }); }
}

// ---- plan --------------------------------------------------------------------------------------------------------------

interface Planned { readonly plan: SavePlan; readonly originals: ReadonlyMap<string, Buffer> }

function planCore(projectDir: string, stateDir: string, target: ReadonlyMap<string, Buffer>): Planned {
  if (adoptionStopped(stateDir) || mergeStopped(stateDir) || saveStopped(stateDir)) refuse('SAVE_RECOVERY_REQUIRED');
  const paths = [...target.keys()].sort(byBytes);
  const bad = paths.filter(p => !plainPath(p));
  if (bad.length) refuse('SAVE_PATH_UNSAFE', bad);
  checkClashes(paths);

  // The folder itself, then every target path on disk, before the loader: a link is a path refusal, never followed.
  guarded(() => checkAncestors(projectDir, `${DEF}/${HARNESS}`, true));
  const clashCache = new Map<string, string[] | null>();
  const onDisk = new Map<string, { bytes: Buffer; state: FileState }>();
  for (const rel of paths) {
    const clashes = caseClashes(projectDir, inProject(rel), clashCache);
    if (clashes.length) refuse('SAVE_PATH_UNSAFE', [rel, ...clashes.map(inDef)]);
    const got = guarded(() => readProject(projectDir, inProject(rel)));
    if (got !== null) onDisk.set(rel, got);
  }

  const loaded = loadDefinition(join(projectDir, DEF));
  if (!loaded.ok) return invalid(loaded.problems);
  const def = loaded.definition;
  const currentPaths = new Set(def.files.map(f => f.path));
  const unnormal = paths.filter(p => p.normalize('NFC') !== p && !currentPaths.has(p));
  if (unnormal.length) refuse('SAVE_PATH_UNSAFE', unnormal);

  // Every current file, read through the checked layer: what a delete removes and an update replaces.
  for (const f of def.files) {
    if (onDisk.has(f.path)) continue;
    const got = guarded(() => readProject(projectDir, inProject(f.path)));
    if (got === null) refuse('SAVE_STALE', [f.path]);
    onDisk.set(f.path, got);
  }
  for (const f of def.files) if (!onDisk.get(f.path)!.bytes.equals(f.bytes)) refuse('SAVE_STALE', [f.path]);

  const writes: SaveChange[] = [], deletes: SaveChange[] = [], originals = new Map<string, Buffer>(), modes = new Map<string, number>();
  let harness: SaveChange | null = null, payload = 0;
  for (const rel of paths) {
    const next = target.get(rel)!, now = onDisk.get(rel) ?? null;
    if (now !== null && !currentPaths.has(rel)) refuse('SAVE_PATH_UNSAFE', [rel]);
    const mode = now?.state.mode ?? 0o644;
    modes.set(rel, mode);
    if (now !== null && now.bytes.equals(next)) continue;
    const change: SaveChange = { path: rel, action: now ? 'update' : 'create', before: now?.state ?? null, after: { sha256: sha(next), mode, bytes: next.length } };
    payload += next.length + (now?.bytes.length ?? 0);
    if (now) originals.set(rel, now.bytes);
    if (rel === HARNESS) harness = change; else writes.push(change);
  }
  const deleted = new Set<string>();
  for (const f of def.files) {
    if (target.has(f.path)) continue;
    const now = onDisk.get(f.path)!;
    deleted.add(f.path);
    deletes.push({ path: f.path, action: 'delete', before: now.state, after: null });
    originals.set(f.path, now.bytes);
    payload += now.bytes.length;
  }
  deletes.sort((a, b) => byBytes(a.path, b.path));
  if (payload > SAVE_PAYLOAD_LIMIT) refuse('SAVE_TOO_LARGE');

  // Secrets: the loader's own scan, on every file the save writes. The refusal names the place, never the value. A
  // file the scan cannot read whole (unparseable JSON, an overlong line) is the loader's refusal, below.
  const incomplete = new Set<string>(INCOMPLETE_RULES);
  const findings = scanSecrets(writes.concat(harness ? [harness] : []).map(c => ({ path: c.path, bytes: target.get(c.path)! }))).filter(f => !incomplete.has(f.rule));
  if (findings.length) refuse('SAVE_SECRET_FOUND', [...new Set(findings.map(f => f.line !== undefined ? `${f.path} line ${f.line}` : f.pointer !== undefined ? `${f.path} at ${f.pointer}` : f.path))]);

  const { dirs, files } = walk(projectDir);
  const emptied = emptiedDirs(dirs, files, deleted, target);
  const after = targetRevision(target, modes, dirs.filter(d => !emptied.includes(d)));
  const body = {
    format: SAVE_PLAN_FORMAT, projectDir, changes: [...writes, ...deletes, ...(harness ? [harness] : [])], emptied,
    currentRevision: def.revision, targetRevision: after, writesAuthorized: false as const,
  };
  return { plan: { ...body, revision: revisionOf(body) }, originals };
}

/** The save plan: what the target changes in the folder's `.bowerloom`. Reads only. */
export function planSave(input: SaveInput, target: SaveTarget): SavePlan {
  const { projectDir, stateDir } = checkInput(input);
  return planCore(projectDir, stateDir, readTarget(target)).plan;
}

// ---- apply -------------------------------------------------------------------------------------------------------------

/** The save code of an error: a portable write refusal maps as merge maps it. */
const codeOf = (e: unknown): string => e instanceof PortableRefusal ? (e.code === 'PORTABLE_DRIFT' ? 'SAVE_STALE' : 'SAVE_PATH_UNSAFE')
  : typeof (e as { code?: unknown } | null)?.code === 'string' ? (e as { code: string }).code : 'ERROR';
const isCrash = (e: unknown): boolean => (e as { crash?: unknown } | null)?.crash === true;
const mapPortable = (e: unknown): never => {
  if (e instanceof PortableRefusal) refuse(e.code === 'PORTABLE_DRIFT' ? 'SAVE_STALE' : 'SAVE_PATH_UNSAFE', e.paths.map(inDef));
  throw e;
};

/** Writes the approved save under the project lock. */
export async function applySave(input: SaveInput, revision: string, target: SaveTarget, signal: AbortSignal = new AbortController().signal): Promise<SaveResult> {
  return applySaveWith(input, revision, target, signal, {});
}
/** applySave with test hooks. Not exported from the package index. */
export async function applySaveWith(input: SaveInput, revision: string, target: SaveTarget, signal: AbortSignal, hooks: SaveHooks): Promise<SaveResult> {
  if (typeof revision !== 'string' || !HEX.test(revision)) refuse('SAVE_STALE');
  const { projectDir, stateDir } = checkInput(input);
  const wanted = readTarget(target);
  return withProjectLock(projectDir, signal, async () => {
    const { plan, originals } = planCore(projectDir, stateDir, wanted);
    if (plan.revision !== revision) refuse('SAVE_STALE');
    if (plan.changes.length === 0) return { planRevision: plan.revision, written: [], revision: plan.currentRevision, plan };
    const steps: JournalStep[] = plan.changes.map(c => ({
      path: inProject(c.path), from: c.before, to: c.after ? { sha256: c.after.sha256, mode: c.after.mode } : null,
      original: c.before ? originals.get(c.path)!.toString('base64') : null, bytes: c.after ? wanted.get(c.path)!.toString('base64') : null,
    }));
    const dirs = [...new Set(steps.filter(s => s.to !== null).flatMap(s => guarded(() => checkAncestors(projectDir, s.path))))].sort(byBytes);
    const journal: SaveJournal = {
      format: SAVE_JOURNAL_FORMAT, projectDir, planRevision: plan.revision, targetRevision: plan.targetRevision, files: steps, dirs, emptied: plan.emptied.map(inProject),
    };
    writeSaveJournal(stateDir, journal);

    const written: JournalStep[] = [], created: string[] = [];
    const fail = (error: unknown): never => {
      if (isCrash(error)) throw error;
      const left = putBack(projectDir, written, created);
      if (left.length) refuse('SAVE_PARTIAL', left.map(inDef), [], codeOf(error));
      removeSaveJournal(stateDir);
      if (error instanceof SaveRefusal) throw error;
      return mapPortable(error);
    };
    try {
      runSteps(projectDir, journal, steps, {
        before: step => { if (signal.aborted) refuse('SAVE_ABORTED'); hooks.beforeWrite?.(inDef(step.path)); },
        placed: step => { written.push(step); },
        after: step => { hooks.afterWrite?.(inDef(step.path)); },
        made: d => { created.push(d); },
      });
      const loaded = loadDefinition(join(projectDir, DEF));
      if (!loaded.ok) return invalid(loaded.problems);
      if (loaded.definition.revision !== plan.targetRevision) refuse('SAVE_STALE');
      removeSaveJournal(stateDir);
      return { planRevision: plan.revision, written: plan.changes.map(c => c.path), revision: loaded.definition.revision, plan };
    } catch (error) { return fail(error); }
  });
}

interface StepEvents {
  readonly before: (step: JournalStep) => void;
  readonly placed: (step: JournalStep) => void;
  readonly after: (step: JournalStep) => void;
  readonly made: (dir: string) => void;
}
/**
 * Runs journal steps in order: each step must find its file at the state before. The folders the deletes emptied go
 * just before `harness.json` is written, or after the last step when the save does not write it.
 */
function runSteps(projectDir: string, journal: SaveJournal, steps: readonly JournalStep[], on: StepEvents): void {
  let cleared = false;
  const clear = (): void => {
    cleared = true;
    const left = removeEmptyDirs(projectDir, journal.emptied);
    if (left.length) refuse('SAVE_STALE', left.map(d => inDef(d.path)));
  };
  for (const step of steps) {
    if (step.path === inProject(HARNESS) && !cleared) clear();
    on.before(step);
    if (step.to === null) removeChecked(projectDir, step.path, step.from!, () => on.placed(step));
    else {
      for (const d of checkAncestors(projectDir, step.path)) makeDir(projectDir, d, made => on.made(made));
      place(projectDir, step.path, Buffer.from(step.bytes!, 'base64'), step.to.mode, step.from, () => on.placed(step));
    }
    on.after(step);
  }
  if (!cleared) clear();
}

/**
 * Writes bytes at a project path through the checked write layer. Just before the link or rename, the path must still
 * hold `expected` (null: nothing), else it refuses PORTABLE_DRIFT. A new file is linked into place.
 */
function place(projectDir: string, rel: string, bytes: Uint8Array, mode: number, expected: FileState | null, onPlaced: () => void = () => {}): void {
  writeAbs(join(projectDir, rel), bytes, mode, {
    exclusive: expected === null, label: rel, onPlaced,
    recheck: () => {
      checkAncestors(projectDir, rel, true);
      if (!sameState(readProject(projectDir, rel)?.state ?? null, expected)) throw new PortableRefusal('PORTABLE_DRIFT', [rel]);
    },
  });
}
/** Removes a project file after the ancestry check, only while it still holds `expected`. A file already gone is drift. */
function removeChecked(projectDir: string, rel: string, expected: FileState, onRemoved: () => void = () => {}): void {
  if (checkAncestors(projectDir, rel).length) throw new PortableRefusal('PORTABLE_DRIFT', [rel]);
  if (!sameState(readProject(projectDir, rel)?.state ?? null, expected)) throw new PortableRefusal('PORTABLE_DRIFT', [rel]);
  fs.unlinkSync(join(projectDir, rel));
  onRemoved();
  syncDir(dirname(join(projectDir, rel)));
}

/**
 * Puts back journaled files, last first: a file that holds the bytes the save wrote goes back to the bytes it replaced,
 * a file the save created is removed, and a file the save deleted comes back, with the folders above it. A file at its
 * old state is left. Any other file is left over and returned, as is a created folder that cannot be removed for a
 * reason other than holding files. Paths are relative to the project.
 */
function putBack(projectDir: string, files: readonly JournalStep[], dirs: readonly string[]): string[] {
  const left: string[] = [];
  for (const f of [...files].reverse()) {
    try {
      const now = readProject(projectDir, f.path)?.state ?? null;
      if (sameState(now, f.from)) continue;
      if (!sameState(now, f.to)) { left.push(f.path); continue; }
      if (f.from === null) removeChecked(projectDir, f.path, f.to!);
      else {
        for (const d of checkAncestors(projectDir, f.path)) makeDir(projectDir, d);
        place(projectDir, f.path, Buffer.from(f.original!, 'base64'), f.from.mode, f.to);
      }
    } catch { left.push(f.path); }
  }
  for (const d of removeEmptyDirs(projectDir, dirs)) if (d.reason === 'error' || d.reason === 'unsafe') left.push(d.path);
  return left.sort(byBytes);
}

// ---- the journal -------------------------------------------------------------------------------------------------------

function writeSaveJournal(stateDir: string, journal: SaveJournal): void {
  if (!fs.existsSync(stateDir)) fs.mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  try { stateExists(stateDir); } catch { refuse('SAVE_STATE_UNSAFE'); }
  writeAbs(join(stateDir, SAVE_JOURNAL), Buffer.from(JSON.stringify(journal, null, 2) + '\n'), 0o600);
}
function removeSaveJournal(stateDir: string): void {
  try { fs.unlinkSync(join(stateDir, SAVE_JOURNAL)); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
}

/**
 * The journal bytes: a plain private file of this user, no link, one link, at most SAVE_JOURNAL_LIMIT. The portable
 * layer reads at most 1 MiB, and a save journal holds whole files, so this read copies its checks with a larger bound.
 */
function readJournalBytes(abs: string): Buffer | null {
  let st: fs.Stats;
  try { st = fs.lstatSync(abs); } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null; return refuse('SAVE_STATE_UNSAFE'); }
  if (!st.isFile() || st.nlink !== 1 || st.uid !== uid() || st.size > SAVE_JOURNAL_LIMIT || (st.mode & 0o077) !== 0) refuse('SAVE_STATE_UNSAFE');
  let fd: number;
  try { fd = fs.openSync(abs, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK); } catch { return refuse('SAVE_STATE_UNSAFE'); }
  try {
    const open = fs.fstatSync(fd);
    if (!open.isFile() || open.ino !== st.ino || open.dev !== st.dev || open.size > SAVE_JOURNAL_LIMIT || open.nlink !== 1) refuse('SAVE_STATE_UNSAFE');
    const bytes = Buffer.alloc(open.size); let at = 0;
    while (at < bytes.length) { const n = fs.readSync(fd, bytes, at, bytes.length - at, null); if (n === 0) break; at += n; }
    if (at !== open.size || fs.readSync(fd, Buffer.alloc(1), 0, 1, null) !== 0) refuse('SAVE_STATE_UNSAFE');
    return bytes;
  } finally { fs.closeSync(fd); }
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const closed = (v: unknown, keys: readonly string[]): v is Record<string, unknown> => isObj(v) && Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
const fileState = (v: unknown): v is FileState => closed(v, ['sha256', 'mode']) && typeof v.sha256 === 'string' && HEX.test(v.sha256) && Number.isInteger(v.mode) && (v.mode as number) >= 0 && (v.mode as number) <= 0o777;
/** A state with the base64 bytes that hash to it, or null with null bytes. */
const backed = (state: unknown, bytes: unknown): boolean => state === null ? bytes === null
  : fileState(state) && typeof bytes === 'string' && bytes.length <= Math.ceil(DEFINITION_LIMITS.fileBytes / 3) * 4 && sha(Buffer.from(bytes, 'base64')) === state.sha256;
const pathList = (v: unknown): v is string[] => Array.isArray(v) && v.length <= JOURNAL_ENTRIES && v.every(journalPath) && new Set(v).size === v.length;

/**
 * The save journal, checked against its strict shape: paths inside `.bowerloom` only, and saved bytes that hash to the
 * states they stand for. `{ damaged: true }` when it is there and cannot be trusted.
 */
function readSaveJournal(stateDir: string, projectDir: string): SaveJournal | { readonly damaged: true } | null {
  let exists: boolean;
  try { exists = stateExists(stateDir); } catch { return refuse('SAVE_STATE_UNSAFE'); }
  if (!exists) return null;
  const bytes = readJournalBytes(join(stateDir, SAVE_JOURNAL));
  if (bytes === null) return null;
  let v: unknown;
  try { v = JSON.parse(bytes.toString('utf8')); } catch { return { damaged: true }; }
  const ok = closed(v, ['format', 'projectDir', 'planRevision', 'targetRevision', 'files', 'dirs', 'emptied']) && v.format === SAVE_JOURNAL_FORMAT
    && v.projectDir === projectDir && typeof v.planRevision === 'string' && HEX.test(v.planRevision)
    && typeof v.targetRevision === 'string' && DEF_REVISION.test(v.targetRevision)
    && Array.isArray(v.files) && v.files.length >= 1 && v.files.length <= JOURNAL_ENTRIES && v.files.every(f =>
      closed(f, ['path', 'from', 'to', 'original', 'bytes']) && journalPath(f.path) && (f.from !== null || f.to !== null)
      && backed(f.from, f.original) && backed(f.to, f.bytes))
    && new Set((v.files as { path: string }[]).map(f => f.path)).size === v.files.length
    && pathList(v.dirs) && pathList(v.emptied);
  return ok ? v as unknown as SaveJournal : { damaged: true };
}

// ---- recovery ----------------------------------------------------------------------------------------------------------

export interface SaveRecoveryPlan {
  readonly format: typeof SAVE_RECOVERY_FORMAT;
  readonly projectDir: string;
  /** `ok`: recovery can undo or finish the journaled save. `damaged`: the journal cannot be trusted; recovery only clears it. */
  readonly journal: 'ok' | 'damaged';
  /** For a damaged journal: every file under `.bowerloom` but the 0.7 names, which a person checks by hand. */
  readonly check: readonly string[];
  readonly planRevision: string | null;
  /** The definition revision the save was writing. */
  readonly targetRevision: string | null;
  /** What undo does, last write first: `restore` the bytes replaced, `delete` a created file, `recreate` a deleted one. */
  readonly undo: readonly { readonly path: string; readonly action: 'restore' | 'delete' | 'recreate' }[];
  /** What finish does, in write order: the steps the save had not reached. */
  readonly finish: readonly { readonly path: string; readonly action: 'create' | 'update' | 'delete' }[];
  /** Files that changed since, or cannot be read safely. Recovery leaves them, and finish is blocked. */
  readonly kept: readonly { readonly path: string; readonly reason: 'changed' | 'unsafe' }[];
  /** True when finish may run: the journal is whole and no file is kept. */
  readonly finishable: boolean;
  /** Folders the save made (undo removes each that is empty), and folders it empties (finish removes them). */
  readonly dirs: readonly string[];
  readonly emptied: readonly string[];
  readonly writesAuthorized: false;
  readonly revision: string;
}
export type SaveRecoveryMode = 'undo' | 'finish';
export interface SaveRecoveryResult {
  readonly mode: SaveRecoveryMode;
  readonly undone: readonly string[];
  readonly finished: readonly string[];
  readonly kept: SaveRecoveryPlan['kept'];
  /** Folders the save made that stay after an undo, because they hold other files or are no longer plain folders. */
  readonly leftFolders: readonly string[];
  /** The definition revision after the recovery, or null when it does not load. */
  readonly revision: string | null;
}

/** The recovery plan of a stopped save. Reads only. Paths are relative to `.bowerloom`. */
export function planSaveRecovery(input: SaveInput): SaveRecoveryPlan {
  const { projectDir, stateDir } = checkInput(input);
  return recoveryPlan(projectDir, stateDir);
}
function recoveryPlan(projectDir: string, stateDir: string): SaveRecoveryPlan {
  const journal = readSaveJournal(stateDir, projectDir);
  if (journal === null) return refuse('SAVE_RECOVER_NOTHING');
  if ('damaged' in journal) {
    const body = {
      format: SAVE_RECOVERY_FORMAT, projectDir, journal: 'damaged' as const, check: definitionFiles(projectDir), planRevision: null, targetRevision: null,
      undo: [], finish: [], kept: [], finishable: false, dirs: [], emptied: [], writesAuthorized: false as const,
    };
    return { ...body, revision: revisionOf(body) };
  }
  const undo: { path: string; action: 'restore' | 'delete' | 'recreate' }[] = [], finish: { path: string; action: 'create' | 'update' | 'delete' }[] = [];
  const kept: { path: string; reason: 'changed' | 'unsafe' }[] = [];
  for (const f of journal.files) {
    const rel = inDef(f.path);
    let now: FileState | null;
    try { now = readProject(projectDir, f.path)?.state ?? null; } catch (e) { if (e instanceof PortableRefusal) { kept.push({ path: rel, reason: 'unsafe' }); continue; } throw e; }
    if (sameState(now, f.to)) undo.push({ path: rel, action: f.from === null ? 'delete' : f.to === null ? 'recreate' : 'restore' });
    else if (sameState(now, f.from)) finish.push({ path: rel, action: f.from === null ? 'create' : f.to === null ? 'delete' : 'update' });
    else kept.push({ path: rel, reason: 'changed' });
  }
  const body = {
    format: SAVE_RECOVERY_FORMAT, projectDir, journal: 'ok' as const, check: [], planRevision: journal.planRevision, targetRevision: journal.targetRevision,
    undo: undo.reverse(), finish, kept, finishable: kept.length === 0, dirs: journal.dirs.map(inDef), emptied: journal.emptied.map(inDef), writesAuthorized: false as const,
  };
  return { ...body, revision: revisionOf(body) };
}

/**
 * Recovers a stopped save under the project lock, when the recovery plan is the one approved. `undo` puts back what
 * the save wrote and leaves a file that changed since. `finish` writes the steps the save had not reached, then checks
 * the definition is the target; it refuses SAVE_FINISH_BLOCKED when the plan is not finishable. A damaged journal is
 * only cleared, and only by `undo`.
 */
export async function runSaveRecovery(input: SaveInput, revision: string, mode: SaveRecoveryMode, signal: AbortSignal = new AbortController().signal): Promise<SaveRecoveryResult> {
  if (mode !== 'undo' && mode !== 'finish') refuse('SAVE_USAGE');
  if (typeof revision !== 'string' || !HEX.test(revision)) refuse('SAVE_STALE');
  const { projectDir, stateDir } = checkInput(input);
  return withProjectLock(projectDir, signal, async () => {
    const plan = recoveryPlan(projectDir, stateDir);
    if (plan.revision !== revision) refuse('SAVE_STALE');
    if (mode === 'finish' && !plan.finishable) refuse('SAVE_FINISH_BLOCKED', plan.kept.map(k => k.path));
    const reload = (): string | null => { const r = loadDefinition(join(projectDir, DEF)); return r.ok ? r.definition.revision : null; };
    if (plan.journal === 'damaged') { removeSaveJournal(stateDir); return { mode, undone: [], finished: [], kept: [], leftFolders: [], revision: reload() }; }
    const journal = readSaveJournal(stateDir, projectDir) as SaveJournal;

    if (mode === 'undo') {
      const want = new Set(plan.undo.map(u => inProject(u.path)));
      const left = putBack(projectDir, journal.files.filter(f => want.has(f.path)), []);
      if (left.length) refuse('SAVE_PARTIAL', left.map(inDef));
      const leftFolders = removeEmptyDirs(projectDir, journal.dirs).map(d => inDef(d.path));
      removeSaveJournal(stateDir);
      return { mode, undone: plan.undo.map(u => u.path), finished: [], kept: plan.kept, leftFolders, revision: reload() };
    }

    const want = new Set(plan.finish.map(f => inProject(f.path)));
    try {
      runSteps(projectDir, journal, journal.files.filter(f => want.has(f.path)), {
        before: () => { if (signal.aborted) refuse('SAVE_ABORTED'); }, placed: () => {}, after: () => {}, made: () => {},
      });
    } catch (error) {
      if (error instanceof SaveRefusal) throw error;
      return mapPortable(error);
    }
    const now = reload();
    if (now !== journal.targetRevision) refuse('SAVE_PARTIAL', [], [], now === null ? 'SAVE_DEFINITION_INVALID' : 'SAVE_STALE');
    removeSaveJournal(stateDir);
    return { mode, undone: [], finished: plan.finish.map(f => f.path), kept: [], leftFolders: [], revision: now };
  });
}

/**
 * Every file under `.bowerloom` whose top-level name is not a 0.7 name, relative to it, in byte order: what a damaged
 * journal may have written. Links are listed as paths and not followed. At most 4096 entries are listed.
 */
function definitionFiles(projectDir: string): string[] {
  const out: string[] = [];
  const visit = (rel: string, depth: number): void => {
    if (out.length >= 4096 || depth > DEFINITION_LIMITS.depth + 1) return;
    let names: string[];
    try { names = fs.readdirSync(join(projectDir, DEF, rel)).sort(byBytes); } catch { return; }
    for (const name of names) {
      if (rel === '' && LEGACY.has(name)) continue;
      const child = rel ? `${rel}/${name}` : name;
      let st: fs.Stats;
      try { st = fs.lstatSync(join(projectDir, DEF, child)); } catch { continue; }
      if (st.isDirectory() && !st.isSymbolicLink()) visit(child, depth + 1); else out.push(child);
    }
  };
  try { if (fs.lstatSync(join(projectDir, DEF)).isDirectory()) visit('', 1); } catch { /* no folder */ }
  return out.slice(0, 4096);
}
