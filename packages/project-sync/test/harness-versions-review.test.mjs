// Bowerloom 0.8 save step, review fixes of the version store: limits that match the harness, an up-front check that a
// save point can be kept, a missing index that is never read as empty, and the gated "set the old save points aside".
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import {
  VERSION_LIMITS, checkVersionsFit, harnessStateDirs, listVersions, planSetAsideVersions, readVersion, recordVersion, setAsideVersions,
  setAsideVersionsLocked,
} from '../../../dist/packages/project-sync/src/index.js';
import { recordVersionWith } from '../../../dist/packages/project-sync/src/versions.js';
import { chmodTree, code } from './portable-fixture.mjs';

const sha = b => createHash('sha256').update(b).digest('hex');
const NOW = new Date('2026-10-30T12:00:00.900Z');
const meta = (revision = 'rev-1', label = 'Saved', now = NOW) => ({ revision, label, now });
const files = (n, size = 4, prefix = 'skills/big/references') => Array.from({ length: n }, (_, i) => ({ path: `${prefix}/${String(i).padStart(4, '0')}.md`, bytes: Buffer.alloc(size, 97 + (i % 26)) }));

function world(t) {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'bowerloom-versions-review-'))); fs.chmodSync(base, 0o700);
  t.after(() => { chmodTree(base); fs.rmSync(base, { recursive: true, force: true }); });
  const dir = path.join(base, 'project'); fs.mkdirSync(dir, { mode: 0o755 });
  const stateRoot = path.join(base, 'state', 'bowerloom'); fs.mkdirSync(stateRoot, { recursive: true, mode: 0o700 });
  const dirs = harnessStateDirs(stateRoot, dir);
  const store = path.join(dirs.base, 'versions');
  return { base, dir, dirs, store, index: path.join(store, 'index.json'), blobs: path.join(store, 'blobs') };
}
const blobNames = w => fs.existsSync(w.blobs) ? fs.readdirSync(w.blobs).filter(n => /^[0-9a-f]{64}$/.test(n)).sort() : [];

// ---- finding 2: the limits of a save point -------------------------------------------------------------------------------

test('a save point of 201 files is kept, twice, and each reads back whole', t => {
  const w = world(t);
  const first = files(201), second = [...files(201), { path: 'harness.json', bytes: Buffer.from('{}\n') }];
  assert.equal(recordVersion(w.dirs, 'definition', first, meta('r1')).files.length, 201);
  assert.equal(recordVersion(w.dirs, 'definition', second, meta('r2')).files.length, 202);
  assert.deepEqual(listVersions(w.dirs, 'definition').map(v => v.id), ['v2', 'v1']);
  assert.equal(readVersion(w.dirs, 'definition', 'v1').files.length, 201);
  assert.equal(readVersion(w.dirs, 'definition', 'v2').files.length, 202);
});

test('a save point over 8 MiB is kept, twice, and each reads back whole', t => {
  const w = world(t);
  // Nine files of 1 MiB less one byte: past the old 8 MiB cap, within the harness limit of 32 MiB.
  const big = files(9, VERSION_LIMITS.fileBytes - 1);
  assert.ok(big.reduce((n, f) => n + f.bytes.length, 0) > 8 * 1024 * 1024);
  recordVersion(w.dirs, 'definition', big, meta('r1'));
  recordVersion(w.dirs, 'definition', [...big, { path: 'harness.json', bytes: Buffer.from('{}\n') }], meta('r2'));
  const back = readVersion(w.dirs, 'definition', 'v1');
  assert.equal(back.files.length, 9);
  for (const f of back.files) assert.equal(sha(f.bytes), sha(big.find(b => b.path === f.path).bytes));
  assert.equal(readVersion(w.dirs, 'definition', 'v2').files.length, 10);
});

test('the store limits reach the harness limits; the index of 1 MiB is the one bound below them', () => {
  assert.equal(VERSION_LIMITS.files, 4096);
  assert.equal(VERSION_LIMITS.bytes, 32 * 1024 * 1024);
  assert.equal(VERSION_LIMITS.index, 1024 * 1024);
});

test('checkVersionsFit says up front whether the save points before and after a save can both be kept', () => {
  assert.doesNotThrow(() => checkVersionsFit('definition', [files(201), files(250)]));
  assert.doesNotThrow(() => checkVersionsFit('definition', [files(9, VERSION_LIMITS.fileBytes - 1), files(9, VERSION_LIMITS.fileBytes - 1)]));
  // Long paths: one set fits the index alone, two do not.
  const wide = files(1500, 1, `skills/${'d'.repeat(300)}`);
  assert.doesNotThrow(() => checkVersionsFit('definition', [wide]));
  assert.throws(() => checkVersionsFit('definition', [wide, wide]), code('VERSION_TOO_LARGE'));
  assert.throws(() => checkVersionsFit('definition', [files(VERSION_LIMITS.files + 1)]), code('VERSION_TOO_LARGE'));
  assert.throws(() => checkVersionsFit('a/b', [files(1)]), code('VERSION_USAGE'));
});

