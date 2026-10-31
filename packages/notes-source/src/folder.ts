/**
 * The folder checks of the notes source. A notes folder is named by a plain absolute path that is its own real path:
 * no link anywhere on the way, no `.` or `..`, no trailing slash. It must be a real folder of this user. Names inside it
 * must be plain: no control character and no backslash.
 */
import fs from 'node:fs';
import { basename, dirname, isAbsolute, resolve } from 'node:path';
import { PortableRefusal } from '../../project-sync/src/portable-files.js';
import { refuse } from './refusal.js';

export interface Folder {
  /** The absolute path, which is its own real path. */
  readonly abs: string;
  /** The device and inode, so a folder swapped after a preview is seen. */
  readonly id: string;
}

const errno = (e: unknown): string | undefined => (e as NodeJS.ErrnoException | null)?.code;
export const uid = (): number | undefined => process.getuid?.();
const CONTROL = /\p{Cc}/u;
/** The longest path, in bytes, that Bowerloom gives to git or writes. */
export const MAX_PATH_BYTES = 4096;

/** True for a path that is absolute, normalized, without a trailing slash, and short enough. */
function plainAbsolute(dir: unknown): dir is string {
  return typeof dir === 'string' && dir.length > 0 && Buffer.byteLength(dir) <= MAX_PATH_BYTES && !dir.includes('\0') && !CONTROL.test(dir)
    && isAbsolute(dir) && resolve(dir) === dir;
}

/**
 * Checks that `dir` is a plain absolute path to a real folder of this user and is its own real path. Refuses
 * NOTES_FOLDER_MISSING when nothing is there, and NOTES_PATH_UNSAFE for anything else that is not such a folder.
 */
export function verifiedFolder(dir: unknown): Folder {
  if (!plainAbsolute(dir)) return refuse('NOTES_PATH_UNSAFE');
  let st: fs.Stats;
  try { st = fs.lstatSync(dir); } catch (e) { return refuse(errno(e) === 'ENOENT' ? 'NOTES_FOLDER_MISSING' : 'NOTES_PATH_UNSAFE'); }
  if (st.isSymbolicLink() || !st.isDirectory() || st.uid !== uid()) refuse('NOTES_PATH_UNSAFE');
  let real: string;
  try { real = fs.realpathSync(dir); } catch { return refuse('NOTES_PATH_UNSAFE'); }
  if (real !== dir) refuse('NOTES_PATH_UNSAFE');
  return { abs: dir, id: `${st.dev}:${st.ino}` };
}

/** A folder that may not exist yet: its parent is verified, and the folder itself when it is there. */
export interface Target { readonly abs: string; readonly parent: Folder; readonly name: string; readonly existing: Folder | null }

/** Checks a folder Bowerloom may create. Its name must be plain and not hidden; its parent must be a verified folder. */
export function targetFolder(dir: unknown): Target {
  if (!plainAbsolute(dir) || dir === '/') return refuse('NOTES_PATH_UNSAFE');
  const name = basename(dir);
  if (!plainName(name) || name.startsWith('.')) refuse('NOTES_PATH_UNSAFE');
  const parent = verifiedFolder(dirname(dir));
  try { fs.lstatSync(dir); } catch (e) {
    if (errno(e) === 'ENOENT') return { abs: dir, parent, name, existing: null };
    return refuse('NOTES_PATH_UNSAFE');
  }
  return { abs: dir, parent, name, existing: verifiedFolder(dir) };
}

/** True for one plain file or folder name: not empty, not `.` or `..`, no slash, backslash, or control character. */
export function plainName(name: string): boolean {
  return name.length > 0 && name !== '.' && name !== '..' && !/[/\\]/.test(name) && !CONTROL.test(name) && Buffer.byteLength(name) <= 255;
}

/**
 * True for a relative path Bowerloom gives to git: plain names joined by `/`, none hidden, no `.git`, not starting
 * with `-`, at most MAX_PATH_BYTES.
 */
export function plainRelative(rel: unknown): rel is string {
  if (typeof rel !== 'string' || rel.length === 0 || rel.startsWith('-') || Buffer.byteLength(rel) > MAX_PATH_BYTES) return false;
  return rel.split('/').every(s => plainName(s) && !s.startsWith('.'));
}

/** Runs a step of the projection's file layer and turns its refusals into notes refusals. */
export function fileStep<T>(step: () => T): T {
  try { return step(); } catch (e) {
    if (e instanceof PortableRefusal) refuse(e.code === 'PORTABLE_DRIFT' ? 'NOTES_STALE' : 'NOTES_PATH_UNSAFE', e.paths);
    throw e;
  }
}
