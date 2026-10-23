// The skills cache lock: one local port per cache folder, in the style of the project lock. A second holder waits
// instead of refusing, so two projects that sync at once both finish.
import test from '../../../dist/tests/support/lock-slot-retry.js';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { withCacheLock, cacheLockSlot, lockSlot, LOCK_REBINDS } from '../../../dist/packages/project-context/src/index.js';

const listen = (server, port) => new Promise((resolve, reject) => { server.once('error', reject); server.listen({ host: '127.0.0.1', port, exclusive: true }, resolve); });
const close = server => new Promise(resolve => server.close(resolve));
/** A fresh 0700 cache folder whose lock port is free now. */
async function freshCache(t) {
  for (let attempt = 0; attempt < 50; attempt++) {
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'bowerloom-cache-lock-'))); fs.chmodSync(dir, 0o700);
    const probe = net.createServer();
    try { await listen(probe, cacheLockSlot(dir).port); await close(probe); } catch { fs.rmSync(dir, { recursive: true, force: true }); continue; }
    t.after(() => fs.rmSync(dir, { recursive: true, force: true })); return dir;
  }
  throw new Error('no free lock port found');
}

test('the cache lock is keyed apart from the project lock of the same folder', async t => {
  const dir = await freshCache(t);
  assert.notEqual(cacheLockSlot(dir).key, lockSlot(dir).key);
  assert.match(cacheLockSlot(dir).banner, /^bowerloom-cache-lock\/v1 [a-f0-9]{64}\n$/);
});

test('a second holder of one cache lock waits for the first, then runs', async t => {
  const dir = await freshCache(t), order = [], signal = new AbortController().signal;
  let release; const gate = new Promise(r => { release = r; });
  const first = withCacheLock(dir, signal, async held => { order.push('first in'); held.assertHeld(); await gate; order.push('first out'); return 1; });
  await new Promise(r => setTimeout(r, 50));
  const second = withCacheLock(dir, signal, async () => { order.push('second in'); return 2; });
  await new Promise(r => setTimeout(r, 300));
  assert.deepEqual(order, ['first in']);
  release();
  assert.deepEqual(await Promise.all([first, second]), [1, 2]);
  assert.deepEqual(order, ['first in', 'first out', 'second in']);
});

test('a waiting holder stops when its signal aborts, and when its wait runs out', async t => {
  const dir = await freshCache(t);
  let release; const gate = new Promise(r => { release = r; });
  const holder = withCacheLock(dir, new AbortController().signal, async () => { await gate; });
  await new Promise(r => setTimeout(r, 50));
  const controller = new AbortController(); let ran = false;
  const waiting = withCacheLock(dir, controller.signal, async () => { ran = true; });
  setTimeout(() => controller.abort(), 100);
  await assert.rejects(waiting, e => e?.name === 'AbortError' || e?.code === 'ABORT_ERR');
  await assert.rejects(withCacheLock(dir, new AbortController().signal, async () => { ran = true; }, { waitMs: 150 }), e => e?.code === 'PROJECT_LOCK_UNAVAILABLE');
  assert.equal(ran, false); release(); await holder;
});

test('a cache lock port held by another program refuses LOCK_SLOT_COLLISION and names the port', async t => {
  const dir = await freshCache(t), port = cacheLockSlot(dir).port, squatter = net.createServer(s => { s.on('error', () => {}); s.end('hello\n'); });
  await listen(squatter, port); t.after(() => close(squatter));
  let ran = false;
  await assert.rejects(withCacheLock(dir, new AbortController().signal, async () => { ran = true; }), e => e?.code === 'PROJECT_LOCK_SLOT_COLLISION' && e.port === port && e.message.includes(String(port)));
  assert.equal(ran, false);
});

