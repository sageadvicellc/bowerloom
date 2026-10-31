import test from 'node:test';
import assert from 'node:assert/strict';
import { NO_FILTER, colourSlot, filterGraph, neighbours, radiusOf, summary, topFolder, within } from '../shared/graphmodel.js';
import type { GraphNode, KnowledgeGraph } from '../shared/types.js';

const node = (id: string, extra: Partial<GraphNode> = {}): GraphNode => ({ id, title: id.replace(/\.md$/, ''), folder: id.includes('/') ? id.slice(0, id.lastIndexOf('/')) : '', tags: [], bytes: 10, degree: 0, inDegree: 0, orphan: false, big: false, ...extra });
const g: KnowledgeGraph = {
  nodes: [node('a.md', { tags: ['hub'] }), node('b/b.md'), node('b/c.md', { tags: ['hub'] }), node('d.md'), node('lone.md', { orphan: true })],
  edges: [{ from: 'a.md', to: 'b/b.md' }, { from: 'b/b.md', to: 'b/c.md' }, { from: 'b/c.md', to: 'd.md' }],
  folders: ['', 'b'], tags: ['hub'], broken: 0, notices: [], limits: { nodes: 5000, edges: 20000 },
};

test('filters by search, folder, tag and orphans, and drops edges whose end is hidden', () => {
  assert.equal(filterGraph(g, NO_FILTER).nodes.length, 5);
  assert.deepEqual(filterGraph(g, { ...NO_FILTER, search: 'HUB' }).nodes.map(n => n.id), ['a.md', 'b/c.md']);
  assert.deepEqual(filterGraph(g, { ...NO_FILTER, folder: 'b' }).edges, [{ from: 'b/b.md', to: 'b/c.md' }]);
  assert.deepEqual(filterGraph(g, { ...NO_FILTER, tag: 'hub' }).nodes.map(n => n.id), ['a.md', 'b/c.md']);
  assert.equal(filterGraph(g, { ...NO_FILTER, showOrphans: false }).nodes.some(n => n.id === 'lone.md'), false);
  assert.equal(filterGraph(g, { ...NO_FILTER, search: 'zzz' }).nodes.length, 0);
});

test('a local graph shows the pages within one or two links, both ways, and ignores a page that is not there', () => {
  assert.deepEqual([...within(g.edges, 'b/b.md', 1)].sort(), ['a.md', 'b/b.md', 'b/c.md']);
  assert.deepEqual(filterGraph(g, { ...NO_FILTER, local: { id: 'a.md', depth: 2 } }).nodes.map(n => n.id), ['a.md', 'b/b.md', 'b/c.md']);
  assert.equal(filterGraph(g, { ...NO_FILTER, local: { id: 'nope.md', depth: 1 } }).nodes.length, 5);
});

test('neighbours lists outgoing links and backlinks by title', () => {
  const n = neighbours(g, 'b/b.md');
  assert.deepEqual(n.out.map(x => x.id), ['b/c.md']); assert.deepEqual(n.back.map(x => x.id), ['a.md']);
});

test('colours are stable, sizes grow with links but stay bounded, folders and summaries read plainly', () => {
  assert.equal(colourSlot('notes', 8), colourSlot('notes', 8)); assert.ok(colourSlot('x', 8) >= 0 && colourSlot('x', 8) < 8);
  assert.ok(radiusOf(node('x', { degree: 100 })) > radiusOf(node('y', { degree: 1 }))); assert.ok(radiusOf(node('x', { degree: 1e6 })) <= 16);
  assert.equal(topFolder(node('a/b/c.md')), 'a'); assert.equal(topFolder(node('c.md')), '(top level)');
  assert.match(summary(g, filterGraph(g, NO_FILTER)), /^5 pages, 3 links, 1 with no links\.$/); assert.match(summary(g, filterGraph(g, { ...NO_FILTER, folder: 'b' })), /Showing 2 of 5 pages/);
});
