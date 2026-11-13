// Lane 1 of the v0.9 next phase: the template extension installs, mounts a screen, reads through the engine API client, and removes cleanly.
// A bad manifest file is refused, a removed extension leaves no route, and the client purity check covers the screen of the template.
import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createElement } from 'react';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { HarnessApp } from '../renderer/harness/HarnessApp.js';
import { RouteScreen, createScreenRegistry, registerBundled, screenMountOf } from '../renderer/harness/extension-mounts.js';
import { extensionAbsence, extensionRouteState, followExtensions } from '../renderer/harness/bundled-extensions.js';
import type { Bundled } from '../renderer/harness/bundled-extensions.js';
import { ExtensionAbsentBody, ExtensionPendingBody } from '../renderer/harness/extensions/ExtensionPending.js';
import { LOCAL_MODELS_MANIFEST } from '../shared/local-models/sample.js';
import type { ScreenMount } from '../renderer/harness/extension-mounts.js';
import { ExtensionTemplateView, readInstalled } from '../renderer/harness/extensions/ExtensionTemplate.js';
import { startExtensions } from '../main/extension-host.js';
import { loadBundledManifests } from '../main/extension-loader.js';
import { checkManifest } from '../shared/extensions/manifest.js';
import { DEFAULT_IDS } from '../shared/extensions/defaults.js';
import { extensionRouteOf, extensionNavKey } from '../shared/extensions/nav.js';
import { formatRoute, navKeyOf, parseRoute } from '../shared/harness/route.js';
import type { Route } from '../shared/harness/route.js';
import { createRegistry } from '../shared/extensions/registry.js';
import { registerDefaults } from '../shared/extensions/register.js';
import { createHarnessStore } from '../shared/harness/store.js';
import { createSampleWorld } from '../shared/harness/sample.js';
import { createSampleEngine } from '../shared/engine/sample.js';
import { createSampleLocal } from '../shared/local-models/sample.js';
import type { LocalBridge } from '../shared/api/local.js';
import { plainJs } from './fixtures-real/static-check.js';
import { applyAllowances, problemsOfRenderer } from './helpers-engine/client-purity.js';
import { DESKTOP, tempDir } from './support.js';

const TEMPLATE_ID = 'extension-template';
const TEMPLATE_MANIFEST = join(DESKTOP, 'extension-template', 'manifest.json');
const SCREEN_FILE = 'renderer/harness/extensions/ExtensionTemplate.tsx';
const NOW = { daysAgo: 0, time: '10:00' };
const NOT_FOUND = /data-error="ROUTE_NOT_FOUND"/;
type G = { location?: { hash: string } };

/** Installs the template the way the kit does: its manifest folder is copied into the extensions folder of a bundle root. */
function install(root: string, name = TEMPLATE_ID): void {
  mkdirSync(join(root, 'extensions', name), { recursive: true });
  copyFileSync(TEMPLATE_MANIFEST, join(root, 'extensions', name, 'manifest.json'));
}
const put = (root: string, name: string, text: string): void => { mkdirSync(join(root, 'extensions', name), { recursive: true }); writeFileSync(join(root, 'extensions', name, 'manifest.json'), text); };

/** With no local bridge the extension list has nothing to wait for, so the first frame is the final one. A test that gives a bridge sees the waiting line of the first frame. */
function render(hash: string, registry: ReturnType<typeof createScreenRegistry>, local: LocalBridge | null = null): string {
  (globalThis as G).location = { hash };
  try {
    const store = createHarnessStore({ initial: createSampleWorld(NOW), now: () => NOW, finishRunning: false });
    return renderToStaticMarkup(createElement(HarnessApp, { store, engine: createSampleEngine(), registry, local } as never) as ReactElement);
  } finally { delete (globalThis as G).location; }
}

// ---- the template is a valid manifest, and is not part of the shipped bundle

test('the template manifest is a valid, unprotected UI extension with the id and the route extension-template', () => {
  const checked = checkManifest(JSON.parse(readFileSync(TEMPLATE_MANIFEST, 'utf8')));
  assert.equal(checked.ok, true);
  if (!checked.ok) return;
  assert.deepEqual(checked.value, { id: TEMPLATE_ID, title: 'Extension template', kind: 'ui', routes: [TEMPLATE_ID], protected: false });
});

