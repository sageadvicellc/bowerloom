/**
 * The write boundary. The viewer writes only inside its own userData folder: its settings, the copy of the sample, and its sketches
 * (`assertAppWritable`). Every write calls it first. It cannot be widened by the settings file or by any message from the window: the
 * allowed folder is fixed in code.
 */
import { lstatSync } from 'node:fs';
import type { Stats } from 'node:fs';
import { isAbsolute, join, resolve, sep } from 'node:path';

export class BoundaryError extends Error {
  readonly code: string;
  constructor(code: string, message: string) { super(message); this.code = code; this.name = 'BoundaryError'; }
}
const refuse = (code: string, message: string): never => { throw new BoundaryError(code, message); };

const inside = (parent: string, child: string): boolean => child.startsWith(parent.endsWith(sep) ? parent : parent + sep);

/** Refuses a path written with `..` (also when encoded), a NUL, a relative path, or an odd type. */
function plainAbsolute(path: unknown): string {
  if (typeof path !== 'string' || path.length === 0 || path.length > 4096) return refuse('BAD_PATH', 'That is not a path.');
  if (!isAbsolute(path) || path.includes('\0')) return refuse('BAD_PATH', 'That is not a full path.');
  const variants = [path];
  for (let i = 0; i < 3; i++) { try { const next = decodeURIComponent(variants[variants.length - 1]!); if (next === variants[variants.length - 1]) break; variants.push(next); } catch { return refuse('BAD_PATH', 'That path is written in a way the viewer refuses.'); } }
  for (const v of variants) if (v.split(/[\\/]/).some(part => part === '..') || v.includes('\0')) return refuse('TRAVERSAL', 'A path with ".." is refused.');
  return resolve(path);
}

function lstatOrNull(path: string): Stats | null {
  try { return lstatSync(path) as Stats; } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT' || (error as NodeJS.ErrnoException).code === 'ENOTDIR') return null; throw error; }
}

/**
 * Every folder from `root` down to `target` that exists must be a real folder on the same disk as the root: a link anywhere below
 * the root is refused, and so is a folder that is another disk mounted inside it (a mount point).
 */
function noLinksBelow(root: string, target: string): void {
  const parts = target.slice(root.length).split(sep).filter(Boolean);
  const rootDev = lstatOrNull(root)?.dev;
  let at = root;
  for (const part of parts) {
    at = join(at, part);
    const stat = lstatOrNull(at);
    if (stat === null) return;
    if (stat.isSymbolicLink()) refuse('LINK', 'A shortcut (link) is on the way, so the viewer will not write there.');
    if (rootDev !== undefined && stat.dev !== rootDev) refuse('MOUNT', 'Another disk is attached inside the viewer\'s own folder, so the viewer will not write there.');
  }
}

/**
 * The viewer's own settings and sketches live in its userData folder. A write there must be a plain file or folder directly inside
 * it: no `..`, no link anywhere below it, nothing outside it.
 */
export function assertAppWritable(userData: string, path: unknown): string {
  const root = plainAbsolute(userData), target = plainAbsolute(path);
  if (!inside(root, target)) return refuse('OUTSIDE', 'That place is outside the viewer\'s own folder.');
  const stat = lstatOrNull(root);
  if (stat !== null && (stat.isSymbolicLink() || !stat.isDirectory())) return refuse('LINK', 'The viewer\'s own folder is a link or not a folder.');
  noLinksBelow(root, target);
  return target;
}
