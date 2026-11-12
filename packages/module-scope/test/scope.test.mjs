// The read scope of a module: it reads only a place the person approved for that module, and the approval is recorded once, in the private state folder.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { SCOPE_LIMITS, approvePlace, listPlaces, readPlaceFile, revokePlace, scopeFileOf } from '../../../dist/packages/module-scope/src/index.js';

/** A made-up home folder with a notes folder, a second folder, a hidden folder and a state folder. Removed when the test ends. */
function rig(t) {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'bowerloom-scope-')));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const home = path.join(base, 'home'), state = path.join(home, 'Library', 'state');
  for (const d of ['Documents/notes/sub', 'Documents/other', '.secret', 'Library/state', 'outside']) fs.mkdirSync(path.join(home, d), { recursive: true });
  fs.mkdirSync(path.join(base, 'elsewhere'));
  fs.writeFileSync(path.join(home, 'Documents/notes/a.md'), '# A\nhello\n');
  fs.writeFileSync(path.join(home, 'Documents/notes/sub/b.md'), 'b');
  fs.writeFileSync(path.join(home, 'Documents/other/o.md'), 'other');
  fs.writeFileSync(path.join(home, '.secret/key.txt'), 'secret');
  fs.writeFileSync(path.join(base, 'elsewhere/e.md'), 'not in home');
  return { base, home, state, notes: path.join(home, 'Documents/notes'), other: path.join(home, 'Documents/other') };
}
const approve = (r, moduleId, picked) => approvePlace({ stateRoot: r.state, home: r.home, moduleId, picked, now: () => '2026-11-12T10:00:00.000Z' });
const read = (r, moduleId, placeId, p) => readPlaceFile({ stateRoot: r.state, home: r.home, moduleId, placeId, path: p });

test('a module that has no approval cannot read any place, and the answer says NOT_APPROVED', t => {
  const r = rig(t);
  assert.deepEqual(read(r, 'memory', 'place-000000000000', 'a.md'), { ok: false, code: 'NOT_APPROVED' });
  assert.deepEqual(listPlaces({ stateRoot: r.state, home: r.home, moduleId: 'memory' }), { status: 'ok', places: [] });
});

test('an approved place can be read, and the approval is recorded once with a home label and no full path', t => {
  const r = rig(t);
  const kept = approve(r, 'memory', r.notes);
  assert.equal(kept.status, 'kept');
  assert.equal(kept.place.label, '~/Documents/notes');
  assert.match(kept.place.id, /^place-[0-9a-f]{12}$/);
  assert.equal(kept.place.approvedAt, '2026-11-12T10:00:00.000Z');
  const got = read(r, 'memory', kept.place.id, 'a.md');
  assert.deepEqual(got, { ok: true, text: '# A\nhello\n' });
  assert.deepEqual(read(r, 'memory', kept.place.id, 'sub/b.md'), { ok: true, text: 'b' });
  const again = approve(r, 'memory', r.notes);
  assert.equal(again.status, 'kept');
  const listed = listPlaces({ stateRoot: r.state, home: r.home, moduleId: 'memory' });
  assert.equal(listed.places.length, 1, 'approving twice records the place once');
  const file = fs.readFileSync(scopeFileOf(r.state), 'utf8');
  assert.equal(fs.statSync(scopeFileOf(r.state)).mode & 0o777, 0o600);
  assert.doesNotMatch(file, new RegExp(r.base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), 'the record holds no full path');
});

test('a module cannot read a place that is not approved, even a sibling folder, a folder outside home or another module approved', t => {
  const r = rig(t);
  const kept = approve(r, 'memory', r.notes);
  assert.equal(approve(r, 'memory', r.other).status, 'kept');
  const other = listPlaces({ stateRoot: r.state, home: r.home, moduleId: 'memory' }).places.find(p => p.label === '~/Documents/other');
  assert.ok(other);
  assert.equal(revokePlace({ stateRoot: r.state, moduleId: 'memory', placeId: other.id }).status, 'revoked');
  assert.deepEqual(read(r, 'memory', other.id, 'o.md'), { ok: false, code: 'NOT_APPROVED' }, 'a revoked place is no longer readable');
  // another module: the approval of "memory" is not the approval of "engines"
  assert.deepEqual(read(r, 'engines', kept.place.id, 'a.md'), { ok: false, code: 'NOT_APPROVED' });
  // a place id the record never held
  assert.deepEqual(read(r, 'memory', 'place-ffffffffffff', 'a.md'), { ok: false, code: 'NOT_APPROVED' });
  // a name that is not a place id or a module id
  for (const bad of ['', '../x', 'place-xyz', 'PLACE-000000000000', 'place-000000000000/..', null, undefined, 3]) assert.deepEqual(read(r, 'memory', bad, 'a.md'), { ok: false, code: 'NOT_APPROVED' }, String(bad));
  for (const bad of ['', '../x', 'Memory', 'a b', null, undefined, 7]) assert.deepEqual(read(r, bad, kept.place.id, 'a.md'), { ok: false, code: 'NOT_APPROVED' }, String(bad));
});

