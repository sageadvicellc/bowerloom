/**
 * Where a project is: the path refusals and the search for `.bowerloom`. Internal to packages/project-context.
 *
 * The package index exports `checkProjectPath` and `discoverProject`, which take no hooks. The `...With` forms here take
 * the test hooks and are for this package's tests only; no product code imports this module directly.
 *
 * Folders are compared by device and inode wherever they exist, so a symlink, a `/System/Volumes/Data` alias or a
 * case or `ſ` alias on case-insensitive APFS names the same folder as its plain spelling. Spellings are also compared,
 * folded, so a path that does not exist yet is still checked.
 */
import { createHash } from 'node:crypto';
import { lstatSync, readdirSync, realpathSync, statSync } from 'node:fs';
import type { BigIntStats } from 'node:fs';
import { userInfo } from 'node:os';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { refuse } from './refusal.js';
import type { DirectoryIdentity, PinnedDirectory, ProjectContext } from './types.js';

/** Test hooks. Product code never passes them. */
export interface DiscoveryHooks {
  /** The owner a `.bowerloom` folder must have. Defaults to the current user. */
  readonly uid?: number;
  /** The device of a folder. Defaults to the device from lstat. */
  readonly deviceOf?: (directory: string) => string;
  /** The home folder from the user database. Defaults to `os.userInfo().homedir`; `null` for none. */
  readonly accountHome?: string | null;
}

interface Id { readonly dev: bigint; readonly ino: bigint }
const same = (a: Id, b: Id): boolean => a.dev === b.dev && a.ino === b.ino;
// Case-insensitive APFS also folds `ſ` to `s`, which toLowerCase alone does not; upper then lower case does.
const fold = (value: string): string => value.normalize('NFC').toUpperCase().toLowerCase();
const parts = (path: string): string[] => path.split(sep).filter(Boolean);
const errno = (error: unknown): unknown => (error as NodeJS.ErrnoException | null)?.code;
const absent = (error: unknown): boolean => errno(error) === 'ENOENT' || errno(error) === 'ENOTDIR';
const usable = (path: unknown): path is string => typeof path === 'string' && isAbsolute(path) && !path.includes('\0');

/** The device and inode of the folder a path names, links followed. `null` when nothing is there; PROJECT_UNREADABLE for any other failure. */
function folderId(path: string): Id | null {
  try { const s = statSync(path, { bigint: true }); return { dev: s.dev, ino: s.ino }; }
  catch (error) { if (absent(error)) return null; throw refuse('PROJECT_UNREADABLE'); }
}
/** As folderId, for a reference folder such as HOME/Library/CloudStorage: any failure means "no folder to compare with". */
function referenceId(path: string): Id | null { try { return folderId(path); } catch { return null; } }

function homesOf(home: string, hooks: DiscoveryHooks): string[] {
  let account: string | null | undefined = hooks.accountHome;
  if (account === undefined) { try { account = userInfo().homedir; } catch { account = null; } }
  return [...new Set([resolve(home), ...(usable(account) ? [resolve(account)] : [])])];
}

/**
 * True when iCloud syncs HOME/Documents or HOME/Desktop. The marker is that folder's name inside
 * HOME/Library/Mobile Documents/com~apple~CloudDocs. Sync is on when the marker is a real folder, or a symlink that
 * resolves to HOME/Documents or HOME/Desktop, as macOS 15 shows it. A marker that lstat or realpath cannot read
 * (EPERM, EACCES or anything but "not there") refuses. No attribute is read and no process starts.
 */
function syncOn(home: string, folder: 'Documents' | 'Desktop'): boolean {
  const marker = join(home, 'Library', 'Mobile Documents', 'com~apple~CloudDocs', folder);
  const read = <T>(step: () => T): T | null => { try { return step(); } catch (error) { if (absent(error)) return null; throw refuse('PROJECT_IN_CLOUD_FOLDER'); } };
  const link = read(() => lstatSync(marker));
  if (link === null) return false;
  if (link.isDirectory()) return true;
  if (!link.isSymbolicLink()) return false;
  const target = read(() => realpathSync(marker));
  if (target === null) return false;
  const resolved = read(() => statSync(target, { bigint: true })), synced = read(() => statSync(join(home, folder), { bigint: true }));
  return resolved !== null && synced !== null && same({ dev: resolved.dev, ino: resolved.ino }, { dev: synced.dev, ino: synced.ino });
}

