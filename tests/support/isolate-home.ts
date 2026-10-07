// Gives one test file its own HOME. Not a test file: npm test runs dist/tests/*.test.js only.
//
// The skills CLI pins every parent folder of a record it reads, mtime and ctime included, and refuses with
// SKILLS_CHANGED if one changes during the read (apps/cli/src/skills.ts `readRecord`). So a test that reads a record
// fails now and then if another test file, running in parallel, creates or removes a folder in any parent of it.
// Test files used to make their folders directly in the real HOME, which is such a parent; the system temporary
// folder is no better, since many test files make folders there.
//
// Each test file that makes folders in HOME imports this module first. HOME then points at a new private folder,
// `<real HOME>/.bowerloom-test-homes/<file key>-<process ID>/home-XXXXXX`. The process ID keeps two runs of one
// checkout apart, so no other process ever writes in that parent. At exit the folder is removed, and so are its parent
// and this file's kept folder from before the process ID was in the key, when they are empty. The root stays.
// A killed run leaves its folder; the root is the one place to look. tests/README.md describes it.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';

const realHome = fs.realpathSync(os.homedir()), root = path.join(realHome, '.bowerloom-test-homes');
const fileKey = createHash('sha256').update(process.argv[1] ?? 'unknown').digest('hex').slice(0, 16);
const parent = path.join(root, `${fileKey}-${process.pid}`), legacy = path.join(root, fileKey);
fs.mkdirSync(parent, { recursive: true, mode: 0o700 });
for (const p of [root, parent]) {
  const s = fs.lstatSync(p);
  if (!s.isDirectory() || s.isSymbolicLink() || s.uid !== process.getuid!() || (s.mode & 0o077) !== 0) throw new Error(`isolate-home: ${p} must be a private folder of this user`);
}
const home = fs.mkdtempSync(path.join(parent, 'home-'));
fs.chmodSync(home, 0o700);
process.env.HOME = home;
/** rmdir only: a folder that is not empty, or not there, stays as it is. */
const removeIfEmpty = (p: string): void => { try { fs.rmdirSync(p); } catch { /* Not empty or gone. */ } };
process.once('exit', () => { fs.rmSync(home, { recursive: true, force: true }); removeIfEmpty(parent); removeIfEmpty(legacy); });
export const testHome = home;
export const testHomesRoot = root;
