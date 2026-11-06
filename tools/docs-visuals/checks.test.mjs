import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { assertStep, requestedIds, staleShots } from './checks.mjs';

const plan = [{ id: 'a-one', kind: 'shot' }, { id: 'b-two', kind: 'shot' }, { id: 'cli-x', kind: 'terminal' }];

test('requestedIds takes every shot, or the named ones, and refuses an id that is not a shot', () => {
  assert.deepEqual(requestedIds(plan), ['a-one', 'b-two']);
  assert.deepEqual(requestedIds(plan, ' b-two, '), ['b-two']);
  assert.throws(() => requestedIds(plan, 'a-one,a-oen'), /a-oen/);
  assert.throws(() => requestedIds(plan, 'cli-x'), /cli-x/);
});

test('staleShots names a picture that is missing or older than the start, in both themes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'docs-visuals-checks-'));
  try {
    const since = Date.now();
    for (const name of ['a-one-light.webp', 'a-one-dark.webp', 'b-two-light.webp']) writeFileSync(join(dir, name), 'x');
    const old = new Date(since - 60_000);
    utimesSync(join(dir, 'b-two-light.webp'), old, old);
    assert.deepEqual(staleShots(['a-one'], dir, since - 1000), []);
    assert.deepEqual(staleShots(['b-two'], dir, since - 1000), ['b-two-light.webp was not written by this run', 'b-two-dark.webp is missing']);
    assert.deepEqual(staleShots([], dir, since), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('assertStep accepts the expected exit and refuses a spawn error, a signal, another exit, and unexpected stderr', () => {
  const good = { status: 3, signal: null, stdout: 'plan', stderr: '' };
  assertStep('x', good, { exit: 3 });
  assert.throws(() => assertStep('x', { ...good, error: new Error('ENOENT') }, { exit: 3 }), /did not run/);
  assert.throws(() => assertStep('x', { ...good, status: null, signal: 'SIGTERM' }, { exit: 3 }), /SIGTERM/);
  assert.throws(() => assertStep('x', { ...good, status: 1 }, { exit: 3 }), /expected exit 3 and got 1/);
  assert.throws(() => assertStep('x', { ...good, stderr: '{"error":{}}' }, { exit: 3 }), /standard error/);
  assertStep('x', { ...good, stderr: 'note' }, { exit: 3, stderr: 'allowed' });
});
