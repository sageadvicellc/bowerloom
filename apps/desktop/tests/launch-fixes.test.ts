// Fix pass A3: the prototype's "writes nothing" promise holds without the launcher, the launcher cleans up reliably, and the prototype page has no bridge.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PROTOTYPE_PREFIX, chooseUserData, isPrototypeDataPath, makePrototypeDataDir, mayRemovePrototypeDir, removeAndReport, removePrototypeDataDir, userDataArg } from '../main/security.js';
import { webPreferences } from '../main/security.js';
import { DESKTOP, tempDir } from './support.js';

const read = (file: string): string => readFileSync(join(DESKTOP, file), 'utf8');
const strip = (text: string): string => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

// ---- 15. the app makes its own temporary data folder

test('the user data folder argument is read from the command line, the last one winning', () => {
  assert.equal(userDataArg(['/d', '--prototype']), null);
  assert.equal(userDataArg(['/d', '--user-data-dir=/tmp/x', '--prototype']), '/tmp/x');
  assert.equal(userDataArg(['--user-data-dir=/a', '--user-data-dir=/b']), '/b');
  assert.equal(userDataArg(['--user-data-dir=']), null, 'an empty value is no value');
  assert.equal(userDataArg(['--user-data-dir', '/tmp/x']), null, 'only the form with an equals sign is one Chromium reads');
});

test('a folder counts as a prototype data folder only when it sits directly in the temp folder and has the prefix', () => {
  const tmp = '/var/tmp';
  assert.equal(PROTOTYPE_PREFIX, 'bowerloom-prototype-');
  assert.equal(isPrototypeDataPath('/var/tmp/bowerloom-prototype-abc', tmp), true);
  assert.equal(isPrototypeDataPath('/var/tmp/bowerloom-prototype-e2e-abc/', tmp), true);
  assert.equal(isPrototypeDataPath('/var/tmp/other', tmp), false, 'wrong name');
  assert.equal(isPrototypeDataPath('/var/tmp/sub/bowerloom-prototype-abc', tmp), false, 'not directly inside');
  assert.equal(isPrototypeDataPath('/var/tmp/bowerloom-prototype-abc/../../etc', tmp), false, 'a dot-dot walk');
  assert.equal(isPrototypeDataPath('/var/tmp/x/../bowerloom-prototype-abc', tmp), true, 'a dot-dot walk that ends in the right place');
  assert.equal(isPrototypeDataPath('/home/me/.config/Bowerloom', tmp), false, 'the real app data');
  assert.equal(isPrototypeDataPath('/var/tmpx/bowerloom-prototype-abc', tmp), false, 'a folder next to it with a longer name');
  assert.equal(isPrototypeDataPath('/var/tmp/bowerloom-prototype-', tmp), false, 'the prefix alone');
  assert.equal(isPrototypeDataPath('', tmp), false);
  assert.equal(isPrototypeDataPath('/var/tmp/bowerloom-prototype-abc', ''), false);
});

test('the prototype keeps a given data folder only when it is a prototype data folder, and otherwise asks for a fresh one', () => {
  const tmp = '/var/tmp';
  assert.deepEqual(chooseUserData(null, tmp), { action: 'make' });
  assert.deepEqual(chooseUserData('/var/tmp/bowerloom-prototype-q1', tmp), { action: 'keep', dir: '/var/tmp/bowerloom-prototype-q1' });
  assert.deepEqual(chooseUserData('/Users/me/Library/Application Support/Bowerloom', tmp), { action: 'make' }, 'real app data is never used');
  assert.deepEqual(chooseUserData('/var/tmp/other', tmp), { action: 'make' });
});

test('the removal decision: only a real directory, directly in the temp folder, with the prefix', () => {
  const ok = { isSymbolicLink: false, isDirectory: true, realParent: '/private/tmp', realTmp: '/private/tmp' };
  assert.equal(mayRemovePrototypeDir('/tmp/bowerloom-prototype-a', ok), true);
  assert.equal(mayRemovePrototypeDir('/tmp/keep-me', ok), false);
  assert.equal(mayRemovePrototypeDir('/tmp/bowerloom-prototype-a', { ...ok, isSymbolicLink: true }), false);
  assert.equal(mayRemovePrototypeDir('/tmp/bowerloom-prototype-a', { ...ok, isDirectory: false }), false);
  assert.equal(mayRemovePrototypeDir('/tmp/bowerloom-prototype-a', { ...ok, realParent: '/elsewhere' }), false);
});

