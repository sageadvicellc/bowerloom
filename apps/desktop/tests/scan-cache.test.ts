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
import { smallResult } from './fixtures-real/small-result.js';
import { writeSync as writeSyncReal } from 'node:fs';
import { tempDir } from './support.js';
import { skipAsRoot } from '../../../tests/support/machine-skips.js';

const place: RealPlace = {
  id: 'place-0123456789ab', label: 'Claude Code at home', kind: 'home', apps: ['Claude Code'], appLabel: 'Claude Code', counts: { agents: 1, skills: 2, tools: 0, hooks: 0, notes: 0 }, empty: false,
  details: { path: '~', folders: ['.claude'], topics: [], notes: [] },
};
const result: RealResult = smallResult();
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

test('a folder that is a link is refused for a load, and a save moves it aside and writes nothing through it', t => {
  const root = tempDir(t), cache = createScanCache({ stateRoot: root }), elsewhere = tempDir(t);
  writeFileSync(join(elsewhere, 'last-read.json'), JSON.stringify(scan()), { mode: 0o600 });
  symlinkSync(elsewhere, cacheDir(root));
  assert.deepEqual(cache.load(), { status: 'damaged', why: 'linked' });
  assert.equal(cache.save(scan(7_000)), true);
  assert.deepEqual(readdirSync(elsewhere), ['last-read.json'], 'nothing was written through the link');
});