test('the sibling of an approved place is not readable by a path that climbs out of it, by an absolute path, or by a hidden part', t => {
  const r = rig(t);
  const { place } = approve(r, 'memory', r.notes);
  for (const p of ['../other/o.md', '../../.secret/key.txt', '/etc/hosts', `${r.other}/o.md`, 'sub/../../other/o.md', 'a.md/../../other/o.md', 'sub\\..\\a.md', '.hidden', 'sub/.hidden', '', '.', './a.md', 'sub//b.md', 'a.md\0', 'x'.repeat(SCOPE_LIMITS.pathChars + 1)]) {
    assert.deepEqual(read(r, 'memory', place.id, p), { ok: false, code: 'BAD_PATH' }, JSON.stringify(p));
  }
  for (const p of [null, undefined, 4, {}, []]) assert.deepEqual(read(r, 'memory', place.id, p), { ok: false, code: 'BAD_PATH' });
});

test('a link inside an approved place that leads outside it is refused OUTSIDE_PLACE', t => {
  const r = rig(t);
  const { place } = approve(r, 'memory', r.notes);
  fs.symlinkSync(path.join(r.base, 'elsewhere', 'e.md'), path.join(r.notes, 'link.md'));
  fs.symlinkSync(path.join(r.home, 'Documents', 'other'), path.join(r.notes, 'dirlink'));
  assert.deepEqual(read(r, 'memory', place.id, 'link.md'), { ok: false, code: 'OUTSIDE_PLACE' });
  assert.deepEqual(read(r, 'memory', place.id, 'dirlink/o.md'), { ok: false, code: 'OUTSIDE_PLACE' });
});

test('a place outside the home folder, the home folder itself, a hidden folder, the state folder and a folder that holds it cannot be approved', t => {
  const r = rig(t);
  assert.deepEqual(approve(r, 'memory', path.join(r.base, 'elsewhere')), { status: 'refused', code: 'NOT_IN_HOME' });
  assert.deepEqual(approve(r, 'memory', r.home), { status: 'refused', code: 'NOT_IN_HOME' });
  assert.deepEqual(approve(r, 'memory', path.join(r.home, '.secret')), { status: 'refused', code: 'HIDDEN_PART' });
  assert.deepEqual(approve(r, 'memory', r.state), { status: 'refused', code: 'STATE_FOLDER' });
  assert.deepEqual(approve(r, 'memory', path.join(r.home, 'Library')), { status: 'refused', code: 'STATE_FOLDER' });
  assert.deepEqual(approve(r, 'memory', path.join(r.notes, 'a.md')), { status: 'refused', code: 'NOT_A_FOLDER' });
  assert.deepEqual(approve(r, 'memory', path.join(r.home, 'missing')), { status: 'refused', code: 'NOT_A_FOLDER', cause: 'ENOENT' });
  assert.deepEqual(approve(r, 'Memory', r.notes), { status: 'refused', code: 'BAD_MODULE' });
  assert.equal(fs.existsSync(scopeFileOf(r.state)), false, 'a refused pick writes nothing');
});

test('the state folder is refused also before it exists, so a pick of a folder that will hold it is not approved', t => {
  const r = rig(t);
  fs.rmSync(r.state, { recursive: true });
  assert.deepEqual(approve(r, 'memory', path.join(r.home, 'Library')), { status: 'refused', code: 'STATE_FOLDER' });
  assert.equal(approve(r, 'memory', r.notes).status, 'kept', 'another folder is still approved');
});

test('a shortcut in home that leads outside home is refused as outside home, by its real path', t => {
  const r = rig(t);
  fs.symlinkSync(path.join(r.base, 'elsewhere'), path.join(r.home, 'Documents', 'sneaky'));
  assert.deepEqual(approve(r, 'memory', path.join(r.home, 'Documents', 'sneaky')), { status: 'refused', code: 'NOT_IN_HOME' });
});

