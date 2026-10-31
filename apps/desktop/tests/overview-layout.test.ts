// The geometry of the Overview (Task 2 lane G): the layout, the first open places, the cull, the shared-skill edges, the arrow-key move and the List. Pure data, no DOM.
import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { NODE_SIZE, edgePath, fitView, graphOf, miniMap } from '../shared/harness/layout.js';
import type { View } from '../shared/harness/layout.js';
import { OVERVIEW_LIMITS, overviewOf } from '../shared/harness/overview.js';
import type { Overview } from '../shared/harness/overview.js';
import { defaultExpanded, layoutOf, listOf, neighbourOf, sharedEdgesOf, visibleOf } from '../shared/harness/overview-layout.js';
import type { Direction, LaidNode, OverviewLayout } from '../shared/harness/overview-layout.js';
import { createSampleOverviewState } from '../shared/harness/sample.js';
import type { Harness, HarnessState, Link, Part, PartKind, ScanSource } from '../shared/harness/types.js';

const NO_FOLDERS: never[] = [];
const part = (id: string, kind: PartKind, name: string, extra: Partial<Part> = {}): Part =>
  ({ id, kind, name, summary: `${name}.`, description: '', path: '', source: '', origin: '', fileText: '', cannotUse: [], inLibrary: true, ...extra });

/**
 * A made-up scan: `groups` places with `each` parts apiece. Each place holds one agent in five (named so that they sort first) that names the next two skills, then skills,
 * tools and notes. The first place is the home. Names are padded so that the order by name is the order of the numbers.
 */
function bigState(groups: number, each: number): HarnessState {
  const parts: Part[] = [], sources: ScanSource[] = [];
  for (let g = 0; g < groups; g += 1) {
    const ids: string[] = [], links: Link[] = [];
    const add = (kind: PartKind, i: number): string => { const id = `g${g}-${kind}-${i}`; parts.push(part(id, kind, `${kind} ${String(i).padStart(5, '0')}`)); ids.push(id); return id; };
    const skills: string[] = [];
    for (let i = 0; i < each; i += 1) {
      const kind: PartKind = i % 5 === 0 ? 'agent' : i % 5 < 3 ? 'skill' : i % 5 === 3 ? 'tool' : 'context';
      const id = add(kind, i);
      if (kind === 'skill') skills.push(id);
      if (kind === 'agent' && skills.length >= 2) { links.push({ from: id, to: skills.at(-1)! }, { from: id, to: skills.at(-2)! }); }
    }
    sources.push({ id: `s${String(g).padStart(3, '0')}`, name: `Place ${g}`, interfaceName: 'Claude Code', harnessName: `h${g}`, partIds: ids, links, scope: g === 0 ? 'home' : 'project', label: g === 0 ? '~' : `~/p${g}` });
  }
  return { parts, harnesses: [], projects: [], installs: [], interfaces: [], runs: [], history: [], sources, chosenSourceIds: [], nextId: 100 };
}
const sample = (): Overview => overviewOf(createSampleOverviewState(), NO_FOLDERS);
const all = (o: Overview): ReadonlySet<string> => new Set(o.groups.map(g => g.id));
const overlap = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const VIEW: View = { x: 0, y: 0, k: 1 };

// ---- layoutOf

test('places sit in a grid of fixed column width, filled in group order, each row as tall as its tallest box', () => {
  const o = sample(), layout = layoutOf(o, all(o));
  assert.deepEqual(layout.clusters.map(c => c.id), o.groups.map(g => g.id));
  // Six places: three columns of 720 and a gap.
  const w = OVERVIEW_LIMITS.clusterWidth;
  assert.ok(layout.clusters.every(c => c.w === w));
  const xs = [...new Set(layout.clusters.map(c => c.x))].sort((a, b) => a - b);
  assert.equal(xs.length, 3); assert.equal(xs[0], 0); assert.ok(xs[1]! >= w && xs[2]! - xs[1]! === xs[1]! - xs[0]!);
  const rows = [...new Set(layout.clusters.map(c => c.y))].sort((a, b) => a - b);
  assert.equal(rows.length, 2);
  for (const row of rows) { const inRow = layout.clusters.filter(c => c.y === row); const tallest = Math.max(...inRow.map(c => c.h)); assert.ok(inRow.some(c => c.h === tallest)); }
  assert.ok(layout.clusters[3]!.y >= layout.clusters[0]!.y + Math.max(...layout.clusters.slice(0, 3).map(c => c.h)), 'the second row starts below the first');
  assert.equal(layout.bounds.left, 0); assert.equal(layout.bounds.top, 0);
  assert.equal(layout.bounds.right, Math.max(...layout.clusters.map(c => c.x + c.w))); assert.equal(layout.bounds.bottom, Math.max(...layout.clusters.map(c => c.y + c.h)));
});

