// The controller answers the window's calls. Tested without Electron, with a fake host.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, lstatSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createController } from '../main/controller.js';
import type { Host } from '../main/controller.js';
import { CONFIG_FILE, DEFAULT_SETTINGS, loadSettings, parseSettings, saveSettings } from '../main/config.js';
import { OFF_TEXT, UPDATE_FEED, checkForUpdates, initialUpdateState } from '../main/updates.js';
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
  const s = await c.addRoot(); assert.deepEqual(s.roots, [projects]);
  const snap = await c.getSnapshot(); assert.equal(snap.projects.length, 1); assert.equal(snap.store.state, 'absent'); assert.equal(snap.mode, 'real');
  assert.equal(loadSettings(h.app).mode, 'real'); assert.deepEqual(loadSettings(h.app).roots, [projects]);
  assert.deepEqual((await c.removeRoot(projects)).roots, []);
  assert.deepEqual((await c.removeRoot('/not/in/the/list')).roots, [], 'removing an unknown folder changes nothing');
});

test('adding a folder: a cancel changes nothing, a link is saved as its real place, a file is refused', async t => {
  const base = tempDir(t), real = join(base, 'real'), link = join(base, 'link'), file = join(base, 'file'); mkdirSync(real); symlinkSync(real, link); writeFileSync(file, 'x');
  let pick: string | null = null; const h = host(t, { home: base, pickFolder: async () => pick }), c = createController(h.host);
  assert.deepEqual((await c.addRoot()).roots, []);
  pick = link; assert.deepEqual((await c.addRoot()).roots, [real]);
  pick = file; assert.deepEqual((await c.addRoot()).roots, [real]);
  pick = join(base, 'gone'); assert.deepEqual((await c.addRoot()).roots, [real]);
  pick = real; assert.deepEqual((await c.addRoot()).roots, [real], 'no duplicate');
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
  assert.equal((await c.setTheme('dark')).theme, 'dark'); assert.equal((await c.setTheme('neon' as never)).theme, 'dark');
  assert.equal(lstatSync(join(h.app, CONFIG_FILE)).mode & 0o777, 0o600); assert.equal(loadSettings(h.app).theme, 'dark');
});

test('links: only the allowlist reaches the browser', async t => {
  const h = host(t), c = createController(h.host);
  assert.equal(await c.openLink('https://github.com/sageadvicellc/bowerloom'), true); assert.equal(await c.openLink('https://evil.example/'), false); assert.equal(await c.openLink('file:///etc/passwd'), false);
  assert.deepEqual(h.opened, ['https://github.com/sageadvicellc/bowerloom']);
});

test('settings parsing is strict about shape and size', t => {
  assert.deepEqual(parseSettings('not json'), { ...DEFAULT_SETTINGS, roots: [] }); assert.deepEqual(parseSettings('[]'), { ...DEFAULT_SETTINGS, roots: [] }); assert.deepEqual(parseSettings('null'), { ...DEFAULT_SETTINGS, roots: [] });
  const s = parseSettings(JSON.stringify({ theme: 'weird', roots: ['/ok', 'relative', 5, '/ok', '/bad\0'], mode: 'x', updatesEnabled: 'yes' }));
  assert.deepEqual(s, { theme: 'system', roots: ['/ok'], mode: null, updatesEnabled: false });
  assert.equal(parseSettings(JSON.stringify({ roots: Array.from({ length: 50 }, (_, i) => `/r${i}`) })).roots.length, 20);
  const dir = tempDir(t); writeFileSync(join(dir, CONFIG_FILE), 'x'.repeat(70000)); assert.deepEqual(loadSettings(dir), { ...DEFAULT_SETTINGS, roots: [] });
  saveSettings(dir, { theme: 'light', roots: ['/a'], mode: 'real', updatesEnabled: false }); assert.deepEqual(JSON.parse(readFileSync(join(dir, CONFIG_FILE), 'utf8')), { theme: 'light', roots: ['/a'], mode: 'real', updatesEnabled: false });
});

test('updates are off by default: no network, no updater loaded, and the footer says when they turn on', async () => {
  assert.equal(DEFAULT_SETTINGS.updatesEnabled, false); assert.equal(OFF_TEXT, 'Updates turn on after the first release');
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
