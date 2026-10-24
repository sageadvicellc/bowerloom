// The harness graph layout: columns by kind, wrapped so a big model is a wide even block and never one tall column.
import test from 'node:test';
import assert from 'node:assert/strict';
import { HARNESS_LAYOUT, layoutHarness, maxRowsFor, rowsFitting, nodeAt, pinnedPlace, snapPoint, syntheticHarness, wireSides } from '../shared/proto/harnesslayout.js';
import type { Positions } from '../shared/proto/harnesslayout.js';
import { buildHarnessMap, groupIdOf } from '../shared/proto/harnessmodel.js';
import type { HarnessMapModel, HarnessNodeKind } from '../shared/proto/harnessmodel.js';
import { CASE_IDS, generateWorld } from '../shared/proto/sample.js';

const world = generateWorld(1);
const LIBRARY = groupIdOf(CASE_IDS.newerLibrary);
const SIZES = [{ width: 1100, height: 700 }, { width: 700, height: 440 }, { width: 1440, height: 900 }] as const;
const { nodeWidth: W, nodeHeight: H } = HARNESS_LAYOUT;

/** Pairs of nodes whose boxes overlap, by id. */
function overlaps(p: Positions): string[] {
  const ids = Object.keys(p).sort((a, b) => p[a]!.x - p[b]!.x), found: string[] = [];
  for (let i = 0; i < ids.length; i += 1) {
    for (let j = i + 1; j < ids.length && p[ids[j]!]!.x < p[ids[i]!]!.x + W; j += 1) {
      const a = p[ids[i]!]!, b = p[ids[j]!]!;
      if (a.x < b.x + W && b.x < a.x + W && a.y < b.y + H && b.y < a.y + H) found.push(`${ids[i]} / ${ids[j]}`);
    }
  }
  return found;
}
/** The nodes in each column, by x. The root sits above the columns, so it is left out. */
const columnsOf = (p: Positions): Map<number, string[]> => { const m = new Map<number, string[]>(); for (const [id, pt] of Object.entries(p)) if (!id.startsWith('scope:')) m.set(pt.x, [...(m.get(pt.x) ?? []), id]); return m; };
const kindsOf = (m: HarnessMapModel): Map<string, HarnessNodeKind> => new Map(m.nodes.map(n => [n.id, n.kind]));
const view = (scopeId: string, expandedGroups: string[] = []) => ({ scopeId, showInherited: true, expandedGroups });

test('rowsFitting comes from the height: more height, more rows, within a floor and a ceiling', () => {
  assert.ok(rowsFitting(900) > rowsFitting(600)); assert.ok(rowsFitting(600) > rowsFitting(400));
  assert.equal(rowsFitting(0), HARNESS_LAYOUT.minRows); assert.equal(rowsFitting(-50), HARNESS_LAYOUT.minRows); assert.equal(rowsFitting(Number.NaN), HARNESS_LAYOUT.minRows);
  assert.equal(rowsFitting(1_000_000), HARNESS_LAYOUT.maxRowsLimit);
  for (const h of [500, 700, 900, 1400]) { const rows = rowsFitting(h); assert.ok(HARNESS_LAYOUT.nodeHeight * (rows + 1) + HARNESS_LAYOUT.rowGap * rows <= h + HARNESS_LAYOUT.nodeHeight + HARNESS_LAYOUT.rootGap, `${h}: ${rows} rows do not fit`); }
  assert.equal(maxRowsFor({ width: 1000, height: 900 }), rowsFitting(900), 'with no model the cap is the rows that fit the height');
});

