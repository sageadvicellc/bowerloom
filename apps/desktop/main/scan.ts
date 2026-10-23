/**
 * Finds projects by looking inside the folders the person chose. Bounded: depth, entries, and results are capped, hidden
 * folders and node_modules are skipped, and a link is never followed.
 */
import { lstatSync, readdirSync } from 'node:fs';
import type { Dirent } from 'node:fs';
import { join } from 'node:path';
import type { ScanInfo } from '../shared/types.js';
import { isInside, realRoot } from './safe.js';

export const SCAN_LIMITS = Object.freeze({ depth: 4, results: 100, entries: 20000 });
const MARKERS = ['bowerloom.json', 'bowerloom.lock.json'];

export interface ScanResult { dirs: string[]; info: ScanInfo }
export interface ScanOptions { depth?: number; results?: number; entries?: number }

function isProject(dir: string): boolean {
  for (const marker of MARKERS) { try { if (lstatSync(join(dir, marker)).isFile()) return true; } catch { /* not there */ } }
  try { if (lstatSync(join(dir, '.bowerloom')).isDirectory()) return true; } catch { /* not there */ }
  return false;
}

export function scanRoots(roots: readonly string[], options: ScanOptions = {}): ScanResult {
  const maxDepth = options.depth ?? SCAN_LIMITS.depth, maxResults = options.results ?? SCAN_LIMITS.results, maxEntries = options.entries ?? SCAN_LIMITS.entries;
  const dirs: string[] = [], skipped: { path: string; reason: string }[] = [], infoRoots: ScanInfo['roots'] = [];
  const seen = new Set<string>();
  let entries = 0, truncated = false;
  for (const root of roots) {
    let stat; try { stat = lstatSync(root); } catch { infoRoots.push({ path: root, ok: false, reason: 'This folder is not there any more.' }); continue; }
    if (stat.isSymbolicLink()) { infoRoots.push({ path: root, ok: false, reason: 'This folder is a shortcut (a link). The viewer does not follow shortcuts.' }); continue; }
    if (!stat.isDirectory()) { infoRoots.push({ path: root, ok: false, reason: 'This is not a folder.' }); continue; }
    const real = realRoot(root);
    if (real === null) { infoRoots.push({ path: root, ok: false, reason: 'This folder cannot be opened.' }); continue; }
    infoRoots.push({ path: root, ok: true, reason: null });
    const visit = (dir: string, depth: number): void => {
      if (truncated) return;
      if (!isInside(real, dir)) return;
      if (isProject(dir)) {
        if (dirs.length >= maxResults) { truncated = true; return; }
        if (!seen.has(dir)) { seen.add(dir); dirs.push(dir); }
        return;
      }
      if (depth >= maxDepth) return;
      let list: Dirent[];
      try { list = readdirSync(dir, { withFileTypes: true }); } catch { skipped.push({ path: dir, reason: 'cannot be opened' }); return; }
      list.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
      for (const entry of list) {
        if (++entries > maxEntries) { truncated = true; return; }
        if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
        if (entry.isSymbolicLink()) { skipped.push({ path: join(dir, entry.name), reason: 'is a link, so it is not followed' }); continue; }
        if (!entry.isDirectory()) continue;
        visit(join(dir, entry.name), depth + 1);
      }
    };
    visit(real, 0);
  }
  return { dirs, info: { roots: infoRoots, skipped: skipped.slice(0, 50), truncated, found: dirs.length } };
}
