/**
 * Registered folders (spec 05, Part B, section 3.3): folders outside a project that a slice may select from. The record
 * of one lives in the store, at `<store>/folders/<folder-name>.json`, and names the folder relative to the real home
 * folder. Bowerloom reads a registered folder and never writes it.
 *
 * Every check here reads with `lstat`, so a link is never followed. A folder is compared by device and inode wherever it
 * is compared. The `...With` forms take the test hooks of discovery. Internal to packages/project-context except the
 * names the package index exports.
 */
import { createHash, randomBytes } from 'node:crypto';
import { closeSync, constants, fchmodSync, fstatSync, fsyncSync, linkSync, lstatSync, mkdirSync, openSync, readSync, readdirSync, realpathSync, statSync, unlinkSync, writeSync } from 'node:fs';
import type { BigIntStats } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { strictJson } from '../../codex-adapter/src/safe.js';
import { checkProjectPathWith, fold, homesOf, identityFrom } from './discovery.js';
import type { DiscoveryHooks } from './discovery.js';
import { refuse } from './refusal.js';
import { STORE_DIRNAME, chmodOwn, inspectStoreWith, pathInsideStore, strictText, syncFolder, verifyStorePins, withStoreForWriteWith, writing } from './store.js';
import type { StoreContext } from './store.js';
import type { DirectoryIdentity } from './types.js';

export const FOLDER_FORMAT = 'bowerloom/store-folder/v1beta1';
export const FOLDERS_DIR = 'folders';
const NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const TEMP = /^\.folder-[a-z0-9-]{1,64}\.[a-f0-9]{16}\.tmp$/;
const RECORD_LIMIT = 4096, REL_LIMIT = 1024;
const HEX64 = /^[a-f0-9]{64}$/;
const IGNORABLE = '.DS_Store';
const CONTROL = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;

const errno = (error: unknown): unknown => (error as NodeJS.ErrnoException | null)?.code;
const missing = (error: unknown): boolean => errno(error) === 'ENOENT' || errno(error) === 'ENOTDIR';
const cmp = (a: string, b: string): number => Buffer.compare(Buffer.from(a), Buffer.from(b));
const digest = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const uidOf = (hooks: { readonly uid?: number }): number => hooks.uid ?? process.getuid?.() ?? -1;

/** A folder name: lower-case letters and digits in words joined by single hyphens, at most 64 characters. */
export const isFolderName = (value: unknown): value is string => typeof value === 'string' && value.length >= 1 && value.length <= 64 && NAME_PATTERN.test(value);
/** A path relative to the home folder: 1 to 1024 bytes, no empty, `.`-leading, or `..` segment, no leading `/`, no control character. */
function validRel(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && Buffer.byteLength(value) <= REL_LIMIT && !CONTROL.test(value) && !value.includes('\0')
    && value.split('/').every(segment => segment !== '' && !segment.startsWith('.'));
}

/** Raised inside this module when the folder, or a folder on its path, is not there. Wrappers turn it into a hold or a refusal. */
class Gone extends Error { constructor() { super('gone'); } }
const isGone = (error: unknown): boolean => error instanceof Gone;

/** A real folder that only this user can change. */
function ownedFolder(stat: BigIntStats, uid: number): boolean {
  return stat.isDirectory() && !stat.isSymbolicLink() && Number(stat.uid) === uid && (Number(stat.mode) & 0o022) === 0;
}

/** The real path of the home folder. The store sits in it, and every registered folder is below it. */
function realHome(home: string): string {
  if (typeof home !== 'string' || !isAbsolute(home) || home.includes('\0')) throw refuse('USAGE');
  try { return realpathSync.native(home); } catch { throw refuse('STORE_UNREADABLE'); }
}

// ---------------------------------------------------------------------------------------------------- the folders folder

interface FoldersState { identity: DirectoryIdentity | null; names: string[] }
/** The `folders` folder of a store: absent, or a real folder that the user owns with no group or world write. */
function foldersState(store: StoreContext, hooks: { readonly uid?: number }): FoldersState {
  const dir = join(store.dir, FOLDERS_DIR);
  let stat: BigIntStats;
  try { stat = lstatSync(dir, { bigint: true }); } catch (error) { if (missing(error)) return { identity: null, names: [] }; throw refuse('STORE_UNREADABLE'); }
  if (!ownedFolder(stat, uidOf(hooks))) throw refuse('FOLDER_UNSAFE');
  let names: string[];
  try { names = readdirSync(dir); } catch { throw refuse('STORE_UNREADABLE'); }
  return { identity: identityFrom(stat), names: names.sort(cmp) };
}

