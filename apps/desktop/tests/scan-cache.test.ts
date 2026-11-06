// The file of the saved read (main/scan-cache.ts): written for its owner only, in one atomic step, below the private state folder; loaded as untrusted input, so a damaged,
// wrong-version, oversized or linked file gives a plain reason and never a crash or a half-loaded read. Every folder here is a temporary one made for the test.
import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, lstatSync, mkdirSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cacheDir, cachePath, createScanCache } from '../main/scan-cache.js';
import { SAVED_SCAN_VERSION } from '../shared/real/saved-scan.js';
import type { SavedScan } from '../shared/real/saved-scan.js';
import type { RealPlace, RealResult } from '../shared/real/types.js';
import { generateWorld } from '../shared/world/sample.js';
import { tempDir } from './support.js';

const place: RealPlace = {
  id: 'place-0123456789ab', label: 'Claude Code at home', kind: 'home', apps: ['Claude Code'], appLabel: 'Claude Code', counts: { agents: 1, skills: 2, tools: 0, hooks: 0, notes: 0 }, empty: false,
  details: { path: '~', folders: ['.claude'], topics: [], notes: [] },
};
const result: RealResult = { world: generateWorld(1), others: [], counts: place.counts, ages: {}, stoppedEarly: false, couldNotRead: 0, partlyRead: 0, textsCut: 0, notes: [], readOnly: true };
const scan = (at = 1_000): SavedScan => ({ version: SAVED_SCAN_VERSION, savedAtMs: at, fingerprint: 'b'.repeat(64), chosen: [place], result });

test('a saved read goes to the state folder and comes back the same', t => {
  const root = tempDir(t), cache = createScanCache({ stateRoot: root });
  assert.deepEqual(cache.load(), { status: 'none' });
  assert.equal(cache.save(scan()), true);
  const back = cache.load();
  assert.equal(back.status, 'ok');
  assert.deepEqual(back.status === 'ok' ? back.scan : null, scan());
  assert.ok(cachePath(root).startsWith(root), 'below the state folder');
});

test('the file is for its owner only, the folder too, and no temporary file is left', t => {
  const root = tempDir(t), cache = createScanCache({ stateRoot: root });
  cache.save(scan());
  assert.equal(lstatSync(cachePath(root)).mode & 0o777, 0o600);
  assert.equal(lstatSync(cacheDir(root)).mode & 0o777, 0o700);
  assert.deepEqual(readdirSync(cacheDir(root)), ['last-read.json']);
  // A looser folder from an earlier run is tightened by the next save.
  chmodSync(cacheDir(root), 0o755);
  cache.save(scan(2_000));
  assert.equal(lstatSync(cacheDir(root)).mode & 0o777, 0o700);
});

test('a second save replaces the first in one step, and a read that is too big removes the old one', t => {
  const root = tempDir(t), cache = createScanCache({ stateRoot: root });
  cache.save(scan(1_000));
  cache.save(scan(2_000));
  const now = cache.load();
  assert.equal(now.status === 'ok' ? now.scan.savedAtMs : null, 2_000);
  // Too big to keep: nothing is written, and the old read goes too, so a later launch never shows a read older than the last one.
  const small = createScanCache({ stateRoot: root, maxBytes: 200 });
  assert.equal(small.save(scan(3_000)), false);
  assert.deepEqual(readdirSync(cacheDir(root)), [], 'no temporary file, and the old read is removed');
  assert.deepEqual(cache.load(), { status: 'none' });
});

test('a save that cannot be made gives false and never throws', t => {
  const root = tempDir(t);
  writeFileSync(join(root, 'a-file'), 'x');
  assert.equal(createScanCache({ stateRoot: join(root, 'a-file', 'below') }).save(scan()), false, 'the state folder is below a file');
});

