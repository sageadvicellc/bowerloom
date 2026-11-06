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
import { closeSync, constants, fstatSync, fsyncSync, lstatSync, mkdirSync, chmodSync, openSync, readSync, renameSync, unlinkSync, writeSync } from 'node:fs';
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
  /** Keeps the read. False when it was not kept (too big, or the folder could not be made safe), and the old read is gone or untouched as the comment above says. */
  save(scan: SavedScan): boolean;
  load(): LoadResult;
}

export interface ScanCacheDeps { readonly stateRoot: string; /** For a test: a smaller cap than `SAVED_SCAN_MAX_BYTES`. */ readonly maxBytes?: number }

const codeOf = (error: unknown): string => String((error as { code?: unknown } | null)?.code ?? '');

export function createScanCache(deps: ScanCacheDeps): ScanCache {
  const max = Math.min(deps.maxBytes ?? SAVED_SCAN_MAX_BYTES, SAVED_SCAN_MAX_BYTES), dir = cacheDir(deps.stateRoot), path = cachePath(deps.stateRoot);

  /** Removes the file of an older read when it is a plain file there. Anything else is left alone. */
  const forget = (): void => {
    try { if (lstatSync(dir).isDirectory() && !lstatSync(dir).isSymbolicLink() && lstatSync(path).isFile()) unlinkSync(path); } catch { /* nothing there */ }
  };

  const save = (scan: SavedScan): boolean => {
    let temp: string | null = null;
    try {
      const text = JSON.stringify(scan);
      if (Buffer.byteLength(text) > max) { forget(); return false; }
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      // A folder that is a link is refused before anything is written in it.
      const folder = lstatSync(dir);
      if (folder.isSymbolicLink() || !folder.isDirectory()) return false;
      chmodSync(dir, 0o700);
      temp = join(dir, `last-read.${process.pid}.${randomBytes(6).toString('hex')}.tmp`);
      const fd = openSync(temp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      try { writeSync(fd, text); fsyncSync(fd); } finally { closeSync(fd); }
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
      try { folder = lstatSync(dir); } catch (error) { return codeOf(error) === 'ENOENT' ? { status: 'none' } : { status: 'damaged', why: 'unreadable' }; }
      if (folder.isSymbolicLink() || !folder.isDirectory()) return { status: 'damaged', why: 'linked' };
      let file;
      try { file = lstatSync(path); } catch (error) { return codeOf(error) === 'ENOENT' ? { status: 'none' } : { status: 'damaged', why: 'unreadable' }; }
      if (file.isSymbolicLink() || !file.isFile()) return { status: 'damaged', why: 'linked' };
      if (file.size > max) return { status: 'damaged', why: 'too-big' };
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
      if (!parsed.ok) return { status: 'damaged', why: parsed.why };
      // The window turns the read into its screens with this call. A read it cannot turn is damaged, so the window never meets it half-loaded.
      try { realToHarnessState(parsed.scan.result, parsed.scan.chosen); } catch { return { status: 'damaged', why: 'bad-shape' }; }
      return { status: 'ok', scan: parsed.scan };
    } catch {
      return { status: 'damaged', why: 'unreadable' };
    }
  };

  return { save, load };
}
