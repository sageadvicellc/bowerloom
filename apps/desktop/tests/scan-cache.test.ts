// The file of the saved read (main/scan-cache.ts): written for its owner only, in one atomic step, below the private state folder; loaded as untrusted input, so a damaged,
// wrong-version, oversized or linked file gives a plain reason and never a crash or a half-loaded read. Every folder here is a temporary one made for the test.
import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cacheDir, cachePath, createScanCache } from '../main/scan-cache.js';
import { SAVED_SCAN_VERSION } from '../shared/real/saved-scan.js';
import type { SavedScan } from '../shared/real/saved-scan.js';
import type { RealPlace, RealResult } from '../shared/real/types.js';
import { generateWorld } from '../shared/world/sample.js';
import { writeSync as writeSyncReal } from 'node:fs';
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

// ---- a short write, a crash, a file that is not private, a file that is not believed

test('a save writes every byte even when the disk takes a few at a time', t => {
  const root = tempDir(t), seen: number[] = [];
  const slow = (fd: number, buffer: Buffer, offset: number, length: number): number => { const n = Math.min(length, 4_096); seen.push(n); return writeSyncReal(fd, buffer, offset, n); };
  const cache = createScanCache({ stateRoot: root, write: slow });
  assert.equal(cache.save(scan()), true);
  assert.ok(seen.length > 1, 'more than one write');
  assert.deepEqual(cache.load().status === 'ok' ? (cache.load() as { scan: SavedScan }).scan : null, scan());
});

test('a write that takes nothing is a failed save: the old read stays whole, and no temporary file is left', t => {
  const root = tempDir(t), good = createScanCache({ stateRoot: root });
  good.save(scan(1_000));
  const before = readFileSync(cachePath(root), 'utf8');
  const full = createScanCache({ stateRoot: root, write: () => 0 });
  assert.equal(full.save(scan(2_000)), false);
  assert.equal(readFileSync(cachePath(root), 'utf8'), before);
  assert.deepEqual(readdirSync(cacheDir(root)), ['last-read.json']);
});

test('a save that throws leaves the old read whole too; removing it is the caller\'s choice', t => {
  const root = tempDir(t);
  createScanCache({ stateRoot: root }).save(scan(1_000));
  const broken = createScanCache({ stateRoot: root, write: () => { throw new Error('disk'); } });
  assert.equal(broken.save(scan(2_000)), false);
  const back = createScanCache({ stateRoot: root }).load();
  assert.equal(back.status === 'ok' ? back.scan.savedAtMs : null, 1_000);
  assert.deepEqual(readdirSync(cacheDir(root)), ['last-read.json']);
});

test('a save clears the old temporary files a crash left, and leaves a fresh one alone', t => {
  const root = tempDir(t), cache = createScanCache({ stateRoot: root });
  cache.save(scan());
  const stale = join(cacheDir(root), 'last-read.123.abcdef012345.tmp'), fresh = join(cacheDir(root), 'last-read.456.fedcba987654.tmp'), other = join(cacheDir(root), 'notes.tmp');
  for (const file of [stale, fresh, other]) writeFileSync(file, 'x', { mode: 0o600 });
  const old = new Date(Date.now() - 3_600_000);
  utimesSync(stale, old, old); utimesSync(other, old, old);
  cache.save(scan(2_000));
  assert.equal(existsSync(stale), false, 'an hour-old temporary file of ours goes');
  assert.equal(existsSync(fresh), true, 'one that may belong to a save in progress stays');
  assert.equal(existsSync(other), true, 'a file that is not ours stays');
});

test('a file or folder that others can write to, or that another user owns, is not believed', t => {
  const root = tempDir(t), cache = createScanCache({ stateRoot: root });
  cache.save(scan());
  chmodSync(cachePath(root), 0o666);
  assert.deepEqual(cache.load(), { status: 'damaged', why: 'not-private' });
  chmodSync(cachePath(root), 0o620);
  assert.deepEqual(cache.load(), { status: 'damaged', why: 'not-private' }, 'group can write');
  chmodSync(cachePath(root), 0o600);
  chmodSync(cacheDir(root), 0o777);
  assert.deepEqual(cache.load(), { status: 'damaged', why: 'not-private' });
  chmodSync(cacheDir(root), 0o700);
  assert.equal(cache.load().status, 'ok');
  const other = createScanCache({ stateRoot: root, uid: (process.getuid?.() ?? 0) + 1 });
  assert.deepEqual(other.load(), { status: 'damaged', why: 'not-private' }, 'owned by someone else');
  assert.equal(other.save(scan()), false, 'and nothing is written there');
});

test('a file that is not believed is removed, so the next launch does not repeat the work; a file of another version and a link are left alone', t => {
  const root = tempDir(t), cache = createScanCache({ stateRoot: root, maxBytes: 5_000_000 });
  mkdirSync(cacheDir(root), { mode: 0o700 });
  writeFileSync(cachePath(root), '{"version":1', { mode: 0o600 });
  assert.equal(cache.load().status, 'damaged');
  assert.equal(existsSync(cachePath(root)), false, 'a broken file is removed');
  writeFileSync(cachePath(root), JSON.stringify({ ...scan(), version: 2 }), { mode: 0o600 });
  assert.equal(cache.load().status, 'damaged');
  assert.equal(existsSync(cachePath(root)), true, 'a file a newer app may have written is not ours to remove');
});

test('a file with 100,000 items is refused fast, told as damaged, and removed', t => {
  const root = tempDir(t), cache = createScanCache({ stateRoot: root });
  mkdirSync(cacheDir(root), { mode: 0o700 });
  const items = Array.from({ length: 100_000 }, (_, i) => ({ id: `i${i}`, kind: 'skill', name: 'n', scopeId: 's', foundAt: [], library: null, description: '' }));
  writeFileSync(cachePath(root), JSON.stringify({ ...scan(), result: { ...result, world: { ...result.world, items } } }), { mode: 0o600 });
  const started = Date.now();
  assert.deepEqual(cache.load(), { status: 'damaged', why: 'bad-shape' });
  assert.ok(Date.now() - started < 2_000);
  assert.equal(existsSync(cachePath(root)), false);
});
