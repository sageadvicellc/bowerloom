/**
 * The file layer of the portable projection: its refusals, the shapes of the paths it may touch, and every read and
 * write inside the project. Each write, rename, unlink, and folder creation checks every folder from the project root
 * down immediately before it acts: no link, a real folder, owned by this user, and a parent whose real path is the path
 * Bowerloom expects. So a folder swapped for a link between the plan and the write is refused, never followed.
 */
import fs from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { dirname, join } from 'node:path';
import { canonicalJson, DefinitionError, oneLine } from '../../contracts/src/index.js';
import { isId } from '../../harness-definition/src/index.js';
import type { Problem } from '../../harness-definition/src/index.js';

// ---- refusals ----------------------------------------------------------------------------------------------------------

const MESSAGES = {
  PORTABLE_DEFINITION_INVALID: 'The harness definition cannot be loaded, so nothing was projected.',
  PORTABLE_AT_IMPORT: 'instructions/AGENTS.md uses an @path import. Only Claude Code expands one; Codex and OpenCode read it as text. Nothing was projected.',
  PORTABLE_INSTRUCTIONS_TOO_LARGE: 'instructions/AGENTS.md is larger than 32 KiB, where Codex stops loading instructions. Nothing was projected.',
  PORTABLE_ENGINE_NOT_LISTED: 'The projection names an engine that harness.json does not list. Nothing was projected.',
  PORTABLE_MERGE_NOT_BUILT: 'Merge moves the CLAUDE.md text into the definition, and this projection does not edit the definition. Choose Accept AGENTS.md or Keep both. Nothing was projected.',
  PORTABLE_PATH_UNSAFE: 'A path Bowerloom would read, write, or restore is a link, is not a plain file or folder, has more than one link, is not yours, is larger than 1 MiB, or sits in a folder that is not where Bowerloom expects it. Nothing more was changed.',
  PORTABLE_PATH_OCCUPIED: 'A skill folder Bowerloom would write already holds files that Bowerloom did not project. Nothing was changed.',
  PORTABLE_MANAGED_COPY: 'A skill folder Bowerloom would write holds a copy that a 0.7 skills sync manages. Adoption (step 3) converts it. Nothing was changed.',
  PORTABLE_CASE_CLASH: 'Two paths differ only in the case of their letters, and many file systems treat them as one. Nothing was changed.',
  PORTABLE_DRIFT: 'A file Bowerloom projected, or a file it was about to replace, changed since the plan. Nothing more was changed.',
  PORTABLE_STATE_UNSAFE: 'The private state folder of the projection is not safe: it must be a normalized path to a real folder you own, mode 0700, outside the project.',
  PORTABLE_STATE_INVALID: 'A record in the private state folder of the projection is damaged or names a path Bowerloom never projects. Nothing was changed.',
  PORTABLE_STATE_FOREIGN: 'The private state folder holds the projection of another project. Nothing was changed.',
  PORTABLE_RECOVERY_REQUIRED: 'An earlier projection or removal stopped part way. Nothing was changed. Recover it first.',
  PORTABLE_PARTIAL: 'The run stopped part way. Some files are not as planned, and the pending marker is kept. Recover the projection before anything else.',
  PORTABLE_LOCK_LOST: 'The project lock was lost during the run, so Bowerloom stopped and touched nothing more. The pending marker is kept. Recover the projection.',
  PORTABLE_FIDELITY: 'The loss report of the projection does not pass the fidelity check. Nothing was projected.',
  PORTABLE_NOTHING_PROJECTED: 'This project has no projection receipt, so there is nothing to remove.',
  PORTABLE_RECOVER_NOTHING: 'No projection or removal of this project is unfinished, and no path to keep was named.',
  PORTABLE_USAGE: 'The projection input is not valid.',
} as const;
export type PortableCode = keyof typeof MESSAGES;
export const PORTABLE_REFUSAL_CODES: readonly PortableCode[] = Object.freeze(Object.keys(MESSAGES) as PortableCode[]);

