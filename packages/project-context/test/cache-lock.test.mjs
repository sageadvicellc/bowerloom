// The skills cache lock: one local port per cache folder, in the style of the project lock. A second holder waits
// instead of refusing, so two projects that sync at once both finish.
import test from '../../../dist/tests/support/lock-slot-retry.js';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { withCacheLock, cacheLockSlot, lockSlot } from '../../../dist/packages/project-context/src/index.js';

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
