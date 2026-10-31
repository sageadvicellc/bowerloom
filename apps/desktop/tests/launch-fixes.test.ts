// A made-up launch (--sample, and the two home app dev flags) writes nothing to the real app data, with or without the launcher; the launcher cleans up reliably; and a made-up page has no bridge.
// The app on the person's own folders keeps the lasting data folder of Electron.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { E2E_PREFIX, SAMPLE_PREFIX, TEMP_PREFIXES, chooseUserData, isTempDataPath, makeTempDataDir, mayRemoveTempDir, removeAndReport, removeTempDataDir, userDataArg } from '../main/security.js';
import { webPreferences } from '../main/security.js';
import { DESKTOP, tempDir } from './support.js';

const read = (file: string): string => readFileSync(join(DESKTOP, file), 'utf8');
const strip = (text: string): string => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

// ---- 15. the app makes its own temporary data folder

test('the user data folder argument is read from the command line, the last one winning', () => {
  assert.equal(userDataArg(['/d', '--sample']), null);
  assert.equal(userDataArg(['/d', '--user-data-dir=/tmp/x', '--sample']), '/tmp/x');
  assert.equal(userDataArg(['--user-data-dir=/a', '--user-data-dir=/b']), '/b');
  assert.equal(userDataArg(['--user-data-dir=']), null, 'an empty value is no value');
  assert.equal(userDataArg(['--user-data-dir', '/tmp/x']), null, 'only the form with an equals sign is one Chromium reads');
});

test('a folder counts as a temporary data folder only when it sits directly in the temp folder and has the prefix', () => {
  const tmp = '/var/tmp';
  assert.deepEqual([...TEMP_PREFIXES], ['bowerloom-sample-', 'bowerloom-e2e-']);
  assert.equal(isTempDataPath('/var/tmp/bowerloom-sample-abc', tmp), true);
  assert.equal(isTempDataPath('/var/tmp/bowerloom-e2e-abc/', tmp), true);
  assert.equal(isTempDataPath('/var/tmp/other', tmp), false, 'wrong name');
  assert.equal(isTempDataPath('/var/tmp/sub/bowerloom-sample-abc', tmp), false, 'not directly inside');
  assert.equal(isTempDataPath('/var/tmp/bowerloom-sample-abc/../../etc', tmp), false, 'a dot-dot walk');
  assert.equal(isTempDataPath('/var/tmp/x/../bowerloom-sample-abc', tmp), true, 'a dot-dot walk that ends in the right place');
  assert.equal(isTempDataPath('/home/me/.config/Bowerloom', tmp), false, 'the real app data');
  assert.equal(isTempDataPath('/var/tmpx/bowerloom-sample-abc', tmp), false, 'a folder next to it with a longer name');
  assert.equal(isTempDataPath('/var/tmp/bowerloom-sample-', tmp), false, 'the prefix alone');
  assert.equal(isTempDataPath('', tmp), false);
  assert.equal(isTempDataPath('/var/tmp/bowerloom-sample-abc', ''), false);
  assert.equal(isTempDataPath('/var/tmp/bowerloom-prototype-abc', tmp), false, 'the old prefix is not a prefix any more');
  assert.equal(SAMPLE_PREFIX, 'bowerloom-sample-'); assert.equal(E2E_PREFIX, 'bowerloom-e2e-');
});

test('a made-up launch keeps a given data folder only when it is a temporary data folder, and otherwise asks for a fresh one', () => {
  const tmp = '/var/tmp';
  assert.deepEqual(chooseUserData(null, tmp), { action: 'make' });
  assert.deepEqual(chooseUserData('/var/tmp/bowerloom-sample-q1', tmp), { action: 'keep', dir: '/var/tmp/bowerloom-sample-q1' });
  assert.deepEqual(chooseUserData('/Users/me/Library/Application Support/Bowerloom', tmp), { action: 'make' }, 'real app data is never used');
  assert.deepEqual(chooseUserData('/var/tmp/other', tmp), { action: 'make' });
});

