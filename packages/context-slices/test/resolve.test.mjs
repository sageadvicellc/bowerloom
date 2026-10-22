// Spec 05, section 10.3: how a slice selects files.
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveSlice } from '../../../dist/packages/context-slices/src/resolve.js';
import { def, tree } from './tree-fixture.mjs';

const members = r => r.members.map(m => m.path);
const fm = (pairs, body = '# Title\n') => `---\n${pairs}\n---\n${body}`;

test('1. include then exclude gives the expected sorted members', () => {
  const r = resolveSlice(def({ include: ['a/**/*.md', 'b/*.md'], exclude: ['a/drafts/**'] }), tree({ 'b/z.md': '# Z', 'a/y.md': '# Y', 'a/x.md': '# X', 'a/drafts/d.md': '# D', 'c/no.md': '# no' }));
  assert.equal(r.hold, null); assert.deepEqual(members(r), ['a/x.md', 'a/y.md', 'b/z.md']);
});
test('2. hidden folders are never walked', () => {
  const t = tree({ '.obsidian/x.md': 'x', '.git/y.md': 'y', 'a.md': '# A', 'b/.bowerloom/z.md': 'z', 'b/c.md': '# C' });
  const r = resolveSlice(def(), t);
  assert.deepEqual(members(r), ['a.md', 'b/c.md']); assert.ok(t.listed.every(d => !d.split('/').some(s => s.startsWith('.'))), t.listed.join());
});
test('3. a literal that matches nothing holds with SLICE_PATH_MISSING', () => {
  const r = resolveSlice(def({ include: ['index.md', '**/*.md'] }), tree({ 'a.md': '# A' }));
  assert.equal(r.hold.code, 'SLICE_PATH_MISSING'); assert.equal(r.hold.detail, 'index.md');
});
test('4. a glob that matches nothing gives an emptyPatterns note', () => {
  const r = resolveSlice(def({ include: ['**/*.md', 'none/*.md'] }), tree({ 'a.md': '# A' }));
  assert.equal(r.hold, null); assert.deepEqual(r.notes.emptyPatterns, ['none/*.md']);
});
test('5. where uses AND across keys and OR within a list', () => {
  const t = tree({
    'a.md': fm('status: current\nkind: note'), 'b.md': fm('status: draft\nkind: note'), 'c.md': fm('status: current\nkind: memo'), 'd.md': fm('status: old\nkind: note'), 'e.md': 'no frontmatter',
  });
  assert.deepEqual(members(resolveSlice(def({ where: { status: ['current', 'draft'], kind: ['note'] } }), t)), ['a.md', 'b.md']);
});
test('6. where on a list value matches any element', () => {
  const t = tree({ 'a.md': fm('tags: [research, ops]'), 'b.md': fm('tags: [sales]'), 'c.md': fm('tags: research') });
  assert.deepEqual(members(resolveSlice(def({ where: { tags: ['research'] } }), t)), ['a.md', 'c.md']);
});
test('7. unparseable frontmatter is left out and named in unparsed', () => {
  const t = tree({ 'a.md': fm('status: current'), 'bad.md': '---\nstatus: [oops\n---\nx', 'none.md': '# no frontmatter' });
  const r = resolveSlice(def({ where: { status: ['current'] } }), t);
  assert.deepEqual(members(r), ['a.md']); assert.deepEqual(r.notes.unparsed, ['bad.md', 'none.md']);
});
test('8. a .txt file never matches where', () => {
  const r = resolveSlice(def({ include: ['**/*.md', '**/*.txt'], where: { status: ['current'] } }), tree({ 'a.md': fm('status: current'), 'b.txt': 'status: current' }));
  assert.deepEqual(members(r), ['a.md']);
});
test('9. a wikilink with a unique stem is followed', () => {
  const t = tree({ 'a.md': 'see [[beta]]', 'deep/er/beta.md': '# Beta' });
  const r = resolveSlice(def({ include: ['a.md'], links: { follow: ['wikilink'], depth: 1 } }), t);
  assert.deepEqual(members(r), ['a.md', 'deep/er/beta.md']);
});
test('10. a wikilink with two matching stems counts as ambiguous', () => {
  const t = tree({ 'a.md': 'see [[beta]]', 'x/beta.md': '# B1', 'y/Beta.md': '# B2' });
  const r = resolveSlice(def({ include: ['a.md'], links: { follow: ['wikilink'], depth: 1 } }), t);
  assert.deepEqual(members(r), ['a.md']); assert.equal(r.notes.ambiguousLinks, 1); assert.equal(r.notes.unresolvedLinks, 0);
});
test('11. a wikilink with no match counts as unresolved', () => {
  const r = resolveSlice(def({ include: ['a.md'], links: { follow: ['wikilink'], depth: 1 } }), tree({ 'a.md': 'see [[missing-page]]' }));
  assert.deepEqual(members(r), ['a.md']); assert.equal(r.notes.unresolvedLinks, 1);
});
test('12. a wikilink with / resolves as a path', () => {
  const t = tree({ 'a.md': 'see [[deep/beta]] and [[deep/gamma.md]]', 'deep/beta.md': '# B', 'deep/gamma.md': '# G' });
  assert.deepEqual(members(resolveSlice(def({ include: ['a.md'], links: { follow: ['wikilink'], depth: 1 } }), t)), ['a.md', 'deep/beta.md', 'deep/gamma.md']);
});
test('13. a wikilink to a dot-leading segment is unresolved', () => {
  const t = tree({ 'a.md': 'see [[.hidden/page]] and [[/abs]] and [[a\\\\b]] and [[x//y]]', '.hidden/page.md': 'secret' });
  const r = resolveSlice(def({ include: ['a.md'], links: { follow: ['wikilink'], depth: 1 } }), t);
  assert.deepEqual(members(r), ['a.md']); assert.equal(r.notes.unresolvedLinks, 4);
});
test('14. a markdown link with #anchor and %20 resolves', () => {
  const t = tree({ 'a.md': 'see [x](My%20Page.md#top) and [y](sub/../other.md?x=1)', 'My Page.md': '# P', 'other.md': '# O' });
  assert.deepEqual(members(resolveSlice(def({ include: ['a.md'], links: { follow: ['markdown'], depth: 1 } }), t)), ['My Page.md', 'a.md', 'other.md']);
});
test('15. a markdown link that leaves the root is not followed', () => {
  const t = tree({ 'sub/a.md': 'see [x](../../outside.md) and [y](%2e%2e/%2e%2e/z.md) and [z](http://example.com/a.md) and [w](/abs.md) and [v](#top) and [u](bad%zz.md)', 'outside.md': '# O' });
  const r = resolveSlice(def({ include: ['sub/a.md'], links: { follow: ['markdown'], depth: 1 } }), t);
  assert.deepEqual(members(r), ['sub/a.md']); assert.equal(r.notes.unresolvedLinks, 4, 'outside, encoded outside, absolute, bad escape; a URL and an anchor are not file links');
});
test('16. links in fences and inline code are ignored', () => {
  const t = tree({ 'a.md': '```\n[[beta]]\n```\n`[[gamma]]`', 'beta.md': '# B', 'gamma.md': '# G' });
  assert.deepEqual(members(resolveSlice(def({ include: ['a.md'], links: { follow: ['wikilink'], depth: 1 } }), t)), ['a.md']);
});
test('17. depth 2 follows two hops, and a cycle adds each file once', () => {
  const t = tree({ 'a.md': '[[b]]', 'b.md': '[[c]] [[a]]', 'c.md': '[[d]]', 'd.md': '# D' });
  const one = resolveSlice(def({ include: ['a.md'], links: { follow: ['wikilink'], depth: 1 } }), t);
  const two = resolveSlice(def({ include: ['a.md'], links: { follow: ['wikilink'], depth: 2 } }), t);
  assert.deepEqual(members(one), ['a.md', 'b.md']); assert.deepEqual(members(two), ['a.md', 'b.md', 'c.md']);
});
test('18. a linked file that exclude matches is not added', () => {
  const t = tree({ 'a.md': '[[b]]', 'private/b.md': '# B' });
  assert.deepEqual(members(resolveSlice(def({ include: ['a.md'], exclude: ['private/**'], links: { follow: ['wikilink'], depth: 1 } }), t)), ['a.md']);
});
test('19. a member that is a link holds with SLICE_SOURCE_UNSAFE', () => {
  const r = resolveSlice(def(), tree({ 'a.md': '# A', 'l.md': { type: 'link' } }));
  assert.equal(r.hold.code, 'SLICE_SOURCE_UNSAFE'); assert.match(r.hold.detail, /l\.md/);
});
test('20. a link folder between the root and a member holds with SLICE_SOURCE_UNSAFE', () => {
  const t = tree({ 'a.md': '[[l/x]]', 'l/': { type: 'link' } });
  const viaLink = resolveSlice(def({ include: ['a.md'], links: { follow: ['wikilink'], depth: 1 } }), t);
  assert.equal(viaLink.hold.code, 'SLICE_SOURCE_UNSAFE');
  const byPattern = resolveSlice(def({ include: ['l/**'] }), tree({ 'a.md': '# A', 'l/': { type: 'link' } }));
  assert.equal(byPattern.hold.code, 'SLICE_SOURCE_UNSAFE');
});
test('21. a member with two hard links holds with SLICE_SOURCE_UNSAFE', () => {
  assert.equal(resolveSlice(def(), tree({ 'a.md': { text: '# A', nlink: 2 } })).hold.code, 'SLICE_SOURCE_UNSAFE');
});
test('22. a group-writable walked folder holds with SLICE_SOURCE_UNSAFE', () => {
  assert.equal(resolveSlice(def(), tree({ 'a/b.md': '# B', 'a/': { safe: false } })).hold.code, 'SLICE_SOURCE_UNSAFE');
  assert.equal(resolveSlice(def(), tree({ 'a.md': { text: '# A', safe: false } })).hold.code, 'SLICE_SOURCE_UNSAFE');
});
test('23. two names that differ only in case hold with SLICE_SOURCE_UNSAFE', () => {
  assert.equal(resolveSlice(def(), tree({ 'Notes.md': '# A', 'notes.md': '# B' })).hold.code, 'SLICE_SOURCE_UNSAFE');
});
test('24. a non-UTF-8 file is left out and counted', () => {
  const r = resolveSlice(def({ include: ['**/*.md', '*.png'] }), tree({ 'a.md': '# A', 'p.png': Buffer.from([0x89, 0xff, 0xfe, 0x00, 0xc3]) }));
  assert.deepEqual(members(r), ['a.md']); assert.equal(r.notes.notText, 1);
});
test('25. a path with a backtick is left out and counted', () => {
  const r = resolveSlice(def(), tree({ 'a.md': '# A', 'b`c.md': '# B', 'line\nbreak.md': '# C', 'tab\tname.md': '# D' }));
  assert.deepEqual(members(r), ['a.md']); assert.equal(r.notes.notText, 3);
});
test('26. a file over 1 MiB is listed without a summary, and its links are not followed', () => {
  const big = '# Big\n[[small]]\n'; const t = tree({ 'big.md': { text: big, size: 2 * 1048576 }, 'small.md': '# Small' });
  const r = resolveSlice(def({ include: ['big.md'], links: { follow: ['wikilink'], depth: 1 } }), t);
  assert.deepEqual(members(r), ['big.md']); assert.equal(r.members[0].summary, null); assert.equal(r.members[0].oversize, true); assert.deepEqual(r.notes.oversize, ['big.md']);
  assert.deepEqual(t.reads, [], 'an oversize file is not read');
});
test('27. 257 members hold with SLICE_TOO_LARGE', () => {
  const spec = {}; for (let i = 0; i < 257; i++) spec[`f${String(i).padStart(3, '0')}.md`] = '# F';
  assert.equal(resolveSlice(def(), tree(spec)).hold.code, 'SLICE_TOO_LARGE');
  delete spec['f256.md']; assert.equal(resolveSlice(def(), tree(spec)).hold, null);
  assert.equal(resolveSlice(def({ maxFiles: 2 }), tree({ 'a.md': '#', 'b.md': '#', 'c.md': '#' })).hold.code, 'SLICE_TOO_LARGE');
});
test('28. more than 8192 walked entries hold with SLICE_TOO_LARGE', () => {
  const spec = {}; for (let d = 0; d < 9; d++) for (let i = 0; i < 1000; i++) spec[`d${d}/f${i}.txt`] = 'x';
  assert.equal(resolveSlice(def({ include: ['d0/f1*.txt'] }), tree(spec)).hold, null, 'only folders the include can reach are walked');
  assert.equal(resolveSlice(def({ include: ['**/*.md'] }), tree(spec)).hold.code, 'SLICE_TOO_LARGE');
});
test('walking deeper than 16 levels holds with SLICE_TOO_LARGE', () => {
  const deep = Array.from({ length: 17 }, (_, i) => 'd' + i).join('/');
  assert.equal(resolveSlice(def(), tree({ [deep + '/x.md']: '#' })).hold.code, 'SLICE_TOO_LARGE');
  const ok16 = Array.from({ length: 16 }, (_, i) => 'd' + i).join('/');
  assert.equal(resolveSlice(def(), tree({ [ok16 + '/x.md']: '#' })).hold, null);
});
test('29. paths whose JSON passes 196608 bytes hold with SLICE_TOO_LARGE', () => {
  const spec = {}; const seg = i => 's'.repeat(28) + String(i).padStart(2, '0');
  for (let c = 0; c < 100; c++) spec[Array.from({ length: 15 }, (_, i) => `${seg(i)}${c}`).join('/') + '/f.md'] = '# F';
  assert.equal(resolveSlice(def(), tree(spec)).hold.code, 'SLICE_TOO_LARGE');
});
test('30. zero members hold with SLICE_EMPTY', () => {
  assert.equal(resolveSlice(def({ include: ['**/*.md', '**/*.txt'] }), tree({ 'a.png': Buffer.from([0xff]) })).hold.code, 'SLICE_EMPTY');
  assert.equal(resolveSlice(def(), tree({})).hold.code, 'SLICE_EMPTY');
});
test('31. a covered folder is reported when all its files are members', () => {
  const r = resolveSlice(def(), tree({ 'a/x.md': '#', 'a/y.md': '#', 'b/z.md': '#', 'b/pic.png': Buffer.from([0xff]) }));
  assert.deepEqual(r.covered, ['a/']);
});
test('32. a folder with a hidden file is not covered', () => {
  const r = resolveSlice(def(), tree({ 'a/x.md': '#', 'a/.keep': '', 'b/y.md': '#' }));
  assert.deepEqual(r.covered, ['b/']);
});
test('33. a folder with a pruned subfolder is not covered', () => {
  const r = resolveSlice(def({ include: ['a/*.md'] }), tree({ 'a/x.md': '#', 'a/sub/z.md': '#', 'a/other.md': '#' }));
  assert.deepEqual(members(r), ['a/other.md', 'a/x.md']); assert.deepEqual(r.covered, []);
});
test('34. the root is covered as ./ when all its files are members', () => {
  const r = resolveSlice(def(), tree({ 'a.md': '#', 'sub/b.md': '#' })); assert.deepEqual(r.covered, ['./', 'sub/']);
});
test('35. a file changed during the read is detected', () => {
  assert.throws(() => resolveSlice(def(), tree({ 'a.md': '#' }, { close() { throw new Error('STALE'); } })), /STALE/);
});
test('a folder with a link is not covered, and a link that no pattern selects is skipped', () => {
  const r = resolveSlice(def(), tree({ 'a/x.md': '#', 'a/l.txt': { type: 'link' }, 'b/y.md': '#' }));
  assert.equal(r.hold, null); assert.deepEqual(r.covered, ['b/']);
});
test('summaries: heading, frontmatter key, none, cut and cleaned', () => {
  const long = '# ' + 'x'.repeat(200), t = tree({ 'a.md': fm('title: Hello  World', '\n\n# The\theading \u202E here  \n'), 'b.md': long, 'c.md': 'no heading here', 'd.md': 'x\n'.repeat(70) + '# too late' });
  const by = r => Object.fromEntries(r.members.map(m => [m.path, m.summary]));
  assert.deepEqual(by(resolveSlice(def(), t)), { 'a.md': 'The heading here', 'b.md': 'x'.repeat(160), 'c.md': null, 'd.md': null });
  assert.equal(by(resolveSlice(def({ summary: { kind: 'frontmatter', key: 'title' } }), t))['a.md'], 'Hello World');
  assert.equal(by(resolveSlice(def({ summary: { kind: 'none' } }), t))['a.md'], null);
});
test('a text file that is not markdown can still have a heading summary', () => {
  const r = resolveSlice(def({ include: ['*.txt'] }), tree({ 'a.txt': '# From text\nbody' })); assert.equal(r.members[0].summary, 'From text');
});
test('the same input gives the same resolution', () => {
  const spec = { 'b.md': '# B', 'a.md': '# A', 'c/d.md': '# D' };
  assert.deepEqual(resolveSlice(def(), tree(spec)), resolveSlice(def(), tree(spec)));
});
test('read bytes pass 32 MiB hold with SLICE_TOO_LARGE', () => {
  const spec = {}; for (let i = 0; i < 40; i++) spec[`f${i}.md`] = { text: '# F', size: 1000000 };
  // 40 members of nearly 1 MB each are read in full by the fake, so the reader reports the size it returns.
  const t = tree(spec); const original = t.read; t.read = p => { t.reads.push(p); return Buffer.alloc(1000000, 0x61); };
  assert.equal(resolveSlice(def({ maxFiles: 256 }), t).hold.code, 'SLICE_TOO_LARGE'); void original;
});

