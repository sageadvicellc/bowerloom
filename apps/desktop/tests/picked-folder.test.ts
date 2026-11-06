// Which folder a sheet picks when it opens (Projects: Assign, Install, Update, Review). A folder that was asked for stays picked, even when it cannot be used. One that main no longer
// knows is said in words, and no other folder takes its place.
import test from 'node:test';
import assert from 'node:assert/strict';
import { goneRefusal, pickRequested } from '../renderer/harness/sheets/picked-folder.js';
import type { FolderInfo } from '../shared/engine/types.js';

const f = (id: string, hasDefinition = false): FolderInfo => ({ id, label: `~/${id}`, name: id, hasDefinition, engines: [], previewEngines: false, installedEngines: [], problem: null, projected: false, unfinished: { projection: false, adoption: false } });
const usable = (x: FolderInfo): boolean => !x.hasDefinition;

test('no folder asked for: the first usable one; none usable: none, and nothing is gone', () => {
  assert.deepEqual(pickRequested([f('a', true), f('b')], null, usable), { id: 'b', gone: false });
  assert.deepEqual(pickRequested([f('a', true)], null, usable), { id: null, gone: false });
});

test('the folder asked for stays picked even when it cannot be used, and is never swapped for another', () => {
  assert.deepEqual(pickRequested([f('a', true), f('b')], 'a', usable), { id: 'a', gone: false });
});

test('a folder asked for that main no longer lists is gone: nothing is picked, and the words say so', () => {
  assert.deepEqual(pickRequested([f('b')], 'a', usable), { id: null, gone: true });
  const r = goneRefusal();
  assert.equal(r.code, 'UNKNOWN_FOLDER');
  assert.equal(r.message, 'Bowerloom no longer knows that folder. Choose it again.');
});
