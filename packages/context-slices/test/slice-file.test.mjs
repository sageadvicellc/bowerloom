// Spec 05, section 10.2: the slice file.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSlice, isSliceId, SLICE_FORMAT, SLICE_LIMITS, SLICE_KEYS } from '../../../dist/packages/context-slices/src/slice-file.js';

const base = (extra = '') => `format: ${SLICE_FORMAT}\ndescription: A slice.\ninclude:\n  - "**/*.md"\n${extra}`;
const ok = (text, stem = 'wiki') => { const r = parseSlice(text, stem); assert.equal(r.ok, true, JSON.stringify(r)); return r.slice; };
const bad = (text, code = 'SLICE_INVALID', stem = 'wiki') => { const r = parseSlice(text, stem); assert.equal(r.ok, false, text); assert.equal(r.code, code, JSON.stringify(r)); return r; };

test('1. each key passes with a valid value', () => {
  const s = ok(`format: ${SLICE_FORMAT}
description: "Wiki pages: for \\"research\\""
root: wiki
include:
  - "a/**/*.md"
  - index.md
exclude:
  - "a/drafts/**"
where:
  status: current
  tags: [research, ops]
links:
  follow: [wikilink, markdown]
  depth: 2
summary: frontmatter:title
maxFiles: 10
guard: none
`);
  assert.deepEqual(s.root, { kind: 'project', path: 'wiki' }); assert.deepEqual(s.include, ['a/**/*.md', 'index.md']); assert.deepEqual(s.exclude, ['a/drafts/**']);
  assert.deepEqual(s.where, { status: ['current'], tags: ['research', 'ops'] }); assert.deepEqual(s.links, { follow: ['wikilink', 'markdown'], depth: 2 });
  assert.deepEqual(s.summary, { kind: 'frontmatter', key: 'title' }); assert.equal(s.maxFiles, 10); assert.equal(s.guard, 'none'); assert.equal(s.description, 'Wiki pages: for "research"');
});
test('2. each value rule fails with SLICE_INVALID for one bad value', () => {
  const cases = {
    format: 'format: other\ndescription: d\ninclude: ["a.md"]\n',
    description: `format: ${SLICE_FORMAT}\ndescription: ""\ninclude: ["a.md"]\n`,
    descriptionControl: `format: ${SLICE_FORMAT}\ndescription: "a\\u0007b"\ninclude: ["a.md"]\n`,
    descriptionLong: `format: ${SLICE_FORMAT}\ndescription: ${'x'.repeat(1025)}\ninclude: ["a.md"]\n`,
    rootType: base('root: 5\n'), rootMapNoRegistered: base('root:\n  path: x\n'), rootMapExtra: base('root:\n  registered: kb\n  other: x\n'), registeredBad: base('root:\n  registered: Bad_Name\n'),
    includeEmpty: `format: ${SLICE_FORMAT}\ndescription: d\ninclude: []\n`, includeType: `format: ${SLICE_FORMAT}\ndescription: d\ninclude: a.md\n`, includePattern: `format: ${SLICE_FORMAT}\ndescription: d\ninclude: ["[a].md"]\n`,
    include65: `format: ${SLICE_FORMAT}\ndescription: d\ninclude:\n${Array.from({ length: 65 }, (_, i) => `  - f${i}.md`).join('\n')}\n`,
    excludeBad: base('exclude: ["/abs"]\n'), whereEmpty: base('where: {}\n'), whereKey: base('where:\n  "a b": x\n'), whereValue: base('where:\n  a: 5\n'), whereList: base('where:\n  a: []\n'),
    linksNoFollow: base('links:\n  depth: 1\n'), linksEmpty: base('links:\n  follow: []\n'), linksRepeat: base('links:\n  follow: [wikilink, wikilink]\n'), linksKind: base('links:\n  follow: [html]\n'), linksDepth: base('links:\n  follow: [wikilink]\n  depth: 3\n'), linksExtra: base('links:\n  follow: [wikilink]\n  x: 1\n'),
    summary: base('summary: titles\n'), summaryKey: base('summary: frontmatter:\n'), maxFiles0: base('maxFiles: 0\n'), maxFiles257: base('maxFiles: 257\n'), maxFilesFloat: base('maxFiles: 1.5\n'), guard: base('guard: strict\n'),
  };
  for (const [name, text] of Object.entries(cases)) { const r = parseSlice(text, 'wiki'); assert.equal(r.ok, false, name); assert.equal(r.code, 'SLICE_INVALID', name); }
});
test('3. an unknown key is SLICE_KEY_UNKNOWN, and a key with unsupported characters gets the fixed phrase', () => {
  const r = bad(base('includes: [a]\n'), 'SLICE_KEY_UNKNOWN'); assert.equal(r.detail, 'includes');
  const odd = bad(base('"a b": 1\n'), 'SLICE_KEY_UNKNOWN'); assert.equal(odd.detail, 'a key with unsupported characters');
  const first = bad(`format: x\nzzz: 1\ndescription: d\ninclude: [a.md]\n`, 'SLICE_KEY_UNKNOWN'); assert.equal(first.detail, 'zzz', 'keys are checked before values');
});
test('4. a missing format, description, or include is SLICE_INVALID', () => {
  bad(`description: d\ninclude: ["a.md"]\n`); bad(`format: ${SLICE_FORMAT}\ninclude: ["a.md"]\n`); bad(`format: ${SLICE_FORMAT}\ndescription: d\n`);
});
test('5. a byte order mark, a carriage return, and a null byte each give SLICE_INVALID', () => {
  bad('\uFEFF' + base()); bad(base().replace(/\n/g, '\r\n')); bad(base() + '\0');
});
test('6. a file of 16385 bytes gives SLICE_INVALID', () => {
  const text = base('# ' + 'x'.repeat(16385 - Buffer.byteLength(base('# ')) - 1) + '\n'); assert.equal(Buffer.byteLength(text), 16385); bad(text);
  const fits = base('# ' + 'x'.repeat(16384 - Buffer.byteLength(base('# ')) - 1) + '\n'); assert.equal(Buffer.byteLength(fits), 16384); ok(fits);
});
test('7. a duplicate key, an alias, and a merge key each give SLICE_INVALID', () => {
  bad(base('guard: root\nguard: none\n')); bad(base('x: &a 1\n').replace('x:', 'where:') + 'summary: *a\n'); bad(base('<<: {guard: none}\n'));
  bad(base('description: !!str x\n')); bad('- a\n- b\n'); bad('');
});
test('8. root: . and root: { registered: kb } give the defaults', () => {
  assert.deepEqual(ok(base('root: .\n')).root, { kind: 'project', path: '.' }); assert.deepEqual(ok(base()).root, { kind: 'project', path: '.' });
  assert.deepEqual(ok(base('root: { registered: kb }\n')).root, { kind: 'registered', name: 'kb', path: '.' });
  assert.deepEqual(ok(base('root: { registered: kb, path: wiki/x }\n')).root, { kind: 'registered', name: 'kb', path: 'wiki/x' });
  const s = ok(base()); assert.equal(s.summary.kind, 'heading'); assert.equal(s.guard, 'root'); assert.equal(s.maxFiles, 256); assert.deepEqual(s.exclude, []); assert.deepEqual(s.where, {}); assert.equal(s.links, null);
  assert.equal(ok(base('links: { follow: [markdown] }\n')).links.depth, 1);
});
test('9. root: ../x, root: .hidden, and root: /abs give SLICE_INVALID', () => {
  for (const r of ['../x', '.hidden', '/abs', 'a//b', 'a/', 'a/../b', 'a\\\\b', './a']) bad(base(`root: ${JSON.stringify(r)}\n`));
});
test('10. isSliceId accepts 57 characters, refuses 58, and refuses prompt-x', () => {
  assert.equal(isSliceId('a'.repeat(57)), true); assert.equal(isSliceId('a'.repeat(58)), false); assert.equal(isSliceId('prompt-x'), false);
  assert.equal(isSliceId('wiki-engineering'), true); for (const v of ['', 'Wiki', 'a--b', '-a', 'a-', 'a_b', 5, null]) assert.equal(isSliceId(v), false);
  bad(base(), 'SLICE_INVALID', 'Bad_Stem');
});
test('11. summary: frontmatter:title parses, and summary: frontmatter: fails', () => {
  assert.deepEqual(ok(base('summary: frontmatter:title\n')).summary, { kind: 'frontmatter', key: 'title' }); bad(base('summary: frontmatter:\n'));
  assert.deepEqual(ok(base('summary: none\n')).summary, { kind: 'none' });
});
test('limits and key list are the spec values', () => {
  assert.deepEqual(SLICE_KEYS, ['format', 'description', 'root', 'include', 'exclude', 'where', 'links', 'summary', 'maxFiles', 'guard']);
  assert.equal(SLICE_LIMITS.fileBytes, 16384); assert.equal(SLICE_LIMITS.referencesBytes, 196608); assert.equal(SLICE_LIMITS.indexBytes, 65536);
  assert.throws(() => { SLICE_LIMITS.slices = 1; }, TypeError);
});
test('detail never quotes file text', () => {
  const r = parseSlice(base('guard: "SECRET-VALUE"\n'), 'wiki'); assert.equal(r.ok, false); assert.doesNotMatch(JSON.stringify(r), /SECRET/);
});
