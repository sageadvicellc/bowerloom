/**
 * The project layer of the Bowerloom 0.7.0 beta: where a project is, which private folder belongs to it, and the
 * one lock that keeps two writers out of it. Contracts are in ./types.ts.
 *
 * Every refusal here has a fixed code and a fixed message. A message never carries a path, so output stays safe to share.
 */
import { createHash } from 'node:crypto';
import { createServer } from 'node:net';
import type { Server } from 'node:net';
import { lstatSync, readdirSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { DefinitionError } from '../../contracts/src/index.js';
import type { DirectoryIdentity, HeldProjectLock, PinnedDirectory, ProjectContext } from './types.js';

export type { DirectoryIdentity, HeldProjectLock, OwnedEntryKind, OwnerName, OwnerVerdict, OwnerVerifier, PinnedDirectory, PlannedChange, ProjectContext } from './types.js';

const MESSAGES: Readonly<Record<string, string>> = {
  USAGE: 'Use an absolute path.',
  PROJECT_NOT_FOUND: 'No Bowerloom project holds this folder. Run the command inside a project folder that has a .bowerloom folder.',
  PROJECT_ROOT_REFUSED: 'Bowerloom does not use the home folder or the root of the disk as a project.',
  PROJECT_IN_CLOUD_FOLDER: 'This folder syncs to a cloud service. Keep the project in a local folder, such as ~/Projects.',
  PROJECT_UNSAFE: 'The .bowerloom folder is not safe to use. It must be a real folder that you own, with no write access for others.',
  PROJECT_LOCKED: 'Another Bowerloom command is changing this project. Wait for it to finish, then run the command again.',
  PROJECT_LOCK_UNAVAILABLE: 'Bowerloom could not take the project lock. Try again.',
};
const refuse = (code: keyof typeof MESSAGES & string): DefinitionError => new DefinitionError(code, MESSAGES[code]!);
const fold = (value: string): string => value.normalize('NFC').toLowerCase();
const hex = (value: string): string => createHash('sha256').update(value).digest('hex');

function identityOf(path: string): DirectoryIdentity {
  const stat = lstatSync(path, { bigint: true });
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw refuse('PROJECT_UNSAFE');
  return { device: stat.dev.toString(), inode: stat.ino.toString(), birthtimeNs: stat.birthtimeNs.toString(), uid: Number(stat.uid), mode: Number(stat.mode) & 0o777 };
}
function realFolder(path: string): boolean {
  try { const stat = lstatSync(path); return stat.isDirectory() && !stat.isSymbolicLink(); } catch { return false; }
}
function real(path: string): string | null { try { return realpathSync(path); } catch { return null; } }

/** The first 32 hex characters of sha256 over the real path, device and inode. */
export function projectId(root: string, identity: DirectoryIdentity): string {
  return hex(JSON.stringify([root, identity.device, identity.inode])).slice(0, 32);
}

/** The private state folder for all projects: `$XDG_STATE_HOME/bowerloom` when that is absolute, else `~/.local/state/bowerloom`. */
export function privateStateRoot(env: NodeJS.ProcessEnv, home: string): string {
  if (!isAbsolute(home)) throw refuse('USAGE');
  const xdg = env.XDG_STATE_HOME;
  const base = typeof xdg === 'string' && xdg !== '' && isAbsolute(xdg) && !xdg.includes('\0') ? resolve(xdg) : join(home, '.local', 'state');
  return join(base, 'bowerloom');
}

/**
 * Refuses `/`, HOME, every path under HOME/Library/Mobile Documents or HOME/Library/CloudStorage, and the paths under
 * ~/Documents or ~/Desktop when iCloud syncs that folder. Sync is on when the matching folder exists as a real
 * (not symlinked) folder inside HOME/Library/Mobile Documents/com~apple~CloudDocs. No attribute is read and no process starts.
 */
export function checkProjectPath(path: string, home: string): void {
  if (typeof path !== 'string' || typeof home !== 'string' || !isAbsolute(path) || !isAbsolute(home) || path.includes('\0') || home.includes('\0')) throw refuse('USAGE');
  const target = fold(resolve(path)), base = fold(resolve(home));
  if (target === sep || target === base) throw refuse('PROJECT_ROOT_REFUSED');
  if (!target.startsWith(base + sep)) return;
  const [first, second] = target.slice(base.length + 1).split(sep);
  if (first === 'library' && (second === 'mobile documents' || second === 'cloudstorage')) throw refuse('PROJECT_IN_CLOUD_FOLDER');
  if (first === 'documents' || first === 'desktop') {
    const marker = join(resolve(home), 'Library', 'Mobile Documents', 'com~apple~CloudDocs', first === 'documents' ? 'Documents' : 'Desktop');
    if (realFolder(marker)) throw refuse('PROJECT_IN_CLOUD_FOLDER');
  }
}

export interface DiscoverOptions {
  /** The owner a `.bowerloom` folder must have. Defaults to the current user. */
  readonly uid?: number;
  /** The device of a folder. Defaults to the device from lstat. */
  readonly deviceOf?: (directory: string) => string;
}

/**
 * Finds the project the way git finds `.git`: the nearest parent folder that holds a real, owned, non-symlinked,
 * not group- or world-writable `.bowerloom`, with no case alias. The nearest hit decides; an unsafe one is never skipped.
 * The search stops at HOME and at a device change, and refuses `/` and HOME.
 */
export function discoverProject(cwd: string, home: string = homedir(), options: DiscoverOptions = {}): ProjectContext {
  if (typeof cwd !== 'string' || typeof home !== 'string' || !isAbsolute(cwd) || !isAbsolute(home) || cwd.includes('\0') || home.includes('\0')) throw refuse('USAGE');
  const realHome = real(home) ?? resolve(home), start = real(cwd);
  if (start === null) throw refuse('PROJECT_NOT_FOUND');
  checkProjectPath(start, realHome);
  const uid = options.uid ?? process.getuid?.() ?? -1;
  const deviceOf = options.deviceOf ?? ((directory: string) => lstatSync(directory, { bigint: true }).dev.toString());
  const startDevice = deviceOf(start);
  for (let current = start; ;) {
    if (deviceOf(current) !== startDevice) throw refuse('PROJECT_NOT_FOUND');
    let aliases: string[] = [];
    try { aliases = readdirSync(current).filter(name => fold(name) === '.bowerloom'); } catch { /* An unreadable folder cannot hold a usable project. */ }
    if (current === sep || current === realHome) throw refuse(aliases.length ? 'PROJECT_ROOT_REFUSED' : 'PROJECT_NOT_FOUND');
    if (aliases.length) return build(current, aliases, uid, realHome);
    const parent = dirname(current);
    if (parent === current) throw refuse('PROJECT_NOT_FOUND');
    current = parent;
  }
}

function build(dir: string, aliases: string[], uid: number, home: string): ProjectContext {
  checkProjectPath(dir, home);
  if (aliases.length !== 1 || aliases[0] !== '.bowerloom') throw refuse('PROJECT_UNSAFE');
  const bowerloom = join(dir, '.bowerloom');
  let stat; try { stat = lstatSync(bowerloom, { bigint: true }); } catch { throw refuse('PROJECT_UNSAFE'); }
  if (stat.isSymbolicLink() || !stat.isDirectory() || Number(stat.uid) !== uid || (Number(stat.mode) & 0o022) !== 0) throw refuse('PROJECT_UNSAFE');
  const identity = identityOf(dir), bowerloomIdentity = identityOf(bowerloom);
  const parts = dirname(dir).split(sep).filter(Boolean), ancestry: PinnedDirectory[] = [{ path: sep, identity: identityOf(sep) }];
  for (let i = 0; i < parts.length; i++) { const path = sep + parts.slice(0, i + 1).join(sep); ancestry.push({ path, identity: identityOf(path) }); }
  return Object.freeze({ dir, identity, ancestry: Object.freeze(ancestry), bowerloomIdentity, projectId: projectId(dir, identity) });
}

/**
 * The port formula of `locked` (managed-skills/src/transaction.ts) and `withLock` (startup/src/revision.ts):
 * the same project path gives the same local port, so all three exclude each other.
 */
export const lockPort = (project: string): number => 20000 + Number.parseInt(hex(project).slice(0, 8), 16) % 30000;

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
 * Holds the project lock while `work` runs. The token is valid only inside `work`. Only EADDRINUSE means the lock is held
 * by someone else (PROJECT_LOCKED); any other listen error is PROJECT_LOCK_UNAVAILABLE. A signal that aborts while the lock
 * is pending, or before it, releases the port and refuses with PROJECT_LOCKED.
 */
export async function withProjectLock<T>(root: string, signal: AbortSignal, work: (held: HeldProjectLock) => Promise<T>): Promise<T> {
  if (typeof root !== 'string' || !isAbsolute(root) || root.includes('\0')) throw refuse('USAGE');
  const server = createServer(socket => socket.destroy());
  const outcome = await new Promise<{ ok: true } | { ok: false; code: string | undefined }>(settle => {
    server.once('error', error => settle({ ok: false, code: (error as NodeJS.ErrnoException).code }));
    server.listen({ host: '127.0.0.1', port: lockPort(root), exclusive: true }, () => settle({ ok: true }));
  });
  if (!outcome.ok) throw refuse(outcome.code === 'EADDRINUSE' ? 'PROJECT_LOCKED' : 'PROJECT_LOCK_UNAVAILABLE');
  const own = new AbortController(), combined = AbortSignal.any([own.signal, signal]);
  let released = false, failure: unknown, failed = false, result: T | undefined;
  try {
    if (signal.aborted) throw refuse('PROJECT_LOCKED');
    const held = Object.freeze({
      dir: root, signal: combined,
      assertHeld(dir: string): void { if (released || combined.aborted || dir !== root) throw refuse('PROJECT_LOCKED'); },
    }) as unknown as HeldProjectLock;
    tokens.add(held);
    result = await work(held);
  } catch (error) { failed = true; failure = error; }
  released = true; own.abort();
  await closeServer(server);
  if (failed) throw failure;
  return result as T;
}
