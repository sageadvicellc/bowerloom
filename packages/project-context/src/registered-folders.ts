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
import { closeSync, constants, fchmodSync, fstatSync, fsyncSync, linkSync, lstatSync, mkdirSync, openSync, readSync, readdirSync, realpathSync, renameSync, rmdirSync, statSync, unlinkSync, writeSync } from 'node:fs';
import type { BigIntStats } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { DefinitionError, shellArg } from '../../contracts/src/index.js';
import { strictJson } from '../../codex-adapter/src/safe.js';
import { checkProjectPathWith, fold, homesOf, identityFrom, syncOn } from './discovery.js';
import type { DiscoveryHooks } from './discovery.js';
import { refuse } from './refusal.js';
import { STORE_CREATE_LINE, STORE_DIRNAME, chmodOwn, inspectStoreWith, pathInsideStore, strictText, syncFolder, verifyStorePins, withStoreForWriteWith, writing } from './store.js';
import type { StoreContext } from './store.js';
import { ensureStoreGitignore, storeGitignoreState } from './store-gitignore.js';
import type { StoreGitignoreState } from './store-gitignore.js';
import type { DirectoryIdentity } from './types.js';

export const FOLDER_FORMAT = 'bowerloom/store-folder/v1beta1';
export const FOLDERS_DIR = 'folders';
const NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const TEMP = /^\.folder-[a-z0-9-]{1,64}\.[a-f0-9]{16}\.tmp$/;
const RECORD_LIMIT = 4096, REL_LIMIT = 1024;
const HEX64 = /^[a-f0-9]{64}$/;
const IGNORABLE = '.DS_Store';
const CONTROL = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;

/** The test hooks of discovery, and the private state folder, which no registered folder may be, hold, or sit in. */
export interface FolderHooks extends DiscoveryHooks { readonly stateRoot?: string }
/** Who asks for a registered root: the project, by its id, and the private state folder of this machine. A grant is for one project. */
export interface RootAccess { readonly projectId: string; /** The summary kind the slice asks for: `heading`, `frontmatter:<key>`, or `none`. A grant records one kind, and a slice that asks for another is not allowed. A caller with no slice, such as the guard, leaves it out and needs the grant only. */ readonly summary?: string; /** The birth time of the project folder, in nanoseconds. A grant is for the folder that ran `folder allow`, not for another that took its inode. */ readonly birthtimeNs: string; readonly stateRoot?: string }
export const GRANT_FORMAT = 'bowerloom/store-folder-grant/v1beta1';
/** The summary kinds a grant can record. `none` copies no text, so it is never recorded and never held. */
const GRANT_SUMMARY = /^(?:heading|frontmatter:[A-Za-z0-9_-]{1,64})$/;
const GRANTS = /^[a-z0-9]+(?:-[a-z0-9]+)*\.grants$/;
const PROJECT_ID = /^[a-f0-9]{32}$/;
const REGISTRATION_ID = /^[a-f0-9]{32}$/;
const BIRTH = /^[0-9]{1,24}$/;
const GRANT_TEMP = /^\.grant-[a-f0-9]{32}\.[a-f0-9]{16}\.tmp$/;

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
/** Raised inside this module when the project has no grant for the folder. */
class NotAllowed extends Error { constructor(readonly granted?: string, readonly legacy?: boolean) { super('not allowed'); } }
/** What a grant file says: no grant for this record and project, a grant made without a kind, or a grant with a kind. */
type Granted = { readonly state: 'none' } | { readonly state: 'legacy' } | { readonly state: 'kind'; readonly kind: string };
/** A system error becomes STORE_UNREADABLE. An error with no code is a fault of Bowerloom, and it passes. */
const unreadable = (error: unknown): Error => typeof errno(error) === 'string' ? refuse('STORE_UNREADABLE') : error as Error;
/** FOLDER_NOT_ALLOWED, which names the folder. The text carries no path. */
export const notAllowed = (name: string): DefinitionError => new DefinitionError('FOLDER_NOT_ALLOWED', `This project is not allowed to read registered folder ${name}.`);

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

/** A name for a message: plain characters only, short. */
const plainName = (name: string): string => name.replace(/[^A-Za-z0-9._-]/g, '?').slice(0, 64);
interface GrantEntries { identity: DirectoryIdentity | null; ids: string[]; temps: string[] }
/**
 * The grants folder of a registered folder, read strictly: absent, or a real folder of this user whose every entry is a
 * grant (a 32-hex name, a plain file or a link, never followed) or a leftover temporary grant. Any other entry refuses
 * FOLDER_UNSAFE and names itself, so nothing is deleted from a folder that holds something else.
 */
function grantsEntries(store: StoreContext, name: string, hooks: { readonly uid?: number }): GrantEntries {
  const dir = join(store.dir, FOLDERS_DIR, name + '.grants');
  let stat: BigIntStats;
  try { stat = lstatSync(dir, { bigint: true }); } catch (error) { if (missing(error)) return { identity: null, ids: [], temps: [] }; throw unreadable(error); }
  if (!ownedFolder(stat, uidOf(hooks))) throw refuse('FOLDER_UNSAFE');
  let entries: string[];
  try { entries = readdirSync(dir); } catch (error) { throw unreadable(error); }
  const ids: string[] = [], temps: string[] = [];
  for (const entry of entries.sort(cmp)) {
    let kind: BigIntStats;
    try { kind = lstatSync(join(dir, entry), { bigint: true }); } catch (error) { throw missing(error) ? refuse('FOLDER_UNSAFE', `The grants folder changed while it was read: ${plainName(entry)}.`) : unreadable(error); }
    const odd = kind.isDirectory() || !(kind.isFile() || kind.isSymbolicLink());
    if (!odd && PROJECT_ID.test(entry)) ids.push(entry);
    else if (!odd && GRANT_TEMP.test(entry) && kind.isFile()) temps.push(entry);
    else throw refuse('FOLDER_UNSAFE', `The grants folder holds an unexpected entry: ${plainName(entry)}.`);
  }
  return { identity: identityFrom(stat), ids, temps };
}
/**
 * Removes every entry of a grants folder and the folder, never following a link. The folder must still be the one that was
 * planned: it is looked at again just before it is listed, and an entry that is a folder stops the removal.
 */
