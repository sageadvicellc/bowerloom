// The controller answers the window's calls. Tested without Electron, with a fake host.
import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createController } from '../main/controller.js';
import type { Host } from '../main/controller.js';
import { CONFIG_FILE, DEFAULT_SETTINGS, MAX_ROOTS, loadSettings, parseSettings, saveSettings } from '../main/config.js';
import { OFF_TEXT, UPDATES_ENABLED, UPDATE_FEED, checkForUpdates, initialUpdateState } from '../main/updates.js';
import { SAMPLE_DIR, tempDir } from './support.js';

function host(t: import('node:test').TestContext, over: Partial<Host> = {}): { host: Host; app: string; opened: string[] } {
  const app = join(tempDir(t), 'appdata'), opened: string[] = [];
  return { app, opened, host: { appDir: app, sampleDir: SAMPLE_DIR, version: '9.9.9', platform: 'test', forcedMode: null, pickFolder: async () => null, openExternal: async url => { opened.push(url); }, ...over } };
}

test('first run has no mode; sample mode reads the sample; the answer is plain data', async t => {
  const h = host(t), c = createController(h.host);
  const first = await c.getInfo(); assert.equal(first.firstRun, true); assert.equal(first.mode, null); assert.equal(first.version, '9.9.9');
  await assert.rejects(() => c.getSnapshot(), /Choose what to look at first/);
  const info = await c.chooseMode('sample'); assert.equal(info.mode, 'sample'); assert.equal(info.firstRun, false);
  const snap = await c.getSnapshot(); assert.equal(snap.projects.length, 3); assert.equal(snap.mode, 'sample');
  assert.doesNotThrow(() => JSON.stringify(snap)); assert.ok(info.storePath.endsWith('/sample/home/.bowerloom'));
  assert.equal(existsSync(join(h.app, 'sample', 'home', '.bowerloom', 'store.json')), true);
});

test('a launch flag fixes the mode and is not saved', async t => {
  const h = host(t, { forcedMode: 'sample' }), c = createController(h.host);
  assert.equal((await c.getInfo()).mode, 'sample'); await c.chooseMode('sample');
  assert.equal(existsSync(join(h.app, CONFIG_FILE)), false, 'nothing saved by a sample run');
});

test('real mode reads the given home and the folders the person added; the choice is remembered', async t => {
  const home = tempDir(t), projects = join(home, 'Projects'); mkdirSync(projects); mkdirSync(join(projects, 'p')); writeFileSync(join(projects, 'p', 'bowerloom.json'), '{}\n');
  const h = host(t, { home, pickFolder: async () => projects }), c = createController(h.host);
  await c.chooseMode('real');
  assert.equal((await c.getSnapshot()).projects.length, 0, 'no folder added yet');
  const s = await c.addRoot(); assert.deepEqual(s.settings.roots, [projects]); assert.equal(s.message, null);
  const snap = await c.getSnapshot(); assert.equal(snap.projects.length, 1); assert.equal(snap.store.state, 'absent'); assert.equal(snap.mode, 'real');
  assert.equal(loadSettings(h.app).settings.mode, 'real'); assert.deepEqual(loadSettings(h.app).settings.roots, [projects]);
  assert.deepEqual((await c.removeRoot(projects)).settings.roots, []);
  assert.deepEqual((await c.removeRoot('/not/in/the/list')).settings.roots, [], 'removing an unknown folder changes nothing');
});

test('adding a folder: a cancel changes nothing, a link is saved as its real place, a file is refused', async t => {
  const base = tempDir(t), real = join(base, 'real'), link = join(base, 'link'), file = join(base, 'file'); mkdirSync(real); symlinkSync(real, link); writeFileSync(file, 'x');
  let pick: string | null = null; const h = host(t, { home: base, pickFolder: async () => pick }), c = createController(h.host);
  assert.deepEqual((await c.addRoot()).settings.roots, []);
  pick = link; assert.deepEqual((await c.addRoot()).settings.roots, [real]);
  pick = file; { const r = await c.addRoot(); assert.deepEqual(r.settings.roots, [real]); assert.match(r.message!, /not a folder/); }
  pick = join(base, 'gone'); { const r = await c.addRoot(); assert.deepEqual(r.settings.roots, [real]); assert.match(r.message!, /could not be opened/); }
  pick = real; { const r = await c.addRoot(); assert.deepEqual(r.settings.roots, [real], 'no duplicate'); assert.match(r.message!, /already in the list/); }
});

