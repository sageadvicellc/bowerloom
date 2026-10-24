/**
 * The write boundary. The viewer writes nowhere except two kinds of place:
 *   1. its own settings and sketches, inside its own userData folder (`assertAppWritable`), and
 *   2. the sandbox, a folder made only for trying things (`assertWritable`).
 * Every write calls one of these two first. Neither can be widened by the settings file or by any message from the window: the
 * allowed roots are fixed here, in code. Widening them is a future, confirmed mechanism that does not exist yet (`widenWriteRoots`
 * refuses, and its test says so).
 */
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import type { Stats } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve, sep } from 'node:path';

export const SENTINEL_NAME = '.bowerloom-sandbox';
export const SENTINEL_TEXT = 'bowerloom viewer sandbox v1: this folder was made by the viewer, and may be deleted and rebuilt by it.\n';
/** The one sandbox: a sibling of the Sage Advice folder. The environment variable is for tests only, and is read once, here. */
export const SANDBOX_DIR: string = process.env.BOWERLOOM_VIEWER_SANDBOX ?? join(homedir(), 'Sage Advice Sandbox');

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

/** Every folder from `root` down to `target` that exists must be a real folder: a link anywhere below the root is refused. */
function noLinksBelow(root: string, target: string): void {
  const parts = target.slice(root.length).split(sep).filter(Boolean);
  let at = root;
  for (const part of parts) {
    at = join(at, part);
    const stat = lstatOrNull(at);
    if (stat === null) return;
    if (stat.isSymbolicLink()) refuse('LINK', 'A shortcut (link) is on the way, so the viewer will not write there.');
  }
}

export interface BoundaryOptions {
  /** The folders that may be written, each one a sandbox. */
  roots: readonly string[];
  /** The person's real folders: no allowed root may be, or be inside, one of them. */
  protectedPaths?: readonly string[];
  /** The home folder. Default: the real one. */
  home?: string;
}

export interface Boundary {
  readonly roots: readonly string[];
  /** Returns the real path that may be written, or throws a BoundaryError. */
  assertWritable(path: unknown): string;
  /** Checks one root alone: used before creating or deleting the sandbox. Returns its real path. */
  checkRoot(root: string): string;
}

export function createBoundary(options: BoundaryOptions): Boundary {
  const roots = Object.freeze([...options.roots]);
  const protectedPaths = options.protectedPaths ?? [];
  const home = (() => { try { return realpathSync(options.home ?? homedir()); } catch { return resolve(options.home ?? homedir()); } })();

  /** A root is safe when it is a real folder, made by the tool (its sentinel), and nowhere near the person's real work. */
  function checkRoot(root: string): string {
    const lexical = plainAbsolute(root);
    const stat = lstatOrNull(lexical);
    if (stat === null) return refuse('NO_ROOT', 'The sandbox folder is not there.');
    if (stat.isSymbolicLink() || !stat.isDirectory()) return refuse('ROOT_NOT_FOLDER', 'The sandbox must be a real folder, not a link.');
    const real = realpathSync(lexical);
    if (real === sep || real === home || inside(real, home)) return refuse('ROOT_TOO_BROAD', 'The sandbox cannot be the home folder, or a folder that holds it.');
    if (dirname(real) === real) return refuse('ROOT_TOO_BROAD', 'The sandbox cannot be the top of the disk.');
    if (!/sandbox/i.test(basename(real))) return refuse('ROOT_NAME', 'The sandbox folder must have "Sandbox" in its name.');
    for (const p of protectedPaths) {
      let protectedReal = p; try { protectedReal = realpathSync(p); } catch { /* not there */ }
      if (real === protectedReal || inside(protectedReal, real) || inside(real, protectedReal)) return refuse('ROOT_IS_REAL', 'The sandbox cannot be, hold, or sit inside one of your real folders.');
    }
    for (const marker of ['.bowerloom', 'bowerloom.json', 'bowerloom.lock.json']) if (lstatOrNull(join(real, marker)) !== null) return refuse('ROOT_IS_REAL', 'A folder that is itself a Bowerloom folder cannot be the sandbox.');
    const sentinel = lstatOrNull(join(real, SENTINEL_NAME));
    if (sentinel === null || !sentinel.isFile() || sentinel.isSymbolicLink()) return refuse('NO_SENTINEL', 'This folder does not carry the mark that the viewer made it, so it is not touched.');
    let text = ''; try { text = readFileSync(join(real, SENTINEL_NAME), 'utf8'); } catch { return refuse('NO_SENTINEL', 'The mark of the sandbox cannot be read.'); }
    if (text !== SENTINEL_TEXT) return refuse('NO_SENTINEL', 'The mark of the sandbox is not the one the viewer writes.');
    return real;
  }

  function assertWritable(path: unknown): string {
    const target = plainAbsolute(path);
    for (const root of roots) {
      let realRoot: string;
      try { realRoot = checkRoot(root); } catch (error) { if (error instanceof BoundaryError && (error.code === 'NO_ROOT' || error.code === 'NO_SENTINEL')) continue; throw error; }
      // The target may be written as the root's own folder name or as its real place: both are compared with the real root.
      const lexicalRoot = resolve(root);
      let rel: string | null = null;
      if (inside(lexicalRoot, target)) rel = target.slice(lexicalRoot.length); else if (inside(realRoot, target)) rel = target.slice(realRoot.length);
      if (rel === null) continue;
      noLinksBelow(realRoot, join(realRoot, rel));
      // The deepest folder that exists must really be inside the real root.
      let existing = join(realRoot, rel);
      while (lstatOrNull(existing) === null) { const up = dirname(existing); if (up === existing) break; existing = up; }
      const realExisting = realpathSync(existing);
      if (realExisting !== realRoot && !inside(realRoot, realExisting)) return refuse('OUTSIDE', 'That place is outside the sandbox.');
      return join(realRoot, rel);
    }
    return refuse('OUTSIDE', 'That place is outside the folders the viewer may write in.');
  }

  return Object.freeze({ roots, assertWritable, checkRoot });
}

/**
 * The boundary of the running app: the sandbox only. The person's real folders are protected by name: the Sage Advice folder
 * and whatever the app is told to read are never roots.
 */
export const boundary: Boundary = createBoundary({ roots: [SANDBOX_DIR], protectedPaths: [join(homedir(), 'Sage Advice')] });
export const assertWritable = (path: unknown): string => boundary.assertWritable(path);

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

/** Widening the places the viewer may write is a future mechanism, with its own confirmation. Today it does not exist. */
export function widenWriteRoots(): never { throw new BoundaryError('NOT_IMPLEMENTED', 'Widening the places the viewer may write is not available. A future version will ask for explicit confirmation.'); }
