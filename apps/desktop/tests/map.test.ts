// The map: nodes and edges from what Bowerloom manages, the filters, the auto-layout, and speed on a large map.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EDGE_RELS, MAP_KINDS, OVERVIEW_KINDS, REL_WORDS, buildMap, filterMap, hoverLine, outlineOf } from '../shared/mapmodel.js';
import type { MapKind, MapModel } from '../shared/mapmodel.js';
import { LAYOUT, autoLayout, prunePlaces, snap, syntheticMap } from '../shared/maplayout.js';
import { CLUSTER_MIN, clusterMap } from '../shared/mapcluster.js';
import { createWireCache, sameNode, wireState } from '../renderer/map/wires.js';
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

test('pointing at a thing changes only the wires next to it, and the other wire objects are the same ones', () => {
  const edges = [{ id: 'a', from: 'x', to: 'y', rel: 'uses' as const }, { id: 'b', from: 'y', to: 'z', rel: 'owns' as const }, { id: 'c', from: 'p', to: 'q', rel: 'reads' as const }];
  const cache = createWireCache(), none = cache.edges(edges, null, false), onY = cache.edges(edges, 'y', false), again = cache.edges(edges, null, false);
  assert.ok(none.every(e => /is-dim/.test(e.className!))); assert.match(onY[0]!.className!, /is-active/); assert.match(onY[1]!.className!, /is-active/); assert.match(onY[2]!.className!, /is-dim/);
  assert.equal(onY[2], none[2], 'a wire that is not next to it keeps its object'); assert.equal(again[0], none[0], 'going back reuses the old ones');
  assert.deepEqual(cache.edges(edges, null, true).map(e => e.className), ['bw-edge rel-uses', 'bw-edge rel-owns', 'bw-edge rel-reads']);
  assert.deepEqual(cache.edges(edges, 'y', true).map(e => wireState(e.data as never, 'y', true)).length, 3);
  assert.equal(wireState({ from: 'p', to: 'q' }, 'y', true), 'faded'); assert.equal(wireState({ from: 'p', to: 'q' }, 'y', false), 'dim');
  assert.equal(none[0]!.type, 'smoothstep');
});

test('a node whose words did not change is the same node, so a search keystroke or a re-scan redraws nothing', async () => {
  const a = buildMap(await sampleSnapshot()), b = buildMap(await sampleSnapshot());
  assert.ok(a.nodes.every((n, i) => sameNode(n, b.nodes[i]!)));
  assert.equal(sameNode(a.nodes[1]!, { ...a.nodes[1]!, label: 'other' }), false); assert.equal(sameNode(a.nodes[1]!, { ...a.nodes[1]!, reasons: ['x'] }), false);
});

test('saved places: past the soft limit the places of removed things go first, then the oldest; new places are never refused', () => {
  const layout: Record<string, { x: number; y: number }> = {}; for (let i = 0; i < 10; i++) layout[`n${i}`] = { x: i, y: i };
  assert.equal(Object.keys(prunePlaces(layout, new Set(), 20, 20)).length, 10, 'under the limit nothing goes');
  assert.deepEqual(Object.keys(prunePlaces(layout, new Set(['n3', 'n7', 'n9']), 5, 20)), ['n3', 'n7', 'n9'], 'removed things go first');
  assert.deepEqual(Object.keys(prunePlaces(layout, new Set(Object.keys(layout)), 5, 4)), ['n6', 'n7', 'n8', 'n9'], 'then the oldest, and the newest stay');
});


test('the overview shows this computer and the folders, not what is inside them, until a folder is opened', async () => {
  const m = buildMap(await sampleSnapshot()), o = filterMap(m, { scope: 'overview', kinds: null, query: '' });
  assert.ok(o.nodes.every(n => OVERVIEW_KINDS.has(n.kind))); assert.ok(o.nodes.some(n => n.kind === 'project') && o.nodes.some(n => n.kind === 'machine')); assert.ok(o.nodes.length < m.nodes.length / 2);
  const proj = m.nodes.find(n => n.kind === 'project')!, open = filterMap(m, { scope: 'overview', kinds: null, query: '', open: new Set([proj.owner!]) });
  assert.ok(open.nodes.length > o.nodes.length); assert.ok(open.nodes.some(n => n.owner === proj.owner && n.kind === 'skill') || open.nodes.some(n => n.owner === proj.owner && n.kind === 'agent'));
  assert.ok(!open.nodes.some(n => n.owner !== null && n.owner !== proj.owner && !OVERVIEW_KINDS.has(n.kind)), 'only the opened folder is opened');
  assert.equal(filterMap(m, { scope: 'everything', kinds: null, query: '' }).nodes.length, m.nodes.length);
});