/** The rules for the folders `rel` below one home folder. */
function belowHome(rel: readonly string[], home: string): void {
  if (rel.length === 0) throw refuse('PROJECT_ROOT_REFUSED');
  const first = fold(rel[0]!), second = rel[1] === undefined ? undefined : fold(rel[1]);
  if (first === 'library' && (second === 'mobile documents' || second === 'cloudstorage')) throw refuse('PROJECT_IN_CLOUD_FOLDER');
  if ((first === 'documents' || first === 'desktop') && syncOn(home, first === 'documents' ? 'Documents' : 'Desktop')) throw refuse('PROJECT_IN_CLOUD_FOLDER');
}

/** The existing folders on a path, from the path itself up to `/`, each with its depth (its number of path parts). */
function chainOf(targetParts: readonly string[]): { depth: number; id: Id }[] {
  const chain: { depth: number; id: Id }[] = [];
  for (let depth = targetParts.length; depth >= 0; depth--) {
    const id = folderId(sep + targetParts.slice(0, depth).join(sep));
    if (id !== null) chain.push({ depth, id });
  }
  return chain;
}

/** The rules for one spelling of the path. */
function checkSpelling(targetParts: readonly string[], chain: readonly { depth: number; id: Id }[], homes: readonly string[]): void {
  if (targetParts.length === 0) throw refuse('PROJECT_ROOT_REFUSED');
  // By spelling, folded: this also covers folders that do not exist yet.
  for (const h of homes) {
    const homeParts = parts(h);
    if (homeParts.length <= targetParts.length && homeParts.every((part, i) => fold(part) === fold(targetParts[i]!))) belowHome(targetParts.slice(homeParts.length), h);
  }
  // By identity: each folder on the path that exists.
  const root = folderId(sep), on = (id: Id | null): boolean => id !== null && chain.some(entry => same(entry.id, id));
  if (root !== null && chain[0]?.depth === targetParts.length && same(chain[0].id, root)) throw refuse('PROJECT_ROOT_REFUSED');
  for (const h of homes) {
    const homeId = referenceId(h), at = homeId === null ? undefined : chain.find(entry => same(entry.id, homeId));
    if (at !== undefined) belowHome(targetParts.slice(at.depth), h);
    if (on(referenceId(join(h, 'Library', 'Mobile Documents'))) || on(referenceId(join(h, 'Library', 'CloudStorage')))) throw refuse('PROJECT_IN_CLOUD_FOLDER');
    for (const folder of ['Documents', 'Desktop'] as const) if (on(referenceId(join(h, folder))) && syncOn(h, folder)) throw refuse('PROJECT_IN_CLOUD_FOLDER');
  }
}

/**
 * Refuses `/`, each home folder (HOME and the home folder from the user database), every path under a home's
 * Library/Mobile Documents or Library/CloudStorage, and the paths under a home's Documents or Desktop when iCloud syncs
 * that folder (see syncOn). The rules run on the path as given and on its real path (the deepest existing folder with
 * links resolved, plus the rest), so a link into a cloud folder is caught. A folder on the path that cannot be read
 * refuses PROJECT_UNREADABLE.
 */
export function checkProjectPathWith(path: string, home: string, hooks: DiscoveryHooks = {}): void {
  if (!usable(path) || !usable(home)) throw refuse('USAGE');
  const targetParts = parts(resolve(path)), homes = homesOf(home, hooks), chain = chainOf(targetParts);
  checkSpelling(targetParts, chain, homes);
  const deepest = chain[0];
  if (deepest === undefined) return;
  let real: string;
  try { real = realpathSync(sep + targetParts.slice(0, deepest.depth).join(sep)); } catch (error) { throw refuse(absent(error) ? 'PROJECT_NOT_FOUND' : 'PROJECT_UNREADABLE'); }
  const realParts = [...parts(real), ...targetParts.slice(deepest.depth)];
  if (realParts.join(sep) !== targetParts.join(sep)) checkSpelling(realParts, chainOf(realParts), homes);
}

/** The first 32 hex characters of sha256 over the real path, device and inode. */
export function projectId(root: string, identity: DirectoryIdentity): string {
  return createHash('sha256').update(JSON.stringify([root, identity.device, identity.inode])).digest('hex').slice(0, 32);
}

const identityFrom = (stat: BigIntStats): DirectoryIdentity =>
  ({ device: stat.dev.toString(), inode: stat.ino.toString(), birthtimeNs: stat.birthtimeNs.toString(), uid: Number(stat.uid), mode: Number(stat.mode) & 0o777 });
