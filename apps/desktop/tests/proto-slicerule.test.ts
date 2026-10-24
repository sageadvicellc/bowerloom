// The slice rule engine (spec 6.9): live matching of the three handles, counts, a token estimate, cut links and the rule in plain words.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cutLinks, countMatches, describeRule, estimateTokens, joinedSince, matchPages, selectPages } from '../shared/proto/slicerule.js';
import { generateWorld } from '../shared/proto/sample.js';
import type { SliceRule, WikiPage } from '../shared/proto/types.js';
import { DESKTOP } from './support.js';

const page = (id: string, folder: string, type = 'note', tags: string[] = [], links: string[] = [], bytes = 1000, joinedSinceVisit = false): WikiPage =>
  ({ id, title: id, folder, type, tags, summary: '', bytes, links, joinedSinceVisit });
const NONE: SliceRule = { folders: [], pageTypesAndTags: { types: [], tags: [] }, linksFromSeeds: null };
const rule = (patch: Partial<SliceRule>): SliceRule => ({ ...NONE, ...patch });
const sorted = (set: ReadonlySet<string>): string[] => [...set].sort();

// A small world: a chain a1 > a2 > b1 > b2 > c1 (links), a folder that only shares a prefix with another, and some types and tags.
const PAGES: WikiPage[] = [
  page('a1', 'alpha', 'guide', ['red'], ['a2']),
  page('a2', 'alpha/inner', 'note', [], ['b1']),
  page('b1', 'beta', 'note', ['blue'], ['b2']),
  page('b2', 'beta/deep/er', 'guide', [], ['c1', 'ghost']),
  page('c1', 'gamma', 'note', ['red', 'blue'], ['a1']),
  page('x1', 'alphabet', 'note', [], []),
  page('z1', '', 'other', [], []),
];

test('a rule with no handle and no seed matches nothing', () => {
  assert.equal(matchPages(NONE, [], PAGES).size, 0);
  assert.equal(matchPages(NONE, [], []).size, 0);
});

test('folders: a page matches in the folder itself or anywhere below it, never in a folder that only shares the start of the name', () => {
  assert.deepEqual(sorted(matchPages(rule({ folders: ['alpha'] }), [], PAGES)), ['a1', 'a2']);
  assert.deepEqual(sorted(matchPages(rule({ folders: ['beta'] }), [], PAGES)), ['b1', 'b2']);
  assert.deepEqual(sorted(matchPages(rule({ folders: ['beta/deep'] }), [], PAGES)), ['b2']);
  assert.deepEqual(sorted(matchPages(rule({ folders: ['alpha/'] }), [], PAGES)), ['a1', 'a2'], 'a trailing slash changes nothing');
  assert.deepEqual(sorted(matchPages(rule({ folders: ['alpha', 'gamma'] }), [], PAGES)), ['a1', 'a2', 'c1']);
  assert.deepEqual(sorted(matchPages(rule({ folders: ['nowhere'] }), [], PAGES)), []);
  assert.deepEqual(sorted(matchPages(rule({ folders: [''] }), [], PAGES)), [], 'an empty folder name matches nothing, not everything');
});

test('types and tags: a page matches when its type is listed or any of its tags is listed', () => {
  assert.deepEqual(sorted(matchPages(rule({ pageTypesAndTags: { types: ['guide'], tags: [] } }), [], PAGES)), ['a1', 'b2']);
  assert.deepEqual(sorted(matchPages(rule({ pageTypesAndTags: { types: [], tags: ['red'] } }), [], PAGES)), ['a1', 'c1']);
  assert.deepEqual(sorted(matchPages(rule({ pageTypesAndTags: { types: [], tags: ['red', 'blue'] } }), [], PAGES)), ['a1', 'b1', 'c1']);
  assert.deepEqual(sorted(matchPages(rule({ pageTypesAndTags: { types: ['other'], tags: ['blue'] } }), [], PAGES)), ['b1', 'c1', 'z1'], 'type OR tag');
});

