/**
 * Finds projects by looking inside the folders the person chose. Bounded: depth, entries, and results are capped, hidden
 * folders and node_modules are skipped, example and test folders are skipped unless asked for, and a link to a folder is never
 * followed. A project is also searched inside, because projects can sit inside projects (a team's layers are often nested).
 */
import { lstatSync, readdirSync, statSync } from 'node:fs';
import type { Dirent } from 'node:fs';
import { basename, join, relative } from 'node:path';
import type { ScanInfo } from '../shared/types.js';
import { isInside, realRoot } from './safe.js';

export const SCAN_LIMITS = Object.freeze({ depth: 4, results: 100, entries: 20000 });
/** Folders that hold examples and test data, not a person's own work. Searched only when the person asks. */
export const EXAMPLE_NAMES: ReadonlySet<string> = new Set(['examples', 'fixtures', '__fixtures__', 'test', 'tests']);
const MARKERS = ['bowerloom.json', 'bowerloom.lock.json'];
const NAME_LIMIT = 8;

export interface ScanResult { dirs: string[]; info: ScanInfo }
export interface ScanOptions { depth?: number; results?: number; entries?: number; includeExamples?: boolean }

export function isProject(dir: string): boolean {
  for (const marker of MARKERS) { try { if (lstatSync(join(dir, marker)).isFile()) return true; } catch { /* not there */ } }
  try { if (lstatSync(join(dir, '.bowerloom')).isDirectory()) return true; } catch { /* not there */ }
  return false;
}

/** True when `dir` is a link whose target is a folder. A link to a file (a linked CLAUDE.md) is not one. */
function isFolderLink(dir: string, entry: Dirent): boolean {
  if (!entry.isSymbolicLink()) return false;
  try { return statSync(join(dir, entry.name)).isDirectory(); } catch { return false; }
}

/** Does a folder that was skipped hold a project near its top? A small, bounded look, only to say that something was left out. */
function holdsProject(dir: string, levels: number, budget: { n: number }): boolean {
  if (levels < 0 || budget.n <= 0) return false;
  if (isProject(dir)) return true;
  let list: Dirent[];
  try { list = readdirSync(dir, { withFileTypes: true }); } catch { return false; }
  for (const e of list) {
    if (--budget.n <= 0) return false;
    if (e.name.startsWith('.') || e.name === 'node_modules' || !e.isDirectory()) continue;
    if (holdsProject(join(dir, e.name), levels - 1, budget)) return true;
  }
  return false;
}

export function scanRoots(roots: readonly string[], options: ScanOptions = {}): ScanResult {
  const maxDepth = options.depth ?? SCAN_LIMITS.depth, maxResults = options.results ?? SCAN_LIMITS.results, maxEntries = options.entries ?? SCAN_LIMITS.entries;
  const dirs: string[] = [], skipped: { path: string; reason: string }[] = [], infoRoots: ScanInfo['roots'] = [];
  const seen = new Set<string>(), linkedFolders: string[] = [], depthFolders: string[] = [], exampleFolders: string[] = [];
  let entries = 0, truncated = false, depthReached = false, unopened = 0, linksTotal = 0;
  for (const root of roots) {
    let stat; try { stat = lstatSync(root); } catch { infoRoots.push({ path: root, ok: false, reason: 'This folder is not there any more.' }); continue; }
    if (stat.isSymbolicLink()) { infoRoots.push({ path: root, ok: false, reason: 'This folder is a shortcut (a link). The viewer does not follow shortcuts.' }); continue; }
    if (!stat.isDirectory()) { infoRoots.push({ path: root, ok: false, reason: 'This is not a folder.' }); continue; }
    const real = realRoot(root);
    if (real === null) { infoRoots.push({ path: root, ok: false, reason: 'This folder cannot be opened.' }); continue; }
    infoRoots.push({ path: root, ok: true, reason: null });
    const visit = (dir: string, depth: number): void => {
      if (truncated || !isInside(real, dir)) return;
      if (isProject(dir) && !seen.has(dir)) {
        if (dirs.length >= maxResults) { truncated = true; return; }
        seen.add(dir); dirs.push(dir);
      }
      let list: Dirent[];
      try { list = readdirSync(dir, { withFileTypes: true }); } catch { unopened++; skipped.push({ path: dir, reason: 'cannot be opened' }); return; }
      if (depth >= maxDepth) {
        if (list.some(e => !e.name.startsWith('.') && e.name !== 'node_modules' && !e.isSymbolicLink() && e.isDirectory())) { depthReached = true; if (depthFolders.length < NAME_LIMIT) depthFolders.push(relative(real, dir) || basename(real)); }
        return;
      }
      list.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
      for (const entry of list) {
        if (++entries > maxEntries) { truncated = true; return; }
        if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
        if (isFolderLink(dir, entry)) { linksTotal++; if (linkedFolders.length < NAME_LIMIT) linkedFolders.push(entry.name); skipped.push({ path: join(dir, entry.name), reason: 'is a link to a folder, so it is not followed' }); continue; }
        if (entry.isSymbolicLink() || !entry.isDirectory()) continue;
        if (EXAMPLE_NAMES.has(entry.name) && options.includeExamples !== true) {
          if (holdsProject(join(dir, entry.name), 3, { n: 2000 })) exampleFolders.push(relative(real, join(dir, entry.name)));
          continue;
        }
        visit(join(dir, entry.name), depth + 1);
      }
    };
    visit(real, 0);
  }
  return {
    dirs,
    info: { roots: infoRoots, skipped: skipped.slice(0, 50), truncated, found: dirs.length, depthReached, skippedMore: skipped.length > 50, depthLimit: maxDepth,
      linkedFolders, linkedFoldersTotal: linksTotal, depthFolders, unopenedFolders: unopened, exampleFolders: exampleFolders.slice(0, NAME_LIMIT), exampleFoldersTotal: exampleFolders.length },
  };
}
