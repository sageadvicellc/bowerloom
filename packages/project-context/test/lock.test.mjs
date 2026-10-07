import test from '../../../dist/tests/support/lock-slot-retry.js';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { withProjectLock, isHeldProjectLock, lockPort } from '../../../dist/packages/project-context/src/index.js';
import { applyObservedManagedSkill } from '../../../dist/packages/managed-skills/src/transaction.js';
import { applyManagedItem } from '../../../dist/packages/managed-skills/src/v2-transaction.js';
import { applyStartupRevision } from '../../../dist/packages/startup/src/index.js';

const code = expected => error => error?.code === expected;
// The key of `lockPort`, written out here so a change to it fails this file: the project folder's device and inode,
// never the path string, so two spellings of one folder share one lock.
const keyOf = project => { const s = fs.statSync(project, { bigint: true }); return createHash('sha256').update(JSON.stringify(['bowerloom-project-lock/v1', s.dev.toString(), s.ino.toString()])).digest('hex'); };
const formula = project => 20000 + Number.parseInt(keyOf(project).slice(0, 8), 16) % 30000;
const listen = (server, port) => new Promise((resolve, reject) => { server.once('error', reject); server.listen({ host: '127.0.0.1', port, exclusive: true }, resolve); });
const close = server => new Promise(resolve => server.close(resolve));
/** A fresh project folder whose lock port is free now, so parallel test files rarely collide on a port. */
async function freshProject(t) {
  for (let attempt = 0; attempt < 50; attempt++) {
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'bowerloom-lock-')));
    const probe = net.createServer();
    try { await listen(probe, formula(dir)); await close(probe); } catch { fs.rmSync(dir, { recursive: true, force: true }); continue; }
    t.after(() => fs.rmSync(dir, { recursive: true, force: true })); return dir;
  }
  throw new Error('no free lock port found');
}

test('lockPort keys on the folder device and inode, not the path string', async t => {
  const dir = await freshProject(t);
  assert.equal(lockPort(dir), formula(dir));
  assert.ok(lockPort(dir) >= 20000 && lockPort(dir) < 50000);
  // A symlink to the folder names the same inode, so it names the same lock.
  const link = dir + '-link'; fs.symlinkSync(dir, link); t.after(() => fs.rmSync(link, { force: true }));
  assert.equal(lockPort(link), lockPort(dir));
  // A path that names no folder has no lock slot.
  assert.throws(() => lockPort(path.join(dir, 'missing')), code('PROJECT_LOCK_UNAVAILABLE'));
  fs.writeFileSync(path.join(dir, 'file'), 'x'); assert.throws(() => lockPort(path.join(dir, 'file')), code('PROJECT_LOCK_UNAVAILABLE'));
});

test('a case alias of the project folder shares one lock across all four lock users', async t => {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'bowerloom-alias-'))); t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const real = path.join(base, 'MyProj'), alias = path.join(base, 'myproj'); fs.mkdirSync(real, { mode: 0o700 });
  if (!fs.existsSync(alias)) { t.skip('this volume is case-sensitive'); return; }
  // Both spellings pass a realpath round trip, which is why a path-string key failed open here.
  assert.equal(fs.realpathSync(alias), alias); assert.equal(fs.realpathSync(real), real);
  assert.equal(lockPort(alias), lockPort(real));
  const hex = 'a'.repeat(64), state = path.join(base, 'state'), signal = new AbortController().signal;
  const v1 = { operation: 'install', projectDir: alias, stateDir: state, harness: 'codex', cache: { root: path.join(base, 'cache'), operationId: 'b'.repeat(32), expectedSnapshotRevision: hex, expectedReceiptRevision: hex }, expectedPreviousRevision: null, minFreeBytes: 33554432 };
  const v2 = { operation: 'install', projectDir: alias, stateDir: path.join(state, 'house-style'), item: { kind: 'skill', id: 'house-style' }, harnesses: ['claude'], source: { kind: 'local', path: 'skills/house-style' }, expectedPreviousRevision: null, minFreeBytes: 33554432, legacy: null };
  await withProjectLock(real, signal, async held => {
    await assert.rejects(withProjectLock(alias, signal, async () => {}), code('PROJECT_LOCKED'));
    await assert.rejects(applyObservedManagedSkill(v1, hex, null), code('MANAGED_SKILL_LOCKED'));
    await assert.rejects(applyManagedItem(null, v2, hex), code('MANAGED_SKILL_LOCKED'));
    await assert.rejects(applyStartupRevision({ targetDir: alias, brief: {} }, hex, hex), code('REVISION_LOCK_UNAVAILABLE'));
    held.assertHeld(real);
  });
  // And the other way round: a lock taken through the alias excludes the real spelling.
  await withProjectLock(alias, signal, async () => {
    await assert.rejects(withProjectLock(real, signal, async () => {}), code('PROJECT_LOCKED'));
    await assert.rejects(applyObservedManagedSkill({ ...v1, projectDir: real }, hex, null), code('MANAGED_SKILL_LOCKED'));
  });
});