test('the template is not in the folder that ships: only the extensions a person installs are in apps/desktop/extensions', () => {
  assert.deepEqual(readdirSync(join(DESKTOP, 'extensions')).filter(name => name === TEMPLATE_ID), []);
});

// ---- the routes of an extension

test('an extension route has the address #app/extension/<route>, and the address goes both ways', () => {
  const route: Route = { name: 'extension', route: TEMPLATE_ID };
  assert.deepEqual(parseRoute('#app/extension/extension-template'), route);
  assert.deepEqual(parseRoute('#sample/extension/extension-template'), route);
  assert.equal(formatRoute(route), '#sample/extension/extension-template');
  assert.equal(formatRoute(route, '#app'), '#app/extension/extension-template');
  assert.deepEqual(extensionRouteOf({ id: 'x', title: 'X', kind: 'ui', routes: ['x-one', 'x-two'], protected: false }), { name: 'extension', route: 'x-one' });
  assert.equal(navKeyOf(route), extensionNavKey(TEMPLATE_ID));
  assert.equal(extensionNavKey(TEMPLATE_ID), 'ext:extension-template');
});

test('an address with no route name, or a name that is not a plain lower-case name, opens the harness list and never an extension', () => {
  for (const hash of ['#app/extension', '#app/extension/', '#app/extension/Bad_Name', '#app/extension/a b', '#app/extension/%2e%2e', '#app/extension/' + 'a'.repeat(65), '#app/extension/UPPER']) {
    assert.deepEqual(parseRoute(hash), { name: 'harnesses' }, hash);
  }
});

test('the generic extension route never reaches a default extension: its route shows the named not-found state and the default mount is not called', () => {
  const calls: string[] = [];
  const registry = createRegistry<ScreenMount>();
  registerDefaults(registry, id => { const real = screenMountOf(id); return props => { calls.push(`${id}:${props.route.name}`); return real(props); }; });
  for (const name of ['overview', 'library', 'help', 'welcome']) assert.match(render(`#sample/extension/${name}`, registry), NOT_FOUND, name);
  assert.deepEqual(calls, []);
});

test('a deep link to an extension waits for the list: with a bridge, the first frame is a waiting line and never the not-found state; with none, the route is not found', () => {
  const waiting = render('#sample/extension/extension-template', createScreenRegistry(), createSampleLocal(() => '2026-11-12T10:00:00.000Z'));
  assert.match(waiting, /data-extension-pending=""/);
  assert.doesNotMatch(waiting, NOT_FOUND);
  assert.match(render('#app/extension/extension-template', createScreenRegistry()), NOT_FOUND);
});

// ---- install, mount, read, remove

test('the template installs: the host registers it beside the six defaults, with nothing skipped or refused', t => {
  const root = tempDir(t);
  install(root);
  const host = startExtensions(root);
  assert.deepEqual(host.skipped, []);
  assert.deepEqual(host.refused, []);
  assert.deepEqual(host.registry.list().map(m => m.id), [...DEFAULT_IDS, TEMPLATE_ID]);
  assert.equal(host.registry.resolve(TEMPLATE_ID).found, true);
});

test('the template mounts a screen: the page registers it from the list and draws it at its address', t => {
  const root = tempDir(t);
  install(root);
  const screens = createScreenRegistry();
  const registered = registerBundled(screens, loadBundledManifests(root).manifests);
  assert.deepEqual(registered.map(m => m.id), [TEMPLATE_ID]);
  const found = screens.resolve(TEMPLATE_ID);
  assert.equal(found.found, true);
  const html = render('#sample/extension/extension-template', screens);
  assert.doesNotMatch(html, NOT_FOUND);
  assert.match(html, /data-extension="extension-template"/);
  assert.match(html, /Extension template/);
});

test('a manifest with no screen compiled into the app is not registered: a manifest carries no code', t => {
  const root = tempDir(t);
  put(root, 'no-screen', JSON.stringify({ id: 'no-screen', title: 'No screen', kind: 'ui', routes: ['no-screen'], protected: false }));
  const screens = createScreenRegistry();
  assert.deepEqual(registerBundled(screens, loadBundledManifests(root).manifests), []);
  assert.equal(screens.resolve('no-screen').found, false);
  assert.match(render('#sample/extension/no-screen', screens), NOT_FOUND);
});

