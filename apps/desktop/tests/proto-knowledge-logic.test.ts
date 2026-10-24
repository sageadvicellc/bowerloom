// The pure logic behind the Knowledge screen: the folder tree and its toggles, the preview numbers, the lasso geometry, and the screen's reducer.
import test from 'node:test';
import assert from 'node:assert/strict';
import { generateWorld } from '../shared/proto/sample.js';
import { countMatches, describeRule, matchPages } from '../shared/proto/slicerule.js';
import { buildFolderTree, facetCounts, folderState, pagesInFolder, pagesWithTag, setHops, toggleFolder, toggleTag, toggleType } from '../shared/proto/slice-tree.js';
import { badgeFor, buildPreview, estimateMapTokens, formatCount, memoMatch, tokenSentence } from '../shared/proto/slice-preview.js';
import { combinePicks, lassoMode, nearestNode, nodesInPolygon, pointInPolygon, polygonBounds, thinPath } from '../shared/proto/slice-lasso.js';
import { EMPTY_RULE, initialKnowledge, isDirty, reduceKnowledge, workingSlice } from '../shared/proto/knowledge-state.js';
import type { KnowledgeState } from '../shared/proto/knowledge-state.js';
import type { SliceRule, WikiPage } from '../shared/proto/types.js';

const world = generateWorld(1);
const pages = world.wikiPages;
const ctx = { pages };
const rule = (patch: Partial<SliceRule> = {}): SliceRule => ({ ...EMPTY_RULE, ...patch });

test('the folder tree has every domain folder with its subfolders, and a count that includes everything below', () => {
  const tree = buildFolderTree(pages);
  assert.equal(tree.length, 8);
  assert.equal(tree.reduce((n, d) => n + d.count, 0), 700);
  for (const d of tree) {
    assert.equal(d.children.reduce((n, c) => n + c.count, 0), d.count, d.folder);
    assert.ok(d.children.length >= 3);
    for (const c of d.children) assert.equal(c.count, pagesInFolder(pages, c.folder).length);
    assert.equal(d.count, pagesInFolder(pages, d.folder).length);
  }
  assert.deepEqual(tree.map(d => d.folder), [...tree.map(d => d.folder)].sort());
  assert.deepEqual(buildFolderTree([]), []);
});

test('type and tag checklists count the pages that carry each value', () => {
  const f = facetCounts(pages);
  assert.equal(f.types.reduce((n, t) => n + t.count, 0), 700);
  for (const t of f.tags) assert.equal(t.count, pagesWithTag(pages, t.value).length);
  assert.deepEqual(f.tags.map(t => t.value), [...f.tags.map(t => t.value)].sort());
});

test('folder state: on, under a chosen parent, partly chosen below, or off', () => {
  const tree = buildFolderTree(pages), d = tree[0]!, c = d.children[0]!, other = tree[1]!;
  assert.equal(folderState(rule(), d.folder), 'off');
  assert.equal(folderState(rule({ folders: [d.folder] }), d.folder), 'on');
  assert.equal(folderState(rule({ folders: [d.folder] }), c.folder), 'under');
  assert.equal(folderState(rule({ folders: [c.folder] }), d.folder), 'partial');
  assert.equal(folderState(rule({ folders: [c.folder] }), other.folder), 'off');
  assert.equal(folderState(rule({ folders: [`${d.folder}/`] }), d.folder), 'on', 'a trailing slash is the same folder');
});

test('toggling a folder adds it, drops the folders below it, and removes it again; a folder under a chosen parent cannot be toggled', () => {
  const d = buildFolderTree(pages)[0]!, a = d.children[0]!, b = d.children[1]!;
  const one = toggleFolder(rule({ folders: [a.folder, b.folder] }), d.folder);
  assert.deepEqual(one.folders, [d.folder], 'choosing the whole domain replaces its subfolders');
  assert.deepEqual(toggleFolder(one, d.folder).folders, []);
  assert.deepEqual(toggleFolder(one, a.folder), one, 'already included by the parent');
  assert.deepEqual(toggleFolder(rule(), a.folder).folders, [a.folder]);
  const r = rule({ folders: ['x'] }), before = JSON.stringify(r);
  toggleFolder(r, 'y'); assert.equal(JSON.stringify(r), before, 'the input rule is not changed');
});

