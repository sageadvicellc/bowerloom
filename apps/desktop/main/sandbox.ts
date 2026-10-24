/**
 * The sandbox: a folder made only for trying things, beside the real Sage Advice folder. It holds invented content and its own pretend
 * home folder (with its own shared library), so a test never touches a real one. This module makes the folder, checks it, and deletes it
 * for a reset. A reset deletes nothing unless the folder is exactly the sandbox constant, carries the viewer's mark, and has no
 * shortcut that leads outside it. Every write is checked by the write boundary first.
 */
import { lstatSync, mkdirSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join, resolve, sep } from 'node:path';
import { BoundaryError, SANDBOX_DIR, SENTINEL_NAME, SENTINEL_TEXT, assertWritable, boundary, createBoundary } from './boundary.js';
import type { Boundary } from './boundary.js';

/** Where things are inside the sandbox. The pretend home holds the shared library and the workspace. */
export function sandboxPaths(root: string = SANDBOX_DIR): { root: string; home: string; workspace: string; state: string } {
  return { root, home: join(root, 'home'), workspace: join(root, 'home', 'workspace'), state: join(root, 'state') };
}

export const sandboxExists = (root: string = SANDBOX_DIR): boolean => {
  try { const s = lstatSync(join(root, SENTINEL_NAME)); return s.isFile() && !s.isSymbolicLink(); } catch { return false; }
};

/** Every link inside the sandbox must stay inside it. Returns the first one that leaves, or null. */
export function escapingLink(root: string): string | null {
  const real = realpathSync(root);
  const walk = (dir: string): string | null => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isSymbolicLink()) {
        let target: string; try { target = realpathSync(path); } catch { return path; }
        if (target !== real && !target.startsWith(real + sep)) return path;
      } else if (entry.isDirectory()) { const found = walk(path); if (found !== null) return found; }
    }
    return null;
  };
  return walk(real);
}

export interface SandboxOptions { root?: string; expected?: string; boundary?: Boundary }

/** Makes the sandbox folder and its mark if they are not there. Refuses any folder that is not the sandbox constant. */
export function ensureSandbox(options: SandboxOptions = {}): string {
  const root = resolve(options.root ?? SANDBOX_DIR), expected = resolve(options.expected ?? SANDBOX_DIR);
  if (root !== expected) throw new BoundaryError('NOT_THE_SANDBOX', 'That is not the sandbox folder, so nothing was made.');
  if (!/sandbox/i.test(basename(root))) throw new BoundaryError('ROOT_NAME', 'The sandbox folder must have "Sandbox" in its name.');
  const stat = (() => { try { return lstatSync(root); } catch { return null; } })();
  if (stat !== null && (stat.isSymbolicLink() || !stat.isDirectory())) throw new BoundaryError('ROOT_NOT_FOLDER', 'The sandbox must be a real folder, not a link.');
  if (stat === null) mkdirSync(root, { mode: 0o755 });
  else if (!sandboxExists(root) && readdirSync(root).length > 0) throw new BoundaryError('NO_SENTINEL', 'A folder with this name is already there, and it is not the viewer\'s. It was left alone.');
  if (!sandboxExists(root)) writeFileSync(join(root, SENTINEL_NAME), SENTINEL_TEXT, { mode: 0o644 });
  return (options.boundary ?? boundary).checkRoot(root);
}

/**
 * Deletes everything inside the sandbox, and the folder itself, for a reset. Refuses unless the path equals the sandbox constant,
 * the mark is there, the folder passes every check of the boundary, and no link inside leads outside. Returns the folder removed.
 */
export function deleteSandbox(options: SandboxOptions = {}): string {
  const root = resolve(options.root ?? SANDBOX_DIR), expected = resolve(options.expected ?? SANDBOX_DIR);
  if (root !== expected) throw new BoundaryError('NOT_THE_SANDBOX', 'That is not the sandbox folder, so nothing was deleted.');
  const real = (options.boundary ?? boundary).checkRoot(root);
  if (real !== realpathSync(expected)) throw new BoundaryError('NOT_THE_SANDBOX', 'The sandbox folder is reached through a link, so nothing was deleted.');
  const leaving = escapingLink(real);
  if (leaving !== null) throw new BoundaryError('LINK', `A shortcut inside the sandbox leads outside it (${basename(leaving)}), so nothing was deleted.`);
  rmSync(real, { recursive: true, force: true });
  return real;
}

/** Writes one file inside the sandbox, after the boundary has agreed. */
export function writeSandboxFile(path: string, text: string, mode = 0o644): void {
  const target = assertWritable(path);
  mkdirSync(join(target, '..'), { recursive: true, mode: 0o755 });
  writeFileSync(target, text, { mode });
}

export { SANDBOX_DIR, SENTINEL_NAME, assertWritable, boundary, createBoundary };
