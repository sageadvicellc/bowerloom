// v0.9 L4c: main starts the extension mechanism. It registers the six protected defaults, loads the extensions that ship inside the app bundle (and nothing from outside it),
// and answers an uninstall through one check that fails closed: a protected extension is never removed, and a check that cannot decide refuses.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRegistry } from '../shared/extensions/registry.js';
import type { Registry } from '../shared/extensions/registry.js';
import { DEFAULT_IDS } from '../shared/extensions/defaults.js';
import { EXTENSION_CODES } from '../shared/extensions/types.js';
import { extensionsBundleRoot, startExtensions, uninstallExtension } from '../main/extension-host.js';
import { DESKTOP, tempDir } from './support.js';

const manifest = (id: string, extra: Record<string, unknown> = {}): string => JSON.stringify({ id, title: id, kind: 'ui', routes: [`${id}-route`], protected: false, ...extra });
function put(root: string, name: string, text: string): void { mkdirSync(join(root, 'extensions', name), { recursive: true }); writeFileSync(join(root, 'extensions', name, 'manifest.json'), text); }
const refusalCode = (a: { ok: boolean; refusal?: { code: string } }): string | undefined => a.ok ? undefined : a.refusal?.code;

test('startExtensions registers the six protected defaults and a valid bundled extension, and reports nothing skipped', t => {
  const root = tempDir(t);
  put(root, 'sample', manifest('sample'));
  const host = startExtensions(root);
  assert.deepEqual(host.registry.list().map(m => m.id), [...DEFAULT_IDS, 'sample']);
  assert.deepEqual(host.registry.resolve('sample-route'), { found: true, id: 'sample', mount: undefined });
  assert.deepEqual(host.skipped, []);
  assert.deepEqual(host.refused, []);
});

test('a bundle with no extensions folder gives only the six defaults', t => {
  const host = startExtensions(tempDir(t));
  assert.deepEqual(host.registry.list().map(m => m.id), [...DEFAULT_IDS]);
  assert.deepEqual([host.skipped, host.refused], [[], []]);
});

test('a bundled manifest that says protected: true is refused and not registered', t => {
  const root = tempDir(t);
  put(root, 'claims', manifest('claims', { protected: true }));
  const host = startExtensions(root);
  assert.equal(host.registry.list().some(m => m.id === 'claims'), false);
  assert.deepEqual(host.refused.map(r => [r.id, r.code]), [['claims', 'RESERVED']]);
});

test('a bundled manifest cannot take the id or a route of a default', t => {
  const root = tempDir(t);
  put(root, 'overview', manifest('overview'));
  put(root, 'thief', manifest('thief', { routes: ['library'] }));
  const host = startExtensions(root);
  assert.deepEqual(host.registry.list().map(m => m.id), [...DEFAULT_IDS]);
  assert.deepEqual(host.refused.map(r => [r.id, r.code]), [['overview', 'RESERVED'], ['thief', 'RESERVED']]);
  assert.equal((host.registry.resolve('library') as { id: string }).id, 'library');
});

test('nothing outside the bundle loads: a link out of the bundle is skipped, and its manifest is never registered', t => {
  const root = tempDir(t), outside = tempDir(t);
  writeFileSync(join(outside, 'manifest.json'), manifest('escaped'));
  mkdirSync(join(root, 'extensions'));
  symlinkSync(outside, join(root, 'extensions', 'escaped'));
  put(root, '..sneaky', manifest('sneaky'));
  const host = startExtensions(root);
  assert.equal(host.registry.list().some(m => m.id === 'escaped'), false);
  assert.deepEqual(host.skipped.map(s => [s.name, s.code]), [['..sneaky', 'BAD_NAME'], ['escaped', 'OUTSIDE_ROOT']]);
});

test('a bundle root that cannot be read is reported, the app still has its six defaults, and nothing throws', t => {
  const root = tempDir(t);
  for (const bad of [join(root, 'missing'), '', 'relative/path']) {
    const host = startExtensions(bad);
    assert.deepEqual(host.registry.list().map(m => m.id), [...DEFAULT_IDS], bad);
    assert.deepEqual(host.skipped.map(s => [s.name, s.code]), [['extensions', 'UNREADABLE']], bad);
  }
});

test('a bad manifest is skipped and the good one beside it loads', t => {
  const root = tempDir(t);
  put(root, 'broken', '{ not json');
  put(root, 'good', manifest('good'));
  const host = startExtensions(root);
  assert.deepEqual(host.registry.list().map(m => m.id), [...DEFAULT_IDS, 'good']);
  assert.deepEqual(host.skipped.map(s => [s.name, s.code]), [['broken', 'NOT_JSON']]);
});

test('startExtensions tells each skip and each refusal through the function it is given, once, with the code', t => {
  const root = tempDir(t);
  put(root, 'broken', '{ not json');
  put(root, 'claims', manifest('claims', { protected: true }));
  const told: string[] = [];
  startExtensions(root, line => told.push(line));
  assert.equal(told.length, 2);
  assert.match(told[0]!, /broken.*NOT_JSON/);
  assert.match(told[1]!, /claims.*RESERVED/);
});

