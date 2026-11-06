// The bento plan of a place (beta.2 overview): which tiles a place gets, how big each is, where each sits, and which parts a tile lists. Pure data, no DOM.
import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { BENTO, bentoColumns, bentoOf, itemsShown } from '../shared/harness/overview-bento.js';
import type { BentoPlan, BentoTile } from '../shared/harness/overview-bento.js';
import type { OverviewCounts } from '../shared/harness/overview.js';
import type { PartKind } from '../shared/harness/types.js';

const KINDS: readonly PartKind[] = ['agent', 'skill', 'tool', 'context'];
const counts = (agent = 0, skill = 0, tool = 0, context = 0): OverviewCounts => ({ agent, skill, tool, context });
const kinds = (plan: BentoPlan): PartKind[] => plan.tiles.map(t => t.kind);
const tile = (plan: BentoPlan, kind: PartKind): BentoTile => plan.tiles.find(t => t.kind === kind)!;

/** Checks the rules every plan keeps: tiles inside the columns, none over another, and no hole in the grid. */
function assertSound(plan: BentoPlan, label: string): void {
  const seen = new Map<string, PartKind>();
  for (const t of plan.tiles) {
    assert.ok(t.col >= 1 && t.row >= 1, `${label}: ${t.kind} starts on a line`);
    assert.ok(t.colSpan >= 1 && t.rowSpan >= 1, `${label}: ${t.kind} has a size`);
    assert.ok(t.col + t.colSpan - 1 <= plan.columns, `${label}: ${t.kind} stays inside ${plan.columns} columns`);
    assert.ok(t.row + t.rowSpan - 1 <= plan.rows, `${label}: ${t.kind} stays inside ${plan.rows} rows`);
    for (let r = t.row; r < t.row + t.rowSpan; r += 1) for (let c = t.col; c < t.col + t.colSpan; c += 1) {
      const key = `${r}:${c}`;
      assert.equal(seen.get(key), undefined, `${label}: ${t.kind} and ${seen.get(key)} share a cell`);
      seen.set(key, t.kind);
    }
  }
  assert.equal(seen.size, plan.tiles.length === 0 ? 0 : plan.rows * plan.columns, `${label}: no empty cell`);
}

test('the number of columns follows the width of the stage, and never rises as the stage narrows', () => {
  assert.equal(bentoColumns(1200), BENTO.maxColumns);
  assert.equal(bentoColumns(BENTO.wideStage), BENTO.maxColumns);
  assert.equal(bentoColumns(BENTO.wideStage - 1), 2);
  assert.equal(bentoColumns(BENTO.mediumStage), 2);
  assert.equal(bentoColumns(BENTO.mediumStage - 1), 1);
  assert.equal(bentoColumns(0), 1);
  assert.equal(bentoColumns(-50), 1);
  assert.equal(bentoColumns(Number.NaN), 1);
  let last = 1;
  for (let w = 0; w <= 2000; w += 10) { const c = bentoColumns(w); assert.ok(c >= last, `width ${w}`); last = c; }
});

test('an empty place gets no tile, and says every kind is absent', () => {
  for (const columns of [1, 2, 4]) {
    const plan = bentoOf(counts(), columns);
    assert.deepEqual(plan.tiles, []);
    assert.deepEqual(plan.absent, KINDS);
    assert.equal(plan.rows, 0);
    assert.equal(plan.columns, columns);
  }
});

test('a small place gets one small tile for each kind it holds, in the order agent, skill, tool, notes', () => {
  const plan = bentoOf(counts(1, 2, 0, 1), 4);
  assert.deepEqual(kinds(plan), ['agent', 'skill', 'context']);
  assert.deepEqual(plan.absent, ['tool']);
  assert.deepEqual(plan.tiles.map(t => t.size), ['small', 'small', 'small']);
  assertSound(plan, 'small');
  assert.equal(plan.rows, 1, 'three small tiles share one row of four');
});

test('a large place gives its large kinds the room, and keeps its little kinds small', () => {
  const plan = bentoOf(counts(40, 30, 6, 1), 4);
  assert.equal(tile(plan, 'agent').size, 'large');
  assert.equal(tile(plan, 'skill').size, 'large');
  assert.equal(tile(plan, 'tool').size, 'wide');
  assert.equal(tile(plan, 'context').size, 'small');
  assertSound(plan, 'large');
  const area = (t: BentoTile): number => t.colSpan * t.rowSpan;
  assert.ok(area(tile(plan, 'agent')) > area(tile(plan, 'context')), 'many agents take more room than little notes');
});

test('little context stays little: one set of notes beside many skills does not take a big tile', () => {
  const plan = bentoOf(counts(0, 50, 0, 1), 4);
  assertSound(plan, 'skills and notes');
  assert.equal(tile(plan, 'skill').size, 'large');
  assert.equal(tile(plan, 'context').size, 'small');
  assert.ok(tile(plan, 'skill').colSpan * tile(plan, 'skill').rowSpan >= tile(plan, 'context').colSpan * tile(plan, 'context').rowSpan);
});

test('a place with one kind fills the whole grid with it', () => {
  for (const columns of [1, 2, 4]) {
    const plan = bentoOf(counts(0, 0, 7, 0), columns);
    assert.deepEqual(kinds(plan), ['tool']);
    assertSound(plan, `one kind, ${columns} columns`);
    assert.equal(tile(plan, 'tool').colSpan, columns);
  }
});