test('toggling a type, a tag and the hops changes one handle and leaves the others', () => {
  let r = rule({ folders: ['a'] });
  r = toggleType(r, 'guide'); r = toggleTag(r, 'quartz'); r = toggleTag(r, 'cinder');
  assert.deepEqual(r.pageTypesAndTags, { types: ['guide'], tags: ['quartz', 'cinder'] }); assert.deepEqual(r.folders, ['a']);
  r = toggleTag(r, 'quartz'); assert.deepEqual(r.pageTypesAndTags.tags, ['cinder']);
  assert.deepEqual(setHops(r, 2).linksFromSeeds, { hops: 2 }); assert.equal(setHops(setHops(r, 2), 0).linksFromSeeds, null);
});

test('the preview numbers: count, rough tokens, pages joined since the last visit, links that leave, and the most linked outside pages', () => {
  const slice = world.slices[0]!;
  const lit = matchPages(slice.rule, slice.seeds, pages);
  const p = buildPreview(pages, lit);
  assert.equal(p.count, countMatches(slice.rule, slice.seeds, pages));
  assert.equal(p.tokens, pages.filter(x => lit.has(x.id)).reduce((n, x) => n + Math.ceil(x.bytes / 4), 0));
  assert.equal(p.joined, pages.filter(x => x.joinedSinceVisit && lit.has(x.id)).length); assert.equal(p.joined, 3);
  let cut = 0; const into = new Map<string, number>();
  for (const x of pages) if (lit.has(x.id)) for (const to of new Set(x.links)) if (to !== x.id && !lit.has(to)) { cut += 1; into.set(to, (into.get(to) ?? 0) + 1); }
  assert.equal(p.cutCount, cut); assert.equal(p.cut.length, cut);
  assert.ok(p.topOutside.length <= 5);
  assert.deepEqual(p.topOutside.map(o => o.links), [...p.topOutside.map(o => o.links)].sort((a, b) => b - a));
  for (const o of p.topOutside) { assert.equal(o.links, into.get(o.id)); assert.equal(lit.has(o.id), false); }
  const empty = buildPreview(pages, new Set());
  assert.deepEqual([empty.count, empty.tokens, empty.cutCount, empty.joined, empty.topOutside.length], [0, 0, 0, 0, 0]);
  assert.ok(estimateMapTokens(pages.filter(x => lit.has(x.id))) > 0);
});

test('memoMatch gives the very same set for the same rule, and the same answer as matchPages', () => {
  const slice = world.slices[2]!;
  const a = memoMatch(pages, slice.rule, slice.seeds), b = memoMatch(pages, JSON.parse(JSON.stringify(slice.rule)), [...slice.seeds]);
  assert.equal(a, b); assert.deepEqual([...a].sort(), [...matchPages(slice.rule, slice.seeds, pages)].sort());
  assert.notEqual(memoMatch(pages, rule({ folders: ['nowhere'] }), []), a);
});

test('the words for tokens and for each interface are plain', () => {
  assert.equal(formatCount(1234567), '1,234,567');
  assert.match(tokenSentence(12400), /^about 12,400 tokens\. This is a rough estimate\.$/);
  assert.match(tokenSentence(1), /^about 1 token\./);
  const blocks = badgeFor({ id: 'claude-code', installed: 'installed', notice: null, enforcement: 'blocks reads' });
  const advisory = badgeFor({ id: 'codex', installed: 'installed', notice: null, enforcement: 'advisory only' });
  assert.equal(blocks.label, 'Claude Code: blocks reads'); assert.equal(advisory.label, 'Codex: advisory only');
  assert.match(blocks.meaning, /cannot read/); assert.match(advisory.meaning, /nothing stops/);
  assert.equal(badgeFor({ id: 'opencode', installed: 'not-installed', notice: null, enforcement: 'advisory only' }).label, 'OpenCode: advisory only');
});

