/**
 * The one writer of `bowerloom.json` and `bowerloom.lock.json` (spec 06, 3.14): the pattern of applyManifestChange in
 * packages/skill-manifest/src/add.ts, generalized. A temporary file is written with O_EXCL and O_NOFOLLOW, mode 0644, and
 * flushed. The target must still have the planned `before` hash. For a new file, `lstat` must give ENOENT, and the
 * temporary file is renamed onto the target; for an existing file it is renamed. A file another program creates between
 * the `lstat` and the `rename` is replaced: the project lock serializes Bowerloom's writers, and a link write could leave
 * a second link after a crash, which locks the project out. The folder is flushed and the file read back.
 */
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import { join } from 'node:path';
import { isHeldProjectLock } from '../../project-context/src/index.js';
import type { HeldProjectLock } from '../../project-context/src/types.js';
import { manifestRefusal } from '../../skill-manifest/src/refusal.js';
import { refuse } from './refusal.js';
import { CONFIG_FILE } from './schema.js';
import { LOCK_FILE } from './lock.js';

export interface GuardedWrite { sha256: string; bytes: number; device: string; inode: string; created: boolean }
/** Test hooks. Product code passes nothing. */
export interface WriteHooks { readonly beforeRename?: () => void; readonly afterRename?: () => void }
const MAX = 4194304;
const sha = (value: string | Buffer): string => createHash('sha256').update(value).digest('hex');
const stale = (): never => { throw manifestRefusal('STALE_APPROVAL'); };
/** A leftover temporary of the writer, for `name`: `.<name>.<16 hex>.tmp`. */
export const scratchName = (name: string): RegExp => new RegExp(`^\\.${name.replace(/\./g, '\\.')}\\.[a-f0-9]{16}\\.tmp$`);

/** The sha256 of the file at `path`, read as a plain file of at most 4 MiB, or null when nothing is there. Anything else is STALE_APPROVAL. */
export function currentSha256(path: string): string | null {
  let stat: fs.Stats;
  try { stat = fs.lstatSync(path); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; return stale(); }
  if (stat.isSymbolicLink() || !stat.isFile() || stat.nlink !== 1 || stat.uid !== process.getuid?.() || (stat.mode & 0o022) !== 0 || stat.size > MAX) stale();
  let fd: number;
  try { fd = fs.openSync(path, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK); } catch { return stale(); }
  try {
    const open = fs.fstatSync(fd);
    if (open.dev !== stat.dev || open.ino !== stat.ino || !open.isFile()) stale();
    const buffer = Buffer.alloc(MAX + 1); let length = 0, n = 0;
    while ((n = fs.readSync(fd, buffer, length, buffer.length - length, null)) > 0) { length += n; if (length > MAX) stale(); }
    return sha(buffer.subarray(0, length));
  } finally { fs.closeSync(fd); }
}

function syncFolder(path: string): void { const fd = fs.openSync(path, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); } }

/**
 * Writes `text` to `<folder>/<name>` under the held project lock of `folder`. `beforeSha256` is the hash the plan bound,
 * or null for a new file; a change refuses STALE_APPROVAL and writes nothing. `tempPrefix` is the name the temporary
 * file starts with, `.<name>`. A read back that does not give `text` refuses CONFIG_WRITE_UNCONFIRMED or
 * LOCK_WRITE_UNCONFIRMED. Returns the hash, the size, and the device and inode of the file this call created.
 */
export function writeGuardedFile(folder: string, name: string, text: string, beforeSha256: string | null, held: HeldProjectLock, tempPrefix: string, hooks: WriteHooks = {}): GuardedWrite {
  if (!isHeldProjectLock(held)) throw manifestRefusal('PROJECT_LOCKED');
  if (name !== CONFIG_FILE && name !== LOCK_FILE) throw new TypeError('writeGuardedFile writes bowerloom.json and bowerloom.lock.json only.');
  if (tempPrefix !== `.${name}`) throw new TypeError('The temporary name of a guarded write is .<name>.<16 hex>.tmp.');
  held.assertHeld(folder);
  const target = join(folder, name), temp = join(folder, `${tempPrefix}.${randomBytes(8).toString('hex')}.tmp`), data = Buffer.from(text);
  let made = false, device = '', inode = '';
  try {
    const fd = fs.openSync(temp, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o644); made = true;
    try {
      fs.fchmodSync(fd, 0o644);
      let at = 0; while (at < data.length) at += fs.writeSync(fd, data, at);
      fs.fsyncSync(fd);
      const s = fs.fstatSync(fd, { bigint: true }); device = s.dev.toString(); inode = s.ino.toString();
    } finally { fs.closeSync(fd); }
    held.assertHeld(folder);
    if (currentSha256(target) !== beforeSha256) stale();
    if (beforeSha256 === null) {
      try { fs.lstatSync(target); stale(); } catch (error) { if ((error as { code?: unknown }).code !== 'ENOENT') throw error; }
    }
    hooks.beforeRename?.();
    fs.renameSync(temp, target); made = false;
    hooks.afterRename?.();
    syncFolder(folder);
  } finally { if (made) { try { fs.unlinkSync(temp); } catch { /* Already gone. */ } } }
  // The file was written. A difference now is not a stale plan: it has its own code.
  const now = currentSha256WithoutStale(target);
  if (now !== sha(data)) refuse(name === CONFIG_FILE ? 'CONFIG_WRITE_UNCONFIRMED' : 'LOCK_WRITE_UNCONFIRMED');
  return { sha256: sha(data), bytes: data.length, device, inode, created: beforeSha256 === null };
}
/** As currentSha256, with null for anything that cannot be read. */
function currentSha256WithoutStale(path: string): string | null { try { return currentSha256(path); } catch { return null; } }
