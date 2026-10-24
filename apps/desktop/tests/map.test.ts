// The map: nodes and edges from what Bowerloom manages, the filters, the auto-layout, and speed on a large map.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EDGE_RELS, MAP_KINDS, REL_WORDS, buildMap, filterMap, hoverLine, outlineOf } from '../shared/mapmodel.js';
import type { MapKind, MapModel } from '../shared/mapmodel.js';
import { LAYOUT, autoLayout, snap, syntheticMap } from '../shared/maplayout.js';
import { clone, sampleSnapshot } from './support.js';

const all = { scope: 'everything' as const, kinds: null, query: '' };

test('the map holds every kind of thing and every kind of wire, with stable ids and no wire to nowhere', async () => {
  const m = buildMap(await sampleSnapshot()), ids = new Set(m.nodes.map(n => n.id));
  assert.equal(ids.size, m.nodes.length, 'ids are unique'); assert.equal(new Set(m.edges.map(e => e.id)).size, m.edges.length);
  for (const e of m.edges) { assert.ok(ids.has(e.from) && ids.has(e.to), e.id); assert.ok(EDGE_RELS.includes(e.rel)); assert.notEqual(e.from, e.to); }
  const kinds = new Set(m.nodes.map(n => n.kind)); for (const k of ['machine', 'project', 'team', 'agent', 'skill', 'prompt', 'reading-list', 'knowledge-folder'] as MapKind[]) assert.ok(kinds.has(k), k);
  assert.deepEqual([...new Set(m.edges.map(e => e.rel))].sort(), ['allowed', 'comes-from', 'contains', 'owns', 'reads', 'uses']);
  assert.deepEqual(buildMap(await sampleSnapshot()).nodes.map(n => n.id), m.nodes.map(n => n.id), 'the same snapshot gives the same ids');
  assert.ok(MAP_KINDS.length === 10);
});

test('the machine holds the shared library; projects use items that come from it; teams own helpers; helpers read reading lists; lists read knowledge folders', async () => {
  const s = await sampleSnapshot(), m = buildMap(s), has = (from: string, rel: string, to: string) => m.edges.some(e => e.from === from && e.rel === rel && e.to === to);
  const site = s.projects.find(p => p.name === 'studio-site')!, news = s.projects.find(p => p.name === 'newsletter')!;
  assert.ok(has('machine', 'contains', 'store:skill:house-style')); assert.ok(has(`project:${site.key}`, 'uses', `item:${site.key}:skill:house-style`)); assert.ok(has(`item:${site.key}:skill:house-style`, 'comes-from', 'store:skill:house-style'));
  assert.ok(has(`item:${news.key}:team:newsroom`, 'owns', `agent:${news.key}:editor`)); assert.ok(has(`agent:${news.key}:editor`, 'reads', `slice:${news.key}:team-notes`)); assert.ok(has(`slice:${news.key}:team-notes`, 'reads', 'folder:team-notes')); assert.ok(m.edges.some(e => e.rel === 'allowed' && e.to === 'folder:team-notes'), 'a granted project is drawn as allowed to read');
  assert.ok(has('machine', 'contains', `project:${site.key}`)); assert.ok(!m.edges.some(e => e.rel === 'comes-from' && e.to.startsWith('item:')));
});

test('statuses and reasons are the same plain ones the screens give: Ready, Drifted, Held, Cannot open', async () => {
  const s = await sampleSnapshot(), m = buildMap(s), byLabel = (l: string) => m.nodes.filter(n => n.label === l);
  assert.equal(byLabel('studio-site')[0]!.status, 'ready'); assert.equal(byLabel('newsletter')[0]!.status, 'drifted'); assert.ok(byLabel('newsletter')[0]!.reasons.length > 0); assert.equal(byLabel('old-archive')[0]!.status, 'drifted');
  assert.equal(m.nodes.find(n => n.kind === 'agent' && n.label === 'publisher')!.status, 'held'); assert.equal(m.nodes.find(n => n.kind === 'reading-list' && n.label === 'client-history')!.status, 'held');
  assert.match(m.nodes.find(n => n.kind === 'reading-list' && n.label === 'client-history')!.reasons[0]!, /has not been given permission/);
  const t = clone(s); t.projects[0]!.status = 'unreadable'; t.projects[0]!.openCode = 'PROJECT_UNSAFE'; assert.equal(buildMap(t).nodes.find(n => n.id === `project:${t.projects[0]!.key}`)!.status, 'cannot-open');
  for (const n of m.nodes) assert.ok(n.description.length > 5, n.id);
  assert.match(hoverLine(byLabel('newsletter')[0]!), /^Project \(Drifted\)\. /);
});

