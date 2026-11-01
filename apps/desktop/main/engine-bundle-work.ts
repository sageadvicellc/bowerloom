/**
 * The work of export and import that must not run on Electron's main thread (packages/harness-bundle README, "Where to run it"): decode, inspect and encode a bundle,
 * build the target of an import, plan it, and write it. main/engine-bundle-worker.ts runs these in a worker thread; main/engine-bundle.ts is the host that sends the jobs.
 * Everything here takes plain input and gives plain output, and imports nothing of Electron.
 *
 * The worker holds the decoded bundles (at most SHARE_HELD_BUNDLES), because a decoded bundle copied across a thread boundary loses the definition that `decodeBundle`
 * loaded, and the next call would load every file again. Main holds only the summary and the hash of each.
 *
 * The write of an import is the existing journaled save (packages/adoption `applySave`), with the save points before and after, exactly as `saveAndKeep` in
 * engine-service.ts does. The one thing it adds is for a folder with no harness: an EMPTY harness (`harness.json` alone, no parts) is made first, and the save then
 * fills it. A failure of the save leaves that valid empty harness and none of the bundle's files.
 */
import { createHash } from 'node:crypto';
import { lstatSync, readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { canonicalJson, DefinitionError } from '../../../packages/contracts/src/index.js';
import {
  BundleRefusal, decodeBundle, encodeBundle, importAcknowledgement, inspectBundle, isEmptyHarness, targetFromBundle,
} from '../../../packages/harness-bundle/src/index.js';
import type { BundleSummary, DecodedBundle, ImportChoices } from '../../../packages/harness-bundle/src/index.js';
import { HARNESS_FORMAT, LEGACY_NAMES, loadDefinition } from '../../../packages/harness-definition/src/index.js';
import type { DefinitionFile } from '../../../packages/harness-definition/src/index.js';
import { SaveRefusal, applySave, planSave as packagePlanSave } from '../../../packages/adoption/src/index.js';
import { refuseWhileStopped } from '../../../packages/adoption/src/merge.js';
import { removeJournal, writeJournal } from '../../../packages/adoption/src/journal.js';
import { withProjectLock } from '../../../packages/project-context/src/index.js';
import { PortableRefusal, checkAncestors, makeDir, readAbs, removeEmptyDirs, sha, writeAbs } from '../../../packages/project-sync/src/portable-files.js';
import type { HarnessStateDirs } from '../../../packages/project-sync/src/harness-state.js';
import { EXPORT_NO_DEFINITION, IMPORT_FOLDER_HAS_HARNESS, IMPORT_NEEDS_ACKNOWLEDGEMENT, NOT_THE_PLAN_SHOWN, SAVE_NO_DEFINITION, SHARE_HELD_BUNDLES, SHARE_MAIN_WORDS } from '../shared/engine/types.js';
import type { DefinitionView } from '../shared/engine/types.js';
import { afterSaveWarnings, currentDefinition, keepAfter, keepBefore, keepable, saveCodeOf, targetView } from './engine-save.js';
import type { PlanChange } from './engine-save.js';
import { UNKNOWN_BUNDLE_MARK } from './engine-bundle-mark.js';

export { UNKNOWN_BUNDLE_MARK };

// ---- the jobs ---------------------------------------------------------------------------------------------------------------

/** What the notes choices carry across the thread boundary: a Map and a Set, as the package takes them. Names are untrusted keys. */
export interface WireChoices { readonly link: ReadonlyMap<string, string>; readonly leave: ReadonlySet<string> }
interface FolderIo { readonly projectDir: string; readonly adoptState: string }

export type Job =
  | { readonly op: 'decode'; readonly key: string; readonly bytes: Uint8Array }
  | { readonly op: 'drop'; readonly key: string }
  | { readonly op: 'encode'; readonly projectDir: string; readonly home: string; readonly user: string; readonly wantBytes: boolean }
  | ({ readonly op: 'plan'; readonly key: string; readonly choices: WireChoices } & FolderIo)
  | ({ readonly op: 'write'; readonly key: string; readonly choices: WireChoices; readonly revision: string; readonly acknowledged: string | null; readonly dirs: HarnessStateDirs; readonly now: string } & FolderIo);

export interface DecodedView { readonly sha256: string; readonly bytes: number; readonly harness: string; readonly summary: BundleSummary }
export interface EncodedView { readonly sha256: string; readonly size: number; readonly summary: BundleSummary; readonly bytes: Uint8Array | null }
export interface PlanResult {
  readonly revision: string; readonly changes: readonly PlanChange[]; readonly outline: DefinitionView; readonly makes: boolean;
  readonly acknowledge: string | null; readonly executables: readonly string[];
}
/** `pointCode` is the code of the refusal when the save point after the write could not be kept (the write itself is done), else null. */
export interface WriteResult { readonly written: readonly string[]; readonly version: string | null; readonly warnings: readonly string[]; readonly pointCode: string | null }

interface Held { readonly bundle: DecodedBundle; readonly summary: BundleSummary }
const held = new Map<string, Held>();

const heldOf = (key: string): Held => {
  const got = held.get(key);
  if (got === undefined) throw new DefinitionError(UNKNOWN_BUNDLE_MARK, 'Bowerloom no longer holds that file.');
  return got;
};

/** The files of a bundle are re-read from the worker's held copy; a choices object from outside is rebuilt, so no property of a plain object is read. */
const choicesOf = (c: WireChoices): ImportChoices => {
  if (!(c.link instanceof Map) || !(c.leave instanceof Set)) throw new BundleRefusal('BUNDLE_USAGE');
  return { link: new Map(c.link), leave: new Set(c.leave) };
};

export async function run(job: Job): Promise<unknown> {
  switch (job.op) {
    case 'drop': held.delete(job.key); return null;
    case 'decode': return decode(job);
    case 'encode': return encode(job);
    case 'plan': return plan(job);
    case 'write': return write(job);
  }
}

// ---- decode -----------------------------------------------------------------------------------------------------------------

async function decode(job: Extract<Job, { op: 'decode' }>): Promise<DecodedView> {
  const bundle = await decodeBundle(job.bytes);
  const summary = inspectBundle(bundle);
  held.set(job.key, { bundle, summary });
  while (held.size > SHARE_HELD_BUNDLES) held.delete(held.keys().next().value!);
  return { sha256: bundle.sha256, bytes: bundle.bytes, harness: bundle.harness, summary };
}

// ---- encode -----------------------------------------------------------------------------------------------------------------

async function encode(job: Extract<Job, { op: 'encode' }>): Promise<EncodedView> {
  let def;
  try { def = currentDefinition(job.projectDir); } catch (error) {
    if ((error as { code?: unknown } | null)?.code === SAVE_NO_DEFINITION) throw new DefinitionError(EXPORT_NO_DEFINITION, SHARE_MAIN_WORDS.EXPORT_NO_DEFINITION);
    throw error;
  }
  const encoded = await encodeBundle(def, { home: job.home, user: job.user });
  const b = encoded.bytes;
  // A view that covers its whole buffer is transferred to main; any other is copied once here, so no other view of its buffer is cut off.
  const whole = b.byteOffset === 0 && b.byteLength === b.buffer.byteLength ? b : Uint8Array.from(b);
  return { sha256: encoded.sha256, size: b.length, summary: encoded.summary, bytes: job.wantBytes ? whole : null };
}

// ---- plan -------------------------------------------------------------------------------------------------------------------

const LEGACY = new Set<string>(LEGACY_NAMES);
/** The description "Make an empty harness here" writes; the package counts a harness with this description and no parts as empty (a test keeps the two equal). */
const EMPTY_HARNESS_DESCRIPTION = 'Adopted from the engine files of this project.';
const DEF = '.bowerloom';
const byPath = (a: { path: string }, b: { path: string }): number => Buffer.compare(Buffer.from(a.path), Buffer.from(b.path));
const hex = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex');

/** The harness.json of an empty harness: no part, the two common engines, and the description that marks a harness as made empty. The same bytes at the plan and at the write. */
export function emptyHarnessFile(projectDir: string): DefinitionFile {
  const slug = projectDir.slice(projectDir.lastIndexOf('/') + 1).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64).replace(/-+$/, '');
  const id = /^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug) ? slug : 'imported';
  const json = { format: HARNESS_FORMAT, id, description: EMPTY_HARNESS_DESCRIPTION, engines: [{ id: 'claude-code' }, { id: 'codex' }], parts: {} };
  return { path: 'harness.json', bytes: Buffer.from(`${JSON.stringify(json, null, 2)}\n`), executable: false };
}

