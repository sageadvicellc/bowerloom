// The temporary data folder of the made-up launches (--sample, and the two home app dev flags): how it is chosen, made and removed. The app on the person's own
// folders never uses one: it keeps Electron's normal data folder. Plain JavaScript on purpose, so the launcher (tools/run.mjs, which runs with no build step)
// and the app (main/main.ts, through security.ts) share ONE set of checks. Types are in temp-data.d.mts.
import { chmodSync, existsSync, lstatSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';

/** The prefix of a data folder that the launcher or the app makes for a made-up launch. */
export const SAMPLE_PREFIX = 'bowerloom-sample-';
/** The prefix of a data folder that an e2e spec makes and hands in with `--user-data-dir=`. */
export const E2E_PREFIX = 'bowerloom-e2e-';
/** Every temporary data folder starts with one of these, and sits directly in the temporary folder of the system. */
export const TEMP_PREFIXES = /* @__PURE__ */ Object.freeze([SAMPLE_PREFIX, E2E_PREFIX]);

const hasPrefix = name => TEMP_PREFIXES.some(prefix => name.startsWith(prefix) && name.length > prefix.length);

/** The value of the last `--user-data-dir=` argument, or null when there is none or it is empty. Chromium reads only the form with an equals sign. */
export function userDataArg(argv) {
  let found = null;
  for (const arg of argv) if (typeof arg === 'string' && arg.startsWith('--user-data-dir=')) found = arg.slice('--user-data-dir='.length);
  return found === null || found === '' ? null : found;
}

/** True when `dir` is, by its name alone, a temporary data folder: directly inside `tmp`, named with a prefix and something more. Pure: it looks at no file. */
export function isTempDataPath(dir, tmp) {
  if (typeof dir !== 'string' || dir === '' || typeof tmp !== 'string' || tmp === '') return false;
  const full = resolve(dir);
  return hasPrefix(basename(full)) && dirname(full) === resolve(tmp);
}

/** What a made-up launch does about its data folder: keep the one it was given when that is a temporary data folder, else make a fresh one. Pure. */
export function chooseUserData(arg, tmp) {
  return arg !== null && isTempDataPath(arg, tmp) ? { action: 'keep', dir: resolve(arg) } : { action: 'make' };
}

/**
 * Whether a folder may be removed, given what was seen about it: a real directory (not a link) whose real parent is the real temporary folder,
 * and whose name has a prefix. Pure: the facts are looked up by the caller.
 */
export function mayRemoveTempDir(dir, facts) {
  return hasPrefix(basename(dir)) && !facts.isSymbolicLink && facts.isDirectory && facts.realParent === facts.realTmp;
}

/** A new, empty data folder for a made-up launch, made under the temporary folder of the system with access for its owner only. */
export function makeTempDataDir(tmp = tmpdir()) {
  const dir = mkdtempSync(join(tmp, SAMPLE_PREFIX));
  try { chmodSync(dir, 0o700); } catch { /* a system with no file modes */ }
  return dir;
}

/**
 * Removes a temporary data folder, and only that. Answers why: 'removed' (it did), 'absent' (there was no such folder), 'refused' (the folder is not
 * one of ours, so it was left exactly as it is) or 'failed' (it is ours, but it could not be removed).
 */
export function removeTempDataDir(dir, tmp = tmpdir()) {
  try {
    if (!hasPrefix(basename(dir))) return 'refused';
    let info;
    try { info = lstatSync(dir); } catch (error) { return error && error.code === 'ENOENT' ? 'absent' : 'failed'; }
    if (!mayRemoveTempDir(dir, { isSymbolicLink: info.isSymbolicLink(), isDirectory: info.isDirectory(), realParent: dirname(realpathSync(dir)), realTmp: realpathSync(tmp) })) return 'refused';
    rmSync(dir, { recursive: true, force: true });
    return 'removed';
  } catch { return 'failed'; }
}

const told = new Set();

/**
 * Removes the folder and, when it could not (refused or failed) and the folder is still there, says so on stderr, once per folder.
 * `write` is there so a test can listen. Answers the reason from `removeTempDataDir`.
 */
export function removeAndReport(dir, tmp = tmpdir(), write = text => process.stderr.write(text)) {
  const reason = removeTempDataDir(dir, tmp);
  if ((reason === 'refused' || reason === 'failed') && existsSync(dir) && !told.has(dir)) {
    told.add(dir);
    write(`Could not remove ${dir}. Delete it yourself.\n`);
  }
  return reason;
}
