// Skip conditions for tests that need something the machine running them may not give. Test tooling, never shipped. Not a test file.
// Every function returns `false` (run the test) or a reason string (skip the test, and say why). Pass the result as the
// `skip` option of `test`. A test that names no reason is never skipped by this file.
//
// The three causes are facts about the machine, not about the code under test:
//  - root: a test that makes a file or folder refuse by its mode cannot see the refusal, because root ignores modes.
//  - timestamps: a test that makes a change and expects the next stat to show it needs timestamps that tick finer than the
//    change. APFS on macOS stamps to the nanosecond. A Linux file system stamps from a kernel clock that ticks every few
//    milliseconds, so two quick changes can carry one stamp.
//  - identity: a test that removes a folder and makes another at the same path expects a new folder identity. APFS never
//    hands out an inode twice. A Linux file system gives the freed inode to the next folder at once, and with the stamps
//    above its birth time can match too.
// On macOS the timestamp and identity checks always answer `false`, so no test is skipped there by them.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ATTEMPTS = 200;

/** True when the process runs as root. */
export const isRoot = (): boolean => process.getuid?.() === 0;

/** `why` names what the test needs a mode to do. Root can read, write, list and delete whatever its mode says. */
export function skipAsRoot(why: string): string | false {
  return isRoot() && `root ignores file modes, so this cannot refuse as the test expects: ${why}`;
}

function probe(run: (folder: string, n: number) => boolean): boolean {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'bowerloom-fs-probe-'));
  try { for (let n = 0; n < ATTEMPTS; n++) if (run(folder, n)) return true; return false; }
  finally { fs.rmSync(folder, { recursive: true, force: true }); }
}

let coarse: boolean | undefined, reuse: boolean | undefined;

/** True when two quick changes in the temporary folder can carry the same modification and change time. Never true on macOS. */
export function fileTimesAreCoarse(): boolean {
  if (process.platform === 'darwin') return false;
  coarse ??= probe((folder, n) => {
    const dir = path.join(folder, `t${n}`); fs.mkdirSync(dir);
    const before = fs.statSync(dir, { bigint: true }); fs.writeFileSync(path.join(dir, 'a'), 'x'); const after = fs.statSync(dir, { bigint: true });
    return before.mtimeNs === after.mtimeNs && before.ctimeNs === after.ctimeNs;
  });
  return coarse;
}

/** True when a folder removed and made again at one path can come back with the same device, inode and birth time. Never true on macOS. */
export function folderIdentityIsReused(): boolean {
  if (process.platform === 'darwin') return false;
  reuse ??= probe((folder) => {
    const dir = path.join(folder, 'same'); fs.mkdirSync(dir);
    const first = fs.statSync(dir, { bigint: true }); fs.rmdirSync(dir); fs.mkdirSync(dir); const second = fs.statSync(dir, { bigint: true }); fs.rmdirSync(dir);
    return first.dev === second.dev && first.ino === second.ino && first.birthtimeNs === second.birthtimeNs;
  });
  return reuse;
}

/** `what` names the change the test makes and expects to see. */
export function skipOnCoarseFileTimes(what: string): string | false {
  return fileTimesAreCoarse() && `this file system gives two quick changes one timestamp, so the test cannot see ${what}`;
}

/** `what` names the replaced folder the test expects to be told apart. */
export function skipOnReusedFolderIdentity(what: string): string | false {
  return folderIdentityIsReused() && `this file system gives a replaced folder the same inode and birth time, so the test cannot tell ${what}`;
}
