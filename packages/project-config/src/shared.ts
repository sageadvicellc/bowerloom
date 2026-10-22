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

/**
 * `unknown` names what could not be read. An unknown state fails closed (review F1): the project counts as shared, and
 * status and the plans say so. Second review M2 (tech lead): only what git itself would not read is unknown, namely a
 * link where a folder or a file belongs, a file that is not a regular file, a file over its size limit, or a file that
 * cannot be read. Group write and another owner are what umask 002 and shared machines make, and git reads them.
 */
export interface SharedProject { shared: boolean; reason: 'lock' | 'origin' | 'unknown' | null; unknown?: string }
/** Test hooks: the owner files once had to have (no longer checked), and the home folders the walk stops at. */
export interface SharedHooks { readonly uid?: number; readonly homes?: readonly string[] }

const HEADER = /^\s*\[[Rr][Ee][Mm][Oo][Tt][Ee]\s+"origin"\]\s*$/, ANY_HEADER = /^\s*\[/, URL_KEY = /^\s*url\s*=\s*\S/i;
/** A worktree's admin folder, `<common>/worktrees/<name>`; a submodule of a worktree, `<admin>/modules/...`; a submodule, `<x>/.git/modules/...`. */
const WORKTREE = /^(.+)\/worktrees\/[^/]+$/, WORKTREE_MODULE = /^((.+)\/worktrees\/[^/]+)\/modules\/.+$/, MODULE = /^(.+)\/\.git\/modules\/.+$/;
/** Second review L3: network mounts that a gitdir never points into. Nothing under them is read. */
const NETWORK_ROOTS = ['/net', '/Volumes', '/Network'];
type Look = BigIntStats | 'missing' | 'bad';
const look = (path: string): Look => { try { return lstatSync(path, { bigint: true }); } catch (error) { return (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'missing' : 'bad'; } };
/** A real folder, not a link. */
const realFolder = (s: Look): boolean => typeof s === 'object' && s.isDirectory() && !s.isSymbolicLink();
/**
 * The bytes of a plain file: a regular file, not a link, at most `max` bytes, opened without following a link.
 * `missing` when nothing is there; `bad` for anything else, such as EACCES or EIO. Never throws.
 */
function plainFile(path: string, max: number): Buffer | 'missing' | 'bad' {
  const stat = look(path);
  if (stat === 'missing' || stat === 'bad') return stat;
  if (stat.isSymbolicLink() || !stat.isFile() || stat.size > BigInt(max)) return 'bad';
  let fd: number;
  try { fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK); } catch { return 'bad'; }
  try {
    const open = fstatSync(fd, { bigint: true });
    if (!open.isFile() || open.dev !== stat.dev || open.ino !== stat.ino) return 'bad';
    const buffer = Buffer.alloc(max + 1); let length = 0;
    for (;;) { const n = readSync(fd, buffer, length, buffer.length - length, null); if (n === 0 || (length += n) === buffer.length) break; }
    return length > max ? 'bad' : Buffer.from(buffer.subarray(0, length));
  } catch { return 'bad'; } finally { closeSync(fd); }
}
const text = (bytes: Buffer): string | null => { try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { return null; } };
const firstLine = (bytes: Buffer): string | null => text(bytes)?.split(/\r?\n/)[0] ?? null;
/** True when `top` is inside `folder`. */
const inside = (top: string, folder: string): boolean => top.startsWith(folder.endsWith('/') ? folder : `${folder}/`);

/** True when the config text has `[remote "origin"]` followed by a `url` line before the next section header. */
export function hasOriginUrl(config: string): boolean {
  let inOrigin = false;
  for (const line of config.split(/\r?\n/)) {
    if (ANY_HEADER.test(line)) { inOrigin = HEADER.test(line); continue; }
    if (inOrigin && URL_KEY.test(line)) return true;
  }
  return false;
}

type Folder = { folder: string } | { none: true } | { unknown: string };
/** A git folder as git makes one: a real folder that holds a HEAD file. */
const gitFolder = (path: string): boolean => realFolder(look(path)) && typeof plainFile(join(path, 'HEAD'), 4096) !== 'string';
/** The common folder of a worktree admin folder `<common>/worktrees/<name>`: its `commondir` must name `<common>`, a git folder. */
function worktreeCommon(admin: string, common: string): string | null {
  if (!realFolder(look(admin))) return null;
  const bytes = plainFile(join(admin, 'commondir'), 4096);
  if (typeof bytes === 'string') return null;
  const rel = firstLine(bytes);
  if (rel === null || rel === '' || resolve(admin, rel) !== common) return null;
  return gitFolder(common) ? common : null;
}
/**
 * The folder that holds the config of the work tree at `top`. A `.git` file is followed only to a worktree admin folder
 * whose `commondir` names its git folder (a bare one too), to a submodule folder `<x>/.git/modules/...` with `<x>` above the
 * project, or to a submodule of a worktree whose tree is above the project (review L1, second review M2 and L3). Any other
 * path, and any path under a network mount, is never looked at.
 */
function configFolder(top: string): Folder {
  const dotGit = join(top, '.git'), stat = look(dotGit);
  if (stat === 'missing') return { none: true };
  if (stat === 'bad') return { unknown: '.git' };
  if (stat.isDirectory() && !stat.isSymbolicLink()) return { folder: dotGit };
  if (!stat.isFile() || stat.isSymbolicLink()) return { unknown: '.git' };
  const bytes = plainFile(dotGit, 4096);
  if (typeof bytes === 'string') return { unknown: '.git' };
  const m = /^gitdir: (.+)$/.exec(firstLine(bytes) ?? '');
  if (!m) return { unknown: '.git' };
  const gitdir = resolve(top, m[1]!);
  if (NETWORK_ROOTS.some(root => inside(gitdir, root))) return { unknown: '.git' };
  const wtModule = WORKTREE_MODULE.exec(gitdir), module = wtModule ? null : MODULE.exec(gitdir), worktree = wtModule || module ? null : WORKTREE.exec(gitdir);
  if (wtModule) {
    // The admin folder names its tree in `gitdir`, as `<tree>/.git`; the project must be inside that tree.
    if (worktreeCommon(wtModule[1]!, wtModule[2]!) === null) return { unknown: '.git' };
    const named = plainFile(join(wtModule[1]!, 'gitdir'), 4096), tree = typeof named === 'string' ? null : firstLine(named);
    if (tree === null || !tree.endsWith('/.git') || !inside(top, dirname(resolve(wtModule[1]!, tree)))) return { unknown: '.git' };
  } else if (module) {
    if (!inside(top, module[1]!)) return { unknown: '.git' };
  } else if (worktree) {
    const at = look(gitdir);
    if (at === 'missing') return { none: true };
    const common = worktreeCommon(gitdir, worktree[1]!);
    return common === null ? { unknown: '.git' } : { folder: common };
  } else return { unknown: '.git' };
  const at = look(gitdir);
  if (at === 'missing') return { none: true };
  return realFolder(at) ? { folder: gitdir } : { unknown: '.git' };
}

/**
 * Test 2 of 3.9: walk from the project folder up to the first folder with a `.git` entry, never inspecting a home folder
 * or `/`, then read that work tree's config. Anything that cannot be read safely is `unknown`.
 */
function originTest(dir: string, homes: readonly string[]): SharedProject {
  const NOT: SharedProject = { shared: false, reason: null }, unknown = (what: string): SharedProject => ({ shared: true, reason: 'unknown', unknown: what });
  for (let at = dir; ; at = dirname(at)) {
    if (at === '/' || homes.includes(at)) return NOT;
    const found = configFolder(at);
    if ('unknown' in found) return unknown(found.unknown);
    if ('folder' in found) {
      const bytes = plainFile(join(found.folder, 'config'), 65536);
      if (bytes === 'missing') return NOT;
      if (bytes === 'bad') return unknown('.git/config');
      const config = text(bytes);
      if (config === null) return unknown('.git/config');
      return hasOriginUrl(config) ? { shared: true, reason: 'origin' } : NOT;
    }
    if (dirname(at) === at) return NOT;
  }
}

/** Whether `project` is shared, and which test said so. The lock test runs first. Never throws. */
export function isSharedProject(project: ProjectContext, hooks: SharedHooks = {}): SharedProject {
  const lock = look(join(project.dir, LOCK_FILE));
  if (lock === 'bad') return { shared: true, reason: 'unknown', unknown: LOCK_FILE };
  if (lock !== 'missing') return { shared: true, reason: 'lock' };
  let account: string | null = null; try { account = userInfo().homedir; } catch { account = null; }
  const real = (h: string): string[] => { try { return [resolve(h), realpathSync(h)]; } catch { return [resolve(h)]; } };
  const homes = hooks.homes ?? [...new Set([homedir(), ...(account ? [account] : [])].filter(h => isAbsolute(h)).flatMap(real))];
  return originTest(project.dir, homes);
}
/** The note of an unknown shared state (review F1). */
export const unknownSharedNote = (what: string): string => `could not read ${what}; treating this project as shared`;
