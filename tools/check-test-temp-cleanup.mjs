#!/usr/bin/env node
// A test that makes a folder in the system temp folder must remove it, also when the test fails. Leaked folders filled the disk
// below the free-space floor that the pack tests enforce.
// This check reads every test file (a *.test.* or *.spec.* file, or any file inside a test, tests, or e2e folder) and fails when
// one calls mkdtemp or mkdtempSync but has none of the two parts of a clean-up: a removal call, and a place that runs it
// after the test (an after hook, a finally block, or an exit handler). A support file (a helper or fixture that a test file
// imports) only needs the removal call, because it hands the folder to a test, which registers the removal. Its limit is on
// purpose: it reads each file as a whole, so it cannot tell which folder a removal belongs to. It never fails a file that
// cleans up, and it catches a file that does not.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SKIP = new Set(['node_modules', 'dist', '.build', '.next', '.git', 'out', 'release']);
const SOURCE = /\.(?:mjs|js|ts|tsx)$/;
const MAKES = /\bmkdtemp(?:Sync)?\s*\(/;
// A removal: the fs calls, or one of the repository's own helpers that wrap them.
const REMOVES = /\b(?:rmSync|rmdirSync|rimrafSync|removeAll|removeTree|removeTempDirs|cleanTemp)\s*\(|\.\s*rm\s*\(|\bfs\.rm\b|\brm\s*\(/;
// A place that runs after the test: a hook, a finally block, an exit handler, or a helper that registers its own removal with the test.
const AFTER = /\b(?:after|afterEach|afterAll|teardown)\s*\(|\.after\s*\(|\.afterEach\s*\(|\.afterAll\s*\(|\bfinally\s*\{|process\s*\.\s*(?:on|once)\s*\(\s*['"]exit['"]|\btempDir\s*\(\s*t\b/;

/** True when the path is a test file. */
export function isTestFile(rel) {
  const parts = rel.split('/');
  const name = parts[parts.length - 1];
  return SOURCE.test(name) && (/\.(?:test|spec)\.[a-z]+$/.test(name) || parts.slice(0, -1).some(p => p === 'test' || p === 'tests' || p === 'e2e'));
}

/** True when the file is a test itself, not a helper that tests import. */
const isTestItself = rel => /\.(?:test|spec)\.[a-z]+$/.test(rel);

/** Returns what is missing from one file's text: [] when it is fine or makes no temp folder. `rel` is the file's path. */
export function missingCleanup(text, rel = 'x.test.mjs') {
  // Comments do not count as a call.
  const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  if (!MAKES.test(code)) return [];
  const missing = [];
  if (!REMOVES.test(code)) missing.push('no removal call (rmSync, rm, removeAll, removeTempDirs)');
  if (isTestItself(rel) && !AFTER.test(code)) missing.push('nothing runs it after the test (an after hook, a finally block, or an exit handler)');
  return missing;
}

function* walk(root, rel = '') {
  for (const entry of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
    if (entry.name.startsWith('.') || SKIP.has(entry.name)) continue;
    const child = rel ? rel + '/' + entry.name : entry.name;
    if (entry.isDirectory()) yield* walk(root, child);
    else if (entry.isFile()) yield child;
  }
}

/** Returns each test file that makes a temp folder without a clean-up, with what is missing. */
export function filesWithoutCleanup(root) {
  const found = [];
  for (const rel of walk(root)) {
    if (!isTestFile(rel)) continue;
    const missing = missingCleanup(fs.readFileSync(path.join(root, rel), 'utf8'), rel);
    if (missing.length) found.push({ file: rel, missing });
  }
  return found;
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  const found = filesWithoutCleanup(process.cwd());
  if (found.length) {
    process.stderr.write('Test files that make a temp folder and do not remove it:\n' + found.map(({ file, missing }) => `  ${file}: ${missing.join('; ')}\n`).join(''));
    process.exitCode = 1;
  }
}
