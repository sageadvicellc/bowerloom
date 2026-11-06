// A write to a closed stderr is an async error. EPIPE is ignored; any other code is tried once on the console and then ignored, even if that throws.
import test from 'node:test';
import assert from 'node:assert/strict';
import { stderrErrorHandler } from '../main/stderr-guard.js';

const coded = (code: string): Error => Object.assign(new Error(`write ${code}`), { code });

test('EPIPE is ignored with no console line', () => {
  const lines: unknown[] = [];
  stderrErrorHandler(text => { lines.push(text); })(coded('EPIPE'));
  assert.deepEqual(lines, []);
});

test('any other error code is tried once on the console', () => {
  const lines: string[] = [];
  stderrErrorHandler(text => { lines.push(text); })(coded('EIO'));
  assert.equal(lines.length, 1);
  assert.match(lines[0]!, /EIO/);
});

test('an error with no code is tried once, and a console that throws is ignored', () => {
  let calls = 0;
  const handle = stderrErrorHandler(() => { calls += 1; throw new Error('console failed'); });
  assert.doesNotThrow(() => { handle(new Error('plain')); });
  assert.equal(calls, 1);
});