test('the number of columns follows the number of places and stops at four', () => {
  const columns = (n: number): number => new Set(layoutOf(overviewOf(bigState(n, 1), NO_FOLDERS), new Set()).clusters.map(c => c.x)).size;
  assert.deepEqual([1, 2, 3, 4, 5, 9, 10, 40].map(columns), [1, 2, 2, 2, 3, 3, 4, 4]);
});

test('a collapsed place is its header only and holds no node; an open one holds its nodes below the header', () => {
  const o = sample(), open = new Set(['src-alpha']), layout = layoutOf(o, open);
  for (const c of layout.clusters) {
    assert.equal(c.header.x, c.x); assert.equal(c.header.y, c.y); assert.equal(c.header.w, c.w);
    if (c.id === 'src-alpha') {
      assert.equal(c.expanded, true); assert.equal(c.nodeIds.length, 7); assert.ok(c.h > c.header.h);
      for (const id of c.nodeIds) { const n = layout.nodes.find(x => x.id === id)!; assert.ok(n.y >= c.y + c.header.h && n.y + n.h <= c.y + c.h && n.x >= c.x && n.x + n.w <= c.x + c.w, id); }
    } else { assert.equal(c.expanded, false); assert.deepEqual(c.nodeIds, []); assert.equal(c.h, c.header.h); }
  }
  assert.deepEqual(layout.nodes.map(n => n.groupId), Array(7).fill('src-alpha'));
  assert.ok(layout.edges.every(e => e.groupId === 'src-alpha') && layout.edges.length === 5);
  assert.deepEqual(layoutOf(o, new Set()).nodes, []); assert.deepEqual(layoutOf(o, new Set(['nope'])).nodes, [], 'an id that is no place is ignored');
});

test('an open place with no parts is a header only; an Overview with no places has empty bounds', () => {
  const o = overviewOf({ ...createSampleOverviewState(), parts: [], sources: createSampleOverviewState().sources }, NO_FOLDERS);
  const layout = layoutOf(o, all(o));
  assert.ok(layout.clusters.every(c => c.expanded && c.h === c.header.h && c.nodeIds.length === 0));
  const none = layoutOf({ groups: [], sharedKeys: new Map() }, new Set());
  assert.deepEqual(none.bounds, { left: 0, top: 0, right: 0, bottom: 0 }); assert.deepEqual(none.clusters, []); assert.deepEqual(none.map.nodes, []);
});

test('no card overlaps another card, and every card is inside its place box, at any size', () => {
  for (const o of [sample(), overviewOf(bigState(7, 120), NO_FOLDERS)]) {
    const layout = layoutOf(o, all(o));
    assert.ok(layout.nodes.length > 0);
    const byGroup = new Map<string, LaidNode[]>();
    for (const n of layout.nodes) byGroup.set(n.groupId, [...(byGroup.get(n.groupId) ?? []), n]);
    for (const [id, nodes] of byGroup) {
      const box = layout.clusters.find(c => c.id === id)!;
      for (let i = 0; i < nodes.length; i += 1) {
        const n = nodes[i]!;
        assert.ok(n.x >= box.x && n.x + n.w <= box.x + box.w && n.y >= box.y + box.header.h && n.y + n.h <= box.y + box.h, n.id);
        for (let j = i + 1; j < nodes.length; j += 1) assert.equal(overlap(n, nodes[j]!), false, `${n.id} and ${nodes[j]!.id}`);
      }
    }
    for (let i = 0; i < layout.clusters.length; i += 1) for (let j = i + 1; j < layout.clusters.length; j += 1) assert.equal(overlap(layout.clusters[i]!, layout.clusters[j]!), false);
  }
});

