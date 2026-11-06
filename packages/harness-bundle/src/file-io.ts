/**
 * The bounded reading and writing of a bundle file. The README states the rules; the contract is in the comments of `index.ts`. In short:
 *  - a read opens with `O_NOFOLLOW | O_NONBLOCK | O_NOCTTY`, asks the DESCRIPTOR what it is (a folder also opens read-only), refuses anything but a regular file of the user,
 *    reads at most one byte past the size from `fstat`, and checks the file again after the read, by descriptor and by path;
 *  - a write resolves the parent folder once, writes a dot-prefixed `.part` file at mode 0600 in that folder (the whole content, in as many write calls as the system needs),
 *    and puts it in place with `link` (so a file made in between is never replaced), or, where hard links do not exist, by creating the target itself with `O_EXCL`;
 *  - a replace compares the identity of the target right before the rename.
 * Errors are mapped by the code of the system error (`failure`): a link, a folder, a device, a changed file or a bad name is `BUNDLE_FILE_UNSAFE`; a full disk, a missing
 * permission, a read-only disk and the like are `BUNDLE_FILE_FAILED`, with a plain-words reason; an error with no system code is a defect: it is logged (its class name, as a
 * process warning) and also becomes a `BUNDLE_FILE_FAILED` with the class name as `cause`, so no stray error type and no path text reaches the caller. The text of an error,
 * which may name a path, is never passed on: only its code or class name is kept, as `cause`.
 * The package deletes nothing but the temporary `.part` file of the call that made it (and, in the no-link path, the target it created itself, by identity).
 * The functions take plain input (a path string, bytes) and return plain output, import nothing of Electron, and are safe to call from a worker thread.
 */
import { randomBytes } from 'node:crypto';
import fs, { constants } from 'node:fs';
import path from 'node:path';
import { BundleRefusal, PARTIAL_LEFT, causeOf } from './codes.js';
import { BUNDLE_LIMITS } from './limits.js';
import type { BundleFileIdentity } from './types.js';

/**
 * Seams for the tests, and nothing else. Production code never sets one. A test sets a function here to change the world at an exact point (swap a file, grow it, make
 * `link` fail) and clears it after. They are set only through `setFileIoHook`, which throws unless `NODE_ENV` is `test`, and this module does not export the table.
 */
export interface FileIoHooks {
  /** In a read: after `fstat` of the descriptor, before the first byte is read. */
  afterStat?: (absPath: string) => void | Promise<void>;
  /** In a read: after the last byte is read, before the final checks. */
  afterRead?: (absPath: string) => void | Promise<void>;
  /** In a write: after the temporary file is complete, before it is put in place (and before the identity is read again on a replace). */
  afterTemp?: (absPath: string) => void | Promise<void>;
  /** In a write: the call that makes the hard link. Throw an error with a `code` to simulate a volume without hard links. */
  link?: (temporary: string, target: string) => void | Promise<void>;
  /** In the no-link write: after the target is created, before the bytes are written. */
  afterTargetCreated?: (absPath: string) => void | Promise<void>;
  /** In the no-link write: after the bytes are written, before the descriptor is closed. */
  afterWrite?: (absPath: string) => void | Promise<void>;
  /** In every write call: the number of bytes the system takes this time (to simulate a short write). Return a number from 1 up to `wanted`. */
  writeLimit?: (wanted: number) => number;
  /** In the removal of a file: throw an error with a `code` to simulate a failed `unlink`. */
  unlink?: (file: string) => void | Promise<void>;
}
const hooks: FileIoHooks = {};
export function setFileIoHook<K extends keyof FileIoHooks>(name: K, fn: FileIoHooks[K] | undefined): void {
  if (process.env.NODE_ENV !== 'test') throw new Error('The file seams are for tests only.');
  if (fn === undefined) delete hooks[name]; else hooks[name] = fn;
}
export function clearFileIoHooks(): void {
  if (process.env.NODE_ENV !== 'test') throw new Error('The file seams are for tests only.');
  for (const k of Object.keys(hooks)) delete hooks[k as keyof FileIoHooks];
}

// ---- errors -------------------------------------------------------------------------------------------------------------------

/** The system error code of an error (`ENOSPC`), or undefined: an error with no code is not a system error. */
const codeOf = (error: unknown): string | undefined => {
  const code = (error as NodeJS.ErrnoException | null | undefined)?.code;
  return typeof code === 'string' && /^E[A-Z0-9]{2,20}$/.test(code) ? code : undefined;
};
/** System errors that mean "this is not the plain file you think": a link, a folder where a file goes, a file where a folder goes, a device. */
const UNSAFE_CODES = new Set(['ELOOP', 'ENOTDIR', 'EISDIR', 'ENXIO', 'ENODEV']);