test('a place swapped for another folder after the approval is not read: PLACE_CHANGED', t => {
  const r = rig(t);
  const { place } = approve(r, 'memory', r.notes);
  fs.renameSync(r.notes, `${r.notes}-moved`);
  fs.symlinkSync(r.other, r.notes);
  assert.deepEqual(read(r, 'memory', place.id, 'o.md'), { ok: false, code: 'PLACE_CHANGED' });
  fs.unlinkSync(r.notes); fs.renameSync(`${r.notes}-moved`, r.notes);
  assert.equal(read(r, 'memory', place.id, 'a.md').ok, true, 'the real folder is back and reads again');
});

test('a place that is gone is not readable', t => {
  const r = rig(t);
  const { place } = approve(r, 'memory', r.other);
  fs.rmSync(r.other, { recursive: true });
  assert.deepEqual(read(r, 'memory', place.id, 'o.md'), { ok: false, code: 'PLACE_CHANGED' });
});

test('a file that is not a file, too large, or not text is refused with its own code', t => {
  const r = rig(t);
  const { place } = approve(r, 'memory', r.notes);
  assert.deepEqual(read(r, 'memory', place.id, 'sub'), { ok: false, code: 'NOT_A_FILE' });
  assert.deepEqual(read(r, 'memory', place.id, 'missing.md'), { ok: false, code: 'UNREADABLE' });
  fs.writeFileSync(path.join(r.notes, 'big.md'), 'x'.repeat(SCOPE_LIMITS.readBytes + 1));
  assert.deepEqual(read(r, 'memory', place.id, 'big.md'), { ok: false, code: 'TOO_LARGE' });
  fs.writeFileSync(path.join(r.notes, 'edge.md'), 'x'.repeat(SCOPE_LIMITS.readBytes));
  assert.equal(read(r, 'memory', place.id, 'edge.md').ok, true, 'exactly the limit is read');
  fs.writeFileSync(path.join(r.notes, 'bin.md'), Buffer.from([0x61, 0x00, 0x62]));
  assert.deepEqual(read(r, 'memory', place.id, 'bin.md'), { ok: false, code: 'NOT_TEXT' });
  fs.writeFileSync(path.join(r.notes, 'bad.md'), Buffer.from([0xc3, 0x28]));
  assert.deepEqual(read(r, 'memory', place.id, 'bad.md'), { ok: false, code: 'NOT_TEXT' });
  fs.writeFileSync(path.join(r.notes, 'uni.md'), 'café \u{1F33F}');
  assert.deepEqual(read(r, 'memory', place.id, 'uni.md'), { ok: true, text: 'café \u{1F33F}' });
});

test('each module keeps its own list: the same folder approved for two modules is two approvals, and removing one leaves the other', t => {
  const r = rig(t);
  const a = approve(r, 'memory', r.notes), b = approve(r, 'engines', r.notes);
  assert.equal(a.status, 'kept'); assert.equal(b.status, 'kept');
  assert.equal(revokePlace({ stateRoot: r.state, moduleId: 'memory', placeId: a.place.id }).status, 'revoked');
  assert.equal(read(r, 'memory', a.place.id, 'a.md').ok, false);
  assert.equal(read(r, 'engines', b.place.id, 'a.md').ok, true);
  assert.deepEqual(revokePlace({ stateRoot: r.state, moduleId: 'memory', placeId: a.place.id }), { status: 'unknown' }, 'a second removal finds nothing');
});

test('the list of a module is capped, a full list refuses with FULL and keeps what it has', t => {
  const r = rig(t);
  for (let i = 0; i < SCOPE_LIMITS.placesPerModule; i += 1) { fs.mkdirSync(path.join(r.home, 'Documents', `p${i}`)); assert.equal(approve(r, 'memory', path.join(r.home, 'Documents', `p${i}`)).status, 'kept'); }
  fs.mkdirSync(path.join(r.home, 'Documents', 'extra'));
  assert.deepEqual(approve(r, 'memory', path.join(r.home, 'Documents', 'extra')), { status: 'refused', code: 'FULL' });
  assert.equal(listPlaces({ stateRoot: r.state, home: r.home, moduleId: 'memory' }).places.length, SCOPE_LIMITS.placesPerModule);
  assert.equal(approve(r, 'memory', path.join(r.home, 'Documents', 'p0')).status, 'kept', 'a place already held is still kept');
});