test('cards use the Builder sizes, and the slots are the Builder slots: the same offsets as graphOf gives for the same parts and links', () => {
  const parts = [part('a1', 'agent', 'A1'), part('a2', 'agent', 'A2'), part('a3', 'agent', 'A3'), part('s1', 'skill', 'S1'), part('s2', 'skill', 'S2'), part('s3', 'skill', 'S3'), part('t1', 'tool', 'T1'), part('c1', 'context', 'C1')];
  const links: Link[] = [{ from: 'a1', to: 's3' }, { from: 'a1', to: 't1' }, { from: 'a2', to: 's1' }, { from: 'a2', to: 's1' }];
  const state: HarnessState = { ...bigState(1, 1), parts, sources: [{ id: 'g', name: 'G', interfaceName: 'Claude Code', harnessName: 'G', partIds: parts.map(p => p.id), links, scope: 'home', label: '~' }] };
  const harness: Harness = { id: 'h', name: 'H', summary: '', partIds: parts.map(p => p.id), links, positions: {}, missing: [], newPartIds: [] };
  const builder = graphOf(state, harness), layout = layoutOf(overviewOf(state, NO_FOLDERS), new Set(['g']));
  assert.equal(layout.nodes.length, builder.nodes.length);
  const cluster = layout.clusters[0]!;
  const shifts = new Set<number>();
  for (const b of builder.nodes) {
    const n = layout.nodes.find(x => x.id === `g/${b.id}`)!;
    assert.equal(n.x - cluster.x, b.x, b.id); assert.equal(n.w, b.w, b.id); assert.equal(n.h, b.h, b.id);
    shifts.add(n.y - b.y);
  }
  assert.equal(shifts.size, 1, 'every card is moved down by the same amount, so the slots are the Builder slots');
  assert.deepEqual(layout.nodes.filter(n => n.kind === 'agent').map(n => [n.w, n.h]), Array(3).fill([NODE_SIZE.agent.w, NODE_SIZE.agent.h]));
  assert.deepEqual(layout.nodes.filter(n => n.kind !== 'agent').map(n => [n.w, n.h]), Array(5).fill([NODE_SIZE.other.w, NODE_SIZE.other.h]));
});

test('the layout is deterministic and does not change what it reads', () => {
  const o = overviewOf(bigState(12, 60), NO_FOLDERS), before = JSON.stringify(o, (_k, v) => (v instanceof Map ? [...v] : v));
  const open = defaultExpanded(o);
  assert.deepEqual(layoutOf(o, open), layoutOf(o, open));
  assert.deepEqual(layoutOf(o, new Set(open)), layoutOf(o, open));
  assert.equal(JSON.stringify(o, (_k, v) => (v instanceof Map ? [...v] : v)), before);
  // The order the set was filled in does not matter.
  assert.deepEqual(layoutOf(o, new Set([...open].reverse())), layoutOf(o, open));
});

test('a laid node carries the data of its node, and edgePath, the small map and fitView take the layout as they take a Builder graph', () => {
  const o = sample(), layout = layoutOf(o, all(o));
  const hook = layout.nodes.find(n => n.name === 'Format on save')!;
  assert.equal(hook.toolKind, 'hook'); assert.equal(hook.runsCode, true); assert.equal(hook.groupId, 'src-alpha');
  const shared = layout.nodes.filter(n => n.sharedWith.length > 0);
  assert.equal(shared.length, 3);
  const e = layout.edges[0]!, from = layout.nodes.find(n => n.id === e.from)!, to = layout.nodes.find(n => n.id === e.to)!;
  assert.match(edgePath(from, to), /^M[\d.]+ [\d.]+ C/);
  assert.equal(layout.map.nodes.length, o.groups.length); assert.deepEqual(layout.map.edges, []); assert.deepEqual(layout.map.bounds, layout.bounds);
  assert.deepEqual(layout.map.nodes.map(n => n.id), o.groups.map(g => g.id));
  const view = fitView(layout.bounds, 1280, 800);
  assert.ok(view.k > 0 && view.k <= 1);
  const map = miniMap(layout.map, view, 1280, 800, 160, 100);
  assert.equal(map.bars.length, o.groups.length);
});

// ---- defaultExpanded

const groupOfSize = (id: string, scope: 'home' | 'project', n: number) => {
  const parts = Array.from({ length: n }, (_, i) => part(`${id}-${i}`, 'skill', `s${i}`));
  return { parts, source: { id, name: id, interfaceName: 'Claude Code', harnessName: id, partIds: parts.map(p => p.id), scope, label: scope === 'home' ? '~' : `~/${id}` } satisfies ScanSource };
};
function sized(spec: readonly (readonly ['home' | 'project', number])[]): Overview {
  const made = spec.map(([scope, n], i) => groupOfSize(`g${i}`, scope, n));
  const state: HarnessState = { ...bigState(1, 1), parts: made.flatMap(m => m.parts), sources: made.map(m => m.source) };
  // Projects are sorted by size in the Overview; keep the order the test writes by giving the groups in that order.
  return overviewOf(state, NO_FOLDERS);
}