test('links from seeds: one hop adds the pages the seeds link to, two hops add one more step, and a dangling link is ignored', () => {
  assert.deepEqual(sorted(matchPages(rule({ linksFromSeeds: { hops: 1 } }), ['a1'], PAGES)), ['a1', 'a2']);
  assert.deepEqual(sorted(matchPages(rule({ linksFromSeeds: { hops: 2 } }), ['a1'], PAGES)), ['a1', 'a2', 'b1']);
  assert.deepEqual(sorted(matchPages(rule({ linksFromSeeds: { hops: 2 } }), ['b2'], PAGES)), ['a1', 'b2', 'c1']);
  assert.deepEqual(sorted(matchPages(rule({ linksFromSeeds: { hops: 1 } }), ['b2'], PAGES)), ['b2', 'c1']);
  assert.ok(!matchPages(rule({ linksFromSeeds: { hops: 2 } }), ['b2'], PAGES).has('ghost'));
});

test('hops 2 reach everything hops 1 reach, and more on a chain', () => {
  const one = matchPages(rule({ linksFromSeeds: { hops: 1 } }), ['a1'], PAGES), two = matchPages(rule({ linksFromSeeds: { hops: 2 } }), ['a1'], PAGES);
  for (const id of one) assert.ok(two.has(id), id);
  assert.ok(two.size > one.size);
});

test('without the links handle the seeds still match, and a link is followed only from a seed', () => {
  assert.deepEqual(sorted(matchPages(NONE, ['a1', 'z1'], PAGES)), ['a1', 'z1']);
  assert.deepEqual(sorted(matchPages(rule({ folders: ['gamma'], linksFromSeeds: { hops: 1 } }), ['a1'], PAGES)), ['a1', 'a2', 'c1'], 'c1 is in the folder; its own link to a1 adds nothing new, and a2 comes from the seed only');
});

test('seeds always match, whatever the other handles say', () => {
  const r = rule({ folders: ['gamma'], pageTypesAndTags: { types: ['guide'], tags: [] } });
  const matched = matchPages(r, ['x1', 'z1'], PAGES);
  assert.ok(matched.has('x1') && matched.has('z1'));
  assert.deepEqual(sorted(matched), ['b2', 'a1', 'c1', 'x1', 'z1'].sort());
});

test('a seed that is not a page is ignored, never counted', () => {
  assert.deepEqual(sorted(matchPages(rule({ linksFromSeeds: { hops: 2 } }), ['nope'], PAGES)), []);
  assert.equal(countMatches(NONE, ['nope'], PAGES), 0);
});

test('the three handles combine with OR', () => {
  const r = rule({ folders: ['beta'], pageTypesAndTags: { types: [], tags: ['red'] }, linksFromSeeds: { hops: 1 } });
  assert.deepEqual(sorted(matchPages(r, ['a1'], PAGES)), ['a1', 'a2', 'b1', 'b2', 'c1']);
});

test('matchPages changes none of its inputs', () => {
  const pagesBefore = JSON.stringify(PAGES), ruleSample = rule({ folders: ['alpha'], linksFromSeeds: { hops: 2 } }), ruleBefore = JSON.stringify(ruleSample), seeds = ['a1'];
  matchPages(ruleSample, seeds, PAGES);
  assert.equal(JSON.stringify(PAGES), pagesBefore); assert.equal(JSON.stringify(ruleSample), ruleBefore); assert.deepEqual(seeds, ['a1']);
});

test('a link cycle ends, and a page that links to itself adds nothing', () => {
  const loop = [page('l1', 'f', 'note', [], ['l2', 'l1']), page('l2', 'f', 'note', [], ['l1'])];
  assert.deepEqual(sorted(matchPages(rule({ linksFromSeeds: { hops: 2 } }), ['l1'], loop)), ['l1', 'l2']);
});

// ---- Counts and the token estimate ----

test('countMatches is the size of the matched set', () => {
  const r = rule({ folders: ['alpha'], pageTypesAndTags: { types: [], tags: ['blue'] } });
  assert.equal(countMatches(r, [], PAGES), matchPages(r, [], PAGES).size);
  assert.equal(countMatches(r, [], PAGES), 4);
});

test('selectPages keeps the page order and drops the rest', () => {
  assert.deepEqual(selectPages(new Set(['c1', 'a1']), PAGES).map(p => p.id), ['a1', 'c1']);
  assert.deepEqual(selectPages(new Set(), PAGES), []);
});

test('estimateTokens is ceil(bytes / 4) per page, summed (a placeholder rule)', () => {
  assert.equal(estimateTokens([]), 0);
  assert.equal(estimateTokens([page('q', 'f', 'note', [], [], 1000)]), 250);
  assert.equal(estimateTokens([page('q', 'f', 'note', [], [], 1001), page('r', 'f', 'note', [], [], 3), page('s', 'f', 'note', [], [], 0)]), 251 + 1 + 0);
});

