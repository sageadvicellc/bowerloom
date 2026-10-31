// The ONE place where the persona tool writes a file. Every other file of the tool only reads. A write is refused when its path is inside the
// repository (that covers apps/desktop/e2e, which is tracked) or when the path is not absolute. A symbolic link that leads into the
// repository is followed first, so a link cannot hide a path. tests/personas-files.test.ts scans the other files to prove they hold no direct write call.
import { appendFileSync, existsSync, mkdirSync, realpathSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/** This tool sits in apps/desktop/tools/personas, so the repository is three levels up from the apps/desktop folder. */
export const DESKTOP = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const REPO_ROOT = resolve(DESKTOP, '..', '..');

/** Follows links on the part of the path that exists, then adds the part that does not exist yet. */
export function realPathOf(path) {
  let head = resolve(path);
  const rest = [];
  while (!existsSync(head)) {
    const parent = dirname(head);
    if (parent === head) break;
    rest.unshift(basename(head));
    head = parent;
  }
  return join(existsSync(head) ? realpathSync(head) : head, ...rest);
}

const inside = (child, parent) => child === parent || child.startsWith(parent.endsWith(sep) ? parent : parent + sep);

/** True when the path is inside the repository, once links are followed. */
export function isInsideRepo(path, repo = REPO_ROOT) {
  return inside(realPathOf(path), realPathOf(repo));
}

/** Throws a plain error when the tool may not write at this path. */
export function assertWritable(path, repo = REPO_ROOT) {
  if (typeof path !== 'string' || path === '' || !isAbsolute(path)) throw new Error('The persona tool writes only to an absolute path outside the repository.');
  if (isInsideRepo(path, repo)) throw new Error('The persona tool never writes inside the repository. Choose a folder in the temporary folder.');
}

const written = new Set();
export function ensureDir(path, repo = REPO_ROOT) { assertWritable(path, repo); mkdirSync(path, { recursive: true, mode: 0o700 }); }
export function writeText(path, text, { mode = 0o600, repo = REPO_ROOT } = {}) { assertWritable(path, repo); writeFileSync(path, text, { mode }); written.add(path); }
export function writeBytes(path, bytes, repo = REPO_ROOT) { assertWritable(path, repo); writeFileSync(path, bytes, { mode: 0o600 }); }
export function appendText(path, text, repo = REPO_ROOT) { assertWritable(path, repo); appendFileSync(path, text, { mode: 0o600 }); }
/** Removes a file that this process wrote with writeText, and nothing else. Answers true when it removed one. */
export function removeOwnFile(path) {
  if (!written.has(path)) return false;
  written.delete(path);
  try { unlinkSync(path); return true; } catch { return false; }
}