/** A projection refusal. `paths` names what it is about, `problems` the loader's problems. */
export class PortableRefusal extends DefinitionError {
  constructor(code: PortableCode, readonly paths: readonly string[] = [], readonly problems: readonly Problem[] = [], detail = '') {
    super(code, `${MESSAGES[code]}${detail ? ` ${detail}` : ''}${paths.length ? ` ${oneLine(paths.slice(0, 20).join(', '))}${paths.length > 20 ? `, and ${paths.length - 20} more` : ''}.` : ''}`);
    this.name = 'PortableRefusal';
  }
}
export function refuse(code: PortableCode, paths: readonly string[] = [], problems: readonly Problem[] = []): never { throw new PortableRefusal(code, paths, problems); }
export const isRefusal = (e: unknown, code: PortableCode): boolean => e instanceof PortableRefusal && e.code === code;

// ---- small helpers -----------------------------------------------------------------------------------------------------

export interface FileState { readonly sha256: string; readonly mode: number }
export interface FileAfter extends FileState { readonly bytes: number }
export const MAX_FILE = 1024 * 1024;
export const sha = (b: Uint8Array | string): string => createHash('sha256').update(b).digest('hex');
export const revisionOf = (body: unknown): string => sha(canonicalJson(body));
export const byBytes = (a: string, b: string): number => Buffer.compare(Buffer.from(a), Buffer.from(b));
export const uid = (): number | undefined => process.getuid?.();
export const sameState = (a: FileState | null, b: FileState | null): boolean => a === null ? b === null : b !== null && a.sha256 === b.sha256 && a.mode === b.mode;
const code = (e: unknown): string | undefined => (e as NodeJS.ErrnoException | null)?.code;

// ---- path shapes (review ruling P1) ------------------------------------------------------------------------------------

export const SKILL_ROOT_DIRS = ['.claude/skills', '.agents/skills'] as const;
const SEGMENT = /^[^/\\\0\p{Cc}]+$/u;
const goodSegment = (s: string): boolean => SEGMENT.test(s) && s !== '.' && s !== '..' && !s.startsWith('.') && Buffer.byteLength(s) <= 255;
/**
 * True for a path the projection may write: exactly `AGENTS.md` or `CLAUDE.md`, or a file of a skill folder under
 * `.claude/skills/<id>/` or `.agents/skills/<id>/`, with a valid id and no empty, `.`, `..`, hidden, or absolute segment.
 */
export function isProjectedPath(rel: unknown): rel is string {
  if (rel === 'AGENTS.md' || rel === 'CLAUDE.md') return true;
  if (typeof rel !== 'string' || rel.length > 1024) return false;
  const parts = rel.split('/');
  return parts.length >= 4 && (parts[0] === '.claude' || parts[0] === '.agents') && parts[1] === 'skills' && isId(parts[2]) && parts.slice(3).every(goodSegment);
}
/** True for a folder the projection may create: `.claude`, `.agents`, a skill root, or a folder inside a skill folder. */
export function isProjectedDir(rel: unknown): rel is string {
  if (rel === '.claude' || rel === '.agents' || rel === '.claude/skills' || rel === '.agents/skills') return true;
  if (typeof rel !== 'string' || rel.length > 1024) return false;
  const parts = rel.split('/');
  return parts.length >= 3 && (parts[0] === '.claude' || parts[0] === '.agents') && parts[1] === 'skills' && isId(parts[2]) && parts.slice(3).every(goodSegment);
}

// ---- checked ancestry (review ruling P2) -------------------------------------------------------------------------------

/**
 * Checks every folder between the project and `rel` from the root down: each that exists must be a real folder of this
 * user, not a link. Returns the folders that do not exist yet, parents first. When the parent exists, its real path must
 * be the path Bowerloom expects. Refuses PORTABLE_PATH_UNSAFE otherwise. `needParent` refuses a missing parent too.
 */