/** The system error code of a failed file call (EACCES, ELOOP, ENOTDIR), kept as the cause of the refusal so the log says why; never a path. */
const errnoOf = (error: unknown): string | undefined => { const c = (error as NodeJS.ErrnoException | null)?.code; return typeof c === 'string' && /^[A-Z0-9_]{1,40}$/.test(c) ? c : undefined; };

/** True when the folder has `.bowerloom/harness.json` as a plain file; false when it is missing. Any other state is the package's SAVE_PATH_UNSAFE. */
function harnessExists(projectDir: string): boolean {
  let plain: boolean;
  try { plain = lstatSync(join(projectDir, DEF, 'harness.json')).isFile(); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw new SaveRefusal('SAVE_PATH_UNSAFE', ['harness.json'], [], errnoOf(error));
  }
  if (!plain) throw new SaveRefusal('SAVE_PATH_UNSAFE', ['harness.json']);
  return true;
}

/** A `.bowerloom` that is there without a harness.json may hold only the 0.7 names and the odd system file, or the empty harness could not load beside it. */
function checkDefinitionFolder(projectDir: string): void {
  let st;
  try { st = lstatSync(join(projectDir, DEF)); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw new SaveRefusal('SAVE_PATH_UNSAFE', [DEF], [], errnoOf(error));
  }
  if (st.isSymbolicLink() || !st.isDirectory()) throw new SaveRefusal('SAVE_PATH_UNSAFE', [DEF]);
  const odd = readdirSync(join(projectDir, DEF)).filter(name => !LEGACY.has(name) && name !== '.DS_Store' && name !== '.gitkeep');
  if (odd.length > 0) throw new SaveRefusal('SAVE_PATH_UNSAFE', odd.slice(0, 20).map(name => `${DEF}/${name}`));
}

