/**
 * The bounded reading and writing of a bundle file. The README states the rules; the contract is in the comments of `index.ts`. In short:
 *  - a read opens with `O_NOFOLLOW | O_NONBLOCK`, asks the DESCRIPTOR what it is (a folder also opens read-only), refuses anything but a regular file of the user,
 *    reads at most one byte past the size from `fstat`, and checks the file again after the read, by descriptor and by path;
 *  - a write resolves the parent folder once, writes a dot-prefixed `.part` file at mode 0600 in that folder in one call, and puts it in place with `link` (so a file
 *    made in between is never replaced), or, where hard links do not exist, by creating the target itself with `O_EXCL`;
 *  - a replace compares the identity of the target right before the rename.
 * Every failure is a `BundleRefusal`. The text of an operating system error, which may name a path, is never passed on.
 */
import { randomBytes } from 'node:crypto';
import fs, { constants } from 'node:fs';
import path from 'node:path';
import { BundleRefusal } from './codes.js';
import { BUNDLE_LIMITS } from './limits.js';
import type { BundleFileIdentity } from './types.js';

/**
 * Seams for the tests, and nothing else. Production code never sets one. A test sets a function here to change the world at an exact point (swap a file, grow it, make
 * `link` fail) and clears it after. This object is not exported from the package index.
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
}
export const fileIoHooks: FileIoHooks = {};

const unsafe = (): never => { throw new BundleRefusal('BUNDLE_FILE_UNSAFE'); };
const usage = (): never => { throw new BundleRefusal('BUNDLE_USAGE'); };
const codeOf = (error: unknown): string | undefined => (error as NodeJS.ErrnoException | null)?.code;

/** The chunk of one read call. Each call is a turn of the event loop. */
const CHUNK = 4 * 1024 * 1024;
/** The errors of `link` that mean "this volume has no hard links". */
const NO_LINK = new Set(['EPERM', 'ENOTSUP', 'EOPNOTSUPP', 'ENOSYS', 'EXDEV', 'EMLINK']);

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
    fh = await fs.promises.open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  } catch { return unsafe(); }
  try {
    const first = await fh.stat({ bigint: true });
    if (!first.isFile()) return unsafe();
    if (typeof process.getuid === 'function' && first.uid !== BigInt(process.getuid())) return unsafe();
    if (first.size > BigInt(BUNDLE_LIMITS.fileBytes)) throw new BundleRefusal('BUNDLE_TOO_LARGE');
    await fileIoHooks.afterStat?.(file);
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
    await fileIoHooks.afterRead?.(file);
    const last = await fh.stat({ bigint: true });
    if (!last.isFile() || !same(identityOf(first), identityOf(last))) return unsafe();
    // The path must still name this file: a swap during the read shows here.
    const named = await fs.promises.lstat(file, { bigint: true });
    if (!named.isFile() || named.dev !== first.dev || named.ino !== first.ino) return unsafe();
    return buffer.subarray(0, size);
  } catch (error) {
    if (error instanceof BundleRefusal) throw error;
    return unsafe();
  } finally {
    await fh.close().catch(() => undefined);
  }
}

// ---- identity -------------------------------------------------------------------------------------------------------------------

export async function bundleTargetIdentity(absPath: string): Promise<BundleFileIdentity | null> {
  const file = absolute(absPath);
  let st: fs.BigIntStats;
  try { st = await fs.promises.lstat(file, { bigint: true }); } catch (error) {
    if (codeOf(error) === 'ENOENT') return null;
    return unsafe();
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
  try { parent = await fs.promises.realpath(given); } catch { return unsafe(); }
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
    await fileIoHooks.afterTemp?.(file);
    if (replace === undefined) {
      await putInPlace(temporary, target, bytes);
    } else {
      // Right before the rename: the file there must still be the one the person agreed to replace.
      const now = await lstatOrNull(target);
      if (now === null || !now.isFile() || !same(identityOf(now), replace)) return unsafe();
      await fs.promises.rename(temporary, target);
      made = false;
    }
  } catch (error) {
    if (error instanceof BundleRefusal) throw error;
    return unsafe();
  } finally {
    if (made) await fs.promises.unlink(temporary).catch(() => undefined);
  }
}