test('C2. maxFiles holds after links are followed and for files over 1 MiB', () => {
  const spec = {}; for (let i = 0; i < 257; i++) spec[`big${String(i).padStart(3, '0')}.md`] = { text: '# Big', size: 2 * 1048576 };
  assert.equal(resolveSlice(def(), tree(spec)).hold.code, 'SLICE_TOO_LARGE', '257 files over 1 MiB');
  const linked = tree({ 'a.md': '[[b]] [[c]] [[d]]', 'b.md': '#', 'c.md': '#', 'd.md': '#' });
  assert.equal(resolveSlice(def({ include: ['a.md'], maxFiles: 3, links: { follow: ['wikilink'], depth: 1 } }), linked).hold.code, 'SLICE_TOO_LARGE', 'links push past maxFiles');
  assert.equal(resolveSlice(def({ include: ['a.md'], maxFiles: 4, links: { follow: ['wikilink'], depth: 1 } }), linked).hold, null);
  const mixed = tree({ 'a.md': '[[big]]', 'big.md': { text: '# B', size: 3 * 1048576 } });
  assert.equal(resolveSlice(def({ include: ['a.md'], maxFiles: 1, links: { follow: ['wikilink'], depth: 1 } }), mixed).hold.code, 'SLICE_TOO_LARGE', 'a linked file over 1 MiB counts');
});
test('C6. a link that resolves to a file already found is not added twice (a name in another case on a case-insensitive disk)', () => {
  const t = tree({ 'a.md': '[x](A.md) [y](b.md)', 'b.md': '# B' }, { alias: { 'A.md': 'a.md', 'B.MD': 'b.md' } });
  const r = resolveSlice(def({ include: ['a.md'], links: { follow: ['markdown'], depth: 2 } }), t);
  assert.deepEqual(r.members.map(m => m.path), ['a.md', 'b.md']); assert.deepEqual(t.reads.filter(p => p === 'A.md'), []);
});
test('S7. special entries, unselected links, oversize files under where, and truncated links are counted in the notes', () => {
  const t = tree({ 'a.md': '# A', 'l.txt': { type: 'link' }, 'fifo.pipe': { type: 'other' }, 'big.md': { text: '---\nx: 1\n---\n', size: 2 * 1048576 } });
  const r = resolveSlice(def({ where: { x: ['1'] } }), t);
  assert.equal(r.notes.skippedEntries, 2, 'a link that no pattern selects and a special file'); assert.deepEqual(r.notes.oversize, ['big.md'], 'where cannot read an oversize file, so it is named');
  assert.deepEqual(r.members.map(m => m.path), []);
  const many = tree({ 'a.md': '[[b]] '.repeat(600), 'b.md': '#' }); const m = resolveSlice(def({ include: ['a.md'], links: { follow: ['wikilink'], depth: 1 } }), many);
  assert.equal(m.notes.truncatedLinks, 1);
});
