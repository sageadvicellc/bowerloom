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

test('a folder that cannot be used says why: a character, a link, or not a folder that is there', t => {
  const home = tempDir(t);
  mkdirSync(join(home, 'real'), { recursive: true }); writeFileSync(join(home, 'file.txt'), 'x'); symlinkSync(join(home, 'real'), join(home, 'link'));
  const why = (label: string, name = 'x'): unknown => folderRefOf({ label, name }, home);
  for (const label of ['~/missing', '~/file.txt', '', 'relative/path', '~user/x', `~/${'a'.repeat(2300)}`, 5 as unknown as string]) assert.deepEqual(why(label), { problem: 'UNKNOWN_FOLDER' }, String(label).slice(0, 40));
  assert.deepEqual(why('~/link'), { problem: 'FOLDER_LINK' });
  for (const label of ['~/a\u0000b', '~/Projects/na[U+200B]me']) assert.deepEqual(why(label), { problem: 'FOLDER_CHARACTER' }, label);
  assert.deepEqual(why('~/real', 'na\u0000me'), { problem: 'FOLDER_CHARACTER' });
  assert.deepEqual(why('~/real', 'n'.repeat(256)), { problem: 'UNKNOWN_FOLDER' }, 'a name over 255 characters');
  assert.notEqual((why('~/real', 'n'.repeat(255)) as { problem?: string }).problem, 'UNKNOWN_FOLDER');
});
