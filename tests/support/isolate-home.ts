// Gives one test file its own HOME. Not a test file: npm test runs dist/tests/*.test.js only.
//
// The skills CLI pins every parent folder of a record it reads, mtime and ctime included, and refuses with
// SKILLS_CHANGED if one changes during the read (apps/cli/src/skills.ts `readRecord`). Its test keeps its records
// under the real HOME, so HOME is one of those parents. Test files that made their folders directly in the real HOME
// changed its mtime while that test read, in parallel, and it failed now and then. Each such file now imports this
// module first: HOME points at a private folder of its own under the system temporary folder, so `os.homedir()`
// and every fixture built from it stay out of the real HOME. The folder is removed when the process exits.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'bowerloom-test-home-')));
fs.chmodSync(home, 0o700);
process.env.HOME = home;
process.once('exit', () => fs.rmSync(home, { recursive: true, force: true }));
export const testHome = home;