const unsafe = (cause?: string): never => { throw new BundleRefusal('BUNDLE_FILE_UNSAFE', [], [], cause); };
const usage = (): never => { throw new BundleRefusal('BUNDLE_USAGE'); };

/**
 * Turns an error of a file call into a refusal. A refusal passes on. A system error is `BUNDLE_FILE_UNSAFE` for a link, a folder or a device, else `BUNDLE_FILE_FAILED`.
 * An error with no system code is a defect, not a file fault: it is logged as a process warning (the class name only) and becomes `BUNDLE_FILE_FAILED` with the class name as
 * `cause`. Its message, which may hold a path, is dropped.
 */
function failure(error: unknown): never {
  if (error instanceof BundleRefusal) throw error;
  const code = codeOf(error);
  if (code === undefined) {
    const kind = causeOf(error);
    process.emitWarning(`harness-bundle: a file call failed with a defect (${kind}).`, { type: 'BundleDefectWarning' });
    throw new BundleRefusal('BUNDLE_FILE_FAILED', [], [], kind);
  }
  throw new BundleRefusal(UNSAFE_CODES.has(code) ? 'BUNDLE_FILE_UNSAFE' : 'BUNDLE_FILE_FAILED', [], [], code);
}

/** A cleanup that failed: the code only, to the process warnings (a log), never the path. */
function warnCleanup(what: string, error: unknown): void {
  process.emitWarning(`harness-bundle: ${what} failed (${codeOf(error) ?? 'no system code'}).`, { type: 'BundleCleanupWarning' });
}

/** Removes a file we made: three tries, 0 ms, 20 ms and 100 ms apart. A file that is already gone is done. Returns true when it is gone. */
async function removeFile(file: string): Promise<boolean> {
  for (const wait of [0, 20, 100]) {
    if (wait > 0) await new Promise<void>(resolve => setTimeout(resolve, wait));
    try {
      await hooks.unlink?.(file);
      await fs.promises.unlink(file);
      return true;
    } catch (error) {
      if (codeOf(error) === 'ENOENT') return true;
      if (wait === 100) warnCleanup('removing a file of ours', error);
    }
  }
  return false;
}

// ---- shared -------------------------------------------------------------------------------------------------------------------

/** The chunk of one read call. Each call is a turn of the event loop. */
const CHUNK = 4 * 1024 * 1024;
/** The errors of `link` that mean "this volume has no hard links". */
const NO_LINK = new Set(['EPERM', 'ENOTSUP', 'EOPNOTSUPP', 'ENOSYS', 'EXDEV', 'EMLINK']);
const NOCTTY = constants.O_NOCTTY ?? 0;

const absolute = (absPath: unknown): string => {
  if (typeof absPath !== 'string' || absPath.length === 0 || absPath.includes('\0') || !path.isAbsolute(absPath)) return usage();
  return absPath;
};

const identityOf = (st: fs.BigIntStats): BundleFileIdentity => ({ dev: st.dev, ino: st.ino, size: st.size, mtimeNs: st.mtimeNs, birthtimeNs: st.birthtimeNs ?? 0n });
const same = (a: BundleFileIdentity, b: BundleFileIdentity): boolean =>
  a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeNs === b.mtimeNs && a.birthtimeNs === b.birthtimeNs;
const isIdentity = (v: unknown): v is BundleFileIdentity => {
  if (v === null || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return ['dev', 'ino', 'size', 'mtimeNs', 'birthtimeNs'].every(k => typeof o[k] === 'bigint') && Object.keys(o).length === 5;
};

// ---- read ---------------------------------------------------------------------------------------------------------------------

export async function readBundleFile(absPath: string): Promise<Uint8Array> {
  const file = absolute(absPath);
  let fh: fs.promises.FileHandle;
  try {
    fh = await fs.promises.open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK | NOCTTY);
  } catch (error) { return failure(error); }
  try {
    const first = await fh.stat({ bigint: true });
    if (!first.isFile()) return unsafe();
    if (typeof process.getuid === 'function' && first.uid !== BigInt(process.getuid())) return unsafe();
    if (first.size > BigInt(BUNDLE_LIMITS.fileBytes)) throw new BundleRefusal('BUNDLE_TOO_LARGE');
    await hooks.afterStat?.(file);
    const size = Number(first.size);
    const buffer = Buffer.allocUnsafe(size + 1);
    let have = 0;
    while (have < size + 1) {
      const { bytesRead } = await fh.read(buffer, have, Math.min(CHUNK, size + 1 - have), have);
      if (bytesRead === 0) break;
      have += bytesRead;
    }
    // A short read, or a byte past the size: the file changed under us.
    if (have !== size) return unsafe();
    await hooks.afterRead?.(file);
    const last = await fh.stat({ bigint: true });
    if (!last.isFile() || !same(identityOf(first), identityOf(last))) return unsafe();
    // The path must still name this file: a swap during the read shows here.
    const named = await fs.promises.lstat(file, { bigint: true });
    if (!named.isFile() || named.dev !== first.dev || named.ino !== first.ino) return unsafe();
    return buffer.subarray(0, size);
  } catch (error) {
    return failure(error);
  } finally {
    await fh.close().catch((error: unknown) => warnCleanup('closing the bundle file', error));
  }
}