// ---- Cut links ----

test('cutLinks lists the links that leave the slice, in page order, with no dangling or self link', () => {
  const all = new Set(['a1', 'a2', 'b2']);
  assert.deepEqual(cutLinks(all, PAGES), [{ from: 'a2', to: 'b1' }, { from: 'b2', to: 'c1' }]);
  assert.deepEqual(cutLinks(new Set(), PAGES), []);
  assert.deepEqual(cutLinks(new Set(PAGES.map(p => p.id)), PAGES), []);
  const dup = [page('d1', 'f', 'note', [], ['d2', 'd2', 'd1']), page('d2', 'f', 'note', [], [])];
  assert.deepEqual(cutLinks(new Set(['d1']), dup), [{ from: 'd1', to: 'd2' }], 'a repeated link counts once, a self link never');
});

test('cutLinks on a generated world: every link is inside, leaving, entering or outside, and entering is the leaving of the rest', () => {
  const world = generateWorld(3), pages = world.wikiPages;
  for (const slice of world.slices) {
    const matched = matchPages(slice.rule, slice.seeds, pages);
    const rest = new Set(pages.map(p => p.id).filter(id => !matched.has(id)));
    const ids = new Set(pages.map(p => p.id));
    let inside = 0, leaving = 0, entering = 0, outside = 0;
    for (const p of pages) for (const to of new Set(p.links)) {
      if (!ids.has(to) || to === p.id) continue;
      const a = matched.has(p.id), b = matched.has(to);
      if (a && b) inside += 1; else if (a) leaving += 1; else if (b) entering += 1; else outside += 1;
    }
    const cut = cutLinks(matched, pages), back = cutLinks(rest, pages);
    assert.equal(cut.length, leaving, slice.id);
    assert.equal(back.length, entering, slice.id);
    assert.equal(inside + leaving + entering + outside, new Set(pages.flatMap(p => [...new Set(p.links)].filter(t => ids.has(t) && t !== p.id).map(t => `${p.id}>${t}`))).size);
    for (const c of cut) assert.ok(matched.has(c.from) && !matched.has(c.to), `${c.from}>${c.to}`);
    for (const c of back) assert.ok(!matched.has(c.from) && matched.has(c.to), `${c.from}>${c.to}`);
    assert.ok(inside + leaving + entering + outside > 0);
  }
});

// ---- joinedSince ----

test('joinedSince counts matched pages that joined since the last visit', () => {
  const pages = [page('j1', 'f', 'note', [], [], 10, true), page('j2', 'f', 'note', [], [], 10, true), page('j3', 'f', 'note', [], [], 10, false)];
  assert.equal(joinedSince(new Set(['j1', 'j3']), pages), 1);
  assert.equal(joinedSince(new Set(['j1', 'j2', 'j3']), pages), 2);
  assert.equal(joinedSince(new Set(), pages), 0);
  assert.equal(joinedSince(new Set(['missing']), pages), 0);
});

// ---- describeRule ----

const BANNED = /glob|regex|pattern|command|wildcard/i;

test('describeRule says the rule in plain words with pages, folder, tag and links', () => {
  const full = rule({ folders: ['alpha', 'beta/deep'], pageTypesAndTags: { types: ['guide'], tags: ['red', 'blue'] }, linksFromSeeds: { hops: 2 } });
  const text = describeRule(full, PAGES);
  for (const word of ['pages', 'folder', 'tag', 'links']) assert.match(text, new RegExp(word), word);
  assert.doesNotMatch(text, BANNED);
  assert.match(text, /alpha/); assert.match(text, /deep/); assert.match(text, /guide/); assert.match(text, /red/); assert.match(text, /blue/);
});

test('describeRule: one handle says only that handle, and hops one and two read differently', () => {
  const folderOnly = describeRule(rule({ folders: ['alpha'] }), PAGES);
  assert.match(folderOnly, /folder/); assert.doesNotMatch(folderOnly, /tag|link/);
  const tagOnly = describeRule(rule({ pageTypesAndTags: { types: [], tags: ['red'] } }), PAGES);
  assert.match(tagOnly, /tag/); assert.doesNotMatch(tagOnly, /folder|link/);
  const one = describeRule(rule({ linksFromSeeds: { hops: 1 } }), PAGES), two = describeRule(rule({ linksFromSeeds: { hops: 2 } }), PAGES);
  assert.match(one, /link/); assert.match(two, /link/); assert.notEqual(one, two);
});

