// v0.9 L4c: main starts the extension mechanism. It registers the six protected defaults, loads the extensions that ship inside the app bundle (and nothing from outside it),
// and answers an uninstall through one check that fails closed: a protected extension is never removed, and a check that cannot decide refuses.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRegistry } from '../shared/extensions/registry.js';
import type { Registry } from '../shared/extensions/registry.js';
import { DEFAULT_IDS } from '../shared/extensions/defaults.js';
import { EXTENSION_CODES } from '../shared/extensions/types.js';
import { extensionsBundleRoot, startExtensions, uninstallExtension } from '../main/extension-host.js';
import { eventLogPath } from '../../../packages/diagnostics/src/index.js';
import { createRecorder } from '../main/engine-events.js';
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

test('startExtensions hands each skip and each refusal to the writer it is given, once, with the code', t => {
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

test('main.ts starts the extensions once the app is ready, from the bundle root only, writes what was skipped to stderr and to the usage log of a launch that has one', () => {
  const main = readFileSync(join(DESKTOP, 'main', 'main.ts'), 'utf8');
  assert.match(main, /from '\.\/extension-host\.js'/);
  const ready = main.indexOf('app.whenReady()');
  const call = main.indexOf('startExtensions(');
  assert.ok(ready >= 0 && call > ready, 'startExtensions is called inside the whenReady handler');
  assert.match(main, /startExtensions\(extensionsBundleRoot\(\{ packaged: app\.isPackaged, resourcesPath: process\.resourcesPath, appRoot: root \}\)/);
  assert.match(main, /process\.stderr\.write/, 'the report goes to stderr');
  assert.match(main, /, usageRecorder\);/, 'the usage-log recorder is passed');
  assert.match(main, /const record = createRecorder\(/, 'the recorder is the existing one of main/engine-events.ts');
  assert.match(main, /Limit: a launch with no usage log has stderr only/, 'the limit is stated in the code');
  // The loader has no other way in: no second call, no path from the command line or the environment.
  assert.equal(main.split('startExtensions(').length, 2);
  assert.doesNotMatch(main, /extension-loader/);
  assert.doesNotMatch(main, /loadBundledManifests?\(/);
});

test('the host imports no electron: it runs in the test and in main alike', () => {
  const text = readFileSync(join(DESKTOP, 'main', 'extension-host.ts'), 'utf8');
  assert.doesNotMatch(text, /from 'electron'/);
});

// ---- Fix round 1.

test('M1: each skip and each refusal is also recorded with its code only, when a recorder is given; no name, no path, no manifest text', t => {
  const root = tempDir(t);
  put(root, 'broken', '{ secret-manifest-text');
  put(root, 'claims', manifest('claims', { protected: true }));
  const recorded: Record<string, unknown>[] = [];
  startExtensions(root, undefined, input => { recorded.push({ ...input }); return true; });
  assert.deepEqual(recorded, [
    { source: 'app', kind: 'error', step: 'extension-skipped', code: 'NOT_JSON' },
    { source: 'app', kind: 'error', step: 'extension-refused', code: 'RESERVED' },
  ]);
  const text = JSON.stringify(recorded);
  assert.doesNotMatch(text, /broken|claims|secret|manifest|\/|bowerloom-test/);
});

test('M1: through the real recorder the lines reach the local usage log, in its own schema', t => {
  const root = tempDir(t), state = tempDir(t);
  put(root, 'broken', '{ nope');
  startExtensions(root, undefined, createRecorder({ stateRoot: state, env: {}, now: () => new Date('2026-11-10T10:00:00Z'), onFailure: () => undefined }));
  const lines = readFileSync(eventLogPath(state), 'utf8').trim().split('\n').map(l => JSON.parse(l) as Record<string, unknown>);
  assert.deepEqual(lines, [{ v: 1, at: '2026-11-10T10:00:00Z', source: 'app', kind: 'error', code: 'NOT_JSON', step: 'extension-skipped' }]);
});

test('M1: with no recorder (a launch without the usage log) the report stays on stderr only, and that is the whole limit', t => {
  const root = tempDir(t);
  put(root, 'broken', '{ nope');
  const told: string[] = [];
  const host = startExtensions(root, line => told.push(line));
  assert.equal(told.length, 1);
  assert.equal(host.skipped.length, 1);
});

test('LOW a: a writer that throws never stops the start, and the other lines still come', t => {
  const root = tempDir(t);
  put(root, 'broken', '{ nope');
  put(root, 'claims', manifest('claims', { protected: true }));
  let calls = 0;
  let host: ReturnType<typeof startExtensions> | undefined;
  assert.doesNotThrow(() => { host = startExtensions(root, () => { calls += 1; throw new Error('closed stderr'); }); });
  assert.equal(calls, 2);
  assert.deepEqual(host!.registry.list().map(m => m.id), [...DEFAULT_IDS]);
  // A recorder that throws is held the same way, and the writer still gets its lines.
  const told: string[] = [];
  assert.doesNotThrow(() => startExtensions(root, line => told.push(line), () => { throw new Error('disk full'); }));
  assert.equal(told.length, 2);
});

test('LOW b: a registry that throws is told by the error name only, with no message text, and the code stays PROTECTED', () => {
  const real = createRegistry();
  const broken: Registry = { ...real, uninstall() { const e = new TypeError('/Users/someone/secret/path'); throw e; } };
  const told: string[] = [];
  const answer = uninstallExtension(broken, 'sample', line => told.push(line));
  assert.equal(refusalCode(answer), 'PROTECTED');
  assert.equal(told.length, 1);
  assert.match(told[0]!, /TypeError/);
  assert.doesNotMatch(told[0]!, /secret|Users/);
  const weird: Registry = { ...real, uninstall() { throw { name: '/etc/passwd and more words' }; } };
  const told2: string[] = [];
  uninstallExtension(weird, 'sample', line => told2.push(line));
  assert.match(told2[0]!, /unknown/);
  assert.doesNotMatch(told2[0]!, /passwd/);
  // A writer that throws changes nothing.
  assert.equal(refusalCode(uninstallExtension(broken, 'sample', () => { throw new Error('x'); })), 'PROTECTED');
});

test('LOW b: the host passes its own writer to the uninstall check', t => {
  const told: string[] = [];
  const host = startExtensions(tempDir(t), line => told.push(line));
  assert.equal(host.uninstall('nothing').ok, false);
  assert.deepEqual(told, []);
});

test('LOW c: an ok answer that carries a protected manifest, or another id than the one asked, is refused PROTECTED', () => {
  const base = { id: 'sample', title: 'Sample', kind: 'ui', routes: ['sample-route'], protected: false } as const;
  const says = (value: unknown): Registry => ({ ...createRegistry(), uninstall: () => ({ ok: true, value }) }) as unknown as Registry;
  assert.equal(refusalCode(uninstallExtension(says({ ...base, protected: true }), 'sample')), 'PROTECTED');
  assert.equal(refusalCode(uninstallExtension(says({ ...base, id: 'other' }), 'sample')), 'PROTECTED');
  assert.equal(refusalCode(uninstallExtension(says(null), 'sample')), 'PROTECTED');
  const fine = uninstallExtension(says({ ...base }), 'sample');
  assert.equal(fine.ok, true);
});

test('LOW d: two bundled extensions with one id, and two that want one route, keep the first and refuse the second', t => {
  const root = tempDir(t);
  put(root, 'a-first', manifest('same'));
  put(root, 'b-second', manifest('same', { routes: ['other-route'] }));
  put(root, 'c-third', manifest('third', { routes: ['same-route'] }));
  const host = startExtensions(root);
  assert.deepEqual(host.registry.list().map(m => m.id), [...DEFAULT_IDS, 'same']);
  assert.deepEqual(host.refused.map(r => [r.id, r.code]), [['same', 'EXTENSION_EXISTS'], ['third', 'ROUTE_TAKEN']]);
  assert.equal((host.registry.resolve('same-route') as { id: string }).id, 'same');
});

test('LOW d: extensionsBundleRoot points at the folder the loader reads, in a real layout, packaged or not', t => {
  const tree = tempDir(t);
  const app = join(tree, 'apps', 'desktop');
  mkdirSync(join(app, 'dist'), { recursive: true });
  put(app, 'dev-one', manifest('dev-one'));
  const dev = startExtensions(extensionsBundleRoot({ packaged: false, resourcesPath: join(tree, 'nowhere'), appRoot: join(app, 'dist') }));
  assert.deepEqual(dev.registry.list().map(m => m.id), [...DEFAULT_IDS, 'dev-one']);
  const resources = join(tree, 'Resources');
  put(resources, 'packed-one', manifest('packed-one'));
  const packed = startExtensions(extensionsBundleRoot({ packaged: true, resourcesPath: resources, appRoot: join(tree, 'asar', 'dist') }));
  assert.deepEqual(packed.registry.list().map(m => m.id), [...DEFAULT_IDS, 'packed-one']);
});

test('LOW e: main.ts says the later IPC lane must call uninstallExtension and never registry.uninstall', () => {
  const main = readFileSync(join(DESKTOP, 'main', 'main.ts'), 'utf8');
  assert.match(main, /uninstallExtension/);
  assert.doesNotMatch(main, /registry\.uninstall\(/);
});

test('M2: if apps/desktop/extensions holds anything, package.json extraResources ships it into the app resources', () => {
  // Add the extraResources entry { "from": "extensions", "to": "extensions" } with the first bundled extension. Not before: a missing folder can break the build.
  const folder = join(DESKTOP, 'extensions');
  const holds = existsSync(folder) && readdirSync(folder).length > 0;
  const pkg = JSON.parse(readFileSync(join(DESKTOP, 'package.json'), 'utf8')) as { build?: { extraResources?: { from?: string; to?: string }[] } };
  const entries = pkg.build?.extraResources ?? [];
  const ships = entries.some(e => e.to === 'extensions' && e.from === 'extensions');
  if (holds) assert.equal(ships, true, 'apps/desktop/extensions has content but extraResources has no { from: "extensions", to: "extensions" } entry, so a packaged build would load zero extensions');
});

test('E3: the app\'s own bundle loads the first bundled extension, Local models, with nothing skipped or refused, and it is not protected', () => {
  const host = startExtensions(extensionsBundleRoot({ packaged: false, resourcesPath: '/nowhere', appRoot: join(DESKTOP, 'dist') }));
  assert.deepEqual(host.registry.list().map(m => m.id), [...DEFAULT_IDS, 'local-models', 'modules']);
  assert.deepEqual(host.skipped, []); assert.deepEqual(host.refused, []);
  const found = host.registry.list().find(m => m.id === 'local-models');
  assert.deepEqual(found, { id: 'local-models', title: 'Local models', kind: 'ui', routes: ['local-models'], protected: false });
  assert.deepEqual(host.registry.resolve('local-models'), { found: true, id: 'local-models', mount: undefined });
});

test('Local models can be uninstalled, because it is bundled and not protected, and its route is then freed', () => {
  const host = startExtensions(extensionsBundleRoot({ packaged: false, resourcesPath: '/nowhere', appRoot: join(DESKTOP, 'dist') }));
  assert.equal(host.registry.uninstall('local-models').ok, true);
  assert.equal(host.registry.resolve('local-models').found, false);
});