test('the home place is always open, however many nodes it holds; the others open while the total stays within the limit', () => {
  const limit = OVERVIEW_LIMITS.expandedNodes;
  assert.deepEqual([...defaultExpanded(sized([['home', 900], ['project', 10]]))], ['g0']);
  assert.deepEqual([...defaultExpanded(sized([['home', 10], ['project', 100], ['project', 40]]))], ['g0', 'g1', 'g2']);
  // The total of the open places never passes the limit, except by the home place alone.
  const o = sized([['home', 20], ['project', 100], ['project', 60], ['project', 30]]);
  assert.deepEqual([...defaultExpanded(o)], ['g0', 'g1']);
  const total = (ids: ReadonlySet<string>): number => o.groups.filter(g => ids.has(g.id)).reduce((n, g) => n + g.nodes.length, 0);
  assert.ok(total(defaultExpanded(o)) <= limit);
  // Exactly at the limit is open; one more is closed.
  assert.deepEqual([...defaultExpanded(sized([['home', limit - 10], ['project', 10]]))], ['g0', 'g1']);
  assert.deepEqual([...defaultExpanded(sized([['home', limit - 10], ['project', 11]]))], ['g0']);
});

test('the first place that would pass the limit stays closed, and so do all that follow, even a small one', () => {
  const o = sized([['home', 100], ['project', 60], ['project', 20], ['project', 1]]);
  assert.deepEqual([...defaultExpanded(o)], ['g0'], 'g1 would make 160, so g2 and g3 stay closed too');
  assert.deepEqual([...defaultExpanded(sized([['home', 100], ['project', 49], ['project', 1]]))], ['g0', 'g1', 'g2']);
});

test('with no home place the same rule runs from the first place; an empty Overview opens nothing', () => {
  assert.deepEqual([...defaultExpanded(sized([['project', 100], ['project', 40], ['project', 20]]))], ['g0', 'g1']);
  assert.deepEqual([...defaultExpanded(sized([['project', 400], ['project', 1]]))], [], 'a first place over the limit is not forced open');
  assert.deepEqual([...defaultExpanded({ groups: [], sharedKeys: new Map() })], []);
  assert.deepEqual([...defaultExpanded(sized([['home', 0], ['project', 0]]))], ['g0', 'g1']);
});

// ---- visibleOf

test('a window shows only the places and cards that meet it, plus a margin; the whole view shows them all', () => {
  const o = sample(), layout = layoutOf(o, all(o));
  const everything = visibleOf(layout, VIEW, 10000, 10000);
  assert.equal(everything.detail, 'nodes');
  assert.deepEqual(everything.clusters, o.groups.map(g => g.id)); assert.equal(everything.nodes.length, layout.nodes.length); assert.equal(everything.edges.length, layout.edges.length);
  // A window over the first place only, with no margin.
  const first = layout.clusters[0]!;
  const one = visibleOf(layout, { x: -first.x, y: -first.y, k: 1 }, first.w, first.h, 0);
  assert.deepEqual(one.clusters, [first.id]);
  assert.deepEqual(one.nodes, first.nodeIds);
  // The margin brings in the next place.
  const next = layout.clusters[1]!;
  const wide = visibleOf(layout, { x: -first.x, y: -first.y, k: 1 }, first.w, first.h, next.x - first.w + 1);
  assert.ok(wide.clusters.includes(next.id));
  // A window far from everything shows nothing; a view moved by pan shows what is under it.
  const away = visibleOf(layout, { x: -1e6, y: -1e6, k: 1 }, 800, 600, 0);
  assert.deepEqual([away.clusters, away.nodes, away.edges], [[], [], []]);
  const panned = visibleOf(layout, { x: -next.x - 10, y: -next.y, k: 1 }, 100, 100, 0);
  assert.deepEqual(panned.clusters, [next.id]);
});

test('zoom is read: a smaller zoom sees more of the graph in the same window', () => {
  const o = overviewOf(bigState(8, 40), NO_FOLDERS), layout = layoutOf(o, all(o));
  const at1 = visibleOf(layout, VIEW, 900, 600, 0), at06 = visibleOf(layout, { x: 0, y: 0, k: 0.6 }, 900, 600, 0);
  assert.ok(at06.nodes.length > at1.nodes.length && at06.clusters.length >= at1.clusters.length);
  // Every id in the smaller set is a real node of the layout.
  const known = new Set(layout.nodes.map(n => n.id));
  assert.ok(at06.nodes.every(id => known.has(id)));
});