export function checkAncestors(projectDir: string, rel: string, needParent = false): string[] {
  const parts = rel.split('/').slice(0, -1), missing: string[] = [];
  for (let i = 1; i <= parts.length; i++) {
    const dir = parts.slice(0, i).join('/');
    if (missing.length) { missing.push(dir); continue; }
    let st: fs.Stats;
    try { st = fs.lstatSync(join(projectDir, dir)); } catch (e) {
      if (code(e) !== 'ENOENT') refuse('PORTABLE_PATH_UNSAFE', [dir]);
      missing.push(dir); continue;
    }
    if (st.isSymbolicLink() || !st.isDirectory() || st.uid !== uid()) refuse('PORTABLE_PATH_UNSAFE', [dir]);
  }
  if (missing.length) { if (needParent) refuse('PORTABLE_PATH_UNSAFE', [missing[0]!]); return missing; }
  const parent = dirname(join(projectDir, rel));
  let real: string;
  try { real = fs.realpathSync(parent); } catch { return refuse('PORTABLE_PATH_UNSAFE', [rel]); }
  if (real !== parent) refuse('PORTABLE_PATH_UNSAFE', [rel]);
  return [];
}

// ---- reads -------------------------------------------------------------------------------------------------------------

/** The bytes and state of a plain file at an absolute path: no link, one link, this user's, at most 1 MiB. Null when absent. */
export function readAbs(abs: string, label: string): { bytes: Buffer; state: FileState } | null {
  let st: fs.Stats;
  try { st = fs.lstatSync(abs); } catch (e) { if (code(e) === 'ENOENT') return null; return refuse('PORTABLE_PATH_UNSAFE', [label]); }
  if (!st.isFile() || st.nlink !== 1 || st.uid !== uid() || st.size > MAX_FILE) refuse('PORTABLE_PATH_UNSAFE', [label]);
  let fd: number;
  try { fd = fs.openSync(abs, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK); } catch { return refuse('PORTABLE_PATH_UNSAFE', [label]); }
  try {
    const open = fs.fstatSync(fd);
    if (!open.isFile() || open.ino !== st.ino || open.dev !== st.dev || open.size > MAX_FILE || open.nlink !== 1) refuse('PORTABLE_PATH_UNSAFE', [label]);
    const bytes = Buffer.alloc(open.size); let at = 0;
    while (at < bytes.length) { const n = fs.readSync(fd, bytes, at, bytes.length - at, null); if (n === 0) break; at += n; }
    if (at !== open.size || fs.readSync(fd, Buffer.alloc(1), 0, 1, null) !== 0) refuse('PORTABLE_PATH_UNSAFE', [label]);
    return { bytes, state: { sha256: sha(bytes), mode: open.mode & 0o777 } };
  } finally { fs.closeSync(fd); }
}
/** A project file, after the ancestry check. Null when it, or a folder above it, does not exist. */
export function readProject(projectDir: string, rel: string): { bytes: Buffer; state: FileState } | null {
  if (checkAncestors(projectDir, rel).length) return null;
  return readAbs(join(projectDir, rel), rel);
}
export const stateOf = (projectDir: string, rel: string): FileState | null => readProject(projectDir, rel)?.state ?? null;
/** The state of a project file, or `unsafe` when it cannot be read safely. */
export function stateOrUnsafe(projectDir: string, rel: string): FileState | null | 'unsafe' {
  try { return stateOf(projectDir, rel); } catch (e) { if (isRefusal(e, 'PORTABLE_PATH_UNSAFE')) return 'unsafe'; throw e; }
}

// ---- writes ------------------------------------------------------------------------------------------------------------

export function syncDir(dir: string): void { const fd = fs.openSync(dir, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); } }
const TEMP_SUFFIX = '.bowerloom-tmp';
const tempName = (name: string): string => `.${name}.${randomBytes(8).toString('hex')}${TEMP_SUFFIX}`;

/**
 * Writes `bytes` at an absolute path through a fresh temporary in the same folder. `exclusive` links the temporary to
 * the name, which fails when anything appeared there since the check, and refuses that as drift (review ruling P24).
 * Otherwise the temporary is renamed over the target. `recheck` runs immediately before the link or rename.
 */