test('the removal decision: only a real directory, directly in the temp folder, with the prefix', () => {
  const ok = { isSymbolicLink: false, isDirectory: true, realParent: '/private/tmp', realTmp: '/private/tmp' };
  assert.equal(mayRemoveTempDir('/tmp/bowerloom-sample-a', ok), true);
  assert.equal(mayRemoveTempDir('/tmp/keep-me', ok), false);
  assert.equal(mayRemoveTempDir('/tmp/bowerloom-sample-a', { ...ok, isSymbolicLink: true }), false);
  assert.equal(mayRemoveTempDir('/tmp/bowerloom-sample-a', { ...ok, isDirectory: false }), false);
  assert.equal(mayRemoveTempDir('/tmp/bowerloom-sample-a', { ...ok, realParent: '/elsewhere' }), false);
});

test('a new temporary data folder is private and fresh, and only such a folder is removed', t => {
  const tmp = tempDir(t), a = makeTempDataDir(tmp), b = makeTempDataDir(tmp);
  assert.notEqual(a, b); assert.ok(a.startsWith(tmp)); assert.match(a, /bowerloom-sample-/);
  if (process.platform !== 'win32') assert.equal(lstatSync(a).mode & 0o777, 0o700, 'only the owner may enter');
  writeFileSync(join(a, 'cache'), 'x');
  assert.equal(removeTempDataDir(a, tmp), 'removed'); assert.equal(existsSync(a), false); assert.equal(existsSync(b), true);
  assert.equal(removeTempDataDir(a, tmp), 'absent', 'already gone');
  const other = join(tmp, 'keep-me'); mkdirSync(other); assert.equal(removeTempDataDir(other, tmp), 'refused'); assert.equal(existsSync(other), true);
  const target = tempDir(t); writeFileSync(join(target, 'precious'), 'x'); const link = join(tmp, 'bowerloom-sample-link'); symlinkSync(target, link);
  assert.equal(removeTempDataDir(link, tmp), 'refused'); assert.equal(existsSync(join(target, 'precious')), true);
});

