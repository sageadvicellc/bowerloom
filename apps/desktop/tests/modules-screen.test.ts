// The Modules view: the markup of each state, the registration of the bundled mount from `listExtensions`, the route and the navigation entry, Local models inside the view, and the rules that keep the page pure.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { HarnessApp } from '../renderer/harness/HarnessApp.js';
import { ModulesBody, ReadsPanel } from '../renderer/harness/modules/ModulesScreen.js';
import type { ModulesBodyProps, ReadsProps } from '../renderer/harness/modules/ModulesScreen.js';
import { embeddedPageOf } from '../renderer/harness/modules/embeds.js';
import { LocalModelsEmbedded, LocalModels } from '../renderer/harness/local-models/LocalModels.js';
import { LocalProvider } from '../renderer/harness/local-models/local.js';
import { HarnessProvider } from '../renderer/harness/session.js';
import { UiProvider } from '../renderer/harness/ui.js';
import { createScreenRegistry, registerBundled, screenMountOf } from '../renderer/harness/extension-mounts.js';
import { localRouteState } from '../renderer/harness/bundled-extensions.js';
import type { Bundled } from '../renderer/harness/bundled-extensions.js';
import { LOCAL_MODELS_MANIFEST, MODULES_MANIFEST, createSampleLocal } from '../shared/local-models/sample.js';
import { MODULE_WORDS, moduleRows } from '../shared/modules/view-model.js';
import { formatRoute, navKeyOf, parseRoute } from '../shared/harness/route.js';
import { createHarnessStore } from '../shared/harness/store.js';
import { createSampleWorld } from '../shared/harness/sample.js';
import { createSampleEngine } from '../shared/engine/sample.js';
import type { ModulesBridge } from '../shared/api/modules.js';
import { DESKTOP } from './support.js';

const NOW = { daysAgo: 0, time: '10:00' };
type G = { location?: { hash: string } };
const noop = (): void => undefined;
const render = (el: ReactElement): string => renderToStaticMarkup(el);
const PLACE = { id: 'place-aaaaaaaaaaaa', label: '~/Documents/notes', approvedAt: '2026-11-12T10:00:00.000Z' };
const reads = (over: Partial<ReadsProps> = {}): ReadsProps => ({ title: 'local-models', sample: false, hasBridge: true, places: { status: 'ready', places: [], code: null, busy: false, notice: null }, onApprove: noop, onRemove: noop, ...over });
const body = (over: Partial<ModulesBodyProps> = {}): string => {
  const rows = moduleRows([LOCAL_MODELS_MANIFEST, MODULES_MANIFEST], null);
  return render(createElement(ModulesBody, { rows, selected: null, missing: false, reads: null, embedded: null, onOpen: noop, onBack: noop, onOpenOwn: noop, ...over }));
};

function renderApp(hash: string, local: Parameters<typeof LocalProvider>[0]['bridge'], modules: ModulesBridge | null | undefined, realMode = false): string {
  (globalThis as G).location = { hash };
  try {
    const store = createHarnessStore({ initial: createSampleWorld(NOW), now: () => NOW, finishRunning: false });
    return render(createElement(HarnessApp, { store, engine: realMode ? null : createSampleEngine(), local, modules, realMode } as never));
  } finally { delete (globalThis as G).location; }
}

// ---- the stage, state by state