test('the screen reads through the client: it asks the local calls it is given, only listExtensions, and shows what it got', async () => {
  const asked: string[] = [];
  const sample = createSampleLocal(() => '2026-11-12T10:00:00.000Z');
  const bridge: LocalBridge = { localModels: () => { asked.push('localModels'); return sample.localModels(); }, listExtensions: () => { asked.push('listExtensions'); return sample.listExtensions(); } };
  const state = await readInstalled(bridge);
  assert.deepEqual(asked, ['listExtensions']);
  assert.equal(state.kind, 'listed');
  if (state.kind === 'listed') { assert.deepEqual(state.titles.slice(0, 2), ['Local models', 'Modules']); assert.ok(state.titles.includes('Engines and usage'), 'the sample lists the Engines and usage module'); assert.equal(state.skipped, 0); }
  const html = renderToStaticMarkup(createElement(ExtensionTemplateView, { state }));
  assert.match(html, /Local models/);
  assert.match(html, /data-extension="extension-template"/);
});

test('the read says what went wrong in a short code and never throws: no bridge, a refusal, a call that throws at once', async () => {
  assert.deepEqual(await readInstalled(null), { kind: 'no-bridge' });
  const refuses: LocalBridge = { localModels: () => Promise.reject(new Error('x')), listExtensions: () => Promise.reject(new Error('Error invoking remote method: HOST_NOT_STARTED')) };
  assert.deepEqual(await readInstalled(refuses), { kind: 'refused', code: 'HOST_NOT_STARTED' });
  const throws: LocalBridge = { localModels: () => Promise.reject(new Error('x')), listExtensions: () => { throw new Error('boom'); } };
  assert.deepEqual(await readInstalled(throws), { kind: 'refused', code: 'FAILED' });
  for (const state of [{ kind: 'no-bridge' }, { kind: 'refused', code: 'HOST_NOT_STARTED' }, { kind: 'waiting' }, { kind: 'listed', titles: [], skipped: 2 }] as const) {
    const html = renderToStaticMarkup(createElement(ExtensionTemplateView, { state }));
    assert.match(html, /data-extension="extension-template"/, state.kind);
    assert.match(html, new RegExp(`data-state="${state.kind}"`));
  }
  assert.match(renderToStaticMarkup(createElement(ExtensionTemplateView, { state: { kind: 'refused', code: 'HOST_NOT_STARTED' } })), /HOST_NOT_STARTED/);
});

test('the template removes cleanly: after an uninstall the route is not found, the screen shows the named state, and the defaults stay', t => {
  const root = tempDir(t);
  install(root);
  const host = startExtensions(root);
  const answer = host.uninstall(TEMPLATE_ID);
  assert.equal(answer.ok, true);
  assert.deepEqual(host.registry.resolve(TEMPLATE_ID), { found: false, code: 'ROUTE_NOT_FOUND', route: TEMPLATE_ID });
  assert.deepEqual(host.registry.list().map(m => m.id), [...DEFAULT_IDS]);
  assert.equal(host.uninstall(TEMPLATE_ID).ok, false, 'a second uninstall has nothing to remove');

  const screens = createScreenRegistry();
  registerBundled(screens, loadBundledManifests(root).manifests);
  assert.match(render('#sample/extension/extension-template', screens), /data-extension="extension-template"/);
  assert.equal(screens.uninstall(TEMPLATE_ID).ok, true);
  assert.equal(screens.resolve(TEMPLATE_ID).found, false);
  assert.match(render('#sample/extension/extension-template', screens), NOT_FOUND);
  assert.equal(screens.list().length, DEFAULT_IDS.length);
});

