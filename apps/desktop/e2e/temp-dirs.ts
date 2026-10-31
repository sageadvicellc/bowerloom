/**
 * Temporary folders for the e2e specs, and their clean-up. A spec makes a folder with `tempDir`, which remembers it, and calls
 * `removeTempDirs` when it is done. Only a folder that this process made is ever removed, and only after `isRemovable` agrees:
 * a real folder (not a link) that sits directly inside the OS temp folder and whose name starts with the prefix it was made with.
 * A folder that was already there, from an earlier run, is never in the list, so it is never touched.
 * A data folder for the app is made with the prefix `bowerloom-e2e-`: a made-up launch (--sample, --home-sample, --home-real) keeps a `--user-data-dir` only when its name starts with
 * `bowerloom-e2e-` or `bowerloom-sample-`, and otherwise it makes (and, on a hard close, leaves) a folder of its own that this helper does not know about.
 */
import { existsSync, lstatSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
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

/** Removes the folders that `tempDir` made in this process, when they pass `isRemovable`. Returns the paths it removed. A folder it could not remove is named in a warning (`warn`, stderr by default). */
export function removeTempDirs(warn: (text: string) => unknown = text => process.stderr.write(text)): string[] {
  const removed: string[] = [];
  for (const { path, prefix } of made.splice(0)) {
    if (!existsSync(path)) continue;
    if (!isRemovable(path, prefix)) { warn(`Could not remove ${path}. Delete it yourself.\n`); continue; }
    try { rmSync(path, { recursive: true, force: true }); removed.push(path); } catch { warn(`Could not remove ${path}. Delete it yourself.\n`); }
  }
  return removed;
}
