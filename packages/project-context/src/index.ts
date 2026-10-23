/**
 * The project layer of the Bowerloom 0.7.0 beta: where a project is, which private folder belongs to it, and the
 * one lock that keeps two writers out of it. Contracts are in ./types.ts.
 *
 * Every refusal here has a fixed code and a fixed message. A message never carries a path, so output stays safe to share.
 */
import { createHash } from 'node:crypto';
import net from 'node:net';
import type { Server } from 'node:net';
import { channel } from 'node:diagnostics_channel';
import { statSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { DefinitionError } from '../../contracts/src/index.js';
import { refuse } from './refusal.js';
/** The project layer's fixed refusal for `code`, for a caller that detects the same fault itself. */
export { refuse as projectRefusal } from './refusal.js';
import { checkProjectPathWith, discoverProjectWith } from './discovery.js';
import { inspectStoreWith, openStoreWith, pathInsideStore as pathInsideStoreWith } from './store.js';
import type { StoreContext, StoreInspection } from './store.js';
import type { HeldProjectLock, ProjectContext } from './types.js';

export type { DirectoryIdentity, HeldProjectLock, OwnedEntryKind, OwnerName, OwnerVerdict, OwnerVerifier, PinnedDirectory, PlannedChange, ProjectContext } from './types.js';
export { ADOPT_MARKER_CHANNEL, adoptCreatedMarker, checkConfigFile, projectId, readConfigBytes, verifyProjectPins } from './discovery.js';
export type { StoreContext, StoreInspection } from './store.js';
export { STORE_CREATE_LINE, assertNotInStore, storeRootOf, verifyStorePins, withStoreForWrite } from './store.js';
export { STORE_GITIGNORE, STORE_GITIGNORE_LINES, ensureStoreGitignore, storeGitignoreState, storeGitignoreStatus, takeStoreGitignoreFailure } from './store-gitignore.js';
export type { StoreGitignoreState, StoreGitignoreStatus } from './store-gitignore.js';
export { FOLDER_FORMAT, GRANT_FORMAT, checkRegisteredFolder, applyFolderAdd, applyFolderAllow, applyFolderDeny, planFolderAllow, planFolderDeny, renderFolderAllowReview, renderFolderDenyReview, applyFolderRemove, isFolderName, listFolders, planFolderAdd, planFolderRemove, readFolderRecord, renderFolderAddReview, renderFolderRemoveReview, resolveRegisteredFolder, resolveRegisteredRoot } from './registered-folders.js';
export type { FolderAddPlan, FolderAllowPlan, FolderDenyPlan, FolderHooks, GrantProject, RootAccess, FolderList, FolderListing, FolderRecord, FolderRemovePlan, ResolvedRoot, RootHold } from './registered-folders.js';

const hex = (value: string): string => createHash('sha256').update(value).digest('hex');

/** The private state folder for all projects: `$XDG_STATE_HOME/bowerloom` when that is absolute, else `~/.local/state/bowerloom`. */
export function privateStateRoot(env: NodeJS.ProcessEnv, home: string): string {
  if (!isAbsolute(home)) throw refuse('USAGE');
  const xdg = env.XDG_STATE_HOME;
  const base = typeof xdg === 'string' && xdg !== '' && isAbsolute(xdg) && !xdg.includes('\0') ? resolve(xdg) : join(home, '.local', 'state');
  return join(base, 'bowerloom');
}

/**
 * Refuses `/`, the home folder (both `home`, which callers take from $HOME, and the home folder from the user
 * database), every path under a home's Library/Mobile Documents or Library/CloudStorage, and the paths under a home's
 * Documents or Desktop when iCloud syncs that folder. Sync is on when the folder's marker inside
 * Library/Mobile Documents/com~apple~CloudDocs is a real folder, or a symlink that resolves to that very folder;
 * a marker that cannot be read refuses. Folders are compared by device and inode, so aliases and symlinks are caught.
 * No attribute is read and no process starts.
 */
export function checkProjectPath(path: string, home: string): void { checkProjectPathWith(path, home); }

/** The store at `<home>/.bowerloom`: `absent`, `foreign`, or `store` with a pinned context. Throws only STORE_* or USAGE. Takes no test hooks. */
export function inspectStore(home: string = homedir()): StoreInspection { return inspectStoreWith(home); }
/** The pinned store. STORE_NOT_FOUND when there is none and STORE_INVALID when the folder is not a store. Takes no test hooks. */
export function openStore(home: string = homedir()): StoreContext { return openStoreWith(home); }
/** True for a path at or below the store of HOME or of the account home. Takes no test hooks. */
export function pathInsideStore(path: string, home: string = homedir()): boolean { return pathInsideStoreWith(path, home); }

/**
 * Finds the project the way git finds `.git`: the nearest parent folder that holds a real, owned, non-symlinked,
 * not group- or world-writable `.bowerloom`, with no case alias. The nearest hit decides; an unsafe or unreadable
 * folder is never skipped. The search stops at a device change, at `/` and at each home folder, and refuses them.
 */
export function discoverProject(cwd: string, home: string = homedir()): ProjectContext { return discoverProjectWith(cwd, home); }

const LOCK_FORMAT = 'bowerloom-project-lock/v1';
/** One project's lock slot: its key, its local port, and the banner its holder sends. */
export interface LockSlot { readonly key: string; readonly port: number; readonly banner: string }
/**
 * The one lock slot of a project folder, shared by `withProjectLock`, `locked` (managed-skills/src/transaction.ts and
 * v2-transaction.ts), the held-lock probe (v2-transaction.ts) and `withLock` (startup/src/revision.ts), so all of them
 * exclude each other. The key is the folder's device and inode, never the path string: two spellings of one folder,
 * such as a case alias on case-insensitive APFS or a symlink, name one inode and so one lock. A path that names no
 * folder has no slot and refuses PROJECT_LOCK_UNAVAILABLE.
 */
export function lockSlot(project: string): LockSlot { return slotOf(LOCK_FORMAT, project); }
function slotOf(format: string, folder: string): LockSlot {
  if (typeof folder !== 'string' || !isAbsolute(folder) || folder.includes('\0')) throw refuse('USAGE');
  let stat; try { stat = statSync(folder, { bigint: true }); } catch { throw refuse('PROJECT_LOCK_UNAVAILABLE'); }
  if (!stat.isDirectory()) throw refuse('PROJECT_LOCK_UNAVAILABLE');
  const key = hex(JSON.stringify([format, stat.dev.toString(), stat.ino.toString()]));
  return Object.freeze({ key, port: 20000 + Number.parseInt(key.slice(0, 8), 16) % 30000, banner: `${format} ${key}\n` });
}
/**
 * True while `project` still names the folder `slot` was keyed on. A lock user calls it after it binds, and a held
 * token on each check: a folder replaced at the same path has another inode, so another slot, and must not pass as
 * locked by the old one.
 */
export function slotStillNames(project: string, slot: LockSlot): boolean {
  try { return lockSlot(project).key === slot.key; } catch { return false; }
}
/** The local port of a project's lock slot. See `lockSlot`. */
export const lockPort = (project: string): number => lockSlot(project).port;

/**
 * Track 11 of beta.3, item 5: how many more binds a writer tries after a holder let go between its refused bind and the
 * banner read. With three or more commands on one project, another command can take the slot and let go again between
 * two binds of this one, so one more bind was not enough. A slot that still refuses every read after these binds is a
 * collision: a holder that lets go does not take the port back each time.
 */
export const LOCK_REBINDS = 3;
/** How long a refused writer waits for the slot holder's banner. Only a writer that could not bind ever waits. */
export const LOCK_BANNER_TIMEOUT_MS = 1000;
/**
 * The listener that holds a slot. It sends the slot's banner (the full project key) to every client, then closes that
 * connection, so a writer that finds the port taken can tell this project's lock from anything else on the port.
 */
export function lockServer(slot: LockSlot): Server {
  return net.createServer(socket => { socket.on('error', () => {}); socket.end(slot.banner, () => socket.destroy()); });
}
/**
 * Who holds a slot this process could not bind. 'this' only when the holder sends exactly this project's banner and
 * closes within the timeout. 'gone' when the connection is refused before any byte: nobody listens any more, so the
 * holder let go. Anything else, including silence or extra bytes, is 'other'.
 * It reads at most one banner length plus one byte and never writes.
 * Track 11 of beta.3, item 5: `silentRetries` probes again after a silent answer. A process that probes its own slot
 * passes 1: its own busy event loop can run the probe's timer before the read, and then the probe is silent.
 */
export async function lockHolder(slot: LockSlot, timeoutMs = LOCK_BANNER_TIMEOUT_MS, silentRetries = 0): Promise<'this' | 'other' | 'gone'> {
  let holder = await probeLockHolder(slot, timeoutMs);
  for (let retry = 0; holder === 'silent' && retry < silentRetries; retry++) holder = await probeLockHolder(slot, timeoutMs);
  return holder === 'silent' || holder === 'reset' ? 'other' : holder;
}
/**
 * Track 11 of beta.3, item 5: a probe timer that fires more than PROBE_LATE_MS after it was due gets PROBE_GRACE_MS more,
 * up to PROBE_GRACES times, so the probe reads what came in while its own event loop was busy. A holder that stays
 * silent while this event loop is free is silent after the timeout, as before.
 */
const PROBE_LATE_MS = 100, PROBE_GRACE_MS = 100, PROBE_GRACES = 10;
/**
 * `lockHolder` with two more verdicts. 'silent' when the connection stays open and sends no byte before the timeout.
 * 'reset' when the connection is reset, or closed, before any byte. A Bowerloom holder whose event loop is busy, such
 * as one unpacking a large archive, answers 'silent', and 'reset' when it exits before it reads the connection. A program
 * that squats the port can answer either way. Only `withCacheLock` waits on them, and only up to a limit.
 * Track 11 of beta.3, item 5: a clean close with no byte is 'reset' too, not 'other'. No Bowerloom lock holder closes
 * without its banner while it holds the slot, so a close with no byte is a holder that let go, or a listener that is
 * not the lock. `slotRefusal` binds again, and that bind decides: a squatter keeps the port and stays a collision.
 */
function probeLockHolder(slot: LockSlot, timeoutMs: number): Promise<'this' | 'other' | 'gone' | 'silent' | 'reset'> {
  return new Promise(resolveHolder => {
    const want = Buffer.from(slot.banner), chunks: Buffer[] = []; let size = 0, done = false, graces = 0, due = performance.now() + timeoutMs;
    const socket = net.connect({ host: '127.0.0.1', port: slot.port });
    const finish = (verdict: 'this' | 'other' | 'gone' | 'silent' | 'reset') => { if (done) return; done = true; clearTimeout(timer); socket.destroy(); resolveHolder(verdict); };
    const settle = () => finish(size === 0 ? 'reset' : Buffer.concat(chunks, size).equals(want) ? 'this' : 'other');
    // Track 11 of beta.3, item 5: after a busy spell, Node runs a due timer before it reads the sockets. A timer that
    // fires late means this process's own event loop was busy, so the banner, or the close after it, may be waiting
    // unread: read it first.
    const expire = (): void => {
      const now = performance.now();
      if (now - due > PROBE_LATE_MS && graces++ < PROBE_GRACES) { due = now + PROBE_GRACE_MS; timer = setTimeout(expire, PROBE_GRACE_MS); return; }
      finish(size === 0 ? 'silent' : 'other');
    };
    let timer = setTimeout(expire, timeoutMs);
    socket.on('data', (chunk: Buffer) => { chunks.push(chunk); size += chunk.length; if (size > want.length) finish('other'); });
    socket.on('end', settle); socket.on('close', settle);
    socket.on('error', (error: NodeJS.ErrnoException) => finish(size !== 0 ? 'other' : error.code === 'ECONNREFUSED' ? 'gone' : error.code === 'ECONNRESET' ? 'reset' : 'other'));
  });
}
/**
 * Published, with the port, each time a writer finds its slot held by something other than its own project's lock.
 * Only tests subscribe: a collision there is a property of the machine, not of the code under test.
 */
export const LOCK_SLOT_COLLISION_CHANNEL = 'bowerloom:lock-slot-collision';
const collisions = channel(LOCK_SLOT_COLLISION_CHANNEL);
/** Records a slot collision on the diagnostics channel and returns the port, for the caller's own refusal. */
export function reportSlotCollision(slot: LockSlot): number {
  if (collisions.hasSubscribers) collisions.publish({ port: slot.port });
  return slot.port;
}
/**
 * After EADDRINUSE: 'locked' when this project's own lock holds the slot, 'collision' for anything else. A collision
 * is reported on the diagnostics channel. Neither verdict lets the caller proceed.
 * With `mayBindAgain`, a holder that let go before the banner read ('gone', or a reset or close before any byte) gives
 * 'free': the caller binds once more, and that bind alone decides. Without it, 'gone' is a collision. A caller passes
 * `attempt < LOCK_REBINDS`, so it binds again at most LOCK_REBINDS times.
 */
export async function slotRefusal(slot: LockSlot, mayBindAgain = false): Promise<'locked' | 'collision' | 'free'> {
  const holder = await probeLockHolder(slot, LOCK_BANNER_TIMEOUT_MS);
  if (holder === 'this') return 'locked';
  // A reset or close before any byte is a holder that let go before it answered, like 'gone'.
  if ((holder === 'gone' || holder === 'reset') && mayBindAgain) return 'free';
  reportSlotCollision(slot); return 'collision';
}
/** PROJECT_LOCK_SLOT_COLLISION. The message names the port, and the error carries it as `port` for the plain-words line. */
function slotCollision(port: number): DefinitionError & { readonly port: number } {
  return Object.assign(new DefinitionError('PROJECT_LOCK_SLOT_COLLISION', `Local port ${port}, which Bowerloom uses to lock this project, is taken and did not answer as this project's lock. Another Bowerloom command may be too busy to answer, or another program holds the port. Wait for other Bowerloom commands to finish, then run the command again.`), { port });
}

// A token is real only when withProjectLock made it. Membership here is the runtime brand: a copy, a spread,
// a clone, a prototype child or a literal with the same fields is not a member.
const tokens = new WeakSet<object>();
/** Runtime brand check for HeldProjectLock. It proves where a token came from, not that the lock is still held: call `assertHeld` for that. */
export function isHeldProjectLock(value: unknown): value is HeldProjectLock {
  return typeof value === 'object' && value !== null && tokens.has(value);
}

function closeServer(server: Server): Promise<void> {
  return new Promise<void>((resolveClose, reject) => {
    const timer = setTimeout(() => reject(refuse('PROJECT_LOCK_UNAVAILABLE')), 1000); timer.unref();
    try { server.close(error => { clearTimeout(timer); if (error && (error as NodeJS.ErrnoException).code !== 'ERR_SERVER_NOT_RUNNING') reject(refuse('PROJECT_LOCK_UNAVAILABLE')); else resolveClose(); }); }
    catch { clearTimeout(timer); reject(refuse('PROJECT_LOCK_UNAVAILABLE')); }
  });
}

/**
 * Holds the project lock while `work` runs. A holder that let go between the refused bind and its banner read gets one
 * more bind, up to LOCK_REBINDS times. The token is valid only inside `work`, and only while its path still names
 * the folder it locked (the token's `key`): a folder replaced at that path ends it. Only EADDRINUSE means the slot is
 * taken: PROJECT_LOCKED when the holder sends this project's banner, PROJECT_LOCK_SLOT_COLLISION (naming the port) for
 * anything else. Any other listen error is PROJECT_LOCK_UNAVAILABLE. A signal that aborts while the lock
 * is pending, or before it, releases the port and refuses with PROJECT_LOCKED.
 */
export async function withProjectLock<T>(root: string, signal: AbortSignal, work: (held: HeldProjectLock) => Promise<T>): Promise<T> {
  if (typeof root !== 'string' || !isAbsolute(root) || root.includes('\0')) throw refuse('USAGE');
  const slot = lockSlot(root);
  const bind = (listener: Server) => new Promise<{ ok: true } | { ok: false; code: string | undefined }>(settle => {
    listener.once('error', error => settle({ ok: false, code: (error as NodeJS.ErrnoException).code }));
    listener.listen({ host: '127.0.0.1', port: slot.port, exclusive: true }, () => settle({ ok: true }));
  });
  let server = lockServer(slot);
  for (let attempt = 0; ; attempt++) {
    const outcome = await bind(server);
    if (outcome.ok) break;
    if (outcome.code !== 'EADDRINUSE') throw refuse('PROJECT_LOCK_UNAVAILABLE');
    // A holder that let go before its banner was read gets one more bind, with a fresh listener, up to LOCK_REBINDS.
    const verdict = await slotRefusal(slot, attempt < LOCK_REBINDS);
    if (verdict === 'free') { server = lockServer(slot); continue; }
    throw verdict === 'locked' ? refuse('PROJECT_LOCKED') : slotCollision(slot.port);
  }
  // The folder may have been replaced between the key and the bind: then this port locks nothing. Release and refuse.
  if (!slotStillNames(root, slot)) { await closeServer(server); throw refuse('PROJECT_LOCK_UNAVAILABLE'); }
  const own = new AbortController(), combined = AbortSignal.any([own.signal, signal]);
  let released = false, failure: unknown, failed = false, result: T | undefined;
  try {
    if (signal.aborted) throw refuse('PROJECT_LOCKED');
    const held = Object.freeze({
      dir: root, key: slot.key, signal: combined,
      assertHeld(dir: string): void { if (released || combined.aborted || dir !== root || !slotStillNames(root, slot)) throw refuse('PROJECT_LOCKED'); },
    }) as unknown as HeldProjectLock;
    tokens.add(held);
    result = await work(held);
  } catch (error) { failed = true; failure = error; }
  released = true; own.abort();
  await closeServer(server);
  if (failed) throw failure;
  return result as T;
}

const CACHE_LOCK_FORMAT = 'bowerloom-cache-lock/v1';
/**
 * The one lock slot of a skills cache folder (Hanna, global skill cache). It is keyed like the project lock, on the
 * folder's device and inode, with its own format, so it never shares a key with a project lock.
 */
export function cacheLockSlot(cacheRoot: string): LockSlot { return slotOf(CACHE_LOCK_FORMAT, cacheRoot); }
/** How often a waiting writer tries the cache lock again. */
export const CACHE_LOCK_POLL_MS = 50;
/**
 * How long a waiting writer accepts a silent cache lock holder before it refuses PROJECT_LOCK_SLOT_COLLISION. A
 * Bowerloom holder goes silent only while its event loop is busy, which is seconds; a program that squats the port
 * stays silent for good.
 */
export const CACHE_LOCK_SILENT_LIMIT_MS = 60_000;
/** Proof that `withCacheLock` holds the lock of one cache folder. Valid only inside its work callback. */
export interface HeldCacheLock { readonly root: string; readonly key: string; assertHeld(): void }
const abortError = (): Error => Object.assign(new Error('The wait for the skills cache lock was stopped.'), { name: 'AbortError', code: 'ABORT_ERR' });
function cacheSlotCollision(port: number): DefinitionError & { readonly port: number } {
  return Object.assign(new DefinitionError('PROJECT_LOCK_SLOT_COLLISION', `Local port ${port}, which Bowerloom uses to lock the skills cache, is taken and did not answer as the cache lock. Another program holds the port, or another Bowerloom command stopped answering. Wait for other Bowerloom commands to finish, then run the command again.`), { port });
}
/**
 * Holds the lock of one skills cache folder while `work` runs. Unlike the project lock, a slot held by this very
 * cache lock is waited for, not refused: one writer fills one pin at a time, and the next one reuses it. The wait
 * polls the port and ends when `signal` aborts (an AbortError) or when `waitMs` runs out (PROJECT_LOCK_UNAVAILABLE).
 * A holder that stays silent, or resets the connection before any byte, is waited for too, because a Bowerloom holder
 * in another process cannot answer while its event loop is busy, and resets when it exits first. Past `silentMs`
 * (CACHE_LOCK_SILENT_LIMIT_MS) of nothing else, it counts as another program.
 * A slot held by anything else refuses PROJECT_LOCK_SLOT_COLLISION, naming the port. Readers take no lock.
 */
/** Round 3 of the reviews of PR 99, L-e: the cache lock refuses in its own words, not the project lock's. */
const cacheLockRefusal = (lost = false): DefinitionError => new DefinitionError('PROJECT_LOCK_UNAVAILABLE', lost ? 'Bowerloom lost the skills cache lock. Try again.' : 'Bowerloom could not take the skills cache lock. Try again.');
export async function withCacheLock<T>(cacheRoot: string, signal: AbortSignal, work: (held: HeldCacheLock) => Promise<T>, options: { waitMs?: number; silentMs?: number } = {}): Promise<T> {
  let first: LockSlot; try { first = cacheLockSlot(cacheRoot); } catch (error) { if ((error as { code?: unknown }).code === 'PROJECT_LOCK_UNAVAILABLE') throw cacheLockRefusal(); throw error; }
  const slot = first, deadline = options.waitMs === undefined ? Infinity : Date.now() + options.waitMs;
  const silentLimit = options.silentMs ?? CACHE_LOCK_SILENT_LIMIT_MS;
  let silentSince: number | undefined;
  const bind = (listener: Server) => new Promise<{ ok: true } | { ok: false; code: string | undefined }>(settle => {
    listener.once('error', error => settle({ ok: false, code: (error as NodeJS.ErrnoException).code }));
    listener.listen({ host: '127.0.0.1', port: slot.port, exclusive: true }, () => settle({ ok: true }));
  });
  const pause = () => new Promise<void>(done => { const timer = setTimeout(() => { signal.removeEventListener('abort', stop); done(); }, CACHE_LOCK_POLL_MS); const stop = () => { clearTimeout(timer); done(); }; signal.addEventListener('abort', stop, { once: true }); });
  let server: Server;
  for (;;) {
    if (signal.aborted) throw abortError();
    server = lockServer(slot);
    const outcome = await bind(server);
    if (outcome.ok) break;
    if (outcome.code !== 'EADDRINUSE') throw cacheLockRefusal();
    const holder = await probeLockHolder(slot, LOCK_BANNER_TIMEOUT_MS);
    if (holder === 'silent' || holder === 'reset') silentSince ??= Date.now(); else silentSince = undefined;
    if (holder === 'other' || (silentSince !== undefined && Date.now() - silentSince >= silentLimit)) { reportSlotCollision(slot); throw cacheSlotCollision(slot.port); }
    if (Date.now() >= deadline) throw new DefinitionError('PROJECT_LOCK_UNAVAILABLE', 'Another Bowerloom command held the skills cache lock for too long. Try again.');
    if (holder === 'this') await pause();
  }
  const stillNames = (): boolean => { try { return cacheLockSlot(cacheRoot).key === slot.key; } catch { return false; } };
  if (!stillNames() || signal.aborted) { await closeServer(server); throw signal.aborted ? abortError() : cacheLockRefusal(); }
  let released = false, failure: unknown, failed = false, result: T | undefined;
  try {
    const held: HeldCacheLock = Object.freeze({ root: cacheRoot, key: slot.key, assertHeld(): void { if (released || !stillNames()) throw cacheLockRefusal(true); } });
    result = await work(held);
  } catch (error) { failed = true; failure = error; }
  released = true;
  await closeServer(server);
  if (failed) throw failure;
  return result as T;
}