// ------------------------------------------------------------------------------------------------------------ the record

export interface FolderRecord {
  readonly name: string;
  /** The folder relative to the real home folder. */
  readonly path: string;
  readonly sha256: string;
  readonly bytes: number;
  /** Device and inode of the record file. */
  readonly fileIdentity: { readonly device: string; readonly inode: string };
}

/**
 * Reads `<store>/folders/<name>.json` (spec 05, section 4.4). FOLDER_NOT_FOUND when the folder or the file is absent;
 * FOLDER_UNSAFE when the file is not a plain file of this user; FOLDER_INVALID when its content is wrong.
 */
export function readFolderRecord(store: StoreContext, name: string, hooks: { readonly uid?: number } = {}): FolderRecord {
  if (!isFolderName(name)) throw refuse('FOLDER_NAME_INVALID');
  const uid = uidOf(hooks), dir = join(store.dir, FOLDERS_DIR), file = join(dir, name + '.json');
  let dirStat: BigIntStats;
  try { dirStat = lstatSync(dir, { bigint: true }); } catch (error) { throw refuse(missing(error) ? 'FOLDER_NOT_FOUND' : 'STORE_UNREADABLE'); }
  if (!ownedFolder(dirStat, uid)) throw refuse('FOLDER_UNSAFE');
  let before: BigIntStats;
  try { before = lstatSync(file, { bigint: true }); } catch (error) { throw refuse(missing(error) ? 'FOLDER_NOT_FOUND' : 'STORE_UNREADABLE'); }
  if (before.isSymbolicLink() || !before.isFile() || before.nlink !== 1n || Number(before.uid) !== uid || (Number(before.mode) & 0o022) !== 0) throw refuse('FOLDER_UNSAFE');
  let fd: number;
  try { fd = openSync(file, constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW); }
  catch (error) { throw refuse(errno(error) === 'ELOOP' ? 'FOLDER_UNSAFE' : missing(error) ? 'FOLDER_NOT_FOUND' : 'STORE_UNREADABLE'); }
  let bytes: Buffer;
  try {
    const open = fstatSync(fd, { bigint: true });
    if (open.dev !== before.dev || open.ino !== before.ino) throw refuse('FOLDER_UNSAFE');
    const buffer = Buffer.alloc(RECORD_LIMIT + 1);
    let length = 0;
    for (;;) { const n = readSync(fd, buffer, length, buffer.length - length, null); if (n === 0) break; length += n; if (length === buffer.length) break; }
    bytes = buffer.subarray(0, length);
  } catch (error) {
    if (typeof errno(error) === 'string' && (errno(error) as string).startsWith('FOLDER_')) throw error;
    throw refuse('STORE_UNREADABLE');
  } finally { closeSync(fd); }
  if (bytes.length > RECORD_LIMIT || (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf)) throw refuse('FOLDER_INVALID');
  const text = strictText(bytes);
  if (text === null) throw refuse('FOLDER_INVALID');
  let value: unknown;
  try { value = strictJson(text, RECORD_LIMIT); } catch { throw refuse('FOLDER_INVALID'); }
  const keys = value !== null && typeof value === 'object' && !Array.isArray(value) ? Object.keys(value) : [];
  const record = value as { format?: unknown; path?: unknown };
  if (keys.length !== 2 || !keys.includes('format') || !keys.includes('path') || record.format !== FOLDER_FORMAT || !validRel(record.path)) throw refuse('FOLDER_INVALID');
  return Object.freeze({ name, path: record.path, sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length, fileIdentity: Object.freeze({ device: before.dev.toString(), inode: before.ino.toString() }) });
}

// ---------------------------------------------------------------------------------------------------------- the checks