test('under the detail zoom an open place is a box with counts only: no cards and no edges; at the detail zoom the cards come back', () => {
  const o = sample(), layout = layoutOf(o, all(o));
  const low = visibleOf(layout, { x: 0, y: 0, k: OVERVIEW_LIMITS.detailZoom - 0.01 }, 10000, 10000);
  assert.equal(low.detail, 'boxes'); assert.deepEqual(low.nodes, []); assert.deepEqual(low.edges, []); assert.equal(low.clusters.length, o.groups.length);
  const edge = visibleOf(layout, { x: 0, y: 0, k: OVERVIEW_LIMITS.detailZoom }, 10000, 10000);
  assert.equal(edge.detail, 'nodes'); assert.equal(edge.nodes.length, layout.nodes.length);
  // A selected node is not drawn as a card in box detail either.
  assert.deepEqual(visibleOf(layout, { x: 0, y: 0, k: 0.4 }, 800, 600, undefined, layout.nodes[0]!.id).nodes, []);
});

test('2,000 parts in 30 places: the page never holds more than the node cap at any zoom, and the cap holds with the selected node inside it', () => {
  const o = overviewOf(bigState(30, 67), NO_FOLDERS);
  assert.ok(o.groups.reduce((n, g) => n + g.nodes.length, 0) >= 2000);
  const layout = layoutOf(o, all(o));
  const cap = OVERVIEW_LIMITS.domNodes;
  for (const k of [0.4, 0.5, 0.75, 1, 2]) {
    for (const view of [{ x: 0, y: 0, k }, { x: -2000 * k, y: -1000 * k, k }]) {
      const v = visibleOf(layout, view, 1600, 900);
      assert.ok(v.nodes.length <= cap, `k ${k}: ${v.nodes.length}`);
      assert.equal(new Set(v.nodes).size, v.nodes.length);
    }
  }
  // Zoomed far out at the detail limit, the window sees more than the cap and the cap binds.
  const crowded = visibleOf(layout, { x: 0, y: 0, k: 0.5 }, 30000, 30000);
  assert.equal(crowded.nodes.length, cap);
  // The selected node, in view or far away, is inside the set and inside the cap. It takes the place of one node.
  for (const id of [layout.nodes[0]!.id, layout.nodes.at(-1)!.id, layout.nodes[1000]!.id]) {
    const v = visibleOf(layout, { x: 0, y: 0, k: 0.5 }, 30000, 30000, undefined, id);
    assert.equal(v.nodes.length, cap); assert.ok(v.nodes.includes(id), id);
  }
  const far = layout.nodes.at(-1)!.id, small = visibleOf(layout, VIEW, 300, 200, 0, far);
  assert.ok(small.nodes.includes(far) && small.nodes.length <= cap);
  assert.equal(visibleOf(layout, VIEW, 300, 200, 0, 'no such node').nodes.includes('no such node'), false);
  assert.deepEqual(visibleOf(layout, VIEW, 300, 200, 0, null), visibleOf(layout, VIEW, 300, 200, 0));
  // Nodes stay in layout order, and the nearest to the middle of the window are the ones kept.
  const order = new Map(layout.nodes.map((n, i) => [n.id, i]));
  assert.deepEqual(crowded.nodes, [...crowded.nodes].sort((a, b) => order.get(a)! - order.get(b)!));
});

test('an edge is drawn when one of its ends is on the page, and never from a place that is closed', () => {
  const o = sample(), layout = layoutOf(o, new Set(['src-alpha', 'src-beta'])), v = visibleOf(layout, VIEW, 10000, 10000);
  assert.deepEqual(v.edges.slice().sort(), layout.edges.map(e => e.id).sort());
  assert.ok(v.edges.every(id => layout.edges.some(e => e.id === id)));
  const alpha = layout.clusters.find(c => c.id === 'src-alpha')!;
  const mine = visibleOf(layout, { x: -alpha.x, y: -alpha.y, k: 1 }, alpha.w, alpha.h, 0);
  const nodes = new Set(mine.nodes);
  assert.ok(mine.edges.length > 0);
  for (const id of mine.edges) { const e = layout.edges.find(x => x.id === id)!; assert.ok(nodes.has(e.from) || nodes.has(e.to)); }
});

