// The words on the Knowledge graph: which labels fit, the shape of each domain, and the key under the graph.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { KnowledgeFlow } from '../renderer/proto/KnowledgeScreen.js';
import { LABEL_PX, NAMED_LIT, NAMED_TOP, linkRank, overlaps, placeLabels, withAlpha } from '../renderer/proto/knowledge-graph-view.js';
import type { Box } from '../renderer/proto/knowledge-graph-view.js';
import { DOMAIN_SHAPES, shapeOf, shapePath, traceShape } from '../renderer/proto/knowledge-shapes.js';
import { ProtoProvider, useProtoStore } from '../renderer/proto/session.js';
import { generateWorld } from '../shared/proto/sample.js';
import { createStore } from '../shared/proto/store.js';
import { DESKTOP } from './support.js';

const box = (x0: number, y0: number, x1: number, y1: number): Box => ({ x0, y0, x1, y1 });

test('two boxes overlap only when they share area; touching edges do not count', () => {
  assert.equal(overlaps(box(0, 0, 10, 10), box(5, 5, 15, 15)), true);
  assert.equal(overlaps(box(0, 0, 10, 10), box(10, 0, 20, 10)), false);
  assert.equal(overlaps(box(0, 0, 10, 10), box(0, 11, 10, 20)), false);
  assert.equal(overlaps(box(0, 0, 10, 10), box(2, 2, 4, 4)), true, 'one inside the other');
});

test('labels are placed in order of importance, and one that would cover an earlier one is dropped', () => {
  const placed = placeLabels([
    { key: 'hub A', spots: [box(0, 0, 100, 20)] },
    { key: 'hub B', spots: [box(50, 5, 150, 25)] },
    { key: 'hub C', spots: [box(200, 0, 300, 20)] },
  ]);
  assert.deepEqual(placed.map(p => p.key), ['hub A', 'hub C']);
  for (const a of placed) for (const b of placed) if (a !== b) assert.equal(overlaps(a.box, b.box), false);
});

test('a label with several places takes the first free one, above before below before beside', () => {
  const placed = placeLabels([
    { key: 'first', spots: [box(0, 0, 80, 18)] },
    { key: 'second', spots: [box(10, 0, 90, 18), box(10, 20, 90, 38), box(100, 0, 180, 18)] },
    { key: 'third', spots: [box(0, 10, 80, 28), box(0, 20, 80, 38), box(0, 40, 80, 58)] },
  ]);
  assert.deepEqual(placed.map(p => [p.key, p.box.y0]), [['first', 0], ['second', 20], ['third', 40]]);
});

test('a label that is off the picture is dropped, and no list at all gives no labels', () => {
  const inView = (b: Box): boolean => b.x1 > 0 && b.x0 < 100 && b.y1 > 0 && b.y0 < 100;
  assert.deepEqual(placeLabels([{ key: 'far', spots: [box(500, 500, 560, 520)] }, { key: 'near', spots: [box(10, 10, 60, 30)] }], inView).map(p => p.key), ['near']);
  assert.deepEqual(placeLabels([]), []);
  assert.deepEqual(placeLabels([{ key: 'none', spots: [] }]), []);
});

test('many labels in a small space never overlap, and the most important ones are the ones kept', () => {
  const want = Array.from({ length: 200 }, (_, i) => ({ key: i, spots: [box((i % 20) * 7, Math.floor(i / 20) * 5, (i % 20) * 7 + 60, Math.floor(i / 20) * 5 + 16)] }));
  const placed = placeLabels(want);
  assert.ok(placed.length > 0 && placed.length < 200);
  assert.equal(placed[0]!.key, 0, 'the first is always kept');
  for (let i = 0; i < placed.length; i += 1) for (let j = i + 1; j < placed.length; j += 1) assert.equal(overlaps(placed[i]!.box, placed[j]!.box), false);
});

test('words are never smaller than 12 pixels, and the named pages are 12 at most and 6 lit', () => {
  assert.ok(LABEL_PX >= 12); assert.equal(NAMED_TOP, 12); assert.equal(NAMED_LIT, 6);
});

test('a colour with an opacity is a canvas colour, and anything that is not a six digit colour is left as it is', () => {
  assert.equal(withAlpha('#1d2420', 0.4), 'rgba(29, 36, 32, 0.4)');
  assert.equal(withAlpha('#FFFFFF', 1), 'rgba(255, 255, 255, 1)');
  assert.equal(withAlpha('rebeccapurple', 0.5), 'rebeccapurple');
  assert.equal(withAlpha('', 0.5), '');
});