test('the window cannot ask for a file by path: only known items and known projects', async t => {
  const h = host(t, { forcedMode: 'sample' }), c = createController(h.host), snap = await c.getSnapshot();
  const key = snap.projects.find(p => p.name === 'newsletter')!.key;
  const bad = [{ kind: 'skill', id: '../../etc/passwd', projectKey: null }, { kind: 'bogus', id: 'x', projectKey: null }, { kind: 'skill', id: 'house-style', projectKey: '/etc' }, { kind: 'skill', id: 'house-style', projectKey: 7 }, null, undefined, 'x'] as never[];
  for (const request of bad) { const r = await c.getItemContent(request); assert.deepEqual(r.files, [], JSON.stringify(request)); assert.ok(r.note); }
  assert.ok((await c.getItemContent({ kind: 'skill', id: 'house-style', projectKey: null })).files.length > 0);
  assert.ok((await c.getItemContent({ kind: 'team', id: 'newsroom', projectKey: key })).files.some(f => f.path === 'agents/publisher.md'));
  for (const request of [{ projectKey: '/etc', file: 'config' }, { projectKey: key, file: '../../etc/passwd' }, { projectKey: key, file: 'x' }, null] as never[]) assert.equal((await c.getFileText(request)).text, null);
  const config = await c.getFileText({ projectKey: key, file: 'config' }); assert.match(config.text!, /"format": "bowerloom\/project\/v1beta1"/);
  assert.match((await c.getFileText({ projectKey: snap.projects.find(p => p.name === 'old-archive')!.key, file: 'lock' })).text!, /<<<<<<< HEAD/, 'a damaged file is shown as it is, as text');
  const studio = snap.projects.find(p => p.name === 'studio-site')!.key; assert.match((await c.getFileText({ projectKey: studio, file: 'lock' })).text!, /"format": "bowerloom\/lock\/v1beta1"/);
});

test('a raw file that is a link is not shown', async t => {
  const h = host(t, { forcedMode: 'sample' }), c = createController(h.host), snap = await c.getSnapshot();
  const key = snap.projects.find(p => p.name === 'newsletter')!.key;
  (await import('node:fs')).rmSync(join(key, 'bowerloom.lock.json')); symlinkSync('/etc/hosts', join(key, 'bowerloom.lock.json'));
  const r = await c.getFileText({ projectKey: key, file: 'lock' }); assert.equal(r.text, null); assert.match(r.note!, /not shown/);
});

test('themes: only the three known values are kept, and the file is private to the owner', async t => {
  const h = host(t), c = createController(h.host);
  assert.equal((await c.setTheme('dark')).settings.theme, 'dark'); assert.equal((await c.setTheme('neon' as never)).settings.theme, 'dark');
  assert.equal(lstatSync(join(h.app, CONFIG_FILE)).mode & 0o777, 0o600); assert.equal(loadSettings(h.app).settings.theme, 'dark');
});

test('links: only the allowlist reaches the browser', async t => {
  const h = host(t), c = createController(h.host);
  assert.equal(await c.openLink('https://github.com/sageadvicellc/bowerloom'), true); assert.equal(await c.openLink('https://evil.example/'), false); assert.equal(await c.openLink('file:///etc/passwd'), false);
  assert.deepEqual(h.opened, ['https://github.com/sageadvicellc/bowerloom']);
});