// ---- identity -------------------------------------------------------------------------------------------------------------------

export async function bundleTargetIdentity(absPath: string): Promise<BundleFileIdentity | null> {
  const file = absolute(absPath);
  let st: fs.BigIntStats;
  try { st = await fs.promises.lstat(file, { bigint: true }); } catch (error) {
    if (codeOf(error) === 'ENOENT') return null;
    return failure(error);
  }
  if (!st.isFile()) return unsafe(); // a link (even a dangling one), a folder, or another kind of file
  return identityOf(st);
}

// ---- write --------------------------------------------------------------------------------------------------------------------

/** The name of a temporary file: a dot first (a sync folder skips it), `.part` last, and 96 random bits between. */
const temporaryName = (): string => `.bowerloom-${randomBytes(12).toString('hex')}.part`;

export async function writeBundleFile(absPath: string, bytes: Uint8Array, options?: { readonly replace?: BundleFileIdentity }): Promise<void> {
  const file = absolute(absPath);
  if (!(bytes instanceof Uint8Array)) return usage();
  if (options !== undefined && (options === null || typeof options !== 'object' || Object.keys(options).some(k => k !== 'replace'))) return usage();
  const replace = options?.replace;
  if (replace !== undefined && !isIdentity(replace)) return usage();
  if (bytes.length > BUNDLE_LIMITS.fileBytes) throw new BundleRefusal('BUNDLE_TOO_LARGE');
  const name = path.basename(file);
  if (name === '' || name === '.' || name === '..' || file !== path.join(path.dirname(file), name)) return unsafe();

  // The parent folder is resolved once. If it is not the folder given, a link lies on the way.
  const given = path.dirname(file);
  let parent: string;
  try { parent = await fs.promises.realpath(given); } catch (error) { return failure(error); }
  if (parent !== given) return unsafe();
  const target = path.join(parent, name);
  const temporary = path.join(parent, temporaryName());

  // The target as it is now: a link, a folder or another kind of file is refused here; a file is refused unless the person agreed to replace exactly that file.
  const present = await lstatOrNull(target);
  if (present !== null && !present.isFile()) return unsafe();
  if (replace === undefined && present !== null) throw new BundleRefusal('BUNDLE_EXISTS');
  if (replace !== undefined && (present === null || !same(identityOf(present), replace))) return unsafe();

  let made = false;
  try {
    await createTemporary(temporary, bytes);
    made = true;
    await hooks.afterTemp?.(file);
    if (replace === undefined) {
      await putInPlace(temporary, target, bytes);
      made = false; // `putInPlace` has removed the temporary name, or has warned that it could not
    } else {
      // Right before the rename: the file there must still be the one the person agreed to replace.
      const now = await lstatOrNull(target);
      if (now === null || !now.isFile() || !same(identityOf(now), replace)) return unsafe();
      await fs.promises.rename(temporary, target);
      made = false;
    }
  } catch (error) {
    return failure(error);
  } finally {
    if (made) await removeFile(temporary);
  }
}

async function lstatOrNull(p: string): Promise<fs.BigIntStats | null> {
  try { return await fs.promises.lstat(p, { bigint: true }); } catch (error) {
    if (codeOf(error) === 'ENOENT') return null;
    return failure(error);
  }
}

/** Creates the temporary file (new, not through a link, mode 0600 from creation), writes all the bytes, and syncs. It removes the file on any failure. */
async function createTemporary(temporary: string, bytes: Uint8Array): Promise<void> {
  let fh: fs.promises.FileHandle | undefined;
  try {
    fh = await fs.promises.open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW | NOCTTY, 0o600);
    await writeAll(fh, bytes);
    await fh.sync();
    await fh.close();
    fh = undefined;
  } catch (error) {
    if (fh !== undefined) await fh.close().catch((e: unknown) => warnCleanup('closing a temporary file', e));
    await removeFile(temporary);
    throw error;
  }
}