test('a damaged record reads as damaged, blocks a read, and a new pick moves it aside under a dated name and starts a new list', t => {
  const r = rig(t);
  const place0 = approve(r, 'memory', r.notes);
  assert.equal(place0.status, 'kept');
  fs.writeFileSync(scopeFileOf(r.state), '{ not json');
  assert.deepEqual(listPlaces({ stateRoot: r.state, home: r.home, moduleId: 'memory' }), { status: 'damaged' });
  assert.deepEqual(read(r, 'memory', place0.place.id, 'a.md'), { ok: false, code: 'RECORD_DAMAGED' }, 'a damaged record is said to be damaged, not "not approved"');
  const kept = approve(r, 'memory', r.other);
  assert.equal(kept.status, 'kept');
  assert.equal(kept.resetRecord, true, 'the pick says the old list was set aside');
  const names = fs.readdirSync(path.dirname(scopeFileOf(r.state)));
  assert.ok(names.some(n => /^approved\.json\.damaged-/.test(n)), 'the damaged file is kept');
  assert.equal(listPlaces({ stateRoot: r.state, home: r.home, moduleId: 'memory' }).places.length, 1);
  for (const bad of [JSON.stringify({ version: 2, modules: {} }), JSON.stringify({ version: 1, modules: { memory: [{ id: 'x' }] } }), JSON.stringify({ version: 1, modules: [] }), JSON.stringify({ version: 1, modules: { memory: [{ id: 'place-000000000000', rel: '../x', key: 'a'.repeat(32), at: 'now' }] } })]) {
    fs.writeFileSync(scopeFileOf(r.state), bad);
    assert.deepEqual(listPlaces({ stateRoot: r.state, home: r.home, moduleId: 'memory' }), { status: 'damaged' }, bad);
  }
});

test('a record folder that is a link, or open to others, is blocked and nothing is read or written through it', t => {
  const r = rig(t);
  const { place } = approve(r, 'memory', r.notes);
  const dir = path.dirname(scopeFileOf(r.state));
  fs.chmodSync(dir, 0o777);
  assert.deepEqual(listPlaces({ stateRoot: r.state, home: r.home, moduleId: 'memory' }), { status: 'blocked' });
  assert.deepEqual(read(r, 'memory', place.id, 'a.md'), { ok: false, code: 'RECORD_BLOCKED' }, 'an approved place is not read while the record folder is open to others');
  fs.chmodSync(dir, 0o700);
  assert.equal(read(r, 'memory', place.id, 'a.md').ok, true);
  fs.rmSync(dir, { recursive: true });
  fs.symlinkSync(r.other, dir);
  assert.deepEqual(listPlaces({ stateRoot: r.state, home: r.home, moduleId: 'memory' }), { status: 'blocked' });
  assert.deepEqual(approve(r, 'memory', r.notes), { status: 'refused', code: 'RECORD_BLOCKED' });
  assert.deepEqual(fs.readdirSync(r.other), ['o.md'], 'nothing was written through the link');
});

test('the package reaches no network and starts no program: its source names none', () => {
  const dir = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'src');
  for (const f of fs.readdirSync(dir).filter(n => n.endsWith('.ts'))) {
    const text = fs.readFileSync(path.join(dir, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    assert.doesNotMatch(text, /node:(?:http|https|http2|net|tls|dgram|dns|child_process|worker_threads|cluster)\b|\bfetch\s*\(|\bWebSocket\b|\bXMLHttpRequest\b|electron/, f);
  }
});

// ---- the fix round: causes, resets, stronger reads, Library, odd characters

const writeRaw = (r, moduleId, rel, real) => {
  const dir = path.dirname(scopeFileOf(r.state));
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 }); fs.chmodSync(dir, 0o700);
  const key = createHash('sha256').update(`bowerloom-module-scope\u0000${real}`).digest('hex').slice(0, 32);
  fs.writeFileSync(scopeFileOf(r.state), JSON.stringify({ version: 1, modules: { [moduleId]: [{ id: `place-${key.slice(0, 12)}`, rel, key, at: '2026-11-12T10:00:00.000Z' }] } }), { mode: 0o600 });
  return `place-${key.slice(0, 12)}`;
};

