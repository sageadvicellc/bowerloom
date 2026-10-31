import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { filesWithoutCleanup, isTestFile, missingCleanup } from '../check-test-temp-cleanup.mjs';

const checker = fileURLToPath(new URL('../check-test-temp-cleanup.mjs', import.meta.url));
function tree(t, files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bowerloom test temp cleanup '));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const [file, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), text);
  }
  return root;
}

const LEAKS = "const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bowerloom-x-'));\n";
const CLEAN = LEAKS + "t.after(() => fs.rmSync(dir, { recursive: true, force: true }));\n";

test('a file is a test file when it is named .test or .spec, or sits in a test, tests or e2e folder', () => {
  for (const file of ['a/b.test.mjs', 'a/b.spec.ts', 'tests/support/x.ts', 'packages/p/test/fixture.mjs', 'apps/d/e2e/page.ts']) assert.equal(isTestFile(file), true, file);
  for (const file of ['packages/p/src/index.ts', 'tools/check.mjs', 'tests/notes.md', 'apps/d/main/prototype-dir.mjs']) assert.equal(isTestFile(file), false, file);
});

test('a test that makes a temp folder with no removal, or with no place to run it, is named', () => {
  assert.deepEqual(missingCleanup('', 'a.test.mjs'), [], 'a test with no temp folder');
  assert.equal(missingCleanup(LEAKS, 'a.test.mjs').length, 2, 'neither a removal nor a hook');
  assert.match(missingCleanup(LEAKS + 'fs.rmSync(dir, { recursive: true });\n', 'a.test.mjs')[0], /after the test/, 'a removal inline in the body does not run when the test fails');
  assert.match(missingCleanup(LEAKS + "test('x', t => { t.after(() => {}); });\n", 'a.test.mjs')[0], /no removal call/, 'a hook that removes nothing');
  assert.deepEqual(missingCleanup(CLEAN, 'a.test.mjs'), [], 'a hook that removes');
  assert.deepEqual(missingCleanup(LEAKS + 'try { run(); } finally { fs.rmSync(dir, { recursive: true }); }\n', 'a.spec.ts'), [], 'a finally block');
  assert.deepEqual(missingCleanup(LEAKS + "process.on('exit', () => fs.rmSync(dir, { recursive: true }));\n", 'a.test.mjs'), [], 'an exit handler');
  assert.deepEqual(missingCleanup(LEAKS + "test.afterAll(() => { removeTempDirs(); });\n", 'a.spec.ts'), [], 'a Playwright hook with a helper');
  assert.deepEqual(missingCleanup("const dir = await mkdtemp(join(tmpdir(), 'bowerloom-x-'));\nafter(async () => { await rm(dir, { recursive: true, force: true }); });\n", 'a.test.mjs'), [], 'promise forms');
});

test('a comment that names the calls does not count as a call', () => {
  assert.equal(missingCleanup('// mkdtempSync is not called here\nconst x = 1;\n', 'a.test.mjs').length, 0);
  assert.equal(missingCleanup(LEAKS + '// t.after(() => rmSync(dir))\n/* t.after(() => rmSync(dir)) */\n', 'a.test.mjs').length, 2);
});

test('a support file only needs the removal call, because the test that imports it registers the hook', () => {
  assert.deepEqual(missingCleanup(LEAKS + 'export const cleanup = () => fs.rmSync(dir, { recursive: true });\n', 'tests/support/x.ts'), []);
  assert.equal(missingCleanup(LEAKS, 'tests/support/x.ts').length, 1);
});

test('the walk reads test files only, and skips node_modules and build folders', t => {
  const root = tree(t, {
    'tests/leak.test.ts': LEAKS,
    'tests/ok.test.ts': CLEAN,
    'src/product.ts': LEAKS,
    'node_modules/pkg/test/x.test.js': LEAKS,
    'dist/tests/leak.test.js': LEAKS,
    'apps/d/.build/tests/leak.test.mjs': LEAKS,
  });
  assert.deepEqual(filesWithoutCleanup(root).map(f => f.file), ['tests/leak.test.ts']);
});

test('the command exits 1 and names the file when a test leaks, and exits 0 when none does', t => {
  const leaking = tree(t, { 'tests/leak.test.ts': LEAKS });
  const failed = spawnSync(process.execPath, [checker], { cwd: leaking, encoding: 'utf8' });
  assert.equal(failed.status, 1);
  assert.match(failed.stderr, /tests\/leak\.test\.ts/);
  const clean = tree(t, { 'tests/ok.test.ts': CLEAN });
  const passed = spawnSync(process.execPath, [checker], { cwd: clean, encoding: 'utf8' });
  assert.equal(passed.status, 0, passed.stderr);
  assert.equal(passed.stderr, '');
});