function removeGrantsFolder(dir: string, planned: DirectoryIdentity | null): void {
  if (planned === null) return;
  let stat: BigIntStats;
  try { stat = lstatSync(dir, { bigint: true }); } catch (error) { throw missing(error) ? refuse('STALE_APPROVAL') : unreadable(error); }
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.dev.toString() !== planned.device || stat.ino.toString() !== planned.inode || stat.birthtimeNs.toString() !== planned.birthtimeNs) throw refuse('STALE_APPROVAL');
  let entries: string[];
  try { entries = readdirSync(dir); } catch (error) { throw unreadable(error); }
  for (const entry of entries) {
    let kind: BigIntStats;
    try { kind = lstatSync(join(dir, entry), { bigint: true }); } catch (error) { throw missing(error) ? refuse('STALE_APPROVAL') : unreadable(error); }
    if (kind.isDirectory()) throw refuse('STALE_APPROVAL');
  }
  writing(() => { for (const entry of entries) unlinkSync(join(dir, entry)); rmdirSync(dir); syncFolder(dirname(dir)); });
}

interface FoldersState { identity: DirectoryIdentity | null; names: string[] }
/** The `folders` folder of a store: absent, or a real folder that the user owns with no group or world write. */
function foldersState(store: StoreContext, hooks: { readonly uid?: number }): FoldersState {
  const dir = join(store.dir, FOLDERS_DIR);
  let stat: BigIntStats;
  try { stat = lstatSync(dir, { bigint: true }); } catch (error) { if (missing(error)) return { identity: null, names: [] }; throw unreadable(error); }
  if (!ownedFolder(stat, uidOf(hooks))) throw refuse('FOLDER_UNSAFE');
  let names: string[];
  try { names = readdirSync(dir); } catch (error) { throw unreadable(error); }
  return { identity: identityFrom(stat), names: names.sort(cmp) };
}

// ------------------------------------------------------------------------------------------------------------ the record

export interface FolderRecord {
  readonly name: string;
  /** The registration id: 16 random bytes in hex, new on every `folder add`, so the record hash is never the same twice. */
  readonly id: string;
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
  try { dirStat = lstatSync(dir, { bigint: true }); } catch (error) { throw missing(error) ? refuse('FOLDER_NOT_FOUND') : unreadable(error); }
  if (!ownedFolder(dirStat, uid)) throw refuse('FOLDER_UNSAFE');
  let before: BigIntStats;
  try { before = lstatSync(file, { bigint: true }); } catch (error) { throw missing(error) ? refuse('FOLDER_NOT_FOUND') : unreadable(error); }
  if (before.isSymbolicLink() || !before.isFile() || before.nlink !== 1n || Number(before.uid) !== uid || (Number(before.mode) & 0o022) !== 0) throw refuse('FOLDER_UNSAFE');
  let fd: number;
  try { fd = openSync(file, constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW); }
  catch (error) { throw errno(error) === 'ELOOP' ? refuse('FOLDER_UNSAFE') : missing(error) ? refuse('FOLDER_NOT_FOUND') : unreadable(error); }
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
    throw unreadable(error);
  } finally { closeSync(fd); }
  if (bytes.length > RECORD_LIMIT || (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf)) throw refuse('FOLDER_INVALID');
  const text = strictText(bytes);
  if (text === null) throw refuse('FOLDER_INVALID');
  let value: unknown;
  try { value = strictJson(text, RECORD_LIMIT); } catch { throw refuse('FOLDER_INVALID'); }
  const keys = value !== null && typeof value === 'object' && !Array.isArray(value) ? Object.keys(value) : [];
  const record = value as { format?: unknown; path?: unknown; id?: unknown };
  if (keys.length !== 3 || !keys.includes('format') || !keys.includes('path') || !keys.includes('id') || record.format !== FOLDER_FORMAT || !validRel(record.path) || typeof record.id !== 'string' || !REGISTRATION_ID.test(record.id)) throw refuse('FOLDER_INVALID');
  return Object.freeze({ name, id: record.id, path: record.path, sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length, fileIdentity: Object.freeze({ device: before.dev.toString(), inode: before.ino.toString() }) });
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

/**
 * True when `path`, or a folder above it, is the same folder as `ancestor`, compared by device and inode and never by text,
 * so a case alias or a link names the same folder. A part of `path` that is not there is skipped. `ancestor` absent: false.
 * Any other error refuses, so the check fails closed.
 */
function sameOrInside(path: string, ancestor: string): boolean {
  let wanted: BigIntStats;
  try { wanted = statSync(ancestor, { bigint: true }); } catch (error) { if (missing(error)) return false; throw refuse('FOLDER_UNSAFE'); }
  for (let current = path; ; current = dirname(current)) {
    try { const stat = statSync(current, { bigint: true }); if (stat.dev === wanted.dev && stat.ino === wanted.ino) return true; }
    catch (error) { if (!missing(error)) throw refuse('FOLDER_UNSAFE'); }
    if (dirname(current) === current) return false;
  }
}

/** The rule of `path()` in managed-skills, which a root must pass at apply: a plain absolute NFC path with no segment that names a tool folder. */
function managedPathRejected(value: string): boolean {
  if (!(isAbsolute(value) && resolve(value) === value && value !== '/' && value === value.normalize('NFC') && Buffer.byteLength(value) <= 2048 && !/[\p{Cc}\p{Cf}\\]/u.test(value))) return true;
  return value.toLowerCase().split('/').some(part => ['.git', '.ssh', '.config', '.codex', '.claude', '.agents', 'node_modules', 'library'].includes(part))
    || /^\/(?:etc|usr|bin|sbin|system|private\/etc|private\/var\/root)(?:\/|$)/i.test(value);
}

