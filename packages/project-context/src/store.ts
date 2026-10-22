/**
 * The store: the folder `~/.bowerloom`, where the definitions of skills, prompts, and teams live. This module reads and
 * checks it and writes nothing. Internal to packages/project-context; the package index exports `inspectStore`,
 * `openStore`, `verifyStorePins`, `pathInsideStore`, `assertNotInStore`, `storeRootOf`, and the types.
 *
 * The store is always at `join(realpath(home), '.bowerloom')`. Nothing else moves it. The `...With` forms take the
 * test hooks of discovery and are for this package's tests and for discovery only.
 */
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, readdirSync, realpathSync, statSync } from 'node:fs';
import type { BigIntStats } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { strictJson } from '../../codex-adapter/src/safe.js';
import { checkProjectPathWith, fold, homesOf, pin, pinAncestry } from './discovery.js';
import type { DiscoveryHooks } from './discovery.js';
import { refuse } from './refusal.js';
import type { DirectoryIdentity, PinnedDirectory } from './types.js';

export const STORE_DIRNAME = '.bowerloom';
export const STORE_FILE = 'store.json';
export const STORE_FORMAT = 'bowerloom/store/v1beta1';
const STORE_FILE_LIMIT = 4096;
const LEFTOVER_TEMP = /^\.store\.json\.[a-f0-9]{16}\.tmp$/;

export interface StoreContext {
  readonly dir: string;
  readonly identity: DirectoryIdentity;
  readonly ancestry: readonly PinnedDirectory[];
  /** Device and inode of `store.json`, and its size and change time when it was read. */
  readonly fileIdentity: { readonly device: string; readonly inode: string; readonly size: string; readonly ctimeNs: string };
}
export type StoreInspection =
  | { state: 'absent'; leftover: boolean }
  | { state: 'foreign' }
  | { state: 'store'; context: StoreContext; leftoverTemp: boolean };

const errno = (error: unknown): unknown => (error as NodeJS.ErrnoException | null)?.code;
const missing = (error: unknown): boolean => errno(error) === 'ENOENT' || errno(error) === 'ENOTDIR';
const usable = (path: unknown): path is string => typeof path === 'string' && isAbsolute(path) && !path.includes('\0');

/** Rule 1 and the real path of rule 2: the home folder with links resolved. */
function realHomeOf(home: string): string {
  if (!usable(home)) throw refuse('USAGE');
  try { return realpathSync(home); } catch { throw refuse('STORE_UNREADABLE'); }
}

/** The store path for a home folder: `<realpath(home)>/.bowerloom`. USAGE for a relative path or a NUL; STORE_UNREADABLE when the home folder cannot be resolved. */
export function storeRootOf(home: string): string { return join(realHomeOf(home), STORE_DIRNAME); }

/** Rule 4: the cloud and path rules of a project path, with the codes mapped to the store's. */
function checkStorePath(root: string, home: string, hooks: DiscoveryHooks): void {
  try { checkProjectPathWith(root, home, hooks); }
  catch (error) {
    const code = errno(error);
    if (code === 'USAGE') throw error;
    throw refuse(code === 'PROJECT_IN_CLOUD_FOLDER' ? 'STORE_IN_CLOUD_FOLDER' : code === 'PROJECT_UNREADABLE' ? 'STORE_UNREADABLE' : 'STORE_UNSAFE');
  }
}

/** Only one name of a folder listing may fold to `wanted`, and it must be spelled exactly so. Returns whether it is there. */
function exactName(names: readonly string[], wanted: string): boolean {
  const hits = names.filter(name => fold(name) === wanted);
  if (hits.length > 1 || (hits.length === 1 && hits[0] !== wanted)) throw refuse('STORE_UNSAFE');
  return hits.length === 1;
}

function strictText(bytes: Buffer): string | null {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { return null; }
}

