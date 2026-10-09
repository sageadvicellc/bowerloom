/**
 * Guarded reads and writes of authored content. Internal to packages/project-authoring.
 * Every read refuses a link, a file with more than one link, a file or folder this user does not own, anything others
 * can write, and anything over the size bounds. Writes create new names only, never through a link.
 * Calls go through the `fs` object, so a test can stand a failure in for one call.
 */
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { refuse, ensure } from './refusal.js';

export const LIMITS = Object.freeze({ fileBytes: 256 * 1024, recordBytes: 1024 * 1024, briefBytes: 64 * 1024, itemEntries: 256, depth: 8, folderNames: 256, items: 512 });
export const sha256 = (value: string | Buffer): string => createHash('sha256').update(value).digest('hex');
const owned = (s: fs.Stats): boolean => s.uid === process.getuid?.() && (s.mode & 0o022) === 0;
const NAME = /^[^\0/\\\p{Cc}\p{Cf}]{1,255}$/u;

/** lstat, or null when nothing is there. Any other failure is unsafe. */
export function lstatOrNull(path: string): fs.Stats | null {
  try { return fs.lstatSync(path); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; return refuse('AUTHORING_UNSAFE_PATH'); }
}
/** A real folder (not a link) that this user owns and others cannot write. */
export function realFolder(path: string): fs.Stats {
  const s = lstatOrNull(path);
  ensure(s !== null && s.isDirectory() && !s.isSymbolicLink() && owned(s), 'AUTHORING_UNSAFE_PATH');
  return s;
}
/** The names in a real folder, at most LIMITS.folderNames, each a plain name, with no two that differ only in case. */
export function folderNames(path: string): string[] {
  realFolder(path);
  let names: string[]; try { names = fs.readdirSync(path); } catch { return refuse('AUTHORING_UNSAFE_PATH'); }
  ensure(names.length <= LIMITS.folderNames && names.every(n => NAME.test(n)), 'AUTHORING_UNSAFE_PATH');
  ensure(new Set(names.map(n => n.normalize('NFC').toLowerCase())).size === names.length, 'AUTHORING_UNSAFE_PATH');
  return names.sort();
}

/**
 * Reads a regular file with the full guards and returns its bytes. A file may have a second link only when
 * `secondLink` names a path that is that very file (the stage copy of an interrupted prompt create).
 */
export function readGuarded(path: string, maxBytes: number, secondLink: string | null = null): Buffer {
  const before = lstatOrNull(path);
  ensure(before !== null && before.isFile() && !before.isSymbolicLink() && owned(before) && before.size <= maxBytes, 'AUTHORING_UNSAFE_PATH');
  if (before.nlink !== 1) {
    const other = secondLink === null ? null : lstatOrNull(secondLink);
    ensure(before.nlink === 2 && other !== null && other.isFile() && other.dev === before.dev && other.ino === before.ino, 'AUTHORING_UNSAFE_PATH');
  }
  let fd: number; try { fd = fs.openSync(path, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK); } catch { return refuse('AUTHORING_UNSAFE_PATH'); }
  try {
    const opened = fs.fstatSync(fd);
    ensure(opened.isFile() && opened.dev === before.dev && opened.ino === before.ino && opened.size === before.size && opened.nlink === before.nlink, 'AUTHORING_UNSAFE_PATH');
    const buffer = Buffer.alloc(maxBytes + 1); let length = 0, read = 0;
    while ((read = fs.readSync(fd, buffer, length, buffer.length - length, null)) > 0) { length += read; ensure(length <= maxBytes, 'AUTHORING_UNSAFE_PATH'); }
    const after = fs.fstatSync(fd);
    ensure(length === before.size && after.size === before.size && after.mtimeMs === opened.mtimeMs && after.ctimeMs === opened.ctimeMs, 'AUTHORING_UNSAFE_PATH');
    return Buffer.from(buffer.subarray(0, length));
  } finally { fs.closeSync(fd); }
}

export interface FilePin { path: string; sha256: string; bytes: number }
/**
 * Reads every file under `.bowerloom/<relative>` with the guards and returns their pins, sorted by path, with paths
 * relative to `.bowerloom`. Folders are real and owned; at most LIMITS.itemEntries entries and LIMITS.depth levels.
 */
export function readTree(bowerloom: string, relative: string): FilePin[] {
  const pins: FilePin[] = []; let entries = 0;
  const walk = (rel: string, depth: number): void => {
    ensure(depth <= LIMITS.depth, 'AUTHORING_UNSAFE_PATH');
    for (const name of folderNames(join(bowerloom, rel))) {
      ensure(++entries <= LIMITS.itemEntries, 'AUTHORING_UNSAFE_PATH');
      const child = `${rel}/${name}`, s = lstatOrNull(join(bowerloom, child));
      ensure(s !== null && !s.isSymbolicLink(), 'AUTHORING_UNSAFE_PATH');
      if (s.isDirectory()) walk(child, depth + 1);
      else { const bytes = readGuarded(join(bowerloom, child), LIMITS.fileBytes); pins.push({ path: child, sha256: sha256(bytes), bytes: bytes.length }); }
    }
  };
  walk(relative, 1);
  return pins.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
}

/** Creates a new file (never through a link, never over a name) with these bytes, and flushes it. */
export function writeNewFile(path: string, data: string | Buffer): void {
  const fd = fs.openSync(path, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
  try { fs.fchmodSync(fd, 0o600); const bytes = Buffer.from(data); let at = 0; while (at < bytes.length) at += fs.writeSync(fd, bytes, at); fs.fsyncSync(fd); }
  finally { fs.closeSync(fd); }
}
/** Creates a new private folder. A name already there is unsafe. */
export function makeFolder(path: string): void {
  try { fs.mkdirSync(path, { mode: 0o700 }); } catch { refuse('AUTHORING_UNSAFE_PATH'); }
  realFolder(path);
}
export function syncFolder(path: string): void {
  const fd = fs.openSync(path, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}
/** Removes one of Bowerloom's own scratch folders. Links inside are removed as names, never followed. */
export function removeScratch(path: string): void {
  const s = lstatOrNull(path);
  if (s === null) return;
  ensure(!s.isSymbolicLink() && owned(s), 'AUTHORING_UNSAFE_PATH');
  fs.rmSync(path, { recursive: s.isDirectory(), force: false });
}