/** The ancestor of `real` that is the home folder, found by device and inode, and the path below it. Null when `real` is not strictly below home. */
function belowHome(real: string, home: string): { homeDir: string; rel: string } | null {
  let homeId: BigIntStats;
  try { homeId = statSync(home, { bigint: true }); } catch { throw refuse('STORE_UNREADABLE'); }
  for (let current = dirname(real); ; current = dirname(current)) {
    let stat: BigIntStats | null = null;
    try { stat = statSync(current, { bigint: true }); } catch (error) { if (!missing(error)) throw refuse('FOLDER_UNSAFE'); }
    if (stat !== null && stat.dev === homeId.dev && stat.ino === homeId.ino) return { homeDir: current, rel: real.slice(current.length + 1) };
    if (dirname(current) === current) return null;
  }
}

/** True when the store of any home folder is, or is inside, `real`. A folder cannot hold the store unless it holds the home folder. */
function holdsStore(real: string, home: string, hooks: DiscoveryHooks): boolean {
  let target: BigIntStats;
  try { target = statSync(real, { bigint: true }); } catch { return false; }
  for (const h of homesOf(home, hooks)) {
    let current = join(h, STORE_DIRNAME);
    try { current = realpathSync(current); } catch (error) { if (missing(error)) continue; throw refuse('STORE_UNREADABLE'); }
    for (;; current = dirname(current)) {
      try { const stat = statSync(current, { bigint: true }); if (stat.dev === target.dev && stat.ino === target.ino) return true; } catch { /* Not a folder we can read. */ }
      if (dirname(current) === current) break;
    }
  }
  return false;
}

/** Check 5: the cloud and path rules of a project path. `PROJECT_IN_CLOUD_FOLDER` becomes FOLDER_IN_CLOUD, anything else FOLDER_UNSAFE. */
function cloudCheck(real: string, home: string, hooks: DiscoveryHooks): void {
  try { checkProjectPathWith(real, home, hooks); }
  catch (error) {
    const code = errno(error);
    if (code === 'USAGE') throw error;
    throw refuse(code === 'PROJECT_IN_CLOUD_FOLDER' ? 'FOLDER_IN_CLOUD' : 'FOLDER_UNSAFE');
  }
}

/**
 * Checks 4 to 8 of `folder add` on a folder that exists, given by its real path: strictly below home, the cloud rules,
 * every folder from home down real and safe, no hidden segment, and not the store. Returns the path below home.
 * `onMissing` says what a folder that vanished during the walk means.
 */
function checkBelowHome(real: string, home: string, hooks: DiscoveryHooks, onMissing: () => never): string {
  const below = belowHome(real, home);
  if (below === null) throw refuse('FOLDER_UNSAFE');
  cloudCheck(real, home, hooks);
  const uid = uidOf(hooks);
  let at = below.homeDir;
  for (const segment of ['', ...below.rel.split('/')]) {
    if (segment !== '') at = join(at, segment);
    let stat: BigIntStats;
    try { stat = lstatSync(at, { bigint: true }); } catch (error) { if (missing(error)) return onMissing(); throw refuse('FOLDER_UNSAFE'); }
    if (!ownedFolder(stat, uid)) throw refuse('FOLDER_UNSAFE');
  }
  if (below.rel.split('/').some(segment => segment.startsWith('.'))) throw refuse('FOLDER_UNSAFE');
  if (pathInsideStore(real, home, hooks) || holdsStore(real, home, hooks)) throw refuse('FOLDER_UNSAFE');
  return below.rel;
}

// ---------------------------------------------------------------------------------------------------------------- plans

const STORE_ABSENT = null;
interface StorePins { readonly identity: DirectoryIdentity; readonly file: { readonly device: string; readonly inode: string; readonly size: string; readonly ctimeNs: string } }
const pinsOf = (store: StoreContext): StorePins => ({ identity: store.identity, file: store.fileIdentity });
const identityKey = (id: DirectoryIdentity): string[] => [id.device, id.inode, id.birthtimeNs, String(id.uid), String(id.mode)];