test('a refused pick carries the class of its cause (a code or a name, never a message), and a home that cannot be read is told apart from a pick that cannot', t => {
  const r = rig(t);
  const gone = approve(r, 'memory', path.join(r.home, 'missing'));
  assert.deepEqual([gone.code, gone.cause], ['NOT_A_FOLDER', 'ENOENT']);
  const noHome = approvePlace({ stateRoot: r.state, home: path.join(r.base, 'no-home'), moduleId: 'memory', picked: r.notes });
  assert.deepEqual([noHome.status, noHome.code, noHome.cause], ['refused', 'HOME_UNREADABLE', 'ENOENT']);
  const failing = approvePlace({ stateRoot: r.state, home: r.home, moduleId: 'memory', picked: r.notes, write: () => { throw Object.assign(new Error(`${r.base} secret message`), { code: 'ENOSPC' }); } });
  assert.deepEqual([failing.code, failing.cause], ['FAILED', 'ENOSPC']);
  const odd = approvePlace({ stateRoot: r.state, home: r.home, moduleId: 'memory', picked: r.notes, write: () => { throw Object.assign(new Error('x'), { name: 'Weird Name /with/ path' }); } });
  assert.equal(odd.cause, 'Error', 'a name that is not a short plain word is not kept');
  for (const a of [gone, noHome, failing, odd]) assert.doesNotMatch(JSON.stringify(a), /secret|\/private|\/var|\/tmp/);
});

test('a damaged record that is set aside is flagged, and when the new list then cannot be written the answer says the old list was set aside', t => {
  const r = rig(t);
  assert.equal(approve(r, 'memory', r.notes).status, 'kept');
  fs.writeFileSync(scopeFileOf(r.state), '{ not json');
  const failed = approvePlace({ stateRoot: r.state, home: r.home, moduleId: 'memory', picked: r.other, write: () => { throw Object.assign(new Error('x'), { code: 'EIO' }); } });
  assert.deepEqual([failed.status, failed.code, failed.cause, failed.resetRecord], ['refused', 'RECORD_RESET_FAILED', 'EIO', true]);
  assert.ok(fs.readdirSync(path.dirname(scopeFileOf(r.state))).some(n => /^approved\.json\.damaged-/.test(n)));
  const plain = approve(r, 'memory', r.other);
  assert.equal(plain.status, 'kept');
  assert.equal(plain.resetRecord, undefined, 'a record that was fine is not flagged');
});

test('a failed removal carries the class of its cause', t => {
  const r = rig(t);
  const { place } = approve(r, 'memory', r.notes);
  const failed = revokePlace({ stateRoot: r.state, moduleId: 'memory', placeId: place.id, write: () => { throw Object.assign(new Error('/secret'), { code: 'EROFS' }); } });
  assert.deepEqual(failed, { status: 'failed', cause: 'EROFS' });
  assert.equal(listPlaces({ stateRoot: r.state, home: r.home, moduleId: 'memory' }).places.length, 1, 'nothing was removed');
});

test('a link inside a place that leads to a hidden file or folder of the same place is refused', t => {
  const r = rig(t);
  const { place } = approve(r, 'memory', r.notes);
  fs.writeFileSync(path.join(r.notes, '.env'), 'KEY=1'); fs.mkdirSync(path.join(r.notes, '.git')); fs.writeFileSync(path.join(r.notes, '.git', 'config'), '[core]');
  fs.symlinkSync(path.join(r.notes, '.env'), path.join(r.notes, 'env.md'));
  fs.symlinkSync(path.join(r.notes, '.git'), path.join(r.notes, 'gitdir'));
  assert.deepEqual(read(r, 'memory', place.id, 'env.md'), { ok: false, code: 'BAD_PATH' });
  assert.deepEqual(read(r, 'memory', place.id, 'gitdir/config'), { ok: false, code: 'BAD_PATH' });
  fs.symlinkSync(path.join(r.notes, 'a.md'), path.join(r.notes, 'alias.md'));
  assert.equal(read(r, 'memory', place.id, 'alias.md').ok, true, 'a link to a plain file of the same place still reads');
});

test('a file that is not a regular file (a pipe) is refused NOT_A_FILE and the read does not block', t => {
  const r = rig(t);
  const { place } = approve(r, 'memory', r.notes);
  try { execFileSync('mkfifo', [path.join(r.notes, 'pipe.md')]); } catch { t.skip('mkfifo is not here'); return; }
  assert.deepEqual(read(r, 'memory', place.id, 'pipe.md'), { ok: false, code: 'NOT_A_FILE' });
});

