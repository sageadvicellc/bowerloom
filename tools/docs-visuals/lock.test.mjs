import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { withLock } from './lock.mjs';

const lockPath = () => join(mkdtempSync(join(tmpdir(), 'docs-visuals-lock-')), 'lock');

test('the lock is held while the function runs and released after it', () => {
  const lock = lockPath();
  assert.equal(withLock(lock, () => { assert.equal(existsSync(lock), true); return 7; }), 7);
  assert.equal(existsSync(lock), false);
});

test('a function that throws still releases the lock', () => {
  const lock = lockPath();
  assert.throws(() => withLock(lock, () => { throw new Error('the run failed'); }), /the run failed/);
  assert.equal(existsSync(lock), false);
});

test('a lock that another process holds is waited for, then refused with its path, and never removed', () => {
  const lock = lockPath();
  mkdirSync(lock);
  assert.throws(() => withLock(lock, () => assert.fail('must not run'), { timeoutMs: 100, pollMs: 20 }), error => error.message.includes(lock));
  assert.equal(existsSync(lock), true);
  rmdirSync(lock);
});

test('a lock left by a run that is gone is reclaimed', () => {
  const lock = lockPath();
  const gone = spawnSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))'], { encoding: 'utf8' });
  mkdirSync(lock);
  writeFileSync(join(lock, 'owner'), gone.stdout);
  assert.equal(withLock(lock, () => 'ran', { timeoutMs: 1000, pollMs: 20 }), 'ran');
  assert.equal(existsSync(lock), false);
});

test('a lock held by a live process is never reclaimed', () => {
  const lock = lockPath();
  mkdirSync(lock);
  writeFileSync(join(lock, 'owner'), String(process.ppid));
  assert.throws(() => withLock(lock, () => assert.fail('must not run'), { timeoutMs: 100, pollMs: 20 }), error => error.message.includes(lock));
  assert.equal(existsSync(lock), true);
  unlinkSync(join(lock, 'owner'));
  rmdirSync(lock);
});

test('a lock folder removed by hand during the run does not turn a good run into an error', () => {
  const lock = lockPath();
  assert.equal(withLock(lock, () => { unlinkSync(join(lock, 'owner')); rmdirSync(lock); return 'ok'; }), 'ok');
});
