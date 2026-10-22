import test from '../../../dist/tests/support/lock-slot-retry.js';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import '../../../dist/tests/support/isolate-home.js';
import { withStoreForWriteWith, STORE_FORMAT } from '../../../dist/packages/project-context/src/store.js';
import { withStoreForWrite, withProjectLock, lockSlot, projectRefusal } from '../../../dist/packages/project-context/src/index.js';

const code = expected => error => error?.code === expected;
const BODY = `{"format":"${STORE_FORMAT}"}\n`;
function world(t) {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'bowerloom-store-write-')));
  t.after(() => { for (const p of [base, path.join(base, 'home')]) { try { fs.chmodSync(p, 0o700); } catch { /* gone */ } } fs.rmSync(base, { recursive: true, force: true }); });
  const home = path.join(base, 'home'); fs.mkdirSync(home, { mode: 0o700 });
  return { base, home, store: path.join(home, '.bowerloom'), hooks: { accountHome: path.join(base, 'nobody') } };
}
const signal = () => new AbortController().signal;
const run = (w, work, sig = signal()) => withStoreForWriteWith(w.home, sig, work, w.hooks);
const temps = w => fs.readdirSync(w.store).filter(n => /^\.store\.json\.[a-f0-9]{16}\.tmp$/.test(n));

test('1. it makes the folder and store.json, and calls work with created true', async t => {
  const w = world(t); let seen;
  const out = await run(w, async (store, held, created) => { seen = { store, created }; held.assertHeld(store.dir); return 'done'; });
  assert.equal(out, 'done'); assert.equal(seen.created, true); assert.equal(seen.store.dir, w.store);
  assert.equal(fs.readFileSync(path.join(w.store, 'store.json'), 'utf8'), BODY);
  assert.equal(fs.statSync(w.store).mode & 0o777, 0o700); assert.equal(fs.statSync(path.join(w.store, 'store.json')).mode & 0o777, 0o644);
  assert.deepEqual(fs.readdirSync(w.store), ['store.json']);
});

test('2. it removes a leftover temporary file first and store.json has one link', async t => {
  const w = world(t); fs.mkdirSync(w.store, { mode: 0o700 });
  fs.writeFileSync(path.join(w.store, '.store.json.0123456789abcdef.tmp'), 'half');
  await run(w, async () => {});
  assert.deepEqual(fs.readdirSync(w.store), ['store.json']);
  assert.equal(fs.lstatSync(path.join(w.store, 'store.json')).nlink, 1);
});

test('3. it refuses a foreign folder with STORE_INVALID and changes nothing', async t => {
  const w = world(t); fs.mkdirSync(w.store, { mode: 0o700 }); fs.writeFileSync(path.join(w.store, 'mine.txt'), 'x');
  let called = false;
  await assert.rejects(run(w, async () => { called = true; }), code('STORE_INVALID'));
  assert.equal(called, false); assert.deepEqual(fs.readdirSync(w.store), ['mine.txt']);
});

test('4. it holds the lock while work runs', async t => {
  const w = world(t); let inner;
  await run(w, async store => {
    inner = await withProjectLock(store.dir, signal(), async () => 'got it').then(() => 'no refusal', e => e.code);
  });
  assert.equal(inner, 'PROJECT_LOCKED');
});

test('5. a held lock gives STORE_LOCKED, a slot collision and an unavailable lock pass through', async t => {
  const w = world(t); fs.mkdirSync(w.store, { mode: 0o700 });
  await withProjectLock(w.store, signal(), async () => {
    let called = false;
    await assert.rejects(run(w, async () => { called = true; }), code('STORE_LOCKED'));
    assert.equal(called, false);
  });
  // A program that holds the port and does not answer as the lock: PROJECT_LOCK_SLOT_COLLISION.
  const squat = net.createServer(socket => { socket.on('error', () => {}); socket.end('not the banner\n'); });
  await new Promise((resolve, reject) => { squat.once('error', reject); squat.listen({ host: '127.0.0.1', port: lockSlot(w.store).port, exclusive: true }, resolve); }).catch(() => null);
  if (!squat.listening) { t.diagnostic('the lock port was taken; the collision case is skipped'); }
  else { try { await assert.rejects(run(w, async () => {}), code('PROJECT_LOCK_SLOT_COLLISION')); } finally { await new Promise(r => squat.close(r)); } }
  // Any other refusal thrown inside work passes through unchanged.
  await assert.rejects(run(w, async () => { throw projectRefusal('PROJECT_LOCK_UNAVAILABLE'); }), code('PROJECT_LOCK_UNAVAILABLE'));
});

test('6. PROJECT_LOCKED thrown from held.assertHeld inside work becomes STORE_LOCKED', async t => {
  const w = world(t);
  await assert.rejects(run(w, async (store, held) => { held.assertHeld(path.join(store.dir, 'elsewhere')); }), code('STORE_LOCKED'));
  const abort = new AbortController();
  await assert.rejects(run(w, async (store, held) => { abort.abort(); held.assertHeld(store.dir); }, abort.signal), code('STORE_LOCKED'));
});

test('7. a valid store gives created false and changes nothing', async t => {
  const w = world(t); await run(w, async () => {});
  const before = fs.statSync(path.join(w.store, 'store.json'), { bigint: true });
  let created;
  await run(w, async (store, held, c) => { created = c; });
  assert.equal(created, false);
  const after = fs.statSync(path.join(w.store, 'store.json'), { bigint: true });
  assert.equal(after.ino, before.ino); assert.equal(after.mtimeNs, before.mtimeNs);
});

test('8. a cloud-synced home refuses STORE_IN_CLOUD_FOLDER and step 1 leaves at most one empty folder', async t => {
  const w = world(t), account = path.join(w.base, 'account');
  const home = path.join(account, 'Library', 'Mobile Documents', 'h'); fs.mkdirSync(home, { recursive: true, mode: 0o700 });
  let called = false;
  await assert.rejects(withStoreForWriteWith(home, signal(), async () => { called = true; }, { accountHome: account }), code('STORE_IN_CLOUD_FOLDER'));
  assert.equal(called, false);
  const left = fs.readdirSync(home); assert.ok(left.length <= 1);
  for (const name of left) assert.deepEqual(fs.readdirSync(path.join(home, name)), []);
});

test('9. a valid store with a leftover temporary file loses the file and gives created false', async t => {
  const w = world(t); await run(w, async () => {});
  fs.writeFileSync(path.join(w.store, '.store.json.fedcba9876543210.tmp'), 'old');
  let created;
  await run(w, async (store, held, c) => { created = c; });
  assert.equal(created, false); assert.deepEqual(temps(w), []);
});

test('10. work sees a pinned store: a swapped store folder refuses STORE_UNSAFE when pins are verified', async t => {
  const w = world(t);
  const { verifyStorePins } = await import('../../../dist/packages/project-context/src/index.js');
  await run(w, async store => { verifyStorePins(store); });
  await assert.rejects(run(w, async store => {
    fs.renameSync(w.store, path.join(w.base, 'moved'));
    fs.mkdirSync(w.store, { mode: 0o700 });
    verifyStorePins(store);
  }), code('STORE_UNSAFE'));
});

test('11. an empty store folder is a leftover: the first write makes the store in it', async t => {
  const w = world(t); fs.mkdirSync(w.store, { mode: 0o700 });
  let created;
  await run(w, async (store, held, c) => { created = c; });
  assert.equal(created, true); assert.deepEqual(fs.readdirSync(w.store), ['store.json']);
});