test('a removed extension leaves no route: with its folder deleted, the next start lists no extension, skips nothing, and the route is not found', t => {
  const root = tempDir(t);
  install(root);
  assert.equal(startExtensions(root).registry.resolve(TEMPLATE_ID).found, true);
  rmSync(join(root, 'extensions', TEMPLATE_ID), { recursive: true, force: true });
  const host = startExtensions(root);
  assert.deepEqual(host.skipped, []);
  assert.deepEqual(host.refused, []);
  assert.deepEqual(host.registry.list().map(m => m.id), [...DEFAULT_IDS]);
  assert.equal(host.registry.resolve(TEMPLATE_ID).found, false);
  const screens = createScreenRegistry();
  assert.deepEqual(registerBundled(screens, loadBundledManifests(root).manifests), []);
  assert.equal(screens.resolve(TEMPLATE_ID).found, false);
  assert.match(render('#sample/extension/extension-template', screens), NOT_FOUND);
});

test('no route of the template stays in the registry after removal: every route a manifest listed is free again for the next extension', t => {
  const root = tempDir(t);
  put(root, 'two-routes', JSON.stringify({ id: 'two-routes', title: 'Two routes', kind: 'ui', routes: ['route-one', 'route-two'], protected: false }));
  const host = startExtensions(root);
  assert.equal(host.registry.resolve('route-one').found, true);
  assert.equal(host.uninstall('two-routes').ok, true);
  for (const route of ['route-one', 'route-two']) assert.equal(host.registry.resolve(route).found, false, route);
  assert.equal(host.registry.register({ id: 'next-one', title: 'Next', kind: 'ui', routes: ['route-one', 'route-two'], protected: false }, undefined).ok, true);
});

test('a default extension still cannot be removed, with the template installed or not', t => {
  const root = tempDir(t);
  install(root);
  const host = startExtensions(root);
  for (const id of DEFAULT_IDS) { const answer = host.uninstall(id); assert.equal(answer.ok, false, id); if (!answer.ok) assert.equal(answer.refusal.code, 'PROTECTED', id); }
});

// ---- the manifest test: a bad file is refused

const GOOD = { id: 'badfile-test', title: 'Bad file test', kind: 'ui', routes: ['badfile-test'], protected: false };
const BAD_FILES: readonly (readonly [string, string, string, 'skipped' | 'refused'])[] = [
  ['not JSON', '{ nope', 'NOT_JSON', 'skipped'],
  ['an array', '[]', 'BAD_MANIFEST', 'skipped'],
  ['a string', '"x"', 'BAD_MANIFEST', 'skipped'],
  ['a kind that is not ui', JSON.stringify({ ...GOOD, kind: 'script' }), 'BAD_MANIFEST', 'skipped'],
  ['an upper-case id', JSON.stringify({ ...GOOD, id: 'Bad' }), 'BAD_MANIFEST', 'skipped'],
  ['no routes', JSON.stringify({ ...GOOD, routes: [] }), 'BAD_MANIFEST', 'skipped'],
  ['a route listed twice', JSON.stringify({ ...GOOD, routes: ['a', 'a'] }), 'BAD_MANIFEST', 'skipped'],
  ['protected that is not true or false', JSON.stringify({ ...GOOD, protected: 'yes' }), 'BAD_MANIFEST', 'skipped'],
  ['a file over the size limit', JSON.stringify({ ...GOOD, title: 'x'.repeat(70 * 1024) }), 'TOO_LARGE', 'skipped'],
  ['the id of a default extension', JSON.stringify({ ...GOOD, id: 'overview' }), 'RESERVED', 'refused'],
  ['the route of a default extension', JSON.stringify({ ...GOOD, routes: ['help'] }), 'RESERVED', 'refused'],
  ['protected: true', JSON.stringify({ ...GOOD, protected: true }), 'RESERVED', 'refused'],
];
for (const [name, text, code, where] of BAD_FILES) {
  test(`the manifest test refuses a bad file, ${name}: the host reports ${code} and registers nothing`, t => {
    const root = tempDir(t);
    put(root, 'bad-one', text);
    const host = startExtensions(root);
    assert.deepEqual(host.registry.list().map(m => m.id), [...DEFAULT_IDS]);
    if (where === 'skipped') assert.deepEqual(host.skipped.map(s => s.code), [code]); else { assert.deepEqual(host.skipped, []); assert.deepEqual(host.refused.map(r => r.code), [code]); }
  });
}