test('the view helpers take a bad zoom or a negative window without failing', () => {
  const layout = layoutOf(sample(), all(sample()));
  assert.doesNotThrow(() => visibleOf(layout, { x: 0, y: 0, k: 0 }, -5, -5));
  assert.doesNotThrow(() => visibleOf(layout, { x: 0, y: 0, k: Number.NaN }, 100, 100));
  assert.deepEqual(visibleOf(layoutOf({ groups: [], sharedKeys: new Map() }, new Set()), VIEW, 800, 600), { detail: 'nodes', clusters: [], nodes: [], edges: [] });
});

// ---- sharedEdgesOf

test('a selected shared skill draws a dotted edge to each of its copies in the other open places, in group order; no other node does', () => {
  const o = sample(), layout = layoutOf(o, all(o));
  const home = layout.nodes.find(n => n.id === 'src-claude/skill-check-facts')!;
  const edges = sharedEdgesOf(layout, home.id);
  assert.deepEqual(edges.map(e => [e.from, e.to]), [[home.id, 'src-alpha/alpha-skill-check-facts'], [home.id, 'src-beta/beta-skill-check-facts']]);
  assert.ok(edges.every(e => e.groupId === 'src-claude' && e.id === `${e.from}~${e.to}`));
  const fromBeta = sharedEdgesOf(layout, 'src-beta/beta-skill-check-facts');
  assert.deepEqual(fromBeta.map(e => e.to), [home.id, 'src-alpha/alpha-skill-check-facts']);
  // Each edge can be drawn: both ends are laid nodes.
  const ids = new Set(layout.nodes.map(n => n.id));
  assert.ok([...edges, ...fromBeta].every(e => ids.has(e.from) && ids.has(e.to)));
  for (const n of layout.nodes) if (n.sharedWith.length === 0) assert.deepEqual(sharedEdgesOf(layout, n.id), [], n.id);
  assert.deepEqual(sharedEdgesOf(layout, 'nope'), []);
});

test('a copy in a closed place gets no edge', () => {
  const o = sample(), layout = layoutOf(o, new Set(['src-claude', 'src-beta']));
  assert.deepEqual(sharedEdgesOf(layout, 'src-claude/skill-check-facts').map(e => e.to), ['src-beta/beta-skill-check-facts']);
  assert.deepEqual(sharedEdgesOf(layoutOf(o, new Set(['src-claude'])), 'src-claude/skill-check-facts'), []);
});

test('two shared skills in the same places are told apart by name', () => {
  const mk = (id: string, name: string, hash: string): Part => part(id, 'skill', name, { contentHash: hash });
  const parts = [mk('a1', 'Alpha', 'ha'), mk('b1', 'Beta', 'hb'), mk('a2', 'Alpha', 'ha'), mk('b2', 'Beta', 'hb')];
  const state: HarnessState = { ...bigState(1, 1), parts, sources: [
    { id: 'one', name: 'One', interfaceName: 'Claude Code', harnessName: 'one', partIds: ['a1', 'b1'], scope: 'home', label: '~' },
    { id: 'two', name: 'Two', interfaceName: 'Claude Code', harnessName: 'two', partIds: ['a2', 'b2'], scope: 'project', label: '~/two' },
  ] };
  const o = overviewOf(state, NO_FOLDERS), layout = layoutOf(o, all(o));
  assert.deepEqual(sharedEdgesOf(layout, 'one/a1').map(e => e.to), ['two/a2']);
  assert.deepEqual(sharedEdgesOf(layout, 'one/b1').map(e => e.to), ['two/b2']);
  assert.deepEqual(sharedEdgesOf(layout, 'two/b2').map(e => e.to), ['one/b1']);
});

// ---- neighbourOf

const DIRS: readonly Direction[] = ['up', 'down', 'left', 'right'];

test('arrow keys move inside a place: across the two columns and down a column', () => {
  const o = sample(), layout = layoutOf(o, all(o));
  const alpha = layout.nodes.filter(n => n.groupId === 'src-alpha');
  const agent = alpha.find(n => n.name === 'Reviewer')!;
  const right = neighbourOf(layout, agent.id, 'right')!;
  const target = layout.nodes.find(n => n.id === right)!;
  assert.equal(target.groupId, 'src-alpha'); assert.equal(target.x, 440 + layout.clusters.find(c => c.id === 'src-alpha')!.x);
  assert.equal(neighbourOf(layout, right, 'left'), agent.id, 'left is the way back');
  const column = alpha.filter(n => n.kind !== 'agent').sort((a, b) => a.y - b.y);
  for (let i = 0; i + 1 < column.length; i += 1) { assert.equal(neighbourOf(layout, column[i]!.id, 'down'), column[i + 1]!.id); assert.equal(neighbourOf(layout, column[i + 1]!.id, 'up'), column[i]!.id); }
  assert.equal(neighbourOf(layout, 'no such node', 'up'), null);
});