interface Built { readonly target: readonly DefinitionFile[]; readonly result: PlanResult; readonly io: { projectDir: string; stateDir: string } }

/**
 * The plan of an import from the held bundle and the choices, in the worker. A folder with a harness must hold an empty one (IMPORT_FOLDER_HAS_HARNESS otherwise), and the
 * package plans the save. A folder with no harness gets a plan made here: every file a create, `harness.json` last, and a revision that holds the harness state ("none")
 * and the empty harness it will make, so a harness made between the plan and the write is another plan.
 */
function build(job: { readonly key: string; readonly choices: WireChoices } & FolderIo): Built {
  // Nothing is planned on a folder whose adoption, merge or save stopped part way: the person finishes that first.
  refuseWhileStopped(job.adoptState);
  const h = heldOf(job.key);
  const target = targetFromBundle(h.bundle, choicesOf(job.choices));
  const io = { projectDir: job.projectDir, stateDir: job.adoptState };
  const exists = harnessExists(job.projectDir);
  let changes: PlanChange[], revision: string;
  if (exists) {
    const current = currentDefinition(job.projectDir);
    if (!isEmptyHarness(current)) throw new DefinitionError(IMPORT_FOLDER_HAS_HARNESS, SHARE_MAIN_WORDS.IMPORT_FOLDER_HAS_HARNESS);
    const plan = packagePlanSave(io, target);
    if (plan.changes.length > 0) keepable(current.files, target);
    changes = plan.changes.map(c => ({ path: c.path, action: c.action, before: c.before === null ? null : { sha256: c.before.sha256, mode: c.before.mode }, after: c.after === null ? null : { sha256: c.after.sha256, mode: c.after.mode } }));
    revision = plan.revision;
  } else {
    checkDefinitionFolder(job.projectDir);
    const empty = emptyHarnessFile(job.projectDir);
    keepable([empty], target);
    const sorted = [...target].sort(byPath);
    const mode = (f: DefinitionFile): number => (f.executable === true ? 0o755 : 0o644);
    const rows = sorted.map(f => ({ path: f.path, action: 'create' as const, before: null, after: { sha256: hex(f.bytes), mode: mode(f) } }));
    changes = [...rows.filter(c => c.path !== 'harness.json'), ...rows.filter(c => c.path === 'harness.json')];
    revision = hex(canonicalJson({ format: 'bowerloom/import-new-harness-plan/v1beta1', state: 'no-harness', empty: hex(empty.bytes), files: [...rows.filter(c => c.path !== 'harness.json'), ...rows.filter(c => c.path === 'harness.json')].map(c => [c.path, c.after.sha256, c.after.mode]) }));
  }
  const executables = changes.filter(c => c.after !== null && (c.after.mode & 0o111) !== 0).map(c => c.path);
  const outline = targetView(target, job.projectDir);
  return { target, io, result: { revision, changes, outline, makes: !exists, acknowledge: importAcknowledgement(h.summary, executables, revision), executables } };
}

