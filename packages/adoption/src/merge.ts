/**
 * Merge (portable spec, section 4.1 rule 5; decision D4A): moves the text of the project's `CLAUDE.md` into the
 * definition, after a person reviews the plan. It appends the text under the heading "From CLAUDE.md" to
 * `.bowerloom/instructions/AGENTS.md`, and adds the `system-prompt` part to `harness.json` when the definition has none.
 * It edits the definition only: it never touches `CLAUDE.md` or any engine file. Install with Accept AGENTS.md then
 * turns `CLAUDE.md` into `@AGENTS.md`, and removal of that projection restores the original `CLAUDE.md`.
 *
 * - The plan reads only. It refuses an @path import, merged text over 32 KiB (the limit install enforces), and a merged
 *   definition that does not load, which includes a secret value in the text. Its revision binds every byte it reads.
 * - Apply plans again under the project lock and writes only when the revision is the one approved.
 * - Unlike adoption, a merge replaces files. Its journal, `merge-pending.json` in the adoption state folder, holds the
 *   state before and after of each file and the bytes it replaces, so a stopped merge is put back, never deleted. It is
 *   written before the first write. A failure puts back what was written; a crash leaves the journal, and every later
 *   merge plan refuses ADOPTION_RECOVERY_REQUIRED until a person approves a merge recovery.
 * - Every write goes through the portable projection's write layer: the folders above the path are checked just before
 *   the write, a new file is linked into place, and a replaced file must still hold the planned bytes.
 */
import fs from 'node:fs';
import os from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';
import { loadDefinition, parseStrictJson } from '../../harness-definition/src/index.js';
import type { Definition, Problem } from '../../harness-definition/src/index.js';
import { decodeText, toLf } from '../../harness-definition/src/json.js';
import { withProjectLock } from '../../project-context/src/index.js';
import {
  PortableRefusal, byBytes, checkAncestors, makeDir, readAbs, readProject, removeEmptyDirs, revisionOf, sameState, sha, writeAbs,
} from '../../project-sync/src/portable-files.js';
import type { FileState } from '../../project-sync/src/portable-files.js';
import { stateExists } from '../../project-sync/src/portable-state.js';
import { INSTRUCTIONS_LIMIT, atImports, readClaude } from '../../project-sync/src/portable.js';
import { checkState, readJournal } from './journal.js';
import { AdoptionRefusal, refuse } from './refusal.js';

export const MERGE_HEADING = 'From CLAUDE.md' as const;
export const MERGE_PLAN_FORMAT = 'bowerloom/instruction-merge-plan/v1beta1' as const;
export const MERGE_JOURNAL = 'merge-pending.json';
export const MERGE_JOURNAL_FORMAT = 'bowerloom/instruction-merge-pending/v1beta1' as const;
export const MERGE_RECOVERY_FORMAT = 'bowerloom/instruction-merge-recovery-plan/v1beta1' as const;

const INSTRUCTIONS = '.bowerloom/instructions/AGENTS.md';
const HARNESS = '.bowerloom/harness.json';
const INSTRUCTIONS_DIR = '.bowerloom/instructions';
const HEX = /^[a-f0-9]{64}$/;

export interface InstructionMergeInput {
  /** The real absolute path of the project folder. Its definition is `.bowerloom`. */
  readonly projectDir: string;
  /** The private state folder of adoption, outside the project. The merge journal goes there. */
  readonly stateDir: string;
}
/** One file the merge writes, relative to the project. */
export interface MergeFile {
  readonly path: string;
  readonly action: 'create' | 'update';
  readonly before: FileState | null;
  readonly after: FileState & { readonly bytes: number };
}
export interface InstructionMergePlan {
  readonly format: typeof MERGE_PLAN_FORMAT;
  readonly projectDir: string;
  /** The `CLAUDE.md` whose text moves into the definition. */
  readonly claude: FileState & { readonly bytes: number };
  readonly heading: typeof MERGE_HEADING;
  /** True when `harness.json` gains the `system-prompt` part. */
  readonly addsPart: boolean;
  /** The files written, in write order: the instructions, then `harness.json`. */
  readonly files: readonly MergeFile[];
  /** The definition revision now and after the merge. */
  readonly definition: { readonly before: string; readonly after: string };
  readonly writesAuthorized: false;
  readonly revision: string;
}
export interface InstructionMergeResult {
  readonly planRevision: string;
  /** The files written, relative to the project, in write order. */
  readonly written: readonly string[];
  /** The revision of the definition now. */
  readonly revision: string;
  readonly plan: InstructionMergePlan;
}
/** Test hooks. Not exported from the package index. An error with `crash: true` stands for a killed process. */
export interface MergeHooks { readonly beforeWrite?: (rel: string) => void; readonly afterWrite?: (rel: string) => void }

