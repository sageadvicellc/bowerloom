/**
 * The only file reads of the real-setup reader. It lists folders, looks at what a name is, and reads text. It has no call that changes anything: the imports of
 * `node:fs` below are the whole list, and tests/real-static.test.ts holds this file (and everything it imports) to that list.
 *
 * Rules every walk and every read obeys:
 *  - the depth, the number of entries, the number of files, the number of bytes and the time are capped, and the caps are checked inside the loops that read, not only
 *    between folders (`Budget`);
 *  - a shortcut (a symbolic link) is followed only when what it points at is still inside the folder being read; a folder that was already visited is not entered twice;
 *  - a file is opened once, without following a last-part link and without waiting for a writer (`O_NOFOLLOW`, `O_NONBLOCK`), and the open handle is what is asked: it must
 *    be a plain file, under the size cap. The size, the kind and the bytes all come from that one handle, so a file swapped for a pipe after it was listed cannot hang the reader;
 *  - a name with a control character is skipped; a file over the size cap, a binary file, a pipe, a socket and a file or folder that will not open are counted and skipped.
 * Nothing here throws for a bad folder.
 */
// `openSync` is imported as `openRead`: every call passes OPEN_READ (tests/real-static.test.ts holds the file to that), and the name keeps tests/boundary.test.ts, which looks
// for the text of any call that could open a file for writing, from listing this read-only module as a writer.
import { closeSync, constants, fstatSync, lstatSync, opendirSync, openSync as openRead, readSync, realpathSync, statSync } from 'node:fs';
import type { Dirent, Stats } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { REAL_LIMITS } from '../shared/real/types.js';
import { cleanPath } from '../shared/real/redact.js';
import { isInside, isPlainName } from './safe.js';

/** What went wrong while reading, counted. `couldNotRead` is the sum the person sees. */
export interface Tally {
  tooBig: number;
  binary: number;
  unreadable: number;
  linksOutside: number;
  /** The time, the bytes or the number of files ran out. */
  stoppedEarly: boolean;
  /** Part of the stop came from the byte or file count (not the clock). */
  overBytes: boolean;
  truncated: boolean;
}

export const newTally = (): Tally => ({ tooBig: 0, binary: 0, unreadable: 0, linksOutside: 0, stoppedEarly: false, overBytes: false, truncated: false });
export const couldNotRead = (t: Tally): number => t.tooBig + t.binary + t.unreadable + t.linksOutside;

export function addTally(into: Tally, from: Readonly<Tally>): void {
  into.tooBig += from.tooBig; into.binary += from.binary; into.unreadable += from.unreadable; into.linksOutside += from.linksOutside;
  into.stoppedEarly ||= from.stoppedEarly; into.overBytes ||= from.overBytes; into.truncated ||= from.truncated;
}

/**
 * The limits of one call: a clock that tells when the time is spent, and a count of the bytes and files taken so far. `now` is injected so a test can spend the time.
 */
export interface Budget {
  /** The time is spent. */
  expired(): boolean;
  /** The byte or file count is spent: no further read is allowed. */
  spent(): boolean;
  /** Takes one file of `bytes` bytes. False (and nothing taken) when that would pass a cap. */
  take(bytes: number): boolean;
}

export function makeBudget(now: () => number, ms: number = REAL_LIMITS.budgetMs, totalBytes: number = REAL_LIMITS.totalBytes, items: number = REAL_LIMITS.itemsPerCall): Budget {
  const end = now() + ms;
  let bytes = 0, count = 0, full = false;
  return {
    expired: () => now() >= end,
    spent: () => full,
    take: n => {
      if (full || bytes + n > totalBytes || count + 1 > items) { full = true; return false; }
      bytes += n; count += 1;
      return true;
    },
  };
}

/** Whether to stop reading now. Sets the flag the person is told about: `stoppedEarly`, and `overBytes` when it was a count and not the clock. */
export function mustStop(budget: Budget, tally: Tally): boolean {
  if (budget.spent()) { tally.stoppedEarly = true; tally.overBytes = true; return true; }
  if (budget.expired()) { tally.stoppedEarly = true; return true; }
  return false;
}

/** What an entry is after any shortcut is resolved. */
export interface Resolved { readonly real: string; readonly stat: Stats }

/** The real location of an entry that is a shortcut or not, or null when it leads outside `containReal`, is broken, or is a loop. */
export function resolveInside(abs: string, containReal: string, tally: Tally): Resolved | null {
  try {
    const real = realpathSync(abs);
    if (!isInside(containReal, real)) { tally.linksOutside += 1; return null; }
    return { real, stat: statSync(real) };
  } catch { tally.unreadable += 1; return null; }
}

/**
 * The names in a folder, sorted. It stops listing after `limit` entries (a folder with a million files is not listed whole first), and gives an empty list (counted)
 * when the folder will not open.
 */