test('the manifest test refuses a template that was changed to break a rule, and keeps the good copy', t => {
  const root = tempDir(t);
  install(root);
  const good = JSON.parse(readFileSync(TEMPLATE_MANIFEST, 'utf8')) as Record<string, unknown>;
  put(root, 'broken-copy', JSON.stringify({ ...good, id: 'broken-copy', routes: [TEMPLATE_ID] }));
  const host = startExtensions(root);
  assert.deepEqual(host.registry.list().map(m => m.id), [...DEFAULT_IDS, 'broken-copy'], 'the folders load in name order: broken-copy first and holds the route');
  assert.deepEqual(host.refused.map(r => [r.id, r.code]), [[TEMPLATE_ID, 'ROUTE_TAKEN']]);
});

test('a field that is not one of the five is dropped, so a manifest cannot name code to load', t => {
  const root = tempDir(t);
  put(root, 'extra-fields', JSON.stringify({ ...GOOD, id: 'extra-fields', routes: ['extra-fields'], main: './evil.js', entry: 'file:///x', script: 'run()' }));
  const host = startExtensions(root);
  const found = host.registry.list().find(m => m.id === 'extra-fields');
  assert.deepEqual(found && Object.keys(found).sort(), ['id', 'kind', 'protected', 'routes', 'title']);
  assert.deepEqual(host.registry.resolve('extra-fields'), { found: true, id: 'extra-fields', mount: undefined });
});

// ---- client purity covers the template screen

const sourceOf = (file: string): string => readFileSync(join(DESKTOP, file), 'utf8');
const problemsOf = (file: string, raw: string): string[] => {
  const out = plainJs({ [file]: raw }, DESKTOP)[file]!;
  assert.equal(out.error, undefined, out.error);
  return applyAllowances(problemsOfRenderer(file, raw, out.js!), []).open.map(p => `[${p.rule}] ${p.text}`);
};
const rendererFiles = (dir: string): string[] => readdirSync(join(DESKTOP, dir), { withFileTypes: true }).flatMap(e => (e.isDirectory() ? rendererFiles(`${dir}/${e.name}`) : /\.(?:ts|tsx)$/.test(e.name) ? [`${dir}/${e.name}`] : []));

test('the client purity check reads the screen of the template, with no allowance, and finds nothing', () => {
  assert.ok(rendererFiles('renderer').includes(SCREEN_FILE), 'the screen is under renderer/, where the purity test reads every file');
  assert.deepEqual(problemsOf(SCREEN_FILE, sourceOf(SCREEN_FILE)), []);
});

test('the client purity check rejects a screen that reaches around the client, the way a new extension could', () => {
  const bad = "import { readFileSync } from 'node:fs';\nexport const a = (): unknown => (window as unknown as { bowerloomLocal: { listExtensions(): unknown } }).bowerloomLocal.listExtensions();\nexport const b = readFileSync;\n";
  const found = problemsOf('renderer/harness/extensions/Other.tsx', bad);
  assert.ok(found.some(line => /\[bare-import\] imports node:fs/.test(line)), JSON.stringify(found));
  assert.ok(found.some(line => /\[bridge-name\] names bowerloomLocal/.test(line)), JSON.stringify(found));
  assert.ok(problemsOf('renderer/harness/extensions/Other.tsx', "export const a = fetch('/x');\n").some(line => /network-or-eval/.test(line)));
  assert.ok(problemsOf('renderer/harness/extensions/Other.tsx', "import { pageTransport } from '../../api/transport.js';\nexport const a = pageTransport;\n").some(line => /client-only/.test(line)));
});

test('the screen of the template is handed its calls by the page and imports no bridge, no transport and no client maker', () => {
  const text = sourceOf(SCREEN_FILE);
  assert.match(text, /useLocal\(\)/);
  assert.doesNotMatch(text, /api\/transport|getApiClient|createApiClient|bowerloom(?:Real|Engine|Local|Runs)/);
});

