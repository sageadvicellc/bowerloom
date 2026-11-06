/**
 * The file of the saved read, in the app's private state folder (`<state root>/last-read/last-read.json`, the same root the usage log uses; main/engine-state.ts). It is the
 * only place the app keeps what the reader found, and it keeps only what the window already received (shared/real/saved-scan.ts).
 *
 * Writing: the folder is for its owner only (0700) and must be a real folder, never a link; the text goes to a new temporary file for its owner only (0600) that follows no link,
 * is flushed, and is then renamed over the old file in one step, so a crash leaves the old read or the new one, never half of one. A read over the size cap is not kept, and the
 * old one is removed so a later launch cannot show a read older than the last. A save that fails gives false and never throws.
 *
 * Loading: the file is untrusted. A folder or file that is a link, a file that is not a plain file, a file over the cap, text that is not JSON, a version that is not ours and
 * a shape the window cannot draw each give a plain reason (`DamageWhy`) and never a crash. Nothing from the file is used unless every check passed.
 */
import { closeSync, constants, fstatSync, fsyncSync, lstatSync, mkdirSync, chmodSync, openSync, readSync, readdirSync, renameSync, unlinkSync, writeSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { realToHarnessState } from '../shared/harness/real-map.js';
import { SAVED_SCAN_MAX_BYTES, parseSavedScan } from '../shared/real/saved-scan.js';
import type { DamageWhy, SavedScan } from '../shared/real/saved-scan.js';

const FOLDER = 'last-read', FILE = 'last-read.json';

export const cacheDir = (stateRoot: string): string => join(stateRoot, FOLDER);
export const cachePath = (stateRoot: string): string => join(cacheDir(stateRoot), FILE);

export type LoadResult = { readonly status: 'none' } | { readonly status: 'damaged'; readonly why: DamageWhy } | { readonly status: 'ok'; readonly scan: SavedScan };

export interface ScanCache {
  /** Keeps the read. False when it was not kept (too big, a write that failed, or a folder that is not ours). A read that is too big removes the old one; any other failure leaves the old one whole, and the caller decides (`forget`). */
  save(scan: SavedScan): boolean;
  load(): LoadResult;
  /** Removes the saved read, when it is a plain file of ours. Anything else there is left alone. Never throws. */
  forget(): void;
}

export interface ScanCacheDeps {
  readonly stateRoot: string;
  /** For a test: a smaller cap than `SAVED_SCAN_MAX_BYTES`. */
  readonly maxBytes?: number;
  /** For a test: the call that writes bytes to the open file (it may take fewer than asked), and the user id the folder and file must belong to. */
  readonly write?: (fd: number, bytes: Buffer, offset: number, length: number) => number;
  readonly uid?: number;
}

/** A temporary file of ours that a crash left, and how old it must be before a save removes it (a younger one may belong to a save in progress). */
const TEMP_NAME = /^last-read\.\d+\.[0-9a-f]{12}\.tmp$/, TEMP_STALE_MS = 10 * 60 * 1000;

const codeOf = (error: unknown): string => String((error as { code?: unknown } | null)?.code ?? '');
/** Nothing is there: no file, or a path whose parent is not a folder. */
const isAbsent = (error: unknown): boolean => codeOf(error) === 'ENOENT' || codeOf(error) === 'ENOTDIR';

export function createScanCache(deps: ScanCacheDeps): ScanCache {
  const max = Math.min(deps.maxBytes ?? SAVED_SCAN_MAX_BYTES, SAVED_SCAN_MAX_BYTES), dir = cacheDir(deps.stateRoot), path = cachePath(deps.stateRoot);
  const write = deps.write ?? ((fd: number, bytes: Buffer, offset: number, length: number): number => writeSync(fd, bytes, offset, length));
  const uid = deps.uid ?? process.getuid?.();
  /** Whether this folder or file is ours alone: owned by this user (where the system has users) and not writable by the group or by others. */
  const isPrivate = (stat: { uid: number; mode: number }): boolean => (uid === undefined || stat.uid === uid) && (stat.mode & 0o022) === 0;

  /** Removes the file of an older read when it is a plain file of ours there. Anything else is left alone. */
  const forget = (): void => {
    try {
      const folder = lstatSync(dir), file = lstatSync(path);
      if (folder.isDirectory() && !folder.isSymbolicLink() && isPrivate(folder) && file.isFile() && !file.isSymbolicLink()) unlinkSync(path);
    } catch { /* nothing there */ }
  };

  /** Removes the temporary files of a save that a crash cut short. A young one may belong to a save that is running now, and a file with another name is not ours. */
  const sweep = (): void => {
    try {
      for (const name of readdirSync(dir)) {
        if (!TEMP_NAME.test(name)) continue;
        const stat = lstatSync(join(dir, name));
        if (stat.isFile() && Date.now() - stat.mtimeMs > TEMP_STALE_MS) unlinkSync(join(dir, name));
      }
    } catch { /* the sweep is a courtesy */ }
  };

  const save = (scan: SavedScan): boolean => {
    let temp: string | null = null;
    try {
      const text = JSON.stringify(scan);
      if (Buffer.byteLength(text) > max) { forget(); return false; }
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      // A folder that is a link is refused before anything is written in it.
      const folder = lstatSync(dir);
      if (folder.isSymbolicLink() || !folder.isDirectory() || (uid !== undefined && folder.uid !== uid)) return false;
      chmodSync(dir, 0o700);
      sweep();
      temp = join(dir, `last-read.${process.pid}.${randomBytes(6).toString('hex')}.tmp`);
      const fd = openSync(temp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      try {
        // A write may take fewer bytes than it was given (a full disk): go on until all are written, and treat a write that takes nothing as a failed save. The old file stays whole.
        const bytes = Buffer.from(text);
        for (let done = 0; done < bytes.length;) {
          const n = write(fd, bytes, done, bytes.length - done);
          if (!(n > 0)) throw new Error('SHORT_WRITE');
          done += n;
        }
        fsyncSync(fd);
      } finally { closeSync(fd); }
      renameSync(temp, path);
      temp = null;
      return true;
    } catch {
      if (temp !== null) { try { unlinkSync(temp); } catch { /* not there */ } }
      return false;
    }
  };

  const load = (): LoadResult => {
    try {
      let folder;
      try { folder = lstatSync(dir); } catch (error) { return isAbsent(error) ? { status: 'none' } : { status: 'damaged', why: 'unreadable' }; }
      if (folder.isSymbolicLink() || !folder.isDirectory()) return { status: 'damaged', why: 'linked' };
      if (!isPrivate(folder)) return { status: 'damaged', why: 'not-private' };
      let file;
      try { file = lstatSync(path); } catch (error) { return isAbsent(error) ? { status: 'none' } : { status: 'damaged', why: 'unreadable' }; }
      if (file.isSymbolicLink() || !file.isFile()) return { status: 'damaged', why: 'linked' };
      if (!isPrivate(file)) return { status: 'damaged', why: 'not-private' };
      if (file.size > max) { forget(); return { status: 'damaged', why: 'too-big' }; }
      let fd: number;
      try { fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW); } catch (error) { return { status: 'damaged', why: codeOf(error) === 'ELOOP' ? 'linked' : 'unreadable' }; }
      let text: string;
      try {
        // The size is asked of the open handle, not the name: a file swapped after the check above is checked again.
        const handle = fstatSync(fd);
        if (!handle.isFile()) return { status: 'damaged', why: 'linked' };
        if (handle.size > max) return { status: 'damaged', why: 'too-big' };
        const bytes = Buffer.allocUnsafe(handle.size);
        let got = 0;
        while (got < bytes.length) { const n = readSync(fd, bytes, got, bytes.length - got, null); if (n === 0) break; got += n; }
        text = bytes.subarray(0, got).toString('utf8');
      } finally { closeSync(fd); }
      const parsed = parseSavedScan(text);
      // A file that is broken, too big or in a shape the reader could never have made is removed, so the next launch does not do this work again. A file of another version is left:
      // a newer app may have written it.
      if (!parsed.ok) { if (parsed.why !== 'wrong-version') forget(); return { status: 'damaged', why: parsed.why }; }
      // The window turns the read into its screens with this call. A read it cannot turn is damaged, so the window never meets it half-loaded.
      try { realToHarnessState(parsed.scan.result, parsed.scan.chosen); } catch { forget(); return { status: 'damaged', why: 'bad-shape' }; }
      return { status: 'ok', scan: parsed.scan };
    } catch {
      return { status: 'damaged', why: 'unreadable' };
    }
  };

  return { save, load, forget };
}
