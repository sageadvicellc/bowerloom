// The release gate for the contract stubs. The first test checks the checker on made-up files and always runs. The second is the gate itself: it fails while a
// stub is left in a file that ships, and it runs only when BOWERLOOM_RELEASE_GATE=1, because the stubs exist on purpose until their lanes land.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SHIPPED, findNotBuilt } from '../check-not-built.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('the checker finds a stub by file and line in .ts, .tsx, .mjs and .js, in subfolders, in single, double and backtick quotes, and skips test folders, other files and a file that is not there', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bowerloom-notbuilt-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'pkg/src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'pkg/src/a.ts'), "export const a = 1;\nconst notBuilt = () => { throw new Error('not built'); };\n");
  fs.writeFileSync(path.join(root, 'pkg/src/b.ts'), 'export const b = "not built";\nexport const c = 2;\n');
  fs.writeFileSync(path.join(root, 'pkg/src/c.mjs'), "throw new Error('not built');\n");
  fs.mkdirSync(path.join(root, 'pkg/src/deep/er'), { recursive: true });
  fs.writeFileSync(path.join(root, 'pkg/src/deep/er/d.tsx'), 'export const x = `not built`;\n');
  fs.writeFileSync(path.join(root, 'pkg/src/deep/e.js'), 'throw new Error("not built");\n');
  fs.writeFileSync(path.join(root, 'pkg/src/deep/notes.md'), "'not built'\n");
  fs.mkdirSync(path.join(root, 'pkg/src/test'), { recursive: true });
  fs.writeFileSync(path.join(root, 'pkg/src/test/t.mjs'), "assert('not built');\n");
  fs.writeFileSync(path.join(root, 'one.ts'), "// not built is only a comment word\nexport const d = 3;\n");
  assert.deepEqual(findNotBuilt(root, ['pkg/src', 'one.ts', 'missing.ts']), ['pkg/src/a.ts:2', 'pkg/src/b.ts:1', 'pkg/src/c.mjs:1', 'pkg/src/deep/e.js:1', 'pkg/src/deep/er/d.tsx:1']);
  assert.deepEqual(findNotBuilt(root, ['one.ts']), []);
});

test('the shipped list names the package, the desktop main files and the window code of export and import, the command line file and the Overview contract', () => {
  assert.deepEqual([...SHIPPED], [
    'packages/harness-bundle/src', 'apps/desktop/main/engine-service.ts', 'apps/desktop/main/engine-bundle.ts', 'apps/desktop/main/engine-bundle-host.ts', 'apps/desktop/main/engine-bundle-work.ts',
    'apps/cli/src/harness-bundle.ts', 'apps/desktop/renderer', 'apps/desktop/shared/engine/sample.ts', 'apps/desktop/shared/harness/overview.ts', 'apps/desktop/shared/harness/overview-layout.ts',
  ]);
});

test('release gate: no file that ships holds a "not built" stub', { skip: process.env.BOWERLOOM_RELEASE_GATE === '1' ? false : 'runs with BOWERLOOM_RELEASE_GATE=1, in the gate lane before the release pull request' }, () => {
  assert.deepEqual(findNotBuilt(repo), []);
});
