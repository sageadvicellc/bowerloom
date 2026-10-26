/**
 * The only file reads of the real-setup reader. It lists folders, looks at what a name is, and reads text. It has no call that changes anything: the imports of
 * `node:fs` below are the whole list, and tests/real-static.test.ts holds this file (and its neighbours) to that list.
 *
 * Rules every walk obeys: the depth, the number of files and the time are capped; a shortcut (a symbolic link) is followed only when what it points at is still inside the
 * folder being read; a folder that was already visited is not entered twice; a name with a control character is skipped; a file over the size cap, a binary file and
 * a file or folder that will not open are counted and skipped. Nothing here throws for a bad folder.
 */
import { lstatSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import type { Dirent, Stats } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { REAL_LIMITS } from '../shared/real/types.js';
import { isInside, isPlainName } from './safe.js';

/** What went wrong while reading, counted. `couldNotRead` is the sum the person sees. */
export interface Tally {
  tooBig: number;
  binary: number;
  unreadable: number;
  linksOutside: number;
  stoppedEarly: boolean;
  truncated: boolean;
}

export const newTally = (): Tally => ({ tooBig: 0, binary: 0, unreadable: 0, linksOutside: 0, stoppedEarly: false, truncated: false });
export const couldNotRead = (t: Tally): number => t.tooBig + t.binary + t.unreadable + t.linksOutside;

export function addTally(into: Tally, from: Tally): void {
  into.tooBig += from.tooBig; into.binary += from.binary; into.unreadable += from.unreadable; into.linksOutside += from.linksOutside;
  into.stoppedEarly ||= from.stoppedEarly; into.truncated ||= from.truncated;
}

/** A clock that tells when the time budget of one call is spent. `now` is injected so a test can spend it. */
export interface Budget { expired(): boolean }
export function makeBudget(now: () => number, ms: number = REAL_LIMITS.budgetMs): Budget {
  const end = now() + ms;
  return { expired: () => now() >= end };
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

/** The names in a folder, sorted, or an empty list (counted) when it will not open. */
export function listDir(abs: string, tally: Tally): Dirent[] {
  try { return readdirSync(abs, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)); } catch { tally.unreadable += 1; return []; }
}

/** The names in a folder, or an empty list, with no counting: used to look for a marker. */
export function peekNames(abs: string): string[] {
  try { return readdirSync(abs); } catch { return []; }
}

/** Whether a path is a real folder (not a shortcut), and its real location. */
export function realFolder(abs: string): string | null {
  try { const s = lstatSync(abs); if (s.isSymbolicLink() || !s.isDirectory()) return null; return realpathSync(abs); } catch { return null; }
}

/** The real location of a folder that may itself be a shortcut (a tool folder the person keeps elsewhere), or null. */
export function realFolderFollowing(abs: string): string | null {
  try { const real = realpathSync(abs); return statSync(real).isDirectory() ? real : null; } catch { return null; }
}

/** The text of one file, or null. The file must be a regular file inside `containReal` after any shortcut, no bigger than the cap, and not binary. */
export function readText(abs: string, containReal: string, tally: Tally): string | null {
  try {
    const link = lstatSync(abs);
    let real = abs, stat = link;
    if (link.isSymbolicLink()) { const r = resolveInside(abs, containReal, tally); if (r === null) return null; real = r.real; stat = r.stat; }
    if (!stat.isFile()) { tally.unreadable += 1; return null; }
    if (stat.size > REAL_LIMITS.fileBytes) { tally.tooBig += 1; return null; }
    const bytes = readFileSync(real);
    if (bytes.length > REAL_LIMITS.fileBytes) { tally.tooBig += 1; return null; }
    if (bytes.subarray(0, 8000).includes(0)) { tally.binary += 1; return null; }
    return bytes.toString('utf8');
  } catch { tally.unreadable += 1; return null; }
}

/** A notes page bigger than this is listed by its file name; its head is not read. */
export const HEAD_FILE_MAX = 256 * 1024;

/** The first `bytes` characters of a small text file, or null. A file over `HEAD_FILE_MAX` gives null without being opened and is not counted as unreadable. */
export function readHead(abs: string, containReal: string, tally: Tally, bytes = 4096): string | null {
  try {
    const stat = lstatSync(abs);
    if (stat.isFile() && stat.size > HEAD_FILE_MAX) return null;
  } catch { /* readText counts it */ }
  const text = readText(abs, containReal, tally);
  return text === null ? null : text.slice(0, bytes);
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
 * Sets `tally.truncated` when a cap stopped the walk and `tally.stoppedEarly` when the time did.
 */
export function walkFiles(rootAbs: string, rootReal: string, opts: WalkOptions, budget: Budget, tally: Tally): WalkedFile[] {
  const out: WalkedFile[] = [];
  const seen = new Set<string>([rootReal]);
  let entries = 0, stop = false;
  const visit = (dirAbs: string, rel: string, depth: number): void => {
    if (stop) return;
    if (budget.expired()) { tally.stoppedEarly = true; stop = true; return; }
    const list = listDir(dirAbs, tally);
    if (depth > 0 && opts.boundary !== undefined && opts.boundary(list.map(e => e.name))) return;
    for (const entry of list) {
      if (stop) return;
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
      }
    }
  };
  visit(rootAbs, '', 0);
  return out;
}

/** A path with the home folder written as `~`, and `/` between parts on every system. */
export function shortPath(abs: string, home: string): string {
  const homeReal = home.endsWith(sep) ? home.slice(0, -1) : home;
  const text = abs === homeReal ? '~' : abs.startsWith(homeReal + sep) ? `~${abs.slice(homeReal.length)}` : abs;
  return text.split(sep).join('/');
}

/** `child` relative to `root`, with `/`. */
export const posixRelative = (root: string, child: string): string => relative(root, child).split(sep).join('/');
