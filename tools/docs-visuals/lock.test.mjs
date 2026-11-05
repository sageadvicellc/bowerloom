import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { reclaimStale, withLock } from './lock.mjs';

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

test('a reclaim that finds a new owner puts the owner file back, and the lock folder never leaves its path', () => {
  const lock = lockPath();
  mkdirSync(lock);
  writeFileSync(join(lock, 'owner'), String(process.ppid));
  assert.equal(reclaimStale(lock, 999999), false);
  assert.equal(readdirSync(lock).join(), 'owner', 'the live lock is back in place with nothing left aside');
  unlinkSync(join(lock, 'owner'));
  rmdirSync(lock);
});

test('a reclaim that loses the race to another waiter counts the stale lock as gone', () => {
  const lock = lockPath();
  assert.equal(reclaimStale(lock, 999999), true);
  assert.equal(existsSync(lock), false);
});

test('an owner of 0 or a negative number is treated as foreign and only waited for', () => {
  for (const value of ['0', '-1', 'not a pid']) {
    const lock = lockPath();
    mkdirSync(lock);
    writeFileSync(join(lock, 'owner'), value);
    assert.throws(() => withLock(lock, () => assert.fail('must not run'), { timeoutMs: 60, pollMs: 20 }), error => error.message.includes(lock), value);
    assert.equal(existsSync(join(lock, 'owner')), true, value);
    unlinkSync(join(lock, 'owner'));
    rmdirSync(lock);
  }
});

test('a reclaim stopped half way is finished once its waiter is gone, and a live one is left alone', () => {
  const gone = spawnSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))'], { encoding: 'utf8' }).stdout;
  const lock = lockPath();
  mkdirSync(lock);
  writeFileSync(join(lock, `owner.stale-${gone}-1`), '12345');
  assert.equal(withLock(lock, () => 'ran', { timeoutMs: 1000, pollMs: 20 }), 'ran');
  assert.equal(existsSync(lock), false);
  const busy = lockPath();
  mkdirSync(busy);
  writeFileSync(join(busy, `owner.stale-${process.ppid}-1`), '12345');
  assert.throws(() => withLock(busy, () => assert.fail('must not run'), { timeoutMs: 60, pollMs: 20 }), error => error.message.includes(busy));
  assert.equal(existsSync(busy), true);
  unlinkSync(join(busy, `owner.stale-${process.ppid}-1`));
  rmdirSync(busy);
});

test('an empty lock folder, or one holding other files, is never removed', () => {
  for (const extra of [null, 'notes.txt']) {
    const lock = lockPath();
    mkdirSync(lock);
    if (extra) writeFileSync(join(lock, extra), 'x');
    assert.throws(() => withLock(lock, () => assert.fail('must not run'), { timeoutMs: 60, pollMs: 20 }), error => error.message.includes(lock));
    assert.equal(existsSync(lock), true);
    if (extra) unlinkSync(join(lock, extra));
    rmdirSync(lock);
  }
});