test('settings parsing is strict about shape and size, and never silently resets', t => {
  assert.equal(parseSettings('not json'), null); assert.equal(parseSettings('[]'), null); assert.equal(parseSettings('null'), null);
  assert.deepEqual(parseSettings(JSON.stringify({ theme: 'weird', roots: ['/ok', 'relative', 5, '/ok', '/bad\0'], mode: 'x', updatesEnabled: true })), { theme: 'system', roots: ['/ok'], mode: null }, 'a file can no longer turn updates on');
  assert.equal(parseSettings(JSON.stringify({ roots: Array.from({ length: 50 }, (_, i) => `/r${i}`) }))!.roots.length, MAX_ROOTS);
  const dir = tempDir(t);
  assert.deepEqual(loadSettings(dir), { settings: { ...DEFAULT_SETTINGS, roots: [] }, notice: null }, 'no file is a first run, with no notice');
  writeFileSync(join(dir, CONFIG_FILE), 'x'.repeat(70000)); assert.match(loadSettings(dir).notice!, /far too big/);
  writeFileSync(join(dir, CONFIG_FILE), '{ not json'); assert.match(loadSettings(dir).notice!, /damaged/);
  writeFileSync(join(dir, CONFIG_FILE), JSON.stringify({ roots: Array.from({ length: 30 }, (_, i) => `/r${i}`) })); assert.match(loadSettings(dir).notice!, /left out/);
  rmSync(join(dir, CONFIG_FILE)); symlinkSync('/etc/hosts', join(dir, CONFIG_FILE)); assert.match(loadSettings(dir).notice!, /shortcut/);
  rmSync(join(dir, CONFIG_FILE)); mkdirSync(join(dir, CONFIG_FILE)); assert.match(loadSettings(dir).notice!, /not a plain file/);
  rmSync(join(dir, CONFIG_FILE), { recursive: true });
  saveSettings(dir, { theme: 'light', roots: ['/a'], mode: 'real' }); assert.deepEqual(JSON.parse(readFileSync(join(dir, CONFIG_FILE), 'utf8')), { theme: 'light', roots: ['/a'], mode: 'real' });
});

test('a damaged settings file is shown as a notice, kept as .bak before it is overwritten, and a failed save changes nothing and leaves no temp file', async t => {
  const h = host(t); mkdirSync(h.app, { recursive: true }); writeFileSync(join(h.app, CONFIG_FILE), '{ damaged');
  const c = createController(h.host);
  assert.match((await c.getInfo()).notice!, /damaged/);
  assert.equal((await c.setTheme('dark')).message, null); assert.equal((await c.getInfo()).notice, null, 'a good save clears the notice');
  assert.equal(readFileSync(join(h.app, `${CONFIG_FILE}.bak`), 'utf8'), '{ damaged', 'the damaged file was kept');
  // The folder is made unwritable: the save fails, memory keeps the old value, the temp file is gone.
  chmodSync(h.app, 0o500);
  try {
    const r = await c.setTheme('light'); assert.match(r.message!, /could not be saved/); assert.equal(r.settings.theme, 'dark'); assert.equal((await c.getSettings()).theme, 'dark');
  } finally { chmodSync(h.app, 0o700); }
  assert.equal(existsSync(join(h.app, `${CONFIG_FILE}.tmp`)), false);
});

test('the 20 folder limit is reported, not silently dropped', async t => {
  const base = tempDir(t); let n = 0; const h = host(t, { home: base, pickFolder: async () => { const d = join(base, `f${n++}`); mkdirSync(d); return d; } }), c = createController(h.host);
  for (let i = 0; i < MAX_ROOTS; i++) assert.equal((await c.addRoot()).message, null);
  const over = await c.addRoot(); assert.match(over.message!, /at most 20/); assert.equal(over.settings.roots.length, MAX_ROOTS);
});

test('project keys are checked again against the folders now chosen, and choosing or removing clears the old list', async t => {
  const home = tempDir(t), projects = join(home, 'Projects'); mkdirSync(join(projects, 'p'), { recursive: true }); writeFileSync(join(projects, 'p', 'bowerloom.json'), '{}\n');
  const h = host(t, { home, pickFolder: async () => projects }), c = createController(h.host);
  await c.chooseMode('real'); await c.addRoot();
  const key = (await c.getSnapshot()).projects[0]!.key;
  assert.match((await c.getFileText({ projectKey: key, file: 'config' })).text!, /\{\}/);
  await c.removeRoot(projects);
  assert.equal((await c.getFileText({ projectKey: key, file: 'config' })).text, null, 'the folder was removed, so the key is no longer allowed');
  assert.equal((await c.getItemContent({ kind: 'skill', id: 'x', projectKey: key })).files.length, 0);
  await c.addRoot(); await c.getSnapshot(); await c.chooseMode('sample');
  assert.equal((await c.getFileText({ projectKey: key, file: 'config' })).text, null, 'choosing another mode clears the list');
});

