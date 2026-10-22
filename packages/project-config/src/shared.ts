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
 * `unknown` names what could not be read safely. Review F1 (tech-lead decision): an unknown state fails closed, so the
 * project counts as shared, and status and the plans say "could not read <what>; treating this project as shared".
 */
export interface SharedProject { shared: boolean; reason: 'lock' | 'origin' | 'unknown' | null; unknown?: string }
/** Test hooks: the owner files must have, and the home folders the walk stops at. Product code passes nothing. */
export interface SharedHooks { readonly uid?: number; readonly homes?: readonly string[] }

const HEADER = /^\s*\[[Rr][Ee][Mm][Oo][Tt][Ee]\s+"origin"\]\s*$/, ANY_HEADER = /^\s*\[/, URL_KEY = /^\s*url\s*=\s*\S/i;
const WORKTREE = /^(.+)\/\.git\/worktrees\/[^/]+$/, MODULE = /^(.+)\/\.git\/modules\/.+$/;
type Look = BigIntStats | 'missing' | 'bad';
const look = (path: string): Look => { try { return lstatSync(path, { bigint: true }); } catch (error) { return (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'missing' : 'bad'; } };
/** A real folder, not a link, owned by `uid`, with no group or world write. */
const safeFolder = (s: Look, uid: number): boolean => typeof s === 'object' && s.isDirectory() && !s.isSymbolicLink() && Number(s.uid) === uid && (Number(s.mode) & 0o022) === 0;
/**
 * The bytes of a plain file: a regular file, not a link, owned by `uid`, with no group or world write, at most `max`
 * bytes, as git.ts reads the store's files. `missing` when nothing is there; `bad` for anything else. Never throws.
 */
function plainFile(path: string, max: number, uid: number): Buffer | 'missing' | 'bad' {
  const stat = look(path);
  if (stat === 'missing' || stat === 'bad') return stat;
  if (stat.isSymbolicLink() || !stat.isFile() || Number(stat.uid) !== uid || (Number(stat.mode) & 0o022) !== 0 || stat.size > BigInt(max)) return 'bad';
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
/**
 * The folder that holds the config of the work tree at `top`. A `.git` file is followed only to `<x>/.git/worktrees/<name>`
 * whose `commondir` names `<x>/.git`, or to `<x>/.git/modules/...` (review L1). Any other path is never looked at.
 */
function configFolder(top: string, uid: number): Folder {
  const dotGit = join(top, '.git'), stat = look(dotGit);
  if (stat === 'missing') return { none: true };
  if (stat === 'bad') return { unknown: '.git' };
  if (stat.isDirectory() && !stat.isSymbolicLink()) return safeFolder(stat, uid) ? { folder: dotGit } : { unknown: '.git' };
  if (!stat.isFile() || stat.isSymbolicLink()) return { unknown: '.git' };
  const bytes = plainFile(dotGit, 4096, uid);
  if (typeof bytes === 'string') return { unknown: '.git' };
  const m = /^gitdir: (.+)$/.exec(firstLine(bytes) ?? '');
  if (!m) return { unknown: '.git' };
  const gitdir = resolve(top, m[1]!), worktree = WORKTREE.exec(gitdir), module = MODULE.exec(gitdir);
  if (!worktree && !module) return { unknown: '.git' };
  const at = look(gitdir);
  if (at === 'missing') return { none: true };
  if (!safeFolder(at, uid)) return { unknown: '.git' };
  if (module) return { folder: gitdir };
  const common = plainFile(join(gitdir, 'commondir'), 4096, uid), expected = `${worktree![1]}/.git`;
  if (typeof common === 'string') return { unknown: '.git' };
  const rel = firstLine(common);
  if (rel === null || rel === '' || resolve(gitdir, rel) !== expected) return { unknown: '.git' };
  return safeFolder(look(expected), uid) ? { folder: expected } : { unknown: '.git' };
}

/**
 * Test 2 of 3.9: walk from the project folder up to the first folder with a `.git` entry, never inspecting a home folder
 * or `/`, then read that work tree's config. Anything that cannot be read safely is `unknown`.
 */
function originTest(dir: string, uid: number, homes: readonly string[]): SharedProject {
  const NOT: SharedProject = { shared: false, reason: null }, unknown = (what: string): SharedProject => ({ shared: true, reason: 'unknown', unknown: what });
  for (let at = dir; ; at = dirname(at)) {
    if (at === '/' || homes.includes(at)) return NOT;
    const found = configFolder(at, uid);
    if ('unknown' in found) return unknown(found.unknown);
    if ('folder' in found) {
      const bytes = plainFile(join(found.folder, 'config'), 65536, uid);
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
  const uid = hooks.uid ?? process.getuid?.() ?? -1;
  const lock = look(join(project.dir, LOCK_FILE));
  if (lock === 'bad') return { shared: true, reason: 'unknown', unknown: LOCK_FILE };
  if (lock !== 'missing') return { shared: true, reason: 'lock' };
  let account: string | null = null; try { account = userInfo().homedir; } catch { account = null; }
  const real = (h: string): string[] => { try { return [resolve(h), realpathSync(h)]; } catch { return [resolve(h)]; } };
  const homes = hooks.homes ?? [...new Set([homedir(), ...(account ? [account] : [])].filter(h => isAbsolute(h)).flatMap(real))];
  return originTest(project.dir, uid, homes);
}
/** The note of an unknown shared state (review F1). */
export const unknownSharedNote = (what: string): string => `could not read ${what}; treating this project as shared`;
