// Bowerloom 0.8 save step, lane D: the version store behind "Go back". Synthetic folders only.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import {
  VERSION_FORMAT, VERSION_LIMITS, VERSION_REFUSAL_CODES, VersionRefusal, harnessStateDirs, listVersions, readVersion, recordVersion,
} from '../../../dist/packages/project-sync/src/index.js';
import { recordVersionWith } from '../../../dist/packages/project-sync/src/versions.js';
import { chmodTree, code } from './portable-fixture.mjs';

const mode = p => fs.lstatSync(p).mode & 0o777;
const sha = b => createHash('sha256').update(b).digest('hex');
const set = o => new Map(Object.entries(o).map(([k, v]) => [k, Buffer.from(v)]));
const NOW = new Date('2026-10-30T12:00:00.900Z');
const meta = (revision = 'rev-1', label = 'Before the first save', now = NOW) => ({ revision, label, now });

/** A real project folder, a state root beside it, and the shared layout, all inside one private temporary folder. */
function world(t) {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'bowerloom-versions-'))); fs.chmodSync(base, 0o700);
  t.after(() => { chmodTree(base); fs.rmSync(base, { recursive: true, force: true }); });
  const dir = path.join(base, 'project'); fs.mkdirSync(dir, { mode: 0o755 });
  const stateRoot = path.join(base, 'state', 'bowerloom'); fs.mkdirSync(stateRoot, { recursive: true, mode: 0o700 });
  const dirs = harnessStateDirs(stateRoot, dir);
  const store = path.join(dirs.base, 'versions');
  return { base, dir, stateRoot, dirs, store, index: path.join(store, 'index.json'), blobs: path.join(store, 'blobs') };
}
const blobNames = w => fs.existsSync(w.blobs) ? fs.readdirSync(w.blobs).sort() : [];
const rawIndex = w => JSON.parse(fs.readFileSync(w.index, 'utf8'));

// ---- round trip --------------------------------------------------------------------------------------------------------

test('versions: nothing recorded lists as empty, reading creates nothing, and an id is unknown', t => {
  const w = world(t);
  assert.deepEqual(listVersions(w.dirs, 'main'), []);
  assert.throws(() => readVersion(w.dirs, 'main', 'v1'), code('VERSION_UNKNOWN'));
  assert.deepEqual(fs.readdirSync(w.stateRoot), []);
});

test('versions: a record, list, and read round trip keeps every byte, in private files', t => {
  const w = world(t);
  const files = set({ 'harness.json': '{"id":"demo"}\n', 'skills/review/SKILL.md': '---\nname: review\n---\n\nBody ☃ \u{1F600}\n', 'empty.txt': '' });
  files.set('bin.dat', Buffer.from([0, 255, 1, 254, 10, 13]));
  const made = recordVersion(w.dirs, 'main', files, meta('rev-1', 'Before the first save'));

  assert.deepEqual(Object.keys(made).sort(), ['counter', 'created', 'files', 'id', 'label', 'parent', 'revision']);
  assert.equal(made.id, 'v1'); assert.equal(made.counter, 1); assert.equal(made.parent, null);
  assert.equal(made.revision, 'rev-1'); assert.equal(made.label, 'Before the first save');
  assert.equal(made.created, '2026-10-30T12:00:00Z');
  assert.deepEqual(made.files.map(f => f.path), ['bin.dat', 'empty.txt', 'harness.json', 'skills/review/SKILL.md']);
  for (const f of made.files) { assert.equal(f.sha256, sha(files.get(f.path))); assert.equal(f.bytes, files.get(f.path).length); }

  assert.deepEqual(listVersions(w.dirs, 'main'), [made]);
  const read = readVersion(w.dirs, 'main', 'v1');
  assert.deepEqual(read.entry, made);
  assert.deepEqual([...read.files.keys()].sort(), [...files.keys()].sort());
  for (const [p, b] of files) assert.deepEqual(Buffer.from(read.files.get(p)), b);

  const file = rawIndex(w);
  assert.equal(file.format, VERSION_FORMAT);
  assert.deepEqual(Object.keys(file).sort(), ['folders', 'format']);
  assert.equal(mode(w.index), 0o600); assert.equal(mode(w.store), 0o700); assert.equal(mode(w.blobs), 0o700); assert.equal(mode(w.dirs.base), 0o700);
  assert.deepEqual(fs.readdirSync(w.store).sort(), ['blobs', 'index.json']);
});