/** FOLDER_IN_CLOUD when `real` holds the cloud folders of any home: Library/Mobile Documents, Library/CloudStorage, or a synced Documents or Desktop. */
function holdsCloud(real: string, home: string, hooks: FolderHooks): void {
  const exists = (path: string): boolean => { try { statSync(path); return true; } catch (error) { if (missing(error)) return false; throw refuse('FOLDER_IN_CLOUD'); } };
  for (const h of homesOf(home, hooks)) {
    const candidates = [join(h, 'Library', 'Mobile Documents'), join(h, 'Library', 'CloudStorage')];
    for (const folder of ['Documents', 'Desktop'] as const) {
      let synced: boolean; try { synced = syncOn(h, folder); } catch { throw refuse('FOLDER_IN_CLOUD'); }
      if (synced) candidates.push(join(h, folder));
    }
    for (const candidate of candidates) if (exists(candidate) && sameOrInside(candidate, real)) throw refuse('FOLDER_IN_CLOUD');
  }
}

/** True when the store of any home folder is, or is inside, `real`. A folder cannot hold the store unless it holds the home folder. */
export function holdsStore(real: string, home: string, hooks: FolderHooks): boolean {
  let target: BigIntStats;
  try { target = statSync(real, { bigint: true }); } catch (error) { if (missing(error)) return false; throw refuse('FOLDER_UNSAFE'); }
  for (const h of homesOf(home, hooks)) {
    let current = join(h, STORE_DIRNAME);
    try { current = realpathSync(current); } catch (error) { if (missing(error)) continue; throw refuse('FOLDER_UNSAFE'); }
    for (;; current = dirname(current)) {
      try { const stat = statSync(current, { bigint: true }); if (stat.dev === target.dev && stat.ino === target.ino) return true; }
      catch (error) { if (!missing(error)) throw refuse('FOLDER_UNSAFE'); }
      if (dirname(current) === current) break;
    }
  }
  return false;
}