export interface FolderAddPlan {
  readonly format: 'bowerloom/folder-add-plan/v1beta1';
  readonly name: string;
  /** The folder relative to the real home folder. */
  readonly path: string;
  readonly folder: DirectoryIdentity;
  /** True when the store is absent and this add makes it. */
  readonly storeCreate: boolean;
  readonly store: StorePins | null;
  readonly folders: { readonly identity: DirectoryIdentity | null; readonly names: readonly string[] };
  readonly writesAuthorized: false;
  readonly revision: string;
}
export interface FolderRemovePlan {
  readonly format: 'bowerloom/folder-remove-plan/v1beta1';
  readonly name: string;
  readonly path: string;
  readonly store: StorePins;
  readonly record: { readonly sha256: string; readonly bytes: number; readonly device: string; readonly inode: string };
  readonly writesAuthorized: false;
  readonly revision: string;
}
/** The store as a plan sees it: absent, or a valid store. `created` says that this very run made it, so the plan saw it absent. */
type StoreView = { state: 'absent' } | { state: 'store'; context: StoreContext };
function viewOf(home: string, hooks: DiscoveryHooks, inside?: { store: StoreContext; created: boolean }): StoreView {
  if (inside !== undefined) return inside.created ? { state: 'absent' } : { state: 'store', context: inside.store };
  const found = inspectStoreWith(home, hooks);
  if (found.state === 'foreign') throw refuse('STORE_INVALID');
  return found.state === 'absent' ? { state: 'absent' } : { state: 'store', context: found.context };
}

/** Where a path argument points: `~` and a leading `~/` are the home folder; anything else resolves against the working folder. */
function targetOf(home: string, cwd: string, argument: string): string {
  if (typeof argument !== 'string' || argument === '' || argument.includes('\0') || typeof cwd !== 'string' || !isAbsolute(cwd)) throw refuse('USAGE');
  if (argument === '~') return resolve(home);
  return argument.startsWith('~/') ? resolve(home, argument.slice(2)) : resolve(cwd, argument);
}

function buildAdd(home: string, cwd: string, name: string, argument: string, hooks: DiscoveryHooks, inside?: { store: StoreContext; created: boolean }): FolderAddPlan {
  if (!isFolderName(name)) throw refuse('FOLDER_NAME_INVALID');
  const view = viewOf(home, hooks, inside);
  const target = targetOf(home, cwd, argument);
  let real: string;
  try { real = realpathSync.native(target); } catch (error) { if (missing(error)) throw refuse('FOLDER_UNSAFE', 'The folder does not exist.'); throw refuse('FOLDER_UNSAFE'); }
  const homeDir = realHome(home);
  const rel = checkBelowHome(real, homeDir, hooks, () => { throw refuse('FOLDER_UNSAFE', 'The folder does not exist.'); });
  if (Buffer.byteLength(rel) > REL_LIMIT || CONTROL.test(rel)) throw refuse('FOLDER_UNSAFE');
  let identity: DirectoryIdentity;
  try { identity = identityFrom(lstatSync(real, { bigint: true })); } catch { throw refuse('FOLDER_UNSAFE'); }
  const folders: FoldersState = view.state === 'store' ? foldersState(view.context, hooks) : { identity: null, names: [] };
  const wanted = fold(name + '.json');
  if (folders.names.some(n => fold(n) === wanted)) throw refuse('FOLDER_EXISTS');
  const store = view.state === 'store' ? pinsOf(view.context) : STORE_ABSENT;
  const body = {
    format: 'bowerloom/folder-add-plan/v1beta1' as const, name, path: rel, folder: identity, storeCreate: view.state === 'absent', store,
    folders: { identity: folders.identity, names: folders.names }, writesAuthorized: false as const,
  };
  const revision = digest([body.format, name, rel, identityKey(identity), body.storeCreate, store === null ? null : [identityKey(store.identity), store.file.device, store.file.inode, store.file.size, store.file.ctimeNs],
    folders.identity === null ? null : identityKey(folders.identity), folders.names]);
  return Object.freeze({ ...body, revision });
}

/** Plans `folder add`. Reads only. Throws the refusals of spec 05, section 3.3, in the order it lists them. */
export function planFolderAddWith(home: string, cwd: string, name: string, argument: string, hooks: DiscoveryHooks = {}): FolderAddPlan { return buildAdd(home, cwd, name, argument, hooks); }

const leftoverTemps = (names: readonly string[]): string[] => names.filter(n => TEMP.test(n));
function removeLeftovers(dir: string): void {
  let names: string[];
  try { names = readdirSync(dir); } catch { throw refuse('STORE_UNREADABLE'); }
  writing(() => {
    let removed = false;
    for (const name of leftoverTemps(names)) { try { unlinkSync(join(dir, name)); removed = true; } catch (error) { if (!missing(error)) throw error; } }
    if (removed) syncFolder(dir);
  });
}

