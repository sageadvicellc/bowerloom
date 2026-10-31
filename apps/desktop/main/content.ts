/** Reads what is inside an item (its files) as plain text, with the guarded readers. Never follows a link. */
import { lstatSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { readGuarded, LIMITS } from '../../../packages/project-authoring/src/files.js';
import { projectTarget, readManifestState, storeTarget } from '../../../packages/skill-manifest/src/add.js';
import { parseManifest } from '../../../packages/skill-manifest/src/schema.js';
import { safeText, safeLine } from '../shared/text.js';
import type { FileView, ItemContent, ItemKind } from '../shared/types.js';
import { isId, resolveInside } from './safe.js';

export const CONTENT_LIMITS = Object.freeze({ files: 120, depth: 6, fileBytes: LIMITS.fileBytes });

function readOne(base: string, path: string): FileView {
  const rel = relative(base, path).split(sep).join('/');
  try {
    const bytes = readGuarded(path, CONTENT_LIMITS.fileBytes);
    if (bytes.includes(0)) return { path: rel, text: null, note: 'This file is not plain text, so it is not shown.', bytes: bytes.length };
    let text: string;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { return { path: rel, text: null, note: 'This file is not plain text, so it is not shown.', bytes: bytes.length }; }
    return { path: rel, text: safeText(text), note: null, bytes: bytes.length };
  } catch {
    return { path: rel, text: null, note: 'This file is not shown. It is a link, too large, or other people can change it.', bytes: 0 };
  }
}

function walk(base: string, dir: string, depth: number, out: FileView[]): void {
  if (depth > CONTENT_LIMITS.depth) return;
  let names: string[];
  try { names = readdirSync(dir).sort((a, b) => (a === 'SKILL.md' ? -1 : b === 'SKILL.md' ? 1 : a < b ? -1 : a > b ? 1 : 0)); } catch { return; }
  for (const name of names) {
    if (out.length >= CONTENT_LIMITS.files) return;
    const path = join(dir, name);
    let stat; try { stat = lstatSync(path); } catch { continue; }
    if (stat.isSymbolicLink()) { out.push({ path: safeLine(relative(base, path).split(sep).join('/')), text: null, note: 'This is a link, which the viewer does not follow.', bytes: 0 }); continue; }
    if (stat.isDirectory()) walk(base, path, depth + 1, out);
    else if (stat.isFile()) out.push(readOne(base, path));
  }
}

function tree(root: string, folder: string, rel: string): FileView[] {
  const dir = resolveInside([root], join(root, rel, folder));
  const out: FileView[] = [];
  walk(dir, dir, 0, out);
  return out;
}

/**
 * `rootDir` is the store folder (`where` is `store`) or the project folder (`where` is `project`). The item is looked for
 * under the store, or under the project's `.bowerloom`.
 */
export function readItemContent(rootDir: string, where: 'store' | 'project', kind: ItemKind, id: string): ItemContent {
  if (!isId(id)) return { kind, id: safeLine(String(id)), where, files: [], pinned: null, note: 'That is not a valid name.' };
  try {
    const real = resolveInside([rootDir], rootDir);
    const root = where === 'store' ? real : resolveInside([real], join(real, '.bowerloom'));
    if (kind === 'prompt') {
      const file = resolveInside([root], join(root, 'prompts', `${id}.md`));
      return { kind, id, where, files: [readOne(root, file)], pinned: null, note: null };
    }
    if (kind === 'team') return { kind, id, where, files: tree(root, id, 'teams'), pinned: null, note: null };
    // A skill: a folder of yours, or a pinned copy that lives in the cache and is described by skills.json.
    try { return { kind, id, where, files: tree(root, id, 'skills'), pinned: null, note: null }; } catch { /* maybe a pinned skill */ }
    const target = where === 'store' ? storeTarget(real) : projectTarget(real);
    const state = readManifestState(target, { allowAbsent: true });
    const entry = state.file === null ? undefined : parseManifest(state.file.bytes, target.limits).skills.find(e => e.id === id);
    if (entry === undefined || !('files' in entry)) return { kind, id, where, files: [], pinned: null, note: 'The folder for this item is not there.' };
    const lines: string[] = entry.source.kind === 'npm'
      ? [`Comes from npm: ${entry.source.package}`, `Version: ${entry.source.version}`, `Published by: ${entry.source.publisher}`]
      : [`Comes from GitHub: ${(entry.source as { repository: string }).repository}`, `Commit: ${(entry.source as { commit: string }).commit}`];
    lines.push(`Licence: ${entry.license.spdx}`, `Files in this copy: ${entry.files.map(f => f.path).join(', ')}`);
    return { kind, id, where, files: [], pinned: { lines: lines.map(safeLine) }, note: 'This copy is fixed to one exact version. Its files are saved on this computer only after a sync, so they are listed here and not shown.' };
  } catch {
    return { kind, id, where, files: [], pinned: null, note: 'The contents of this item could not be read.' };
  }
}