test('the list shows each module by name with an Open button, and not the view itself', () => {
  const html = body();
  assert.equal((html.match(/data-module="/g) ?? []).length, 1);
  assert.match(html, /data-module="local-models"/);
  assert.match(html, /<h2[^>]*>Local models<\/h2>/);
  assert.match(html, /aria-label="Open Local models"/);
  assert.doesNotMatch(html, /data-module="modules"/);
  assert.match(html, /aria-label="Modules"/);
  assert.ok(html.includes(MODULE_WORDS.hint));
});

test('no module loaded and an address that names no module each say so in words', () => {
  assert.match(body({ rows: [] }), /data-modules-state="empty">No modules are loaded\./);
  assert.match(body({ missing: true }), /role="status" data-modules-state="unknown">No module has that name\./);
});

test('the open module shows what it can read, then its page; the open row is marked current', () => {
  const rows = moduleRows([LOCAL_MODELS_MANIFEST], 'local-models');
  const html = body({ rows, selected: rows[0]!, reads: reads(), embedded: createElement('p', { 'data-fake-page': '' }, 'page') });
  assert.match(html, /data-module-open="local-models"/);
  assert.match(html, /data-current=""/);
  assert.match(html, /aria-current="page"/);
  assert.ok(html.indexOf('data-module-reads') < html.indexOf('data-fake-page'), 'what it can read comes before its page');
  assert.match(html, /All modules/);
  assert.doesNotMatch(html, /Open its own page/, 'a module with a page inside the view has no second way in');
});

test('a module with no page inside the view says so and offers its own page', () => {
  const rows = moduleRows([LOCAL_MODELS_MANIFEST], 'local-models');
  const html = body({ rows, selected: rows[0]!, reads: reads(), embedded: null });
  assert.match(html, /data-modules-state="no-embed">This module has no page inside this view\./);
  assert.match(html, /Open its own page/);
});

test('the read rule is on the page: a project you pick, folders you approve once for this module, and nothing leaves this computer', () => {
  const html = render(createElement(ReadsPanel, reads()));
  for (const line of [MODULE_WORDS.readsProject, MODULE_WORDS.readsFolders, MODULE_WORDS.readsLocal]) assert.ok(html.includes(line), line);
  assert.match(html, /data-module-state="empty">No folder is approved for this module\./);
  assert.match(html, /<button[^>]*>(?:<[^>]*>)*Approve a folder<\/button>/);
});

test('an approved folder is a label with `~`, the day, and a Remove button named for the folder; no full path is drawn', () => {
  const html = render(createElement(ReadsPanel, reads({ places: { status: 'ready', places: [PLACE], code: null, busy: false, notice: 'Approved.' } })));
  assert.match(html, /data-place="place-aaaaaaaaaaaa"/);
  assert.ok(html.includes('~/Documents/notes'));
  assert.ok(html.includes('Approved 2026-11-12'));
  assert.match(html, /aria-label="Remove ~\/Documents\/notes"/);
  assert.match(html, /role="status" data-module-notice="">Approved\.<\/p>/);
  assert.doesNotMatch(html, /data-module-state="empty"/);
  assert.doesNotMatch(html, /\/Users|\/home/);
});

test('while a call runs the buttons are off, and a failed list shows its words and its code', () => {
  const busy = render(createElement(ReadsPanel, reads({ places: { status: 'ready', places: [PLACE], code: null, busy: true, notice: null } })));
  assert.equal((busy.match(/disabled=""/g) ?? []).length, 2, 'Remove and Approve');
  const failed = render(createElement(ReadsPanel, reads({ places: { status: 'failed', places: [], code: 'RECORD_DAMAGED', busy: false, notice: null } })));
  assert.match(failed, /role="alert" data-module-state="failed" data-module-code="RECORD_DAMAGED"/);
  assert.match(failed, /Approve a folder to start a new list\. Code: RECORD_DAMAGED\./);
  assert.match(render(createElement(ReadsPanel, reads({ places: { status: 'loading', places: [], code: null, busy: false, notice: null } }))), /data-module-state="loading">Reading the approved folders\./);
});

test('the sample launch and a window with no bridge say that no approval is kept, and show no approve button', () => {
  const sample = render(createElement(ReadsPanel, reads({ sample: true, hasBridge: false })));
  assert.match(sample, /data-module-state="sample"/);
  assert.doesNotMatch(sample, /Approve a folder/);
  const none = render(createElement(ReadsPanel, reads({ sample: false, hasBridge: false })));
  assert.match(none, /data-module-state="no-bridge">This window keeps no approvals\./);
  assert.doesNotMatch(none, /Approve a folder/);
});

// ---- Local models inside the view

test('Local models runs inside the view: the module has a page there, drawn from the same report as its own screen', () => {
  assert.equal(embeddedPageOf('local-models') !== undefined, true);
  assert.equal(embeddedPageOf('modules'), undefined);
  for (const odd of ['constructor', '__proto__', 'toString', '']) assert.equal(embeddedPageOf(odd), undefined, odd);
  const shell = (child: ReactElement): string => render(createElement(HarnessProvider, { store: createHarnessStore({ initial: createSampleWorld(NOW), now: () => NOW, finishRunning: false }) }, createElement(UiProvider, null, createElement(LocalProvider, { bridge: createSampleLocal(() => '2026-11-12T10:00:00Z'), sample: true }, child))));
  const embedded = shell(createElement(LocalModelsEmbedded));
  assert.match(embedded, /data-module-screen="local-models"/);
  assert.match(embedded, /data-local-sample=""/, 'the same sample line');
  assert.doesNotMatch(embedded, /<h1/, 'the view holds the one heading of that level');
  assert.doesNotMatch(embedded, /data-screen=/, 'no second screen frame inside the view');
  assert.ok(embedded.includes('Refresh'));
});

test('the standalone Local models screen is as it was: its own frame, its heading and its Refresh button', () => {
  assert.equal(typeof LocalModels, 'function');
  const text = readFileSync(join(DESKTOP, 'renderer/harness/local-models/LocalModels.tsx'), 'utf8');
  assert.match(text, /<Screen slot="local-models" title=\{LOCAL_WORDS\.title\} count=\{view === null \|\| view\.summary === null \? undefined : view\.summary\} tools=\{s\.refresh\}>/);
});

// ---- the extension, the route and the navigation

test('registerBundled registers the Modules screen once, and the route then resolves; a protected claim is refused', () => {
  const registry = createScreenRegistry();
  assert.equal(registry.resolve('modules').found, false);
  assert.deepEqual(registerBundled(registry, [LOCAL_MODELS_MANIFEST, MODULES_MANIFEST]).map(m => m.id), ['local-models', 'modules']);
  assert.equal(registry.resolve('modules').found, true);
  assert.deepEqual(registerBundled(registry, [MODULES_MANIFEST]).map(m => m.id), ['modules'], 'again changes nothing');
  const other = createScreenRegistry();
  assert.deepEqual(registerBundled(other, [{ ...MODULES_MANIFEST, protected: true }]), []);
  assert.deepEqual(registerBundled(other, [{ ...MODULES_MANIFEST, routes: ['overview'] }]), []);
  assert.equal(typeof screenMountOf, 'function');
});

test('the route modules parses, formats and belongs to the navigation item of its own name; an id rides along', () => {
  assert.deepEqual(parseRoute('#sample/modules'), { name: 'modules' });
  assert.deepEqual(parseRoute('#app/modules/local-models'), { name: 'modules', id: 'local-models' });
  assert.deepEqual(parseRoute('#app/modules/..%2Fx'), { name: 'modules' }, 'an id with a slash is dropped');
  assert.equal(formatRoute({ name: 'modules' }), '#sample/modules');
  assert.equal(formatRoute({ name: 'modules', id: 'local-models' }, '#app'), '#app/modules/local-models');
  assert.equal(navKeyOf({ name: 'modules', id: 'local-models' }), 'modules');
});

test('the route of the view waits like the route of Local models: wait, absent, screen', () => {
  const answer = (over: Partial<Bundled>): Bundled => ({ extensions: [], ready: true, problem: null, skipped: [], ...over });
  assert.equal(localRouteState(answer({ ready: false }), true, 'modules'), 'wait');
  assert.equal(localRouteState(answer({}), true, 'modules'), 'absent');
  assert.equal(localRouteState(answer({ extensions: [MODULES_MANIFEST] }), true, 'modules'), 'screen');
  assert.equal(localRouteState(answer({}), false, 'modules'), 'screen', 'with no bridge the screen says it is not available');
  assert.equal(localRouteState(answer({ extensions: [MODULES_MANIFEST] }), true), 'absent', 'the default is still Local models');
});

test('the sample launch shows the view route as a waiting line at the first frame, never the not-found state', () => {
  const html = renderApp('#sample/modules', createSampleLocal(() => '2026-11-12T10:00:00Z'), null);
  assert.match(html, /data-screen="modules"/);
  assert.match(html, /data-modules-pending=""/);
  assert.doesNotMatch(html, /ROUTE_NOT_FOUND/);
  const none = renderApp('#app/modules', null, null, true);
  assert.doesNotMatch(none, /data-modules-pending/);
  assert.match(none, /data-error="ROUTE_NOT_FOUND"/, 'with no bridge the extension never loaded, so its route is not available');
});

test('the screen of the view, mounted from the registry in a window with no local bridge, draws its frame with the empty state and no approve button', () => {
  const registry = createScreenRegistry();
  registerBundled(registry, [MODULES_MANIFEST]);
  (globalThis as G).location = { hash: '#app/modules' };
  try {
    const store = createHarnessStore({ initial: createSampleWorld(NOW), now: () => NOW, finishRunning: false });
    const html = render(createElement(HarnessApp, { store, engine: null, local: null, modules: null, realMode: true, registry } as never));
    assert.match(html, /data-screen="modules"/);
    assert.match(html, /<h1[^>]*>Modules<\/h1>/);
    assert.match(html, /data-modules-state="empty">No modules are loaded\./);
    assert.doesNotMatch(html, /Approve a folder|data-module-open/);
  } finally { delete (globalThis as G).location; }
});

// ---- the page stays pure

test('the page reaches the modules bridge through the client alone: no renderer file names a channel or the bridge, and no file of this view imports the package of the read scope', () => {
  const files = (dir: string): string[] => readdirSync(join(DESKTOP, dir), { recursive: true, withFileTypes: true }).filter(e => e.isFile() && /\.tsx?$/.test(e.name)).map(e => join(dir, (e as unknown as { parentPath: string }).parentPath.slice(join(DESKTOP, dir).length + 1), e.name));
  for (const f of [...files('renderer/harness/modules'), ...files('shared/modules')]) {
    const text = readFileSync(join(DESKTOP, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    assert.doesNotMatch(text, /bowerloomModules|bowerloom-modules|MODULE_CHANNELS|MODULE_ARITY|module-scope|node:|electron|ipcRenderer|\bfetch\(/, f);
  }
});