const bigList = (n: number, owner = '/p', group = 'team-a'): MapModel => ({
  nodes: [{ id: 'project:/p', kind: 'project', label: 'p', scope: 'project', description: 'd', status: null, reasons: [], link: null, owner }, { id: 'store:skill:s', kind: 'skill', label: 'S', scope: 'global', description: 'd', status: null, reasons: [], link: null, owner: null },
    ...Array.from({ length: n }, (_, i): MapModel['nodes'][number] => ({ id: `item:/p:skill:s${i}`, kind: 'skill', label: `S${i}`, scope: 'project', description: 'd', status: i === 2 ? 'held' : null, reasons: [], link: null, owner, group }))],
  edges: [...Array.from({ length: n }, (_, i) => ({ id: `project:/p>uses>item:/p:skill:s${i}`, from: 'project:/p', to: `item:/p:skill:s${i}`, rel: 'uses' as const })), { id: 'x', from: 'item:/p:skill:s0', to: 'store:skill:s', rel: 'comes-from' as const }, { id: 'y', from: 'item:/p:skill:s1', to: 'store:skill:s', rel: 'comes-from' as const }],
});

test('a long list is stacked per project and per team, the stack keeps its id and carries the worst status, and wires are joined', () => {
  const m = bigList(CLUSTER_MIN + 40), c = clusterMap(m);
  const stack = c.nodes.find(n => n.cluster !== undefined)!;
  assert.equal(stack.id, 'cluster:/p:skill:team-a'); assert.equal(stack.cluster!.count, CLUSTER_MIN + 40); assert.match(stack.label, /^47 skills from Team a$/); assert.equal(stack.status, 'held'); assert.match(stack.description, /Click to open the stack/);
  assert.equal(c.nodes.filter(n => n.kind === 'skill' && n.cluster === undefined && n.id.startsWith('item:')).length, 0, 'no loose item is left'); assert.equal(c.nodes.length, 3);
  assert.deepEqual(c.edges.map(e => `${e.from}>${e.rel}>${e.to}`).sort(), ['cluster:/p:skill:team-a>comes-from>store:skill:s', 'project:/p>uses>cluster:/p:skill:team-a']);
  assert.equal(clusterMap(m).nodes.find(n => n.cluster)!.id, stack.id, 'the same id each time, so its place is kept');
});

test('a short list is not stacked, an opened stack shows its members, and different teams stack apart', () => {
  assert.equal(clusterMap(bigList(CLUSTER_MIN - 1)).nodes.length, CLUSTER_MIN - 1 + 2);
  const big = bigList(CLUSTER_MIN + 3), open = clusterMap(big, new Set(['cluster:/p:skill:team-a']));
  assert.equal(open.nodes.length, big.nodes.length); assert.equal(open.edges.length, big.edges.length);
  const two = bigList(CLUSTER_MIN + 2); for (const [i, n] of two.nodes.entries()) if (i % 2 === 0 && n.id.startsWith('item:')) n.group = 'team-b';
  assert.ok(clusterMap(two, new Set(), 3).nodes.filter(n => n.cluster).length === 2);
  assert.equal(clusterMap({ nodes: [], edges: [] }).nodes.length, 0);
});

test('on a real-shaped map the long lists become a few stacks, so the count of nodes drawn falls', async () => {
  const s = clone(await sampleSnapshot()), p = s.projects[0]!;
  for (let i = 0; i < 30; i++) p.items.push({ kind: 'skill', id: `extra-${i}`, from: 'project', via: ['studio'], resolvedFrom: 'project', origin: 'yours', pin: null, hold: null, lock: 'same', note: null });
  const m = buildMap(s), c = clusterMap(m);
  assert.ok(c.nodes.length < m.nodes.length - 20); assert.ok(c.nodes.some(n => n.cluster && n.owner === p.key && /from Studio/.test(n.label)));
  const syn = syntheticMap(500); assert.ok(clusterMap({ nodes: syn.nodes, edges: syn.edges }).nodes.length <= 500);
});