for (const id of DEFAULT_IDS) {
  test(`uninstall of the default "${id}" returns PROTECTED, and it stays registered and resolves`, t => {
    const host = startExtensions(tempDir(t));
    const answer = host.uninstall(id);
    assert.equal(answer.ok, false);
    assert.equal(refusalCode(answer), 'PROTECTED');
    assert.equal(host.registry.list().some(m => m.id === id), true);
    const route = host.registry.list().find(m => m.id === id)!.routes[0]!;
    assert.equal(host.registry.resolve(route).found, true);
  });
}

test('PROTECTED is a named code of the extension mechanism, and the refusal carries words and no paths', t => {
  assert.ok((EXTENSION_CODES as readonly string[]).includes('PROTECTED'));
  const answer = startExtensions(tempDir(t)).uninstall('overview');
  assert.ok(!answer.ok && answer.refusal.message.length > 0 && answer.refusal.paths.length === 0);
});

test('a bundled extension that is not protected can be uninstalled, and its routes are freed', t => {
  const root = tempDir(t);
  put(root, 'sample', manifest('sample'));
  const host = startExtensions(root);
  const answer = host.uninstall('sample');
  assert.equal(answer.ok, true);
  assert.equal(host.registry.resolve('sample-route').found, false);
  assert.equal(host.registry.list().length, DEFAULT_IDS.length);
});

test('fail closed: a default id is protected even when the registry has lost it or holds it unprotected', () => {
  const empty = createRegistry();
  assert.equal(refusalCode(uninstallExtension(empty, 'overview')), 'PROTECTED');
  const weak = createRegistry();
  weak.register({ id: 'library', title: 'Library', kind: 'ui', routes: ['library'], protected: false }, undefined);
  assert.equal(refusalCode(uninstallExtension(weak, 'library')), 'PROTECTED');
  assert.equal(weak.list().length, 1, 'the extension was not removed');
});

test('fail closed: a registry that throws while uninstalling gives a refusal, not a throw and not a removal', () => {
  const real = createRegistry();
  real.register({ id: 'sample', title: 'Sample', kind: 'ui', routes: ['sample-route'], protected: false }, undefined);
  const broken: Registry = { ...real, uninstall() { throw new Error('boom'); } };
  let answer;
  assert.doesNotThrow(() => { answer = uninstallExtension(broken, 'sample'); });
  assert.equal(refusalCode(answer!), 'PROTECTED');
  assert.equal(real.list().length, 1);
});

test('fail closed: a registry that answers with something other than an answer gives a refusal', () => {
  const odd = { ...createRegistry(), uninstall: () => undefined } as unknown as Registry;
  assert.equal(refusalCode(uninstallExtension(odd, 'sample')), 'PROTECTED');
  const worse = { ...createRegistry(), uninstall: () => ({ ok: 'yes' }) } as unknown as Registry;
  assert.equal(refusalCode(uninstallExtension(worse, 'sample')), 'PROTECTED');
});

test('uninstall of an id that is not registered, or not text, is refused and removes nothing', t => {
  const host = startExtensions(tempDir(t));
  for (const id of ['nothing', '', '__proto__', 'constructor', undefined, null, 7, {}, [], Symbol('x')]) {
    const answer = host.uninstall(id);
    assert.equal(answer.ok, false, String(typeof id));
    assert.equal(refusalCode(answer), 'UNKNOWN_EXTENSION');
  }
  assert.equal(host.registry.list().length, DEFAULT_IDS.length);
});

test('extensionsBundleRoot: resources in a packaged build, the app folder in development', () => {
  assert.equal(extensionsBundleRoot({ packaged: true, resourcesPath: '/r', appRoot: '/a/dist' }), '/r');
  assert.equal(extensionsBundleRoot({ packaged: false, resourcesPath: '/r', appRoot: '/a/apps/desktop/dist' }), '/a/apps/desktop');
});

test('main.ts starts the extensions once the app is ready, from the bundle root only, and tells what was skipped on stderr', () => {
  const main = readFileSync(join(DESKTOP, 'main', 'main.ts'), 'utf8');
  assert.match(main, /from '\.\/extension-host\.js'/);
  const ready = main.indexOf('app.whenReady()');
  const call = main.indexOf('startExtensions(');
  assert.ok(ready >= 0 && call > ready, 'startExtensions is called inside the whenReady handler');
  assert.match(main, /startExtensions\(extensionsBundleRoot\(\{ packaged: app\.isPackaged, resourcesPath: process\.resourcesPath, appRoot: root \}\)/);
  assert.match(main, /process\.stderr\.write/, 'the report goes to stderr');
  // The loader has no other way in: no second call, no path from the command line or the environment.
  assert.equal(main.split('startExtensions(').length, 2);
  assert.doesNotMatch(main, /extension-loader/);
  assert.doesNotMatch(main, /loadBundledManifests?\(/);
});

test('the host imports no electron: it runs in the test and in main alike', () => {
  const text = readFileSync(join(DESKTOP, 'main', 'extension-host.ts'), 'utf8');
  assert.doesNotMatch(text, /from 'electron'/);
});