test('a new extension made by the kit from the template passes the client purity check and has a valid manifest', async t => {
  const kit = (await import(pathToFileURL(join(DESKTOP, '..', '..', 'tools', 'lib', 'extension-kit.mjs')).href)) as { scaffold(root: string, o: { id: string; title?: string }): { created: string[] } };
  const root = tempDir(t);
  mkdirSync(join(root, 'apps', 'desktop', 'renderer', 'harness', 'extensions'), { recursive: true });
  copyFileSync(join(DESKTOP, SCREEN_FILE), join(root, 'apps', 'desktop', SCREEN_FILE));
  const made = kit.scaffold(root, { id: 'weekly-notes', title: 'Weekly notes' });
  const screen = readFileSync(join(root, made.created[1]!), 'utf8');
  assert.deepEqual(problemsOf('renderer/harness/extensions/WeeklyNotes.tsx', screen), []);
  assert.match(screen, /export function WeeklyNotes\(\)/);
  const manifest = checkManifest(JSON.parse(readFileSync(join(root, made.created[0]!), 'utf8')));
  assert.equal(manifest.ok && manifest.value.id, 'weekly-notes');
});

test('the template screen sets its title as one string expression, so the kit can swap the whole literal', () => {
  assert.match(sourceOf(SCREEN_FILE), /title=\{"Extension template"\}/);
});

test('a mount that does not own the generic address names the route of the address, never the word extension', () => {
  const screens = createScreenRegistry();
  registerBundled(screens, [LOCAL_MODELS_MANIFEST]);
  const html = render('#app/extension/local-models', screens);
  assert.match(html, /data-error="ROUTE_NOT_FOUND"/);
  assert.match(html, /<code>local-models<\/code>/);
  assert.doesNotMatch(html, /<code>extension<\/code>/);
});

const BUNDLE = (over: Partial<Bundled>): Bundled => ({ extensions: [], ready: true, problem: null, skipped: [], unmounted: [], ...over });

test('extensionAbsence and the absent body (the pure parts, not the page): a skipped folder gives its name and code, a manifest with no screen says so, an unrelated skip is not blamed', () => {
  assert.deepEqual(extensionAbsence(BUNDLE({ skipped: [{ name: 'weekly-notes', code: 'BAD_MANIFEST' }] }), 'weekly-notes'), { kind: 'skipped', name: 'weekly-notes', code: 'BAD_MANIFEST' });
  assert.deepEqual(extensionAbsence(BUNDLE({ unmounted: [{ id: 'no-screen', title: 'No screen', kind: 'ui', routes: ['no-screen', 'second'], protected: false }] }), 'second'), { kind: 'no-screen', id: 'no-screen' });
  assert.equal(extensionAbsence(BUNDLE({ skipped: [{ name: 'other', code: 'NOT_JSON' }] }), 'weekly-notes'), null, 'an unrelated skip is not blamed');
  assert.equal(extensionAbsence(BUNDLE({}), 'weekly-notes'), null);
  assert.equal(extensionAbsence(BUNDLE({ ready: false, skipped: [{ name: 'weekly-notes', code: 'BAD_MANIFEST' }] }), 'weekly-notes'), null, 'nothing is said before the list answers');
  const skipped = renderToStaticMarkup(createElement(ExtensionAbsentBody, { absence: { kind: 'skipped', name: 'weekly-notes', code: 'BAD_MANIFEST' } }));
  assert.match(skipped, /weekly-notes/); assert.match(skipped, /BAD_MANIFEST/); assert.doesNotMatch(skipped, /ROUTE_NOT_FOUND/);
  const none = renderToStaticMarkup(createElement(ExtensionAbsentBody, { absence: { kind: 'no-screen', id: 'no-screen' } }));
  assert.match(none, /no-screen/); assert.match(none, /no screen for it/);
});

test('the waiting screen of an extension says the host has not started only for that code, and shows any other code as it is', () => {
  const host = renderToStaticMarkup(createElement(ExtensionPendingBody, { problem: 'HOST_NOT_STARTED' }));
  assert.match(host, /host has not started/); assert.match(host, /HOST_NOT_STARTED/);
  const other = renderToStaticMarkup(createElement(ExtensionPendingBody, { problem: 'FAILED' }));
  assert.match(other, /FAILED/); assert.doesNotMatch(other, /host has not started/);
  assert.match(renderToStaticMarkup(createElement(ExtensionPendingBody, { problem: null })), /Looking for this extension/);
});

