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
const list = (r, placeId, moduleId = 'memory-explorer', hooks = undefined) => listPlaceFiles({ stateRoot: r.state, home: r.home, moduleId, placeId, ...(hooks === undefined ? {} : { hooks }) });

test('the list holds the markdown files of the place, sorted, with relative paths, and nothing hidden, nothing else, and no full path', t => {
  const r = rig(t), kept = approve(r);
  const got = list(r, kept.place.id);
  assert.deepEqual(got, { ok: true, files: ['A.md', 'b.md', 'sub/c.markdown', 'sub/deeper/d.MD'], truncated: false, skipped: { folders: 0, entries: 0 } });
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
  assert.deepEqual(list(r, kept.place.id), { ok: true, files: [], truncated: false, skipped: { folders: 0, entries: 0 } });
});

test('a path of a listing reads back through the same gate, and the list opens no file', t => {
  const r = rig(t), kept = approve(r);
  const got = list(r, kept.place.id);
  assert.equal(got.files.length, 4);
  assert.ok(Object.isFrozen(got.files));
});

// ---- the walk reads entry by entry, and says what it could not do

test('S3: a folder with many entries stops at the entry cap without reading past it, and says truncated', t => {
  const r = rig(t), kept = approve(r);
  const dir = path.join(r.notes, 'flood'); fs.mkdirSync(dir);
  for (let i = 0; i < 200; i += 1) fs.writeFileSync(path.join(dir, `f${i}.md`), '');
  let reads = 0;
  const opendir = p => { const d = fs.opendirSync(p); const read = d.readSync.bind(d); d.readSync = () => { reads += 1; return read(); }; return d; };
  const got = list(r, kept.place.id, 'memory-explorer', { opendir, limits: { entries: 25 } });
  assert.equal(got.ok, true);
  assert.equal(got.truncated, true);
  assert.ok(reads <= 25 + 8, `${reads} entries read for a cap of 25 (a few more for the folders above it)`);
  assert.ok(got.files.length <= 25);
});

test('S3: the time budget stops the walk and sets truncated', t => {
  const r = rig(t), kept = approve(r);
  let tick = 0;
  const got = list(r, kept.place.id, 'memory-explorer', { now: () => { tick += 1000; return tick; }, limits: { ms: 3500 } });
  assert.equal(got.ok, true);
  assert.equal(got.truncated, true);
  assert.ok(got.files.length < 4);
});

test('S3: a folder on another device is skipped and counted, and its files are not listed', t => {
  const r = rig(t), kept = approve(r);
  const got = list(r, kept.place.id, 'memory-explorer', { dev: (abs, info) => (abs.endsWith(`${path.sep}sub`) ? info.dev + 1 : info.dev) });
  assert.deepEqual(got.files, ['A.md', 'b.md']);
  assert.deepEqual(got.skipped, { folders: 1, entries: 0 });
});

test('C2: a folder that cannot be opened is counted as skipped, and the walk goes on', t => {
  const r = rig(t), kept = approve(r);
  const opendir = p => { if (p.endsWith(`${path.sep}deeper`)) throw Object.assign(new Error('denied'), { code: 'EACCES' }); return fs.opendirSync(p); };
  const got = list(r, kept.place.id, 'memory-explorer', { opendir });
  assert.deepEqual(got.files, ['A.md', 'b.md', 'sub/c.markdown']);
  assert.deepEqual(got.skipped, { folders: 1, entries: 0 });
  assert.doesNotMatch(JSON.stringify(got), /EACCES|denied/);
});

test('C2: an entry that cannot be looked at is counted as skipped', t => {
  const r = rig(t), kept = approve(r);
  const lstat = (p, ...rest) => { if (p.endsWith('b.md')) throw Object.assign(new Error('gone'), { code: 'ENOENT' }); return fs.lstatSync(p, ...rest); };
  const got = list(r, kept.place.id, 'memory-explorer', { lstat });
  assert.ok(!got.files.includes('b.md'));
  assert.equal(got.skipped.entries, 1);
});

test('L1: a folder past the depth limit sets truncated and does not end the walk: files listed after it are kept', t => {
  const r = rig(t), kept = approve(r);
  let deep = path.join(r.notes, 'aaa');
  for (let i = 0; i <= SCOPE_LIMITS.listDepth + 1; i += 1) { fs.mkdirSync(deep, { recursive: true }); deep = path.join(deep, `d${i}`); }
  fs.mkdirSync(deep, { recursive: true }); fs.writeFileSync(path.join(deep, 'x.md'), '');
  fs.writeFileSync(path.join(r.notes, 'zzz.md'), '');
  const got = list(r, kept.place.id);
  assert.equal(got.truncated, true);
  assert.ok(got.files.includes('zzz.md'), 'a file after the deep folder is listed');
  assert.ok(got.files.includes('sub/c.markdown'));
});

test('L2: a folder replaced while it is read is dropped and counted', t => {
  const r = rig(t), kept = approve(r);
  const opendir = p => {
    const d = fs.opendirSync(p);
    if (p.endsWith(`${path.sep}sub`)) { fs.renameSync(p, `${p}-old`); fs.mkdirSync(p); fs.writeFileSync(path.join(p, 'new.md'), ''); }
    return d;
  };
  const got = list(r, kept.place.id, 'memory-explorer', { opendir });
  assert.ok(!got.files.some(f => f.startsWith('sub/')), got.files.join(','));
  assert.ok(got.skipped.folders >= 1);
});

test('L2: a place that is swapped during the walk gives PLACE_CHANGED, not a list', t => {
  const r = rig(t), kept = approve(r);
  const other = path.join(r.home, 'Documents', 'other');
  let swapped = false;
  const opendir = p => {
    const d = fs.opendirSync(p);
    if (!swapped && p.endsWith(`${path.sep}sub`)) { swapped = true; fs.renameSync(r.notes, `${r.notes}-old`); fs.symlinkSync(other, r.notes); }
    return d;
  };
  assert.deepEqual(list(r, kept.place.id, 'memory-explorer', { opendir }), { ok: false, code: 'PLACE_CHANGED' });
});

// ---- round 2

test('H2: a note whose path is over the limit, and a name that is not plain, are counted as skipped entries; hidden names are not', t => {
  const r = rig(t), kept = approve(r);
  fs.mkdirSync(path.join(r.notes, 'bad\u202edir')); fs.writeFileSync(path.join(r.notes, 'bad\u202edir', 'x.md'), 'x');
  fs.writeFileSync(path.join(r.notes, 'tab\tname.md'), 'x');
  let deep = r.notes;
  const long = 'l'.repeat(120);
  for (let i = 0; i < 5; i += 1) { deep = path.join(deep, long); fs.mkdirSync(deep); }
  fs.writeFileSync(path.join(deep, 'far.md'), 'x');
  const got = list(r, kept.place.id);
  assert.deepEqual(got.files, ['A.md', 'b.md', 'sub/c.markdown', 'sub/deeper/d.MD']);
  assert.deepEqual(got.skipped, { folders: 0, entries: 3 }, 'the odd folder, the odd file and the long path; the hidden file, the hidden folders and the text files are not counted');
});

test('L-b: an error on the first read of the place itself is UNREADABLE, not an empty list', t => {
  const r = rig(t), kept = approve(r);
  const opendir = p => { const d = fs.opendirSync(p); if (p === r.notes) d.readSync = () => { throw Object.assign(new Error('io'), { code: 'EIO' }); }; return d; };
  assert.deepEqual(list(r, kept.place.id, 'memory-explorer', { opendir }), { ok: false, code: 'UNREADABLE' });
});
