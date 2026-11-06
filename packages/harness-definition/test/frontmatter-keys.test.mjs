// The frontmatter reader finds a repeated key in one pass over the parsed document, not by comparing each key with every earlier key (which took time in the square of the key
// count). The same answers as before, in linear time.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDocument } from 'yaml';
import { duplicateKey, readFrontmatter } from '../../../dist/packages/harness-definition/src/json.js';

const front = lines => `---\n${lines.join('\n')}\n---\n\nBody.\n`;

test('a repeated key is refused, at the top, in a nested map, and in a map inside a list', () => {
  for (const lines of [
    ['name: a', 'name: b'],
    ['name: a', 'meta:', '  k: 1', '  k: 2'],
    ['name: a', 'items:', '  - k: 1', '    k: 2'],
    ['name: a', '"name": b'],
    ['a: 1', 'b:', '  c:', '    d: 1', '    d: 2'],
  ]) {
    const r = readFrontmatter(front(lines));
    assert.equal(r.ok, false, lines.join(' / '));
    assert.equal(r.code, 'FRONTMATTER_INVALID');
    assert.match(r.message, /repeats a key/);
  }
});

test('the same key in two different maps, and keys of different types, are fine', () => {
  assert.equal(readFrontmatter(front(['a:', '  k: 1', 'b:', '  k: 2', 'c:', '  - k: 1', '  - k: 2'])).ok, true);
  assert.equal(readFrontmatter(front(['1: a', '"1": b', 'true: c', '"true": d'])).ok, true, 'the number 1 and the text "1" are two keys, as before');
  assert.equal(readFrontmatter(front(['name: a', 'description: b'])).ok, true);
});

test('a key that is a map or a list is refused, because after conversion it would be text and could hide a repeat', () => {
  const r = readFrontmatter(front(['? [a, b]', ': 1', '? {c: d}', ': 2']));
  assert.equal(r.ok, false);
  assert.match(r.message, /key that is not plain text/);
});

test('a document with 200,000 keys is checked in a moment, and a repeat at the end is found', () => {
  const keys = Array.from({ length: 200_000 }, (_, i) => `k${i}: v`);
  const began = performance.now();
  assert.equal(duplicateKey(parseDocument(keys.join('\n'), { uniqueKeys: false }).contents), null);
  assert.equal(duplicateKey(parseDocument([...keys, 'k0: again'].join('\n'), { uniqueKeys: false }).contents), 'repeat');
  assert.ok(performance.now() - began < 30_000, 'linear, with a wide margin for a loaded machine');
});

test('deep nesting does not overflow the stack of the check', () => {
  const deep = `${'['.repeat(40)}1${']'.repeat(40)}`;
  assert.equal(duplicateKey(parseDocument(`a: ${deep}\n`, { uniqueKeys: false }).contents), null);
  const nested = Array.from({ length: 60 }, (_, i) => `${' '.repeat(i * 2)}k${i}:`).join('\n');
  assert.equal(duplicateKey(parseDocument(`${nested}\n${' '.repeat(120)}v: 1\n`, { uniqueKeys: false }).contents), null);
});
