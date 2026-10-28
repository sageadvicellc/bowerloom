/**
 * The adoption journal (review ruling A11). Before apply writes the first file, it writes `adoption-pending.json` in the
 * private state folder: the planned files with their hashes, and the folders it will create. A finished run, or one that
 * removed everything it wrote, deletes the journal. A run that stopped part way leaves it, and every later plan refuses
 * ADOPTION_RECOVERY_REQUIRED until a person approves a recovery plan, which removes exactly the journaled files that
 * still hold the bytes adoption wrote, through the checked primitives.
 *
 * The state folder rules are the portable projection's (`checkPaths`, `stateExists`): outside the project, normalized,
 * and a private folder of this user. The journal is read against a strict shape and must name this project.
 */
import fs from 'node:fs';
import { join } from 'node:path';
import { withProjectLock } from '../../project-context/src/index.js';
import {
  PortableRefusal, byBytes, checkAncestors, readAbs, readProject, removeEmptyDirs, revisionOf, writeAbs,
} from '../../project-sync/src/portable-files.js';
import { checkPaths, stateExists } from '../../project-sync/src/portable-state.js';
import { LEGACY_NAMES } from '../../harness-definition/src/index.js';
import { refuse } from './refusal.js';

export const JOURNAL = 'adoption-pending.json';
export const JOURNAL_FORMAT = 'bowerloom/adoption-pending/v1beta1' as const;
export const RECOVERY_PLAN_FORMAT = 'bowerloom/adoption-recovery-plan/v1beta1' as const;

export interface Journal {
  readonly format: typeof JOURNAL_FORMAT;
  readonly projectDir: string;
  readonly planRevision: string;
  /** Project-relative paths under `.bowerloom`, with the hash adoption writes. */
  readonly files: readonly { readonly path: string; readonly sha256: string }[];
  /** Project-relative folders adoption creates, parents first. */
  readonly dirs: readonly string[];
}

const HEX = /^[a-f0-9]{64}$/;
/** A project-relative path inside `.bowerloom`, or `.bowerloom` itself when `self` is true. */
export function insideDefinition(p: unknown, self = false): p is string {
  if (typeof p !== 'string' || p.length > 1024 || /[\0-\x1f\x7f\\]/.test(p)) return false;
  if (p === '.bowerloom') return self;
  const parts = p.split('/');
  return parts[0] === '.bowerloom' && parts.length > 1 && parts.slice(1).every(s => s !== '' && s !== '.' && s !== '..');
}

/** Checks the state folder against the project. Maps the portable refusals to adoption codes. */
export function checkState(projectDir: string, stateDir: unknown): asserts stateDir is string {
  if (typeof stateDir !== 'string') refuse('ADOPTION_USAGE');
  try { checkPaths(projectDir, stateDir); stateExists(stateDir); } catch (e) {
    if (e instanceof PortableRefusal) refuse(e.code === 'PORTABLE_USAGE' ? 'ADOPTION_USAGE' : 'ADOPTION_STATE_UNSAFE');
    throw e;
  }
}

/** A journal that does not parse or does not fit its shape (item C8). */
export interface DamagedJournal { readonly damaged: true }

