// The addresses of the harness-first preview, and the geometry of its graph: pure functions, tested without a window.
import test from 'node:test';
import assert from 'node:assert/strict';
import { BASE, REAL_BASE, baseOf, formatRoute, isFirstRun, isHarnessHash, isRealHash, navKeyOf, parseRoute } from '../shared/harness/route.js';
import type { Route } from '../shared/harness/route.js';
import { SAMPLE_IDS, createSampleWorld } from '../shared/harness/sample.js';
import { addPart, setNodePosition } from '../shared/harness/store.js';
import { ZOOM_MAX, ZOOM_MIN, boundsOf, brightIds, centerOnMiniMap, edgePath, fitView, graphOf, miniMap, toGraph, zoomAt } from '../shared/harness/layout.js';
import { harnessById } from '../shared/harness/status.js';

const NOW = { daysAgo: 0, time: '11:00' };

test('every route formats to an address and parses back to the same route', () => {
  const routes: Route[] = [
    { name: 'welcome' }, { name: 'choose' }, { name: 'read' }, { name: 'harnesses' }, { name: 'harnesses', id: 'harness-a' }, { name: 'builder', id: 'folder-1' }, { name: 'builder', id: 'sample-weekly-report' },
    { name: 'file', partId: 'agent-researcher' }, { name: 'library', kind: 'skill' }, { name: 'library', kind: 'agent', partId: 'agent-writer' }, { name: 'projects' }, { name: 'projects', id: 'project-notes' },
    { name: 'runs' }, { name: 'runs', id: 'run-1' }, { name: 'compare', group: 'group-1' }, { name: 'interfaces' }, { name: 'interfaces', id: 'codex' }, { name: 'history' }, { name: 'help' },
  ];
  for (const route of routes) { const hash = formatRoute(route); assert.ok(hash.startsWith(BASE), hash); assert.deepEqual(parseRoute(hash), route, hash); }
  assert.equal(formatRoute({ name: 'welcome' }), '#sample');
  for (const route of routes) { const hash = formatRoute(route, REAL_BASE); assert.ok(hash.startsWith(REAL_BASE), hash); assert.deepEqual(parseRoute(hash), route, hash); }
});

test('the real launch has its own address: both are the preview\'s own, only the real one is real, and the base is kept when the page moves', () => {
  assert.equal(REAL_BASE, '#app');
  for (const hash of ['#app', '#app/choose', '#app/builder/harness-a/list']) { assert.equal(isHarnessHash(hash), true, hash); assert.equal(isRealHash(hash), true, hash); assert.equal(baseOf(hash), REAL_BASE, hash); }
  for (const hash of ['#sample', '#sample/choose', '']) { assert.equal(isRealHash(hash), false, hash); assert.equal(baseOf(hash), BASE, hash); }
  for (const hash of ['#appx', '#app2/choose', '#sample-rea', '#app-x']) { assert.equal(parseRoute(hash), null, hash); assert.equal(isHarnessHash(hash), false, hash); assert.equal(isRealHash(hash), false, hash); }
  assert.deepEqual(parseRoute('#app'), { name: 'welcome' }); assert.deepEqual(parseRoute('#app/choose'), { name: 'choose' });
  assert.deepEqual(parseRoute('#app/nothing-here'), { name: 'harnesses' });
  assert.equal(formatRoute({ name: 'read' }, REAL_BASE), '#app/read'); assert.equal(formatRoute({ name: 'welcome' }, REAL_BASE), '#app');
});

test('an address that is not the preview\'s own parses to null, and an unknown page under it is the Harness list', () => {
  for (const hash of ['', '#main', '#prototype', '#prototype-v2', '#prototype-v2/map', '#sample0', '#samplex/harnesses']) { assert.equal(parseRoute(hash), null, hash); assert.equal(isHarnessHash(hash), false, hash); }
  assert.deepEqual(parseRoute('#sample/'), { name: 'welcome' });
  assert.deepEqual(parseRoute('#sample/nothing-here'), { name: 'harnesses' });
  assert.deepEqual(parseRoute('#sample/builder'), { name: 'harnesses' }); assert.deepEqual(parseRoute('#sample/file'), { name: 'harnesses' }); assert.deepEqual(parseRoute('#sample/compare'), { name: 'runs' });
  assert.deepEqual(parseRoute('#sample/library/nonsense'), { name: 'library', kind: 'skill' });
  assert.deepEqual(parseRoute('#sample/builder/<script>/list'), { name: 'harnesses' }, 'an id with odd characters is refused');
  assert.deepEqual(parseRoute('#sample/builder/%E0%A4%A/list'), { name: 'harnesses' });
  assert.deepEqual(parseRoute('#sample/builder/folder-3/sideways'), { name: 'builder', id: 'folder-3' });
});