test('two save points that checkVersionsFit passes are both kept by recordVersion', t => {
  const w = world(t);
  const a = files(1200, 1, `skills/${'a'.repeat(200)}`), b = files(1200, 2, `skills/${'a'.repeat(200)}`);
  checkVersionsFit('definition', [a, b]);
  recordVersion(w.dirs, 'definition', a, meta('r1'));
  recordVersion(w.dirs, 'definition', b, meta('r2'));
  assert.deepEqual(listVersions(w.dirs, 'definition').map(v => v.id), ['v2', 'v1'], 'neither one was dropped to fit the index');
});

// ---- finding 7: a missing index with blobs left behind ------------------------------------------------------------------

test('a deleted index with blobs left behind is VERSION_CORRUPT for list, read, and record, and the blobs stay', t => {
  const w = world(t);
  recordVersion(w.dirs, 'definition', files(3), meta('r1'));
  const kept = blobNames(w);
  assert.ok(kept.length > 0);
  fs.unlinkSync(w.index);
  assert.throws(() => listVersions(w.dirs, 'definition'), code('VERSION_CORRUPT'));
  assert.throws(() => readVersion(w.dirs, 'definition', 'v1'), code('VERSION_CORRUPT'));
  assert.throws(() => recordVersion(w.dirs, 'definition', files(2), meta('r2')), code('VERSION_CORRUPT'));
  assert.deepEqual(blobNames(w), kept, 'no orphan blob was erased');
  assert.equal(fs.existsSync(w.index), false);
});

test('a first record that stops after its blobs leaves an empty index, so the store still reads, and the next record cleans up', t => {
  const w = world(t);
  const stop = new Error('stop');
  assert.throws(() => recordVersionWith(w.dirs, 'definition', files(2), meta('r1'), { afterBlobs: () => { throw stop; } }), e => e === stop);
  assert.ok(fs.existsSync(w.index), 'the empty index came first');
  assert.ok(blobNames(w).length > 0);
  assert.deepEqual(listVersions(w.dirs, 'definition'), []);
  recordVersion(w.dirs, 'definition', files(1, 9), meta('r2'));
  assert.deepEqual(blobNames(w), [sha(Buffer.alloc(9, 97))]);
});

test('setting the old save points aside renames the store to a dated folder, deletes nothing, and a new record starts over', async t => {
  const w = world(t);
  recordVersion(w.dirs, 'definition', files(3), meta('r1'));
  const kept = blobNames(w);
  fs.unlinkSync(w.index);
  const plan = planSetAsideVersions(w.dirs);
  assert.equal(plan.damaged, true);
  assert.match(plan.revision, /^[a-f0-9]{64}$/);
  assert.deepEqual(planSetAsideVersions(w.dirs), plan, 'planning reads only');
  assert.throws(() => setAsideVersions(w.dirs, 'f'.repeat(64), NOW), code('VERSION_STALE'));
  const r = await setAsideVersionsLocked(w.dirs, w.dir, plan.revision, NOW);
  assert.equal(r.name, 'versions-set-aside-20261030T120000Z');
  const aside = path.join(w.dirs.base, r.name);
  assert.deepEqual(fs.readdirSync(path.join(aside, 'blobs')).filter(n => /^[0-9a-f]{64}$/.test(n)).sort(), kept, 'every blob is kept, aside');
  assert.equal(fs.lstatSync(aside).mode & 0o777, 0o700);
  assert.equal(fs.existsSync(w.store), false);
  assert.deepEqual(listVersions(w.dirs, 'definition'), []);
  assert.equal(recordVersion(w.dirs, 'definition', files(1), meta('r2')).id, 'v1');
  assert.throws(() => planSetAsideVersions({ ...w.dirs, base: path.join(w.base, 'nowhere', 'harness') }), code('VERSION_NOTHING'));
});

test('a corrupt index is set aside the same way; a second set-aside in the same second gets its own name', t => {
  const w = world(t);
  recordVersion(w.dirs, 'definition', files(1), meta('r1'));
  fs.writeFileSync(w.index, 'not json', { mode: 0o600 });
  assert.throws(() => listVersions(w.dirs, 'definition'), code('VERSION_CORRUPT'));
  const first = setAsideVersions(w.dirs, planSetAsideVersions(w.dirs).revision, NOW);
  recordVersion(w.dirs, 'definition', files(1), meta('r2'));
  const plan = planSetAsideVersions(w.dirs);
  assert.equal(plan.damaged, false, 'a whole store reads as whole');
  const second = setAsideVersions(w.dirs, plan.revision, NOW);
  assert.notEqual(second.name, first.name);
  assert.match(second.name, /^versions-set-aside-20261030T120000Z-2$/);
  assert.equal(fs.readFileSync(path.join(w.dirs.base, first.name, 'index.json'), 'utf8'), 'not json', 'the damaged index is kept as it was');
});

test('the set-aside plan changes when the store changes, so an old approval is refused', t => {
  const w = world(t);
  recordVersion(w.dirs, 'definition', files(1), meta('r1'));
  const plan = planSetAsideVersions(w.dirs);
  recordVersion(w.dirs, 'definition', files(2), meta('r2'));
  assert.notEqual(planSetAsideVersions(w.dirs).revision, plan.revision);
  assert.throws(() => setAsideVersions(w.dirs, plan.revision, NOW), code('VERSION_STALE'));
  assert.ok(fs.existsSync(w.store));
});
