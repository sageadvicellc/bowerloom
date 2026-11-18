// Unit tests of the child-process host, in plain Node, with a fake child. They hold the rules of Gate 1 Part C that do not need Electron:
// an in-flight call that loses its child fails with FAILED and is never replayed; a queued call is sent once; a call never waits past its limit; events keep their order.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createCoreHost } from '../src/host.mjs';

/** A stand-in for `utilityProcess.fork`: each fork makes a fake child that answers `ping` and `echo`, holds `hang`, and sends a ready message. */
function fakeEnv({ readyDelayMs = 0 } = {}) {
  const children = [];
  const killed = [];
  const fork = () => {
    const proc = new EventEmitter();
    proc.pid = 5000 + children.length;
    proc.sent = [];
    proc.postMessage = message => {
      proc.sent.push(message);
      if (message.method === 'ping') setImmediate(() => proc.emit('message', { type: 'result', id: message.id, ok: true, value: 'pong' }));
      if (message.method === 'echo') setImmediate(() => proc.emit('message', { type: 'result', id: message.id, ok: true, value: message.args[0] }));
      if (message.method === 'events') {
        for (let i = 0; i < message.args[0]; i += 1) proc.emit('message', { type: 'event', seq: i });
        setImmediate(() => proc.emit('message', { type: 'result', id: message.id, ok: true, value: { sent: message.args[0] } }));
      }
    };
    proc.kill = () => { setImmediate(() => proc.emit('exit', 0)); return true; };
    children.push(proc);
    setTimeout(() => proc.emit('message', { type: 'ready', pid: proc.pid }), readyDelayMs);
    return proc;
  };
  const signal = (pid, name) => { killed.push([pid, name]); const child = children.find(c => c.pid === pid); if (child) setImmediate(() => child.emit('exit', null, name)); };
  return { fork, signal, children, killed };
}

test('1. a ping returns through the child', async () => {
  const env = fakeEnv();
  const host = createCoreHost({ fork: env.fork, signal: env.signal, childPath: 'child.mjs' });
  await host.start();
  assert.equal(await host.call('ping'), 'pong');
  await host.stop();
});

test('2. a call in flight when the child dies fails with FAILED and is never replayed', async () => {
  const env = fakeEnv();
  const host = createCoreHost({ fork: env.fork, signal: env.signal, childPath: 'child.mjs' });
  await host.start();
  const pending = host.call('hang');
  const rejected = assert.rejects(pending, error => error.code === 'FAILED');
  await new Promise(resolve => setImmediate(resolve));
  host.killChild();
  await rejected;
  await host.whenReady();
  assert.equal(env.children.length, 2, 'the host started a second child');
  assert.equal(env.children[1].sent.filter(m => m.method === 'hang').length, 0, 'the second child never saw the call');
  assert.equal(env.children[0].sent.filter(m => m.method === 'hang').length, 1);
  await host.stop();
});

test('3. a call made while the child restarts is sent once, to the new child', async () => {
  const env = fakeEnv({ readyDelayMs: 20 });
  const host = createCoreHost({ fork: env.fork, signal: env.signal, childPath: 'child.mjs' });
  await host.start();
  host.killChild();
  const value = await host.call('echo', 'again');
  assert.equal(value, 'again');
  const seen = env.children.flatMap(c => c.sent).filter(m => m.method === 'echo');
  assert.equal(seen.length, 1);
  await host.stop();
});

test('4. a call that gets no answer fails with FAILED at its limit and the child is restarted', async () => {
  const env = fakeEnv();
  const host = createCoreHost({ fork: env.fork, signal: env.signal, childPath: 'child.mjs', callTimeoutMs: 50 });
  await host.start();
  const began = Date.now();
  await assert.rejects(host.call('hang'), error => error.code === 'FAILED');
  const took = Date.now() - began;
  assert.ok(took >= 45 && took < 500, `took ${took} ms`);
  await host.whenReady();
  assert.equal(env.children.length, 2);
  assert.equal(await host.call('ping'), 'pong');
  await host.stop();
});

test('5. events arrive in order and once each', async () => {
  const env = fakeEnv();
  const seen = [];
  const host = createCoreHost({ fork: env.fork, signal: env.signal, childPath: 'child.mjs', onEvent: e => seen.push(e.seq) });
  await host.start();
  await host.call('events', 2000);
  assert.equal(seen.length, 2000);
  assert.deepEqual(seen, Array.from({ length: 2000 }, (_, i) => i));
  await host.stop();
});

test('6. stop does not restart the child, and a later call fails with FAILED', async () => {
  const env = fakeEnv();
  const host = createCoreHost({ fork: env.fork, signal: env.signal, childPath: 'child.mjs' });
  await host.start();
  await host.stop();
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(env.children.length, 1);
  await assert.rejects(host.call('ping'), error => error.code === 'FAILED');
});

test('7. the host reports how long each recovery took', async () => {
  const env = fakeEnv({ readyDelayMs: 10 });
  const host = createCoreHost({ fork: env.fork, signal: env.signal, childPath: 'child.mjs' });
  await host.start();
  const before = host.generation;
  host.killChild();
  await host.whenReady();
  assert.equal(host.generation, before + 1);
  assert.ok(host.lastRecoveryMs >= 5 && host.lastRecoveryMs < 1000, `recovery ${host.lastRecoveryMs} ms`);
  await host.stop();
});

test('8. an error code from the child reaches the caller as it is', async () => {
  const env = fakeEnv();
  const host = createCoreHost({ fork: env.fork, signal: env.signal, childPath: 'child.mjs' });
  await host.start();
  const original = env.children[0].postMessage;
  env.children[0].postMessage = message => { if (message.method === 'refuse') return setImmediate(() => env.children[0].emit('message', { type: 'result', id: message.id, ok: false, code: 'UNKNOWN_FOLDER', message: 'no' })); return original(message); };
  await assert.rejects(host.call('refuse'), error => error.code === 'UNKNOWN_FOLDER');
  await host.stop();
});