/** Reads and checks `store.json`: a plain file, at most 4096 bytes, exactly `{"format":"bowerloom/store/v1beta1"}`. Returns its device and inode. */
function readStoreFile(root: string, uid: number): StoreContext['fileIdentity'] {
  const file = join(root, STORE_FILE);
  let before: BigIntStats;
  try { before = lstatSync(file, { bigint: true }); } catch (error) { throw refuse(missing(error) ? 'STORE_UNSAFE' : 'STORE_UNREADABLE'); }
  if (before.isSymbolicLink() || !before.isFile() || before.nlink !== 1n || Number(before.uid) !== uid || (Number(before.mode) & 0o022) !== 0) throw refuse('STORE_UNSAFE');
  let fd: number;
  try { fd = openSync(file, constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW); }
  catch (error) { throw refuse(errno(error) === 'ELOOP' || missing(error) ? 'STORE_UNSAFE' : 'STORE_UNREADABLE'); }
  let bytes: Buffer;
  try {
    const open = fstatSync(fd, { bigint: true });
    if (open.dev !== before.dev || open.ino !== before.ino) throw refuse('STORE_UNSAFE');
    const buffer = Buffer.alloc(STORE_FILE_LIMIT + 1);
    let length = 0;
    for (;;) {
      const n = readSync(fd, buffer, length, buffer.length - length, null);
      if (n === 0) break;
      length += n;
      if (length === buffer.length) break;
    }
    bytes = buffer.subarray(0, length);
  } catch (error) {
    if (errno(error) === 'STORE_UNSAFE') throw error;
    throw refuse('STORE_UNREADABLE');
  } finally { closeSync(fd); }
  if (bytes.length > STORE_FILE_LIMIT || (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf)) throw refuse('STORE_INVALID');
  const text = strictText(bytes);
  if (text === null) throw refuse('STORE_INVALID');
  let value: unknown;
  try { value = strictJson(text, STORE_FILE_LIMIT); } catch { throw refuse('STORE_INVALID'); }
  const keys = value !== null && typeof value === 'object' && !Array.isArray(value) ? Object.keys(value) : [];
  if (keys.length !== 1 || keys[0] !== 'format' || (value as { format: unknown }).format !== STORE_FORMAT) throw refuse('STORE_INVALID');
  return { device: before.dev.toString(), inode: before.ino.toString(), size: before.size.toString(), ctimeNs: before.ctimeNs.toString() };
}

/**
 * Checks the store at `home` by the rules of the store foundation spec, section 3.3, in order. Throws only STORE_* or
 * USAGE. A missing store is `absent`; a folder without `store.json` is `foreign`; a safe store with a valid
 * `store.json` is `store`, pinned.
 */
export function inspectStoreWith(home: string, hooks: DiscoveryHooks = {}): StoreInspection {
  const realHome = realHomeOf(home), root = join(realHome, STORE_DIRNAME), uid = hooks.uid ?? process.getuid?.() ?? -1;
  // The home folder must be yours (or root's), and closed to others unless it is sticky. Folders above it are not checked.
  let homeStat: BigIntStats;
  try { homeStat = lstatSync(realHome, { bigint: true }); } catch { throw refuse('STORE_UNREADABLE'); }
  const homeOwner = Number(homeStat.uid), homeMode = Number(homeStat.mode);
  if (!homeStat.isDirectory() || (homeOwner !== uid && homeOwner !== 0) || ((homeMode & 0o022) !== 0 && (homeMode & 0o1000) === 0)) throw refuse('STORE_UNSAFE');
  let stat: BigIntStats | null;
  try { stat = lstatSync(root, { bigint: true }); } catch (error) { if (!missing(error)) throw refuse('STORE_UNREADABLE'); stat = null; }
  let names: string[];
  try { names = readdirSync(realHome); } catch { throw refuse('STORE_UNREADABLE'); }
  const listed = exactName(names, STORE_DIRNAME);
  if (stat === null) {
    if (listed) throw refuse('STORE_UNSAFE');
    checkStorePath(root, realHome, hooks);
    return { state: 'absent', leftover: false };
  }
  if (!listed) throw refuse('STORE_UNSAFE');
  if (stat.isSymbolicLink() || !stat.isDirectory() || Number(stat.uid) !== uid || (Number(stat.mode) & 0o022) !== 0) throw refuse('STORE_UNSAFE');
  checkStorePath(root, realHome, hooks);
  try { if (realpathSync(root) !== root) throw refuse('STORE_UNSAFE'); } catch (error) { if (errno(error) === 'STORE_UNSAFE') throw error; throw refuse(missing(error) ? 'STORE_UNSAFE' : 'STORE_UNREADABLE'); }
  // Pin the folder and its parents before anything inside is read, and require them to be the folder that was checked.
  let identity: DirectoryIdentity, ancestry: readonly PinnedDirectory[];
  try { identity = pin(root); ancestry = pinAncestry(root); }
  catch (error) { throw refuse(errno(error) === 'PROJECT_UNREADABLE' ? 'STORE_UNREADABLE' : 'STORE_UNSAFE'); }
  if (identity.device !== stat.dev.toString() || identity.inode !== stat.ino.toString() || identity.birthtimeNs !== stat.birthtimeNs.toString()
    || identity.uid !== uid || (identity.mode & 0o022) !== 0) throw refuse('STORE_UNSAFE');
  let inside: string[];
  try { inside = readdirSync(root); } catch { throw refuse('STORE_UNREADABLE'); }
  const kept = inside.filter(name => !LEFTOVER_TEMP.test(name)), leftoverTemp = kept.length !== inside.length;
  if (kept.length === 0) return { state: 'absent', leftover: true };
  if (!exactName(kept, STORE_FILE)) return { state: 'foreign' };
  const fileIdentity = readStoreFile(root, uid);
  const context: StoreContext = Object.freeze({ dir: root, identity, ancestry, fileIdentity: Object.freeze(fileIdentity) });
  verifyStorePins(context);
  return { state: 'store', context, leftoverTemp };
}

