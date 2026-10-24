// Inferring a slice rule from picked pages (spec 6.9, "Pick on the graph"): folder handle, tag or type handle, leftover seeds, links as a separate choice.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRng } from '../shared/proto/rng.js';
import { generateWorld } from '../shared/proto/sample.js';
import { describeRule, matchPages } from '../shared/proto/slicerule.js';
import { COVER_SHARE, explainInference, inferRule } from '../shared/proto/slice-infer.js';
import type { WikiPage } from '../shared/proto/types.js';

const page = (id: string, folder: string, type = 'note', tags: string[] = [], links: string[] = []): WikiPage =>
  ({ id, title: `Title ${id}`, folder, type, tags, summary: '', bytes: 400, links, joinedSinceVisit: false });
const many = (prefix: string, folder: string, n: number, type = 'note', tags: string[] = []): WikiPage[] => Array.from({ length: n }, (_, i) => page(`${prefix}${i + 1}`, folder, type, tags));
const idsOf = (pages: readonly WikiPage[]): string[] => pages.map(p => p.id);

// Folder "north" has 10 pages (two subfolders of 5), "south" has 10 pages, and "east" has 4. Tag "red" is on 5 pages, type "log" on 4.
const PAGES: WikiPage[] = [...many('n', 'north/a', 5), ...many('m', 'north/b', 5), ...many('s', 'south/a', 10), ...many('e', 'east', 4)];
const WITH_TAGS: WikiPage[] = [...PAGES.slice(0, 20).map((p, i) => (i % 4 === 0 ? { ...p, tags: ['red'] } : p)), ...PAGES.slice(20)];

test('nothing picked gives the empty rule, with no folder, no tag and no leftover', () => {
  const r = inferRule([], PAGES);
  assert.deepEqual(r.rule, { folders: [], pageTypesAndTags: { types: [], tags: [] }, linksFromSeeds: null });
  assert.deepEqual(r.seeds, []); assert.deepEqual(r.offers, []);
  assert.equal(describeRule(r.rule, PAGES), 'Only the pages you pick by hand are in this slice.');
  assert.equal(inferRule(['nope', 'nada'], PAGES).seeds.length, 0, 'ids that are not pages are ignored');
});

test('a pick that covers most of a folder uses the folder handle, and the folder brings its other pages along', () => {
  const picked = ['n1', 'n2', 'n3', 'n4', 'm1', 'm2', 'm3', 'm4', 'm5', 's1'];   // 9 of the 10 pages in north, plus one page of south
  const r = inferRule(picked, PAGES);
  assert.deepEqual(r.rule.folders, ['north']);
  assert.deepEqual(r.seeds, ['s1'], 'the page outside any handle stays a seed');
  assert.equal(matchPages(r.rule, r.seeds, PAGES).size, 11);
  assert.match(describeRule(r.rule, PAGES), /^Everything in the north folder \(10 pages\)\.$/);
});

test('when the parent folder is not covered but a subfolder is, the subfolder is the handle', () => {
  const r = inferRule(['n1', 'n2', 'n3', 'n4', 'n5'], PAGES);
  assert.deepEqual(r.rule.folders, ['north/a']);
  assert.deepEqual(r.seeds, []);
  assert.match(describeRule(r.rule, PAGES), /the a folder inside north \(5 pages\)/);
});

test('a folder is used only when at least the cover share of its pages is picked, and at least two pages are picked', () => {
  const enough = Math.ceil(COVER_SHARE * 10), few = enough - 1;
  assert.deepEqual(inferRule(idsOf(PAGES.filter(p => p.folder === 'south/a')).slice(0, enough), PAGES).rule.folders, ['south']);
  const below = inferRule(idsOf(PAGES.filter(p => p.folder === 'south/a')).slice(0, few), PAGES);
  assert.deepEqual(below.rule.folders, []); assert.equal(below.seeds.length, few, 'too few for a handle: they stay seeds');
  assert.deepEqual(inferRule(['e1'], PAGES).rule.folders, [], 'one page is never a folder');
  assert.deepEqual(inferRule(['e1', 'e2', 'e3'], PAGES).rule.folders, ['east']);
});

test('a tag that the pick covers most of is used as the tag handle, and the picked pages that carry it are no longer seeds', () => {
  const red = idsOf(WITH_TAGS.filter(p => p.tags.includes('red')));   // all 5 pages with the tag, spread over two folders
  assert.equal(red.length, 5);
  const r = inferRule(red, WITH_TAGS);
  assert.deepEqual(r.rule.pageTypesAndTags, { types: [], tags: ['red'] });
  assert.deepEqual(r.seeds, []); assert.deepEqual(r.rule.folders, []);
  assert.match(describeRule(r.rule, WITH_TAGS), /pages with the tag red/);
});

test('a page type works the same way as a tag', () => {
  const typed = PAGES.map(p => (p.id.startsWith('e') ? { ...p, type: 'log' } : p));
  const r = inferRule(['e1', 'e2', 'e3', 'e4'], typed);
  assert.deepEqual(r.rule.folders, ['east'], 'folders are looked at first');
  const spread = typed.map(p => (['n1', 's1', 's2', 'e1'].includes(p.id) ? { ...p, type: 'rare' } : p));
  const t = inferRule(['n1', 's1', 's2', 'e1'], spread);
  assert.deepEqual(t.rule.pageTypesAndTags.types, ['rare']); assert.deepEqual(t.seeds, []); assert.deepEqual(t.rule.folders, []);
});