test('scope: global is the machine, the shared library and the knowledge folders; project scope is the folders of work; everything is both', async () => {
  const m = buildMap(await sampleSnapshot()), g = filterMap(m, { ...all, scope: 'global' }), p = filterMap(m, { ...all, scope: 'project' }), e = filterMap(m, all);
  assert.ok(g.nodes.every(n => n.scope === 'global')); assert.ok(g.nodes.some(n => n.kind === 'knowledge-folder') && g.nodes.some(n => n.id.startsWith('store:')));
  assert.ok(p.nodes.every(n => n.scope === 'project' || n.kind === 'machine')); assert.ok(p.nodes.some(n => n.kind === 'project') && !p.nodes.some(n => n.id.startsWith('store:')));
  assert.equal(e.nodes.length, m.nodes.length); assert.ok(g.edges.every(x => g.nodes.some(n => n.id === x.from) && g.nodes.some(n => n.id === x.to)));
});

test('kind filters and search keep what matches and the things next to it', async () => {
  const m = buildMap(await sampleSnapshot());
  const skills = filterMap(m, { ...all, kinds: new Set<MapKind>(['skill']) }); assert.ok(skills.nodes.every(n => n.kind === 'skill')); assert.ok(skills.edges.every(e => e.rel === 'comes-from'), 'only wires between skills remain');
  const q = filterMap(m, { ...all, query: 'house style' }); assert.ok([...q.matches].every(id => /House style/.test(m.nodes.find(n => n.id === id)!.label))); assert.ok(q.nodes.length > q.matches.size, 'neighbours are kept'); assert.ok(q.nodes.some(n => n.kind === 'project'));
  assert.equal(filterMap(m, { ...all, query: 'zzz-nothing' }).nodes.length, 0);
  assert.equal(filterMap(m, { ...all, query: '  HOUSE  ' }).matches.size, q.matches.size, 'case and spaces do not matter');
});

test('the text outline covers every node once, in order of what holds what, with plain words', async () => {
  const m = buildMap(await sampleSnapshot()), o = outlineOf(m);
  assert.equal(new Set(o.map(x => x.id)).size, m.nodes.length); assert.equal(o[0]!.id, 'machine'); assert.equal(o[0]!.depth, 0); assert.match(o[0]!.text, /^This computer: This computer/);
  assert.ok(o.some(x => /^Helper: publisher, Held/.test(x.text))); assert.ok(o.some(x => /^Reading list: team-notes.*reads team-notes/.test(x.text)));
});

test('auto layout: layered left to right by kind, nothing overlaps, and the same map gives the same places', async () => {
  const m = buildMap(await sampleSnapshot()), a = autoLayout(m.nodes, m.edges), b = autoLayout(m.nodes, m.edges);
  assert.deepEqual([...a.entries()], [...b.entries()]);
  const x = (kind: MapKind) => Math.max(...m.nodes.filter(n => n.kind === kind && (n.owner !== null || kind === 'machine')).map(n => a.get(n.id)!.x));
  assert.ok(x('machine') < x('project') && x('project') < x('team') && x('team') < x('agent') && x('agent') < x('skill'));
  assert.ok(m.nodes.filter(n => n.id.startsWith('store:')).every(n => a.get(n.id)!.x > x('skill')), 'the shared library is at the right');
  const seen = new Set<string>(); for (const p of a.values()) { const k = `${p.x}:${p.y}`; assert.ok(!seen.has(k), k); seen.add(k); }
  const columns = new Map<number, number[]>(); for (const p of a.values()) columns.set(p.x, [...(columns.get(p.x) ?? []), p.y]);
  for (const ys of columns.values()) { ys.sort((p, q) => p - q); for (let i = 1; i < ys.length; i++) assert.ok(ys[i]! - ys[i - 1]! >= LAYOUT.rowHeight, 'a row apart'); }
});

test('snapping puts a place on the grid', () => { assert.deepEqual(snap({ x: 23, y: 41 }), { x: 16, y: 48 }); assert.deepEqual(snap({ x: -9, y: 7 }, 10), { x: -10, y: 10 }); });

test('a large map (500 nodes) is laid out in well under a second, and 200 nodes are built and filtered at speed', () => {
  const big = syntheticMap(500); assert.equal(big.nodes.length, 500);
  const t0 = performance.now(); const places = autoLayout(big.nodes, big.edges); const ms = performance.now() - t0;
  assert.equal(places.size, 500); assert.ok(ms < 500, `layout took ${ms.toFixed(0)} ms`);
  const f0 = performance.now(); for (let i = 0; i < 50; i++) filterMap({ nodes: big.nodes, edges: big.edges }, { scope: 'everything', kinds: new Set<MapKind>(['skill', 'project']), query: 'p-1' }); assert.ok((performance.now() - f0) / 50 < 20, 'a filter is fast enough to follow typing');
});

