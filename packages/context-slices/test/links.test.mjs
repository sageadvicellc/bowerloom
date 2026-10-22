// Spec 05, section 3.5 step 6: finding links outside code.
import test from 'node:test';
import assert from 'node:assert/strict';
import { extractLinks, scanLinks } from '../../../dist/packages/context-slices/src/links.js';

test('all five forms are found in order', () => {
  const text = 'a [[one]] b [[two|alias]] c [[three#heading]] d ![[four]] e [x](five/six.md#anchor) f';
  assert.deepEqual(extractLinks(text), [
    { kind: 'wikilink', target: 'one' }, { kind: 'wikilink', target: 'two' }, { kind: 'wikilink', target: 'three' },
    { kind: 'wikilink', target: 'four' }, { kind: 'markdown', target: 'five/six.md#anchor' },
  ]);
});
test('fenced code blocks and inline code spans are skipped', () => {
  const text = '```\n[[fenced]]\n```\n~~~md\n[x](fenced2.md)\n~~~\n`[[span]]` and ``[x](span2.md)`` and [[kept]]\n';
  assert.deepEqual(extractLinks(text), [{ kind: 'wikilink', target: 'kept' }]);
});
test('a fence closes only on a matching fence, and an unclosed fence runs to the end', () => {
  assert.deepEqual(extractLinks('````\n```\n[[in]]\n````\n[[out]]'), [{ kind: 'wikilink', target: 'out' }]);
  assert.deepEqual(extractLinks('```\n[[in]]\n[[also]]'), []);
});
test('an empty target and a same-page anchor are not links', () => { assert.deepEqual(extractLinks('[[#heading]] [[ ]] [[|alias]]'), []); });
test('an unmatched backtick does not hide the rest', () => { assert.deepEqual(extractLinks('a ` [[x]]'), [{ kind: 'wikilink', target: 'x' }]); });
test('a title and an angle-bracket destination are read', () => {
  assert.deepEqual(extractLinks('[a](b.md "Title") [c](<d e.md>)'), [{ kind: 'markdown', target: 'b.md' }, { kind: 'markdown', target: 'd e.md' }]);
});
test('a code span can run across lines', () => { assert.deepEqual(extractLinks('`a\n[[x]]` [[y]]'), [{ kind: 'wikilink', target: 'y' }]); });
test('at most 512 links are returned, and the cut is reported', () => {
  assert.equal(extractLinks('[[a]] '.repeat(600)).length, 512); assert.equal(scanLinks('[[a]] '.repeat(600)).truncated, true);
  assert.equal(scanLinks('[[a]] '.repeat(512)).truncated, false); assert.equal(scanLinks('[[a]] '.repeat(513)).truncated, true);
});