/** The journal, checked; `{ damaged: true }` when it is there but cannot be trusted; null when there is none. */
export function readJournal(stateDir: string, projectDir: string): Journal | DamagedJournal | null {
  let exists: boolean;
  try { exists = stateExists(stateDir); } catch { return refuse('ADOPTION_STATE_UNSAFE'); }
  if (!exists) return null;
  let got: ReturnType<typeof readAbs>;
  try { got = readAbs(join(stateDir, JOURNAL), JOURNAL); } catch { return refuse('ADOPTION_STATE_UNSAFE'); }
  if (got === null) return null;
  if ((got.state.mode & 0o077) !== 0) refuse('ADOPTION_STATE_UNSAFE');
  let v: unknown;
  try { v = JSON.parse(got.bytes.toString('utf8')); } catch { return { damaged: true }; }
  const o = v as Record<string, unknown>;
  const keys = ['format', 'projectDir', 'planRevision', 'files', 'dirs'];
  const ok = typeof v === 'object' && v !== null && !Array.isArray(v) && Object.keys(o).length === keys.length && keys.every(k => Object.hasOwn(o, k))
    && o.format === JOURNAL_FORMAT && o.projectDir === projectDir && typeof o.planRevision === 'string' && HEX.test(o.planRevision)
    && Array.isArray(o.files) && o.files.length <= 8192 && o.files.every(f => {
      const r = f as Record<string, unknown>;
      return typeof f === 'object' && f !== null && Object.keys(r).length === 2 && insideDefinition(r.path) && typeof r.sha256 === 'string' && HEX.test(r.sha256);
    })
    && Array.isArray(o.dirs) && o.dirs.length <= 8192 && o.dirs.every(d => insideDefinition(d, true));
  if (!ok) return { damaged: true };
  const paths = (o.files as { path: string }[]).map(f => f.path);
  if (new Set(paths).size !== paths.length) return { damaged: true };
  return v as Journal;
}

export function writeJournal(stateDir: string, journal: Journal): void {
  if (!fs.existsSync(stateDir)) fs.mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  try { stateExists(stateDir); } catch { refuse('ADOPTION_STATE_UNSAFE'); }
  writeAbs(join(stateDir, JOURNAL), Buffer.from(JSON.stringify(journal, null, 2) + '\n'), 0o600);
}