test('lasso geometry: modifier keys, bounds, point in polygon (a concave loop too), and the nodes inside', () => {
  assert.equal(lassoMode({ shiftKey: false, altKey: false }), 'replace'); assert.equal(lassoMode({ shiftKey: true, altKey: false }), 'add');
  assert.equal(lassoMode({ shiftKey: false, altKey: true }), 'remove'); assert.equal(lassoMode({ shiftKey: true, altKey: true }), 'remove');
  const square = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
  assert.deepEqual(polygonBounds(square), { minX: 0, minY: 0, maxX: 10, maxY: 10 }); assert.equal(polygonBounds([]), null);
  assert.equal(pointInPolygon({ x: 5, y: 5 }, square), true); assert.equal(pointInPolygon({ x: 11, y: 5 }, square), false); assert.equal(pointInPolygon({ x: 5, y: -1 }, square), false);
  const u = [{ x: 0, y: 0 }, { x: 9, y: 0 }, { x: 9, y: 9 }, { x: 6, y: 9 }, { x: 6, y: 3 }, { x: 3, y: 3 }, { x: 3, y: 9 }, { x: 0, y: 9 }];
  assert.equal(pointInPolygon({ x: 1, y: 8 }, u), true); assert.equal(pointInPolygon({ x: 4.5, y: 8 }, u), false, 'inside the dent');
  assert.equal(pointInPolygon({ x: 5, y: 5 }, [{ x: 0, y: 0 }, { x: 1, y: 1 }]), false, 'fewer than three points is no loop');
  const nodes = [{ id: 'a', x: 5, y: 5 }, { id: 'b', x: 20, y: 5 }, { id: 'c', x: 1, y: 1 }, { id: 'd' }, { id: 'e', x: Number.NaN, y: 2 }] as { id: string; x?: number; y?: number }[];
  assert.deepEqual(nodesInPolygon(nodes, square), ['a', 'c']);
  assert.deepEqual(nodesInPolygon(nodes, []), []);
  assert.equal(nearestNode(nodes, { x: 5.5, y: 5 }, 2), 'a'); assert.equal(nearestNode(nodes, { x: 50, y: 50 }, 2), null);
});

test('thinPath keeps a point only when it moved far enough, so a long drag stays small', () => {
  const path = [{ x: 0, y: 0 }];
  for (let i = 1; i <= 1000; i += 1) thinPath(path, { x: i * 0.5, y: 0 }, 4);
  assert.ok(path.length > 100 && path.length < 150, `${path.length}`);
  const same = [{ x: 1, y: 1 }]; thinPath(same, { x: 1.5, y: 1 }, 4); assert.equal(same.length, 1);
});

test('combining picks: replace, add, and remove, each without repeats and in a stable order', () => {
  assert.deepEqual(combinePicks(['a', 'b'], ['c', 'a'], 'replace'), ['c', 'a']);
  assert.deepEqual(combinePicks(['a', 'b'], ['c', 'a'], 'add'), ['a', 'b', 'c']);
  assert.deepEqual(combinePicks(['a', 'b', 'c'], ['b', 'x'], 'remove'), ['a', 'c']);
  assert.deepEqual(combinePicks([], [], 'add'), []);
});

// ---- The reducer ----
const start = (): KnowledgeState => initialKnowledge(world.slices);
const act = (s: KnowledgeState, ...actions: Parameters<typeof reduceKnowledge>[1][]): KnowledgeState => actions.reduce((state, a) => reduceKnowledge(state, a, ctx), s);

