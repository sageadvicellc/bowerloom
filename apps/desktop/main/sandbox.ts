/**
 * The sandbox: a folder made only for trying things, beside the real Sage Advice folder. It holds invented content and its own pretend
 * home folder (with its own shared library), so a test never touches a real one. This module makes the folder, checks it, and deletes it
 * for a reset. A reset deletes nothing unless the folder is exactly the sandbox constant, carries the viewer's mark, and has no
 * shortcut that leads outside it. Every write is checked by the write boundary first.
 */
import { closeSync, constants, lstatSync, mkdirSync, openSync, readdirSync, realpathSync, rmSync, unlinkSync, writeSync } from 'node:fs';
import type { Stats } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { BoundaryError, SANDBOX_DIR, SANDBOX_NAME, SANDBOX_OVERRIDDEN, SENTINEL_NAME, SENTINEL_TEXT, assertWritable, boundary, createBoundary } from './boundary.js';
import type { Boundary } from './boundary.js';

/** Where things are inside the sandbox. The pretend home holds the shared library and the workspace. */
export function sandboxPaths(root: string = SANDBOX_DIR): { root: string; home: string; workspace: string; state: string } {
  return { root, home: join(root, 'home'), workspace: join(root, 'home', 'workspace'), state: join(root, 'state') };
}

export const sandboxExists = (root: string = SANDBOX_DIR): boolean => {
  try { const s = lstatSync(join(root, SENTINEL_NAME)); return s.isFile() && !s.isSymbolicLink(); } catch { return false; }
};

export interface Unsafe { path: string; why: 'link' | 'hardlink' | 'mount' }

/**
 * Looks through the sandbox for anything that could make a delete or a write reach outside it. Returns the first such thing, or null.
 *   link      a shortcut that leads outside the sandbox
 *   hardlink  a file with more than one name (another name may be anywhere, so deleting or overwriting it could touch that place)
 *   mount     a folder that is another disk attached inside the sandbox
 * `statOf` is for tests.
 */
export function unsafeEntry(root: string, statOf: (path: string) => Stats = lstatSync): Unsafe | null {
  const real = realpathSync(root), rootDev = statOf(real).dev;
  const walk = (dir: string): Unsafe | null => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name), stat = statOf(path);
      if (entry.isSymbolicLink()) {
        let target: string; try { target = realpathSync(path); } catch { return { path, why: 'link' }; }
        if (target !== real && !target.startsWith(real + sep)) return { path, why: 'link' };
      } else if (entry.isDirectory()) { if (stat.dev !== rootDev) return { path, why: 'mount' }; const found = walk(path); if (found !== null) return found; }
      else if (entry.isFile() && stat.nlink > 1) return { path, why: 'hardlink' };
    }
    return null;
  };
  return walk(real);
}

/** Every link inside the sandbox must stay inside it. Returns the first one that leaves, or null. */
export function escapingLink(root: string): string | null { const u = unsafeEntry(root); return u !== null && u.why === 'link' ? u.path : null; }

export interface SandboxOptions {
  root?: string; expected?: string; boundary?: Boundary;
  /** True when the sandbox folder was chosen by the environment (tests, running from source). Default: how this run started. */
  override?: boolean;
  /** The real home folder. Default: the real one. */
  home?: string;
}

/** Makes the sandbox folder and its mark if they are not there. Refuses any folder that is not the sandbox constant. */
export function ensureSandbox(options: SandboxOptions = {}): string {
  const root = resolve(options.root ?? SANDBOX_DIR), expected = resolve(options.expected ?? SANDBOX_DIR);
  if (root !== expected) throw new BoundaryError('NOT_THE_SANDBOX', 'That is not the sandbox folder, so nothing was made.');
  if (!/sandbox/i.test(basename(root))) throw new BoundaryError('ROOT_NAME', 'The sandbox folder must have "Sandbox" in its name.');
  const stat = (() => { try { return lstatSync(root); } catch { return null; } })();
  if (stat !== null && (stat.isSymbolicLink() || !stat.isDirectory())) throw new BoundaryError('ROOT_NOT_FOLDER', 'The sandbox must be a real folder, not a link.');
  if (stat === null) mkdirSync(root, { mode: 0o755 });
  else if (!sandboxExists(root) && readdirSync(root).length > 0) throw new BoundaryError('NO_SENTINEL', 'A folder with this name is already there, and it is not the viewer\'s. It was left alone.');
  if (!sandboxExists(root)) createFile(join(root, SENTINEL_NAME), SENTINEL_TEXT, 0o644);
  return (options.boundary ?? boundary).checkRoot(root);
}