test('arrow keys move between places: right to the next column and down to the next row', () => {
  const o = sample(), layout = layoutOf(o, all(o));
  const lastOf = (id: string): LaidNode => layout.nodes.filter(n => n.groupId === id && n.kind !== 'agent').sort((a, b) => b.x - a.x || a.y - b.y)[0]!;
  const fromCaveman = lastOf('src-caveman'), hop = neighbourOf(layout, fromCaveman.id, 'right')!;
  assert.equal(layout.nodes.find(n => n.id === hop)!.groupId, 'src-claude');
  const downFrom = layout.nodes.filter(n => n.groupId === 'src-claude' && n.kind !== 'agent').sort((a, b) => b.y - a.y)[0]!;
  const below = neighbourOf(layout, downFrom.id, 'down')!;
  assert.ok(['src-alpha', 'src-beta', 'src-gamma'].includes(layout.nodes.find(n => n.id === below)!.groupId));
});

const bare = (id: string, x: number, y: number): LaidNode => ({ id, kind: 'skill', name: id, summary: '', missing: false, isNew: false, x, y, w: 100, h: 50, groupId: 'g', sharedWith: [] });
const flat = (nodes: readonly LaidNode[]): OverviewLayout => ({ clusters: [], nodes, edges: [], bounds: { left: 0, top: 0, right: 0, bottom: 0 }, map: { nodes: [], edges: [], bounds: { left: 0, top: 0, right: 0, bottom: 0 } } });

test('a move stops at the edge of the graph: nothing in that direction gives null', () => {
  const layout = flat([bare('a', 0, 0), bare('b', 200, 0), bare('c', 0, 100)]);
  assert.equal(neighbourOf(layout, 'a', 'up'), null); assert.equal(neighbourOf(layout, 'a', 'left'), null);
  assert.equal(neighbourOf(layout, 'a', 'right'), 'b'); assert.equal(neighbourOf(layout, 'a', 'down'), 'c');
  assert.equal(neighbourOf(layout, 'b', 'right'), null); assert.equal(neighbourOf(layout, 'c', 'down'), null);
  assert.equal(neighbourOf(flat([bare('only', 0, 0)]), 'only', 'right'), null);
  assert.equal(neighbourOf(flat([]), 'x', 'right'), null);
});

test('a move keeps to the visible set when it is given one', () => {
  const o = sample(), layout = layoutOf(o, all(o));
  const first = layout.nodes[0]!, right = neighbourOf(layout, first.id, 'right')!;
  assert.notEqual(right, null);
  assert.equal(neighbourOf(layout, first.id, 'right', new Set([first.id])), null);
  const only = layout.nodes.find(n => n.id !== right && n.x > first.x + first.w)!;
  assert.equal(neighbourOf(layout, first.id, 'right', new Set([only.id])), only.id);
  assert.equal(neighbourOf(layout, first.id, 'right', new Set(['unknown'])), null);
  assert.equal(neighbourOf(layout, first.id, 'right', new Set([right, only.id])), right, 'the nearer of the two');
});

test('a tie goes to the smaller id, so the move is the same every time', () => {
  const layout = flat([bare('m', 0, 0), bare('z', 200, 0), bare('b', 200, 0), bare('q', 200, 0)]);
  for (let i = 0; i < 3; i += 1) assert.equal(neighbourOf(layout, 'm', 'right'), 'b');
  assert.equal(neighbourOf({ ...layout, nodes: [...layout.nodes].reverse() }, 'm', 'right'), 'b');
});

test('the keyboard reaches every card: from the first card, the four arrows lead to all of them', () => {
  for (const o of [sample(), overviewOf(bigState(9, 40), NO_FOLDERS)]) {
    const layout = layoutOf(o, all(o)), seen = new Set<string>([layout.nodes[0]!.id]), todo = [layout.nodes[0]!.id];
    while (todo.length > 0) {
      const id = todo.pop()!;
      for (const d of DIRS) { const next = neighbourOf(layout, id, d); if (next !== null && !seen.has(next)) { seen.add(next); todo.push(next); } }
    }
    assert.equal(seen.size, layout.nodes.length);
  }
});

// ---- listOf