test('the screen starts on the first slice with its rule, in the graph way, with no lasso', () => {
  const s = start(), first = world.slices[0]!;
  assert.equal(s.chosenId, first.id); assert.deepEqual(s.rule, first.rule); assert.deepEqual(s.seeds, first.seeds); assert.equal(s.way, 'graph'); assert.equal(s.lasso, false);
  assert.equal(isDirty(s, first), false);
  const empty = initialKnowledge([]);
  assert.equal(empty.chosenId, null); assert.deepEqual(empty.rule, EMPTY_RULE);
});

test('choosing a slice loads its rule and seeds; making a new one starts empty with a name to fill in', () => {
  const second = world.slices[1]!;
  let s = act(start(), { type: 'choose', slice: second });
  assert.equal(s.chosenId, second.id); assert.deepEqual(s.rule, second.rule);
  s = act(s, { type: 'newSlice' });
  assert.equal(s.chosenId, null); assert.deepEqual(s.rule, EMPTY_RULE); assert.deepEqual(s.seeds, []); assert.equal(s.name, '');
  s = act(s, { type: 'rename', name: 'Reading pile' });
  assert.equal(s.name, 'Reading pile'); assert.equal(workingSlice(s).name, 'Reading pile');
});

test('the rule builder: each change updates the rule at once, and a change by hand ends the pick', () => {
  const d = buildFolderTree(pages)[0]!;
  let s = act(start(), { type: 'newSlice' }, { type: 'way', way: 'rule' }, { type: 'toggleFolder', folder: d.folder });
  assert.deepEqual(s.rule.folders, [d.folder]);
  assert.equal(countMatches(s.rule, s.seeds, pages), d.count);
  s = act(s, { type: 'toggleTag', tag: 'quartz' }, { type: 'toggleType', value: 'guide' }, { type: 'hops', hops: 1 });
  assert.deepEqual(s.rule.pageTypesAndTags, { types: ['guide'], tags: ['quartz'] }); assert.deepEqual(s.rule.linksFromSeeds, { hops: 1 });
  s = act(s, { type: 'toggleFolder', folder: d.folder });
  assert.deepEqual(s.rule.folders, []);
});

test('the graph way: a loop replaces the picks, Shift adds, Alt removes, and the rule is inferred from the picks each time', () => {
  const d = buildFolderTree(pages)[0]!, inD = pagesInFolder(pages, d.folder);
  let s = act(start(), { type: 'newSlice' }, { type: 'lassoResult', ids: inD.slice(0, Math.ceil(inD.length * 0.8)), mode: 'replace' });
  assert.deepEqual(s.rule.folders, [d.folder]); assert.equal(s.picks.length, Math.ceil(inD.length * 0.8));
  s = act(s, { type: 'lassoResult', ids: [pages.find(p => !p.folder.startsWith(d.folder))!.id], mode: 'add' });
  assert.equal(s.seeds.length, 1); assert.deepEqual(s.rule.folders, [d.folder]);
  s = act(s, { type: 'lassoResult', ids: s.seeds, mode: 'remove' });
  assert.equal(s.seeds.length, 0);
  s = act(s, { type: 'lassoResult', ids: inD.slice(0, 2), mode: 'replace' });
  assert.equal(s.picks.length, 2); assert.deepEqual(s.rule.folders, []);
  s = act(s, { type: 'clearPicks' });
  assert.deepEqual(s.rule, EMPTY_RULE); assert.deepEqual(s.picks, []);
});