test('maxRowsFor with a model: a bigger window gets taller columns for the same model, and the cap stays in range', () => {
  const m = syntheticHarness(500);
  const small = maxRowsFor({ width: 900, height: 560 }, m), big = maxRowsFor({ width: 1440, height: 850 }, m), tall = maxRowsFor({ width: 900, height: 1600 }, m);
  for (const r of [small, big, tall]) assert.ok(r >= HARNESS_LAYOUT.minRows && r <= HARNESS_LAYOUT.maxRowsLimit, String(r));
  assert.ok(tall > small, `a tall window allows more rows (${tall} against ${small})`);
  assert.ok(maxRowsFor({ width: 1440, height: 850 }, syntheticHarness(30)) <= big, 'a small model needs no more rows than a big one');
  assert.equal(maxRowsFor({ width: 1440, height: 850 }, m), big, 'the same input gives the same cap');
  assert.equal(maxRowsFor({ width: 0, height: 0 }, m) >= HARNESS_LAYOUT.minRows, true, 'a window with no size does not break it');
});

test('the sample world lays out with no overlap, for every scope, size, and an open library', () => {
  for (const scope of world.scopes) for (const expanded of [[], [LIBRARY]]) for (const size of SIZES) {
    const m = buildHarnessMap(world, view(scope.id, expanded)), p = layoutHarness(m, size);
    assert.equal(Object.keys(p).length, m.nodes.length);
    assert.deepEqual(overlaps(p), [], `${scope.id} ${expanded.length} ${size.height}`);
    for (const pt of Object.values(p)) { assert.ok(Number.isFinite(pt.x) && Number.isFinite(pt.y)); assert.ok(pt.x >= 0 && pt.y >= 0); }
  }
});

test('columns by kind: the root on top, then tools and slices, skills, agents, and interfaces on the right', () => {
  const m = buildHarnessMap(world, view('global')), p = layoutHarness(m, SIZES[0]), kinds = kindsOf(m);
  const xs = (k: HarnessNodeKind): number[] => m.nodes.filter(n => n.kind === k).map(n => p[n.id]!.x);
  const root = m.nodes.find(n => n.kind === 'scope')!;
  assert.equal(p[root.id]!.y, 0);
  for (const n of m.nodes) if (n.kind !== 'scope') assert.ok(p[n.id]!.y >= H, `${n.id} is below the root`);
  assert.ok(Math.max(...xs('skill')) < Math.min(...xs('agent')), 'skills are left of agents');
  assert.ok(Math.max(...xs('tool')) < Math.min(...xs('agent')), 'tools are left of agents');
  assert.ok(Math.max(...xs('context-slice')) < Math.min(...xs('agent')), 'slices are left of agents');
  assert.ok(Math.max(...xs('agent'), ...xs('group')) < Math.min(...xs('interface')), 'interfaces are right of agents');
  assert.equal(Math.min(...xs('group')), Math.min(...xs('agent')), 'the library group is in the agent band');
  assert.equal(p[LIBRARY]!.y, Math.min(...m.nodes.filter(n => kinds.get(n.id) === 'agent' || n.kind === 'group').map(n => p[n.id]!.y)), 'the group leads the agent band');
  // The root is centred over the whole graph.
  const right = Math.max(...Object.values(p).map(pt => pt.x)) + W;
  assert.ok(Math.abs(p[root.id]!.x + W / 2 - right / 2) <= 1);
});

test('wrapping: 500 nodes never make a column longer than maxRows, and the block is wide, not one tall column', () => {
  const m = syntheticHarness(500);
  assert.equal(m.nodes.length, 500);
  for (const size of SIZES) {
    const p = layoutHarness(m, size), rows = maxRowsFor(size, m), cols = columnsOf(p);
    assert.equal(Object.keys(p).length, 500);
    for (const [x, ids] of cols) assert.ok(ids.length <= rows, `column at ${x} holds ${ids.length}, more than ${rows}`);
    assert.deepEqual(overlaps(p), []);
    const ys = Object.values(p).map(pt => pt.y), top = Math.min(...ys), bottom = Math.max(...ys) + H;
    assert.ok(bottom - top <= H + HARNESS_LAYOUT.rootGap + rows * (H + HARNESS_LAYOUT.rowGap), `the block is ${bottom - top} tall`);
    assert.ok(cols.size >= 500 / rows / 2, `${cols.size} columns for ${rows} rows`);
    const left = Math.min(...Object.values(p).map(pt => pt.x)), right = Math.max(...Object.values(p).map(pt => pt.x)) + W;
    // The block has the shape of the window, within a factor of three: neither one tall column nor one flat strip.
    const shape = (right - left) / (bottom - top), want = size.width / size.height;
    assert.ok(shape > want / 3 && shape < want * 3, `the block is ${shape.toFixed(2)} wide for every 1 tall, the window ${want.toFixed(2)}`);
    assert.ok(cols.size >= 8, `${cols.size} columns`);
    assert.ok(rows < 500 / 4, `${rows} rows`);
  }
});