/**
 * Applies a `folder add` plan under the store lock, which makes the store when it is absent. Plans again inside the
 * lock and refuses STALE_APPROVAL when the revision differs. The record is written to a temporary name and linked into
 * place, so it appears whole or not at all.
 */
export async function applyFolderAddWith(home: string, cwd: string, name: string, argument: string, revision: string, signal: AbortSignal, hooks: DiscoveryHooks = {}): Promise<{ name: string; path: string }> {
  if (typeof revision !== 'string' || !HEX64.test(revision)) throw refuse('STALE_APPROVAL');
  return withStoreForWriteWith(home, signal, async (store, held, created) => {
    const plan = buildAdd(home, cwd, name, argument, hooks, { store, created });
    if (plan.revision !== revision) throw refuse('STALE_APPROVAL');
    held.assertHeld(store.dir);
    const dir = join(store.dir, FOLDERS_DIR), final = join(dir, name + '.json');
    writing(() => {
      if (plan.folders.identity === null) { mkdirSync(dir, { mode: 0o700 }); chmodOwn(dir); }
    });
    removeLeftovers(dir);
    const temp = join(dir, `.folder-${name}.${randomBytes(8).toString('hex')}.tmp`);
    let exists = false;
    writing(() => {
      let made = false;
      try {
        const fd = openSync(temp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o644); made = true;
        try {
          fchmodSync(fd, 0o644);
          const data = Buffer.from(`{"format":"${FOLDER_FORMAT}","path":${JSON.stringify(plan.path)}}\n`);
          let at = 0; while (at < data.length) at += writeSync(fd, data, at);
          fsyncSync(fd);
        } finally { closeSync(fd); }
        try { linkSync(temp, final); } catch (error) { if (errno(error) === 'EEXIST') exists = true; else throw error; }
        unlinkSync(temp); made = false;
        syncFolder(dir);
      } finally { if (made) { try { unlinkSync(temp); } catch { /* Already gone. */ } } }
    });
    if (exists) throw refuse('STALE_APPROVAL');
    verifyStorePins(store, hooks);
    return { name, path: plan.path };
  }, hooks);
}

function buildRemove(home: string, name: string, hooks: DiscoveryHooks, inside?: StoreContext): FolderRemovePlan {
  if (!isFolderName(name)) throw refuse('FOLDER_NAME_INVALID');
  let store: StoreContext;
  if (inside !== undefined) store = inside;
  else {
    const found = inspectStoreWith(home, hooks);
    if (found.state === 'absent') throw refuse('FOLDER_NOT_FOUND');
    if (found.state === 'foreign') throw refuse('STORE_INVALID');
    store = found.context;
  }
  const record = readFolderRecord(store, name, hooks), pins = pinsOf(store);
  const body = { format: 'bowerloom/folder-remove-plan/v1beta1' as const, name, path: record.path, store: pins, record: { sha256: record.sha256, bytes: record.bytes, device: record.fileIdentity.device, inode: record.fileIdentity.inode }, writesAuthorized: false as const };
  const revision = digest([body.format, name, record.path, identityKey(pins.identity), pins.file.device, pins.file.inode, pins.file.size, pins.file.ctimeNs, record.sha256, record.bytes, record.fileIdentity.device, record.fileIdentity.inode]);
  return Object.freeze({ ...body, revision });
}

/** Plans `folder remove`. Reads only. FOLDER_NOT_FOUND when the store or the record is absent. */
export function planFolderRemoveWith(home: string, name: string, hooks: DiscoveryHooks = {}): FolderRemovePlan { return buildRemove(home, name, hooks); }