async function lstatOrNull(p: string): Promise<fs.BigIntStats | null> {
  try { return await fs.promises.lstat(p, { bigint: true }); } catch (error) {
    if (codeOf(error) === 'ENOENT') return null;
    return unsafe();
  }
}

/** Creates the temporary file (new, not through a link, mode 0600 from creation), writes the bytes in one call, and syncs. */
async function createTemporary(temporary: string, bytes: Uint8Array): Promise<void> {
  const fh = await fs.promises.open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
  try {
    await writeAll(fh, bytes);
    await fh.sync();
  } catch (error) {
    await fh.close().catch(() => undefined);
    await fs.promises.unlink(temporary).catch(() => undefined);
    throw error;
  }
  await fh.close();
}

/** One write call. A short write is a failure: the file would be incomplete. */
async function writeAll(fh: fs.promises.FileHandle, bytes: Uint8Array): Promise<void> {
  if (bytes.length === 0) return;
  const { bytesWritten } = await fh.write(bytes, 0, bytes.length, 0);
  if (bytesWritten !== bytes.length) throw new Error('short write');
}

/** Puts the finished temporary file at `target` without ever replacing anything, then removes the temporary name. */
async function putInPlace(temporary: string, target: string, bytes: Uint8Array): Promise<void> {
  try {
    if (fileIoHooks.link !== undefined) await fileIoHooks.link(temporary, target);
    else await fs.promises.link(temporary, target);
  } catch (error) {
    const code = codeOf(error);
    if (code === 'EEXIST') return exists(target);
    if (code !== undefined && NO_LINK.has(code)) return createInPlace(temporary, target, bytes);
    throw error;
  }
  await fs.promises.unlink(temporary).catch(() => undefined);
}

/** `link` found something at the target: a link or a folder is unsafe (a dangling link too); a file is the answer "it exists". */
async function exists(target: string): Promise<never> {
  const st = await lstatOrNull(target);
  if (st !== null && !st.isFile()) return unsafe();
  throw new BundleRefusal('BUNDLE_EXISTS');
}

/**
 * The write for a volume with no hard links. The target itself is created with `O_EXCL | O_NOFOLLOW` at 0600, so nothing is replaced and a link is not followed. The
 * identity of what was created is taken from its descriptor. If anything fails, the target is removed only while the path still names that file: same device, inode, size
 * and birth time. This path is not atomic. The file is visible under its final name while it is written, and a crash can leave a truncated one, which the importer refuses.
 */
async function createInPlace(temporary: string, target: string, bytes: Uint8Array): Promise<void> {
  let fh: fs.promises.FileHandle;
  try {
    fh = await fs.promises.open(target, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
  } catch (error) {
    const code = codeOf(error);
    if (code === 'EEXIST') return exists(target);
    if (code === 'ELOOP') return unsafe();
    throw error;
  }
  let open = true;
  // What was created: its device, inode and birth time come from the descriptor. Its size is known exactly once the write call has returned (before that it holds
  // at most the bytes asked for), so a file that someone else made longer is not taken for ours.
  const created = await fh.stat({ bigint: true });
  let written: bigint | null = 0n;
  try {
    await fileIoHooks.afterTargetCreated?.(target);
    written = null;
    await writeAll(fh, bytes);
    written = BigInt(bytes.length);
    await fileIoHooks.afterWrite?.(target);
    await fh.sync();
    await fh.close();
    open = false;
  } catch (error) {
    if (open) await fh.close().catch(() => undefined);
    await removeIfStillMine(target, created, written, BigInt(bytes.length));
    throw error;
  }
  await fs.promises.unlink(temporary).catch(() => undefined);
}

/**
 * Removes `target` only while it is still the file that was created: same device, inode and birth time, and a size that is ours (`written` when it is known, else
 * anything up to `most`, the length of the bytes asked for).
 */
async function removeIfStillMine(target: string, mine: fs.BigIntStats, written: bigint | null, most: bigint): Promise<void> {
  const now = await lstatOrNull(target).catch(() => null);
  if (now === null || !now.isFile()) return;
  if (now.dev !== mine.dev || now.ino !== mine.ino || (now.birthtimeNs ?? 0n) !== (mine.birthtimeNs ?? 0n)) return;
  if (written !== null ? now.size !== written : now.size > most) return;
  await fs.promises.unlink(target).catch(() => undefined);
}