const INDEX = new URL('../../../dist/packages/project-context/src/index.js', import.meta.url).href;
/** Takes the cache lock in another process, says "held", then blocks its event loop for `busyMs` and exits. */
function busyHolder(dir, busyMs) {
  const code = `import { withCacheLock } from ${JSON.stringify(INDEX)};
await withCacheLock(${JSON.stringify(dir)}, new AbortController().signal, async () => {
  process.stdout.write('held\\n'); await new Promise(r => setTimeout(r, 50));
  const end = Date.now() + ${busyMs}; while (Date.now() < end) {}
});`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', code], { stdio: ['ignore', 'pipe', 'inherit'] });
  const held = new Promise((resolve, reject) => { child.stdout.on('data', d => { if (String(d).includes('held')) resolve(); }); child.once('exit', c => reject(new Error(`holder exited ${c} before it held the lock`))); });
  const exited = new Promise(resolve => child.once('exit', resolve));
  return { held, exited };
}

test('a holder in another process that blocks its event loop past the banner timeout is waited for, not refused', async t => {
  const dir = await freshCache(t), holder = busyHolder(dir, 2500);
  await holder.held;
  let ranAt = 0;
  await withCacheLock(dir, new AbortController().signal, async () => { ranAt = Date.now(); });
  const code = await holder.exited;
  assert.equal(code, 0); assert.ok(ranAt > 0);
});

test('a port held by a program that never answers refuses LOCK_SLOT_COLLISION once the silent limit runs out', async t => {
  const dir = await freshCache(t), port = cacheLockSlot(dir).port, sockets = new Set();
  const squatter = net.createServer(s => { sockets.add(s); s.on('error', () => {}); });
  await listen(squatter, port); t.after(() => { for (const s of sockets) s.destroy(); return close(squatter); });
  let ran = false; const started = Date.now();
  await assert.rejects(withCacheLock(dir, new AbortController().signal, async () => { ran = true; }, { silentMs: 1500 }), e => e?.code === 'PROJECT_LOCK_SLOT_COLLISION' && e.port === port);
  assert.equal(ran, false); assert.ok(Date.now() - started >= 1500, 'it waited out the silent limit first');
});

test('a port held by a program that resets every connection refuses LOCK_SLOT_COLLISION once the silent limit runs out', async t => {
  const dir = await freshCache(t), port = cacheLockSlot(dir).port; let connections = 0;
  const squatter = net.createServer(s => { connections++; s.on('error', () => {}); s.resetAndDestroy(); });
  await listen(squatter, port); t.after(() => close(squatter));
  let ran = false; const started = Date.now();
  await assert.rejects(withCacheLock(dir, new AbortController().signal, async () => { ran = true; }, { silentMs: 500 }), e => e?.code === 'PROJECT_LOCK_SLOT_COLLISION' && e.port === port);
  assert.equal(ran, false); assert.ok(Date.now() - started >= 500, 'it waited out the silent limit first');
  // PR 102 round 1: the wait pauses between tries, so it is not a tight loop of binds and connections.
  assert.ok(connections <= 30, `${connections} connections in about 500 ms`);
});

// PR 102 round 1, item 1: a program that accepts each connection and ends it with no byte. Track 11 made such a close
// a let-go, and the cache lock spun on it for the whole silent limit. Now it is 'closed': a few rebinds, with a pause
// each, then a collision.
test('a port held by a program that accepts and ends every connection refuses LOCK_SLOT_COLLISION within about a second', async t => {
  const dir = await freshCache(t), port = cacheLockSlot(dir).port; let connections = 0;
  const squatter = net.createServer(s => { connections++; s.on('error', () => {}); s.end(); });
  await listen(squatter, port); t.after(() => close(squatter));
  let ran = false; const started = Date.now();
  await assert.rejects(withCacheLock(dir, new AbortController().signal, async () => { ran = true; }), e => e?.code === 'PROJECT_LOCK_SLOT_COLLISION' && e.port === port);
  const took = Date.now() - started;
  assert.equal(ran, false); assert.ok(took < 1500, `${took} ms`); assert.equal(connections, LOCK_REBINDS + 1);
});

test('a holder that ends one connection with no byte and lets go is not a collision: the cache lock is taken', async t => {
  const dir = await freshCache(t), port = cacheLockSlot(dir).port;
  const holder = net.createServer(s => { s.on('error', () => {}); s.end(); holder.close(); });
  await listen(holder, port);
  assert.equal(await withCacheLock(dir, new AbortController().signal, async () => 'ran'), 'ran');
});