test('the graph way: links are a separate choice, and an offered tag is applied only when accepted', () => {
  const inD = pagesInFolder(pages, buildFolderTree(pages)[0]!.folder);
  let s = act(start(), { type: 'newSlice' }, { type: 'lassoResult', ids: inD.slice(0, 3), mode: 'replace' }, { type: 'hops', hops: 2 });
  assert.deepEqual(s.rule.linksFromSeeds, { hops: 2 }); assert.equal(s.seeds.length, 3);
  s = act(s, { type: 'hops', hops: 0 }); assert.equal(s.rule.linksFromSeeds, null);
  const tag = 'quartz', withTag = pagesWithTag(pages, tag);
  s = act(s, { type: 'lassoResult', ids: withTag.slice(0, 4), mode: 'replace' });
  assert.deepEqual(s.rule.pageTypesAndTags.tags, []);
  s = act(s, { type: 'acceptOffer', handle: { kind: 'tag', value: tag } });
  assert.deepEqual(s.rule.pageTypesAndTags.tags, [tag]);
  s = act(s, { type: 'dropOffer', handle: { kind: 'tag', value: tag } });
  assert.deepEqual(s.rule.pageTypesAndTags.tags, []);
});

test('the keyboard path: pick a page, pick the pages in its folder, pick the pages with its tag, with no pointer', () => {
  const p = pages.find(x => x.tags.length > 0)!;
  let s = act(start(), { type: 'newSlice' }, { type: 'togglePick', id: p.id });
  assert.deepEqual(s.picks, [p.id]); assert.deepEqual(s.seeds, [p.id]);
  s = act(s, { type: 'togglePick', id: p.id }); assert.deepEqual(s.picks, []);
  s = act(s, { type: 'pickFolder', folder: p.folder });
  assert.equal(s.picks.length, pagesInFolder(pages, p.folder).length); assert.deepEqual(s.rule.folders, [p.folder]);
  s = act(s, { type: 'clearPicks' }, { type: 'pickTag', tag: p.tags[0]! });
  assert.equal(s.picks.length, pagesWithTag(pages, p.tags[0]!).length); assert.deepEqual(s.rule.pageTypesAndTags.tags, [p.tags[0]]);
  assert.equal(describeRule(s.rule, pages).includes('tag'), true);
});

test('in the rule way a pick is a seed; removing a seed and clearing seeds work; a focus page is kept', () => {
  const [a, b] = [pages[0]!.id, pages[1]!.id];
  let s = act(start(), { type: 'newSlice' }, { type: 'way', way: 'rule' }, { type: 'togglePick', id: a }, { type: 'togglePick', id: b });
  assert.deepEqual(s.seeds, [a, b]);
  s = act(s, { type: 'removeSeed', id: a }); assert.deepEqual(s.seeds, [b]);
  s = act(s, { type: 'clearSeeds' }); assert.deepEqual(s.seeds, []);
  s = act(s, { type: 'focusPage', id: b }); assert.equal(s.focusPage, b);
});

test('lasso mode and reset: the lasso switches on and off; reset puts back the saved slice', () => {
  const first = world.slices[0]!;
  let s = act(start(), { type: 'lasso', on: true }); assert.equal(s.lasso, true);
  s = act(s, { type: 'toggleTag', tag: 'quartz' }); assert.equal(isDirty(s, first), true);
  s = act(s, { type: 'reset', slice: first });
  assert.deepEqual(s.rule, first.rule); assert.equal(isDirty(s, first), false); assert.equal(s.lasso, true, 'reset does not change the mode');
  const fresh = act(s, { type: 'newSlice' });
  assert.equal(isDirty(fresh, null), false, 'a new slice with nothing in it has nothing to save');
  assert.equal(isDirty(act(fresh, { type: 'toggleTag', tag: 'quartz' }), null), true, 'a new slice with a rule is unsaved');
  assert.equal(isDirty(act(fresh, { type: 'rename', name: 'Notes' }), null), true);
});

test('the reducer never changes its input state or rule', () => {
  const s = start(), before = JSON.stringify(s);
  act(s, { type: 'toggleTag', tag: 'x' }, { type: 'toggleFolder', folder: 'y' }, { type: 'hops', hops: 1 }, { type: 'lassoResult', ids: [pages[0]!.id], mode: 'add' });
  assert.equal(JSON.stringify(s), before);
});
