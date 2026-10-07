import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { testPatterns } from '../check-test-patterns.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const SKIP = new Set(['node_modules', 'dist', '.git']);
/**
 * Test folders that `npm test` does not run, each with the reason, checked 2026-10-07. A folder leaves this list
 * when its suite passes offline from the root; a failing suite is fixed, never trimmed to get in.
 */
const NOT_IN_NPM_TEST = new Map([
  ['apps/docs/tools', 'separate app, not an npm workspace: its @astrojs dependencies come only from apps/docs/package-lock.json, and apps/docs runs its own npm test'],
  ['apps/landing/test', 'fails offline: readme-tags.test.mjs expects "### Install Bowerloom" and README.md now has "## Install Bowerloom"'],
  ['packages/claude-adapter/test', 'fails offline: controlled-exchange.test.mjs reads a fixture bundle outside the repository, ../campaign/sagespec/dual-harness-trial-01'],
]);

function testFiles() {
  const found = [];
  const visit = rel => {
    for (const entry of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
      if (entry.name.startsWith('.') || SKIP.has(entry.name)) continue;
      const child = rel ? rel + '/' + entry.name : entry.name;
      if (entry.isDirectory()) visit(child); else if (entry.isFile() && /\.test\.(?:mjs|ts)$/.test(entry.name)) found.push(child);
    }
  };
  visit(''); return found.sort();
}
const globRegex = pattern => new RegExp('^' + pattern.split('').map(c => c === '*' ? '[^/]*' : c === '?' ? '[^/]' : c.replace(/[.+^$()|\\[\]{}]/g, '\\$&')).join('') + '$');

test('npm test runs every test file in the repository, apart from the listed folders and their reasons', () => {
  const scripts = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).scripts;
  const globs = testPatterns({ test: scripts.test }).map(p => globRegex(p.pattern));
  // TypeScript tests run from their compiled copy under dist/.
  const missing = testFiles().filter(f => !globs.some(g => g.test(f.endsWith('.ts') ? 'dist/' + f.replace(/\.ts$/, '.js') : f)));
  const unlisted = missing.filter(f => !NOT_IN_NPM_TEST.has(path.posix.dirname(f)));
  assert.deepEqual(unlisted, [], 'add these to npm test, or list their folder with a reason');
  // A listed folder that npm test now runs leaves the list.
  for (const folder of NOT_IN_NPM_TEST.keys()) assert.ok(missing.some(f => path.posix.dirname(f) === folder), `${folder} is covered now: remove it from the list`);
});