test('the Builder opens only an id main gives a folder (folder-<n>) or the sample launch gives one (sample-<name>); any other id is the folder list', () => {
  for (const id of ['folder-1', 'folder-999999', 'sample-weekly-report', 'sample-inbox-tools']) assert.deepEqual(parseRoute(`#sample/builder/${id}`), { name: 'builder', id }, id);
  for (const id of ['__proto__', 'constructor', 'toString', 'harness-a', 'folder-', 'folder-1234567', 'folder-1a', 'Folder-1', 'sample-', 'sample-A', '..', 'folder-1.']) {
    assert.deepEqual(parseRoute(`#sample/builder/${id}`), { name: 'harnesses' }, id);
  }
});

test('the Builder\'s address names one folder: builder/<folderId>; an older address with a view still opens the folder', () => {
  assert.equal(formatRoute({ name: 'builder', id: 'folder-2' }), '#sample/builder/folder-2');
  assert.equal(formatRoute({ name: 'builder', id: 'folder-2' }, REAL_BASE), '#app/builder/folder-2');
  assert.deepEqual(parseRoute('#sample/builder/folder-2'), { name: 'builder', id: 'folder-2' });
  assert.deepEqual(parseRoute('#app/builder/folder-2/list'), { name: 'builder', id: 'folder-2' });
  assert.deepEqual(parseRoute('#sample/builder/'), { name: 'harnesses' });
});

test('the three first screens have no navigation; every other route belongs to an item of it', () => {
  assert.deepEqual(['welcome', 'choose', 'read', 'harnesses', 'history'].map(name => isFirstRun({ name } as Route)), [true, true, true, false, false]);
  assert.equal(navKeyOf({ name: 'builder', id: 'x' }), 'harnesses'); assert.equal(navKeyOf({ name: 'file', partId: 'x' }), 'library'); assert.equal(navKeyOf({ name: 'library', kind: 'tool' }), 'library-tool');
  assert.equal(navKeyOf({ name: 'compare', group: 'g' }), 'runs'); assert.equal(navKeyOf({ name: 'welcome' }), null);
});

test('the graph of Weekly report crew is placed as in the design: agents at the left, parts at the right, the missing one last', () => {
  const s = createSampleWorld(), h = harnessById(s, SAMPLE_IDS.weekly)!, g = graphOf(s, h);
  assert.equal(g.nodes.length, 12); assert.equal(g.edges.length, 10);
  const at = (id: string) => { const n = g.nodes.find(x => x.id === id)!; return [n.x, n.y, n.w, n.h]; };
  assert.deepEqual(at('agent-planner'), [48, 70, 208, 76]); assert.deepEqual(at('skill-draft-outline'), [440, 40, 216, 60]); assert.deepEqual(at('missing-translate'), [440, 648, 216, 60]);
  assert.deepEqual(g.edges.filter(e => e.missing).map(e => e.id), ['agent-writer>missing-translate']);
  assert.ok(g.nodes.find(n => n.id === 'tool-spreadsheet')!.isNew); assert.ok(g.nodes.find(n => n.id === 'missing-translate')!.missing);
  assert.deepEqual(g.bounds, { left: 48, top: 40, right: 744, bottom: 708 }, 'the right edge leaves room for the Fix button');
});

test('a node that is being dragged takes its dragged place, and a saved place is kept', () => {
  const s = setNodePosition(createSampleWorld(), SAMPLE_IDS.weekly, 'agent-writer', { x: 100, y: 200 });
  const h = harnessById(s, SAMPLE_IDS.weekly)!;
  assert.deepEqual(graphOf(s, h).nodes.find(n => n.id === 'agent-writer'), { ...graphOf(s, h).nodes.find(n => n.id === 'agent-writer')!, x: 100, y: 200 });
  assert.equal(graphOf(s, h, { 'agent-writer': { x: 5, y: 6 } }).nodes.find(n => n.id === 'agent-writer')!.x, 5);
});