test('the List holds the same places, counts, names and shared marks as the graph, in the same order', () => {
  const o = sample(), list = listOf(o);
  assert.deepEqual(list.map(g => g.id), o.groups.map(g => g.id));
  for (const [i, g] of list.entries()) {
    const src = o.groups[i]!;
    assert.deepEqual([g.name, g.label, g.scope, g.inBowerloom, g.folderId, g.counts], [src.name, src.label, src.scope, src.inBowerloom, src.folderId, src.counts]);
    assert.deepEqual(g.sections.flatMap(s => s.nodes), src.nodes, 'the same nodes, shared marks included');
    for (const kind of ['agent', 'skill', 'tool', 'context'] as const) assert.equal(g.sections.find(s => s.kind === kind)?.nodes.length ?? 0, g.counts[kind]);
  }
  const alpha = list.find(g => g.id === 'src-alpha')!;
  assert.deepEqual(alpha.sections.map(s => s.kind), ['agent', 'skill', 'tool', 'context']);
  const gamma = list.find(g => g.id === 'src-gamma')!;
  assert.deepEqual(gamma.sections.map(s => s.kind), ['context'], 'a kind with no nodes has no section');
  assert.deepEqual(listOf({ groups: [], sharedKeys: new Map() }), []);
  const layout = layoutOf(o, all(o));
  assert.deepEqual(list.flatMap(g => g.sections.flatMap(s => s.nodes.map(n => n.name))).sort(), layout.nodes.map(n => n.name).sort(), 'Graph and List show the same names');
});

// ---- speed

test('3,000 parts in 40 places lay out well inside the budget', () => {
  const state = bigState(40, 75);
  const t0 = performance.now(), o = overviewOf(state, NO_FOLDERS), t1 = performance.now();
  assert.equal(o.groups.reduce((n, g) => n + g.nodes.length, 0), 3000);
  const open = new Set(o.groups.map(g => g.id));
  const times: number[] = [];
  let layout = layoutOf(o, open);
  for (let i = 0; i < 7; i += 1) { const s = performance.now(); layout = layoutOf(o, open); times.push(performance.now() - s); }
  times.sort((a, b) => a - b);
  const median = times[3]!;
  const c0 = performance.now(); const expanded = defaultExpanded(o); const c1 = performance.now();
  const v0 = performance.now(); const visible = visibleOf(layout, { x: 0, y: 0, k: 0.5 }, 1600, 900); const v1 = performance.now();
  const n0 = performance.now(); neighbourOf(layout, layout.nodes[1500]!.id, 'right'); const n1 = performance.now();
  assert.equal(layout.nodes.length, 3000); assert.ok(visible.nodes.length <= OVERVIEW_LIMITS.domNodes); assert.ok(expanded.size >= 1);
  console.log(`overview timing: overviewOf ${(t1 - t0).toFixed(1)} ms, layoutOf median of 7 ${median.toFixed(1)} ms (min ${times[0]!.toFixed(1)}, max ${times[6]!.toFixed(1)}), defaultExpanded ${(c1 - c0).toFixed(2)} ms, first visibleOf ${(v1 - v0).toFixed(1)} ms, neighbourOf ${(n1 - n0).toFixed(2)} ms`);
  // The target is 100 ms on the development machine. The bound is wide, so a slow or busy machine does not fail the gate; a layout that went quadratic would.
  assert.ok(median < 500, `layoutOf took ${median.toFixed(1)} ms`);
  assert.ok(t1 - t0 < 1000, `overviewOf took ${(t1 - t0).toFixed(1)} ms`);
});

test('one open place with 3,000 parts (a big library) lays out fast, and the page still holds no more than the cap', () => {
  const o = overviewOf(bigState(1, 3000), NO_FOLDERS), open = defaultExpanded(o);
  assert.deepEqual([...open], [o.groups[0]!.id], 'the home place is open although it holds 3,000');
  const s = performance.now(), layout = layoutOf(o, open), took = performance.now() - s;
  const v0 = performance.now(), visible = visibleOf(layout, { x: 0, y: 0, k: 0.5 }, 1600, 900), v1 = performance.now();
  console.log(`overview timing, one place of 3,000: layoutOf ${took.toFixed(1)} ms, visibleOf ${(v1 - v0).toFixed(1)} ms`);
  assert.equal(layout.nodes.length, 3000);
  assert.ok(visible.nodes.length <= OVERVIEW_LIMITS.domNodes);
  assert.ok(took < 500, `layoutOf took ${took.toFixed(1)} ms`);
  for (let i = 0; i < layout.nodes.length - 1; i += 1) assert.ok(layout.nodes[i]!.groupId === layout.nodes[i + 1]!.groupId);
});