test('a file that is not JSON, or has the wrong shape, is damaged', t => {
  const root = tempDir(t), cache = createScanCache({ stateRoot: root });
  mkdirSync(cacheDir(root), { mode: 0o700 });
  for (const text of ['', '{', 'not json', '[]', '{"version":1}', JSON.stringify({ ...scan(), result: 'x' })]) {
    writeFileSync(cachePath(root), text, { mode: 0o600 });
    assert.deepEqual(cache.load(), { status: 'damaged', why: 'bad-shape' }, text);
  }
});

test('a file with another version is told apart from a broken one', t => {
  const root = tempDir(t), cache = createScanCache({ stateRoot: root });
  mkdirSync(cacheDir(root), { mode: 0o700 });
  writeFileSync(cachePath(root), JSON.stringify({ ...scan(), version: 2 }), { mode: 0o600 });
  assert.deepEqual(cache.load(), { status: 'damaged', why: 'wrong-version' });
});

test('a file over the size cap is not read at all', t => {
  const root = tempDir(t), cache = createScanCache({ stateRoot: root, maxBytes: 1_000 });
  mkdirSync(cacheDir(root), { mode: 0o700 });
  writeFileSync(cachePath(root), JSON.stringify(scan()) + ' '.repeat(2_000), { mode: 0o600 });
  assert.deepEqual(cache.load(), { status: 'damaged', why: 'too-big' });
});

test('a read that the window could not draw is damaged, even when its shape looks right', t => {
  const root = tempDir(t), cache = createScanCache({ stateRoot: root });
  mkdirSync(cacheDir(root), { mode: 0o700 });
  // The items are a list, so the shape holds, but the one item is not an item.
  const odd = { ...scan(), result: { ...result, world: { ...result.world, items: [5] } } };
  writeFileSync(cachePath(root), JSON.stringify(odd), { mode: 0o600 });
  assert.deepEqual(cache.load(), { status: 'damaged', why: 'bad-shape' });
});

test('a file that is a link is refused, and a save does not write through it', t => {
  const root = tempDir(t), cache = createScanCache({ stateRoot: root }), elsewhere = join(tempDir(t), 'target.json');
  writeFileSync(elsewhere, JSON.stringify(scan()), { mode: 0o600 });
  mkdirSync(cacheDir(root), { mode: 0o700 });
  symlinkSync(elsewhere, cachePath(root));
  assert.deepEqual(cache.load(), { status: 'damaged', why: 'linked' });
  const before = readFileSync(elsewhere, 'utf8');
  assert.equal(cache.save(scan(5_000)), true, 'the link is replaced by a file of our own');
  assert.equal(readFileSync(elsewhere, 'utf8'), before, 'the target of the link is untouched');
  assert.equal(lstatSync(cachePath(root)).isSymbolicLink(), false);
});

test('a folder that is a link is refused for a load and for a save', t => {
  const root = tempDir(t), cache = createScanCache({ stateRoot: root }), elsewhere = tempDir(t);
  writeFileSync(join(elsewhere, 'last-read.json'), JSON.stringify(scan()), { mode: 0o600 });
  symlinkSync(elsewhere, cacheDir(root));
  assert.deepEqual(cache.load(), { status: 'damaged', why: 'linked' });
  assert.equal(cache.save(scan(7_000)), false);
  assert.deepEqual(readdirSync(elsewhere), ['last-read.json'], 'nothing was written through the link');
});

test('a file that is a folder, or cannot be opened, is damaged and never throws', t => {
  const root = tempDir(t), cache = createScanCache({ stateRoot: root });
  mkdirSync(cachePath(root), { recursive: true });
  assert.deepEqual(cache.load(), { status: 'damaged', why: 'linked' }, 'not a plain file');
  const second = tempDir(t), other = createScanCache({ stateRoot: second });
  other.save(scan());
  chmodSync(cachePath(second), 0o000);
  const got = other.load();
  chmodSync(cachePath(second), 0o600);
  assert.deepEqual(got, { status: 'damaged', why: 'unreadable' });
});
