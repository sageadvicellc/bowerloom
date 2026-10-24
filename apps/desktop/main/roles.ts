/**
 * What kind of folder a Bowerloom folder is. The guess is cheap, bounded and cautious, and the person's own choice always wins.
 *   context-store  the central knowledge: a folder that looks like a wiki (an index or overview page, several pages that link to each
 *                  other, and mostly markdown), or a knowledge folder that is registered with Bowerloom. A folder that is only
 *                  named knowledge-base is not enough: the name alone is never a reason.
 *   workspace      a folder that holds other Bowerloom folders (the layers).
 *   project        everything else.
 * All reads are asynchronous and bounded, so a large folder never stops the window.
 */
import { lstat, open, readdir } from 'node:fs/promises';
import { basename, join, relative, sep } from 'node:path';
import type { FolderRole } from '../shared/types.js';

export const PAGE_LIMITS = Object.freeze({ files: 5000, depth: 6, fileBytes: 256 * 1024 });
/** What "looks like a wiki" needs. Every number is a bound as well as a rule. */
export const WIKI_RULES = Object.freeze({ minPages: 8, minLinked: 3, sample: 120, walk: 600, entries: 3000, readBytes: 64 * 1024, indexDepth: 2, markdownShare: 0.5 });
const INDEX_NAMES = new Set(['index.md', 'overview.md', 'home.md', '_index.md', 'hub.md']);
const LINK = /\[\[[^\]\n]{1,200}\]\]|\]\((?!https?:|mailto:|#)[^)\s]{1,300}\.md[^)]{0,100}\)/;

interface Walk { md: string[]; others: number; capped: boolean }

/** A bounded walk: no links followed, no hidden folders, no node_modules. `entries` bounds how many names are looked at in all. */
async function walk(dir: string, limit: number, entries: number): Promise<Walk> {
  const out: Walk = { md: [], others: 0, capped: false };
  let looked = 0;
  const visit = async (at: string, depth: number): Promise<void> => {
    if (out.capped || depth > PAGE_LIMITS.depth) return;
    let list; try { list = await readdir(at, { withFileTypes: true }); } catch { return; }
    list.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const e of list) {
      if (out.capped) return;
      if (e.name.startsWith('.') || e.name === 'node_modules' || e.isSymbolicLink()) continue;
      if (++looked > entries) { out.capped = true; return; }
      if (e.isDirectory()) await visit(join(at, e.name), depth + 1);
      else if (e.isFile()) {
        if (/\.md$/i.test(e.name)) { if (out.md.length >= limit) { out.capped = true; return; } out.md.push(join(at, e.name)); } else out.others++;
      }
    }
  };
  await visit(dir, 0);
  return out;
}

/** Markdown pages under a folder: bounded, no links followed, no hidden folders, no node_modules. Capped at `limit`. */
export async function markdownFiles(dir: string, limit: number = PAGE_LIMITS.files): Promise<{ files: string[]; capped: boolean }> {
  const w = await walk(dir, limit, Number.MAX_SAFE_INTEGER);
  return { files: w.md, capped: w.capped };
}

async function hasLink(file: string): Promise<boolean> {
  let handle; try { handle = await open(file, 'r'); } catch { return false; }
  try {
    const stat = await handle.stat(); if (!stat.isFile()) return false;
    const buffer = Buffer.alloc(Math.min(stat.size, WIKI_RULES.readBytes)), { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    return LINK.test(buffer.subarray(0, bytesRead).toString('utf8'));
  } catch { return false; } finally { await handle.close(); }
}

/**
 * A wiki: mostly markdown, with an index or overview page near the top, at least a few pages, and several pages that link to others.
 * Beyond WIKI_RULES.sample pages, an evenly spread sample is read, so the first pages in name order do not decide for the rest.
 */
export async function looksLikeWiki(dir: string): Promise<boolean> {
  const w = await walk(dir, WIKI_RULES.walk, WIKI_RULES.entries);
  if (w.md.length < WIKI_RULES.minPages) return false;
  if (w.md.length / (w.md.length + w.others) < WIKI_RULES.markdownShare) return false;
  const near = (f: string): boolean => relative(dir, f).split(sep).length <= WIKI_RULES.indexDepth + 1;
  if (!w.md.some(f => near(f) && INDEX_NAMES.has(basename(f).toLowerCase()))) return false;
  const step = Math.max(1, Math.floor(w.md.length / WIKI_RULES.sample)), picked = w.md.filter((_, i) => i % step === 0).slice(0, WIKI_RULES.sample);
  let linked = 0;
  for (const f of picked) { if (await hasLink(f)) linked++; if (linked >= WIKI_RULES.minLinked) return true; }
  return false;
}

const inside = (parent: string, child: string): boolean => child === parent || child.startsWith(parent.endsWith(sep) ? parent : parent + sep);
export interface RoleInput { dir: string; allDirs: readonly string[]; registeredDirs: readonly string[] }

/** The guess. A registered knowledge folder is a store because the person registered it. A wiki is a store. A name is not. */
export async function guessRole({ dir, allDirs, registeredDirs }: RoleInput): Promise<FolderRole> {
  if (registeredDirs.some(r => inside(r, dir))) return 'context-store';
  // A folder that holds other Bowerloom folders is a workspace, even if the folders inside it hold a wiki.
  if (allDirs.some(other => other !== dir && inside(dir, other))) return 'workspace';
  return await looksLikeWiki(dir) ? 'context-store' : 'project';
}

/** How many pages a context store holds (capped). */
export async function pageCount(dir: string): Promise<number> { return (await markdownFiles(dir)).files.length; }

export const isDirectory = async (path: string): Promise<boolean> => { try { const s = await lstat(path); return s.isDirectory() && !s.isSymbolicLink(); } catch { return false; } };