interface JournalFile { readonly path: string; readonly from: FileState | null; readonly to: FileState; readonly original: string | null }
interface MergeJournal { readonly format: typeof MERGE_JOURNAL_FORMAT; readonly projectDir: string; readonly planRevision: string; readonly files: readonly JournalFile[]; readonly dirs: readonly string[] }

// ---- input and reads ---------------------------------------------------------------------------------------------------

function checkInput(input: InstructionMergeInput): { projectDir: string; stateDir: string } {
  if (input === null || typeof input !== 'object' || Object.keys(input).some(k => k !== 'projectDir' && k !== 'stateDir')) return refuse('ADOPTION_USAGE');
  const { projectDir } = input;
  if (typeof projectDir !== 'string' || !isAbsolute(projectDir) || projectDir.includes('\0')) refuse('ADOPTION_USAGE');
  let real: string, st: fs.Stats;
  try { real = fs.realpathSync(projectDir); st = fs.lstatSync(projectDir); } catch { return refuse('ADOPTION_PROJECT_UNSAFE'); }
  if (real !== projectDir || !st.isDirectory() || st.uid !== process.getuid?.()) refuse('ADOPTION_PROJECT_UNSAFE');
  checkState(projectDir, input.stateDir);
  return { projectDir, stateDir: input.stateDir };
}

/** Runs a read of the portable layer, and maps its refusal: a path it cannot read safely is ADOPTION_PATH_UNSAFE. */
function guarded<T>(read: () => T): T {
  try { return read(); } catch (e) { if (e instanceof PortableRefusal) return refuse('ADOPTION_PATH_UNSAFE', e.paths); throw e; }
}
const inProject = (projectDir: string) => (name: string): boolean => { try { fs.lstatSync(join(projectDir, name)); return true; } catch { return false; } };
const invalid = (problems: readonly Problem[]): never => refuse('ADOPTION_DEFINITION_INVALID', [...new Set(problems.map(p => `${p.path} (${p.code})`))], problems);

/** The `harness.json` text with the `system-prompt` part first in `parts`, every other key kept in its order. */
function withPromptPart(bytes: Uint8Array): Buffer {
  const text = decodeText(bytes);
  const parsed = text === null ? null : parseStrictJson(text);
  if (!parsed?.ok || parsed.value === null || typeof parsed.value !== 'object' || Array.isArray(parsed.value)) return invalid([{ code: 'INVALID_JSON', path: 'harness.json', message: 'harness.json is not a strict JSON object.' }]);
  const harness = parsed.value as Record<string, unknown>;
  const parts = harness.parts !== null && typeof harness.parts === 'object' && !Array.isArray(harness.parts) ? harness.parts as Record<string, unknown> : {};
  const next = Object.fromEntries(Object.entries(harness).map(([k, v]) => [k, k === 'parts' ? { 'system-prompt': 'instructions/AGENTS.md', ...parts } : v]));
  return Buffer.from(JSON.stringify(next, null, 2) + '\n');
}

/**
 * Loads the definition with the merged files in a scratch folder outside the project, as the adoption plan checks its
 * files. Returns the revision of the merged definition, or refuses with the loader's problems.
 */
