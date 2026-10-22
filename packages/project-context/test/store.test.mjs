import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import '../../../dist/tests/support/isolate-home.js';
import { inspectStoreWith, openStoreWith, isValidStore, verifyStorePins, pathInsideStore, assertNotInStore, storeRootOf, STORE_FORMAT } from '../../../dist/packages/project-context/src/store.js';
import { inspectStore, openStore } from '../../../dist/packages/project-context/src/index.js';

const code = expected => error => error?.code === expected;
const BODY = `{"format":"${STORE_FORMAT}"}\n`;
function world(t) {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'bowerloom-store-')));
  t.after(() => { for (const p of [base, path.join(base, 'home')]) { try { fs.chmodSync(p, 0o700); } catch { /* gone */ } } fs.rmSync(base, { recursive: true, force: true }); });
  const home = path.join(base, 'home'); fs.mkdirSync(home, { mode: 0o700 });
  return { base, home, store: path.join(home, '.bowerloom') };
}
const mkStore = (w, body = BODY, mode = 0o700) => { fs.mkdirSync(w.store, { mode }); fs.chmodSync(w.store, mode); if (body !== null) fs.writeFileSync(path.join(w.store, 'store.json'), body, { mode: 0o600 }); return w; };
// A hook that points the account home at an unrelated folder, so HOME is the only home.
const solo = w => ({ accountHome: path.join(w.base, 'nobody') });
const caseInsensitive = base => { const probe = path.join(base, 'CaseProbe'); fs.writeFileSync(probe, 'x'); try { return fs.existsSync(path.join(base, 'caseprobe')); } finally { fs.rmSync(probe); } };

test('1. an absent store returns state absent', t => {
  const w = world(t);
  assert.deepEqual(inspectStoreWith(w.home, solo(w)), { state: 'absent', leftover: false });
  assert.equal(storeRootOf(w.home), w.store);
  assert.throws(() => openStoreWith(w.home, solo(w)), code('STORE_NOT_FOUND'));
});

test('2. a valid store returns state store with a pinned context holding fileIdentity', t => {
  const w = mkStore(world(t));
  const r = inspectStoreWith(w.home, solo(w));
  assert.equal(r.state, 'store'); assert.equal(r.leftoverTemp, false);
  const c = r.context, s = fs.lstatSync(path.join(w.store, 'store.json'), { bigint: true });
  assert.equal(c.dir, w.store);
  assert.deepEqual(c.fileIdentity, { device: s.dev.toString(), inode: s.ino.toString() });
  assert.equal(c.ancestry[0].path, '/'); assert.equal(c.ancestry.at(-1).path, w.home);
  assert.equal(c.identity.uid, process.getuid());
  assert.doesNotThrow(() => verifyStorePins(c));
  assert.deepEqual(openStoreWith(w.home, solo(w)).fileIdentity, c.fileIdentity);
});

test('3. a folder with no store.json is foreign and openStoreWith throws STORE_INVALID', t => {
  const w = world(t); fs.mkdirSync(w.store, { mode: 0o700 }); fs.writeFileSync(path.join(w.store, 'x'), 'x');
  assert.deepEqual(inspectStoreWith(w.home, solo(w)), { state: 'foreign' });
  assert.throws(() => openStoreWith(w.home, solo(w)), code('STORE_INVALID'));
});

test('4. a bad store.json throws STORE_INVALID', t => {
  const cases = {
    'invalid json': '{"format":', 'unknown key': `{"format":"${STORE_FORMAT}","x":1}\n`, 'duplicate key': `{"format":"${STORE_FORMAT}","format":"${STORE_FORMAT}"}\n`,
    'wrong format': '{"format":"bowerloom/store/v2"}\n', 'byte order mark': `﻿${BODY}`, 'too big': `{"format":"${STORE_FORMAT}"}\n${' '.repeat(5000)}`,
    'array': '[]\n', 'not a string': '{"format":1}\n', 'empty': '',
  };
  for (const [name, body] of Object.entries(cases)) {
    const w = mkStore(world(t), body);
    assert.throws(() => inspectStoreWith(w.home, solo(w)), code('STORE_INVALID'), name);
    fs.rmSync(w.store, { recursive: true });
  }
  const w = mkStore(world(t), null); fs.writeFileSync(path.join(w.store, 'store.json'), Buffer.from([0x7b, 0xff, 0x7d]));
  assert.throws(() => inspectStoreWith(w.home, solo(w)), code('STORE_INVALID'), 'invalid utf-8');
  // Exactly 4096 bytes is not too big.
  const w2 = mkStore(world(t), BODY.trimEnd() + ' '.repeat(4096 - BODY.trimEnd().length));
  assert.equal(inspectStoreWith(w2.home, solo(w2)).state, 'store');
});

