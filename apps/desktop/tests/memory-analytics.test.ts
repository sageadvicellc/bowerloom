// The Memory explorer's reading of Obsidian-style notes: links, tags and front matter, and the four analytics layers (notes, links, tags, links to a missing note).
// The expected numbers come from the made-up vault in tests/memory-fixtures.ts, worked out by hand. The functions are pure: no file, no clock.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ANALYTICS_LIST_MAX, MEMORY_LIMITS, analyse, parseNote, resolveLink } from '../shared/memory/analytics.js';
import type { ParsedNote } from '../shared/memory/analytics.js';
import { BASIC, BASIC_FACTS, chain } from './memory-fixtures.js';

const parseAll = (vault: Readonly<Record<string, string>>): { paths: string[]; parsed: ParsedNote[] } => {
  const paths = Object.keys(vault).filter(p => /\.md$/i.test(p) && !p.split('/').some(part => part.startsWith('.'))).sort();
  return { paths, parsed: paths.map(p => parseNote(p, vault[p]!)) };
};
const targets = (note: ParsedNote): string[] => note.links.map(l => l.target);

// ---- parseNote: tags

test('tags come from the front matter in all three forms, and from the text, and a tag is lower case without its hash', () => {
  assert.deepEqual(parseNote('a.md', '---\ntags: [Index, "area/work"]\n---\nx').tags, ['index', 'area/work']);
  assert.deepEqual(parseNote('a.md', '---\ntags:\n  - project\n  - "#Area/Work"\n---\nx').tags, ['project', 'area/work']);
  assert.deepEqual(parseNote('a.md', '---\ntags: beta, area/work\n---\nx').tags, ['beta', 'area/work']);
  assert.deepEqual(parseNote('a.md', '---\ntag: solo\n---\nx').tags, ['solo']);
  assert.deepEqual(parseNote('a.md', 'A day. #Daily and #idea/new').tags, ['daily', 'idea/new']);
  assert.deepEqual(parseNote('a.md', '---\ntags: [x]\n---\nAlso #x and #y').tags, ['x', 'y'], 'a tag in both places counts once');
});

test('a hash that is not a tag is not one: a heading, a number, a web address, a link to a heading, and anything in code', () => {
  const text = '# Title\n## Sub\nIssue #123 is a number. See https://example.com/page#anchor and [a](#frag) and [[Note#Heading]].\nWord#glued is not a tag.\n```\n#in-a-block\n```\nInline `#in-code` too.\n';
  assert.deepEqual(parseNote('a.md', text).tags, []);
  assert.deepEqual(parseNote('a.md', 'Tags: #café #日本語 #a-b_c').tags, ['café', '日本語', 'a-b_c'], 'letters of any language and the signs - and _');
  assert.deepEqual(parseNote('a.md', '#2024 and #2024q1').tags, ['2024q1'], 'a tag of digits only is a number');
});

test('front matter that is not closed, or not a list, gives no tags and never throws', () => {
  assert.deepEqual(parseNote('a.md', '---\ntags: [a, b\nno end').tags, [], 'a block that never closes is text, not front matter');
  assert.doesNotThrow(() => parseNote('a.md', '---\ntags: {x: [}\n---\n'));
  assert.deepEqual(parseNote('a.md', '').tags, []);
  assert.deepEqual(parseNote('a.md', '---\r\ntags: [crlf]\r\n---\r\nBody #body\r\n').tags, ['crlf', 'body']);
});

// ---- parseNote: links

test('a link is a wiki link or a markdown link to a note; the alias, the heading and the block are cut away', () => {
  const note = parseNote('a.md', '[[One]] [[Two|alias]] [[Three#Heading]] [[Four#^block]] ![[Five]] [six](Six.md) [seven](Seven%20Note.md#part) [eight](folder/Eight)');
  assert.deepEqual(targets(note), ['One', 'Two', 'Three', 'Four', 'Five', 'Six.md', 'Seven Note.md', 'folder/Eight']);
});

test('no link: the web, mail, a heading of the same note, a picture or a file that is not a note, an empty target, and a link in code', () => {
  const text = '[w](https://a.b/c.md) [m](mailto:x@y.z) [h](#only) [[#Heading]] ![[pic.png]] [d](doc.pdf) [[]] [e]() ![[clip.mp4]]\n```\n[[Code]]\n```\n`[[Inline]]`\n';
  assert.deepEqual(parseNote('a.md', text).links, []);
});

