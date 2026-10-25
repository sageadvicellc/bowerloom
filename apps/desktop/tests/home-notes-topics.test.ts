// The topics of "Choose notes": 700 pages of the seed-1 world become a few plain topics with parts, counts and plain titles.
import test from 'node:test';
import assert from 'node:assert/strict';
import { generateWorld } from '../shared/proto/sample.js';
import type { WikiPage } from '../shared/proto/types.js';
import { OTHER_NOTES, buildTopics, partOf, plainTitles, topicOf } from '../shared/home/notes-topics.js';
import { SAMPLE_WORDS } from '../shared/proto/sample.js';
import { bannedIn, countWords } from '../shared/home/textbudget.js';

const world = generateWorld(1);
const topics = buildTopics(world.wikiPages);

const page = (id: string, folder: string, type = 'guide'): WikiPage => ({ id, title: id, folder, type, tags: [], summary: '', bytes: 1000, links: [], joinedSinceVisit: false });

test('the 700 pages make 8 topics, biggest first, and the counts add up', () => {
  assert.equal(world.wikiPages.length, 700);
  assert.equal(topics.length, 8);
  assert.equal(topics.reduce((n, t) => n + t.count, 0), 700);
  for (let i = 1; i < topics.length; i += 1) assert.ok(topics[i - 1]!.count >= topics[i]!.count, 'ordered by size');
  assert.deepEqual(topics.map(t => [t.name, t.count]).slice(0, 3), [['Work', 143], ['Meetings', 114], ['Research', 108]]);
  for (const t of topics) assert.equal(t.parts.reduce((n, p) => n + p.count, 0), t.count, t.name);
});

test('every topic and part of the sample has a plain name: none is an invented folder word', () => {
  const invented = new Set<string>([...SAMPLE_WORDS.domains, ...SAMPLE_WORDS.subfolders]);
  for (const t of topics) {
    assert.ok(!invented.has(t.name.toLowerCase()), t.name);
    assert.ok(countWords(t.name) <= 3, t.name);
    assert.equal(bannedIn(t.name), null, t.name);
    for (const p of t.parts) { assert.ok(!invented.has(p.name.toLowerCase()), p.name); assert.ok(countWords(p.name) <= 3, p.name); assert.equal(bannedIn(p.name), null, p.name); }
    assert.equal(new Set(t.parts.map(p => p.name)).size, t.parts.length, `${t.name} has two parts with one name`);
  }
  assert.equal(new Set(topics.map(t => t.name)).size, topics.length);
});

test('a topic id is the top folder and a part folder is its full path, which is how a rule names them', () => {
  const clients = topics.find(t => t.name === 'Clients')!;
  assert.equal(clients.id, 'alderhythe');
  assert.deepEqual(clients.parts.map(p => p.folder).sort(), ['alderhythe/gorse', 'alderhythe/kestrel', 'alderhythe/linnet', 'alderhythe/pennon']);
  assert.equal(clients.parts.every(p => !p.direct), true);
});

test('a page finds its topic and part', () => {
  for (const p of world.wikiPages.slice(0, 40)) {
    const t = topicOf(topics, p)!;
    assert.equal(t.id, p.folder.split('/')[0]);
    assert.equal(partOf(t, p)!.folder, p.folder);
  }
});

test('plain titles: unique, short, plain, and the same every time', () => {
  const titles = plainTitles(world.wikiPages, topics);
  assert.equal(titles.size, 700);
  assert.equal(new Set(titles.values()).size, 700, 'no two pages share a title');
  for (const [id, title] of titles) { assert.ok(countWords(title) <= 6, `${id}: ${title}`); assert.equal(bannedIn(title), null, title); assert.doesNotMatch(title, /[A-Z]{2}|\//, title); }
  assert.deepEqual([...plainTitles(world.wikiPages, topics)], [...titles]);
  assert.match(titles.get('page-0001')!, /^Current work \w[\w-]*( \d+)?$/);
});

test('a folder the table does not know becomes words, and loose pages sit in a part of their own', () => {
  const pages = [page('a', 'fern-hill/quiet_corner'), page('b', 'fern-hill/quiet_corner'), page('c', 'fern-hill'), page('d', '')];
  const t = buildTopics(pages);
  assert.equal(t.length, 1, 'a page with no folder belongs to no topic');
  assert.equal(t[0]!.name, 'Fern Hill');
  assert.deepEqual(t[0]!.parts.map(p => [p.name, p.count, p.direct]), [['Quiet Corner', 2, false], [OTHER_NOTES, 1, true]]);
  assert.equal(topicOf(t, pages[3]!), undefined);
});

test('a page deeper than two levels counts in the part that holds its second folder', () => {
  const t = buildTopics([page('a', 'x/y/z'), page('b', 'x/y')]);
  assert.deepEqual(t[0]!.parts.map(p => [p.folder, p.count]), [['x/y', 2]]);
});