const ID_REFUSED: Record<string, unknown> = { id: 'extension-template', title: 'Template', kind: 'ui', routes: ['help'], protected: false };
const NO_MOUNT: Record<string, unknown> = { id: 'nothing-here', title: 'Nothing', kind: 'ui', routes: ['nothing-here'], protected: false };

test('followExtensions keeps a listed manifest with no screen apart from one the registry refused', async () => {
  const screens = createScreenRegistry();
  const bridge = { localModels: () => Promise.reject(new Error('x')), listExtensions: () => Promise.resolve({ extensions: [NO_MOUNT, ID_REFUSED], skipped: [] }) } as unknown as LocalBridge;
  const state = await new Promise<Bundled>(resolve => { followExtensions(screens, bridge, resolve, { after: () => 0, cancel: () => undefined }); });
  assert.deepEqual((state.unmounted ?? []).map(m => m.id), ['nothing-here']);
  assert.deepEqual((state.refused ?? []).map(r => [r.id, r.code]), [['extension-template', 'RESERVED']]);
  assert.deepEqual(state.extensions, []);
});

test('a refusal shows its code, and only a true no-mount says this build has no screen for it', () => {
  const refused = BUNDLE({ refused: [{ id: 'extension-template', routes: ['help', 'extension-template'], code: 'RESERVED' }], unmounted: [] });
  assert.deepEqual(extensionAbsence(refused, 'extension-template'), { kind: 'refused', id: 'extension-template', code: 'RESERVED' });
  const html = renderToStaticMarkup(createElement(ExtensionAbsentBody, { absence: { kind: 'refused', id: 'extension-template', code: 'RESERVED' } }));
  assert.match(html, /RESERVED/); assert.match(html, /extension-template/); assert.doesNotMatch(html, /no screen for it/);
  assert.match(renderToStaticMarkup(createElement(ExtensionAbsentBody, { absence: { kind: 'no-screen', id: 'x' } })), /no screen for it/);
});

test('the route of an extension decides in one order: wait, then the screen the registry owns, then the absence the list explains, then the plain not-found', () => {
  const screens = createScreenRegistry();
  registerBundled(screens, [JSON.parse(readFileSync(TEMPLATE_MANIFEST, 'utf8'))]);
  const skipped = [{ name: 'weekly-notes', code: 'BAD_MANIFEST' }];
  assert.deepEqual(extensionRouteState(BUNDLE({ ready: false, skipped }), screens, 'weekly-notes'), { kind: 'wait' });
  assert.deepEqual(extensionRouteState(BUNDLE({ ready: false }), screens, TEMPLATE_ID), { kind: 'wait' }, 'even a route that exists waits until the list answers');
  assert.deepEqual(extensionRouteState(BUNDLE({ skipped }), screens, TEMPLATE_ID), { kind: 'screen' });
  assert.deepEqual(extensionRouteState(BUNDLE({ skipped }), screens, 'weekly-notes'), { kind: 'absent', absence: { kind: 'skipped', name: 'weekly-notes', code: 'BAD_MANIFEST' } });
  assert.deepEqual(extensionRouteState(BUNDLE({ skipped }), screens, 'unknown-route'), { kind: 'screen' }, 'nothing explains it, so the screen draws the plain not-found state');
  assert.match(render('#app/extension/unknown-route', screens), NOT_FOUND);
  assert.deepEqual(extensionRouteState(BUNDLE({ skipped: [{ name: TEMPLATE_ID, code: 'BAD_MANIFEST' }] }), screens, TEMPLATE_ID), { kind: 'screen' }, 'a route the registry owns wins over a skip of its own name');
});

test('source order check: HarnessApp calls extensionRouteState, and its source holds the waiting line, then the absent line, then the registry screen, in that order', () => {
  const app = readFileSync(join(DESKTOP, 'renderer/harness/HarnessApp.tsx'), 'utf8');
  assert.match(app, /extensionRouteState\(bundled, registry, route\.route\)/);
  const wait = app.indexOf("ext?.kind === 'wait'"), absent = app.indexOf("ext?.kind === 'absent'"), screen = app.indexOf("at === 'screen'");
  assert.ok(wait > 0 && absent > wait && screen > absent, 'the order in the page is wait, absent, screen');
});
