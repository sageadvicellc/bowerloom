import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { withProjectLock, isHeldProjectLock, lockPort } from '../../../dist/packages/project-context/src/index.js';

const code = expected => error => error?.code === expected;
// The same formula as `locked` (managed-skills/src/transaction.ts) and `withLock` (startup/src/revision.ts).
const formula = project => 20000 + Number.parseInt(createHash('sha256').update(project).digest('hex').slice(0, 8), 16) % 30000;
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

test('lockPort uses the v1 formula', async t => {
  const dir = await freshProject(t);
  assert.equal(lockPort(dir), formula(dir));
  assert.ok(lockPort(dir) >= 20000 && lockPort(dir) < 50000);
});

test('the project lock excludes a holder of the revise-key port, and the port is free again afterwards', async t => {
  const dir = await freshProject(t), blocker = net.createServer(s => s.destroy());
  await listen(blocker, formula(dir));
  let ran = false;
  await assert.rejects(withProjectLock(dir, new AbortController().signal, async () => { ran = true; }), code('PROJECT_LOCKED'));
  assert.equal(ran, false);
  await close(blocker);
  assert.equal(await withProjectLock(dir, new AbortController().signal, async () => 'ok'), 'ok');
  const after = net.createServer(); await listen(after, formula(dir)); await close(after);
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