test('each of the eight domains has a shape of its own, so colour is not the only way to tell them apart', () => {
  assert.equal(DOMAIN_SHAPES.length, 8);
  assert.equal(new Set(DOMAIN_SHAPES.map(s => s.name)).size, 8);
  assert.equal(new Set(DOMAIN_SHAPES.map(s => shapePath(DOMAIN_SHAPES.indexOf(s)))).size, 8, 'eight different outlines');
  assert.equal(shapeOf(8).name, shapeOf(0).name, 'a ninth domain starts again');
  assert.equal(shapeOf(-1).name, shapeOf(7).name);
  for (const s of DOMAIN_SHAPES) for (const [x, y] of s.points) assert.ok(Math.hypot(x, y) <= 1.3, `${s.name} stays in its box`);
});

test('a shape is traced as a path: an arc for the circle, straight lines for the rest', () => {
  const calls: string[] = [];
  const ctx = { beginPath: () => calls.push('begin'), arc: () => calls.push('arc'), moveTo: () => calls.push('move'), lineTo: () => calls.push('line'), closePath: () => calls.push('close') };
  traceShape(ctx, 0, 0, 0, 5); assert.deepEqual(calls, ['begin', 'arc']);
  calls.length = 0; traceShape(ctx, 2, 0, 0, 5); assert.deepEqual(calls, ['begin', 'move', 'line', 'line', 'close']);
});

const drawKnowledge = (): string => {
  function Probe() { return createElement(KnowledgeFlow, { session: useProtoStore() }); }
  return renderToStaticMarkup(createElement(ProtoProvider, { store: createStore(generateWorld(1)) }, createElement(Probe)));
};

test('the key under the graph and the rule builder show each domain with its shape, and the screen starts with the title, the slice picker and one line', () => {
  const markup = drawKnowledge();
  assert.equal([...markup.matchAll(/class="kn-sw kn-sw-\d"[^>]*><svg/g)].length >= 8, true, 'a shape in the key for each domain');
  assert.match(markup, /<ul class="kn-legend small" aria-label="Key to the graph"><li><span class="kn-sw kn-sw-0" aria-hidden="true"><svg/);
  assert.ok(markup.indexOf('kn-lead') < markup.indexOf('kn-graph-section'), 'the explanation is above the graph');
  assert.match(markup, /700 pages in your wiki\. A slice is a saved choice of pages\./);
  assert.doesNotMatch(markup, /Pick one to see what an agent would get/, 'the intro is one short line');
  // The graph card has its tools in the heading row, not in a row of their own above the canvas.
  assert.match(markup, /<div class="kn-graph-head"><h2 id="kn-graph-h">Graph of your wiki<\/h2><div class="kn-toolbar"/);
  assert.match(markup, /class="kn-tip"[^>]*hidden/, 'the box that names the page under the pointer starts hidden');
});

test('the graph sizes itself from the height of the window, so it starts high and shows whole in a small window', () => {
  const css = readFileSync(join(DESKTOP, 'renderer', 'proto', 'knowledge-screen.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.match(css, /--kn-canvas-h: clamp\(18rem, calc\(100vh - 17rem\), 44rem\)/);
  assert.doesNotMatch(css, /opacity: 0\.55/, 'a disabled button is drawn by the shared prototype rule, not by a fade');
});

test('a link is drawn faint unless it touches the lit slice or the page under the pointer', () => {
  const lit = new Set(['a', 'b']);
  assert.equal(linkRank(lit, null, 'a', 'b'), 2, 'inside the slice');
  assert.equal(linkRank(lit, null, 'a', 'z'), 1, 'it leaves the slice');
  assert.equal(linkRank(lit, null, 'y', 'z'), 0, 'it touches nothing lit: faint');
  assert.equal(linkRank(new Set(), null, 'y', 'z'), 1, 'a new slice lights nothing, so no link is faded');
  assert.equal(linkRank(lit, 'z', 'y', 'z'), 3, 'a link of the page under the pointer is strongest');
  assert.equal(linkRank(lit, 'z', 'a', 'b'), 0, 'while a page is pointed at, even a link inside the slice that is not hers is faint');
  assert.equal(linkRank(lit, 'q', 'a', 'z'), 0);
});