/** A server on a project's slot that is not its lock: it sends `banner` (or nothing) to each client. */
async function squatter(port, banner) {
  const server = net.createServer(socket => { socket.on('error', () => {}); if (banner === null) return; socket.end(banner); });
  await listen(server, port); return server;
}
const readBanner = port => new Promise((resolve, reject) => { const chunks = []; const s = net.connect({ host: '127.0.0.1', port }); s.on('data', c => chunks.push(c)); s.on('end', () => resolve(Buffer.concat(chunks).toString())); s.on('error', reject); });

test('a slot held by anything but this project lock refuses LOCK_SLOT_COLLISION naming the port, and never LOCKED', async t => {
  const dir = await freshProject(t), port = formula(dir);
  for (const banner of ['', 'bowerloom-project-lock/v1 ' + '0'.repeat(64) + '\n', 'bowerloom-project-lock/v1 ' + keyOf(dir), 'bowerloom-project-lock/v1 ' + keyOf(dir) + '\nextra', null]) {
    const blocker = await squatter(port, banner); let ran = false; const started = performance.now();
    await assert.rejects(withProjectLock(dir, new AbortController().signal, async () => { ran = true; }), e => e.code === 'PROJECT_LOCK_SLOT_COLLISION' && e.message.includes(String(port)) && e.port === port, JSON.stringify(banner));
    assert.ok(performance.now() - started < 3000, 'the banner read is bounded'); assert.equal(ran, false);
    await close(blocker);
  }
  assert.equal(await withProjectLock(dir, new AbortController().signal, async () => 'ok'), 'ok');
  const after = net.createServer(); await listen(after, port); await close(after);
});

test('the lock holder sends this project banner, so a second writer on the same project is LOCKED', async t => {
  const dir = await freshProject(t);
  await withProjectLock(dir, new AbortController().signal, async () => {
    assert.equal(await readBanner(formula(dir)), 'bowerloom-project-lock/v1 ' + keyOf(dir) + '\n');
    await assert.rejects(withProjectLock(dir, new AbortController().signal, async () => {}), code('PROJECT_LOCKED'));
  });
});

test('the lock holds the port while work runs, and a second lock on the same project is refused', async t => {
  const dir = await freshProject(t);
  await withProjectLock(dir, new AbortController().signal, async held => {
    const other = net.createServer();
    await assert.rejects(listen(other, formula(dir)), code('EADDRINUSE'));
    await assert.rejects(withProjectLock(dir, new AbortController().signal, async () => {}), code('PROJECT_LOCKED'));
    held.assertHeld(dir);
  });
});