test('wires and chips claim only what the data proves', async () => {
  const s = await sampleSnapshot(), m = buildMap(s);
  // A project and a knowledge folder: "is allowed to read" only where a permission exists, never "reads".
  for (const f of s.folders) for (const p of s.projects) {
    const wire = m.edges.filter(e => e.to === `folder:${f.name}` && e.from.endsWith(`:${p.key}`) && !e.from.startsWith('slice:') && !e.from.startsWith('agent:'));
    assert.equal(wire.length > 0, f.allowed.includes(p.key), `${p.name} -> ${f.name}`); for (const w of wire) assert.equal(w.rel, 'allowed');
  }
  // A reading list reaches a folder only when its project has a permission for it.
  const t = clone(s); for (const f of t.folders) f.allowed = [];
  assert.ok(!buildMap(t).edges.some(e => e.from.startsWith('slice:') && e.to.startsWith('folder:')), 'no permission, no wire to the folder');
  // An item that is only on disk is held by the folder, marked, and not "used".
  const u = clone(s), proj = u.projects.find(p => p.items.length > 0)!, item = proj.items[0]!; item.note = 'unlisted';
  const um = buildMap(u), id = `item:${proj.key}:${item.kind}:${item.id}`, node = um.nodes.find(n => n.id === id)!;
  assert.equal(node.unlisted, true); assert.match(node.reasons[0]!, /not name it/); assert.match(outlineOf(um).find(o => o.id === id)!.text, /not listed/);
  assert.ok(!um.edges.some(e => e.to === id && e.rel === 'uses') && !um.edges.some(e => e.from === id && e.rel === 'comes-from') && um.edges.some(e => e.to === id && e.rel === 'contains'));
  // A project with no lock is not "Ready".
  const l = clone(s); l.projects[0]!.status = 'not-locked'; assert.equal(buildMap(l).nodes.find(n => n.id.endsWith(l.projects[0]!.key))!.status, 'not-locked');
  // A library problem names the right kind of thing.
  const q = clone(s); q.library.teams[0]!.problem = 'X'; q.library.prompts[0]!.problem = 'X'; q.library.skills[0]!.problem = 'X';
  const words = buildMap(q).nodes.filter(n => n.id.startsWith('store:') && n.reasons.length).map(n => `${n.kind}: ${n.reasons[0]}`).sort();
  assert.deepEqual(words, ['prompt: The folder for this prompt is missing from your library.', 'skill: The folder for this skill is missing from your library.', 'team: The folder for this team is missing from your library.']);
});

test('a context store and the knowledge folder saved for it: the wire runs from the store to the record, and the words say so', async () => {
  const s = clone(await sampleSnapshot()), proj = s.projects.find(p => p.name === 'newsletter')!; proj.role = 'context-store'; s.folders[0]!.dir = proj.dir;
  const m = buildMap(s), wire = m.edges.find(e => e.rel === 'registered')!;
  assert.equal(wire.from, `context:${proj.key}`); assert.equal(wire.to, `folder:${s.folders[0]!.name}`); assert.ok(!m.edges.some(e => e.rel === 'comes-from' && e.to.startsWith('context:')));
  assert.equal(REL_WORDS.registered, 'is registered as'); assert.equal(REL_WORDS.allowed, 'is allowed to read');
});

test('an outline entry lists all of its relations, and a thing held by two is named under both', async () => {
  const m: MapModel = {
    nodes: ['machine', 'p1', 'p2', 'a', 'f'].map(id => ({ id, kind: id === 'machine' ? 'machine' as const : id === 'f' ? 'knowledge-folder' as const : id === 'a' ? 'agent' as const : 'project' as const, label: id, scope: 'project' as const, description: '', status: null, reasons: [], link: null, owner: null })),
    edges: [{ id: '1', from: 'machine', to: 'p1', rel: 'contains' }, { id: '2', from: 'machine', to: 'p2', rel: 'contains' }, { id: '3', from: 'p1', to: 'a', rel: 'owns' }, { id: '4', from: 'p2', to: 'a', rel: 'owns' }, { id: '5', from: 'a', to: 'f', rel: 'allowed' }, { id: '6', from: 'a', to: 'p1', rel: 'reads' }],
  };
  const row = outlineOf(m).find(o => o.id === 'a')!.text;
  assert.match(row, /is allowed to read f/); assert.match(row, /reads p1/); assert.match(row, /also: p2 owns it/);
  assert.match(outlineOf(m).find(o => o.id === 'f')!.text, /a is allowed to read it/);
});