test('5. store.json that is a link, has two links, is a FIFO, has another owner or is group writable throws STORE_UNSAFE', t => {
  const file = w => path.join(w.store, 'store.json');
  let w = mkStore(world(t), null); fs.writeFileSync(path.join(w.base, 'real.json'), BODY); fs.symlinkSync(path.join(w.base, 'real.json'), file(w));
  assert.throws(() => inspectStoreWith(w.home, solo(w)), code('STORE_UNSAFE'), 'link');
  w = mkStore(world(t)); fs.linkSync(file(w), path.join(w.base, 'twin.json'));
  assert.throws(() => inspectStoreWith(w.home, solo(w)), code('STORE_UNSAFE'), 'two links');
  w = mkStore(world(t));
  assert.throws(() => inspectStoreWith(w.home, { ...solo(w), uid: process.getuid() + 1 }), code('STORE_UNSAFE'), 'owner');
  w = mkStore(world(t)); fs.chmodSync(file(w), 0o660);
  assert.throws(() => inspectStoreWith(w.home, solo(w)), code('STORE_UNSAFE'), 'group write');
  fs.chmodSync(file(w), 0o602);
  assert.throws(() => inspectStoreWith(w.home, solo(w)), code('STORE_UNSAFE'), 'world write');
  w = mkStore(world(t), null);
  try { execFileSync('mkfifo', [file(w)]); } catch { t.diagnostic('no mkfifo on this machine: FIFO case skipped'); return; }
  assert.throws(() => inspectStoreWith(w.home, solo(w)), code('STORE_UNSAFE'), 'fifo');
});

test('6. a store that is a link throws STORE_UNSAFE', t => {
  const w = world(t); const elsewhere = path.join(w.base, 'elsewhere'); fs.mkdirSync(elsewhere, { mode: 0o700 });
  fs.writeFileSync(path.join(elsewhere, 'store.json'), BODY); fs.symlinkSync(elsewhere, w.store);
  assert.throws(() => inspectStoreWith(w.home, solo(w)), code('STORE_UNSAFE'));
  const w2 = world(t); fs.writeFileSync(w2.store, 'x');
  assert.throws(() => inspectStoreWith(w2.home, solo(w2)), code('STORE_UNSAFE'), 'a plain file');
});

test('7. a store with group write permission throws STORE_UNSAFE', t => {
  for (const mode of [0o770, 0o720, 0o707, 0o702]) {
    const w = mkStore(world(t), BODY, mode);
    assert.throws(() => inspectStoreWith(w.home, solo(w)), code('STORE_UNSAFE'), mode.toString(8));
  }
  const w = mkStore(world(t));
  assert.throws(() => inspectStoreWith(w.home, { ...solo(w), uid: process.getuid() + 1 }), code('STORE_UNSAFE'), 'another owner');
});

test('8. a home given through a symbolic link finds the store at the real path', t => {
  const w = mkStore(world(t)); const link = path.join(w.base, 'home-link'); fs.symlinkSync(w.home, link);
  const r = inspectStoreWith(link, solo(w));
  assert.equal(r.state, 'store'); assert.equal(r.context.dir, w.store);
  assert.equal(storeRootOf(link), w.store);
});

test('9. a store inside an iCloud folder throws STORE_IN_CLOUD_FOLDER', t => {
  const w = world(t); const account = path.join(w.base, 'account'); fs.mkdirSync(account);
  const home = path.join(account, 'Library', 'Mobile Documents', 'h'); fs.mkdirSync(home, { recursive: true, mode: 0o700 });
  const hooks = { accountHome: account };
  fs.mkdirSync(path.join(home, '.bowerloom'), { mode: 0o700 }); fs.writeFileSync(path.join(home, '.bowerloom', 'store.json'), BODY);
  assert.throws(() => inspectStoreWith(home, hooks), code('STORE_IN_CLOUD_FOLDER'));
  assert.equal(isValidStore(home, hooks), false);
});

test('10. a store with mode 0700 and one with mode 0755 both pass', t => {
  for (const mode of [0o700, 0o755]) { const w = mkStore(world(t), BODY, mode); assert.equal(inspectStoreWith(w.home, solo(w)).state, 'store', mode.toString(8)); }
});