test('the same target twice in one note is one link, and the note keeps no more than the limit', () => {
  assert.deepEqual(targets(parseNote('a.md', '[[Same]] [[Same|again]] [[same]]')), ['Same']);
  const many = Array.from({ length: MEMORY_LIMITS.linksPerNote + 50 }, (_, i) => `[[T${i}]]`).join(' ');
  assert.equal(parseNote('a.md', many).links.length, MEMORY_LIMITS.linksPerNote);
});

// ---- resolveLink

test('a link finds its note by the name of the file, by a path, or by a path from the folder of the note, in any letter case', () => {
  const paths = ['Home.md', 'Project Alpha.md', 'sub/Deep.md', 'sub/deeper/Leaf.md', 'a/Same.md', 'b/Same.md'];
  const at = (target: string, from = 'Home.md', style: 'wiki' | 'markdown' = 'wiki'): string | null => resolveLink(paths, { target, style }, from);
  assert.equal(at('home'), 'Home.md');
  assert.equal(at('Home.md'), 'Home.md');
  assert.equal(at('project alpha'), 'Project Alpha.md');
  assert.equal(at('sub/Deep'), 'sub/Deep.md');
  assert.equal(at('deeper/Leaf'), 'sub/deeper/Leaf.md', 'a path that ends the path of a note');
  assert.equal(at('Leaf'), 'sub/deeper/Leaf.md');
  assert.equal(at('Same'), 'a/Same.md', 'two notes with one name: the first path in order');
  assert.equal(at('../Home.md', 'sub/Deep.md', 'markdown'), 'Home.md');
  assert.equal(at('deeper/Leaf.md', 'sub/Deep.md', 'markdown'), 'sub/deeper/Leaf.md');
  assert.equal(at('Nothing'), null);
  assert.equal(at('../../x.md', 'sub/Deep.md', 'markdown'), null, 'a path that leaves the folder finds nothing');
});

// ---- the four layers

test('the basic vault has the notes, links, tags and missing links worked out by hand', () => {
  const { paths, parsed } = parseAll(BASIC);
  assert.equal(paths.length, BASIC_FACTS.notes, 'the hidden file, the hidden folder and the text file are not notes');
  const result = analyse(paths, parsed);
  assert.equal(result.notes, BASIC_FACTS.notes);
  assert.equal(result.links, BASIC_FACTS.links);
  assert.equal(result.missingLinks, BASIC_FACTS.missingLinks);
  assert.equal(result.missingTargets, BASIC_FACTS.missingTargets.length);
  assert.deepEqual(result.missing.map(m => m.target.toLowerCase()).sort(), [...BASIC_FACTS.missingTargets]);
  assert.equal(result.tags, BASIC_FACTS.tags);
  assert.equal(result.tagUses, BASIC_FACTS.tagUses);
  for (const [tag, notes] of Object.entries(BASIC_FACTS.tagNotes)) assert.equal(result.topTags.find(t => t.tag === tag)?.notes, notes, tag);
  assert.deepEqual(result.topTags.slice(0, 2).map(t => t.tag), ['area/work', 'daily'], 'the most used tag first, then by name');
});

test('an empty folder and a folder of notes with no links or tags give zeros, not gaps', () => {
  const zero = { notes: 0, links: 0, tags: 0, tagUses: 0, missingLinks: 0, missingTargets: 0, capped: false, topTags: [], missing: [] };
  assert.deepEqual(analyse([], []), zero);
  const plain = parseAll({ 'a.md': 'text', 'b.md': '' });
  assert.deepEqual(analyse(plain.paths, plain.parsed), { ...zero, notes: 2 });
});

test('a note that could not be read still counts as a note and a target, and adds no link and no tag', () => {
  const { paths, parsed } = parseAll({ 'a.md': '[[b]] [[c]] #x', 'b.md': 'x', 'c.md': 'x' });
  const without = parsed.filter(p => p.path !== 'c.md');
  const result = analyse(paths, without);
  assert.equal(result.notes, 3);
  assert.equal(result.links, 2);
  assert.equal(result.missingLinks, 0, 'c.md exists, though it was not read');
});

test('a note that links to itself is a link; a link to a note in another folder with the same name is not missing', () => {
  const { paths, parsed } = parseAll({ 'a.md': '[[a]]', 'x/n.md': 'x', 'y/z.md': '[[n]]' });
  const result = analyse(paths, parsed);
  assert.equal(result.links, 2);
  assert.equal(result.missingLinks, 0);
});

test('the lists are cut at the limit, and the counts above them are not', () => {
  const lots: Record<string, string> = { 'a.md': Array.from({ length: 30 }, (_, i) => `[[gone${i}]] #tag${i}`).join(' ') };
  const { paths, parsed } = parseAll(lots);
  const result = analyse(paths, parsed);
  assert.equal(result.missingTargets, 30);
  assert.equal(result.tags, 30);
  assert.equal(result.missing.length, ANALYTICS_LIST_MAX);
  assert.equal(result.topTags.length, ANALYTICS_LIST_MAX);
});

