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
import { checkProjectPathWith, discoverProjectWith } from './discovery.js';
import type { HeldProjectLock, ProjectContext } from './types.js';

export type { DirectoryIdentity, HeldProjectLock, OwnedEntryKind, OwnerName, OwnerVerdict, OwnerVerifier, PinnedDirectory, PlannedChange, ProjectContext } from './types.js';
export { projectId, verifyProjectPins } from './discovery.js';

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
export function lockSlot(project: string): LockSlot {
  if (typeof project !== 'string' || !isAbsolute(project) || project.includes('\0')) throw refuse('USAGE');
  let stat; try { stat = statSync(project, { bigint: true }); } catch { throw refuse('PROJECT_LOCK_UNAVAILABLE'); }
  if (!stat.isDirectory()) throw refuse('PROJECT_LOCK_UNAVAILABLE');
  const key = hex(JSON.stringify([LOCK_FORMAT, stat.dev.toString(), stat.ino.toString()]));
  return Object.freeze({ key, port: 20000 + Number.parseInt(key.slice(0, 8), 16) % 30000, banner: `${LOCK_FORMAT} ${key}\n` });
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
 * closes within the timeout; anything else, including silence, a refused connection or extra bytes, is 'other'.
 * It reads at most one banner length plus one byte and never writes.
 */
export function lockHolder(slot: LockSlot, timeoutMs = LOCK_BANNER_TIMEOUT_MS): Promise<'this' | 'other'> {
  return new Promise(resolveHolder => {
    const want = Buffer.from(slot.banner), chunks: Buffer[] = []; let size = 0, done = false;
    const socket = net.connect({ host: '127.0.0.1', port: slot.port });
    const finish = (verdict: 'this' | 'other') => { if (done) return; done = true; clearTimeout(timer); socket.destroy(); resolveHolder(verdict); };
    const settle = () => finish(Buffer.concat(chunks, size).equals(want) ? 'this' : 'other');
    const timer = setTimeout(() => finish('other'), timeoutMs);
    socket.on('data', (chunk: Buffer) => { chunks.push(chunk); size += chunk.length; if (size > want.length) finish('other'); });
    socket.on('end', settle); socket.on('close', settle); socket.on('error', () => finish('other'));
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
 * is reported on the diagnostics channel. The lock stays exclusive: neither verdict lets the caller proceed.
 */
export async function slotRefusal(slot: LockSlot): Promise<'locked' | 'collision'> {
  if (await lockHolder(slot) === 'this') return 'locked';
  reportSlotCollision(slot); return 'collision';
}
/** PROJECT_LOCK_SLOT_COLLISION. The message names the port, and the error carries it as `port` for the plain-words line. */
function slotCollision(port: number): DefinitionError & { readonly port: number } {
  return Object.assign(new DefinitionError('PROJECT_LOCK_SLOT_COLLISION', `Another program holds local port ${port}, which Bowerloom uses to lock this project. Stop that program, then run the command again.`), { port });
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
 * Holds the project lock while `work` runs. The token is valid only inside `work`, and only while its path still names
 * the folder it locked (the token's `key`): a folder replaced at that path ends it. Only EADDRINUSE means the slot is
 * taken: PROJECT_LOCKED when the holder sends this project's banner, PROJECT_LOCK_SLOT_COLLISION (naming the port) for
 * anything else. Any other listen error is PROJECT_LOCK_UNAVAILABLE. A signal that aborts while the lock
 * is pending, or before it, releases the port and refuses with PROJECT_LOCKED.
 */
export async function withProjectLock<T>(root: string, signal: AbortSignal, work: (held: HeldProjectLock) => Promise<T>): Promise<T> {
  if (typeof root !== 'string' || !isAbsolute(root) || root.includes('\0')) throw refuse('USAGE');
  const slot = lockSlot(root), server = lockServer(slot);
  const outcome = await new Promise<{ ok: true } | { ok: false; code: string | undefined }>(settle => {
    server.once('error', error => settle({ ok: false, code: (error as NodeJS.ErrnoException).code }));
    server.listen({ host: '127.0.0.1', port: slot.port, exclusive: true }, () => settle({ ok: true }));
  });
  if (!outcome.ok) {
    if (outcome.code !== 'EADDRINUSE') throw refuse('PROJECT_LOCK_UNAVAILABLE');
    throw await slotRefusal(slot) === 'locked' ? refuse('PROJECT_LOCKED') : slotCollision(slot.port);
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