test('a harness with no saved places gets default places: agents level with their parts and never overlapping, parts one slot apart, and a new part goes below the others', () => {
  const s = createSampleWorld(), h = harnessById(s, SAMPLE_IDS.research)!, g = graphOf(s, h);
  const agents = g.nodes.filter(n => n.kind === 'agent'), rest = g.nodes.filter(n => n.kind !== 'agent');
  assert.equal(agents.length, 2); assert.ok(agents[1]!.y >= agents[0]!.y + agents[0]!.h + 12 - 0.001);
  assert.deepEqual(rest.map(n => n.y), rest.map((_, i) => 40 + i * 76));
  assert.ok(rest.every(n => n.x === 440) && agents.every(n => n.x === 48));
  const added = addPart(createSampleWorld(), SAMPLE_IDS.weekly, 'tool-notes-search', NOW), g2 = graphOf(added, harnessById(added, SAMPLE_IDS.weekly)!);
  assert.equal(g2.nodes.find(n => n.id === 'tool-notes-search')!.y, 724);
  const empty = graphOf(s, { ...h, partIds: [], links: [], missing: [] });
  assert.deepEqual(empty.bounds, { left: 0, top: 0, right: 0, bottom: 0 }); assert.equal(boundsOf([]).right, 0);
});

test('an edge leaves the right edge of the agent and enters the left edge of the part', () => {
  const g = graphOf(createSampleWorld(), harnessById(createSampleWorld(), SAMPLE_IDS.weekly)!);
  const a = g.nodes.find(n => n.id === 'agent-researcher')!, b = g.nodes.find(n => n.id === 'tool-web-search')!;
  assert.match(edgePath(a, b), /^M256 336 C\S+ 336 \S+ 222 440 222$/);
});

test('selecting a node keeps it and its neighbours bright; nothing selected keeps everything bright', () => {
  const g = graphOf(createSampleWorld(), harnessById(createSampleWorld(), SAMPLE_IDS.weekly)!);
  assert.equal(brightIds(g.edges, null), null);
  assert.deepEqual([...brightIds(g.edges, 'agent-researcher')!].sort(), ['agent-researcher', 'context-client-list', 'skill-check-facts', 'skill-summarize-sources', 'tool-web-search']);
  assert.deepEqual([...brightIds(g.edges, 'skill-draft-outline')!].sort(), ['agent-planner', 'agent-writer', 'skill-draft-outline']);
});

test('fit shows the whole graph, never larger than life; zoom keeps the point under the pointer; the limits hold', () => {
  const g = graphOf(createSampleWorld(), harnessById(createSampleWorld(), SAMPLE_IDS.weekly)!);
  const v = fitView(g.bounds, 728, 748);
  assert.ok(v.k <= 1 && v.k >= ZOOM_MIN);
  const left = g.bounds.left * v.k + v.x, right = g.bounds.right * v.k + v.x, top = g.bounds.top * v.k + v.y, bottom = g.bounds.bottom * v.k + v.y;
  assert.ok(left >= 0 && right <= 728 && top >= 0 && bottom <= 748);
  assert.equal(fitView(g.bounds, 5000, 5000).k, 1); assert.deepEqual(fitView({ left: 0, top: 0, right: 0, bottom: 0 }, 700, 700), { x: 0, y: 0, k: 1 });
  const z = zoomAt({ x: 10, y: 20, k: 1 }, 1.2, 300, 200);
  const before = toGraph({ x: 10, y: 20, k: 1 }, 300, 200), after = toGraph(z, 300, 200);
  assert.ok(Math.abs(before.x - after.x) < 1e-9 && Math.abs(before.y - after.y) < 1e-9);
  assert.equal(zoomAt({ x: 0, y: 0, k: 1.9 }, 5, 0, 0).k, ZOOM_MAX); assert.equal(zoomAt({ x: 0, y: 0, k: 0.5 }, 0.1, 0, 0).k, ZOOM_MIN);
});

test('the small map holds every node, shows the window, and a press on it moves the window there', () => {
  const g = graphOf(createSampleWorld(), harnessById(createSampleWorld(), SAMPLE_IDS.weekly)!), view = { x: 0, y: 0, k: 2 };
  const m = miniMap(g, view, 700, 700, 140, 92);
  assert.equal(m.bars.length, 12); assert.ok(m.bars.every(b => b.x >= 0 && b.y >= 0 && b.x + b.w <= 140 && b.y + b.h <= 92));
  const moved = centerOnMiniMap(m, view, 700, 700, m.window.x + m.window.w / 2 + 10, m.window.y + m.window.h / 2);
  assert.equal(moved.k, 2); assert.ok(moved.x < 0, 'the window moved right, so the graph moved left');
});