/** Writes all the bytes, in as many calls as the system needs (it may take less than asked for a large buffer on a network share). A call that takes none is a failure. */
async function writeAll(fh: fs.promises.FileHandle, bytes: Uint8Array): Promise<void> {
  let done = 0;
  while (done < bytes.length) {
    const wanted = bytes.length - done;
    const limit = hooks.writeLimit?.(wanted);
    const { bytesWritten } = await fh.write(bytes, done, limit === undefined ? wanted : Math.max(1, Math.min(limit, wanted)), done);
    if (bytesWritten === 0) throw Object.assign(new Error('The system took no bytes.'), { code: 'EIO' });
    done += bytesWritten;
  }
}

/** Puts the finished temporary file at `target` without ever replacing anything, then removes the temporary name. */
async function putInPlace(temporary: string, target: string, bytes: Uint8Array): Promise<void> {
  try {
    if (hooks.link !== undefined) await hooks.link(temporary, target);
    else await fs.promises.link(temporary, target);
  } catch (error) {
    const code = codeOf(error);
    if (code === 'EEXIST') return exists(target);
    if (code !== undefined && NO_LINK.has(code)) return createInPlace(temporary, target, bytes);
    throw error;
  }
  await removeFile(temporary);
}

/** `link` found something at the target: a link or a folder is unsafe (a dangling link too); a file is the answer "it exists". */
async function exists(target: string): Promise<never> {
  const st = await lstatOrNull(target);
  if (st !== null && !st.isFile()) return unsafe();
  throw new BundleRefusal('BUNDLE_EXISTS');
}

/**
 * The write for a volume with no hard links. The target itself is created with `O_EXCL | O_NOFOLLOW` at 0600, so nothing is replaced and a link is not followed. The
 * identity of what was created is taken from its descriptor. If anything fails, the target is removed only while the path still names that file: same device, inode, birth
 * time and size. This path is not atomic. The file is visible under its final name while it is written, and a crash can leave a truncated one, which the importer refuses.
 * If the removal is declined or fails, a partial file can stay at the final name; that is a warning with the code of the error, and the importer refuses the file.
 */
async function createInPlace(temporary: string, target: string, bytes: Uint8Array): Promise<void> {
  let fh: fs.promises.FileHandle;
  try {
    fh = await fs.promises.open(target, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW | NOCTTY, 0o600);
  } catch (error) {
    const code = codeOf(error);
    if (code === 'EEXIST') return exists(target);
    throw error;
  }
  let open = true;
  // What was created: its device, inode and birth time come from the descriptor. Its size is known exactly once the write has finished (before that it holds at most the
  // bytes asked for), so a file that someone else made longer is not taken for ours.
  let created: fs.BigIntStats | undefined;
  let written: bigint | null = 0n;
  try {
    created = await fh.stat({ bigint: true });
    await hooks.afterTargetCreated?.(target);
    written = null;
    await writeAll(fh, bytes);
    written = BigInt(bytes.length);
    await hooks.afterWrite?.(target);
    await fh.sync();
    await fh.close();
    open = false;
  } catch (error) {
    if (open) await fh.close().catch((e: unknown) => warnCleanup('closing the target', e));
    // Removed only by identity. If the identity was never taken (the stat failed), the file is left, and the warning says so: a file we cannot name is not ours to delete.
    let left = created === undefined;
    if (created !== undefined) left = await removeIfStillMine(target, created, written, BigInt(bytes.length));
    else process.emitWarning('harness-bundle: a file may remain at the target of a failed write (its identity was not read).', { type: 'BundleCleanupWarning' });
    // A partial file may stay at the final name: the refusal says so (cause PARTIAL_LEFT), so the person is never told that nothing was written.
    if (left) throw new BundleRefusal('BUNDLE_FILE_FAILED', [], [], PARTIAL_LEFT);
    throw error;
  }
  await removeFile(temporary);
}

/**
 * Removes `target` only while it is still the file that was created: same device, inode and birth time, and a size that is ours (`written` when it is known, else
 * anything up to `most`, the length of the bytes asked for). True when a file of ours may remain (the removal was declined or failed).
 */
async function removeIfStillMine(target: string, mine: fs.BigIntStats, written: bigint | null, most: bigint): Promise<boolean> {
  const now = await lstatOrNull(target).catch(() => null);
  if (now === null || !now.isFile()) return false;
  if (now.dev !== mine.dev || now.ino !== mine.ino || (now.birthtimeNs ?? 0n) !== (mine.birthtimeNs ?? 0n)) return false;
  // Declined: the file is ours by identity, but its size is not one we wrote. It stays.
  if (written !== null ? now.size !== written : now.size > most) return true;
  return !(await removeFile(target));
}