test('11. pathInsideStore', t => {
  const w = mkStore(world(t)); const inner = path.join(w.store, 'skills', 'x'); fs.mkdirSync(inner, { recursive: true });
  const sibling = path.join(w.home, 'sibling'); fs.mkdirSync(sibling); const link = path.join(w.base, 'link'); fs.symlinkSync(inner, link);
  const h = solo(w);
  assert.equal(pathInsideStore(w.store, w.home, h), true);
  assert.equal(pathInsideStore(inner, w.home, h), true);
  assert.equal(pathInsideStore(path.join(inner, 'not-yet', 'there'), w.home, h), true);
  assert.equal(pathInsideStore(link, w.home, h), true);
  assert.equal(pathInsideStore(sibling, w.home, h), false);
  assert.equal(pathInsideStore(w.home, w.home, h), false);
  const account = path.join(w.base, 'account', 'u'); fs.mkdirSync(path.join(account, '.bowerloom', 'deep'), { recursive: true, mode: 0o700 });
  assert.equal(pathInsideStore(path.join(account, '.bowerloom', 'deep'), w.home, { accountHome: account }), true);
  const bare = world(t);
  assert.equal(pathInsideStore(path.join(bare.home, 'x'), bare.home, solo(bare)), false);
  assert.equal(pathInsideStore(bare.home, bare.home, solo(bare)), false);
});

test('12. verifyStorePins throws STORE_UNSAFE after the store folder is replaced', t => {
  const w = mkStore(world(t)); const c = openStoreWith(w.home, solo(w));
  fs.renameSync(w.store, path.join(w.base, 'old')); mkStore(w);
  assert.throws(() => verifyStorePins(c), code('STORE_UNSAFE'));
  fs.rmSync(w.store, { recursive: true }); fs.symlinkSync(path.join(w.base, 'old'), w.store);
  assert.throws(() => verifyStorePins(c), code('STORE_UNSAFE'), 'a link');
  fs.unlinkSync(w.store); fs.renameSync(path.join(w.base, 'old'), w.store);
  fs.rmSync(path.join(w.store, 'store.json'));
  assert.throws(() => verifyStorePins(c), code('STORE_UNSAFE'), 'file gone');
});

test('13. an empty store folder, or one with only a leftover temp file, is absent with leftover true', t => {
  const tmp = '.store.json.0123456789abcdef.tmp';
  let w = world(t); fs.mkdirSync(w.store, { mode: 0o700 });
  assert.deepEqual(inspectStoreWith(w.home, solo(w)), { state: 'absent', leftover: true });
  assert.throws(() => openStoreWith(w.home, solo(w)), code('STORE_NOT_FOUND'));
  fs.writeFileSync(path.join(w.store, tmp), 'x');
  assert.deepEqual(inspectStoreWith(w.home, solo(w)), { state: 'absent', leftover: true });
  fs.writeFileSync(path.join(w.store, 'other'), 'x');
  assert.deepEqual(inspectStoreWith(w.home, solo(w)), { state: 'foreign' });
  w = world(t); fs.mkdirSync(w.store, { mode: 0o700 }); fs.writeFileSync(path.join(w.store, '.store.json.0123456789ABCDEF.tmp'), 'x');
  assert.deepEqual(inspectStoreWith(w.home, solo(w)), { state: 'foreign' }, 'only lower-case hex names a leftover');
});

test('14. a valid store.json beside a leftover temp file returns leftoverTemp true', t => {
  const w = mkStore(world(t)); fs.writeFileSync(path.join(w.store, '.store.json.0123456789abcdef.tmp'), 'x');
  const r = inspectStoreWith(w.home, solo(w)); assert.equal(r.state, 'store'); assert.equal(r.leftoverTemp, true);
});