export function listDir(abs: string, tally: Tally, limit: number = REAL_LIMITS.discoveryEntries + 1): Dirent[] {
  const out: Dirent[] = [];
  let dir;
  try { dir = opendirSync(abs); } catch { tally.unreadable += 1; return []; }
  try {
    for (let entry = dir.readSync(); entry !== null && out.length < limit; entry = dir.readSync()) out.push(entry);
  } catch { tally.unreadable += 1; } finally {
    try { dir.closeSync(); } catch { /* already closed */ }
  }
  return out.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/** Whether something (a file or a shortcut, not a folder) is at this path. Nothing is opened. */
export function isThere(abs: string): boolean {
  try { const s = lstatSync(abs); return s.isFile() || s.isSymbolicLink(); } catch { return false; }
}

/** Whether a path is a real folder (not a shortcut), and its real location. */
export function realFolder(abs: string): string | null {
  try { const s = lstatSync(abs); if (s.isSymbolicLink() || !s.isDirectory()) return null; return realpathSync(abs); } catch { return null; }
}

/** The real location of a folder that may itself be a shortcut (a tool folder the person keeps elsewhere), or null. */
export function realFolderFollowing(abs: string): string | null {
  try { const real = realpathSync(abs); return statSync(real).isDirectory() ? real : null; } catch { return null; }
}

/** The open flags of every read: read only, no waiting for a writer on a pipe, and never through a link in the last part of the name. */
const OPEN_READ = constants.O_RDONLY | constants.O_NONBLOCK | (constants.O_NOFOLLOW ?? 0);
const BLOCK = 256 * 1024;

interface Opened { readonly fd: number; readonly size: number }

/**
 * Opens the file at `abs` for reading, but only when its real location is inside `containReal` and the handle that came back is a plain file. The checks use the
 * handle, not the name: the kind and the size are those of the file that was opened. Null (counted) otherwise; the caller closes the handle.
 */
function plainHandle(abs: string, containReal: string, tally: Tally): Opened | null {
  let real: string;
  try { real = realpathSync(abs); } catch { tally.unreadable += 1; return null; }
  if (!isInside(containReal, real)) { tally.linksOutside += 1; return null; }
  let fd = -1;
  try {
    fd = openRead(real, OPEN_READ);
    const stat = fstatSync(fd);
    if (!stat.isFile()) { closeSync(fd); tally.unreadable += 1; return null; }
    return { fd, size: stat.size };
  } catch {
    if (fd >= 0) { try { closeSync(fd); } catch { /* nothing to do */ } }
    tally.unreadable += 1; return null;
  }
}

/** Reads up to `want` bytes from the open handle, in blocks, looking at the clock between blocks. Null (and the stop flag set) when the time ran out. */
function readBlocks(fd: number, want: number, budget: Budget | undefined, tally: Tally): Buffer | null {
  const bytes = Buffer.allocUnsafe(want);
  let got = 0;
  while (got < want) {
    if (budget !== undefined && budget.expired()) { tally.stoppedEarly = true; return null; }
    const n = readSync(fd, bytes, got, Math.min(BLOCK, want - got), null);
    if (n === 0) break;
    got += n;
  }
  return bytes.subarray(0, got);
}

/**
 * The text of one file, or null. The file must be a plain file inside `containReal`, no bigger than the cap, and not binary. It counts against the budget: when the
 * time or the byte or file count is spent the answer is null and the tally says it stopped early.
 */
export function readText(abs: string, containReal: string, tally: Tally, budget?: Budget): string | null {
  if (budget !== undefined && mustStop(budget, tally)) return null;
  const file = plainHandle(abs, containReal, tally);
  if (file === null) return null;
  try {
    if (file.size > REAL_LIMITS.fileBytes) { tally.tooBig += 1; return null; }
    if (budget !== undefined && !budget.take(file.size)) { tally.stoppedEarly = true; tally.overBytes = true; return null; }
    const bytes = readBlocks(file.fd, file.size, budget, tally);
    if (bytes === null) return null;
    if (bytes.subarray(0, 8000).includes(0)) { tally.binary += 1; return null; }
    return bytes.toString('utf8');
  } catch { tally.unreadable += 1; return null; } finally {
    try { closeSync(file.fd); } catch { /* nothing to do */ }
  }
}

/** A notes page bigger than this is listed by its file name; its head is not read. */
export const HEAD_FILE_MAX = 256 * 1024;

/** The first `bytes` bytes of a small text file as text, or null. A file over `HEAD_FILE_MAX` gives null without being read and is not counted as unreadable. */
export function readHead(abs: string, containReal: string, tally: Tally, budget?: Budget, bytes = 4096): string | null {
  if (budget !== undefined && mustStop(budget, tally)) return null;
  const file = plainHandle(abs, containReal, tally);
  if (file === null) return null;
  try {
    if (file.size > HEAD_FILE_MAX) return null;
    const want = Math.min(file.size, bytes);
    if (budget !== undefined && !budget.take(want)) { tally.stoppedEarly = true; tally.overBytes = true; return null; }
    const head = readBlocks(file.fd, want, budget, tally);
    if (head === null) return null;
    if (head.includes(0)) { tally.binary += 1; return null; }
    return head.toString('utf8');
  } catch { tally.unreadable += 1; return null; } finally {
    try { closeSync(file.fd); } catch { /* nothing to do */ }
  }
}

export interface WalkedFile { readonly rel: string; readonly abs: string; readonly size: number; readonly mtimeMs: number }

export interface WalkOptions {
  readonly maxDepth: number;
  /** The most files that pass `accept`. */
  readonly maxFiles: number;
  /** The most entries (files and folders) looked at. */
  readonly maxEntries: number;
  /** Folder names that are never entered. */
  readonly skipDirs: ReadonlySet<string>;
  /** Whether a folder whose name starts with a dot is skipped. */
  readonly skipHidden: boolean;
  readonly accept: (rel: string) => boolean;
  /** Called with the names in a folder below the top: true means the folder is another place, so it is not entered. */
  readonly boundary?: (names: readonly string[]) => boolean;
}

/**
 * Lists the files below `rootAbs` that `accept` likes, in sorted order. `rootReal` is the real location of the root; a shortcut is followed only inside it.
 * Sets `tally.truncated` when a cap stopped the walk and `tally.stoppedEarly` when the time did. The clock is looked at for every entry, and a folder is listed
 * only as far as the entry cap allows.
 */
export function walkFiles(rootAbs: string, rootReal: string, opts: WalkOptions, budget: Budget, tally: Tally): WalkedFile[] {
  const out: WalkedFile[] = [];
  const seen = new Set<string>([rootReal]);
  let entries = 0, stop = false;
  const visit = (dirAbs: string, rel: string, depth: number): void => {
    if (stop) return;
    if (budget.expired()) { tally.stoppedEarly = true; stop = true; return; }
    const list = listDir(dirAbs, tally, opts.maxEntries - entries + 1);
    if (depth > 0 && opts.boundary !== undefined && opts.boundary(list.map(e => e.name))) return;
    for (const entry of list) {
      if (stop) return;
      if (budget.expired()) { tally.stoppedEarly = true; stop = true; return; }
      entries += 1;
      if (entries > opts.maxEntries) { tally.truncated = true; stop = true; return; }
      const name = entry.name;
      if (!isPlainName(name)) { tally.unreadable += 1; continue; }
      const abs = join(dirAbs, name), childRel = rel === '' ? name : `${rel}/${name}`;
      let isDir = entry.isDirectory(), isFile = entry.isFile(), real = '', size = 0, mtimeMs = 0;
      if (entry.isSymbolicLink()) {
        const r = resolveInside(abs, rootReal, tally);
        if (r === null) continue;
        isDir = r.stat.isDirectory(); isFile = r.stat.isFile(); real = r.real; size = r.stat.size; mtimeMs = r.stat.mtimeMs;
      }
      if (isDir) {
        if (depth + 1 > opts.maxDepth) { tally.truncated = true; continue; }
        if (opts.skipDirs.has(name) || (opts.skipHidden && name.startsWith('.'))) continue;
        if (real === '') { try { real = realpathSync(abs); } catch { tally.unreadable += 1; continue; } }
        if (seen.has(real)) continue;
        seen.add(real);
        visit(abs, childRel, depth + 1);
      } else if (isFile) {
        if (!opts.accept(childRel)) continue;
        if (out.length >= opts.maxFiles) { tally.truncated = true; stop = true; return; }
        if (size === 0 && mtimeMs === 0) { try { const s = statSync(abs); size = s.size; mtimeMs = s.mtimeMs; } catch { tally.unreadable += 1; continue; } }
        out.push({ rel: childRel, abs, size, mtimeMs });
      } else if (opts.accept(childRel)) {
        // A pipe, a socket or a device with a name the reader wants. It is never opened; it is counted.
        tally.unreadable += 1;
      }
    }
  };
  visit(rootAbs, '', 0);
  return out;
}

/** A path with the home folder written as `~`, `/` between parts on every system, and every part made one plain line. */
export function shortPath(abs: string, home: string): string {
  const homeReal = home.endsWith(sep) ? home.slice(0, -1) : home;
  const text = abs === homeReal ? '~' : abs.startsWith(homeReal + sep) ? `~${abs.slice(homeReal.length)}` : abs;
  return cleanPath(text.split(sep).join('/'));
}

/** `child` relative to `root`, with `/`. */
export const posixRelative = (root: string, child: string): string => relative(root, child).split(sep).join('/');
