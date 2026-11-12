// The dive, screens (v0.9 lane 3): the Harnesses details list the parts, the Library details say where a part comes from, and no second screen exists (D5 B).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createElement, isValidElement } from 'react';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { HarnessApp } from '../renderer/harness/HarnessApp.js';
import { createHarnessStore } from '../shared/harness/store.js';
import { createSampleEngine } from '../shared/engine/sample.js';
import { BASE_ROUTES } from '../shared/extensions/defaults.js';
import { parseRoute } from '../shared/harness/route.js';
import { PartsOfHarness } from '../renderer/harness/parts/PartsOfHarness.js';
import type { HarnessState } from '../shared/harness/types.js';
import { fixtureState, NOW } from './harness-dive-fixture.js';
import { DESKTOP } from './support.js';

type G = { location?: { hash: string } };
function render(hash: string, initial: HarnessState = fixtureState()): string {
  (globalThis as G).location = { hash };
  try {
    const store = createHarnessStore({ initial, now: () => NOW, finishRunning: false });
    return renderToStaticMarkup(createElement(HarnessApp, { store, engine: createSampleEngine() } as never));
  } finally { delete (globalThis as G).location; }
}
const state = fixtureState();
const idOf = (name: string, origin?: string): string => state.parts.find(p => p.name === name && (origin === undefined || p.origin === origin))!.id;

test('an open harness lists its parts, skills before agents, before tools and context', () => {
  const html = render('#sample/harnesses/harness-mixed');
  const at = (kind: string): number => html.indexOf(`data-dive-kind="${kind}"`);
  assert.ok(at('skill') > 0 && at('skill') < at('agent') && at('agent') < at('tool') && at('tool') < at('context'));
  assert.match(html, /data-dive=""/);
});