test('15. the account home differs from home: only the store at home is read', t => {
  const w = mkStore(world(t)); const other = path.join(w.base, 'other'); fs.mkdirSync(other, { mode: 0o700 });
  const hooks = { accountHome: other };
  assert.equal(inspectStoreWith(w.home, hooks).state, 'store');
  const bare = world(t); const acct = path.join(bare.base, 'acct'); fs.mkdirSync(path.join(acct, '.bowerloom'), { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(acct, '.bowerloom', 'store.json'), BODY);
  assert.deepEqual(inspectStoreWith(bare.home, { accountHome: acct }), { state: 'absent', leftover: false });
  assert.equal(inspectStoreWith(acct, { accountHome: acct }).state, 'store');
  // The package index reads HOME only. A fresh test home has no store.
  assert.equal(inspectStore(bare.home).state, 'absent');
  assert.throws(() => openStore(bare.home), code('STORE_NOT_FOUND'));
});

test('16. a .Bowerloom alias throws STORE_UNSAFE', t => {
  const w = world(t);
  if (!caseInsensitive(w.base)) { t.skip('this disk is case-sensitive'); return; }
  fs.mkdirSync(path.join(w.home, '.Bowerloom'), { mode: 0o700 });
  assert.throws(() => inspectStoreWith(w.home, solo(w)), code('STORE_UNSAFE'));
  // On a case-sensitive disk the unit test of the fold covers this: see test 16b.
});

test('16b. an alias of .bowerloom beside an absent store is caught by the home listing', t => {
  const w = world(t); fs.mkdirSync(path.join(w.home, '.BOWERLOOM'), { mode: 0o700 });
  assert.throws(() => inspectStoreWith(w.home, solo(w)), code('STORE_UNSAFE'));
});

test('17. two names that fold to store.json throw STORE_UNSAFE', t => {
  const w = world(t);
  if (!caseInsensitive(w.base)) {
    // A case-sensitive disk can hold both names. Both are refused, which is the fold rule at work.
    mkStore(w); fs.writeFileSync(path.join(w.store, 'Store.json'), BODY);
    assert.throws(() => inspectStoreWith(w.home, solo(w)), code('STORE_UNSAFE'));
    return;
  }
  mkStore(w, null); fs.writeFileSync(path.join(w.store, 'Store.json'), BODY);
  assert.throws(() => inspectStoreWith(w.home, solo(w)), code('STORE_UNSAFE'));
});

test('18. a home folder at mode 0 throws STORE_UNREADABLE', t => {
  const w = mkStore(world(t)); fs.chmodSync(w.home, 0);
  try { assert.throws(() => inspectStoreWith(w.home, solo(w)), code('STORE_UNREADABLE')); } finally { fs.chmodSync(w.home, 0o700); }
  assert.throws(() => inspectStoreWith('/nonexistent-home-for-bowerloom-test', solo(w)), code('STORE_UNREADABLE'));
});

test('19. isValidStore is true only for state store, and a refusal of a relative or NUL home is USAGE', t => {
  const w = mkStore(world(t)); const h = solo(w);
  assert.equal(isValidStore(w.home, h), true);
  const absent = world(t); assert.equal(isValidStore(absent.home, solo(absent)), false);
  const foreign = world(t); fs.mkdirSync(foreign.store, { mode: 0o700 }); fs.writeFileSync(path.join(foreign.store, 'x'), 'x');
  assert.equal(isValidStore(foreign.home, solo(foreign)), false);
  const bad = mkStore(world(t), '{}'); assert.equal(isValidStore(bad.home, solo(bad)), false);
  const unsafe = mkStore(world(t), BODY, 0o770); assert.equal(isValidStore(unsafe.home, solo(unsafe)), false);
  assert.equal(isValidStore('relative', h), false);
  assert.throws(() => inspectStoreWith('relative', h), code('USAGE'));
  assert.throws(() => inspectStoreWith(`${w.home}\0x`, h), code('USAGE'));
  assert.throws(() => storeRootOf('relative'), code('USAGE'));
});

test('20. verifyStorePins throws STORE_UNSAFE after store.json is replaced by a file of the same bytes', t => {
  const w = mkStore(world(t)); const c = openStoreWith(w.home, solo(w)); const file = path.join(w.store, 'store.json');
  fs.writeFileSync(file + '.new', BODY, { mode: 0o600 }); fs.renameSync(file + '.new', file);
  assert.throws(() => verifyStorePins(c), code('STORE_UNSAFE'));
  const c2 = openStoreWith(w.home, solo(w)); fs.linkSync(file, path.join(w.base, 'twin'));
  assert.throws(() => verifyStorePins(c2), code('STORE_UNSAFE'), 'a second link');
});

test('21. assertNotInStore throws STORE_NOT_A_PROJECT for a path inside the store', t => {
  const w = mkStore(world(t)); const inside = path.join(w.store, 'work'); fs.mkdirSync(inside);
  // assertNotInStore takes no hooks: the account home of the test machine is the real one, which holds no folder here.
  assert.throws(() => assertNotInStore(inside, w.home), code('STORE_NOT_A_PROJECT'));
  assert.doesNotThrow(() => assertNotInStore(path.join(w.home, 'elsewhere'), w.home));
});

test('22. a cloud-folder home with no store folder throws STORE_IN_CLOUD_FOLDER', t => {
  const w = world(t); const account = path.join(w.base, 'account'); fs.mkdirSync(account);
  const home = path.join(account, 'Library', 'Mobile Documents', 'h'); fs.mkdirSync(home, { recursive: true, mode: 0o700 });
  assert.throws(() => inspectStoreWith(home, { accountHome: account }), code('STORE_IN_CLOUD_FOLDER'));
});

test('a refusal message carries no path', t => {
  const w = mkStore(world(t), BODY, 0o770);
  try { inspectStoreWith(w.home, solo(w)); assert.fail('expected a refusal'); } catch (e) { assert.equal(e.code, 'STORE_UNSAFE'); assert.equal(e.message.includes(w.home), false); }
});
