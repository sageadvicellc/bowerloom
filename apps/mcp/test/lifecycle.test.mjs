import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { ownMcpLifecycle } from '../src/lifecycle.ts';

for (const trigger of ['end', 'error', 'SIGINT', 'SIGTERM', 'transport']) {
  test(`MCP ${trigger} releases the controller once`, async () => {
    const input = new EventEmitter();
    const signals = new EventEmitter();
    let serverClosed = 0, controllerClosed = 0, failures = 0;
    const server = { async close() { serverClosed++; this.onclose(); } };
    const lifecycle = ownMcpLifecycle(server, { async close() { controllerClosed++; } }, input, signals, () => { failures++; });
    if (trigger === 'transport') server.onclose();
    else (trigger.startsWith('SIG') ? signals : input).emit(trigger);
    await Promise.all([lifecycle.close(), lifecycle.close()]);
    assert.deepEqual([serverClosed, controllerClosed, failures], [1, 1, 0]);
    assert.equal(signals.listenerCount('SIGTERM'), 0);
    assert.equal(input.listenerCount('end'), 0);
  });
}

test('MCP cleanup failure remains generic and releases the controller after server failure', async () => {
  let closed = 0, failures = 0;
  const lifecycle = ownMcpLifecycle({ async close() { throw new Error('private value'); } },
    { async close() { closed++; throw new Error('another private value'); } },
    new EventEmitter(), new EventEmitter(), () => { failures++; });
  await lifecycle.close();
  await lifecycle.close();
  assert.deepEqual([closed, failures], [1, 1]);
});