export function removeJournal(stateDir: string): void {
  try { fs.unlinkSync(join(stateDir, JOURNAL)); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
}

// ---- recovery ----------------------------------------------------------------------------------------------------------

export interface RecoveryInput { readonly projectDir: string; readonly stateDir: string }

export interface AdoptionRecoveryPlan {
  readonly format: typeof RECOVERY_PLAN_FORMAT;
  readonly projectDir: string;
  /**
   * `ok`: recovery removes the journaled files that still hold adoption's bytes. `damaged`: the journal cannot be
   * trusted, so recovery only clears it, and `check` lists the files a person checks by hand (item C8).
   */
  readonly journal: 'ok' | 'damaged';
  /** For a damaged journal: every file under `.bowerloom` whose top-level name is not a 0.7 name. */
  readonly check: readonly string[];
  /** The journaled plan revision, or null for a damaged journal. */
  readonly planRevision: string | null;
  /** Journaled files that still hold the bytes adoption wrote. Recovery removes them. */
  readonly remove: readonly string[];
  /** Journaled files that changed since, or cannot be read safely. Recovery leaves them. */
  readonly kept: readonly { readonly path: string; readonly reason: 'changed' | 'unsafe' }[];
  /** Journaled folders. Recovery removes each one that is empty. */
  readonly dirs: readonly string[];
  readonly writesAuthorized: false;
  readonly revision: string;
}

export interface AdoptionRecoveryResult {
  readonly removed: readonly string[];
  readonly kept: AdoptionRecoveryPlan['kept'];
  /** Folders that stay, because they hold a file adoption did not write, or are no longer a plain folder. */
  readonly leftFolders: readonly string[];
}

function checkRecoveryInput(input: RecoveryInput): { projectDir: string; stateDir: string } {
  if (input === null || typeof input !== 'object' || Object.keys(input).some(k => k !== 'projectDir' && k !== 'stateDir')) refuse('ADOPTION_USAGE');
  const { projectDir, stateDir } = input;
  if (typeof projectDir !== 'string') refuse('ADOPTION_USAGE');
  checkState(projectDir, stateDir);
  return { projectDir, stateDir };
}

/** The recovery plan of a stopped adoption. Reads only. */
export function planAdoptionRecovery(input: RecoveryInput): AdoptionRecoveryPlan {
  const { projectDir, stateDir } = checkRecoveryInput(input);
  const journal = readJournal(stateDir, projectDir);
  if (journal === null) return refuse('ADOPTION_RECOVER_NOTHING');
  if ('damaged' in journal) {
    const body = { format: RECOVERY_PLAN_FORMAT, projectDir, journal: 'damaged' as const, check: definitionFiles(projectDir), planRevision: null, remove: [], kept: [], dirs: [], writesAuthorized: false as const };
    return { ...body, revision: revisionOf(body) };
  }
  const remove: string[] = [], kept: { path: string; reason: 'changed' | 'unsafe' }[] = [];
  for (const f of [...journal.files].sort((a, b) => byBytes(a.path, b.path))) {
    let now: ReturnType<typeof readProject>;
    try { now = readProject(projectDir, f.path); } catch (e) { if (e instanceof PortableRefusal) { kept.push({ path: f.path, reason: 'unsafe' }); continue; } throw e; }
    if (now === null) continue;
    if (now.state.sha256 === f.sha256) remove.push(f.path); else kept.push({ path: f.path, reason: 'changed' });
  }
  const body = { format: RECOVERY_PLAN_FORMAT, projectDir, journal: 'ok' as const, check: [], planRevision: journal.planRevision, remove, kept, dirs: [...journal.dirs], writesAuthorized: false as const };
  return { ...body, revision: revisionOf(body) };
}

/** Removes what a stopped adoption wrote, under the project lock, when the recovery plan is the one approved. */
export async function applyAdoptionRecovery(input: RecoveryInput, revision: string, signal: AbortSignal = new AbortController().signal): Promise<AdoptionRecoveryResult> {
  if (typeof revision !== 'string' || !HEX.test(revision)) refuse('ADOPTION_STALE_APPROVAL');
  const { projectDir, stateDir } = checkRecoveryInput(input);
  return withProjectLock(projectDir, signal, async () => {
    const plan = planAdoptionRecovery({ projectDir, stateDir });
    if (plan.revision !== revision) refuse('ADOPTION_STALE_APPROVAL');
    if (plan.journal === 'damaged') { removeJournal(stateDir); return { removed: [], kept: [], leftFolders: [] }; }
    const journal = readJournal(stateDir, projectDir) as Journal;
    const want = new Map(journal.files.map(f => [f.path, f.sha256]));
    const removed: string[] = [];
    for (const rel of plan.remove) {
      if (checkAncestors(projectDir, rel, true).length) continue;
      const now = readAbs(join(projectDir, rel), rel);
      if (now === null) continue;
      if (now.state.sha256 !== want.get(rel)) refuse('ADOPTION_STALE_APPROVAL', [rel]);
      fs.unlinkSync(join(projectDir, rel));
      removed.push(rel);
    }
    const leftFolders = removeEmptyDirs(projectDir, plan.dirs).map(d => d.path);
    removeJournal(stateDir);
    return { removed, kept: plan.kept, leftFolders };
  });
}

/**
 * Every file under `.bowerloom` whose top-level name is not a 0.7 name, in byte order: what a damaged journal may have
 * written. Links are listed as paths and not followed. At most 4096 entries are listed.
 */
function definitionFiles(projectDir: string): string[] {
  const out: string[] = [];
  const legacy = new Set<string>(LEGACY_NAMES);
  const walk = (rel: string, depth: number): void => {
    if (out.length >= 4096 || depth > 16) return;
    let names: string[];
    try { names = fs.readdirSync(join(projectDir, rel)).sort(byBytes); } catch { return; }
    for (const name of names) {
      if (depth === 1 && legacy.has(name)) continue;
      const child = `${rel}/${name}`;
      let st: fs.Stats;
      try { st = fs.lstatSync(join(projectDir, child)); } catch { continue; }
      if (st.isDirectory() && !st.isSymbolicLink()) walk(child, depth + 1); else out.push(child);
    }
  };
  try { if (fs.lstatSync(join(projectDir, '.bowerloom')).isDirectory()) walk('.bowerloom', 1); } catch { /* no folder */ }
  return out.slice(0, 4096);
}