test('wrapping holds for lopsided models: one kind with 200 nodes still wraps', () => {
  const m = syntheticHarness(204); // 3 interfaces and a root, the rest cycle through the kinds
  const only = { ...m, nodes: m.nodes.filter(n => n.kind === 'scope' || n.kind === 'interface').concat(Array.from({ length: 200 }, (_, i) => ({ ...m.nodes[5]!, id: `skill-${i}`, kind: 'skill' as const }))), edges: [] };
  const p = layoutHarness(only, SIZES[0]), rows = maxRowsFor(SIZES[0], only);
  for (const ids of columnsOf(p).values()) assert.ok(ids.length <= rows);
  assert.equal(new Set(only.nodes.filter(n => n.kind === 'skill').map(n => p[n.id]!.x)).size, Math.ceil(200 / rows));
  assert.deepEqual(overlaps(p), []);
});

test('the layout is deterministic: the same model, size and pinned places give the same places, whichever copy of the model it is', () => {
  const m = buildHarnessMap(world, view('scope-copperfen', [LIBRARY]));
  const a = layoutHarness(m, SIZES[0]), b = layoutHarness(structuredClone(m), SIZES[0]), c = layoutHarness(m, SIZES[0]);
  assert.deepEqual(a, b); assert.deepEqual(a, c);
  assert.deepEqual(Object.keys(a), m.nodes.map(n => n.id), 'places come in model order');
  const pinned: Positions = { 'skill-010': { x: 5, y: 7 } };
  assert.deepEqual(layoutHarness(m, SIZES[0], pinned), layoutHarness(m, SIZES[0], pinned));
});

test('a pinned place is kept exactly, nothing else moves, and unusable pins are ignored', () => {
  const m = buildHarnessMap(world, view('global')), size = SIZES[0], free = layoutHarness(m, size);
  const pinned: Positions = { 'skill-010': { x: -123.5, y: 4567 }, 'agent-01': { x: 0, y: 0 }, 'not-in-the-model': { x: 1, y: 1 } };
  const p = layoutHarness(m, size, pinned);
  assert.deepEqual(p['skill-010'], { x: -123.5, y: 4567 }); assert.deepEqual(p['agent-01'], { x: 0, y: 0 });
  assert.equal('not-in-the-model' in p, false);
  for (const n of m.nodes) if (n.id !== 'skill-010' && n.id !== 'agent-01') assert.deepEqual(p[n.id], free[n.id], n.id);
  const bad = { 'skill-011': { x: Number.NaN, y: 1 }, 'skill-012': { x: 'a', y: 1 }, 'skill-013': null, 'skill-014': { x: Infinity, y: 0 }, constructor: { x: 1, y: 1 }, toString: { x: 1, y: 1 } } as unknown as Positions;
  assert.deepEqual(layoutHarness(m, size, bad), free);
  assert.equal(pinnedPlace(Object.create({ 'skill-010': { x: 1, y: 1 } }) as Positions, 'skill-010'), undefined, 'an inherited key is not a pin');
  assert.deepEqual(pinnedPlace({ a: { x: 1, y: 2 } }, 'a'), { x: 1, y: 2 });
  // The caller's object is not changed and is not shared with the result.
  const mine: Positions = { 'skill-010': { x: 9, y: 9 } }, out = layoutHarness(m, size, mine);
  out['skill-010']!.x = 100;
  assert.deepEqual(mine, { 'skill-010': { x: 9, y: 9 } });
});