function plan(job: Extract<Job, { op: 'plan' }>): PlanResult { return build(job).result; }

// ---- write ------------------------------------------------------------------------------------------------------------------

/** Seams for the tests of this module, never set in the app: the function runs right after the empty harness file is placed. */
export const emptyHarnessHooks: { afterPlace?: () => void } = {};

/**
 * Makes the empty harness in a folder that has none: the one new file `.bowerloom/harness.json` (and `.bowerloom` when it is not there), under the project lock, with the
 * adoption journal so a stopped run is recovered by the same "Finish a stopped harness" step. The file is created exclusively, so a harness made since the plan is never
 * overwritten. It must load afterwards. On any failure it removes what it made.
 */
async function makeEmptyHarness(projectDir: string, stateDir: string, revision: string): Promise<void> {
  await withProjectLock(projectDir, new AbortController().signal, async () => {
    if (harnessExists(projectDir)) throw new DefinitionError(NOT_THE_PLAN_SHOWN, 'This is not the plan Bowerloom showed last for this folder, with these choices. Nothing was written. Plan again.');
    // Inside the lock: a run that stopped part way since main looked keeps its journal. This write never overwrites or removes another run's record.
    refuseWhileStopped(stateDir);
    checkDefinitionFolder(projectDir);
    const file = emptyHarnessFile(projectDir), rel = `${DEF}/harness.json`, digest = sha(file.bytes);
    const dirs = checkAncestors(projectDir, rel);
    const created: string[] = [];
    let placed = false;
    writeJournal(stateDir, { format: 'bowerloom/adoption-pending/v1beta1', projectDir, planRevision: revision, files: [{ path: rel, sha256: digest }], dirs });
    const undo = (): string[] => {
      const left: string[] = [];
      try {
        const now = readAbs(join(projectDir, rel), rel);
        if (placed && now !== null && now.state.sha256 === digest && checkAncestors(projectDir, rel).length === 0) unlinkSync(join(projectDir, rel)); else if (now !== null) left.push(rel);
      } catch { left.push(rel); }
      for (const d of removeEmptyDirs(projectDir, created)) if (d.reason === 'error') left.push(d.path);
      return left;
    };
    try {
      for (const dir of dirs) makeDir(projectDir, dir, made => { created.push(made); });
      writeAbs(join(projectDir, rel), file.bytes, 0o644, {
        exclusive: true, label: rel,
        recheck: () => { if (checkAncestors(projectDir, rel, true).length) throw new PortableRefusal('PORTABLE_PATH_UNSAFE', [rel]); },
        onPlaced: () => { placed = true; },
      });
      emptyHarnessHooks.afterPlace?.();
      const loaded = loadDefinition(join(projectDir, DEF));
      if (!loaded.ok || loaded.definition.files.length !== 1) throw new SaveRefusal('SAVE_DEFINITION_INVALID', [...new Set((loaded.ok ? [] : loaded.problems).map(p => `${p.path} (${p.code})`))]);
      removeJournal(stateDir);
    } catch (error) {
      const left = undo();
      if (left.length > 0) throw new SaveRefusal('SAVE_PARTIAL', left, [], saveCodeOf(error));
      // A journal that cannot be removed keeps the run "stopped", and the refusal says so; it never replaces the error that stopped the run.
      try { removeJournal(stateDir); } catch { throw new SaveRefusal('SAVE_PARTIAL', [], [], saveCodeOf(error)); }
      if (error instanceof PortableRefusal) throw new SaveRefusal(error.code === 'PORTABLE_DRIFT' ? 'SAVE_STALE' : 'SAVE_PATH_UNSAFE', error.paths);
      throw error;
    }
  });
}