function mergedRevision(def: Definition, root: string, replaced: ReadonlyMap<string, { bytes: Uint8Array; mode: number }>): string {
  const scratch = fs.mkdtempSync(join(os.tmpdir(), 'bowerloom-merge-check-'));
  try {
    const at = join(scratch, '.bowerloom');
    const put = (rel: string, bytes: Uint8Array, mode: number): void => { const p = join(at, rel); fs.mkdirSync(dirname(p), { recursive: true, mode: 0o700 }); fs.writeFileSync(p, bytes, { mode }); fs.chmodSync(p, mode); };
    fs.mkdirSync(at, { mode: 0o700 });
    for (const name of ['instructions', 'skills', 'agents', 'scripts', 'engines']) {
      try { if (fs.lstatSync(join(root, name)).isDirectory()) fs.mkdirSync(join(at, name), { mode: 0o700 }); } catch { /* absent */ }
    }
    for (const f of def.files) if (!replaced.has(f.path)) put(f.path, f.bytes, f.executable ? 0o755 : 0o644);
    for (const [rel, f] of replaced) put(rel, f.bytes, f.mode);
    const r = loadDefinition(at);
    return r.ok ? r.definition.revision : invalid(r.problems);
  } finally { fs.rmSync(scratch, { recursive: true, force: true }); }
}

interface Planned { readonly plan: InstructionMergePlan; readonly bytes: ReadonlyMap<string, Buffer>; readonly originals: ReadonlyMap<string, Buffer> }

function planMerge(projectDir: string, stateDir: string): Planned {
  if (readJournal(stateDir, projectDir) !== null || readMergeJournal(stateDir, projectDir) !== null) refuse('ADOPTION_RECOVERY_REQUIRED');
  const root = join(projectDir, '.bowerloom');
  const loaded = loadDefinition(root);
  if (!loaded.ok) return invalid(loaded.problems);
  const def = loaded.definition;

  // CLAUDE.md: a file of the person's that does not follow AGENTS.md.
  const claude = guarded(() => readClaude(projectDir));
  if (claude.kind !== 'file' || claude.follows) refuse('ADOPTION_MERGE_NOTHING');
  const got = guarded(() => readProject(projectDir, 'CLAUDE.md'));
  if (got === null) return refuse('ADOPTION_MERGE_NOTHING');
  const raw = decodeText(got.bytes);
  if (raw === null) return invalid([{ code: 'TEXT_ENCODING', path: 'CLAUDE.md', message: 'CLAUDE.md must be UTF-8 text with no byte order mark and no NUL.' }]);
  const text = toLf(raw);
  if (text.trim() === '') refuse('ADOPTION_MERGE_NOTHING');
  const imports = atImports(text, inProject(projectDir));
  if (imports.length) refuse('ADOPTION_AT_IMPORT', imports.map(f => `CLAUDE.md line ${f.line}`));

  // The instructions: the definition's text, then a blank line, then the section.
  const current = guarded(() => readProject(projectDir, INSTRUCTIONS));
  const existing = current === null ? '' : decodeText(current.bytes) ?? invalid([{ code: 'TEXT_ENCODING', path: 'instructions/AGENTS.md', message: 'The instructions must be UTF-8 text.' }]);
  const section = `## ${MERGE_HEADING}\n\n${text.replace(/\n*$/, '\n')}`;
  if (toLf(existing).includes(section)) refuse('ADOPTION_MERGE_NOTHING');
  const merged = existing.trim() === '' ? section : `${existing.replace(/\n*$/, '\n')}\n${section}`;
  const mergedBytes = Buffer.from(merged);
  if (mergedBytes.length > INSTRUCTIONS_LIMIT) refuse('ADOPTION_INSTRUCTIONS_TOO_LARGE');
  const wholeImports = atImports(merged, inProject(projectDir));
  if (wholeImports.length) refuse('ADOPTION_AT_IMPORT', wholeImports.map(f => `instructions/AGENTS.md line ${f.line}`));

  const files: MergeFile[] = [], bytes = new Map<string, Buffer>(), originals = new Map<string, Buffer>();
  const replaced = new Map<string, { bytes: Uint8Array; mode: number }>();
  const add = (path: string, now: { bytes: Buffer; state: FileState } | null, next: Buffer): void => {
    const mode = now?.state.mode ?? 0o644;
    files.push({ path, action: now ? 'update' : 'create', before: now?.state ?? null, after: { sha256: sha(next), mode, bytes: next.length } });
    bytes.set(path, next);
    if (now) originals.set(path, now.bytes);
    replaced.set(path.slice('.bowerloom/'.length), { bytes: next, mode });
  };
  add(INSTRUCTIONS, current, mergedBytes);
  const addsPart = def.harness.parts['system-prompt'] === undefined;
  if (addsPart) {
    const harness = guarded(() => readProject(projectDir, HARNESS));
    if (harness === null) return invalid([{ code: 'HARNESS_MISSING', path: 'harness.json', message: 'A definition folder needs a harness.json file.' }]);
    add(HARNESS, harness, withPromptPart(harness.bytes));
  }
  const after = mergedRevision(def, root, replaced);
  const body = {
    format: MERGE_PLAN_FORMAT, projectDir, claude: { ...got.state, bytes: got.bytes.length }, heading: MERGE_HEADING, addsPart, files,
    definition: { before: def.revision, after }, writesAuthorized: false as const,
  };
  return { plan: { ...body, revision: revisionOf(body) }, bytes, originals };
}