test('describeRule: an empty rule still reads as words and ends with a full stop', () => {
  const text = describeRule(NONE, PAGES);
  assert.ok(text.length > 10); assert.match(text, /\.$/); assert.doesNotMatch(text, BANNED);
});

test('describeRule: every rule of a generated world, and many odd ones, avoid the banned words and end with a full stop', () => {
  const world = generateWorld(5);
  const rules: SliceRule[] = [...world.slices.map(s => s.rule), rule({ folders: ['a*', '**/x', '^re$'] }), rule({ pageTypesAndTags: { types: ['t'], tags: [] } })];
  for (const r of rules) { const t = describeRule(r, world.wikiPages); assert.doesNotMatch(t, /glob|regex|pattern|command/i); assert.match(t, /\.$/); }
});

// ---- Brute force and performance ----

/** An independent count: no shared code with the engine. A page matches when any of four plain tests holds. */
function bruteForce(r: SliceRule, seeds: readonly string[], pages: readonly WikiPage[]): number {
  const byId: Record<string, WikiPage> = {};
  for (const p of pages) byId[p.id] = p;
  const level0 = seeds.filter(s => byId[s] !== undefined);
  const level1: string[] = [], level2: string[] = [];
  if (r.linksFromSeeds !== null) {
    for (const s of level0) for (const t of byId[s]!.links) if (byId[t] !== undefined) level1.push(t);
    if (r.linksFromSeeds.hops === 2) for (const s of level1) for (const t of byId[s]!.links) if (byId[t] !== undefined) level2.push(t);
  }
  let count = 0;
  for (const p of pages) {
    let hit = level0.includes(p.id) || level1.includes(p.id) || level2.includes(p.id);
    for (const f of r.folders) if (f !== '' && (p.folder === f || p.folder.startsWith(`${f}/`))) hit = true;
    if (r.pageTypesAndTags.types.includes(p.type)) hit = true;
    for (const t of p.tags) if (r.pageTypesAndTags.tags.includes(t)) hit = true;
    if (hit) count += 1;
  }
  return count;
}

test('the engine count equals an independent brute-force count on the generated slices and on many more rules', () => {
  const world = generateWorld(1), pages = world.wikiPages;
  for (const s of world.slices) assert.equal(countMatches(s.rule, s.seeds, pages), bruteForce(s.rule, s.seeds, pages), s.id);
  const folders = [...new Set(pages.map(p => p.folder))], tops = [...new Set(pages.map(p => p.folder.split('/')[0]!))];
  const types = [...new Set(pages.map(p => p.type))], tags = [...new Set(pages.flatMap(p => p.tags))];
  const withLinks = pages.filter(p => p.links.length > 0).map(p => p.id);
  for (let i = 0; i < 60; i += 1) {
    const r: SliceRule = {
      folders: i % 2 === 0 ? [folders[i % folders.length]!, tops[i % tops.length]!] : [],
      pageTypesAndTags: { types: i % 3 === 0 ? [types[i % types.length]!] : [], tags: i % 4 === 0 ? [tags[i % tags.length]!] : [] },
      linksFromSeeds: i % 5 === 0 ? null : { hops: i % 2 === 0 ? 1 : 2 },
    };
    const seeds = [withLinks[i % withLinks.length]!, withLinks[(i * 7 + 3) % withLinks.length]!];
    assert.equal(countMatches(r, seeds, pages), bruteForce(r, seeds, pages), `rule ${i}`);
  }
});

test('generateWorld plus matchPages over 700 pages finishes under 500 ms', () => {
  const start = performance.now();
  const world = generateWorld(1);
  for (const s of world.slices) matchPages(s.rule, s.seeds, world.wikiPages);
  const elapsed = performance.now() - start;
  assert.equal(world.wikiPages.length, 700);
  assert.ok(elapsed < 500, `took ${elapsed.toFixed(0)} ms`);
});

test('shared/proto/slicerule.ts is pure: no import except the types and the word joiner, no file, no clock, no random number', () => {
  const code = readFileSync(join(DESKTOP, 'shared', 'proto', 'slicerule.ts'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(code, /node:|Math\.random|Date\.|\bnew Date\b|innerHTML|window\.bowerloom/);
  for (const m of code.matchAll(/^import .*$/gm)) assert.match(m[0], /^import type |^import \{ joinWords \} from '\.\/words\.js';$/, 'only type imports and the word joiner');
});