test('a file that is a folder, or cannot be opened, is damaged and never throws', { skip: skipAsRoot('a cache file at mode 000 cannot be opened') }, t => {
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
  const slow = (fd: number, buffer: Buffer, offset: number, length: number): number => { const n = Math.min(length, 256); seen.push(n); return writeSyncReal(fd, buffer, offset, n); };
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

test('a file past a cap is refused fast and told as damaged, but is left where it is: a wrong guess about a cap must never destroy a read', t => {
  const root = tempDir(t), cache = createScanCache({ stateRoot: root });
  mkdirSync(cacheDir(root), { mode: 0o700 });
  const items = Array.from({ length: 100_000 }, (_, i) => ({ id: `i${i}`, kind: 'skill' as const, name: 'n', scopeId: 's', foundAt: [], library: null, description: '' }));
  writeFileSync(cachePath(root), JSON.stringify({ ...scan(), result: { ...result, world: { ...result.world, items } } }), { mode: 0o600 });
  const started = Date.now();
  assert.deepEqual(cache.load(), { status: 'damaged', why: 'too-big' });
  assert.ok(Date.now() - started < 2_000);
  assert.equal(existsSync(cachePath(root)), true, 'the file stays until the next save replaces it');
  assert.equal(cache.save(scan(9)), true);
  assert.equal(cache.load().status, 'ok');
});

// ---- a folder that is not ours gives way, and a removal that fails says so

test('a folder that is a link, or not a folder, is moved aside by a save, and a folder of ours is made; what the link led to is untouched', t => {
  for (const kind of ['link', 'file'] as const) {
    const root = tempDir(t), elsewhere = tempDir(t);
    writeFileSync(join(elsewhere, 'last-read.json'), 'target', { mode: 0o600 });
    if (kind === 'link') symlinkSync(elsewhere, cacheDir(root)); else writeFileSync(cacheDir(root), 'in the way');
    const cache = createScanCache({ stateRoot: root });
    assert.equal(cache.save(scan()), true, kind);
    assert.equal(lstatSync(cacheDir(root)).isDirectory() && !lstatSync(cacheDir(root)).isSymbolicLink(), true, kind);
    assert.equal(cache.load().status, 'ok', kind);
    assert.ok(readdirSync(root).some(name => /^last-read\.bad\.[0-9a-f]{12}$/.test(name)), `${kind}: the old one is kept aside`);
    assert.equal(readFileSync(join(elsewhere, 'last-read.json'), 'utf8'), 'target', `${kind}: the other folder is untouched`);
  }
});

test('when the state folder is not ours either, nothing is moved and nothing is written', t => {
  const root = tempDir(t), elsewhere = tempDir(t);
  symlinkSync(elsewhere, cacheDir(root));
  const cache = createScanCache({ stateRoot: root, uid: (process.getuid?.() ?? 0) + 1 });
  assert.equal(cache.save(scan()), false);
  assert.equal(lstatSync(cacheDir(root)).isSymbolicLink(), true);
  assert.deepEqual(readdirSync(elsewhere), []);
});

test('forget says whether an older read is left: true when removed or never there, false when a link or a folder that is not private stands in the way', t => {
  const root = tempDir(t), cache = createScanCache({ stateRoot: root });
  assert.equal(cache.forget(), true, 'nothing there');
  cache.save(scan());
  assert.equal(cache.forget(), true);
  assert.equal(existsSync(cachePath(root)), false);
  cache.save(scan());
  chmodSync(cacheDir(root), 0o777);
  assert.equal(cache.forget(), false, 'a folder others can write to');
  chmodSync(cacheDir(root), 0o700);
  const elsewhere = tempDir(t), other = tempDir(t);
  symlinkSync(elsewhere, cacheDir(other));
  assert.equal(createScanCache({ stateRoot: other }).forget(), false, 'a link');
});

test('the saved read is checked again on its way out: a text the loader would refuse is not written, and an older read is not left to be shown', t => {
  const root = tempDir(t), cache = createScanCache({ stateRoot: root });
  cache.save(scan(1_000));
  const items = Array.from({ length: 30_000 }, (_, i) => ({ id: `i${i}`, kind: 'skill' as const, name: 'n', scopeId: 's', foundAt: [], library: null, description: '' }));
  assert.equal(cache.save({ ...scan(2_000), result: { ...result, world: { ...result.world, items } } }), false);
  const back = cache.load();
  assert.equal(back.status === 'ok' ? back.scan.savedAtMs : null, 1_000, 'the cache itself leaves the old file; the caller (keepRead) removes it');
});

test('a save keeps only the newest of the folders it moved aside, and leaves everything that is not one of them', t => {
  const root = tempDir(t), cache = createScanCache({ stateRoot: root }), elsewhere = tempDir(t);
  writeFileSync(join(elsewhere, 'keep'), 'keep');
  // The oldest is a link, then three folders; the newest (by the time it was made) is the one that stays.
  symlinkSync(elsewhere, join(root, 'last-read.bad.dddddddddddd'));
  for (const name of ['last-read.bad.aaaaaaaaaaaa', 'last-read.bad.bbbbbbbbbbbb', 'last-read.bad.cccccccccccc']) { mkdirSync(join(root, name)); writeFileSync(join(root, name, 'x'), 'x'); }
  mkdirSync(join(root, 'last-read.bad.NOTHEX')); mkdirSync(join(root, 'other'));
  cache.save(scan());
  const left = readdirSync(root).filter(n => n.startsWith('last-read.bad.')).sort();
  assert.deepEqual(left, ['last-read.bad.NOTHEX', 'last-read.bad.cccccccccccc']);
  assert.equal(readFileSync(join(elsewhere, 'keep'), 'utf8'), 'keep', 'a link is removed as a link, and its target is untouched');
  assert.ok(existsSync(join(root, 'other')));
});

test('an aside entry that vanishes between the listing and the look does not stop the sweep of the others', t => {
  const root = tempDir(t), warnings: string[] = [];
  for (const name of ['last-read.bad.aaaaaaaaaaaa', 'last-read.bad.bbbbbbbbbbbb', 'last-read.bad.cccccccccccc']) { mkdirSync(join(root, name)); writeFileSync(join(root, name, 'x'), 'x'); }
  // The listing names a folder that was removed after it was made: it is in the list and not on the disk.
  const cache = createScanCache({ stateRoot: root, readdir: p => [...readdirSync(p), 'last-read.bad.eeeeeeeeeeee'], warn: m => warnings.push(m) });
  cache.save(scan());
  const left = readdirSync(root).filter(n => n.startsWith('last-read.bad.')).sort();
  assert.deepEqual(left, ['last-read.bad.cccccccccccc'], 'the others were still swept');
  assert.ok(warnings.every(m => !m.includes(root) && !m.includes('eeeeeeeeeeee')), 'a report names no path');
});

test('an aside entry that cannot be removed does not stop the sweep of the older ones, and is reported without a path', { skip: skipAsRoot('a folder at mode 500 cannot be deleted') }, t => {
  const root = tempDir(t), warnings: string[] = [];
  // Made in this order, so aaa is the oldest, bbb the one that cannot be removed, ccc the newest (kept). The locked child is made before ccc, so it does not make bbb the newest.
  const locked = join(root, 'last-read.bad.bbbbbbbbbbbb', 'locked');
  for (const name of ['last-read.bad.aaaaaaaaaaaa', 'last-read.bad.bbbbbbbbbbbb']) { mkdirSync(join(root, name)); writeFileSync(join(root, name, 'x'), 'x'); }
  mkdirSync(locked); writeFileSync(join(locked, 'y'), 'y'); chmodSync(locked, 0o500);
  t.after(() => { try { chmodSync(locked, 0o700); } catch { /* gone */ } });
  mkdirSync(join(root, 'last-read.bad.cccccccccccc')); writeFileSync(join(root, 'last-read.bad.cccccccccccc', 'x'), 'x');
  const cache = createScanCache({ stateRoot: root, warn: m => warnings.push(m) });
  assert.equal(cache.save(scan()), true, 'a stuck folder never fails a save');
  const left = readdirSync(root).filter(n => n.startsWith('last-read.bad.')).sort();
  assert.deepEqual(left, ['last-read.bad.bbbbbbbbbbbb', 'last-read.bad.cccccccccccc'], 'the older one went; the stuck one stays');
  assert.equal(warnings.length, 1);
  assert.match(warnings[0]!, /EACCES|EPERM|ENOTEMPTY/);
  assert.match(warnings[0]!, /folder/);
  assert.ok(!warnings[0]!.includes(root) && !warnings[0]!.includes('bbbbbbbbbbbb'), 'a report names no path');
});