test('a model with no root, no nodes, or one node still lays out', () => {
  assert.deepEqual(layoutHarness({ scopeId: 'x', nodes: [], edges: [] }, SIZES[0]), {});
  const one = syntheticHarness(1);
  assert.deepEqual(layoutHarness(one, SIZES[0]), { 'scope:synthetic': { x: 0, y: 0 } });
  const noRoot = { ...syntheticHarness(30), nodes: syntheticHarness(30).nodes.filter(n => n.kind !== 'scope') };
  const p = layoutHarness(noRoot, SIZES[0]);
  assert.equal(Object.keys(p).length, 29); assert.deepEqual(overlaps(p), []);
  assert.equal(Math.min(...Object.values(p).map(pt => pt.y)), 0);
});

test('speed: the model of the 700-page world, open and with 200 nodes, lays out in under 300 ms; so do 500 and 2000 made-up nodes', () => {
  const m = buildHarnessMap(world, view('global', [LIBRARY]));
  assert.ok(m.nodes.length > 150);
  layoutHarness(m, SIZES[0]); // warm up the code once
  for (const model of [m, syntheticHarness(500), syntheticHarness(2000)]) {
    const start = performance.now(); const p = layoutHarness(model, SIZES[0]); const took = performance.now() - start;
    assert.equal(Object.keys(p).length, model.nodes.length);
    assert.ok(took < 300, `${model.nodes.length} nodes took ${took.toFixed(1)} ms`);
  }
  const start = performance.now(); buildHarnessMap(world, view('global', [LIBRARY])); const built = performance.now() - start;
  assert.ok(built < 300, `building the model took ${built.toFixed(1)} ms`);
});

test('snapPoint rounds to the grid', () => {
  assert.deepEqual(snapPoint({ x: 13, y: 12 }), { x: 16, y: 16 }); assert.deepEqual(snapPoint({ x: 3, y: -5 }), { x: 0, y: -8 }); assert.deepEqual(snapPoint({ x: 10, y: 10 }, 5), { x: 10, y: 10 });
});

test('wire sides face each other: a target on the left is reached on its right edge, and the reverse', () => {
  assert.deepEqual(wireSides({ x: 500, y: 0 }, { x: 100, y: 50 }), { source: 'l', target: 'r' });
  assert.deepEqual(wireSides({ x: 100, y: 0 }, { x: 500, y: 50 }), { source: 'r', target: 'l' });
  assert.deepEqual(wireSides({ x: 100, y: 0 }, { x: 100, y: 200 }), { source: 'r', target: 'r' });
});

test('nodeAt finds the node a point is over, skips the dragged node, and says null over empty space', () => {
  const p: Positions = { a: { x: 0, y: 0 }, b: { x: 300, y: 0 }, c: { x: 0, y: 200 } };
  assert.equal(nodeAt(p, { x: W / 2, y: H / 2 }, 'x'), 'a');
  assert.equal(nodeAt(p, { x: W / 2, y: H / 2 }, 'a'), null, 'the dragged node is not its own target');
  assert.equal(nodeAt(p, { x: 300 + 5, y: H - 1 }, 'a'), 'b');
  assert.equal(nodeAt(p, { x: W + 20, y: 10 }, 'a'), null);
  assert.equal(nodeAt(p, { x: 10, y: 200 + H + 1 }, 'a'), null);
  const m = buildHarnessMap(world, view('global')), pos = layoutHarness(m, SIZES[0]);
  for (const n of m.nodes.slice(0, 40)) assert.equal(nodeAt(pos, { x: pos[n.id]!.x + W / 2, y: pos[n.id]!.y + H / 2 }, 'none'), n.id, 'every centre finds its own node, since none overlap');
});
