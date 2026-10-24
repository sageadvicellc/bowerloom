// The clean-up of the e2e specs removes only what it made, and only a real folder directly inside the OS temp folder.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isRemovable, removeTempDirs, tempDir } from '../e2e/proto-temp.js';

const scratch = (): string => mkdtempSync(join(tmpdir(), 'bl-temp-test-'));

test('a folder made by tempDir is removed, with what is inside it', () => {
  const dir = tempDir('bowerloom-proto-unit-');
  writeFileSync(join(dir, 'a.txt'), 'x');
  mkdirSync(join(dir, 'nested'));
  assert.deepEqual(removeTempDirs(), [dir]);
  assert.equal(existsSync(dir), false);
  assert.deepEqual(removeTempDirs(), [], 'a second call has nothing left to remove');
});

test('a folder that was already there is left alone', () => {
  const old = mkdtempSync(join(tmpdir(), 'bowerloom-proto-unit-old-'));
  try {
    const mine = tempDir('bowerloom-proto-unit-');
    assert.deepEqual(removeTempDirs(), [mine]);
    assert.equal(existsSync(old), true);
  } finally { rmSync(old, { recursive: true, force: true }); }
});

test('isRemovable refuses a wrong prefix, a short prefix, a nested folder, a link, a file and a folder outside the temp folder', () => {
  const root = scratch();
  try {
    const ok = join(root, 'bowerloom-proto-x1'), nestedParent = join(root, 'other');
    mkdirSync(ok); mkdirSync(nestedParent); mkdirSync(join(nestedParent, 'bowerloom-proto-x2'));
    assert.equal(isRemovable(ok, 'bowerloom-proto-', root), true);
    assert.equal(isRemovable(ok, 'bowerloom-other-', root), false, 'the name must start with the prefix');
    assert.equal(isRemovable(ok, 'b', root), false, 'a short prefix is refused');
    assert.equal(isRemovable(join(root, 'bowerloom-proto-'), 'bowerloom-proto-', root), false, 'a folder that is missing');
    assert.equal(isRemovable(join(nestedParent, 'bowerloom-proto-x2'), 'bowerloom-proto-', root), false, 'only a folder directly inside the root');
    symlinkSync(ok, join(root, 'bowerloom-proto-link'));
    assert.equal(isRemovable(join(root, 'bowerloom-proto-link'), 'bowerloom-proto-', root), false, 'a link is never followed');
    writeFileSync(join(root, 'bowerloom-proto-file'), 'x');
    assert.equal(isRemovable(join(root, 'bowerloom-proto-file'), 'bowerloom-proto-', root), false, 'a file');
    assert.equal(isRemovable(ok, 'bowerloom-proto-', nestedParent), false, 'a folder in another root');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