/** One lstat of a folder: a real folder (not a link) or PROJECT_UNSAFE; PROJECT_UNREADABLE when lstat fails. */
function pin(path: string): DirectoryIdentity {
  let stat: BigIntStats; try { stat = lstatSync(path, { bigint: true }); } catch { throw refuse('PROJECT_UNREADABLE'); }
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw refuse('PROJECT_UNSAFE');
  return identityFrom(stat);
}

/**
 * Finds the project the way git finds `.git`: the nearest parent folder that holds a real, owned, non-symlinked,
 * not group- or world-writable `.bowerloom`, with no case alias. The nearest hit decides; an unsafe one is never
 * skipped, and neither is a folder that cannot be read (PROJECT_UNREADABLE). The search stops at a device change and
 * at `/` and each home folder, compared by device and inode, and refuses them as projects.
 */
export function discoverProjectWith(cwd: string, home: string, hooks: DiscoveryHooks = {}): ProjectContext {
  if (!usable(cwd) || !usable(home)) throw refuse('USAGE');
  let start: string;
  try { start = realpathSync(cwd); } catch (error) { throw refuse(absent(error) ? 'PROJECT_NOT_FOUND' : 'PROJECT_UNREADABLE'); }
  checkProjectPathWith(start, home, hooks);
  const stops = [folderId(sep), ...homesOf(home, hooks).map(folderId)].filter((id): id is Id => id !== null);
  const uid = hooks.uid ?? process.getuid?.() ?? -1;
  const deviceOf = (directory: string): string => {
    if (hooks.deviceOf) return hooks.deviceOf(directory);
    try { return lstatSync(directory, { bigint: true }).dev.toString(); } catch { throw refuse('PROJECT_UNREADABLE'); }
  };
  const startDevice = deviceOf(start);
  for (let current = start; ;) {
    if (deviceOf(current) !== startDevice) throw refuse('PROJECT_NOT_FOUND');
    let names: string[]; try { names = readdirSync(current); } catch { throw refuse('PROJECT_UNREADABLE'); }
    const aliases = names.filter(name => fold(name) === '.bowerloom'), id = folderId(current);
    if (current === sep || (id !== null && stops.some(stop => same(stop, id)))) throw refuse(aliases.length ? 'PROJECT_ROOT_REFUSED' : 'PROJECT_NOT_FOUND');
    if (aliases.length) return build(current, aliases, uid, home, hooks);
    const parent = dirname(current);
    if (parent === current) throw refuse('PROJECT_NOT_FOUND');
    current = parent;
  }
}

function build(dir: string, aliases: string[], uid: number, home: string, hooks: DiscoveryHooks): ProjectContext {
  checkProjectPathWith(dir, home, hooks);
  if (aliases.length !== 1 || aliases[0] !== '.bowerloom') throw refuse('PROJECT_UNSAFE');
  // One lstat both checks .bowerloom and pins its identity, so nothing can swap it between the two.
  let stat: BigIntStats; try { stat = lstatSync(join(dir, '.bowerloom'), { bigint: true }); } catch { throw refuse('PROJECT_UNSAFE'); }
  if (stat.isSymbolicLink() || !stat.isDirectory() || Number(stat.uid) !== uid || (Number(stat.mode) & 0o022) !== 0) throw refuse('PROJECT_UNSAFE');
  const bowerloomIdentity = identityFrom(stat), identity = pin(dir);
  const names = parts(dirname(dir)), ancestry: PinnedDirectory[] = [{ path: sep, identity: pin(sep) }];
  for (let i = 0; i < names.length; i++) { const path = sep + names.slice(0, i + 1).join(sep); ancestry.push({ path, identity: pin(path) }); }
  return Object.freeze({ dir, identity, ancestry: Object.freeze(ancestry), bowerloomIdentity, projectId: projectId(dir, identity) });
}

/**
 * Refuses PROJECT_UNSAFE unless the project folder and its `.bowerloom` are still the folders discovery pinned (device,
 * inode and birth time), real and not links. A reader calls it before and after it reads, so a swap in between is caught.
 */
export function verifyProjectPins(project: ProjectContext): void {
  for (const [path, pinned] of [[project.dir, project.identity], [join(project.dir, '.bowerloom'), project.bowerloomIdentity]] as const) {
    let stat: BigIntStats; try { stat = lstatSync(path, { bigint: true }); } catch { throw refuse('PROJECT_UNSAFE'); }
    if (stat.isSymbolicLink() || !stat.isDirectory() || stat.dev.toString() !== pinned.device || stat.ino.toString() !== pinned.inode || stat.birthtimeNs.toString() !== pinned.birthtimeNs) throw refuse('PROJECT_UNSAFE');
  }
}