test('every mix of counts, in 1, 2 and 4 columns, gives tiles that fit, do not overlap, leave no hole and keep the order of the kinds', () => {
  const samples = [0, 1, 3, 4, 11, 12, 100];
  let checked = 0;
  for (const a of samples) for (const s of samples) for (const t of samples) for (const c of samples) for (const columns of [1, 2, 4]) {
    const input = counts(a, s, t, c), plan = bentoOf(input, columns);
    const label = `${JSON.stringify(input)} in ${columns}`;
    assertSound(plan, label);
    assert.deepEqual(kinds(plan), KINDS.filter(k => input[k] > 0), `${label}: a tile for each kind held, in order`);
    assert.deepEqual([...kinds(plan), ...plan.absent].sort(), [...KINDS].sort(), `${label}: held and absent make all four kinds`);
    for (const x of plan.tiles) assert.equal(x.count, input[x.kind], `${label}: the count of ${x.kind}`);
    checked += 1;
  }
  assert.equal(checked, samples.length ** 4 * 3);
});

test('the same counts always give an equal plan, and the input is left alone', () => {
  const input = counts(5, 9, 2, 14), copy = { ...input };
  assert.deepEqual(bentoOf(input, 4), bentoOf({ ...input }, 4));
  assert.deepEqual(input, copy);
  assert.ok(Object.isFrozen(BENTO));
});

test('a kind with more parts never gets a smaller size than one with fewer', () => {
  const rank = { small: 0, wide: 1, large: 2 } as const;
  let last = 0;
  for (let n = 1; n <= 200; n += 1) {
    const size = rank[tile(bentoOf(counts(0, n, 0, 0), 4), 'skill').size];
    assert.ok(size >= last, `${n} skills`);
    last = size;
  }
  assert.equal(tile(bentoOf(counts(0, BENTO.wideAt - 1), 4), 'skill').size, 'small');
  assert.equal(tile(bentoOf(counts(0, BENTO.wideAt, 0, 0, ), 4), 'skill').size, 'wide');
  assert.equal(tile(bentoOf(counts(0, BENTO.largeAt), 4), 'skill').size, 'large');
});

test('a bad count (negative, fractional, not a number, infinite) is read as a whole number of at least zero', () => {
  const plan = bentoOf(counts(-3, Number.NaN, 2.9, Number.POSITIVE_INFINITY), 4);
  assert.deepEqual(kinds(plan), ['tool'], 'only the 2.9 tools count, as 2');
  assert.equal(tile(plan, 'tool').count, 2);
  assertSound(plan, 'bad counts');
  assert.deepEqual(bentoOf(counts(1), 0).columns, 1, 'no columns is one column');
  assert.equal(bentoOf(counts(1), 9).columns, BENTO.maxColumns, 'never more than the most');
});

test('a tile lists as many parts as fit its height and width, at least one, and a taller tile lists more', () => {
  const plan = bentoOf(counts(1, 1, 40, 200), 4);
  for (const t of plan.tiles) assert.ok(t.show >= 1, t.kind);
  const small = bentoOf(counts(0, 20), 1).tiles[0]!, large = bentoOf(counts(0, 20), 4).tiles[0]!;
  assert.ok(large.show > small.show, 'a wide, tall tile lists more than a narrow one');
  const tall = bentoOf(counts(0, 200), 1).tiles[0]!;
  assert.ok(tall.show >= small.show);
});

test('the plan of a very large workspace is quick and its tiles stay few', () => {
  const started = performance.now();
  let plan = bentoOf(counts(), 4);
  for (let i = 0; i < 2000; i += 1) plan = bentoOf(counts(10_000, 25_000, 10_000, 10_000), 4);
  assert.ok(performance.now() - started < 1000);
  assert.equal(plan.tiles.length, 4);
  assertSound(plan, 'huge');
});

const nodes = (n: number): { id: string }[] => Array.from({ length: n }, (_, i) => ({ id: `n${i}` }));

test('a tile lists the first parts up to its limit, and all of them when they fit', () => {
  assert.deepEqual(itemsShown(nodes(0), 3, null), []);
  assert.deepEqual(itemsShown(nodes(2), 3, null).map(n => n.id), ['n0', 'n1']);
  assert.deepEqual(itemsShown(nodes(3), 3, null).map(n => n.id), ['n0', 'n1', 'n2']);
  assert.deepEqual(itemsShown(nodes(9), 3, null).map(n => n.id), ['n0', 'n1', 'n2']);
  assert.deepEqual(itemsShown(nodes(9), 0, null).map(n => n.id), ['n0'], 'at least one');
});

test('a selected part past the limit is shown in the last place, so it is never out of sight', () => {
  const out = itemsShown(nodes(9), 3, 'n7');
  assert.deepEqual(out.map(n => n.id), ['n0', 'n1', 'n7']);
  assert.deepEqual(itemsShown(nodes(9), 3, 'n1').map(n => n.id), ['n0', 'n1', 'n2'], 'a selected part already shown changes nothing');
  assert.deepEqual(itemsShown(nodes(9), 3, 'other').map(n => n.id), ['n0', 'n1', 'n2'], 'a part this tile does not hold changes nothing');
  assert.deepEqual(itemsShown(nodes(9), 1, 'n5').map(n => n.id), ['n5']);
  assert.deepEqual(itemsShown(nodes(3), 3, 'n2').map(n => n.id), ['n0', 'n1', 'n2']);
});