test('each skill and agent row opens that part in the Library, on the tab of its kind', () => {
  const html = render('#sample/harnesses/harness-mixed');
  assert.match(html, new RegExp(`data-dive-part="${idOf('Alpha checklist')}"`));
  assert.match(html, /data-dive-open="skill\//);
  assert.match(html, /data-dive-open="agent\//);
  assert.match(html, /aria-label="Open Alpha checklist"/);
});

test('a part the Library does not list is shown without a way in, and a missing part says so', () => {
  const html = render('#sample/harnesses/harness-mixed');
  assert.match(html, /data-dive-part="agent-hidden" data-no-link=""/);
  assert.match(html, /data-dive-missing="skill-gone"/);
  assert.match(html, /Gone skill/);
});

test('an empty harness says it holds no parts', () => {
  assert.match(render('#sample/harnesses/harness-empty'), /data-dive-empty=""/);
});

test('a part in the Library says where it comes from', () => {
  const html = render(`#sample/library/skill/${idOf('Alpha checklist')}`);
  assert.match(html, /data-origin="found"/);
  assert.match(html, /Found in ~\/Projects\/weekly-report/);
  assert.match(html, /Where it comes from/);
});

test('a part held by a folder harness says so, and an agent shows its origin too', () => {
  const html = render('#sample/library/agent/agent-folder-held');
  assert.match(html, /data-origin="harness-folder"/);
  assert.match(html, /harness of the folder weekly-report/);
});

test('the Library still names the harnesses that use a part, so the way back to the harness stays', () => {
  const html = render(`#sample/library/skill/${idOf('Alpha checklist')}`);
  assert.match(html, /Mixed fixture/);
});

test('the full path of a part never reaches the origin block', () => {
  const html = render(`#sample/library/skill/${idOf('Alpha checklist')}`);
  const block = html.slice(html.indexOf('data-origin='), html.indexOf('data-origin=') + 1500);
  assert.doesNotMatch(block, /\/Users\//);
});

// ---- D5 B: the Library is extended, and no second screen exists

test('there is no second screen, route, extension or navigation entry for the same list', () => {
  assert.equal(BASE_ROUTES.length, 15);
  assert.equal(readdirSync(join(DESKTOP, 'renderer/harness/screens')).some(f => /dive/i.test(f)), false);
  assert.deepEqual(parseRoute('#app/dive'), { name: 'harnesses' });
});

test('the dive adds no call to the engine API: it reads the state and names no bridge', () => {
  for (const file of ['shared/harness/harness-dive.ts', 'renderer/harness/screens/HarnessList.tsx', 'renderer/harness/screens/Library.tsx', 'renderer/harness/words-dive.ts', 'renderer/harness/parts/PartsOfHarness.tsx', 'renderer/harness/parts/PartOrigin.tsx']) {
    const text = readFileSync(join(DESKTOP, file), 'utf8');
    assert.doesNotMatch(text, /window\.|ipcRenderer|contextBridge|bowerloom(Runs|Local|Modules)|\bfs\b|node:/, file);
  }
  const golden = readdirSync(join(DESKTOP, '../../packages/engine-api/golden'));
  for (const f of ['base-d4c8a478.json', 'local-calls.json', 'module-calls.json', 'run-calls.json']) assert.ok(golden.includes(f), f);
  assert.equal(golden.some(f => /dive/i.test(f)), false);
});

// ---- fix round 1

const mixed = state.harnesses.find(h => h.id === 'harness-mixed')!;
const parts = (over: Partial<typeof mixed>, st: HarnessState = state): string => renderToStaticMarkup(createElement(PartsOfHarness, { state: st, harness: { ...mixed, ...over } }));

test('a harness whose ids the state does not hold lists each one, and never says it holds no parts', () => {
  const html = parts({ partIds: ['ghost-1', 'ghost-2'], missing: [] });
  assert.match(html, /data-dive-unresolved-id="ghost-1"/);
  assert.match(html, /A part named in the manifest \(ghost-2\) was not found\./);
  assert.doesNotMatch(html, /data-dive-empty/);
});

test('an empty id and __proto__ are reported too', () => {
  const html = parts({ partIds: ['', '__proto__'], missing: [] });
  assert.match(html, /A part named in the manifest \(empty id\) was not found\./);
  assert.match(html, /\(__proto__\) was not found/);
});

test('the empty hint shows only when the manifest lists nothing and names nothing missing', () => {
  assert.match(parts({ partIds: [], missing: [] }), /data-dive-empty/);
  assert.doesNotMatch(parts({ partIds: [], missing: [{ id: 'x', kind: 'tool', name: 'X' }] }), /data-dive-empty/);
});

test('an id the manifest repeats gives one row, and a shared part id is told', () => {
  const id = idOf('Alpha checklist');
  const html = parts({ partIds: [id, id], missing: [] });
  assert.equal(html.split(`data-dive-part="${id}"`).length - 1, 1);
  const twice = { ...state, parts: [...state.parts, { ...state.parts.find(p => p.id === id)!, name: 'Copy' }] };
  assert.match(parts({ partIds: [id], missing: [] }, twice), /data-dive-duplicates/);
  assert.doesNotMatch(html, /data-dive-duplicates/);
});

test('a scan that stopped early or read only part says the list can be incomplete; a whole scan says nothing', () => {
  const real = { couldNotRead: 0, stoppedEarly: false, textsCut: 0, notes: [] as string[] };
  assert.match(parts({}, { ...state, real: { ...real, stoppedEarly: true } }), /data-dive-incomplete/);
  assert.match(parts({}, { ...state, real: { ...real, onlyPartRead: true } }), /data-dive-incomplete/);
  assert.doesNotMatch(parts({}, { ...state, real }), /data-dive-incomplete/);
  assert.doesNotMatch(parts({}), /data-dive-incomplete/);
});

test('a label with markup is escaped in the origin block', () => {
  const id = idOf('Alpha checklist');
  const bad = { ...state, parts: state.parts.map(p => (p.id === id ? { ...p, source: '<img src=x onerror=1><b>hi</b>' } : p)) };
  const html = render(`#sample/library/skill/${id}`, bad);
  assert.match(html, /Comes from &lt;img src=x onerror=1&gt;&lt;b&gt;hi&lt;\/b&gt;\./);
  assert.doesNotMatch(html, /<img src=x onerror/);
});

test('the Library file line is gone from the details, and the origin block holds the file name once', () => {
  const html = render(`#sample/library/skill/${idOf('Alpha checklist')}`);
  assert.equal((html.match(/File: SKILL\.md\./g) ?? []).length, 1);
});

/** Walks a React element tree, calling each function component with no hooks, and collects the elements that have a prop. */
function findAll(node: ReactNode, prop: string, out: { props: Record<string, unknown> }[] = []): { props: Record<string, unknown> }[] {
  if (Array.isArray(node)) { for (const n of node) findAll(n, prop, out); return out; }
  if (!isValidElement(node)) return out;
  const props = node.props as Record<string, unknown>;
  if (prop in props) out.push({ props });
  findAll(props.children as ReactNode, prop, out);
  return out;
}

test('a part row calls go() with the library route of its kind and id', () => {
  const g = globalThis as G;
  g.location = { hash: '#sample/harnesses/harness-mixed' };
  try {
    const tree = PartsOfHarness({ state, harness: mixed });
    const rows = findAll(tree, 'data-dive-open');
    assert.ok(rows.length >= 4);
    const skill = state.parts.find(p => p.kind === 'skill' && p.inLibrary && mixed.partIds.includes(p.id))!;
    const row = rows.find(r => r.props['data-dive-open'] === `skill/${skill.id}`)!;
    (row.props.onClick as () => void)();
    assert.equal(g.location.hash, `#sample/library/skill/${skill.id}`);
    const agent = state.parts.find(p => p.kind === 'agent' && p.inLibrary && mixed.partIds.includes(p.id))!;
    g.location = { hash: '#app/harnesses/harness-mixed' };
    (rows.find(r => r.props['data-dive-open'] === `agent/${agent.id}`)!.props.onClick as () => void)();
    assert.equal(g.location.hash, `#app/library/agent/${agent.id}`);
  } finally { delete g.location; }
});