test('versions: a plain object of path to bytes is taken as a file set, and a text value is refused', t => {
  const w = world(t);
  const made = recordVersion(w.dirs, 'main', { 'harness.json': Buffer.from('{}\n'), 'a.md': new Uint8Array([104, 105]) }, meta());
  assert.deepEqual(made.files.map(f => f.path), ['a.md', 'harness.json']);
  assert.deepEqual(Buffer.from(readVersion(w.dirs, 'main', 'v1').files.get('a.md')), Buffer.from('hi'));
  assert.throws(() => recordVersion(w.dirs, 'main', { 'harness.json': '{}' }, meta()), code('VERSION_USAGE'));
});

test('versions: the clock is used when no time is given, and a label may be empty', t => {
  const w = world(t);
  const made = recordVersion(w.dirs, 'main', set({ 'harness.json': '{}' }), { revision: 'r', label: '' });
  assert.match(made.created, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  assert.equal(made.label, '');
});

// ---- content addressing ------------------------------------------------------------------------------------------------

test('versions: identical blobs are stored once, inside a version and across versions and folders', t => {
  const w = world(t);
  recordVersion(w.dirs, 'main', set({ 'a.md': 'same', 'b.md': 'same', 'c.md': 'one' }), meta('r1'));
  assert.deepEqual(blobNames(w), [sha('one'), sha('same')].sort());
  recordVersion(w.dirs, 'main', set({ 'a.md': 'same', 'c.md': 'two' }), meta('r2'));
  recordVersion(w.dirs, 'other', set({ 'z.md': 'same' }), meta('r3'));
  assert.deepEqual(blobNames(w), [sha('one'), sha('same'), sha('two')].sort());
  const sameBlob = fs.readFileSync(path.join(w.blobs, sha('same')));
  assert.equal(sameBlob.toString(), 'same');
  assert.equal(mode(path.join(w.blobs, sha('same'))), 0o600);
});

// ---- parent chain and counter ------------------------------------------------------------------------------------------

test('versions: the parent chain and the counter follow the order of the records, newest first in the list', t => {
  const w = world(t);
  const a = recordVersion(w.dirs, 'main', set({ 'f': '1' }), meta('r1'));
  const b = recordVersion(w.dirs, 'main', set({ 'f': '2' }), meta('r2'));
  const c = recordVersion(w.dirs, 'main', set({ 'f': '3' }), meta('r3'));
  assert.deepEqual([a, b, c].map(v => [v.id, v.counter, v.parent]), [['v1', 1, null], ['v2', 2, 'v1'], ['v3', 3, 'v2']]);
  assert.deepEqual(listVersions(w.dirs, 'main').map(v => v.id), ['v3', 'v2', 'v1']);
  assert.deepEqual(listVersions(w.dirs, 'main').map(v => v.revision), ['r3', 'r2', 'r1']);
  assert.equal(readVersion(w.dirs, 'main', 'v2').entry.parent, 'v1');
});

test('versions: each folder counts on its own', t => {
  const w = world(t);
  recordVersion(w.dirs, 'main', set({ f: '1' }), meta());
  recordVersion(w.dirs, 'main', set({ f: '2' }), meta());
  const other = recordVersion(w.dirs, 'other', set({ f: '9' }), meta());
  assert.deepEqual([other.id, other.counter, other.parent], ['v1', 1, null]);
});

// ---- caps --------------------------------------------------------------------------------------------------------------

test('versions: the limits are the documented ones', () => {
  assert.deepEqual({ ...VERSION_LIMITS }, { versions: 50, files: 200, bytes: 8 * 1024 * 1024, fileBytes: 1024 * 1024, folders: 64, index: 1024 * 1024 });
  assert.throws(() => { VERSION_LIMITS.versions = 1; }, TypeError);
});

test('versions: past the cap of versions the oldest goes, its own blobs go, shared blobs stay, and the counter never repeats', t => {
  const w = world(t);
  const cap = VERSION_LIMITS.versions;
  recordVersion(w.dirs, 'main', set({ keep: 'shared', own: 'only-in-first' }), meta('r0'));
  for (let i = 1; i < cap + 3; i++) recordVersion(w.dirs, 'main', set({ keep: 'shared', n: `n${i}` }), meta(`r${i}`));
  const list = listVersions(w.dirs, 'main');
  assert.equal(list.length, cap);
  assert.deepEqual(list.map(v => v.counter), Array.from({ length: cap }, (_, i) => cap + 3 - i));
  // v1, v2 and v3 are gone. The oldest kept is v4, and its parent still names the pruned v3.
  assert.throws(() => readVersion(w.dirs, 'main', 'v1'), code('VERSION_UNKNOWN'));
  assert.throws(() => readVersion(w.dirs, 'main', 'v3'), code('VERSION_UNKNOWN'));
  assert.equal(list.at(-1).id, 'v4'); assert.equal(list.at(-1).parent, 'v3');
  assert.equal(list[0].id, `v${cap + 3}`);
  assert.equal(fs.existsSync(path.join(w.blobs, sha('only-in-first'))), false);
  assert.equal(fs.existsSync(path.join(w.blobs, sha('shared'))), true);
  // Nothing on disk is unreferenced: the shared blob plus one per kept version.
  assert.equal(blobNames(w).length, 1 + cap);
  const next = recordVersion(w.dirs, 'main', set({ keep: 'shared', n: 'again' }), meta('rx'));
  assert.equal(next.id, `v${cap + 4}`); assert.equal(next.parent, `v${cap + 3}`);
});

test('versions: pruning one folder never touches another', t => {
  const w = world(t);
  recordVersion(w.dirs, 'other', set({ f: 'other-only' }), meta('o1'));
  for (let i = 0; i < VERSION_LIMITS.versions + 2; i++) recordVersion(w.dirs, 'main', set({ f: `m${i}` }), meta(`r${i}`));
  assert.equal(listVersions(w.dirs, 'other').length, 1);
  assert.equal(Buffer.from(readVersion(w.dirs, 'other', 'v1').files.get('f')).toString(), 'other-only');
});

test('versions: a file set at the limits is stored, and one past a limit is refused with nothing written', t => {
  const w = world(t);
  const many = Object.fromEntries(Array.from({ length: VERSION_LIMITS.files }, (_, i) => [`f/${i}.md`, `x${i}`]));
  assert.equal(recordVersion(w.dirs, 'many', set(many), meta()).files.length, VERSION_LIMITS.files);
  const before = fs.readFileSync(w.index);
  const blobsBefore = blobNames(w);
  assert.throws(() => recordVersion(w.dirs, 'many', set({ ...many, 'one-more.md': 'x' }), meta()), code('VERSION_TOO_LARGE'));

  const mib = n => Buffer.alloc(n, 7);
  const eight = new Map(Array.from({ length: 8 }, (_, i) => [`b${i}`, Buffer.concat([mib(VERSION_LIMITS.fileBytes - 1), Buffer.from([i])])]));
  assert.equal(recordVersion(w.dirs, 'big', eight, meta()).files.length, 8);
  const over = new Map(eight); over.set('b8', Buffer.from('x'));
  assert.throws(() => recordVersion(w.dirs, 'big', over, meta()), code('VERSION_TOO_LARGE'));
  assert.throws(() => recordVersion(w.dirs, 'huge', new Map([['f', mib(VERSION_LIMITS.fileBytes + 1)]]), meta()), code('VERSION_TOO_LARGE'));

  assert.equal(listVersions(w.dirs, 'many').length, 1);
  assert.deepEqual(listVersions(w.dirs, 'huge'), []);
  assert.equal(listVersions(w.dirs, 'big').length, 1);
  assert.notDeepEqual(fs.readFileSync(w.index), before); // the 'big' record changed it
  assert.deepEqual(blobNames(w).filter(n => blobsBefore.includes(n)), blobsBefore);
});

test('versions: an index that would pass its size limit drops the oldest versions of the folder, and keeps the new one', t => {
  const w = world(t);
  const long = i => Object.fromEntries(Array.from({ length: 200 }, (_, k) => [`${'d'.repeat(900)}/${i}-${k}.md`, `${k}`]));
  for (let i = 0; i < 8; i++) recordVersion(w.dirs, 'wide', set(long(i)), meta(`r${i}`));
  const list = listVersions(w.dirs, 'wide');
  assert.ok(list.length < 8 && list.length >= 1);
  assert.equal(list[0].id, 'v8');
  assert.ok(fs.statSync(w.index).size <= VERSION_LIMITS.index);
  assert.ok(readVersion(w.dirs, 'wide', 'v8').files.size === 200);
});

test('versions: the number of folders is bounded', t => {
  const w = world(t);
  for (let i = 0; i < VERSION_LIMITS.folders; i++) recordVersion(w.dirs, `f${i}`, set({ f: String(i) }), meta());
  assert.throws(() => recordVersion(w.dirs, 'one-too-many', set({ f: 'x' }), meta()), code('VERSION_TOO_LARGE'));
  assert.equal(recordVersion(w.dirs, 'f0', set({ f: 'again' }), meta()).id, 'v2');
});

// ---- atomic index write ------------------------------------------------------------------------------------------------

test('versions: a write that stops before the index lands leaves the earlier index, no temporary, and a clean next record', t => {
  const w = world(t);
  recordVersion(w.dirs, 'main', set({ f: 'first' }), meta('r1'));
  const before = fs.readFileSync(w.index);
  const crash = new Error('power cut');
  assert.throws(() => recordVersionWith(w.dirs, 'main', set({ f: 'second' }), meta('r2'), { beforeIndexRename: () => { throw crash; } }), e => e === crash);
  assert.deepEqual(fs.readFileSync(w.index), before);
  assert.deepEqual(fs.readdirSync(w.store).sort(), ['blobs', 'index.json']);
  assert.deepEqual(listVersions(w.dirs, 'main').map(v => v.id), ['v1']);
  assert.equal(Buffer.from(readVersion(w.dirs, 'main', 'v1').files.get('f')).toString(), 'first');
  // The blob of the lost write is an orphan. The next record removes it and takes the same counter.
  assert.ok(blobNames(w).includes(sha('second')));
  const next = recordVersion(w.dirs, 'main', set({ f: 'third' }), meta('r3'));
  assert.equal(next.id, 'v2'); assert.equal(next.parent, 'v1');
  assert.deepEqual(blobNames(w), [sha('first'), sha('third')].sort());
});

test('versions: a write that stops before any blob lands, or right after them, changes nothing', t => {
  const w = world(t);
  recordVersion(w.dirs, 'main', set({ f: 'first' }), meta('r1'));
  const before = fs.readFileSync(w.index);
  const crash = new Error('stop');
  assert.throws(() => recordVersionWith(w.dirs, 'main', set({ f: 'second' }), meta('r2'), { beforeBlobs: () => { throw crash; } }), e => e === crash);
  assert.deepEqual(blobNames(w), [sha('first')]);
  assert.throws(() => recordVersionWith(w.dirs, 'main', set({ f: 'second' }), meta('r2'), { afterBlobs: () => { throw crash; } }), e => e === crash);
  assert.deepEqual(fs.readFileSync(w.index), before);
  assert.deepEqual(listVersions(w.dirs, 'main').map(v => v.id), ['v1']);
});

test('versions: a stale writer temporary and a stray file do not break the store, and the next record sweeps the temporary', t => {
  const w = world(t);
  recordVersion(w.dirs, 'main', set({ f: 'first' }), meta('r1'));
  const stale = path.join(w.store, `.index.json.${'a'.repeat(16)}.bowerloom-tmp`);
  const staleBlob = path.join(w.blobs, `.${'b'.repeat(64)}.${'c'.repeat(16)}.bowerloom-tmp`);
  fs.writeFileSync(stale, '{ half a rec', { mode: 0o600 });
  fs.writeFileSync(staleBlob, 'half', { mode: 0o600 });
  assert.deepEqual(listVersions(w.dirs, 'main').map(v => v.id), ['v1']);
  recordVersion(w.dirs, 'main', set({ f: 'second' }), meta('r2'));
  assert.equal(fs.existsSync(stale), false); assert.equal(fs.existsSync(staleBlob), false);
});

// ---- missing and corrupt data ------------------------------------------------------------------------------------------

test('versions: a missing blob is refused VERSION_CORRUPT, never an empty file set', t => {
  const w = world(t);
  recordVersion(w.dirs, 'main', set({ a: 'alpha', b: 'beta' }), meta());
  fs.unlinkSync(path.join(w.blobs, sha('beta')));
  assert.throws(() => readVersion(w.dirs, 'main', 'v1'), e => e instanceof VersionRefusal && e.code === 'VERSION_CORRUPT');
  assert.deepEqual(listVersions(w.dirs, 'main').map(v => v.id), ['v1']);
});

test('versions: a changed blob, a short blob, and a blob that is a link are each refused VERSION_CORRUPT', t => {
  const w = world(t);
  recordVersion(w.dirs, 'main', set({ a: 'alpha', b: 'beta', c: 'gamma' }), meta());
  fs.writeFileSync(path.join(w.blobs, sha('alpha')), 'ALPHA');
  assert.throws(() => readVersion(w.dirs, 'main', 'v1'), code('VERSION_CORRUPT'));
  fs.writeFileSync(path.join(w.blobs, sha('alpha')), 'alpha');
  assert.equal(readVersion(w.dirs, 'main', 'v1').files.size, 3);
  fs.truncateSync(path.join(w.blobs, sha('beta')), 2);
  assert.throws(() => readVersion(w.dirs, 'main', 'v1'), code('VERSION_CORRUPT'));
  fs.writeFileSync(path.join(w.blobs, sha('beta')), 'beta');
  const target = path.join(w.base, 'elsewhere'); fs.writeFileSync(target, 'gamma');
  fs.unlinkSync(path.join(w.blobs, sha('gamma'))); fs.symlinkSync(target, path.join(w.blobs, sha('gamma')));
  assert.throws(() => readVersion(w.dirs, 'main', 'v1'), code('VERSION_CORRUPT'));
});

test('versions: a recorded blob that was damaged is written again by the next record of the same bytes', t => {
  const w = world(t);
  recordVersion(w.dirs, 'main', set({ a: 'alpha' }), meta('r1'));
  fs.writeFileSync(path.join(w.blobs, sha('alpha')), 'broken');
  recordVersion(w.dirs, 'main', set({ a: 'alpha' }), meta('r2'));
  assert.equal(Buffer.from(readVersion(w.dirs, 'main', 'v2').files.get('a')).toString(), 'alpha');
  assert.equal(Buffer.from(readVersion(w.dirs, 'main', 'v1').files.get('a')).toString(), 'alpha');
});

test('versions: a damaged or odd index is VERSION_CORRUPT for list, read, and record, and is left as it is', t => {
  const w = world(t);
  recordVersion(w.dirs, 'main', set({ f: 'x' }), meta());
  const good = fs.readFileSync(w.index);
  const bad = [
    'not json',
    '[]',
    JSON.stringify({ format: 'other', folders: [] }),
    JSON.stringify({ format: VERSION_FORMAT, folders: [], extra: 1 }),
    JSON.stringify({ format: VERSION_FORMAT, folders: [{ key: '../x', counter: 1, versions: [] }] }),
    JSON.stringify({ format: VERSION_FORMAT, folders: [{ key: 'main', counter: 0, versions: [{ id: 'v1', counter: 1, parent: null, revision: 'r', created: '2026-10-30T12:00:00Z', label: '', files: [{ path: 'f', sha256: 'zz', bytes: 1 }] }] }] }),
    JSON.stringify({ format: VERSION_FORMAT, folders: [{ key: 'main', counter: 1, versions: [{ id: 'v1', counter: 1, parent: null, revision: 'r', created: '2026-10-30T12:00:00Z', label: '', files: [{ path: '../f', sha256: sha('x'), bytes: 1 }] }] }] }),
    JSON.stringify({ format: VERSION_FORMAT, folders: [{ key: 'main', counter: 1, versions: [{ id: 'v9', counter: 1, parent: null, revision: 'r', created: '2026-10-30T12:00:00Z', label: '', files: [] }] }] }),
  ];
  for (const text of bad) {
    fs.writeFileSync(w.index, text, { mode: 0o600 });
    assert.throws(() => listVersions(w.dirs, 'main'), code('VERSION_CORRUPT'), text);
    assert.throws(() => readVersion(w.dirs, 'main', 'v1'), code('VERSION_CORRUPT'), text);
    assert.throws(() => recordVersion(w.dirs, 'main', set({ f: 'y' }), meta()), code('VERSION_CORRUPT'), text);
    assert.equal(fs.readFileSync(w.index, 'utf8'), text);
  }
  fs.writeFileSync(w.index, good, { mode: 0o600 });
  assert.equal(listVersions(w.dirs, 'main').length, 1);
});

test('versions: an index open to the group or others is refused as an unsafe state', t => {
  const w = world(t);
  recordVersion(w.dirs, 'main', set({ f: 'x' }), meta());
  fs.chmodSync(w.index, 0o644);
  assert.throws(() => listVersions(w.dirs, 'main'), code('PORTABLE_STATE_UNSAFE'));
  fs.chmodSync(w.index, 0o600); fs.chmodSync(w.store, 0o755);
  assert.throws(() => listVersions(w.dirs, 'main'), code('PORTABLE_STATE_UNSAFE'));
});

// ---- inputs ------------------------------------------------------------------------------------------------------------

test('versions: a folder key with a path character is refused by every call', t => {
  const w = world(t);
  const keys = ['', '.', '..', '../x', 'a/b', 'a\\b', '/abs', '.hidden', 'a..b/c', 'x\0y', 'a b', 'a\nb', 'é', 'x'.repeat(65), '__proto__', '-dash', 5, null, undefined, {}];
  for (const key of keys) {
    assert.throws(() => recordVersion(w.dirs, key, set({ f: 'x' }), meta()), code('VERSION_USAGE'), String(key));
    assert.throws(() => listVersions(w.dirs, key), code('VERSION_USAGE'), String(key));
    assert.throws(() => readVersion(w.dirs, key, 'v1'), code('VERSION_USAGE'), String(key));
  }
  assert.deepEqual(fs.readdirSync(w.stateRoot), []);
  // Plain keys that look odd but are safe.
  for (const key of ['main', 'A1', 'a-b_c', 'x'.repeat(64), '9', 'constructor']) assert.equal(recordVersion(w.dirs, key, set({ f: 'x' }), meta()).id, 'v1');
  assert.equal(listVersions(w.dirs, 'toString').length, 0);
});

test('versions: a bad file set is refused VERSION_USAGE and nothing is written', t => {
  const w = world(t);
  const bad = [
    null, undefined, 'files', [], new Map(), {},
    set({ '../f': 'x' }), set({ '/abs': 'x' }), set({ 'a//b': 'x' }), set({ 'a/./b': 'x' }), set({ 'a/../b': 'x' }), set({ 'a\\b': 'x' }),
    set({ 'a\0b': 'x' }), set({ 'a\nb': 'x' }), set({ '': 'x' }), set({ 'a/': 'x' }), set({ ['p'.repeat(1025)]: 'x' }),
    new Map([[5, Buffer.from('x')]]), new Map([['f', 'text']]), new Map([['f', null]]), new Map([['f', 12]]),
  ];
  for (const files of bad) assert.throws(() => recordVersion(w.dirs, 'main', files, meta()), code('VERSION_USAGE'), String(files instanceof Map ? [...files.keys()] : files));
  assert.equal(fs.existsSync(w.store), false);
});

test('versions: a bad meta is refused VERSION_USAGE', t => {
  const w = world(t);
  const f = set({ f: 'x' });
  const bad = [
    null, undefined, 'r', {}, { revision: 'r' }, { label: 'l' }, { revision: '', label: 'l' }, { revision: 'r r', label: 'l' }, { revision: 5, label: 'l' },
    { revision: 'x'.repeat(129), label: 'l' }, { revision: 'r', label: 5 }, { revision: 'r', label: 'a\nb' }, { revision: 'r', label: 'a\u0000b' },
    { revision: 'r', label: 'x'.repeat(201) }, { revision: 'r', label: 'l', now: 'today' }, { revision: 'r', label: 'l', now: new Date('nope') },
    { revision: 'r', label: 'l', extra: 1 },
  ];
  for (const m of bad) assert.throws(() => recordVersion(w.dirs, 'main', f, m), code('VERSION_USAGE'), JSON.stringify(m));
  assert.equal(fs.existsSync(w.store), false);
});

test('versions: a bad id is unknown, whatever its shape', t => {
  const w = world(t);
  recordVersion(w.dirs, 'main', set({ f: 'x' }), meta());
  for (const id of ['v0', 'v2', 'V1', '../v1', 'v1/../v1', '', 'v01', 'v1 ', '__proto__', 'index.json', 5, null, undefined]) {
    assert.throws(() => readVersion(w.dirs, 'main', id), code('VERSION_UNKNOWN'), String(id));
  }
});

test('versions: a layout that is not a harness layout is refused', t => {
  const w = world(t);
  const f = set({ f: 'x' });
  for (const dirs of [null, undefined, 'x', {}, { base: 'relative/harness' }, { base: path.join(w.stateRoot, 'a', 'not-harness') }, { base: `${w.dirs.base}/` }, { base: `${w.dirs.base}/../harness` }, { base: 5 }]) {
    assert.throws(() => recordVersion(dirs, 'main', f, meta()), code('PORTABLE_USAGE'));
    assert.throws(() => listVersions(dirs, 'main'), code('PORTABLE_USAGE'));
    assert.throws(() => readVersion(dirs, 'main', 'v1'), code('PORTABLE_USAGE'));
  }
});

test('versions: a state folder that is a link is refused and nothing is written through it', t => {
  const w = world(t);
  const elsewhere = path.join(w.base, 'elsewhere'); fs.mkdirSync(elsewhere, { mode: 0o700 });
  fs.mkdirSync(w.dirs.base, { recursive: true, mode: 0o700 });
  fs.symlinkSync(elsewhere, w.store);
  assert.throws(() => recordVersion(w.dirs, 'main', set({ f: 'x' }), meta()), code('PORTABLE_STATE_UNSAFE'));
  assert.throws(() => listVersions(w.dirs, 'main'), code('PORTABLE_STATE_UNSAFE'));
  assert.deepEqual(fs.readdirSync(elsewhere), []);
});

// ---- folders do not leak -----------------------------------------------------------------------------------------------

test('versions: folders do not leak into each other, by list, by read, or by a shared id', t => {
  const w = world(t);
  recordVersion(w.dirs, 'one', set({ 'harness.json': 'ONE' }), meta('r-one', 'one label'));
  recordVersion(w.dirs, 'one', set({ 'harness.json': 'ONE-2' }), meta('r-one-2'));
  recordVersion(w.dirs, 'two', set({ 'harness.json': 'TWO', 'extra.md': 'only two' }), meta('r-two', 'two label'));
  assert.deepEqual(listVersions(w.dirs, 'one').map(v => v.revision), ['r-one-2', 'r-one']);
  assert.deepEqual(listVersions(w.dirs, 'two').map(v => v.revision), ['r-two']);
  assert.deepEqual(listVersions(w.dirs, 'three'), []);
  // The id v2 exists in 'one' only.
  assert.throws(() => readVersion(w.dirs, 'two', 'v2'), code('VERSION_UNKNOWN'));
  assert.throws(() => readVersion(w.dirs, 'three', 'v1'), code('VERSION_UNKNOWN'));
  // The id v1 exists in both, and each read gives its own folder's bytes.
  const one = readVersion(w.dirs, 'one', 'v1'), two = readVersion(w.dirs, 'two', 'v1');
  assert.equal(Buffer.from(one.files.get('harness.json')).toString(), 'ONE'); assert.equal(one.files.has('extra.md'), false);
  assert.equal(Buffer.from(two.files.get('harness.json')).toString(), 'TWO'); assert.equal(two.files.has('extra.md'), true);
  assert.equal(one.entry.label, 'one label'); assert.equal(two.entry.label, 'two label');
});

test('versions: two projects keep their own stores', t => {
  const w = world(t);
  const dir2 = path.join(w.base, 'project2'); fs.mkdirSync(dir2, { mode: 0o755 });
  const dirs2 = harnessStateDirs(w.stateRoot, dir2);
  recordVersion(w.dirs, 'main', set({ f: 'a' }), meta());
  assert.deepEqual(listVersions(dirs2, 'main'), []);
});

test('versions: a returned entry and file set are copies, so a caller cannot change the store through them', t => {
  const w = world(t);
  const input = set({ f: 'abc' });
  const made = recordVersion(w.dirs, 'main', input, meta());
  input.get('f')[0] = 0; input.set('g', Buffer.from('x'));
  assert.throws(() => { made.files[0].path = 'changed'; }, TypeError);
  const read = readVersion(w.dirs, 'main', 'v1');
  assert.equal(Buffer.from(read.files.get('f')).toString(), 'abc');
  read.files.get('f')[0] = 0;
  assert.equal(Buffer.from(readVersion(w.dirs, 'main', 'v1').files.get('f')).toString(), 'abc');
  assert.equal(listVersions(w.dirs, 'main')[0].files.length, 1);
});

test('versions: the refusal codes are listed, each refusal is a VersionRefusal, and no message carries a path', t => {
  assert.deepEqual([...VERSION_REFUSAL_CODES].sort(), ['VERSION_CORRUPT', 'VERSION_TOO_LARGE', 'VERSION_UNKNOWN', 'VERSION_USAGE']);
  const w = world(t);
  const secret = 'folder-named-with-a-recognizable-token';
  recordVersion(w.dirs, secret, set({ f: 'x' }), meta());
  for (const f of [() => readVersion(w.dirs, secret, 'v9'), () => recordVersion(w.dirs, 'a/b', set({ f: 'x' }), meta())]) {
    try { f(); assert.fail('should refuse'); } catch (e) {
      assert.ok(e instanceof VersionRefusal);
      assert.ok(!e.message.includes(w.base), e.message);
      assert.ok(!e.message.includes(secret), e.message);
    }
  }
});
