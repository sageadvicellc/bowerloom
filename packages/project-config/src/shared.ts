/**
 * The shared project rule (spec 06, 3.9, decision 22). A project is shared when `bowerloom.lock.json` exists in its folder,
 * or when the folder is inside a git work tree whose config has `[remote "origin"]` with a `url`. Detection reads files
 * only and starts no process. It never throws for anything it reads: a file it cannot use makes that test fail.
 */
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, realpathSync } from 'node:fs';
import type { BigIntStats } from 'node:fs';
import { homedir, userInfo } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import type { ProjectContext } from '../../project-context/src/types.js';
import { LOCK_FILE } from './lock.js';

export interface SharedProject { shared: boolean; reason: 'lock' | 'origin' | null }
/** Test hooks: the owner files must have, and the home folders the walk stops at. Product code passes nothing. */
export interface SharedHooks { readonly uid?: number; readonly homes?: readonly string[] }

// Case-insensitive on `remote` only: the remote name `origin` is matched exactly, as git does.
const HEADER = /^\s*\[[Rr][Ee][Mm][Oo][Tt][Ee]\s+"origin"\]\s*$/, ANY_HEADER = /^\s*\[/, URL_KEY = /^\s*url\s*=\s*\S/i;
const lstatOrNull = (path: string): BigIntStats | null => { try { return lstatSync(path, { bigint: true }); } catch { return null; } };
/** A real folder, not a link, owned by `uid`. */
const realFolder = (path: string, uid: number): boolean => { const s = lstatOrNull(path); return s !== null && s.isDirectory() && !s.isSymbolicLink() && Number(s.uid) === uid; };
/** The bytes of a plain file (regular, not a link, owned by `uid`), at most `max`; null for anything else. Never throws. */
function plainFile(path: string, max: number, uid: number): Buffer | null {
  const stat = lstatOrNull(path);
  if (stat === null || stat.isSymbolicLink() || !stat.isFile() || Number(stat.uid) !== uid || stat.size > BigInt(max)) return null;
  let fd: number;
  try { fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK); } catch { return null; }
  try {
    const open = fstatSync(fd, { bigint: true });
    if (!open.isFile() || open.dev !== stat.dev || open.ino !== stat.ino) return null;
    const buffer = Buffer.alloc(max + 1); let length = 0;
    for (;;) { const n = readSync(fd, buffer, length, buffer.length - length, null); if (n === 0 || (length += n) === buffer.length) break; }
    return length > max ? null : Buffer.from(buffer.subarray(0, length));
  } catch { return null; } finally { closeSync(fd); }
}
const firstLine = (bytes: Buffer): string | null => { try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes).split(/\r?\n/)[0] ?? null; } catch { return null; } };

/** The folder that holds the config of the work tree at `top` (the folder with the `.git` entry), or null. */
function configFolder(top: string, uid: number): string | null {
  const dotGit = join(top, '.git'), stat = lstatOrNull(dotGit);
  if (stat === null) return null;
  if (stat.isDirectory() && !stat.isSymbolicLink()) return Number(stat.uid) === uid ? dotGit : null;
  // A `.git` file of at most 4096 bytes: `gitdir: <path>`, resolved against the folder of the file.
  const bytes = plainFile(dotGit, 4096, uid), line = bytes === null ? null : firstLine(bytes);
  const m = line === null ? null : /^gitdir: (.+)$/.exec(line);
  if (m === null) return null;
  const gitdir = resolve(top, m[1]!);
  if (!realFolder(gitdir, uid)) return null;
  // A worktree: the folder holds a plain `commondir` file whose first line names the common folder.
  const common = plainFile(join(gitdir, 'commondir'), 4096, uid);
  if (common === null) return gitdir;
  const rel = firstLine(common);
  if (rel === null || rel === '') return null;
  const folder = isAbsolute(rel) ? resolve(rel) : resolve(gitdir, rel);
  return realFolder(folder, uid) ? folder : null;
}
/** True when the config text has `[remote "origin"]` followed by a `url` line before the next section header. */
export function hasOriginUrl(text: string): boolean {
  let inOrigin = false;
  for (const line of text.split(/\r?\n/)) {
    if (ANY_HEADER.test(line)) { inOrigin = HEADER.test(line); continue; }
    if (inOrigin && URL_KEY.test(line)) return true;
  }
  return false;
}

/**
 * Test 2 of 3.9: walk from the project folder up to the first folder with a `.git` entry, never inspecting a home folder
 * or `/`, then read that work tree's config.
 */
function originTest(dir: string, uid: number, homes: readonly string[]): boolean {
  for (let at = dir; ; at = dirname(at)) {
    if (at === '/' || homes.includes(at)) return false;
    if (lstatOrNull(join(at, '.git')) !== null) {
      const folder = configFolder(at, uid);
      if (folder === null) return false;
      const bytes = plainFile(join(folder, 'config'), 65536, uid);
      if (bytes === null) return false;
      let text: string; try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { return false; }
      return hasOriginUrl(text);
    }
    if (dirname(at) === at) return false;
  }
}

/** Whether `project` is shared, and which test said so. The lock test runs first. */
export function isSharedProject(project: ProjectContext, hooks: SharedHooks = {}): SharedProject {
  const uid = hooks.uid ?? process.getuid?.() ?? -1;
  if (lstatOrNull(join(project.dir, LOCK_FILE)) !== null) return { shared: true, reason: 'lock' };
  let account: string | null = null; try { account = userInfo().homedir; } catch { account = null; }
  const real = (h: string): string[] => { try { return [resolve(h), realpathSync(h)]; } catch { return [resolve(h)]; } };
  const homes = hooks.homes ?? [...new Set([homedir(), ...(account ? [account] : [])].filter(h => isAbsolute(h)).flatMap(real))];
  return originTest(project.dir, uid, homes) ? { shared: true, reason: 'origin' } : { shared: false, reason: null };
}
