// Gives one test file its own HOME. Not a test file: npm test runs dist/tests/*.test.js only.
//
// The skills CLI pins every parent folder of a record it reads, mtime and ctime included, and refuses with
// SKILLS_CHANGED if one changes during the read (apps/cli/src/skills.ts `readRecord`). So a test that reads a record
// fails now and then if another test file, running in parallel, creates or removes a folder in any parent of it.
// Test files used to make their folders directly in the real HOME, which is such a parent; the system temporary
// folder is no better, since many test files make folders there.
//
// Each test file that makes folders in HOME imports this module first. HOME then points at a new private folder,
// `<real HOME>/.bowerloom-test-homes/<file key>/home-XXXXXX`, removed when the process exits. The two folders above it
// are kept between runs, so after the first run nothing but this file's own process writes in any parent of its
// folders: the real HOME and `.bowerloom-test-homes` change only when a test file runs for the first time.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';

const realHome = fs.realpathSync(os.homedir()), root = path.join(realHome, '.bowerloom-test-homes');
const key = createHash('sha256').update(process.argv[1] ?? 'unknown').digest('hex').slice(0, 16), parent = path.join(root, key);
fs.mkdirSync(parent, { recursive: true, mode: 0o700 });
for (const p of [root, parent]) {
  const s = fs.lstatSync(p);
  if (!s.isDirectory() || s.isSymbolicLink() || s.uid !== process.getuid!() || (s.mode & 0o077) !== 0) throw new Error(`isolate-home: ${p} must be a private folder of this user`);
}
const home = fs.mkdtempSync(path.join(parent, 'home-'));
fs.chmodSync(home, 0o700);
process.env.HOME = home;
process.once('exit', () => fs.rmSync(home, { recursive: true, force: true }));
export const testHome = home;
export const testHomesRoot = root;
