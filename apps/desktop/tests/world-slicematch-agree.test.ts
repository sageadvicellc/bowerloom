// The store and the screen must never disagree on a slice count: slicematch.ts (the store's matcher) now delegates to slicerule.ts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRng } from '../shared/world/rng.js';
import { generateWorld } from '../shared/world/sample.js';
import { createStore } from '../shared/world/store.js';
import { countMatches, matchPages, selectPages } from '../shared/world/slicerule.js';
import { liveMatch, slicePages } from '../shared/world/slicematch.js';
import type { SliceRule, WikiPage, World } from '../shared/world/types.js';
import { DESKTOP } from './support.js';

const world = generateWorld(1);
const ids = (pages: readonly WikiPage[]): string[] => pages.map(p => p.id);

test('on every sample slice the store matcher and the rule engine pick the same pages, in page order', () => {
  assert.ok(world.slices.length >= 3);
  for (const slice of world.slices) {
    const expected = selectPages(matchPages(slice.rule, slice.seeds, world.wikiPages), world.wikiPages);
    assert.deepEqual(ids(liveMatch(world, slice)), ids(expected), slice.id);
    assert.equal(liveMatch(world, slice).length, countMatches(slice.rule, slice.seeds, world.wikiPages), slice.id);
  }
});

test('on 200 random rules from a seeded generator the two matchers agree on every page', () => {
  const rng = createRng(20261024);
  const folders = [...new Set(world.wikiPages.map(p => p.folder))], domains = [...new Set(folders.map(f => f.split('/')[0]!))];
  const types = [...new Set(world.wikiPages.map(p => p.type))], tags = [...new Set(world.wikiPages.flatMap(p => p.tags))];
  const some = <T>(list: readonly T[], most: number): T[] => rng.shuffle(list).slice(0, rng.int(0, most));
  let nonEmpty = 0, withHops = 0;
  for (let n = 0; n < 200; n += 1) {
    const rule: SliceRule = {
      folders: [...some(domains, 2), ...some(folders, 3).map(f => (rng.next() < 0.2 ? `${f}/` : f)), ...(rng.next() < 0.1 ? ['no/such/folder', ''] : [])],
      pageTypesAndTags: { types: some(types, 2), tags: some(tags, 3) },
      linksFromSeeds: rng.next() < 0.5 ? null : { hops: rng.next() < 0.5 ? 1 : 2 },
    };
    const seeds = [...some(world.wikiPages.map(p => p.id), 6), ...(rng.next() < 0.1 ? ['not-a-page'] : [])];
    const slice = { seeds, rule };
    const fromEngine = matchPages(rule, seeds, world.wikiPages);
    const fromStore = liveMatch(world, slice);
    assert.deepEqual(ids(fromStore), ids(selectPages(fromEngine, world.wikiPages)), `rule ${n}`);
    assert.equal(fromStore.length, fromEngine.size, `rule ${n}`);
    if (fromEngine.size > 0) nonEmpty += 1;
    if (rule.linksFromSeeds !== null) withHops += 1;
  }
  assert.ok(nonEmpty > 100 && withHops > 60, `the random rules must be varied (${nonEmpty} non-empty, ${withHops} with hops)`);
});

test('a page that a folder already picks still passes the walk on: two hops follow through it (the old store matcher stopped there)', () => {
  const page = (id: string, folder: string, links: string[]): WikiPage => ({ id, title: id, folder, type: 'note', tags: [], summary: '', bytes: 400, links, joinedSinceVisit: false });
  const small: World = { ...world, wikiPages: [page('s', 'start', ['b1']), page('b1', 'inbox', ['c1']), page('c1', 'far', [])], slices: [] };
  const rule: SliceRule = { folders: ['inbox'], pageTypesAndTags: { types: [], tags: [] }, linksFromSeeds: { hops: 2 } };
  assert.deepEqual(ids(liveMatch(small, { seeds: ['s'], rule })), ['s', 'b1', 'c1']);
  assert.equal(countMatches(rule, ['s'], small.wikiPages), 3);
});

test('pinning freezes exactly the pages the rule engine counts, and a pinned slice lists its frozen pages', () => {
  const store = createStore(world);
  for (const slice of world.slices) store.dispatch({ type: 'pinSlice', sliceId: slice.id });
  for (const slice of store.getState().draft.slices) {
    assert.equal(slice.pinned, true);
    assert.deepEqual(slice.pinnedPageIds, ids(selectPages(matchPages(slice.rule, slice.seeds, world.wikiPages), world.wikiPages)), slice.id);
    assert.deepEqual(ids(slicePages(store.getState().draft, slice)), [...slice.pinnedPageIds!], slice.id);
  }
});

test('slicematch.ts has no matcher of its own: it calls matchPages', () => {
  const text = readFileSync(join(DESKTOP, 'shared', 'world', 'slicematch.ts'), 'utf8');
  assert.match(text, /matchPages\(/);
  assert.doesNotMatch(text, /startsWith\(|\.links/, 'no second implementation of folders or links');
});
