// The full path of a folder, worked out from its label for the run record (main/run-folder.ts): `~` and plain paths are resolved, and anything that cannot be opened as written is null.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { folderRefOf } from '../main/run-folder.js';
import { tempDir } from './support.js';

test('a label with ~ is resolved against the home folder, and a folder outside home keeps its path', t => {
  const home = tempDir(t), out = tempDir(t);
  mkdirSync(join(home, 'Projects', 'team'), { recursive: true });
  assert.deepEqual(folderRefOf({ label: '~/Projects/team', name: 'team' }, home), { dir: join(home, 'Projects', 'team'), name: 'team', label: '~/Projects/team' });
  assert.deepEqual(folderRefOf({ label: '~', name: 'home' }, home), { dir: home, name: 'home', label: '~' });
  assert.deepEqual(folderRefOf({ label: out, name: 'out' }, home), { dir: out, name: 'out', label: out });
});

test('a label that is not a folder, is a file, is a link, or is odd gives null', t => {
  const home = tempDir(t);
  mkdirSync(join(home, 'real'), { recursive: true }); writeFileSync(join(home, 'file.txt'), 'x'); symlinkSync(join(home, 'real'), join(home, 'link'));
  for (const label of ['~/missing', '~/file.txt', '~/link', '', 'relative/path', '~user/x', '~/a\u0000b', '~/Projects/na[U+200B]me', 5 as unknown as string, `~/${'a'.repeat(2300)}`]) {
    assert.equal(folderRefOf({ label, name: 'x' }, home), null, String(label).slice(0, 40));
  }
});
