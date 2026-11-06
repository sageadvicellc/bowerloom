// The copy button: the helper writes the exact command to the clipboard and says what happened. A fake clipboard stands in for the browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import { copyText, copyLabel } from '../src/copy.ts';

test('copying writes the exact text and reports success', async () => {
  const written = [];
  const result = await copyText('npm install -g bowerloom@beta', { writeText: async text => { written.push(text); } });
  assert.equal(result, 'copied');
  assert.deepEqual(written, ['npm install -g bowerloom@beta']);
});

test('a clipboard that refuses, throws, or is missing reports failure and never throws', async () => {
  assert.equal(await copyText('x', { writeText: async () => { throw new Error('denied'); } }), 'failed');
  assert.equal(await copyText('x', { writeText: () => { throw new Error('denied'); } }), 'failed');
  assert.equal(await copyText('x', undefined), 'failed');
  assert.equal(await copyText('x', null), 'failed');
});

test('each state has a plain label for the button and its live region', () => {
  assert.equal(copyLabel('idle'), 'Copy');
  assert.equal(copyLabel('copied'), 'Copied');
  assert.match(copyLabel('failed'), /select the command/i);
});

import { createCopyController } from '../src/copy.ts';

/** A fake clock: timers run only when the test says so. */
function fakeClock() {
  let next = 1; const timers = new Map();
  return {
    setTimer: (callback, ms) => { const id = next++; timers.set(id, { callback, ms }); return id; },
    clearTimer: id => { timers.delete(id); },
    pending: () => timers.size,
    fire: () => { for (const [id, timer] of [...timers]) { timers.delete(id); timer.callback(); } },
  };
}

test('a press shows Copied, then one timer returns to idle', async () => {
  const clock = fakeClock(), states = [];
  const run = createCopyController({ text: 'x', clipboard: () => ({ writeText: async () => {} }), set: state => states.push(state), ...clock });
  await run.press();
  assert.deepEqual(states, ['copied']);
  assert.equal(clock.pending(), 1);
  clock.fire();
  assert.deepEqual(states, ['copied', 'idle']);
});

test('a double press leaves one pending timer, and one return to idle', async () => {
  const clock = fakeClock(), states = [];
  const run = createCopyController({ text: 'x', clipboard: () => ({ writeText: async () => {} }), set: state => states.push(state), ...clock });
  await run.press(); await run.press();
  assert.equal(clock.pending(), 1, 'the first timer was cleared');
  clock.fire();
  assert.deepEqual(states, ['copied', 'copied', 'idle']);
});

test('a failed copy shows failed and then returns to idle', async () => {
  const clock = fakeClock(), states = [];
  const run = createCopyController({ text: 'x', clipboard: () => ({ writeText: async () => { throw new Error('denied'); } }), set: state => states.push(state), ...clock });
  await run.press(); clock.fire();
  assert.deepEqual(states, ['failed', 'idle']);
});

test('after dispose a copy that finishes late sets no state and no timer, and a pending timer is cleared', async () => {
  const clock = fakeClock(), states = [];
  let finish;
  const slow = { writeText: () => new Promise(resolve => { finish = resolve; }) };
  const run = createCopyController({ text: 'x', clipboard: () => slow, set: state => states.push(state), ...clock });
  const pressed = run.press();
  run.dispose();
  finish();
  await pressed;
  assert.deepEqual(states, []);
  assert.equal(clock.pending(), 0);
  const second = createCopyController({ text: 'x', clipboard: () => ({ writeText: async () => {} }), set: () => {}, ...clock });
  await second.press();
  assert.equal(clock.pending(), 1);
  second.dispose();
  assert.equal(clock.pending(), 0, 'leaving the page clears the timer');
});