test('a new prototype data folder is private and fresh, and only such a folder is removed', t => {
  const tmp = tempDir(t), a = makePrototypeDataDir(tmp), b = makePrototypeDataDir(tmp);
  assert.notEqual(a, b); assert.ok(a.startsWith(tmp)); assert.match(a, /bowerloom-prototype-/);
  if (process.platform !== 'win32') assert.equal(lstatSync(a).mode & 0o777, 0o700, 'only the owner may enter');
  writeFileSync(join(a, 'cache'), 'x');
  assert.equal(removePrototypeDataDir(a, tmp), 'removed'); assert.equal(existsSync(a), false); assert.equal(existsSync(b), true);
  assert.equal(removePrototypeDataDir(a, tmp), 'absent', 'already gone');
  const other = join(tmp, 'keep-me'); mkdirSync(other); assert.equal(removePrototypeDataDir(other, tmp), 'refused'); assert.equal(existsSync(other), true);
  const target = tempDir(t); writeFileSync(join(target, 'precious'), 'x'); const link = join(tmp, 'bowerloom-prototype-link'); symlinkSync(target, link);
  assert.equal(removePrototypeDataDir(link, tmp), 'refused'); assert.equal(existsSync(join(target, 'precious')), true);
});

test('main.ts gives the prototype its own temporary data folder before the app is ready, and removes it on quit', () => {
  const main = strip(read('main/main.ts'));
  assert.match(main, /app\.setPath\('userData', /);
  assert.ok(main.indexOf("app.setPath('userData'") > -1 && main.indexOf("app.setPath('userData'") < main.indexOf('app.whenReady()'), 'set before the app is ready');
  assert.match(main, /chooseUserData\(userDataArg\(argv\), tmpdir\(\)\)/);
  assert.match(main, /removeAndReport\(/);
  assert.match(main, /app\.once\('quit'/);
  assert.match(main, /process\.once\('exit'/);
});

// ---- 16. the launcher cleans up reliably

type Run = { superviseChild(child: unknown, options: unknown): void; exitCodeFor(signal: string | null | undefined): number };
const load = async (): Promise<Run> => await import(`${join(DESKTOP, 'tools', 'run.mjs')}`) as Run;

function fakes() {
  const proc = Object.assign(new EventEmitter(), { exitCodes: [] as number[], exit(code: number) { this.exitCodes.push(code); } });
  const child = Object.assign(new EventEmitter(), { killed: [] as string[], kill(signal: string) { this.killed.push(signal); return true; } });
  const removed: string[] = [];
  return { proc, child, removed, options: { dataDir: '/tmp/bowerloom-prototype-x', proc, remove: (dir: string) => { removed.push(dir); return true; }, fail: (text: string, code: number) => { proc.exitCodes.push(code); void text; } } };
}

test('a stop signal is passed to the app window, and the folder goes only after the window has gone', async () => {
  const { superviseChild } = await load();
  for (const [signal, code] of [['SIGINT', 130], ['SIGTERM', 143], ['SIGHUP', 129]] as const) {
    const f = fakes();
    superviseChild(f.child, f.options);
    f.proc.emit(signal);
    assert.deepEqual(f.child.killed, [signal], `${signal} reaches the window`);
    assert.deepEqual(f.proc.exitCodes, [], `${signal}: the launcher waits for the window`);
    assert.deepEqual(f.removed, [], `${signal}: the folder is still there while the window runs`);
    f.child.emit('exit', null, signal);
    assert.deepEqual(f.removed, ['/tmp/bowerloom-prototype-x']);
    assert.deepEqual(f.proc.exitCodes, [code], signal);
  }
});

test('a normal close removes the folder and passes the exit code on; a crash is reported and still cleans up', async () => {
  const { superviseChild } = await load();
  const a = fakes(); superviseChild(a.child, a.options); a.child.emit('exit', 0, null);
  assert.deepEqual(a.removed, ['/tmp/bowerloom-prototype-x']); assert.deepEqual(a.proc.exitCodes, [0]);
  const b = fakes(); superviseChild(b.child, b.options); b.child.emit('exit', 3, null);
  assert.deepEqual(b.proc.exitCodes, [3]);
  const c = fakes(); superviseChild(c.child, c.options); c.child.emit('exit', null, 'SIGKILL');
  assert.deepEqual(c.removed, ['/tmp/bowerloom-prototype-x']); assert.deepEqual(c.proc.exitCodes, [1], 'a window that was killed from outside is an error');
  const d = fakes(); superviseChild(d.child, d.options); d.child.emit('error', new Error('no start'));
  assert.deepEqual(d.removed, ['/tmp/bowerloom-prototype-x']); assert.deepEqual(d.proc.exitCodes, [1]);
});

test('with no data folder (another mode) the launcher still passes signals on and removes nothing', async () => {
  const { superviseChild } = await load();
  const f = fakes(); superviseChild(f.child, { ...f.options, dataDir: null });
  f.proc.emit('SIGTERM'); f.child.emit('exit', null, 'SIGTERM');
  assert.deepEqual(f.removed, []); assert.deepEqual(f.child.killed, ['SIGTERM']);
});

test('the launcher source handles SIGHUP, no longer exits at once on a signal, and says what a hard kill leaves behind', async () => {
  const raw = read('tools/run.mjs'), src = strip(raw);
  assert.match(src, /SIGHUP/);
  assert.doesNotMatch(src, /process\.once\('SIGINT', \(\) => process\.exit/);
  assert.match(raw, /SIGKILL/, 'a comment names the signal that cannot be caught');
  assert.match(src, /superviseChild\(child/);
  assert.equal((await load()).exitCodeFor('SIGHUP'), 129);
});

// ---- 17. the prototype page has no bridge

test('the window leaves the preload out in prototype mode, and keeps it in every other mode', () => {
  assert.equal('preload' in webPreferences(undefined), false);
  assert.equal(webPreferences('/x/preload.cjs').preload, '/x/preload.cjs');
  assert.equal(webPreferences(undefined).contextIsolation, true); assert.equal(webPreferences(undefined).sandbox, true);
  const main = strip(read('main/main.ts'));
  assert.match(main, /webPreferences\(prototypeMode \? undefined : join\(root, 'preload\.cjs'\), app\.isPackaged\)/);
});

test('app.ts does not fail when the page has no bridge, and the home app and harness pages are still mounted', () => {
  const app = strip(read('renderer/app.ts'));
  assert.match(app, /const api: ViewerApi = window\.bowerloom \?\?/);
  assert.match(app, /isHarnessHash\(location\.hash\)/); assert.match(app, /isHomeHash\(location\.hash\)/); assert.doesNotMatch(app, /mountPrototype|#prototype'/);
  const preload = strip(read('preload/preload.ts'));
  assert.doesNotMatch(preload, /prototype/i);
});

// ---- fix pass C3: a folder that cannot be removed is said out loud, and a failed start is shown

const canLock = process.platform !== 'win32' && typeof process.getuid === 'function' && process.getuid() !== 0;

test('a folder that cannot be removed answers failed, and removeAndReport says so once', { skip: !canLock }, t => {
  const tmp = tempDir(t), dir = makePrototypeDataDir(tmp), inner = join(dir, 'locked');
  mkdirSync(inner); writeFileSync(join(inner, 'f'), 'x'); chmodSync(inner, 0o500);
  try {
    assert.equal(removePrototypeDataDir(dir, tmp), 'failed'); assert.equal(existsSync(dir), true);
    const said: string[] = [];
    assert.equal(removeAndReport(dir, tmp, text => said.push(text)), 'failed');
    assert.equal(removeAndReport(dir, tmp, text => said.push(text)), 'failed');
    assert.deepEqual(said, [`Could not remove ${dir}. Delete it yourself.\n`], 'said once, with the folder named');
  } finally { chmodSync(inner, 0o700); rmSync(dir, { recursive: true, force: true }); }
});

test('removeAndReport is silent when the folder is gone or was removed, and says so when it refuses a folder that is still there', t => {
  const tmp = tempDir(t), said: string[] = [], say = (text: string): void => { said.push(text); };
  const dir = makePrototypeDataDir(tmp);
  assert.equal(removeAndReport(dir, tmp, say), 'removed'); assert.equal(removeAndReport(dir, tmp, say), 'absent');
  assert.deepEqual(said, []);
  const other = join(tmp, 'keep-me'); mkdirSync(other);
  assert.equal(removeAndReport(other, tmp, say), 'refused');
  assert.deepEqual(said, [`Could not remove ${other}. Delete it yourself.\n`]);
});

test('main.ts shows an error box and exits when the start fails or the page does not load', () => {
  const main = strip(read('main/main.ts'));
  assert.match(main, /dialog\.showErrorBox\(/); assert.match(main, /Bowerloom prototype could not start/); assert.match(main, /app\.exit\(1\)/);
  assert.match(main, /process\.stderr\.write\(/);
  assert.match(main, /app\.whenReady\(\)\.then\(async[\s\S]*\}\)\.catch\(startupFailed\)/, 'whenReady has a catch');
  // Every load has a catch: the plain window, --prototype-v2 and --prototype-v3.
  const loads = [...main.matchAll(/window\.loadURL\(/g)].length;
  assert.equal(loads, 3, 'three loads');
  assert.equal([...main.matchAll(/window\.loadURL\([^;]*\)\.catch\(startupFailed\)/g)].length, loads, 'every loadURL call has a catch');
  assert.doesNotMatch(main, /void window\.loadURL/);
  assert.match(main, /removeAndReport\(/, 'the quit clean-up says when it could not remove the folder');
});
