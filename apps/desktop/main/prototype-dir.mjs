// The data folder of the clickable prototype: how it is chosen, made and removed. Plain JavaScript on purpose, so the launcher
// (tools/run.mjs, which runs with no build step) and the app (main/main.ts, through security.ts) share ONE set of checks.
// Types are in prototype-dir.d.mts.
import { chmodSync, existsSync, lstatSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';

/** Every prototype data folder starts with this, and sits directly in the temporary folder of the system. */
export const PROTOTYPE_PREFIX = 'bowerloom-prototype-';

/** The value of the last `--user-data-dir=` argument, or null when there is none or it is empty. Chromium reads only the form with an equals sign. */
export function userDataArg(argv) {
  let found = null;
  for (const arg of argv) if (typeof arg === 'string' && arg.startsWith('--user-data-dir=')) found = arg.slice('--user-data-dir='.length);
  return found === null || found === '' ? null : found;
}

/** True when `dir` is, by its name alone, a prototype data folder: directly inside `tmp`, named with the prefix and something more. Pure: it looks at no file. */
export function isPrototypeDataPath(dir, tmp) {
  if (typeof dir !== 'string' || dir === '' || typeof tmp !== 'string' || tmp === '') return false;
  const full = resolve(dir), name = basename(full);
  return name.startsWith(PROTOTYPE_PREFIX) && name.length > PROTOTYPE_PREFIX.length && dirname(full) === resolve(tmp);
}

/** What the app does about its data folder in prototype mode: keep the one it was given when that is a prototype data folder, else make a fresh one. Pure. */
export function chooseUserData(arg, tmp) {
  return arg !== null && isPrototypeDataPath(arg, tmp) ? { action: 'keep', dir: resolve(arg) } : { action: 'make' };
}

/**
 * Whether a folder may be removed, given what was seen about it: a real directory (not a link) whose real parent is the real temporary folder,
 * and whose name has the prefix. Pure: the facts are looked up by the caller.
 */
export function mayRemovePrototypeDir(dir, facts) {
  return basename(dir).startsWith(PROTOTYPE_PREFIX) && !facts.isSymbolicLink && facts.isDirectory && facts.realParent === facts.realTmp;
}

/** A new, empty data folder for the prototype, made under the temporary folder of the system with access for its owner only. */
export function makePrototypeDataDir(tmp = tmpdir()) {
  const dir = mkdtempSync(join(tmp, PROTOTYPE_PREFIX));
  try { chmodSync(dir, 0o700); } catch { /* a system with no file modes */ }
  return dir;
}

/**
 * Removes a prototype data folder, and only that. Answers why: 'removed' (it did), 'absent' (there was no such folder), 'refused' (the folder is not
 * one of ours, so it was left exactly as it is) or 'failed' (it is ours, but it could not be removed).
 */
export function removePrototypeDataDir(dir, tmp = tmpdir()) {
  try {
    if (!basename(dir).startsWith(PROTOTYPE_PREFIX)) return 'refused';
    let info;
    try { info = lstatSync(dir); } catch (error) { return error && error.code === 'ENOENT' ? 'absent' : 'failed'; }
    if (!mayRemovePrototypeDir(dir, { isSymbolicLink: info.isSymbolicLink(), isDirectory: info.isDirectory(), realParent: dirname(realpathSync(dir)), realTmp: realpathSync(tmp) })) return 'refused';
    rmSync(dir, { recursive: true, force: true });
    return 'removed';
  } catch { return 'failed'; }
}

const told = new Set();

/**
 * Removes the folder and, when it could not (refused or failed) and the folder is still there, says so on stderr, once per folder.
 * `write` is there so a test can listen. Answers the reason from `removePrototypeDataDir`.
 */
export function removeAndReport(dir, tmp = tmpdir(), write = text => process.stderr.write(text)) {
  const reason = removePrototypeDataDir(dir, tmp);
  if ((reason === 'refused' || reason === 'failed') && existsSync(dir) && !told.has(dir)) {
    told.add(dir);
    write(`Could not remove ${dir}. Delete it yourself.\n`);
  }
  return reason;
}