test('only EADDRINUSE means held: any other listen error is PROJECT_LOCK_UNAVAILABLE and releases nothing it does not own', async t => {
  const dir = await freshProject(t);
  for (const errno of ['EACCES', 'EADDRNOTAVAIL', 'EMFILE']) {
    t.mock.method(net.Server.prototype, 'listen', function () { process.nextTick(() => this.emit('error', Object.assign(new Error('PRIVATE_' + errno), { code: errno }))); return this; });
    await assert.rejects(withProjectLock(dir, new AbortController().signal, async () => {}), e => e.code === 'PROJECT_LOCK_UNAVAILABLE' && !e.message.includes('PRIVATE'), errno);
    t.mock.restoreAll();
  }
  assert.equal(await withProjectLock(dir, new AbortController().signal, async () => 'free'), 'free');
});

test('the token is branded at run time: a real token passes and forged shapes do not', async t => {
  const dir = await freshProject(t); let real;
  await withProjectLock(dir, new AbortController().signal, async held => {
    real = held; assert.equal(isHeldProjectLock(held), true);
    assert.equal(held.dir, dir); assert.ok(held.signal instanceof AbortSignal); assert.equal(held.signal.aborted, false);
    const forged = { dir: held.dir, signal: held.signal, assertHeld: held.assertHeld };
    assert.equal(isHeldProjectLock(forged), false);
    assert.equal(isHeldProjectLock({ ...held }), false);
    assert.equal(isHeldProjectLock(Object.create(held)), false);
    assert.equal(isHeldProjectLock(structuredClone({ dir })), false);
  });
  for (const value of [null, undefined, 0, 'held', {}, [], () => {}]) assert.equal(isHeldProjectLock(value), false);
  assert.equal(isHeldProjectLock(real), true, 'a token stays branded after release; assertHeld is what fails');
});

test('assertHeld throws PROJECT_LOCKED for another project and after the lock is released', async t => {
  const dir = await freshProject(t); let kept;
  await withProjectLock(dir, new AbortController().signal, async held => {
    kept = held; held.assertHeld(dir);
    assert.throws(() => held.assertHeld(dir + '-other'), code('PROJECT_LOCKED'));
    assert.throws(() => held.assertHeld('relative'), code('PROJECT_LOCKED'));
  });
  assert.equal(kept.signal.aborted, true);
  assert.throws(() => kept.assertHeld(dir), code('PROJECT_LOCKED'));
});

test('the lock releases when work throws, and the work error passes through', async t => {
  const dir = await freshProject(t);
  await assert.rejects(withProjectLock(dir, new AbortController().signal, async () => { throw Object.assign(new Error('boom'), { code: 'SOMETHING' }); }), code('SOMETHING'));
  const after = net.createServer(); await listen(after, formula(dir)); await close(after);
});

test('an abort of the caller signal while work runs aborts the token signal', async t => {
  const dir = await freshProject(t), controller = new AbortController();
  await withProjectLock(dir, controller.signal, async held => {
    assert.equal(held.signal.aborted, false); controller.abort();
    assert.equal(held.signal.aborted, true);
    assert.throws(() => held.assertHeld(dir), code('PROJECT_LOCKED'));
  });
});

test('an abort while the lock is pending releases it', async t => {
  const dir = await freshProject(t), controller = new AbortController(); let ran = false;
  const pending = withProjectLock(dir, controller.signal, async () => { ran = true; });
  controller.abort();
  await assert.rejects(pending, code("PROJECT_LOCKED"));
  assert.equal(ran, false);
  const after = net.createServer(); await listen(after, formula(dir)); await close(after);
  const already = new AbortController(); already.abort();
  await assert.rejects(withProjectLock(dir, already.signal, async () => { ran = true; }), code("PROJECT_LOCKED"));
  assert.equal(ran, false);
  const again = net.createServer(); await listen(again, formula(dir)); await close(again);
});

test('withProjectLock refuses a relative project path as usage', async () => {
  await assert.rejects(withProjectLock('relative', new AbortController().signal, async () => {}), code('USAGE'));
});