/** The merge plan. Reads only. */
export function planInstructionMerge(input: InstructionMergeInput): InstructionMergePlan {
  const { projectDir, stateDir } = checkInput(input);
  return planMerge(projectDir, stateDir).plan;
}

// ---- apply -------------------------------------------------------------------------------------------------------------

/** The adoption code of an error: a portable write refusal maps as adoption's apply maps it. */
const codeOf = (e: unknown): string => e instanceof PortableRefusal ? (e.code === 'PORTABLE_DRIFT' ? 'ADOPTION_STALE_APPROVAL' : 'ADOPTION_PATH_UNSAFE')
  : typeof (e as { code?: unknown } | null)?.code === 'string' ? (e as { code: string }).code : 'ERROR';
const isCrash = (e: unknown): boolean => (e as { crash?: unknown } | null)?.crash === true;

/** Writes the approved merge under the project lock. */
export async function applyInstructionMerge(input: InstructionMergeInput, revision: string, signal: AbortSignal = new AbortController().signal): Promise<InstructionMergeResult> {
  return applyInstructionMergeWith(input, revision, signal, {});
}
/** applyInstructionMerge with test hooks. Not exported from the package index. */
export async function applyInstructionMergeWith(input: InstructionMergeInput, revision: string, signal: AbortSignal, hooks: MergeHooks): Promise<InstructionMergeResult> {
  if (typeof revision !== 'string' || !HEX.test(revision)) refuse('ADOPTION_STALE_APPROVAL');
  const { projectDir, stateDir } = checkInput(input);
  return withProjectLock(projectDir, signal, async () => {
    const { plan, bytes, originals } = planMerge(projectDir, stateDir);
    if (plan.revision !== revision) refuse('ADOPTION_STALE_APPROVAL');
    const dirs = [...new Set(plan.files.flatMap(f => guarded(() => checkAncestors(projectDir, f.path))))].sort(byBytes);
    const steps: JournalFile[] = plan.files.map(f => ({ path: f.path, from: f.before, to: { sha256: f.after.sha256, mode: f.after.mode }, original: f.before ? originals.get(f.path)!.toString('base64') : null }));
    writeMergeJournal(stateDir, { format: MERGE_JOURNAL_FORMAT, projectDir, planRevision: plan.revision, files: steps, dirs });

    const written: JournalFile[] = [], created: string[] = [];
    const fail = (error: unknown): never => {
      if (isCrash(error)) throw error;
      const left = putBack(projectDir, written, created);
      if (left.length) refuse('ADOPTION_PARTIAL', left, [], codeOf(error));
      removeMergeJournal(stateDir);
      if (error instanceof AdoptionRefusal) throw error;
      if (error instanceof PortableRefusal) refuse(error.code === 'PORTABLE_DRIFT' ? 'ADOPTION_STALE_APPROVAL' : 'ADOPTION_PATH_UNSAFE', error.paths);
      throw error;
    };
    try {
      for (const step of steps) {
        if (signal.aborted) refuse('ADOPTION_ABORTED');
        for (const d of checkAncestors(projectDir, step.path)) makeDir(projectDir, d, made => { created.push(made); });
        hooks.beforeWrite?.(step.path);
        place(projectDir, step.path, bytes.get(step.path)!, step.to.mode, step.from, () => { written.push(step); });
        hooks.afterWrite?.(step.path);
      }
      const loaded = loadDefinition(join(projectDir, '.bowerloom'));
      if (!loaded.ok) return invalid(loaded.problems);
      if (loaded.definition.revision !== plan.definition.after) refuse('ADOPTION_STALE_APPROVAL');
      removeMergeJournal(stateDir);
      return { planRevision: plan.revision, written: steps.map(s => s.path), revision: loaded.definition.revision, plan };
    } catch (error) { return fail(error); }
  });
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

/**
 * Puts back journaled files, last first: a file that holds the bytes the merge wrote goes back to the bytes it replaced,
 * or is removed when the merge created it. A file at its old state is left. Any other file is left over and returned,
 * as is a created folder that cannot be removed for a reason other than holding files.
 */
function putBack(projectDir: string, files: readonly JournalFile[], dirs: readonly string[]): string[] {
  const left: string[] = [];
  for (const f of [...files].reverse()) {
    try {
      const now = readProject(projectDir, f.path)?.state ?? null;
      if (sameState(now, f.from)) continue;
      if (!sameState(now, f.to)) { left.push(f.path); continue; }
      if (f.from === null) {
        checkAncestors(projectDir, f.path, true);
        if (!sameState(readProject(projectDir, f.path)?.state ?? null, f.to)) { left.push(f.path); continue; }
        fs.unlinkSync(join(projectDir, f.path));
      } else place(projectDir, f.path, Buffer.from(f.original!, 'base64'), f.from.mode, f.to);
    } catch { left.push(f.path); }
  }
  for (const d of removeEmptyDirs(projectDir, dirs)) if (d.reason === 'error' || d.reason === 'unsafe') left.push(d.path);
  return left.sort(byBytes);
}

// ---- the journal ---------------------------------------------------------------------------------------------------------

function writeMergeJournal(stateDir: string, journal: MergeJournal): void {
  if (!fs.existsSync(stateDir)) fs.mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  try { stateExists(stateDir); } catch { refuse('ADOPTION_STATE_UNSAFE'); }
  writeAbs(join(stateDir, MERGE_JOURNAL), Buffer.from(JSON.stringify(journal, null, 2) + '\n'), 0o600);
}
function removeMergeJournal(stateDir: string): void {
  try { fs.unlinkSync(join(stateDir, MERGE_JOURNAL)); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const closed = (v: unknown, keys: readonly string[]): v is Record<string, unknown> => isObj(v) && Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
const fileState = (v: unknown): v is FileState => closed(v, ['sha256', 'mode']) && typeof v.sha256 === 'string' && HEX.test(v.sha256) && Number.isInteger(v.mode) && (v.mode as number) >= 0 && (v.mode as number) <= 0o777;

/**
 * The merge journal, checked against its strict shape: only the two files a merge writes, the one folder it may make,
 * and saved bytes that hash to the state they put back. `{ damaged: true }` when it is there and cannot be trusted.
 */
function readMergeJournal(stateDir: string, projectDir: string): MergeJournal | { readonly damaged: true } | null {
  let exists: boolean;
  try { exists = stateExists(stateDir); } catch { return refuse('ADOPTION_STATE_UNSAFE'); }
  if (!exists) return null;
  let got: ReturnType<typeof readAbs>;
  try { got = readAbs(join(stateDir, MERGE_JOURNAL), MERGE_JOURNAL); } catch { return refuse('ADOPTION_STATE_UNSAFE'); }
  if (got === null) return null;
  if ((got.state.mode & 0o077) !== 0) refuse('ADOPTION_STATE_UNSAFE');
  let v: unknown;
  try { v = JSON.parse(got.bytes.toString('utf8')); } catch { return { damaged: true }; }
  const ok = closed(v, ['format', 'projectDir', 'planRevision', 'files', 'dirs']) && v.format === MERGE_JOURNAL_FORMAT && v.projectDir === projectDir
    && typeof v.planRevision === 'string' && HEX.test(v.planRevision)
    && Array.isArray(v.files) && v.files.length >= 1 && v.files.length <= 2 && v.files.every(f => {
      if (!closed(f, ['path', 'from', 'to', 'original']) || (f.path !== INSTRUCTIONS && f.path !== HARNESS) || !fileState(f.to)) return false;
      if (f.from === null) return f.original === null;
      return fileState(f.from) && typeof f.original === 'string' && sha(Buffer.from(f.original, 'base64')) === f.from.sha256;
    })
    && new Set((v.files as { path: string }[]).map(f => f.path)).size === v.files.length
    && Array.isArray(v.dirs) && v.dirs.every(d => d === '.bowerloom' || d === INSTRUCTIONS_DIR);
  return ok ? v as unknown as MergeJournal : { damaged: true };
}

// ---- recovery ----------------------------------------------------------------------------------------------------------

export interface InstructionMergeRecoveryPlan {
  readonly format: typeof MERGE_RECOVERY_FORMAT;
  readonly projectDir: string;
  /** `ok`: recovery puts back the journaled files. `damaged`: the journal cannot be trusted; recovery only clears it. */
  readonly journal: 'ok' | 'damaged';
  /** For a damaged journal: the files a person checks by hand. */
  readonly check: readonly string[];
  readonly planRevision: string | null;
  /** Files that hold the merge's bytes, in write order: `restore` puts the replaced bytes back, `delete` removes a created file. */
  readonly restore: readonly { readonly path: string; readonly action: 'restore' | 'delete' }[];
  /** Files that changed since, or cannot be read safely. Recovery leaves them. */
  readonly kept: readonly { readonly path: string; readonly reason: 'changed' | 'unsafe' }[];
  /** Folders the merge made. Recovery removes each one that is empty. */
  readonly dirs: readonly string[];
  readonly writesAuthorized: false;
  readonly revision: string;
}
export interface InstructionMergeRecoveryResult {
  readonly restored: readonly string[];
  readonly kept: InstructionMergeRecoveryPlan['kept'];
  readonly leftFolders: readonly string[];
}

/** The recovery plan of a stopped merge. Reads only. */
export function planInstructionMergeRecovery(input: InstructionMergeInput): InstructionMergeRecoveryPlan {
  const { projectDir, stateDir } = checkInput(input);
  const journal = readMergeJournal(stateDir, projectDir);
  if (journal === null) return refuse('ADOPTION_RECOVER_NOTHING');
  if ('damaged' in journal) {
    const body = { format: MERGE_RECOVERY_FORMAT, projectDir, journal: 'damaged' as const, check: [INSTRUCTIONS, HARNESS], planRevision: null, restore: [], kept: [], dirs: [], writesAuthorized: false as const };
    return { ...body, revision: revisionOf(body) };
  }
  const restore: { path: string; action: 'restore' | 'delete' }[] = [], kept: { path: string; reason: 'changed' | 'unsafe' }[] = [];
  for (const f of journal.files) {
    let now: FileState | null;
    try { now = readProject(projectDir, f.path)?.state ?? null; } catch (e) { if (e instanceof PortableRefusal) { kept.push({ path: f.path, reason: 'unsafe' }); continue; } throw e; }
    if (sameState(now, f.to)) restore.push({ path: f.path, action: f.from === null ? 'delete' : 'restore' });
    else if (!sameState(now, f.from)) kept.push({ path: f.path, reason: 'changed' });
  }
  const body = { format: MERGE_RECOVERY_FORMAT, projectDir, journal: 'ok' as const, check: [], planRevision: journal.planRevision, restore, kept, dirs: [...journal.dirs], writesAuthorized: false as const };
  return { ...body, revision: revisionOf(body) };
}

/** Puts back what a stopped merge wrote, under the project lock, when the recovery plan is the one approved. */
export async function applyInstructionMergeRecovery(input: InstructionMergeInput, revision: string, signal: AbortSignal = new AbortController().signal): Promise<InstructionMergeRecoveryResult> {
  if (typeof revision !== 'string' || !HEX.test(revision)) refuse('ADOPTION_STALE_APPROVAL');
  const { projectDir, stateDir } = checkInput(input);
  return withProjectLock(projectDir, signal, async () => {
    const plan = planInstructionMergeRecovery({ projectDir, stateDir });
    if (plan.revision !== revision) refuse('ADOPTION_STALE_APPROVAL');
    if (plan.journal === 'damaged') { removeMergeJournal(stateDir); return { restored: [], kept: [], leftFolders: [] }; }
    const journal = readMergeJournal(stateDir, projectDir) as MergeJournal;
    const wanted = journal.files.filter(f => plan.restore.some(r => r.path === f.path));
    const left = putBack(projectDir, wanted, []);
    if (left.length) refuse('ADOPTION_PARTIAL', left);
    const leftFolders = removeEmptyDirs(projectDir, plan.dirs).map(d => d.path);
    removeMergeJournal(stateDir);
    return { restored: wanted.map(f => f.path), kept: plan.kept, leftFolders };
  });
}
