// v0.9 L4b: the screens of the harness app render only through the extension registry. Each of the six default extensions mounts the screens of its routes;
// with its registration left out, its routes show a named not-found state and the other areas still render. The page address reaches the mounted screen unchanged.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { HarnessApp } from '../renderer/harness/HarnessApp.js';
import { screenMountOf } from '../renderer/harness/extension-mounts.js';
import type { ScreenMount } from '../renderer/harness/extension-mounts.js';
import { createRegistry } from '../shared/extensions/registry.js';
import type { Registry } from '../shared/extensions/registry.js';
import { registerDefaults } from '../shared/extensions/register.js';
import { BASE_ROUTES, DEFAULT_EXTENSIONS, DEFAULT_IDS, ROUTE_OWNERS } from '../shared/extensions/defaults.js';
import type { DefaultId } from '../shared/extensions/defaults.js';
import { createHarnessStore } from '../shared/harness/store.js';
import { createSampleWorld } from '../shared/harness/sample.js';
import { createSampleEngine } from '../shared/engine/sample.js';
import { parseRoute } from '../shared/harness/route.js';
import type { Route } from '../shared/harness/route.js';
import { DESKTOP } from './support.js';

const NOW = { iso: '2026-11-09T10:00:00.000Z', label: 'Today, 10:00' } as never;
type G = { location?: { hash: string } };

/** An address for each route, with the parameters the screen takes. */
const ADDRESS: Record<string, string> = {
  welcome: '', choose: '/choose', read: '/read', notes: '/notes', overview: '/overview', harnesses: '/harnesses', builder: '/builder/sample-weekly-report',
  file: '/file/check-facts', library: '/library/skill', projects: '/projects', runs: '/runs', compare: '/compare/group-1', interfaces: '/interfaces', history: '/history', help: '/help',
};

function render(hash: string, registry: Registry<ScreenMount> | undefined, options: { realMode?: boolean; real?: null } = {}): string {
  (globalThis as G).location = { hash };
  try {
    const store = createHarnessStore({ initial: createSampleWorld(NOW), now: () => NOW, finishRunning: false });
    const props = { store, engine: createSampleEngine(), registry, ...options };
    return renderToStaticMarkup(createElement(HarnessApp, props as never) as ReactElement);
  } finally { delete (globalThis as G).location; }
}

/** A registry with every default registered except the ones named, each with the real mount. */
function registryWithout(...left: DefaultId[]): Registry<ScreenMount> {
  const registry = createRegistry<ScreenMount>();
  for (const manifest of DEFAULT_EXTENSIONS) if (!left.includes(manifest.id as DefaultId)) assert.equal(registry.register(manifest, screenMountOf(manifest.id as DefaultId)).ok, true);
  return registry;
}
const NOT_FOUND = /data-error="ROUTE_NOT_FOUND"/;

test('a screen mount exists for each of the six default extensions', () => {
  for (const id of DEFAULT_IDS) assert.equal(typeof screenMountOf(id), 'function', id);
});

test('every route renders through its registration: the owner mount is called once, with the route and nothing else answering', () => {
  for (const route of BASE_ROUTES) {
    const calls: string[] = [];
    const registry = createRegistry<ScreenMount>();
    registerDefaults(registry, id => { const real = screenMountOf(id); return props => { calls.push(`${id}:${props.route.name}`); return real(props); }; });
    const html = render(`#sample${ADDRESS[route]}`, registry);
    assert.deepEqual(calls, [`${ROUTE_OWNERS[route]}:${route}`], route);
    assert.doesNotMatch(html, NOT_FOUND, route);
    assert.ok(html.length > 200, `${route} drew a screen`);
  }
});

for (const id of DEFAULT_IDS) {
  test(`with the registration of "${id}" removed, its routes show a named not-found state and the other areas still render`, () => {
    const registry = registryWithout(id);
    for (const route of BASE_ROUTES) {
      const html = render(`#sample${ADDRESS[route]}`, registry);
      if (ROUTE_OWNERS[route] === id) {
        assert.match(html, NOT_FOUND, `${route} says it was not found`);
        assert.ok(html.includes(`>${route}<`) || html.includes(`"${route}"`), `${route} is named in the state`);
      } else assert.doesNotMatch(html, NOT_FOUND, `${route} still renders`);
    }
  });
}

test('a registry with nothing in it shows the not-found state on every route, and never a blank page', () => {
  for (const route of BASE_ROUTES) assert.match(render(`#sample${ADDRESS[route]}`, createRegistry<ScreenMount>()), NOT_FOUND, route);
});

test('hash route params (id, kind, partId, group) reach the mounted screen unchanged', () => {
  const cases: [string, Route][] = [
    ['#sample/harnesses/folder-2', { name: 'harnesses', id: 'folder-2' }],
    ['#sample/builder/sample-weekly-report', { name: 'builder', id: 'sample-weekly-report' }],
    ['#sample/file/check-facts', { name: 'file', partId: 'check-facts' }],
    ['#sample/library/agent/editor', { name: 'library', kind: 'agent', partId: 'editor' }],
    ['#sample/library/skill', { name: 'library', kind: 'skill' }],
    ['#sample/projects/p-1', { name: 'projects', id: 'p-1' }],
    ['#sample/runs/r-1', { name: 'runs', id: 'r-1' }],
    ['#sample/compare/group-1', { name: 'compare', group: 'group-1' }],
    ['#sample/interfaces/claude-code', { name: 'interfaces', id: 'claude-code' }],
    ['#app/harnesses/folder-3', { name: 'harnesses', id: 'folder-3' }],
  ];
  for (const [hash, expected] of cases) {
    assert.deepEqual(parseRoute(hash), expected, `${hash} parses`);
    let seen: Route | undefined;
    const registry = createRegistry<ScreenMount>();
    registerDefaults(registry, () => props => { seen = props.route; return createElement('main', null, 'spy'); });
    render(hash, registry, hash.startsWith('#app') ? { realMode: true } : {});
    assert.deepEqual(seen, expected, hash);
  }
});

test('the sample, real and no-bridge launches still reach their Choose screens through the registry', () => {
  const sample = render('#sample/choose', undefined);
  assert.doesNotMatch(sample, NOT_FOUND);
  assert.doesNotMatch(sample, /data-error="NO_BRIDGE"/);
  const noBridge = render('#app/choose', undefined, { realMode: true, real: null });
  assert.match(noBridge, /data-error="NO_BRIDGE"/, 'a real launch with no bridge says so');
  assert.doesNotMatch(noBridge, NOT_FOUND);
  assert.notEqual(sample, noBridge);
});

test('the sample launch lands on Welcome, and the app renders with the default registry when none is given', () => {
  const html = render('#sample', undefined);
  assert.doesNotMatch(html, NOT_FOUND);
  assert.ok(html.length > 200);
});

test('HarnessApp has no route switch: the registry is the only route table of the page', () => {
  const app = readFileSync(join(DESKTOP, 'renderer/harness/HarnessApp.tsx'), 'utf8');
  assert.doesNotMatch(app, /switch \(route\.name\)/);
  assert.doesNotMatch(app, /screens\/(Welcome|Overview|HarnessList|Library|Projects|Interfaces|Help)\.js/, 'the screens are imported by the mounts, not by the app root');
  assert.match(app, /createScreenRegistry|registry/);
});
