import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { testPatterns, emptyTestPatterns } from '../check-test-patterns.mjs';

const checker = fileURLToPath(new URL('../check-test-patterns.mjs', import.meta.url));
function tree(t, files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bowerloom test patterns '));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const file of files) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    if (file.endsWith('/')) fs.mkdirSync(path.join(root, file), { recursive: true }); else fs.writeFileSync(path.join(root, file), '');
  }
  return root;
}

test('patterns come from every node --test segment of test and test:* scripts only', () => {
  const scripts = {
    build: 'tsc',
    test: 'npm run build && node tools/check-test-patterns.mjs && node --test a/test/*.test.mjs dist/b/*.test.js',
    'test:one': 'npm run build && node --test --test-concurrency=1 c/test/only.test.mjs',
    trellis: 'node --test never/*.test.mjs',
  };
  assert.deepEqual(testPatterns(scripts), [
    { script: 'test', pattern: 'a/test/*.test.mjs' }, { script: 'test', pattern: 'dist/b/*.test.js' },
    { script: 'test:one', pattern: 'c/test/only.test.mjs' },
  ]);
  assert.deepEqual(testPatterns({}), []);
});

test('a pattern with no matching test file is reported, and a matching one is not', t => {
  const root = tree(t, ['full/test/a.test.mjs', 'notes/test/README.md', 'dirs/test/fake.test.mjs/', 'one/test/only.test.mjs', 'mixed/test/x.test.js']);
  const scripts = { test: 'node --test full/test/*.test.mjs missing/test/*.test.mjs notes/test/*.test.mjs dirs/test/*.test.mjs one/test/only.test.mjs one/test/gone.test.mjs mixed/test/*.test.mjs' };
  assert.deepEqual(emptyTestPatterns(scripts, root).map(entry => entry.pattern), [
    'missing/test/*.test.mjs', 'notes/test/*.test.mjs', 'dirs/test/*.test.mjs', 'one/test/gone.test.mjs', 'mixed/test/*.test.mjs',
  ]);
});

test('a wildcard outside the file name is refused rather than guessed', t => {
  const root = tree(t, ['a/test/x.test.mjs']);
  assert.throws(() => emptyTestPatterns({ test: 'node --test */test/*.test.mjs' }, root), /unsupported test pattern/);
});

test('the command exits 1 and names each empty pattern, and exits 0 when every pattern has a test file', t => {
  const root = tree(t, ['full/test/a.test.mjs']);
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ scripts: { test: 'node --test full/test/*.test.mjs empty/test/*.test.mjs', 'test:x': 'node --test empty/test/*.test.mjs' } }));
  const failed = spawnSync(process.execPath, [checker], { cwd: root, encoding: 'utf8' });
  assert.equal(failed.status, 1);
  assert.match(failed.stderr, /test: empty\/test\/\*\.test\.mjs/); assert.match(failed.stderr, /test:x: empty\/test\/\*\.test\.mjs/);
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ scripts: { test: 'node --test full/test/*.test.mjs' } }));
  const passed = spawnSync(process.execPath, [checker], { cwd: root, encoding: 'utf8' });
  assert.equal(passed.status, 0, passed.stderr);
});
