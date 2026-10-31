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
import { isAbsolute, join, relative, sep } from 'node:path';
import { REAL_LIMITS, SAMPLE_CHARS, SAMPLE_LIMIT } from '../shared/real/types.js';
import type { ProblemKind } from '../shared/real/types.js';
import { cleanPath } from '../shared/real/redact.js';
import { isInside, isPlainName } from './safe.js';

/** What went wrong while reading, counted, with up to `SAMPLE_LIMIT` names for each kind. `couldNotRead` is the sum the person sees. */
export interface Tally {
  tooBig: number;
  binary: number;
  unreadable: number;
  linksOutside: number;
  /** Links that point at something that is not there (a broken link). Counted apart from `unreadable`. */
  brokenLinks: number;
  /** The first few names of each kind, as paths below the folder being read: scrubbed, one plain line, at most `SAMPLE_CHARS` characters. */
  samples: Record<ProblemKind, string[]>;
  /** The time, the bytes or the number of files ran out. */
  stoppedEarly: boolean;
  /** Part of the stop came from the byte or file count (not the clock). */
  overBytes: boolean;
  /** Something that could matter was left out: a cap (depth, files, entries) cut an allowed folder short. A folder the reader never enters on purpose does not set it. */
  truncated: boolean;
}

export const newTally = (): Tally => ({
  tooBig: 0, binary: 0, unreadable: 0, linksOutside: 0, brokenLinks: 0,
  samples: { tooBig: [], binary: [], unreadable: [], linksOutside: [], brokenLinks: [] },
  stoppedEarly: false, overBytes: false, truncated: false,
});
export const couldNotRead = (t: Tally): number => t.tooBig + t.binary + t.unreadable + t.linksOutside + t.brokenLinks;

const KINDS: readonly ProblemKind[] = ['tooBig', 'binary', 'unreadable', 'linksOutside', 'brokenLinks'];

export function addTally(into: Tally, from: Readonly<Tally>): void {
  into.tooBig += from.tooBig; into.binary += from.binary; into.unreadable += from.unreadable; into.linksOutside += from.linksOutside; into.brokenLinks += from.brokenLinks;
  for (const kind of KINDS) for (const name of from.samples[kind]) if (into.samples[kind].length < SAMPLE_LIMIT && !into.samples[kind].includes(name)) into.samples[kind].push(name);
  into.stoppedEarly ||= from.stoppedEarly; into.overBytes ||= from.overBytes; into.truncated ||= from.truncated;
}

/** The name of `abs` as a path below `base`, with `/`, scrubbed and cut. A path that is not below `base` gives its last part. */
function sampleName(base: string, abs: string): string {
  const rel = posixRelative(base, abs);
  const below = rel !== '' && rel !== '..' && !rel.startsWith('../') && !isAbsolute(rel);
  return cleanPath(below ? rel : (abs.split(sep).pop() ?? '')).slice(0, SAMPLE_CHARS);
}