test('a tag that dominates the pick but covers little of its pages is offered, not applied', () => {
  const crowd = [...many('x', 'wide', 30, 'note', ['common']), ...many('y', 'other', 3)];
  const r = inferRule(['x1', 'x2', 'x3', 'x4'], crowd);
  assert.deepEqual(r.rule.pageTypesAndTags.tags, [], 'four of thirty is not most of the tag');
  assert.deepEqual(r.seeds, ['x1', 'x2', 'x3', 'x4']);
  assert.equal(r.offers.length, 1); assert.deepEqual(r.offers[0], { kind: 'tag', value: 'common', picked: 4, total: 30 });
  const accepted = inferRule(['x1', 'x2', 'x3', 'x4'], crowd, { accept: [{ kind: 'tag', value: 'common' }] });
  assert.deepEqual(accepted.rule.pageTypesAndTags.tags, ['common']); assert.deepEqual(accepted.seeds, []); assert.deepEqual(accepted.offers, []);
  assert.equal(matchPages(accepted.rule, accepted.seeds, crowd).size, 30);
});

test('links are a separate choice: with hops set, every picked page is a seed so the walk starts from all of them', () => {
  const picked = ['n1', 'n2', 'n3', 'n4', 'm1', 'm2', 'm3', 'm4', 'm5', 's1'];
  const none = inferRule(picked, PAGES, { hops: 0 }), one = inferRule(picked, PAGES, { hops: 1 }), two = inferRule(picked, PAGES, { hops: 2 });
  assert.equal(none.rule.linksFromSeeds, null); assert.deepEqual(one.rule.linksFromSeeds, { hops: 1 }); assert.deepEqual(two.rule.linksFromSeeds, { hops: 2 });
  assert.deepEqual(one.rule.folders, ['north']);
  assert.deepEqual([...one.seeds].sort(), [...picked].sort());
  assert.deepEqual(inferRule(picked, PAGES).rule.linksFromSeeds, null, 'the default is no links');
  assert.match(describeRule(one.rule, PAGES), /the pages that your picked pages have links to/);
});

test('the inferred rule always includes every picked page, for 300 random picks with random link choices', () => {
  const world = generateWorld(1), rng = createRng(77);
  const all = world.wikiPages;
  for (let n = 0; n < 300; n += 1) {
    const mode = n % 3;
    // Random pages, a block taken from one folder, or most of a tag: the three ways a person picks.
    let picked: string[];
    if (mode === 0) picked = rng.shuffle(all).slice(0, rng.int(0, 40)).map(p => p.id);
    else if (mode === 1) { const folder = rng.pick(all).folder; picked = all.filter(p => p.folder.split('/')[0] === folder.split('/')[0] && rng.next() < 0.7).map(p => p.id); }
    else { const tag = rng.pick(all.flatMap(p => p.tags)); picked = all.filter(p => p.tags.includes(tag) && rng.next() < 0.8).map(p => p.id); }
    const hops = ([0, 1, 2] as const)[rng.int(0, 2)]!;
    const r = inferRule(picked, all, { hops });
    const matched = matchPages(r.rule, r.seeds, all);
    for (const id of picked) assert.ok(matched.has(id), `run ${n}: ${id} is picked but not matched`);
    assert.deepEqual(r.rule, inferRule([...picked].reverse(), all, { hops }).rule, 'the order of the picks does not matter');
  }
});

test('explainInference says in plain words what was picked and why each handle was chosen', () => {
  const picked = ['n1', 'n2', 'n3', 'n4', 'm1', 'm2', 'm3', 'm4', 'm5', 's1'];
  const words = explainInference(inferRule(picked, PAGES, { hops: 1 })).join(' ');
  assert.match(words, /You picked 10 pages\./);
  assert.match(words, /9 of the 10 pages in the north folder/);
  assert.match(words, /1 page stays as a single page/);
  assert.match(words, /1 hop/);
  assert.equal(explainInference(inferRule([], PAGES)).join(' '), 'No pages are picked yet.');
  assert.doesNotMatch(words, /glob|regex|pattern|\bhelper|\bteam/i);
});

test('no two different folders of the sample world give the same sentence', () => {
  const pages = generateWorld(1).wikiPages;
  const folders = [...new Set(pages.flatMap(p => p.folder.split('/').map((_, n, parts) => parts.slice(0, n + 1).join('/'))))];
  const leaves = folders.map(f => f.split('/').pop()!);
  assert.ok(new Set(leaves).size < folders.length, 'the sample world has leaf names that repeat, which is what this test guards against');
  const sentences = new Map<string, string>();
  for (const folder of folders) {
    const line = explainInference({ rule: { folders: [folder], pageTypesAndTags: { types: [], tags: [] }, linksFromSeeds: null }, seeds: [], leftover: [], folders: [{ folder, picked: 2, total: 3 }], used: [], offers: [], picked: 2 })[1]!;
    assert.equal(sentences.has(line), false, `"${folder}" and "${sentences.get(line)}" give the same sentence: ${line}`);
    sentences.set(line, folder);
  }
  assert.ok(sentences.size > 20);
});

test('a nested folder is named with where it sits, and a top folder is named alone', () => {
  const nested = explainInference({ rule: { folders: ['north/a'], pageTypesAndTags: { types: [], tags: [] }, linksFromSeeds: null }, seeds: [], leftover: [], folders: [{ folder: 'north/a', picked: 4, total: 5 }], used: [], offers: [], picked: 4 });
  assert.equal(nested[1], 'You picked 4 of the 5 pages in the a folder inside north, so the rule uses the whole folder.');
  const deep = explainInference({ rule: { folders: ['x/y/z'], pageTypesAndTags: { types: [], tags: [] }, linksFromSeeds: null }, seeds: [], leftover: [], folders: [{ folder: 'x/y/z', picked: 2, total: 2 }], used: [], offers: [], picked: 2 });
  assert.match(deep[1]!, /in the z folder inside x \/ y,/);
});
