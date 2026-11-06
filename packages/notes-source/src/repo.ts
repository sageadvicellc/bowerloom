/**
 * Where a notes folder keeps its history, found without git's own discovery. A wiki folder may be its own repository, or a folder inside a larger one (the
 * owner's decision of 2026-10-30): a `knowledge-base/` folder in a repository cloned from a hosted remote, say.
 *
 * The walk reads names only and runs nothing. It looks for `.git` in the folder itself, then in each folder above it, and stops before the home folder and
 * before `/`, so a repository at home or at the root of the disk is never taken as the notes' history. The nearest `.git` decides. Only a real folder of
 * yours counts; a `.git` file (a linked worktree or a submodule) or a link is never followed.
 */
import fs from 'node:fs';
import os from 'node:os';
import { basename, dirname, isAbsolute, join, relative, sep } from 'node:path';
import { plainRelative, uid } from './folder.js';
import { refuse } from './refusal.js';

/**
 * - `none`: no `.git` in the folder or any folder above it, up to the stop.
 * - `self`: the folder's own `.git` is a real folder of yours.
 * - `parent`: the nearest `.git` above is a real folder of yours, at `root`. `prefix` is the notes folder relative to `root`, with `/`, or null when it is not
 *   a plain path git can take (a hidden name, say).
 * - `not-plain`: the nearest `.git` is a file, a link, or not yours. `at` says whether it is the folder's own or one above.
 * - `unknown`: a folder on the way could not be checked.
 */
export type Repository =
  | { readonly kind: 'none' }
  | { readonly kind: 'self'; readonly root: string }
  | { readonly kind: 'parent'; readonly root: string; readonly prefix: string | null }
  | { readonly kind: 'not-plain'; readonly at: 'self' | 'parent' }
  | { readonly kind: 'unknown' };

export interface RepositoryOptions {
  /** The home folder, where the walk stops. Tests pass one; the app passes its own. Default: this user's home folder from the system. */
  readonly home?: string;
}

const errno = (e: unknown): string | undefined => (e as NodeJS.ErrnoException | null)?.code;

/**
 * The real path of a folder, in the letter case the disk keeps. `fs.realpathSync` keeps the case it was given, so on a case-insensitive disk `KB` and `kb`
 * would be two names for one folder: the walk would then miss the home stop, and the wiki's place in a larger repository would not match what git tracks.
 * The system's own realpath returns the case on disk. A folder that does not exist yet is its parent's real path plus its own name.
 */
function onDisk(abs: string): string | null {
  try { return fs.realpathSync.native(abs); } catch (e) {
    if (errno(e) !== 'ENOENT' || dirname(abs) === abs) return null;
    try { return join(fs.realpathSync.native(dirname(abs)), basename(abs)); } catch { return null; }
  }
}

/** The home folder the walk stops at, by its real path on disk when it has one. Refuses NOTES_USAGE for a home that is not absolute. */
export function stopFolder(options: RepositoryOptions): string | null {
  const home = options.home ?? (() => { try { return os.userInfo().homedir; } catch { return null; } })();
  if (home === null) return null;
  if (typeof home !== 'string' || !isAbsolute(home) || home.includes('\0')) return refuse('NOTES_USAGE');
  return onDisk(home) ?? home;
}

/** What `<folder>/.git` is: absent, a real folder of yours, something else, or not known. */
function gitEntry(folder: string): 'absent' | 'plain' | 'not-plain' | 'unknown' {
  let st: fs.Stats;
  try { st = fs.lstatSync(join(folder, '.git')); } catch (e) {
    const code = errno(e);
    return code === 'ENOENT' || code === 'ENOTDIR' ? 'absent' : 'unknown';
  }
  return !st.isSymbolicLink() && st.isDirectory() && st.uid === uid() ? 'plain' : 'not-plain';
}

/**
 * Finds the repository that keeps the history of `given`, an absolute path that is its own real path (or, for a folder that does not exist yet, whose parent
 * is). The walk starts from its real path on disk, in the disk's own letter case, so `root` and `prefix` are in that case too. Reads names only. Refuses
 * NOTES_USAGE for a home folder that is not absolute.
 */
export function findRepository(given: string, options: RepositoryOptions = {}): Repository {
  const home = stopFolder(options);
  // The walk, the home stop, and the prefix all use the letter case on disk, so they match each other and what git tracks.
  const dir = onDisk(given);
  if (dir === null) return { kind: 'unknown' };
  const own = gitEntry(dir);
  if (own === 'plain') return { kind: 'self', root: dir };
  if (own === 'not-plain') return { kind: 'not-plain', at: 'self' };
  if (own === 'unknown') return { kind: 'unknown' };
  const stop = (folder: string): boolean => folder === home || folder === dirname(folder);
  for (let folder = dir; !stop(folder);) {
    folder = dirname(folder);
    if (stop(folder)) break;
    const found = gitEntry(folder);
    if (found === 'absent') continue;
    if (found === 'unknown') return { kind: 'unknown' };
    if (found === 'not-plain') return { kind: 'not-plain', at: 'parent' };
    const prefix = relative(folder, dir).split(sep).join('/');
    return { kind: 'parent', root: folder, prefix: plainRelative(prefix) ? prefix : null };
  }
  return { kind: 'none' };
}

/**
 * Refuses NOTES_PARENT_REPOSITORY when a folder above `dir` holds a `.git` of any kind, and NOTES_PATH_UNSAFE when the walk could not check one. Init and
 * the starter call this: Bowerloom never starts a repository inside a larger one.
 */
export function refuseInsideRepository(dir: string, options: RepositoryOptions): void {
  const found = findRepository(dir, options);
  if (found.kind === 'parent' || (found.kind === 'not-plain' && found.at === 'parent')) refuse('NOTES_PARENT_REPOSITORY');
  if (found.kind === 'unknown') refuse('NOTES_PATH_UNSAFE');
}
