// Spec 05, section 10.1: the path pattern language.
import test from 'node:test';
import assert from 'node:assert/strict';
import { compilePattern, matchPattern, canMatchBelow, isLiteral } from '../../../dist/packages/context-slices/src/glob.js';

test('1. ** matches zero segments', () => { assert.equal(matchPattern('a/**/b.md', 'a/b.md'), true); });
test('2. ** matches many segments', () => { assert.equal(matchPattern('a/**/b.md', 'a/x/y/b.md'), true); assert.equal(matchPattern('a/**/b.md', 'a/x/y/c.md'), false); });
test('3. * does not cross /', () => { assert.equal(matchPattern('a/*.md', 'a/x/b.md'), false); assert.equal(matchPattern('a/*.md', 'a/b.md'), true); });
test('4. ? matches one character inside a segment', () => {
  assert.equal(matchPattern('a?.md', 'ab.md'), true); assert.equal(matchPattern('a?.md', 'a.md'), false); assert.equal(matchPattern('a?.md', 'abc.md'), false);
  assert.equal(matchPattern('?.md', '\u{1F600}.md'), true, 'one code point');
});
test('5. a wildcard never matches a segment that starts with a dot', () => {
  assert.equal(matchPattern('**/*.md', '.git/x.md'), false); assert.equal(matchPattern('*', '.hidden'), false);
  assert.equal(matchPattern('a/**', 'a/.obsidian/x.md'), false); assert.equal(matchPattern('**/*.md', 'a/.x.md'), false);
});
test('6. \\* matches a literal *', () => {
  assert.equal(matchPattern('a\\*b.md', 'a*b.md'), true); assert.equal(matchPattern('a\\*b.md', 'axb.md'), false);
  assert.equal(matchPattern('w\\\\iki/x.md', 'w\\iki/x.md'), true);
});
test('7. [, ], {, } and a leading ! are refused', () => {
  for (const p of ['[abc].md', 'a].md', '{a,b}.md', 'a}.md', '!a.md']) assert.equal(compilePattern(p).ok, false, p);
  assert.equal(compilePattern('\\[a\\].md').ok, true); assert.equal(compilePattern('a!b.md').ok, true);
});
test('8. a leading /, a leading ./, an empty segment, and .. are refused', () => {
  for (const p of ['/a.md', './a.md', 'a//b.md', 'a/', '..', 'a/../b.md', '', 'a/b/']) assert.equal(compilePattern(p).ok, false, JSON.stringify(p));
});
test('9. a segment that starts with a dot is refused', () => {
  for (const p of ['.github/*.md', 'a/.x.md', '.', 'a/.', '\\.hidden/x']) assert.equal(compilePattern(p).ok, false, p);
});
test('10. canMatchBelow', () => {
  assert.equal(canMatchBelow('wiki/**/*.md', 'wiki/x'), true); assert.equal(canMatchBelow('wiki/**/*.md', 'research'), false);
  assert.equal(canMatchBelow('wiki/**/*.md', ''), true); assert.equal(canMatchBelow('wiki/**/*.md', 'wiki'), true);
  assert.equal(canMatchBelow('index.md', ''), true); assert.equal(canMatchBelow('index.md', 'wiki'), false);
  assert.equal(canMatchBelow('a/b/c.md', 'a/b'), true); assert.equal(canMatchBelow('a/b/c.md', 'a/b/c.md'), false);
  assert.equal(canMatchBelow('**/*.md', 'a/.hidden'), false); assert.equal(canMatchBelow('a/**', 'a/x/y'), true);
});
test('11. isLiteral', () => {
  assert.equal(isLiteral('index.md'), true); assert.equal(isLiteral('*.md'), false); assert.equal(isLiteral('a?.md'), false);
  assert.equal(isLiteral('a\\*.md'), true); assert.equal(isLiteral('wiki/**/x.md'), false);
});
test('12. matching uses NFC', () => {
  const decomposed = 'cafe\u0301.md', composed = 'caf\u00e9.md';
  assert.equal(matchPattern(composed, decomposed), true); assert.equal(matchPattern(decomposed, composed), true);
  assert.equal(matchPattern('*.md', decomposed), true);
});
test('matching is case-sensitive', () => { assert.equal(matchPattern('Wiki/*.md', 'wiki/a.md'), false); });
test('a compiled pattern matches as its text does', () => {
  const c = compilePattern('a/**/*.md'); assert.equal(c.ok, true); assert.equal(matchPattern(c.pattern, 'a/b/c.md'), true);
});