/** The pinned store. `absent` refuses STORE_NOT_FOUND and `foreign` refuses STORE_INVALID. */
export function openStoreWith(home: string, hooks: DiscoveryHooks = {}): StoreContext {
  const found = inspectStoreWith(home, hooks);
  if (found.state === 'absent') throw refuse('STORE_NOT_FOUND');
  if (found.state === 'foreign') throw refuse('STORE_INVALID');
  return found.context;
}

/** True only for state `store`. Any throw gives false. */
export function isValidStore(home: string, hooks: DiscoveryHooks = {}): boolean {
  try { return inspectStoreWith(home, hooks).state === 'store'; } catch { return false; }
}

/** Refuses STORE_UNSAFE unless the store folder, every folder above it, and `store.json` are still what was pinned. */
export function verifyStorePins(store: StoreContext): void {
  const uid = process.getuid?.() ?? -1;
  for (const [path, pinned] of [...store.ancestry.map(a => [a.path, a.identity] as const), [store.dir, store.identity] as const]) {
    let stat: BigIntStats; try { stat = lstatSync(path, { bigint: true }); } catch { throw refuse('STORE_UNSAFE'); }
    if (stat.isSymbolicLink() || !stat.isDirectory() || stat.dev.toString() !== pinned.device || stat.ino.toString() !== pinned.inode || stat.birthtimeNs.toString() !== pinned.birthtimeNs) throw refuse('STORE_UNSAFE');
    if (path === store.dir && (Number(stat.uid) !== uid || (Number(stat.mode) & 0o022) !== 0)) throw refuse('STORE_UNSAFE');
  }
  let file: BigIntStats; try { file = lstatSync(join(store.dir, STORE_FILE), { bigint: true }); } catch { throw refuse('STORE_UNSAFE'); }
  if (file.isSymbolicLink() || !file.isFile() || file.nlink !== 1n || file.dev.toString() !== store.fileIdentity.device || file.ino.toString() !== store.fileIdentity.inode
    || Number(file.uid) !== uid || (Number(file.mode) & 0o022) !== 0 || file.size.toString() !== store.fileIdentity.size || file.ctimeNs.toString() !== store.fileIdentity.ctimeNs) throw refuse('STORE_UNSAFE');
}

/** The device and inode of a folder, links followed. Null when nothing is there; STORE_UNREADABLE for any other failure. */
const idOf = (path: string): string | null => {
  try { const s = statSync(path, { bigint: true }); return `${s.dev}:${s.ino}`; } catch (error) { if (missing(error)) return null; throw refuse('STORE_UNREADABLE'); }
};
/** As idOf for `<home>/.bowerloom`, but a link or a non-folder there is no store for this check. */
const storeIdOf = (path: string): string | null => {
  try { const s = lstatSync(path, { bigint: true }); return s.isDirectory() && !s.isSymbolicLink() ? `${s.dev}:${s.ino}` : null; } catch (error) { if (missing(error)) return null; throw refuse('STORE_UNREADABLE'); }
};

/**
 * True for a path at or below `<h>/.bowerloom`, for each home folder `h` (HOME and the account home). Compares by device
 * and inode up the chain of the real path, so a link into the store counts. The state of that folder does not matter.
 */
export function pathInsideStore(path: string, home: string, hooks: DiscoveryHooks = {}): boolean {
  if (!usable(path) || !usable(home)) throw refuse('USAGE');
  const stores = new Set(homesOf(home, hooks).map(h => storeIdOf(join(h, STORE_DIRNAME))).filter((id): id is string => id !== null));
  if (stores.size === 0) return false;
  // The real path of the deepest folder that exists, plus the rest.
  let existing = resolve(path), rest = '';
  for (;;) {
    try { existing = realpathSync(existing); break; } catch (error) {
      if (!missing(error)) throw refuse('STORE_UNREADABLE');
      const parent = dirname(existing);
      if (parent === existing) return false;
      rest = join(existing.slice(parent.length + 1), rest); existing = parent;
    }
  }
  for (let current = rest === '' ? existing : join(existing, rest); ; current = dirname(current)) {
    const id = idOf(current);
    if (id !== null && stores.has(id)) return true;
    if (dirname(current) === current) return false;
  }
}

/** Refuses STORE_NOT_A_PROJECT for a path at or below the store. */
export function assertNotInStore(path: string, home: string): void {
  if (pathInsideStore(path, home)) throw refuse('STORE_NOT_A_PROJECT');
}