/** Check 5: the cloud and path rules of a project path. `PROJECT_IN_CLOUD_FOLDER` becomes FOLDER_IN_CLOUD, anything else FOLDER_UNSAFE. */
function cloudCheck(real: string, home: string, hooks: FolderHooks): void {
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
function checkBelowHome(real: string, home: string, hooks: FolderHooks, onMissing: () => never): string {
  const below = belowHome(real, home);
  if (below === null) throw refuse('FOLDER_UNSAFE');
  cloudCheck(real, home, hooks);
  holdsCloud(real, home, hooks);
  if (managedPathRejected(real)) throw refuse('FOLDER_UNSAFE');
  if (hooks.stateRoot !== undefined && (sameOrInside(real, hooks.stateRoot) || sameOrInside(hooks.stateRoot, real))) throw refuse('FOLDER_UNSAFE');
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
  /** The grants of an earlier registration of this name, which the add removes, so that they never apply to the new record. */
  readonly oldGrants: number;
  readonly oldGrantsIdentity: DirectoryIdentity | null;
  /** Fix 3 of the beta.3 docs review: what the store's .gitignore needs. `create` for a store this add makes. Bound. */
  readonly gitignore: StoreGitignoreState['state'];
  readonly writesAuthorized: false;
  readonly revision: string;
}
export interface FolderRemovePlan {
  readonly format: 'bowerloom/folder-remove-plan/v1beta1';
  readonly name: string;
  readonly path: string;
  readonly store: StorePins;
  readonly record: { readonly sha256: string; readonly bytes: number; readonly device: string; readonly inode: string };
  /** The grants of projects that go with the record. */
  readonly grants: readonly string[];
  readonly grantsIdentity: DirectoryIdentity | null;
  readonly writesAuthorized: false;
  readonly revision: string;
}
/** The store as a plan sees it: absent, or a valid store. `created` says that this very run made it, so the plan saw it absent. */
type StoreView = { state: 'absent' } | { state: 'store'; context: StoreContext };
function viewOf(home: string, hooks: FolderHooks, inside?: { store: StoreContext; created: boolean }): StoreView {
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

function buildAdd(home: string, cwd: string, name: string, argument: string, hooks: FolderHooks, inside?: { store: StoreContext; created: boolean }): FolderAddPlan {
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
  const old = view.state === 'store' ? grantsEntries(view.context, name, hooks) : { identity: null, ids: [], temps: [] };
  const ignore: StoreGitignoreState = view.state === 'store' ? storeGitignoreState(view.context.dir, uidOf(hooks)) : { state: 'create', sha256: null };
  const body = {
    format: 'bowerloom/folder-add-plan/v1beta1' as const, name, path: rel, folder: identity, storeCreate: view.state === 'absent', store,
    folders: { identity: folders.identity, names: folders.names }, oldGrants: old.ids.length, oldGrantsIdentity: old.identity, gitignore: ignore.state, writesAuthorized: false as const,
  };
  const revision = digest([body.format, name, rel, identityKey(identity), body.storeCreate, store === null ? null : [identityKey(store.identity), store.file.device, store.file.inode, store.file.size, store.file.ctimeNs],
    folders.identity === null ? null : identityKey(folders.identity), folders.names, old.ids, old.identity === null ? null : identityKey(old.identity), ignore.state, ignore.sha256]);
  return Object.freeze({ ...body, revision });
}

/** Plans `folder add`. Reads only. Throws the refusals of spec 05, section 3.3, in the order it lists them. */
export function planFolderAddWith(home: string, cwd: string, name: string, argument: string, hooks: FolderHooks = {}): FolderAddPlan { return buildAdd(home, cwd, name, argument, hooks); }

const leftoverTemps = (names: readonly string[]): string[] => names.filter(n => TEMP.test(n));
const existsGrants = (dir: string): boolean => { try { lstatSync(dir); return true; } catch (error) { if (missing(error)) return false; throw error; } };
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
export async function applyFolderAddWith(home: string, cwd: string, name: string, argument: string, revision: string, signal: AbortSignal, hooks: FolderHooks = {}): Promise<{ name: string; path: string }> {
  if (typeof revision !== 'string' || !HEX64.test(revision)) throw refuse('STALE_APPROVAL');
  return withStoreForWriteWith(home, signal, async (store, held, created) => {
    const plan = buildAdd(home, cwd, name, argument, hooks, { store, created });
    if (plan.revision !== revision) throw refuse('STALE_APPROVAL');
    held.assertHeld(store.dir);
    // Fix 3: the store's .gitignore leaves out folders/ before a record is there. A store this run made already has it.
    ensureStoreGitignore(store.dir, undefined, uidOf(hooks));
    const dir = join(store.dir, FOLDERS_DIR), final = join(dir, name + '.json');
    writing(() => {
      if (plan.folders.identity === null) { mkdirSync(dir, { mode: 0o700 }); chmodOwn(dir); }
    });
    removeLeftovers(dir);
    // The grants of an earlier registration go first, and a new registration id makes the record hash new.
    removeGrantsFolder(grantsPath(store, name), plan.oldGrantsIdentity);
    const temp = join(dir, `.folder-${name}.${randomBytes(8).toString('hex')}.tmp`);
    let exists = false;
    writing(() => {
      let made = false;
      try {
        const fd = openSync(temp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o644); made = true;
        try {
          fchmodSync(fd, 0o644);
          const data = Buffer.from(`{"format":"${FOLDER_FORMAT}","path":${JSON.stringify(plan.path)},"id":"${randomBytes(16).toString('hex')}"}\n`);
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

function buildRemove(home: string, name: string, hooks: FolderHooks, inside?: StoreContext): FolderRemovePlan {
  if (!isFolderName(name)) throw refuse('FOLDER_NAME_INVALID');
  let store: StoreContext;
  if (inside !== undefined) store = inside;
  else {
    const found = inspectStoreWith(home, hooks);
    if (found.state === 'absent') throw refuse('FOLDER_NOT_FOUND');
    if (found.state === 'foreign') throw refuse('STORE_INVALID');
    store = found.context;
  }
  const record = readFolderRecord(store, name, hooks), pins = pinsOf(store), held = grantsEntries(store, name, hooks), grants = held.ids;
  const body = { format: 'bowerloom/folder-remove-plan/v1beta1' as const, name, path: record.path, store: pins, record: { sha256: record.sha256, bytes: record.bytes, device: record.fileIdentity.device, inode: record.fileIdentity.inode }, grants, grantsIdentity: held.identity, writesAuthorized: false as const };
  const revision = digest([body.format, name, record.path, identityKey(pins.identity), pins.file.device, pins.file.inode, pins.file.size, pins.file.ctimeNs, record.sha256, record.bytes, record.fileIdentity.device, record.fileIdentity.inode, grants, held.identity === null ? null : identityKey(held.identity)]);
  return Object.freeze({ ...body, revision });
}

/** Plans `folder remove`. Reads only. FOLDER_NOT_FOUND when the store or the record is absent. */
export function planFolderRemoveWith(home: string, name: string, hooks: FolderHooks = {}): FolderRemovePlan { return buildRemove(home, name, hooks); }

/** Applies a `folder remove` plan under the store lock: plans again, checks the revision, removes the record file only, and flushes the folder. */
export async function applyFolderRemoveWith(home: string, name: string, revision: string, signal: AbortSignal, hooks: FolderHooks = {}): Promise<{ name: string }> {
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
    // The grants go first: a record that came back with the same bytes must not bring old grants with it.
    removeGrantsFolder(grantsPath(store, name), plan.grantsIdentity);
    writing(() => {
      unlinkSync(join(dir, name + '.json')); syncFolder(dir);
    });
    verifyStorePins(store, hooks);
    return { name };
  }, hooks);
}

/** Fix 3 of the beta.3 docs review: the plan line of a .gitignore write, or none. */
function gitignoreLines(state: StoreGitignoreState['state']): string[] {
  if (state === 'ok') return [];
  return [`${state === 'create' ? 'Write ~/.bowerloom/.gitignore' : 'Add lines to ~/.bowerloom/.gitignore'}, so git leaves out folders/ and the other files of this machine.`];
}
/** The plan in plain words, verbatim from spec 05, section 3.3. Control characters are escaped by the command that prints it. */
export function renderFolderAddReview(plan: FolderAddPlan): string {
  return [
    ...(plan.storeCreate ? [STORE_CREATE_LINE] : []),
    `Register folder ${plan.name} in the store at ~/.bowerloom/folders/${plan.name}.json`,
    `  Folder: ~/${plan.path}`,
    `  A slice names it with root: { registered: ${plan.name} }. Bowerloom reads this folder and never writes it.`,
    ...(plan.oldGrants > 0 ? [`  Removes ${plan.oldGrants} old grant${plan.oldGrants === 1 ? '' : 's'} for ${plan.name}.`] : []),
    ...(plan.storeCreate ? [] : gitignoreLines(plan.gitignore)),
    'This writes the store only. It changes no project, and it installs nothing.',
  ].join('\n');
}
export function renderFolderRemoveReview(plan: FolderRemovePlan): string {
  return [
    `Remove folder ${plan.name} from the store: ~/.bowerloom/folders/${plan.name}.json`,
    `  Folder: ~/${plan.path}. The folder stays. Bowerloom never writes it.`,
    ...(plan.grants.length > 0 ? [`  ${plan.grants.length} ${plan.grants.length === 1 ? 'project is' : 'projects are'} allowed to read it. Their grants are removed with it.`] : []),
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
/**
 * The hold of a slice whose root cannot be used. `cause` is set when a system fault, such as a file that cannot be read,
 * made the hold, so a caller can tell a fault from a verdict.
 */
export type RootHold = {
  readonly ok: false;
  readonly code: 'SLICE_ROOT_MISSING' | 'SLICE_ROOT_UNSAFE' | 'FOLDER_NOT_ALLOWED';
  readonly detail: string;
  readonly cause?: string;
  /** For FOLDER_NOT_ALLOWED: the kind of the grant of this project, when it has one for another kind. */
  readonly granted?: string;
  /** For FOLDER_NOT_ALLOWED: true when the grant was made before the kind was recorded. */
  readonly legacy?: boolean;
};

// ------------------------------------------------------------------------------------------------------------------ grants

interface GrantsState { identity: DirectoryIdentity | null; names: string[] }
const grantsPath = (store: StoreContext, name: string): string => join(store.dir, FOLDERS_DIR, name + '.grants');
/** The grants folder of one registered folder: absent, or a real folder that the user owns with no group or world write. */
function grantsState(store: StoreContext, name: string, hooks: { readonly uid?: number }): GrantsState {
  const dir = grantsPath(store, name);
  let stat: BigIntStats;
  try { stat = lstatSync(dir, { bigint: true }); } catch (error) { if (missing(error)) return { identity: null, names: [] }; throw unreadable(error); }
  if (!ownedFolder(stat, uidOf(hooks))) throw refuse('FOLDER_UNSAFE');
  let names: string[];
  try { names = readdirSync(dir); } catch (error) { throw unreadable(error); }
  return { identity: identityFrom(stat), names: names.sort(cmp) };
}
/**
 * Reads `<name>.grants/<projectId>`: the summary kind of a plain file of this user whose record hash is the hash of the record now,
 * and `none` for any other grant. A grant made before the kind was recorded has three keys and no kind. It is `legacy`, so it needs
 * `folder allow` again (decision 5, option B, of issue 86).
 */
function readGrant(store: StoreContext, name: string, projectId: string, birthtimeNs: string, recordSha256: string, hooks: { readonly uid?: number }): Granted {
  const NONE: Granted = { state: 'none' };
  if (grantsState(store, name, hooks).identity === null) return NONE;
  const file = join(grantsPath(store, name), projectId), uid = uidOf(hooks);
  let before: BigIntStats;
  try { before = lstatSync(file, { bigint: true }); } catch (error) { if (missing(error)) return NONE; throw unreadable(error); }
  if (before.isSymbolicLink() || !before.isFile() || before.nlink !== 1n || Number(before.uid) !== uid || (Number(before.mode) & 0o022) !== 0) throw refuse('FOLDER_UNSAFE');
  let fd: number;
  try { fd = openSync(file, constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW); }
  catch (error) { throw errno(error) === 'ELOOP' ? refuse('FOLDER_UNSAFE') : unreadable(error); }
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
    throw unreadable(error);
  } finally { closeSync(fd); }
  const text = bytes.length > RECORD_LIMIT ? null : strictText(bytes);
  if (text === null || text.charCodeAt(0) === 0xfeff) throw refuse('FOLDER_INVALID');
  let value: unknown;
  try { value = strictJson(text, RECORD_LIMIT); } catch { throw refuse('FOLDER_INVALID'); }
  const keys = value !== null && typeof value === 'object' && !Array.isArray(value) ? Object.keys(value) : [];
  const grant = value as { format?: unknown; record?: unknown; birth?: unknown; summary?: unknown };
  const kind = keys.length === 4 && keys.includes('summary');
  if (keys.length !== (kind ? 4 : 3) || !keys.includes('format') || !keys.includes('record') || !keys.includes('birth') || (kind && (typeof grant.summary !== 'string' || !GRANT_SUMMARY.test(grant.summary))) || typeof grant.birth !== 'string' || !BIRTH.test(grant.birth) || grant.format !== GRANT_FORMAT || typeof grant.record !== 'string' || !HEX64.test(grant.record)) throw refuse('FOLDER_INVALID');
  if (grant.record !== recordSha256 || grant.birth !== birthtimeNs) return NONE;
  return kind ? { state: 'kind', kind: grant.summary as string } : { state: 'legacy' };
}

/**
 * The root of a slice in a registered folder (spec 05, section 3.4, steps 2 to 5 and 7). Throws `Gone` when the store,
 * the record, or a folder on the way is absent, and `NotAllowed` when `access` names a project without a grant. Any other
 * fault is a FOLDER_* or STORE_* refusal. With `access` null no grant is asked for: only `folder allow` and `folder list` do that.
 * The grant is asked for before the folder is looked at, so a project that is not allowed reads no file or folder of it. It still sees the
 * name and the recorded path of the folder, through `slice create --registered` and `folder list`, because those read the record only.
 */
function resolveRoot(home: string, store: StoreContext, name: string, path: string, hooks: FolderHooks, access: RootAccess | null): ResolvedRoot {
  const record = readFolderRecord(store, name, hooks), homeDir = realHome(home);
  if (access !== null) {
    if (!PROJECT_ID.test(access.projectId) || !BIRTH.test(access.birthtimeNs)) throw new NotAllowed();
    const granted = readGrant(store, name, access.projectId, access.birthtimeNs, record.sha256, hooks);
    // A slice that asks for another summary kind than the grant records is held until `folder allow` runs again with that kind.
    if (granted.state === 'none') throw new NotAllowed();
    if (granted.state === 'legacy') throw new NotAllowed(undefined, true);
    if (access.summary !== undefined && access.summary !== 'none' && access.summary !== granted.kind) throw new NotAllowed(granted.kind);
  }
  const checks: FolderHooks = access?.stateRoot !== undefined ? { ...hooks, stateRoot: access.stateRoot } : hooks;
  const folderDir = join(homeDir, record.path), dir = path === '.' ? folderDir : join(folderDir, path);
  checkBelowHome(dir, homeDir, checks, () => { throw new Gone(); });
  let identity: DirectoryIdentity;
  try { identity = identityFrom(lstatSync(dir, { bigint: true })); } catch (error) { if (missing(error)) throw new Gone(); throw typeof errno(error) === 'string' ? refuse('FOLDER_UNSAFE') : error; }
  return Object.freeze({ ok: true as const, dir, folderDir, rel: record.path, identity, recordSha256: record.sha256 });
}

/** A hold from a refusal. An error with no code is a fault of Bowerloom, and it passes. A system fault keeps its code as `cause`. */
function holdOf(error: unknown, detail: string): RootHold {
  const code = errno(error);
  if (typeof code !== 'string') throw error;
  const cause = code === 'STORE_UNREADABLE' || code === 'PROJECT_UNREADABLE' || /^E[A-Z0-9]+$/.test(code) ? code : undefined;
  return { ok: false, code: 'SLICE_ROOT_UNSAFE', detail, ...(cause !== undefined ? { cause } : {}) };
}

/**
 * Resolves the root of a slice that names registered folder `name` and a path inside it, for `bowerloom apply` and the
 * guard, for the project in `access`. It returns the hold of the slice when the root cannot be used: FOLDER_NOT_ALLOWED
 * when the project has no grant, SLICE_ROOT_MISSING for a store, a record, or a folder that is not there, and
 * SLICE_ROOT_UNSAFE for any other fault. Reads only.
 */
export function resolveRegisteredRootWith(home: string, name: string, path: string, access: RootAccess, hooks: FolderHooks = {}): ResolvedRoot | RootHold {
  let found;
  try { found = inspectStoreWith(home, hooks); } catch (error) { return holdOf(error, '~/.bowerloom'); }
  if (found.state === 'absent') return { ok: false, code: 'SLICE_ROOT_MISSING', detail: name };
  if (found.state === 'foreign') return { ok: false, code: 'SLICE_ROOT_UNSAFE', detail: '~/.bowerloom' };
  try { return resolveRoot(home, found.context, name, path, hooks, access); }
  catch (error) {
    if (error instanceof NotAllowed) return { ok: false, code: 'FOLDER_NOT_ALLOWED', detail: name, ...(error.granted !== undefined ? { granted: error.granted } : {}), ...(error.legacy === true ? { legacy: true } : {}) };
    if (isGone(error) || errno(error) === 'FOLDER_NOT_FOUND') return { ok: false, code: 'SLICE_ROOT_MISSING', detail: name };
    return holdOf(error, unsafeDetail(found.context, name, path, hooks));
  }
}
/** `resolveRegisteredRootWith` for the registered folder itself. */
export function resolveRegisteredFolderWith(home: string, name: string, access: RootAccess, hooks: FolderHooks = {}): ResolvedRoot | RootHold { return resolveRegisteredRootWith(home, name, '.', access, hooks); }
/** The folder a person should look at: `~/<rel>[/<path>]` when the record reads, else the record file. */
function unsafeDetail(store: StoreContext, name: string, path: string, hooks: FolderHooks): string {
  try { const record = readFolderRecord(store, name, hooks); return `~/${record.path}${path === '.' ? '' : '/' + path}`; } catch { return `~/.bowerloom/${FOLDERS_DIR}/${name}.json`; }
}

// ------------------------------------------------------------------------------------------------------ allow and deny

export interface GrantProject {
  /** The real absolute path of the project folder. */
  readonly dir: string;
  /** The 32 hex characters of the project id. */
  readonly projectId: string;
  /** The birth time of the project folder, in nanoseconds. */
  readonly birthtimeNs: string;
}
export interface FolderAllowPlan {
  readonly format: 'bowerloom/folder-allow-plan/v1beta1';
  readonly name: string;
  readonly project: string;
  readonly projectId: string;
  readonly birthtimeNs: string;
  /** The folder relative to the real home folder. */
  readonly path: string;
  /** The absolute real path of the folder. */
  readonly folderDir: string;
  readonly folder: DirectoryIdentity;
  readonly store: StorePins;
  readonly record: { readonly sha256: string; readonly device: string; readonly inode: string };
  readonly grants: { readonly identity: DirectoryIdentity | null; readonly names: readonly string[] };
  /** The summary kind the grant records: `heading` or `frontmatter:<key>`. Bound. */
  readonly summary: string;
  /** Fix 3 of the beta.3 docs review: what the store's .gitignore needs. Bound. */
  readonly gitignore: StoreGitignoreState['state'];
  readonly writesAuthorized: false;
  readonly revision: string;
}
export interface FolderDenyPlan {
  readonly format: 'bowerloom/folder-deny-plan/v1beta1';
  readonly name: string;
  readonly project: string;
  readonly projectId: string;
  readonly store: StorePins;
  readonly grants: { readonly identity: DirectoryIdentity; readonly names: readonly string[] };
  readonly grant: { readonly device: string; readonly inode: string; readonly size: string };
  readonly writesAuthorized: false;
  readonly revision: string;
}
function checkProject(project: GrantProject): void {
  if (project === null || typeof project !== 'object' || typeof project.dir !== 'string' || !isAbsolute(project.dir) || project.dir.includes('\0') || typeof project.projectId !== 'string' || !PROJECT_ID.test(project.projectId) || typeof project.birthtimeNs !== 'string' || !BIRTH.test(project.birthtimeNs)) throw refuse('USAGE');
}
function existingStore(home: string, hooks: FolderHooks, inside?: StoreContext): StoreContext {
  if (inside !== undefined) return inside;
  const found = inspectStoreWith(home, hooks);
  if (found.state === 'absent') throw refuse('FOLDER_NOT_FOUND');
  if (found.state === 'foreign') throw refuse('STORE_INVALID');
  return found.context;
}
function buildAllow(home: string, project: GrantProject, name: string, hooks: FolderHooks, summary: string, inside?: StoreContext): FolderAllowPlan {
  if (!isFolderName(name)) throw refuse('FOLDER_NAME_INVALID');
  checkProject(project);
  if (typeof summary !== 'string' || !GRANT_SUMMARY.test(summary)) throw new DefinitionError('USAGE', 'Use heading or frontmatter:<key> as the summary kind.');
  const store = existingStore(home, hooks, inside), pins = pinsOf(store), record = readFolderRecord(store, name, hooks);
  let root: ResolvedRoot;
  try { root = resolveRoot(home, store, name, '.', hooks, null); } catch (error) { throw isGone(error) ? refuse('FOLDER_UNSAFE', 'The folder does not exist.') : error; }
  const grants = grantsState(store, name, hooks), ignore = storeGitignoreState(store.dir, uidOf(hooks));
  const body = {
    format: 'bowerloom/folder-allow-plan/v1beta1' as const, name, project: project.dir, projectId: project.projectId, birthtimeNs: project.birthtimeNs, path: record.path, folderDir: root.dir, folder: root.identity, store: pins,
    record: { sha256: record.sha256, device: record.fileIdentity.device, inode: record.fileIdentity.inode }, grants: { identity: grants.identity, names: grants.names }, summary, gitignore: ignore.state, writesAuthorized: false as const,
  };
  const revision = digest([body.format, name, project.dir, project.projectId, project.birthtimeNs, record.path, root.dir, identityKey(root.identity), identityKey(pins.identity), pins.file.device, pins.file.inode, pins.file.size, pins.file.ctimeNs,
    record.sha256, record.fileIdentity.device, record.fileIdentity.inode, grants.identity === null ? null : identityKey(grants.identity), grants.names, summary, ignore.state, ignore.sha256]);
  return Object.freeze({ ...body, revision });
}
/** Plans `folder allow`: this project may read the registered folder, for slices with the summary kind `summary`. Reads only. The plan names the project and the absolute folder. */
export function planFolderAllowWith(home: string, project: GrantProject, name: string, hooks: FolderHooks = {}, summary = 'heading'): FolderAllowPlan { return buildAllow(home, project, name, hooks, summary); }

function writeGrant(store: StoreContext, plan: FolderAllowPlan): void {
  const dir = grantsPath(store, plan.name), folders = join(store.dir, FOLDERS_DIR);
  writing(() => {
    if (plan.grants.identity === null) { mkdirSync(dir, { mode: 0o700 }); chmodOwn(dir); syncFolder(folders); }
    for (const leftover of readdirSync(dir).filter(n => /^\.grant-[a-f0-9]{32}\.[a-f0-9]{16}\.tmp$/.test(n))) { try { unlinkSync(join(dir, leftover)); } catch (error) { if (!missing(error)) throw error; } }
    const temp = join(dir, `.grant-${plan.projectId}.${randomBytes(8).toString('hex')}.tmp`);
    let made = false;
    try {
      const fd = openSync(temp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o644); made = true;
      try {
        fchmodSync(fd, 0o644);
        const data = Buffer.from(`{"format":"${GRANT_FORMAT}","record":"${plan.record.sha256}","birth":"${plan.birthtimeNs}","summary":"${plan.summary}"}\n`);
        let at = 0; while (at < data.length) at += writeSync(fd, data, at);
        fsyncSync(fd);
      } finally { closeSync(fd); }
      renameSync(temp, join(dir, plan.projectId)); made = false;
      syncFolder(dir);
    } finally { if (made) { try { unlinkSync(temp); } catch { /* Already gone. */ } } }
  });
}
/** Applies a `folder allow` plan under the store lock: plans again, checks the revision, and writes the grant. The store is never made here. */
export async function applyFolderAllowWith(home: string, project: GrantProject, name: string, revision: string, signal: AbortSignal, hooks: FolderHooks = {}, summary = 'heading'): Promise<{ name: string }> {
  if (typeof revision !== 'string' || !HEX64.test(revision)) throw refuse('STALE_APPROVAL');
  const found = inspectStoreWith(home, hooks);
  if (found.state !== 'store') throw refuse(found.state === 'foreign' ? 'STORE_INVALID' : 'STALE_APPROVAL');
  return withStoreForWriteWith(home, signal, async (store, held) => {
    let plan: FolderAllowPlan;
    try { plan = buildAllow(home, project, name, hooks, summary, store); } catch (error) { throw errno(error) === 'FOLDER_NOT_FOUND' ? refuse('STALE_APPROVAL') : error; }
    if (plan.revision !== revision) throw refuse('STALE_APPROVAL');
    held.assertHeld(store.dir);
    // Fix 3: the store's .gitignore leaves out folders/ before a grant is there.
    ensureStoreGitignore(store.dir, undefined, uidOf(hooks));
    writeGrant(store, plan);
    verifyStorePins(store, hooks);
    return { name };
  }, hooks);
}

function buildDeny(home: string, project: GrantProject, name: string, hooks: FolderHooks, inside?: StoreContext): FolderDenyPlan {
  if (!isFolderName(name)) throw refuse('FOLDER_NAME_INVALID');
  checkProject(project);
  const store = existingStore(home, hooks, inside), pins = pinsOf(store), grants = grantsState(store, name, hooks);
  const file = join(grantsPath(store, name), project.projectId);
  let stat: BigIntStats;
  try { stat = lstatSync(file, { bigint: true }); } catch (error) { if (missing(error)) throw notAllowed(name); throw unreadable(error); }
  if (stat.isSymbolicLink() || !stat.isFile()) throw refuse('FOLDER_UNSAFE');
  const body = {
    format: 'bowerloom/folder-deny-plan/v1beta1' as const, name, project: project.dir, projectId: project.projectId, store: pins,
    grants: { identity: grants.identity!, names: grants.names }, grant: { device: String(stat.dev), inode: String(stat.ino), size: String(stat.size) }, writesAuthorized: false as const,
  };
  const revision = digest([body.format, name, project.dir, project.projectId, identityKey(pins.identity), pins.file.device, pins.file.inode, pins.file.size, pins.file.ctimeNs, identityKey(grants.identity!), grants.names, body.grant.device, body.grant.inode, body.grant.size]);
  return Object.freeze({ ...body, revision });
}
/** Plans `folder deny`. FOLDER_NOT_ALLOWED when the project has no grant to remove. Reads only. */
export function planFolderDenyWith(home: string, project: GrantProject, name: string, hooks: FolderHooks = {}): FolderDenyPlan { return buildDeny(home, project, name, hooks); }
/** Applies a `folder deny` plan under the store lock: plans again, checks the revision, and removes the grant of this project only. */
export async function applyFolderDenyWith(home: string, project: GrantProject, name: string, revision: string, signal: AbortSignal, hooks: FolderHooks = {}): Promise<{ name: string }> {
  if (typeof revision !== 'string' || !HEX64.test(revision)) throw refuse('STALE_APPROVAL');
  const found = inspectStoreWith(home, hooks);
  if (found.state !== 'store') throw refuse(found.state === 'foreign' ? 'STORE_INVALID' : 'STALE_APPROVAL');
  return withStoreForWriteWith(home, signal, async (store, held) => {
    let plan: FolderDenyPlan;
    try { plan = buildDeny(home, project, name, hooks, store); } catch (error) { throw errno(error) === 'FOLDER_NOT_ALLOWED' ? refuse('STALE_APPROVAL') : error; }
    if (plan.revision !== revision) throw refuse('STALE_APPROVAL');
    held.assertHeld(store.dir);
    const dir = grantsPath(store, name);
    writing(() => { unlinkSync(join(dir, project.projectId)); syncFolder(dir); });
    verifyStorePins(store, hooks);
    return { name };
  }, hooks);
}
/** Rounds 9 and 10 of the reviews of PR 101: the ls step, with the folder when a command can carry it (shellArg). */
const lsStep = (path: string): string => { const word = shellArg(path); return word !== null ? `run ls -led ${word}` : 'run ls -led on that folder'; };
export function renderFolderAllowReview(plan: FolderAllowPlan): string {
  return [
    `Allow this project to read registered folder ${plan.name}`,
    `  Project: ${plan.project}`,
    `  Folder: ${plan.folderDir} (~/${plan.path})`,
    `  Bowerloom reads the mode of the folder only. To see access control entries, ${lsStep(plan.folderDir)}.`,
    '  A slice of this project that names it can copy text from it into .claude/skills. Bowerloom never writes the folder.',
    `  Summary kind: ${plan.summary}. A slice that asks for another kind is held with FOLDER_NOT_ALLOWED until you run folder allow again with that kind.`,
    ...gitignoreLines(plan.gitignore),
    'This writes the store only. It changes no project, and it installs nothing.',
  ].join('\n');
}
export function renderFolderDenyReview(plan: FolderDenyPlan): string {
  return [
    `Stop allowing this project to read registered folder ${plan.name}`,
    `  Project: ${plan.project}`,
    '  Slices of this project that name it are held with FOLDER_NOT_ALLOWED. Installed indexes stay.',
    'This writes the store only. It changes no project.',
  ].join('\n');
}

/** The registered folders of a store, sorted by name, each with its state. Reads only. */
export function listFoldersWith(home: string, hooks: FolderHooks = {}): FolderList {
  const found = inspectStoreWith(home, hooks);
  if (found.state === 'absent') return { store: false, folders: [] };
  if (found.state === 'foreign') throw refuse('STORE_INVALID');
  const state = foldersState(found.context, hooks), out: FolderListing[] = [];
  const coded = (error: unknown): string => { const code = errno(error); if (typeof code !== 'string') throw error; return code; };
  for (const entry of state.names) {
    if (TEMP.test(entry) || entry === IGNORABLE || GRANTS.test(entry)) continue;
    const match = /^(.+)\.json$/.exec(entry);
    if (match === null || !isFolderName(match[1])) { out.push({ name: entry, path: null, state: 'refused', code: 'FOLDER_INVALID' }); continue; }
    const name = match[1];
    let record: FolderRecord;
    try { record = readFolderRecord(found.context, name, hooks); }
    catch (error) { out.push({ name, path: null, state: 'refused', code: coded(error) }); continue; }
    try { resolveRoot(home, found.context, name, '.', hooks, null); out.push({ name, path: `~/${record.path}`, state: 'ready', code: null }); }
    catch (error) {
      if (isGone(error)) out.push({ name, path: `~/${record.path}`, state: 'missing', code: null });
      else out.push({ name, path: `~/${record.path}`, state: 'refused', code: coded(error) });
    }
  }
  return { store: true, folders: out.sort((a, b) => cmp(a.name, b.name)) };
}

/**
 * The recorded path of registered folder `name`, after the folder passed the checks of `folder add`. FOLDER_NOT_FOUND when the
 * store or the record is absent, FOLDER_UNSAFE (`The folder does not exist.`) when the folder is gone, and the other FOLDER_*
 * refusals when it is unsafe. It asks for no grant: it is for `slice create`, which only writes a name.
 */
export function checkRegisteredFolderWith(home: string, name: string, hooks: FolderHooks = {}): string {
  const store = existingStore(home, hooks);
  try { return resolveRoot(home, store, name, '.', hooks, null).rel; }
  catch (error) { throw isGone(error) ? refuse('FOLDER_UNSAFE', 'The folder does not exist.') : error; }
}
export const checkRegisteredFolder = (home: string, name: string, stateRoot?: string): string => checkRegisteredFolderWith(home, name, stateRoot === undefined ? {} : { stateRoot });

// ------------------------------------------------------------------------------------------------ the forms without hooks

export const planFolderAdd = (home: string, cwd: string, name: string, argument: string, stateRoot?: string): FolderAddPlan => planFolderAddWith(home, cwd, name, argument, stateRoot === undefined ? {} : { stateRoot });
export const applyFolderAdd = (home: string, cwd: string, name: string, argument: string, revision: string, signal: AbortSignal, stateRoot?: string): Promise<{ name: string; path: string }> => applyFolderAddWith(home, cwd, name, argument, revision, signal, stateRoot === undefined ? {} : { stateRoot });
export const planFolderRemove = (home: string, name: string): FolderRemovePlan => planFolderRemoveWith(home, name);
export const applyFolderRemove = (home: string, name: string, revision: string, signal: AbortSignal): Promise<{ name: string }> => applyFolderRemoveWith(home, name, revision, signal);
export const listFolders = (home: string): FolderList => listFoldersWith(home);
export const resolveRegisteredFolder = (home: string, name: string, access: RootAccess): ResolvedRoot | RootHold => resolveRegisteredFolderWith(home, name, access);
export const resolveRegisteredRoot = (home: string, name: string, path: string, access: RootAccess): ResolvedRoot | RootHold => resolveRegisteredRootWith(home, name, path, access);
export const planFolderAllow = (home: string, project: GrantProject, name: string, stateRoot?: string, summary = 'heading'): FolderAllowPlan => planFolderAllowWith(home, project, name, stateRoot === undefined ? {} : { stateRoot }, summary);
export const applyFolderAllow = (home: string, project: GrantProject, name: string, revision: string, signal: AbortSignal, stateRoot?: string, summary = 'heading'): Promise<{ name: string }> => applyFolderAllowWith(home, project, name, revision, signal, stateRoot === undefined ? {} : { stateRoot }, summary);
export const planFolderDeny = (home: string, project: GrantProject, name: string): FolderDenyPlan => planFolderDenyWith(home, project, name);
export const applyFolderDeny = (home: string, project: GrantProject, name: string, revision: string, signal: AbortSignal): Promise<{ name: string }> => applyFolderDenyWith(home, project, name, revision, signal);