/** Applies a `folder remove` plan under the store lock: plans again, checks the revision, removes the record file only, and flushes the folder. */
export async function applyFolderRemoveWith(home: string, name: string, revision: string, signal: AbortSignal, hooks: DiscoveryHooks = {}): Promise<{ name: string }> {
  if (typeof revision !== 'string' || !HEX64.test(revision)) throw refuse('STALE_APPROVAL');
  // The store must still be there: this command never makes one.
  const found = inspectStoreWith(home, hooks);
  if (found.state !== 'store') throw refuse(found.state === 'foreign' ? 'STORE_INVALID' : 'STALE_APPROVAL');
  return withStoreForWriteWith(home, signal, async (store, held) => {
    let plan: FolderRemovePlan;
    try { plan = buildRemove(home, name, hooks, store); } catch (error) { throw errno(error) === 'FOLDER_NOT_FOUND' ? refuse('STALE_APPROVAL') : error; }
    if (plan.revision !== revision) throw refuse('STALE_APPROVAL');
    held.assertHeld(store.dir);
    const dir = join(store.dir, FOLDERS_DIR);
    removeLeftovers(dir);
    writing(() => { unlinkSync(join(dir, name + '.json')); syncFolder(dir); });
    verifyStorePins(store, hooks);
    return { name };
  }, hooks);
}

/** The plan in plain words, verbatim from spec 05, section 3.3. Control characters are escaped by the command that prints it. */
export function renderFolderAddReview(plan: FolderAddPlan): string {
  return [
    ...(plan.storeCreate ? ['Create the store at ~/.bowerloom (store.json). It holds definitions only.'] : []),
    `Register folder ${plan.name} in the store at ~/.bowerloom/folders/${plan.name}.json`,
    `  Folder: ~/${plan.path}`,
    `  A slice names it with root: { registered: ${plan.name} }. Bowerloom reads this folder and never writes it.`,
    'This writes the store only. It changes no project, and it installs nothing.',
  ].join('\n');
}
export function renderFolderRemoveReview(plan: FolderRemovePlan): string {
  return [
    `Remove folder ${plan.name} from the store: ~/.bowerloom/folders/${plan.name}.json`,
    `  Folder: ~/${plan.path}. The folder stays. Bowerloom never writes it.`,
    '  Slices that name this folder are held with SLICE_ROOT_MISSING until the name is registered again.',
    'This writes the store only. It changes no project.',
  ].join('\n');
}

// -------------------------------------------------------------------------------------------------------- list and resolve

export interface FolderListing {
  readonly name: string;
  /** `~/<rel>`, or null when the record cannot be read. */
  readonly path: string | null;
  readonly state: 'ready' | 'missing' | 'refused';
  readonly code: string | null;
}
export interface FolderList { readonly store: boolean; readonly folders: readonly FolderListing[] }

export interface ResolvedRoot {
  readonly ok: true;
  /** The real path of the root: the registered folder joined with the slice's path. */
  readonly dir: string;
  /** The real path of the registered folder itself. */
  readonly folderDir: string;
  /** The recorded path below home. */
  readonly rel: string;
  readonly identity: DirectoryIdentity;
  readonly recordSha256: string;
}
export type RootHold = { readonly ok: false; readonly code: 'SLICE_ROOT_MISSING' | 'SLICE_ROOT_UNSAFE'; readonly detail: string };

/**
 * The root of a slice in a registered folder (spec 05, section 3.4, steps 2 to 5 and 7). Throws `Gone` when the store,
 * the record, or a folder on the way is absent. Any other fault is a FOLDER_* or STORE_* refusal.
 */
function resolveRoot(home: string, store: StoreContext, name: string, path: string, hooks: DiscoveryHooks): ResolvedRoot {
  const record = readFolderRecord(store, name, hooks), homeDir = realHome(home);
  const folderDir = join(homeDir, record.path), dir = path === '.' ? folderDir : join(folderDir, path);
  checkBelowHome(dir, homeDir, hooks, () => { throw new Gone(); });
  let identity: DirectoryIdentity;
  try { identity = identityFrom(lstatSync(dir, { bigint: true })); } catch (error) { if (missing(error)) throw new Gone(); throw refuse('FOLDER_UNSAFE'); }
  return Object.freeze({ ok: true as const, dir, folderDir, rel: record.path, identity, recordSha256: record.sha256 });
}

/**
 * Resolves the root of a slice that names registered folder `name` and a path inside it, for `bowerloom apply` and the
 * guard. It returns the hold of the slice when the root cannot be used: SLICE_ROOT_MISSING for a store, a record, or a
 * folder that is not there; SLICE_ROOT_UNSAFE for any other fault. Reads only.
 */
