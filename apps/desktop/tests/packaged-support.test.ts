// The helpers of e2e/packaged-app.spec.ts, tested without Electron: which files count as a change of the source, how long the spec waits for the app to end, and what counts as a clean end.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdirSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { isCleanExit, newestChange, newestSourceOf, waitForExit } from '../e2e/packaged-support.js';
import { DESKTOP, tempDir } from './support.js';

const touch = (path: string, seconds: number): void => { mkdirSync(join(path, '..'), { recursive: true }); writeFileSync(path, 'x'); utimesSync(path, seconds, seconds); };

test('newestChange ignores dotfiles and dot folders, and the folders the build does not hold', t => {
  const dir = tempDir(t, 'bowerloom-newest-');
  touch(join(dir, 'a.ts'), 1000);
  touch(join(dir, '.DS_Store'), 9000);
  touch(join(dir, 'sub', '.swp'), 9000);
  touch(join(dir, '.hidden', 'b.ts'), 9000);
  touch(join(dir, 'node_modules', 'c.js'), 9000);
  touch(join(dir, 'dist', 'd.js'), 9000);
  touch(join(dir, 'sub', 'e.ts'), 2000);
  assert.equal(newestChange(dir), 2000 * 1000);
  assert.equal(newestChange(join(dir, 'missing')), 0);
});

test('newestSourceOf counts the shipped kits, the packages, and the desktop sources', t => {
  const root = tempDir(t, 'bowerloom-newest-');
  const desktop = join(root, 'apps', 'desktop');
  for (const dir of ['main', 'preload', 'renderer', 'shared']) touch(join(desktop, dir, 'f.ts'), 1000);
  touch(join(desktop, 'tools', 'bundle.mjs'), 1000);
  touch(join(desktop, 'package.json'), 1000);
  touch(join(root, 'packages', 'p', 'src', 'i.ts'), 1500);
  assert.equal(newestSourceOf(desktop), 1500 * 1000);
  touch(join(root, 'kits', 'notes-keeper', 'kit.json'), 3000);
  assert.equal(newestSourceOf(desktop), 3000 * 1000, 'a changed kit makes the build stale: the package holds the kits');
  touch(join(root, 'kits', '.DS_Store'), 9000);
  assert.equal(newestSourceOf(desktop), 3000 * 1000, 'a dotfile of the kits folder does not');
});

test('waitForExit answers with the code and the signal of the end, and gives up after the bound', async () => {
  const ended = new EventEmitter();
  const done = waitForExit(ended, 5000);
  ended.emit('exit', 0, null);
  assert.deepEqual(await done, { code: 0, signal: null });
  const never = new EventEmitter();
  const started = Date.now();
  assert.equal(await waitForExit(never, 30), 'timeout');
  assert.ok(Date.now() - started < 2000, 'it does not wait without end');
  assert.equal(never.listenerCount('exit'), 0, 'the wait leaves nothing listening');
  const already = Object.assign(new EventEmitter(), { exitCode: 3, signalCode: null });
  assert.deepEqual(await waitForExit(already, 5000), { code: 3, signal: null }, 'a child that already ended answers at once');
});

test('isCleanExit: code 0 is clean; a SIGTERM end is clean only for a close that was asked with SIGTERM; nothing else is', () => {
  assert.equal(isCleanExit({ code: 0, signal: null }, false), true);
  assert.equal(isCleanExit({ code: 0, signal: null }, true), true);
  assert.equal(isCleanExit({ code: null, signal: 'SIGTERM' }, true), true);
  assert.equal(isCleanExit({ code: null, signal: 'SIGTERM' }, false), false, 'a SIGTERM nobody sent is a crash');
  assert.equal(isCleanExit({ code: null, signal: 'SIGKILL' }, true), false);
  assert.equal(isCleanExit({ code: 1, signal: null }, true), false);
  assert.equal(isCleanExit('timeout', true), false);
});

test('the spec quits the app by its process id and reads no AppleEvent by bundle path', () => {
  const spec = readFileSync(join(DESKTOP, 'e2e', 'packaged-app.spec.ts'), 'utf8');
  assert.doesNotMatch(spec, /tell application/, 'no bundle-path AppleEvent: it can reach another copy of the app and can raise a one-time Automation prompt');
  assert.match(spec, /process\.kill\(child\.pid/);
  assert.match(spec, /waitForExit\(child, /);
  assert.match(spec, /isCleanExit\(/);
  assert.doesNotMatch(spec, /^const exited = new Promise/m);
});