test('every read runs the checks of a place again: a recorded place under Library, or in the state folder, is not read', t => {
  const r = rig(t);
  fs.mkdirSync(path.join(r.home, 'Library', 'Notes'), { recursive: true });
  fs.writeFileSync(path.join(r.home, 'Library', 'Notes', 'n.md'), 'n');
  const lib = writeRaw(r, 'memory', 'Library/Notes', fs.realpathSync.native(path.join(r.home, 'Library', 'Notes')));
  assert.deepEqual(read(r, 'memory', lib, 'n.md'), { ok: false, code: 'NOT_APPROVED' });
  fs.writeFileSync(path.join(r.state, 's.md'), 's');
  const st = writeRaw(r, 'memory', 'Library/state', fs.realpathSync.native(r.state));
  assert.deepEqual(read(r, 'memory', st, 's.md'), { ok: false, code: 'NOT_APPROVED' });
  const ok = writeRaw(r, 'memory', 'Documents/notes', fs.realpathSync.native(r.notes));
  assert.equal(read(r, 'memory', ok, 'a.md').ok, true, 'the same record shape reads for a place that passes');
});

test('Library and everything below it cannot be approved', t => {
  const r = rig(t);
  fs.mkdirSync(path.join(r.home, 'Library', 'Application Support', 'x'), { recursive: true });
  for (const d of ['Library/Application Support', 'Library/Application Support/x']) assert.deepEqual(approve(r, 'memory', path.join(r.home, d)), { status: 'refused', code: 'LIBRARY_FOLDER' }, d);
  assert.equal(fs.existsSync(scopeFileOf(r.state)), false);
});

test('a folder name with a control or bidirectional character is refused BAD_NAME, and a read path with one is BAD_PATH', t => {
  const r = rig(t);
  for (const name of ['a\u202eb', 'a\u0007b', 'a\u200bb', 'a\u2066b']) {
    fs.mkdirSync(path.join(r.home, 'Documents', name));
    assert.deepEqual(approve(r, 'memory', path.join(r.home, 'Documents', name)), { status: 'refused', code: 'BAD_NAME' }, JSON.stringify(name));
  }
  const { place } = approve(r, 'memory', r.notes);
  for (const p of ['a\u202e.md', 'a\u0007.md', 'sub/a\u200b.md', 'a\u2066.md', 'a\n.md']) assert.deepEqual(read(r, 'memory', place.id, p), { ok: false, code: 'BAD_PATH' }, JSON.stringify(p));
});

test('a place path over the limit is refused PATH_TOO_LONG, not FAILED', t => {
  const r = rig(t);
  const deep = path.join(r.home, 'Documents', 'a'.repeat(200), 'b'.repeat(200), 'c'.repeat(200));
  fs.mkdirSync(deep, { recursive: true });
  assert.deepEqual(approve(r, 'memory', deep), { status: 'refused', code: 'PATH_TOO_LONG' });
});

// ---- fix round 2

test('a home folder that cannot be read on a read is HOME_UNREADABLE, not UNREADABLE', t => {
  const r = rig(t);
  const { place } = approve(r, 'memory', r.notes);
  assert.deepEqual(readPlaceFile({ stateRoot: r.state, home: path.join(r.base, 'no-home'), moduleId: 'memory', placeId: place.id, path: 'a.md' }), { ok: false, code: 'HOME_UNREADABLE' });
});

test('a lone surrogate in a read path is refused BAD_PATH', t => {
  const r = rig(t);
  const { place } = approve(r, 'memory', r.notes);
  for (const p of ['a\ud800.md', '\udc00a.md', 'sub/x\ud83d.md']) assert.deepEqual(read(r, 'memory', place.id, p), { ok: false, code: 'BAD_PATH' }, JSON.stringify(p));
  assert.equal(read(r, 'memory', place.id, 'a.md').ok, true);
});

test('a file that is another file by the time the path is worked out again is refused: the second look must be the file that was opened', t => {
  const r = rig(t);
  const { place } = approve(r, 'memory', r.notes);
  const real = fs.realpathSync.native(path.join(r.notes, 'a.md'));
  const original = fs.lstatSync;
  let seen = 0;
  fs.lstatSync = (p, ...rest) => {
    const stat = original(p, ...rest);
    if (typeof p === 'string' && p === real) { seen += 1; if (seen === 2) return Object.create(stat, { ino: { value: stat.ino + 1 } }); }
    return stat;
  };
  try { assert.deepEqual(read(r, 'memory', place.id, 'a.md'), { ok: false, code: 'UNREADABLE' }); } finally { fs.lstatSync = original; }
  assert.equal(seen, 2, 'the file was looked at before the open and again after the second real path');
  assert.equal(read(r, 'memory', place.id, 'a.md').ok, true, 'unchanged files still read');
});
