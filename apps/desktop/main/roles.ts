/**
 * What kind of folder a Bowerloom folder is. The guess is cheap and bounded, and the person's own choice always wins.
 *   context-store  the central knowledge: a folder named knowledge-base, a wiki (a wiki/ or raw/ folder of markdown with [[links]]),
 *                  or a knowledge folder that is registered with Bowerloom.
 *   workspace      a folder that holds other Bowerloom folders (the layers).
 *   project        everything else.
 */
import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join, sep } from 'node:path';
import type { FolderRole } from '../shared/types.js';

export const PAGE_LIMITS = Object.freeze({ files: 5000, depth: 6, fileBytes: 256 * 1024 });
const WIKILINK = /\[\[[^\]\n]{1,200}\]\]/;

const isDir = (path: string): boolean => { try { const s = lstatSync(path); return s.isDirectory() && !s.isSymbolicLink(); } catch { return false; } };

/** Markdown pages under a folder: bounded, no links followed, no hidden folders, no node_modules. Capped at PAGE_LIMITS.files. */
export function markdownFiles(dir: string, limit: number = PAGE_LIMITS.files): { files: string[]; capped: boolean } {
  const files: string[] = []; let capped = false;
  const walk = (at: string, depth: number): void => {
    if (capped || depth > PAGE_LIMITS.depth) return;
    let entries; try { entries = readdirSync(at, { withFileTypes: true }); } catch { return; }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const e of entries) {
      if (e.name.startsWith('.') || e.name === 'node_modules' || e.isSymbolicLink()) continue;
      if (e.isDirectory()) walk(join(at, e.name), depth + 1);
      else if (e.isFile() && /\.md$/i.test(e.name)) { if (files.length >= limit) { capped = true; return; } files.push(join(at, e.name)); }
    }
  };
  walk(dir, 0);
  return { files, capped };
}

/** A wiki: a `wiki` or `raw` folder that holds markdown, with at least one [[wikilink]] in a few of its pages. */
export function looksLikeWiki(dir: string): boolean {
  for (const name of ['wiki', 'raw']) {
    const sub = join(dir, name);
    if (!isDir(sub)) continue;
    const { files } = markdownFiles(sub, 40);
    for (const f of files) {
      try { if (lstatSync(f).size <= PAGE_LIMITS.fileBytes && WIKILINK.test(readFileSync(f, 'utf8'))) return true; } catch { /* next */ }
    }
  }
  return false;
}

const inside = (parent: string, child: string): boolean => child === parent || child.startsWith(parent.endsWith(sep) ? parent : parent + sep);

export interface RoleInput { dir: string; allDirs: readonly string[]; registeredDirs: readonly string[] }

export function guessRole({ dir, allDirs, registeredDirs }: RoleInput): FolderRole {
  if (basename(dir) === 'knowledge-base' || looksLikeWiki(dir) || registeredDirs.some(r => inside(r, dir))) return 'context-store';
  if (allDirs.some(other => other !== dir && inside(dir, other))) return 'workspace';
  return 'project';
}

/** How many pages a context store holds (capped). */
export function pageCount(dir: string): number { return markdownFiles(dir).files.length; }