export function resolveRegisteredRootWith(home: string, name: string, path: string, hooks: DiscoveryHooks = {}): ResolvedRoot | RootHold {
  let found;
  try { found = inspectStoreWith(home, hooks); } catch { return { ok: false, code: 'SLICE_ROOT_UNSAFE', detail: '~/.bowerloom' }; }
  if (found.state === 'absent') return { ok: false, code: 'SLICE_ROOT_MISSING', detail: name };
  if (found.state === 'foreign') return { ok: false, code: 'SLICE_ROOT_UNSAFE', detail: '~/.bowerloom' };
  try { return resolveRoot(home, found.context, name, path, hooks); }
  catch (error) {
    if (isGone(error) || errno(error) === 'FOLDER_NOT_FOUND') return { ok: false, code: 'SLICE_ROOT_MISSING', detail: name };
    return { ok: false, code: 'SLICE_ROOT_UNSAFE', detail: unsafeDetail(found.context, name, path, hooks) };
  }
}
/** `resolveRegisteredRootWith` for the registered folder itself. */
export function resolveRegisteredFolderWith(home: string, name: string, hooks: DiscoveryHooks = {}): ResolvedRoot | RootHold { return resolveRegisteredRootWith(home, name, '.', hooks); }
/** The folder a person should look at: `~/<rel>[/<path>]` when the record reads, else the store. */
function unsafeDetail(store: StoreContext, name: string, path: string, hooks: DiscoveryHooks): string {
  try { const record = readFolderRecord(store, name, hooks); return `~/${record.path}${path === '.' ? '' : '/' + path}`; } catch { return `~/.bowerloom/${FOLDERS_DIR}/${name}.json`; }
}

/** The registered folders of a store, sorted by name, each with its state. Reads only. */
export function listFoldersWith(home: string, hooks: DiscoveryHooks = {}): FolderList {
  const found = inspectStoreWith(home, hooks);
  if (found.state === 'absent') return { store: false, folders: [] };
  if (found.state === 'foreign') throw refuse('STORE_INVALID');
  const state = foldersState(found.context, hooks), out: FolderListing[] = [];
  for (const entry of state.names) {
    if (TEMP.test(entry) || entry === IGNORABLE) continue;
    const match = /^(.+)\.json$/.exec(entry);
    if (match === null || !isFolderName(match[1])) { out.push({ name: entry, path: null, state: 'refused', code: 'FOLDER_INVALID' }); continue; }
    const name = match[1];
    try {
      const record = readFolderRecord(found.context, name, hooks);
      try { resolveRoot(home, found.context, name, '.', hooks); out.push({ name, path: `~/${record.path}`, state: 'ready', code: null }); }
      catch (error) {
        if (isGone(error)) out.push({ name, path: `~/${record.path}`, state: 'missing', code: null });
        else out.push({ name, path: `~/${record.path}`, state: 'refused', code: typeof errno(error) === 'string' ? errno(error) as string : 'FOLDER_UNSAFE' });
      }
    } catch (error) {
      const code = errno(error);
      if (typeof code !== 'string' || !code.startsWith('FOLDER_')) throw error;
      out.push({ name, path: null, state: 'refused', code });
    }
  }
  return { store: true, folders: out.sort((a, b) => cmp(a.name, b.name)) };
}

// ------------------------------------------------------------------------------------------------ the forms without hooks

export const planFolderAdd = (home: string, cwd: string, name: string, argument: string): FolderAddPlan => planFolderAddWith(home, cwd, name, argument);
export const applyFolderAdd = (home: string, cwd: string, name: string, argument: string, revision: string, signal: AbortSignal): Promise<{ name: string; path: string }> => applyFolderAddWith(home, cwd, name, argument, revision, signal);
export const planFolderRemove = (home: string, name: string): FolderRemovePlan => planFolderRemoveWith(home, name);
export const applyFolderRemove = (home: string, name: string, revision: string, signal: AbortSignal): Promise<{ name: string }> => applyFolderRemoveWith(home, name, revision, signal);
export const listFolders = (home: string): FolderList => listFoldersWith(home);
export const resolveRegisteredFolder = (home: string, name: string): ResolvedRoot | RootHold => resolveRegisteredFolderWith(home, name);
export const resolveRegisteredRoot = (home: string, name: string, path: string): ResolvedRoot | RootHold => resolveRegisteredRootWith(home, name, path);
