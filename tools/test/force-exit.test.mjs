import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Review M6 finding 1: --test-timeout marks a stuck test as failed, but a live handle keeps the run alive. Every
// `node --test` invocation therefore also passes --test-force-exit, so a stuck test ends the run as a failure.
const root = fileURLToPath(new URL('../../', import.meta.url));
const probe = path.join(root, 'tools/test/probes/stuck-live-handle.probe.mjs');
// A child `node --test` that inherits NODE_TEST_CONTEXT reports to this run instead of running on its own.
const { NODE_TEST_CONTEXT: _context, ...env } = process.env;

/** Every `node --test` command of every script in the repository's package.json files that run tests. */
function invocations() {
  const found = [];
  for (const file of ['package.json', 'apps/docs/package.json']) {
    const scripts = JSON.parse(fs.readFileSync(path.join(root, file), 'utf8')).scripts ?? {};
    for (const [name, command] of Object.entries(scripts)) for (const part of String(command).split('&&')) if (/^\s*node --test\b/.test(part)) found.push({ file, name, words: part.trim().split(/\s+/) });
  }
  return found;
}

test('every node --test invocation passes --test-force-exit', () => {
  const all = invocations();
  assert.ok(all.length >= 23, `found ${all.length}`);
  assert.deepEqual(all.filter(i => !i.words.includes('--test-force-exit')).map(i => `${i.file} ${i.name}`), []);
});

test('with --test-force-exit a stuck test holding a live handle ends the run with exit 1; without it the run stays alive', () => {
  const started = Date.now();
  const forced = spawnSync(process.execPath, ['--test', '--test-force-exit', '--test-timeout=1500', probe], { encoding: 'utf8', timeout: 60000, env });
  assert.equal(forced.signal, null, 'the run ended by itself'); assert.equal(forced.status, 1, forced.stdout);
  assert.match(forced.stdout, /stuck with a live handle/); assert.ok(Date.now() - started < 60000);
  const loose = spawnSync(process.execPath, ['--test', '--test-timeout=1500', probe], { encoding: 'utf8', timeout: 8000, killSignal: 'SIGKILL', env });
  assert.equal(loose.signal, 'SIGKILL', 'without the flag the run was still alive at 8 s and had to be killed');
});