/**
 * Deletes everything inside the sandbox, and the folder itself, for a reset. Refuses unless the path equals the sandbox constant,
 * the mark is there, the folder passes every check of the boundary, and no link inside leads outside. Returns the folder removed.
 */
export function deleteSandbox(options: SandboxOptions = {}): string {
  const root = resolve(options.root ?? SANDBOX_DIR), expected = resolve(options.expected ?? SANDBOX_DIR);
  if (root !== expected) throw new BoundaryError('NOT_THE_SANDBOX', 'That is not the sandbox folder, so nothing was deleted.');
  // Without an override from the environment, only one place is ever deleted, written out here in words and not taken from a variable.
  if (!(options.override ?? SANDBOX_OVERRIDDEN)) {
    const home = (() => { try { return realpathSync(options.home ?? homedir()); } catch { return resolve(options.home ?? homedir()); } })();
    if (basename(root) !== SANDBOX_NAME || (() => { try { return realpathSync(dirname(root)); } catch { return ''; } })() !== home) throw new BoundaryError('NOT_THE_SANDBOX', `Only the folder "${SANDBOX_NAME}" in your home folder can be deleted, so nothing was deleted.`);
  }
  const real = (options.boundary ?? boundary).checkRoot(root);
  if (real !== realpathSync(expected)) throw new BoundaryError('NOT_THE_SANDBOX', 'The sandbox folder is reached through a link, so nothing was deleted.');
  const unsafe = unsafeEntry(real);
  if (unsafe !== null) throw new BoundaryError(unsafe.why === 'link' ? 'LINK' : unsafe.why === 'hardlink' ? 'HARDLINK' : 'MOUNT', unsafe.why === 'link' ? `A shortcut inside the sandbox leads outside it (${basename(unsafe.path)}), so nothing was deleted.` : unsafe.why === 'hardlink' ? `A file inside the sandbox has a second name somewhere else (${basename(unsafe.path)}), so nothing was deleted.` : `Another disk is attached inside the sandbox (${basename(unsafe.path)}), so nothing was deleted.`);
  rmSync(real, { recursive: true, force: true });
  return real;
}

/** Makes a new file that must not exist yet and is never written through a link. */
function createFile(target: string, text: string, mode: number): void {
  const fd = openSync(target, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, mode);
  try { const data = Buffer.from(text); let at = 0; while (at < data.length) at += writeSync(fd, data, at); } finally { closeSync(fd); }
}

/**
 * Writes one file inside the sandbox, after the boundary has agreed. An old file is taken away first (never written through: a file
 * with a second name is refused), and the new one is made with the flags that refuse a link and an existing file.
 */
export function writeSandboxFile(path: string, text: string, mode = 0o644, within: Boundary = boundary): void {
  const target = within.assertWritable(path);
  mkdirSync(join(target, '..'), { recursive: true, mode: 0o755 });
  within.assertWritable(target);
  const old = (() => { try { return lstatSync(target); } catch { return null; } })();
  if (old !== null) {
    if (old.isSymbolicLink() || !old.isFile()) throw new BoundaryError('LINK', 'A link or a folder is where a file should go, so nothing was written.');
    if (old.nlink > 1) throw new BoundaryError('HARDLINK', 'That file has a second name somewhere else, so nothing was written.');
    unlinkSync(target);
  }
  createFile(target, text, mode);
}

export { SANDBOX_DIR, SENTINEL_NAME, assertWritable, boundary, createBoundary };
