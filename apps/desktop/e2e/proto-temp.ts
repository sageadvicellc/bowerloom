/**
 * Temporary folders for the prototype e2e specs, and their clean-up. A spec makes a folder with `tempDir`, which remembers it, and calls
 * `removeTempDirs` when it is done. Only a folder that this process made is ever removed, and only after `isRemovable` agrees:
 * a real folder (not a link) that sits directly inside the OS temp folder and whose name starts with the prefix it was made with.
 * A folder that was already there, from an earlier run, is never in the list, so it is never touched.
 */
import { lstatSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';

const made: { path: string; prefix: string }[] = [];

/** True when `path` is a real folder directly inside the OS temp folder, with a name that starts with `prefix` and has something after it. */
export function isRemovable(path: string, prefix: string, root: string = tmpdir()): boolean {
  if (prefix.length < 8) return false;
  try {
    const stat = lstatSync(path);
    if (!stat.isDirectory() || stat.isSymbolicLink()) return false;
    const name = basename(path);
    return name.startsWith(prefix) && name.length > prefix.length && realpathSync(dirname(path)) === realpathSync(root);
  } catch { return false; }
}

/** Makes a new folder in the OS temp folder, named `prefix` plus random letters, and remembers it for `removeTempDirs`. */
export function tempDir(prefix: string): string {
  const path = mkdtempSync(join(tmpdir(), prefix));
  made.push({ path, prefix });
  return path;
}

/** Removes the folders that `tempDir` made in this process, when they pass `isRemovable`. Returns the paths it removed. */
export function removeTempDirs(): string[] {
  const removed: string[] = [];
  for (const { path, prefix } of made.splice(0)) {
    if (!isRemovable(path, prefix)) continue;
    try { rmSync(path, { recursive: true, force: true }); removed.push(path); } catch { /* a folder that is still in use is left; the next run does not depend on it */ }
  }
  return removed;
}