test('main.ts gives a made-up launch its own temporary data folder before the app is ready, removes it on quit, and leaves the app on the person\'s own folders with the normal one', () => {
  const main = strip(read('main/main.ts'));
  assert.match(main, /if \(launch\.temporaryData\) \{\s*const choice = chooseUserData\(userDataArg\(argv\), tmpdir\(\)\)/);
  assert.match(main, /app\.setPath\('userData', /);
  assert.ok(main.indexOf("app.setPath('userData'") > -1 && main.indexOf("app.setPath('userData'") < main.indexOf('app.whenReady()'), 'set before the app is ready');
  assert.equal([...main.matchAll(/app\.setPath\(/g)].length, 1, 'the one place that moves the data folder is the made-up launch');
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
  return { proc, child, removed, options: { dataDir: '/tmp/bowerloom-sample-x', proc, remove: (dir: string) => { removed.push(dir); return true; }, fail: (text: string, code: number) => { proc.exitCodes.push(code); void text; } } };
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
    assert.deepEqual(f.removed, ['/tmp/bowerloom-sample-x']);
    assert.deepEqual(f.proc.exitCodes, [code], signal);
  }
});

test('a normal close removes the folder and passes the exit code on; a crash is reported and still cleans up', async () => {
  const { superviseChild } = await load();
  const a = fakes(); superviseChild(a.child, a.options); a.child.emit('exit', 0, null);
  assert.deepEqual(a.removed, ['/tmp/bowerloom-sample-x']); assert.deepEqual(a.proc.exitCodes, [0]);
  const b = fakes(); superviseChild(b.child, b.options); b.child.emit('exit', 3, null);
  assert.deepEqual(b.proc.exitCodes, [3]);
  const c = fakes(); superviseChild(c.child, c.options); c.child.emit('exit', null, 'SIGKILL');
  assert.deepEqual(c.removed, ['/tmp/bowerloom-sample-x']); assert.deepEqual(c.proc.exitCodes, [1], 'a window that was killed from outside is an error');
  const d = fakes(); superviseChild(d.child, d.options); d.child.emit('error', new Error('no start'));
  assert.deepEqual(d.removed, ['/tmp/bowerloom-sample-x']); assert.deepEqual(d.proc.exitCodes, [1]);
});

test('with no data folder (the app on the person\'s own folders) the launcher still passes signals on and removes nothing', async () => {
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

// ---- 17. a made-up page has no bridge

test('the window leaves the preload out for a made-up launch, and gives the real bridge to the others', () => {
  assert.equal('preload' in webPreferences(undefined), false);
  assert.equal(webPreferences('/x/preload.cjs').preload, '/x/preload.cjs');
  assert.equal(webPreferences(undefined).contextIsolation, true); assert.equal(webPreferences(undefined).sandbox, true);
  const main = strip(read('main/main.ts'));
  assert.match(main, /webPreferences\(launch\.preload === 'real' \? join\(root, 'preload-real\.cjs'\) : undefined, app\.isPackaged\)/);
  assert.doesNotMatch(main, /join\(root, 'preload\.cjs'\)/, 'the old viewer bridge is not loaded');
});

test('app.ts mounts the harness-first app or the home app by the page address, and has no bridge of its own', () => {
  const app = strip(read('renderer/app.ts'));
  assert.match(app, /isHarnessHash\(location\.hash\)/); assert.match(app, /isHomeHash\(location\.hash\)/); assert.doesNotMatch(app, /window\.bowerloom\b|mountPrototype/);
  assert.match(app, /location\.hash = REAL_BASE/, 'a bare address is the app on the person\'s own folders, never the sample');
  assert.equal(existsSync(join(DESKTOP, 'preload', 'preload.ts')), false, 'the viewer bridge is gone');
});

// ---- fix pass C3: a folder that cannot be removed is said out loud, and a failed start is shown

const canLock = process.platform !== 'win32' && typeof process.getuid === 'function' && process.getuid() !== 0;

test('a folder that cannot be removed answers failed, and removeAndReport says so once', { skip: !canLock }, t => {
  const tmp = tempDir(t), dir = makeTempDataDir(tmp), inner = join(dir, 'locked');
  mkdirSync(inner); writeFileSync(join(inner, 'f'), 'x'); chmodSync(inner, 0o500);
  try {
    assert.equal(removeTempDataDir(dir, tmp), 'failed'); assert.equal(existsSync(dir), true);
    const said: string[] = [];
    assert.equal(removeAndReport(dir, tmp, text => said.push(text)), 'failed');
    assert.equal(removeAndReport(dir, tmp, text => said.push(text)), 'failed');
    assert.deepEqual(said, [`Could not remove ${dir}. Delete it yourself.\n`], 'said once, with the folder named');
  } finally { chmodSync(inner, 0o700); rmSync(dir, { recursive: true, force: true }); }
});

test('removeAndReport is silent when the folder is gone or was removed, and says so when it refuses a folder that is still there', t => {
  const tmp = tempDir(t), said: string[] = [], say = (text: string): void => { said.push(text); };
  const dir = makeTempDataDir(tmp);
  assert.equal(removeAndReport(dir, tmp, say), 'removed'); assert.equal(removeAndReport(dir, tmp, say), 'absent');
  assert.deepEqual(said, []);
  const other = join(tmp, 'keep-me'); mkdirSync(other);
  assert.equal(removeAndReport(other, tmp, say), 'refused');
  assert.deepEqual(said, [`Could not remove ${other}. Delete it yourself.\n`]);
});

test('main.ts shows an error box and exits when the start fails or the page does not load', () => {
  const main = strip(read('main/main.ts'));
  assert.match(main, /dialog\.showErrorBox\(/); assert.match(main, /Bowerloom could not start/); assert.doesNotMatch(main, /prototype/i); assert.match(main, /app\.exit\(1\)/);
  assert.match(main, /process\.stderr\.write\(/);
  assert.match(main, /app\.whenReady\(\)\.then\(async[\s\S]*\}\)\.catch\(startupFailed\)/, 'whenReady has a catch');
  // Every load has a catch: there is one load, and it takes its address from the launch.
  const loads = [...main.matchAll(/window\.loadURL\(/g)].length;
  assert.equal(loads, 1, 'one load');
  assert.equal([...main.matchAll(/window\.loadURL\([^;]*\)\.catch\(startupFailed\)/g)].length, loads, 'every loadURL call has a catch');
  assert.doesNotMatch(main, /void window\.loadURL/);
  assert.match(main, /removeAndReport\(/, 'the quit clean-up says when it could not remove the folder');
});