export function writeAbs(abs: string, bytes: Uint8Array, mode: number, exclusive: boolean, recheck: () => void = () => {}, label = abs, onPlaced: () => void = () => {}): void {
  const temp = join(dirname(abs), tempName(abs.slice(dirname(abs).length + 1)));
  const fd = fs.openSync(temp, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
  let placed = false;
  try {
    try { let at = 0; while (at < bytes.length) at += fs.writeSync(fd, bytes, at); fs.fchmodSync(fd, mode & 0o777); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    recheck();
    if (exclusive) {
      try { fs.linkSync(temp, abs); } catch (e) { if (code(e) === 'EEXIST') refuse('PORTABLE_DRIFT', [label]); throw e; }
      placed = true; onPlaced(); fs.unlinkSync(temp);
    } else { fs.renameSync(temp, abs); placed = true; onPlaced(); }
    syncDir(dirname(abs));
  } finally { if (!placed || exclusive) { try { fs.unlinkSync(temp); } catch { /* already gone */ } } }
}

/** Removes leftover temporaries of the writer beside a project path. Every error is ignored: it is cleanup only. */
export function sweepTemps(projectDir: string, rel: string): void {
  try {
    if (checkAncestors(projectDir, rel).length) return;
    const dir = dirname(join(projectDir, rel)), name = rel.slice(rel.lastIndexOf('/') + 1);
    for (const entry of fs.readdirSync(dir)) {
      if (entry.startsWith(`.${name}.`) && entry.endsWith(TEMP_SUFFIX) && /^[0-9a-f]{16}$/.test(entry.slice(name.length + 2, -TEMP_SUFFIX.length))) fs.unlinkSync(join(dir, entry));
    }
  } catch { /* cleanup only */ }
}

/** Creates one project folder, mode 0755, after the ancestry check. */
export function makeDir(projectDir: string, rel: string): void {
  checkAncestors(projectDir, rel, true);
  const abs = join(projectDir, rel);
  try { fs.mkdirSync(abs, { mode: 0o755 }); } catch (e) { if (code(e) === 'EEXIST') refuse('PORTABLE_PATH_UNSAFE', [rel]); throw e; }
  fs.chmodSync(abs, 0o755);
  const st = fs.lstatSync(abs);
  if (st.isSymbolicLink() || !st.isDirectory()) refuse('PORTABLE_PATH_UNSAFE', [rel]);
  syncDir(dirname(abs));
}

export type LeftReason = 'not-empty' | 'unsafe' | 'not-a-folder' | 'error';
export interface LeftBehind { readonly path: string; readonly reason: LeftReason }
/**
 * Removes the folders Bowerloom created, deepest first, each only when it is an empty real folder reached through
 * checked folders. A folder that is gone counts as removed. Returns every folder left behind, with why (ruling P12).
 */
export function removeEmptyDirs(projectDir: string, dirs: readonly string[]): LeftBehind[] {
  const left: LeftBehind[] = [];
  for (const d of [...new Set(dirs)].sort(byBytes).reverse()) {
    try {
      if (checkAncestors(projectDir, d + '/x').length) continue;
      const abs = join(projectDir, d), st = fs.lstatSync(abs);
      if (st.isSymbolicLink() || !st.isDirectory()) { left.push({ path: d, reason: 'not-a-folder' }); continue; }
      if (fs.readdirSync(abs).length) { left.push({ path: d, reason: 'not-empty' }); continue; }
      fs.rmdirSync(abs); syncDir(dirname(abs));
    } catch (e) {
      if (code(e) === 'ENOENT') continue;
      left.push({ path: d, reason: isRefusal(e, 'PORTABLE_PATH_UNSAFE') ? 'unsafe' : 'error' });
    }
  }
  return left.sort((a, b) => byBytes(a.path, b.path));
}

// ---- case folding (review ruling P6) -----------------------------------------------------------------------------------

/**
 * The paths on disk that differ from `rel`, or from a folder above it, only in letter case. Such a pair is one file on
 * a case-insensitive file system and two on a case-sensitive one. `cache` holds the folder listings already read.
 */
export function caseClashes(projectDir: string, rel: string, cache: Map<string, string[] | null>): string[] {
  const parts = rel.split('/'), out: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    const parent = parts.slice(0, i).join('/');
    let names = cache.get(parent);
    if (names === undefined) {
      try { names = fs.readdirSync(join(projectDir, parent)); } catch { names = null; }
      cache.set(parent, names);
    }
    if (names === null) break;
    const want = parts[i]!, fold = want.toLowerCase();
    for (const n of names) if (n !== want && n.toLowerCase() === fold) out.push(parent ? `${parent}/${n}` : n);
    if (!names.includes(want)) break;
  }
  return out;
}