test('a chain of notes has one link each but the last, which is missing', () => {
  const vault = chain(40);
  const { paths, parsed } = parseAll(vault);
  const result = analyse(paths, parsed);
  assert.equal(result.notes, 40);
  assert.equal(result.links, 40);
  assert.equal(result.missingLinks, 1);
  assert.equal(result.tags, 3);
});

test('a large vault of 5,000 notes is analysed the same way twice', () => {
  const vault = chain(5000);
  const { paths, parsed } = parseAll(vault);
  const first = analyse(paths, parsed);
  assert.deepEqual(analyse(paths, parsed), first);
  assert.equal(first.notes, 5000);
});

test('hostile text does not stop the parser: very long lines, odd characters, a lone surrogate, many brackets', () => {
  const hostile = `${'['.repeat(20000)}${']'.repeat(20000)}\n${'#'.repeat(50000)}\n\ud800 [[‮A]] ${'[[x'.repeat(5000)}`;
  const started = Date.now();
  assert.doesNotThrow(() => parseNote('a.md', hostile));
  assert.ok(Date.now() - started < 2000);
});

// ---- the fix round

test('S1: a very long run of quotes in front matter is read in good time and gives no tag', () => {
  const quotes = '"'.repeat(250000);
  const started = Date.now();
  const note = parseNote('a.md', `---\ntags: [${quotes}x${quotes}]\n---\nbody ${quotes}`);
  assert.ok(Date.now() - started < 1500, `took ${Date.now() - started} ms`);
  assert.deepEqual(note.tags, []);
  assert.deepEqual(parseNote('a.md', '---\ntags: ["a", \'b\']\n---\n').tags, ['a', 'b'], 'ordinary quotes still work');
});

test('S2: front matter tags stop at the per-note cap, and the analytics hold a total cap on distinct tags', () => {
  const many = Array.from({ length: MEMORY_LIMITS.tagsPerNote + 100 }, (_, i) => `t${i}`).join(', ');
  assert.equal(parseNote('a.md', `---\ntags: [${many}]\n---\n`).tags.length, MEMORY_LIMITS.tagsPerNote);
  const block = Array.from({ length: MEMORY_LIMITS.tagsPerNote + 100 }, (_, i) => `  - b${i}`).join('\n');
  assert.equal(parseNote('a.md', `---\ntags:\n${block}\n---\n`).tags.length, MEMORY_LIMITS.tagsPerNote);
  const notes = Array.from({ length: 40 }, (_, n) => parseNote(`n${n}.md`, `---\ntags: [${Array.from({ length: 200 }, (_, i) => `x${n}-${i}`).join(', ')}]\n---\n`));
  const result = analyse(notes.map(n => n.path), notes);
  assert.equal(result.tags, MEMORY_LIMITS.tagsTotal);
  assert.equal(result.capped, true);
  assert.equal(result.tagUses, 40 * 200, 'uses are still counted exactly');
});

test('C1: the notes count and the link index hold every listed note, also those that were not read', () => {
  const paths = Array.from({ length: 2500 }, (_, i) => `n${String(i).padStart(4, '0')}.md`);
  const read = paths.slice(0, 2000).map(p => parseNote(p, p === 'n0000.md' ? '[[n2400]] [[n0001]]' : ''));
  const result = analyse(paths, read);
  assert.equal(result.notes, 2500);
  assert.equal(result.missingLinks, 0, 'a link to a note that was listed and not read is not missing');
  assert.equal(result.links, 2);
});

test('M5: the table form [[Note\\|alias]] finds Note, a markdown link to another file ending is no link, and a wiki link stays permissive', () => {
  assert.deepEqual(targets(parseNote('a.md', '| [[Note\\|alias]] |')), ['Note']);
  assert.deepEqual(parseNote('a.md', '[a](data.json) [b](archive.tar.gz) [c](v1.2) [d](note.md) [e](plain)').links.map(l => l.target), ['note.md', 'plain']);
  assert.deepEqual(targets(parseNote('a.md', '[[v1.2]] [[Q3.review]]')), ['v1.2', 'Q3.review']);
});

test('L3: a missing target with a bidirectional or control character is counted and not listed', () => {
  const note = parseNote('a.md', '[[ok gone]] [[evil\u202etarget]] [[tab\u0001x]]');
  const result = analyse(['a.md'], [note]);
  assert.equal(result.missingLinks, 3);
  assert.deepEqual(result.missing.map(m => m.target), ['ok gone']);
});
