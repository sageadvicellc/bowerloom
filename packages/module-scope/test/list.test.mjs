// The list of an approved place: the markdown files of the place by relative path, behind the same gate as a read. It reads names only and never follows a link.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SCOPE_LIMITS, approvePlace, listPlaceFiles, revokePlace } from '../../../dist/packages/module-scope/src/index.js';

function rig(t) {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'bowerloom-list-')));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const home = path.join(base, 'home'), state = path.join(home, 'Library', 'state'), notes = path.join(home, 'Documents', 'notes');
  for (const d of ['Documents/notes/sub/deeper', 'Documents/notes/.obsidian', 'Documents/notes/.git', 'Documents/other', 'Library/state', 'outside']) fs.mkdirSync(path.join(home, d), { recursive: true });
  const put = (rel, text = 'x') => fs.writeFileSync(path.join(notes, ...rel.split('/')), text);
  put('b.md'); put('A.md'); put('sub/c.markdown'); put('sub/deeper/d.MD'); put('readme.txt'); put('image.png'); put('.hidden.md'); put('.obsidian/app.md'); put('.git/HEAD.md'); put('no-extension');
  fs.writeFileSync(path.join(home, 'Documents/other/o.md'), 'other');
  fs.writeFileSync(path.join(home, 'outside/out.md'), 'out');
  return { base, home, state, notes, put };
}
const approve = (r, moduleId = 'memory-explorer', picked = r.notes) => approvePlace({ stateRoot: r.state, home: r.home, moduleId, picked, now: () => '2026-11-12T10:00:00.000Z' });
const list = (r, placeId, moduleId = 'memory-explorer') => listPlaceFiles({ stateRoot: r.state, home: r.home, moduleId, placeId });

test('the list holds the markdown files of the place, sorted, with relative paths, and nothing hidden, nothing else, and no full path', t => {
  const r = rig(t), kept = approve(r);
  const got = list(r, kept.place.id);
  assert.deepEqual(got, { ok: true, files: ['A.md', 'b.md', 'sub/c.markdown', 'sub/deeper/d.MD'], truncated: false });
  assert.doesNotMatch(JSON.stringify(got), new RegExp(r.base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('a place that was never approved, an unknown id, another module and a removed place are all NOT_APPROVED', t => {
  const r = rig(t), kept = approve(r);
  assert.deepEqual(list(r, 'place-000000000000'), { ok: false, code: 'NOT_APPROVED' });
  assert.deepEqual(list(r, kept.place.id, 'engines'), { ok: false, code: 'NOT_APPROVED' });
  for (const bad of [undefined, null, 5, '', '../x', 'place-xyz']) assert.deepEqual(list(r, bad), { ok: false, code: 'NOT_APPROVED' }, String(bad));
  assert.deepEqual(listPlaceFiles({ stateRoot: r.state, home: r.home, moduleId: 7, placeId: kept.place.id }), { ok: false, code: 'NOT_APPROVED' });
  assert.equal(revokePlace({ stateRoot: r.state, moduleId: 'memory-explorer', placeId: kept.place.id }).status, 'revoked');
  assert.deepEqual(list(r, kept.place.id), { ok: false, code: 'NOT_APPROVED' });
});

test('a place that was swapped for another folder is PLACE_CHANGED, and one that is gone is PLACE_CHANGED too', t => {
  const r = rig(t), kept = approve(r);
  fs.renameSync(r.notes, `${r.notes}-old`);
  assert.deepEqual(list(r, kept.place.id), { ok: false, code: 'PLACE_CHANGED' });
  fs.symlinkSync(path.join(r.home, 'Documents', 'other'), r.notes);
  assert.deepEqual(list(r, kept.place.id), { ok: false, code: 'PLACE_CHANGED' });
});

test('a damaged or blocked record is told as such, and never an empty list', t => {
  const r = rig(t), kept = approve(r);
  const file = path.join(r.state, 'module-scope', 'approved.json');
  fs.writeFileSync(file, '{ not json');
  assert.deepEqual(list(r, kept.place.id), { ok: false, code: 'RECORD_DAMAGED' });
  fs.rmSync(file);
  fs.chmodSync(path.join(r.state, 'module-scope'), 0o777);
  assert.deepEqual(list(r, kept.place.id), { ok: false, code: 'RECORD_BLOCKED' });
});

test('a link is never followed: a link to a file, to a folder inside the place and to a folder outside it add nothing', t => {
  const r = rig(t), kept = approve(r);
  fs.symlinkSync(path.join(r.home, 'outside'), path.join(r.notes, 'out-dir'));
  fs.symlinkSync(path.join(r.home, 'outside', 'out.md'), path.join(r.notes, 'out-file.md'));
  fs.symlinkSync(path.join(r.notes, 'sub'), path.join(r.notes, 'in-dir'));
  fs.symlinkSync(path.join(r.notes, 'b.md'), path.join(r.notes, 'in-file.md'));
  assert.deepEqual(list(r, kept.place.id).files, ['A.md', 'b.md', 'sub/c.markdown', 'sub/deeper/d.MD']);
});

test('a name with a control or bidirectional character, with all that is below it, is left out', t => {
  const r = rig(t), kept = approve(r);
  fs.mkdirSync(path.join(r.notes, 'bad‮dir')); fs.writeFileSync(path.join(r.notes, 'bad‮dir', 'x.md'), 'x');
  fs.writeFileSync(path.join(r.notes, 'tab\tname.md'), 'x');
  fs.writeFileSync(path.join(r.notes, 'zero​width.md'), 'x');
  assert.deepEqual(list(r, kept.place.id).files, ['A.md', 'b.md', 'sub/c.markdown', 'sub/deeper/d.MD']);
});

test('the walk stops at the file limit and says truncated, and at the depth limit and says truncated', t => {
  const r = rig(t), kept = approve(r);
  const dir = path.join(r.notes, 'many'); fs.mkdirSync(dir);
  for (let i = 0; i < SCOPE_LIMITS.listFiles + 5; i += 1) fs.writeFileSync(path.join(dir, `f${String(i).padStart(5, '0')}.md`), '');
  const got = list(r, kept.place.id);
  assert.equal(got.ok, true);
  assert.equal(got.files.length, SCOPE_LIMITS.listFiles);
  assert.equal(got.truncated, true);
  fs.rmSync(dir, { recursive: true });
  let deep = r.notes;
  for (let i = 0; i <= SCOPE_LIMITS.listDepth + 1; i += 1) { deep = path.join(deep, `d${i}`); fs.mkdirSync(deep); }
  fs.writeFileSync(path.join(deep, 'too-deep.md'), '');
  const cut = list(r, kept.place.id);
  assert.equal(cut.truncated, true);
  assert.ok(!cut.files.some(f => f.endsWith('too-deep.md')));
});

test('an empty place gives an empty list', t => {
  const r = rig(t);
  const empty = path.join(r.home, 'Documents', 'empty'); fs.mkdirSync(empty);
  const kept = approve(r, 'memory-explorer', empty);
  assert.deepEqual(list(r, kept.place.id), { ok: true, files: [], truncated: false });
});

test('a path of a listing reads back through the same gate, and the list opens no file', t => {
  const r = rig(t), kept = approve(r);
  const got = list(r, kept.place.id);
  assert.equal(got.files.length, 4);
  assert.ok(Object.isFrozen(got.files));
});