test('updates are off by default: no network, no updater loaded, and the footer says when they turn on', async () => {
  assert.equal(UPDATES_ENABLED, false, 'a build-time constant, not a setting'); assert.equal(OFF_TEXT, 'Updates turn on after the first release');
  assert.deepEqual(initialUpdateState(false), { enabled: false, status: OFF_TEXT });
  let loaded = 0; const r = await checkForUpdates(initialUpdateState(false), async () => { loaded++; throw new Error('must not load'); });
  assert.equal(loaded, 0); assert.equal(r.status, `${OFF_TEXT}.`); assert.equal(r.enabled, false);
  assert.deepEqual(UPDATE_FEED, { provider: 'github', owner: 'sageadvicellc', repo: 'bowerloom' });
});

test('updates when turned on: ask the GitHub feed once, never download by themselves, and fail softly', async () => {
  const calls: string[] = [];
  const ok = await checkForUpdates(initialUpdateState(true), async () => ({ autoUpdater: { autoDownload: true, setFeedURL: (f: unknown) => { calls.push(JSON.stringify(f)); }, checkForUpdates: async () => { calls.push('check'); } } }));
  assert.deepEqual(calls, [JSON.stringify(UPDATE_FEED), 'check']); assert.equal(ok.status, 'Checked just now.');
  const bad = await checkForUpdates(initialUpdateState(true), async () => { throw new Error('offline'); }); assert.match(bad.status, /Could not check/);
});

test('saving settings refuses a link where the backup or the temporary file goes, keeps the backup private, and never writes through a link', async t => {
  const dir = tempDir(t), target = join(tempDir(t), 'victim'); writeFileSync(target, 'precious');
  saveSettings(dir, { theme: 'dark', roots: [], mode: null });
  // 1. The .bak is a link: the save is refused, and the target of the link is untouched.
  symlinkSync(target, join(dir, `${CONFIG_FILE}.bak`));
  assert.throws(() => saveSettings(dir, { theme: 'light', roots: [], mode: null })); assert.equal(readFileSync(target, 'utf8'), 'precious');
  assert.equal(JSON.parse(readFileSync(join(dir, CONFIG_FILE), 'utf8')).theme, 'dark', 'the settings file was not changed');
  rmSync(join(dir, `${CONFIG_FILE}.bak`));
  // 2. The .tmp is a link: refused, target untouched.
  symlinkSync(target, join(dir, `${CONFIG_FILE}.tmp`));
  assert.throws(() => saveSettings(dir, { theme: 'light', roots: [], mode: null })); assert.equal(readFileSync(target, 'utf8'), 'precious');
  rmSync(join(dir, `${CONFIG_FILE}.tmp`));
  // 3. With no links: it works, and the backup is private to the owner.
  saveSettings(dir, { theme: 'light', roots: [], mode: null });
  assert.equal(lstatSync(join(dir, `${CONFIG_FILE}.bak`)).mode & 0o777, 0o600); assert.equal(lstatSync(join(dir, CONFIG_FILE)).mode & 0o777, 0o600);
  assert.equal(existsSync(join(dir, `${CONFIG_FILE}.tmp`)), false);
  // 4. A leftover plain .tmp from a stopped save is replaced, not trusted.
  writeFileSync(join(dir, `${CONFIG_FILE}.tmp`), 'stale', { mode: 0o666 });
  saveSettings(dir, { theme: 'system', roots: [], mode: null }); assert.equal(JSON.parse(readFileSync(join(dir, CONFIG_FILE), 'utf8')).theme, 'system'); assert.equal(existsSync(join(dir, `${CONFIG_FILE}.tmp`)), false);
});

test('the controller reports a refused save in plain words and keeps the old value', async t => {
  const h = host(t); mkdirSync(h.app, { recursive: true }); const c = createController(h.host); await c.setTheme('dark');
  symlinkSync('/etc/hosts', join(h.app, `${CONFIG_FILE}.bak`));
  const r = await c.setTheme('light'); assert.match(r.message!, /could not be saved/); assert.equal(r.settings.theme, 'dark');
});