/** Counts one thing of `kind` and keeps its name (a path below `base`) while fewer than `SAMPLE_LIMIT` names are kept. Nothing is read. */
export function miss(tally: Tally, kind: ProblemKind, base: string, abs: string): void {
  tally[kind] += 1;
  const names = tally.samples[kind];
  if (names.length >= SAMPLE_LIMIT) return;
  const name = sampleName(base, abs);
  if (name !== '' && !names.includes(name)) names.push(name);
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

/** Whether the error says that nothing is at the end of a path (a broken link), as against a loop, a permission or anything else. */
const isGone = (error: unknown): boolean => (error as NodeJS.ErrnoException | null)?.code === 'ENOENT';

/**
 * The real location of an entry that is a shortcut or not, or null when it leads outside `containReal`, is broken, or is a loop. A link to something that is not there is
 * counted as a broken link; the end of the link is never read, only found with `realpath`.
 */
export function resolveInside(abs: string, containReal: string, tally: Tally): Resolved | null {
  try {
    const real = realpathSync(abs);
    if (!isInside(containReal, real)) { miss(tally, 'linksOutside', containReal, abs); return null; }
    return { real, stat: statSync(real) };
  } catch (error) { miss(tally, isGone(error) && isLink(abs) ? 'brokenLinks' : 'unreadable', containReal, abs); return null; }
}

/** Whether the last part of this path is itself a link. Nothing is followed. */
function isLink(abs: string): boolean {
  try { return lstatSync(abs).isSymbolicLink(); } catch { return false; }
}

/**
 * The names in a folder, sorted. It stops listing after `limit` entries (a folder with a million files is not listed whole first), and gives an empty list (counted)
 * when the folder will not open.
 */
export function listDir(abs: string, tally: Tally, limit: number = REAL_LIMITS.discoveryEntries + 1, base?: string): Dirent[] {
  const out: Dirent[] = [];
  let dir;
  const fail = (): void => { if (base === undefined) tally.unreadable += 1; else miss(tally, 'unreadable', base, abs); };
  try { dir = opendirSync(abs); } catch { fail(); return []; }
  try {
    for (let entry = dir.readSync(); entry !== null && out.length < limit; entry = dir.readSync()) out.push(entry);
  } catch { fail(); } finally {
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
  try { real = realpathSync(abs); } catch (error) { miss(tally, isGone(error) && isLink(abs) ? 'brokenLinks' : 'unreadable', containReal, abs); return null; }
  if (!isInside(containReal, real)) { miss(tally, 'linksOutside', containReal, abs); return null; }
  let fd = -1;
  try {
    fd = openRead(real, OPEN_READ);
    const stat = fstatSync(fd);
    if (!stat.isFile()) { closeSync(fd); miss(tally, 'unreadable', containReal, abs); return null; }
    return { fd, size: stat.size };
  } catch {
    if (fd >= 0) { try { closeSync(fd); } catch { /* nothing to do */ } }
    miss(tally, 'unreadable', containReal, abs); return null;
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
    if (file.size > REAL_LIMITS.fileBytes) { miss(tally, 'tooBig', containReal, abs); return null; }
    if (budget !== undefined && !budget.take(file.size)) { tally.stoppedEarly = true; tally.overBytes = true; return null; }
    const bytes = readBlocks(file.fd, file.size, budget, tally);
    if (bytes === null) return null;
    if (bytes.subarray(0, 8000).includes(0)) { miss(tally, 'binary', containReal, abs); return null; }
    return bytes.toString('utf8');
  } catch { miss(tally, 'unreadable', containReal, abs); return null; } finally {
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
    if (head.includes(0)) { miss(tally, 'binary', containReal, abs); return null; }
    return head.toString('utf8');
  } catch { miss(tally, 'unreadable', containReal, abs); return null; } finally {
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
  /** A folder (its path below the root) that is entered although its name is in `skipDirs`. */
  readonly enter?: (rel: string) => boolean;
  /** A folder (its path below the root) that is never entered, and does not count as cut short. */
  readonly prune?: (rel: string) => boolean;
  /** Called with the names in a folder below the top: true means the folder is another place, so it is not entered. */
  readonly boundary?: (names: readonly string[]) => boolean;
  /**
   * The only folders entered at the top of the root, by lower-case name (compared without regard to case). Any other folder at the top is left out: it is not listed, and it
   * does not count as cut short. Files at the top are still tried with `accept`. Absent: every folder at the top is a candidate.
   */
  readonly rootDirs?: ReadonlySet<string>;
  /**
   * Called with the names in a folder two or more levels below the root, and its path below the root: true makes the folder a leaf. Its own files are still tried with `accept`, but its subfolders are not entered
   * and do not count as cut short (a skill folder holds the skill's own references and assets). The root and the folders at the top are never leaves.
   */
  readonly leafWhen?: (names: readonly string[], rel: string) => boolean;
  /**
   * Called with the names in each immediate subfolder of a leaf: true means that folder is a nested leaf of its own (a skill below a skill), so it is read as a leaf and its
   * own immediate subfolders are asked in turn. A subfolder that says false is left out as before, and does not count as cut short. Absent: a leaf's subfolders are all left out.
   */
  readonly nestedWhen?: (names: readonly string[]) => boolean;
}

/**
 * Lists the files below `rootAbs` that `accept` likes, in sorted order. `rootReal` is the real location of the root; a shortcut is followed only inside it.
 * Sets `tally.truncated` when a cap cut an allowed folder short (depth, files or entries) and `tally.stoppedEarly` when the time did. A folder left out on purpose (the
 * deny-list, `rootDirs`, `prune`, a hidden name, a leaf's subfolders, another place) never sets it. The clock is looked at for every entry, and a folder is listed only as far as the entry cap allows.
 */
export function walkFiles(rootAbs: string, rootReal: string, opts: WalkOptions, budget: Budget, tally: Tally): WalkedFile[] {
  const out: WalkedFile[] = [];
  const seen = new Set<string>([rootReal]);
  let entries = 0, stop = false;
  // `probe` is true for an immediate subfolder of a leaf: it is read only when `nestedWhen` says it is a leaf too, and then as one.
  const visit = (dirAbs: string, rel: string, depth: number, probe = false): void => {
    if (stop) return;
    if (budget.expired()) { tally.stoppedEarly = true; stop = true; return; }
    // A folder listed only to ask the question is not a folder the person's read depends on, so what goes wrong in it is not counted (the scratch tally is dropped).
    const list = listDir(dirAbs, probe ? newTally() : tally, opts.maxEntries - entries + 1, rootReal);
    const names = list.map(e => e.name);
    if (probe && (opts.nestedWhen === undefined || !opts.nestedWhen(names))) {
      // What was listed to ask the question counts against the entry cap.
      entries += list.length;
      if (entries > opts.maxEntries) { tally.truncated = true; stop = true; }
      return;
    }
    if (depth > 0 && opts.boundary !== undefined && opts.boundary(names)) return;
    const leaf = probe || (depth >= 2 && opts.leafWhen !== undefined && opts.leafWhen(names, rel));
    for (const entry of list) {
      if (stop) return;
      if (budget.expired()) { tally.stoppedEarly = true; stop = true; return; }
      entries += 1;
      if (entries > opts.maxEntries) { tally.truncated = true; stop = true; return; }
      const name = entry.name;
      if (!isPlainName(name)) { miss(tally, 'unreadable', rootReal, join(dirAbs, name)); continue; }
      const abs = join(dirAbs, name), childRel = rel === '' ? name : `${rel}/${name}`;
      const leftOut = depth === 0 && opts.rootDirs !== undefined && !opts.rootDirs.has(name.toLowerCase());
      let isDir = entry.isDirectory(), isFile = entry.isFile(), real = '', size = 0, mtimeMs = 0;
      if (entry.isSymbolicLink()) {
        // A link whose name could only be a folder the reader does not enter (outside `rootDirs`, below a leaf) is not resolved, so it is not counted either.
        if ((leftOut || leaf) && !opts.accept(childRel)) continue;
        const r = resolveInside(abs, rootReal, tally);
        if (r === null) continue;
        isDir = r.stat.isDirectory(); isFile = r.stat.isFile(); real = r.real; size = r.stat.size; mtimeMs = r.stat.mtimeMs;
      }
      if (isDir) {
        if (leftOut) continue;
        // A leaf's subfolders are left out, except those that `nestedWhen` calls a leaf: those only when they are a real folder here (a link below a leaf is not followed).
        if (leaf && (opts.nestedWhen === undefined || entry.isSymbolicLink())) continue;
        if (opts.prune !== undefined && opts.prune(childRel)) continue;
        if ((opts.skipDirs.has(name) && !(opts.enter !== undefined && opts.enter(childRel))) || (opts.skipHidden && name.startsWith('.'))) continue;
        if (depth + 1 > opts.maxDepth) { if (!leaf) tally.truncated = true; continue; }
        if (real === '') { try { real = realpathSync(abs); } catch { miss(tally, 'unreadable', rootReal, abs); continue; } }
        // A folder swapped for a link after the listing must not lead the walk outside the granted folder.
        if (!isInside(rootReal, real)) { miss(tally, 'linksOutside', rootReal, abs); continue; }
        if (seen.has(real)) continue;
        seen.add(real);
        visit(abs, childRel, depth + 1, leaf);
      } else if (isFile) {
        if (!opts.accept(childRel)) continue;
        if (out.length >= opts.maxFiles) { tally.truncated = true; stop = true; return; }
        if (size === 0 && mtimeMs === 0) { try { const s = statSync(abs); size = s.size; mtimeMs = s.mtimeMs; } catch { miss(tally, 'unreadable', rootReal, abs); continue; } }
        out.push({ rel: childRel, abs, size, mtimeMs });
      } else if (opts.accept(childRel)) {
        // A pipe, a socket or a device with a name the reader wants. It is never opened; it is counted.
        miss(tally, 'unreadable', rootReal, abs);
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