/**
 * A refusal that comes after the empty harness was made says so: the words of the package end in "Nothing was written", which is no longer true of the folder. The code,
 * the paths and the problems stay as they were; an error with no code and words passes on unchanged.
 */
function keepNote(error: unknown): unknown {
  const e = error as { code?: unknown; message?: unknown; paths?: unknown; problems?: unknown } | null;
  // SAVE_PARTIAL names files that were left, so it keeps its own words.
  if (e === null || typeof e !== 'object' || typeof e.code !== 'string' || typeof e.message !== 'string' || e.code === 'SAVE_PARTIAL') return error;
  const said = e.message.replace(/\s*Nothing (?:more )?was (?:written|changed)\./g, '').replace(/, so the save writes nothing/, '.').trim();
  const out = new DefinitionError(e.code, `${said} No file of the bundle was written. An empty harness was made in this folder first, and it stays.`);
  Object.assign(out, { paths: Array.isArray(e.paths) ? e.paths : [], problems: Array.isArray(e.problems) ? e.problems : [] });
  return out;
}

/**
 * Plans again, checks the revision and the acknowledgement the person approved, makes the empty harness when the folder has none, then writes the target as one journaled
 * save with a save point before and after (the same steps as `saveAndKeep` in engine-service.ts). A revision that is not the one approved is NOT_THE_PLAN_SHOWN; an
 * acknowledgement that is not the one the plan asks for is IMPORT_NEEDS_ACKNOWLEDGEMENT. Nothing is written in either case.
 */
async function write(job: Extract<Job, { op: 'write' }>): Promise<WriteResult> {
  const built = build(job);
  if (built.result.revision !== job.revision) throw new DefinitionError(NOT_THE_PLAN_SHOWN, 'This is not the plan Bowerloom showed last for this folder, with these choices. Nothing was written. Plan again.');
  if (built.result.acknowledge !== job.acknowledged) throw new DefinitionError(IMPORT_NEEDS_ACKNOWLEDGEMENT, SHARE_MAIN_WORDS.IMPORT_NEEDS_ACKNOWLEDGEMENT);
  const { target, io } = built;
  const at = new Date(job.now);
  let saveRevision = job.revision;
  if (built.result.makes) await makeEmptyHarness(job.projectDir, job.adoptState, job.revision);
  try {
    if (built.result.makes) {
      // The save plans against the empty harness that now exists. It must write exactly the files the person was shown.
      const fresh = packagePlanSave(io, target);
      const shown = new Set(built.result.changes.map(c => c.path)), now = new Set(fresh.changes.map(c => c.path));
      if (shown.size !== now.size || [...shown].some(p => !now.has(p))) throw new SaveRefusal('SAVE_STALE');
      saveRevision = fresh.revision;
    }
    if (packagePlanSave(io, target).changes.length > 0) {
      keepable(currentDefinition(job.projectDir).files, target);
      await keepBefore(job.projectDir, job.dirs, at);
    }
    return await saveAndKeepPoints(job, io, target, saveRevision, at);
  } catch (error) {
    throw built.result.makes ? keepNote(error) : error;
  }
}

async function saveAndKeepPoints(job: Extract<Job, { op: 'write' }>, io: { projectDir: string; stateDir: string }, target: readonly DefinitionFile[], saveRevision: string, at: Date): Promise<WriteResult> {
  const r = await applySave(io, saveRevision, target);
  if (r.written.length === 0) return { written: [], version: null, warnings: afterSaveWarnings(r.journalLeft, null), pointCode: null };
  let version: string | null = null, pointError: unknown = null;
  try { version = await keepAfter(job.projectDir, job.dirs, target, r.revision, `Imported ${r.written.length} ${r.written.length === 1 ? 'file' : 'files'}`, at); } catch (error) { pointError = error; }
  return { written: [...r.written], version, warnings: afterSaveWarnings(r.journalLeft, pointError), pointCode: pointError === null ? null : saveCodeOf(pointError) };
}
