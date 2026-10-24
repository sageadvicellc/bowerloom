// The line comparison of conflicting copies (setup-diff.ts): which lines to mark as changed, and how a path is cut for one line.
import test from 'node:test';
import assert from 'node:assert/strict';
import { diffLines, plainLines, splitLines, splitPath } from '../shared/proto/setup-diff.js';

test('a text is lines: line breaks of both kinds, no extra empty line at the end, nothing for an empty text', () => {
  assert.deepEqual(splitLines('a\nb\n'), ['a', 'b']);
  assert.deepEqual(splitLines('a\r\nb\rc'), ['a', 'b', 'c']);
  assert.deepEqual(splitLines(''), []);
  assert.deepEqual(splitLines('\n'), ['']);
  assert.deepEqual(splitLines('a\n\nb'), ['a', '', 'b'], 'a blank line in the middle stays');
});

test('the same text has no changed line, and nothing missing', () => {
  const d = diffLines('one\ntwo\nthree\n', 'one\ntwo\nthree');
  assert.equal(d.changed, 0); assert.equal(d.missing, 0); assert.deepEqual(d.lines.map(l => l.changed), [false, false, false]);
});

test('an edited line is marked changed, and the line it replaced counts as left out', () => {
  const d = diffLines('name: lantern\nrun the check\nclose the log', 'name: lantern\nrun the full check\nclose the log');
  assert.deepEqual(d.lines.map(l => [l.text, l.changed]), [['name: lantern', false], ['run the full check', true], ['close the log', false]]);
  assert.equal(d.changed, 1); assert.equal(d.missing, 1);
});

test('an added line is changed and nothing is missing; a removed line is missing and nothing is changed', () => {
  const added = diffLines('a\nb', 'a\nnew\nb');
  assert.deepEqual([added.changed, added.missing], [1, 0]); assert.deepEqual(added.lines.map(l => l.changed), [false, true, false]);
  const removed = diffLines('a\nold\nb', 'a\nb');
  assert.deepEqual([removed.changed, removed.missing], [0, 1]); assert.deepEqual(removed.lines.map(l => l.changed), [false, false]);
});

test('an empty copy, an empty base, and a copy that shares nothing', () => {
  const none = diffLines('a\nb', '');
  assert.deepEqual([none.lines.length, none.changed, none.missing], [0, 0, 2]);
  const fresh = diffLines('', 'a\nb');
  assert.deepEqual([fresh.changed, fresh.missing], [2, 0]);
  const apart = diffLines('a\nb', 'c\nd');
  assert.deepEqual([apart.changed, apart.missing], [2, 2]);
});

test('repeated lines are matched in order, so a moved line is changed once and not hidden by a twin', () => {
  const d = diffLines('x\ny\nx', 'x\nx\ny');
  assert.equal(d.changed, 1); assert.equal(d.missing, 1);
  assert.deepEqual(diffLines('x\nx\nx', 'x\nx').lines.map(l => l.changed), [false, false]);
});

test('words, spaces and capitals count: a line that differs by one space is a changed line', () => {
  assert.equal(diffLines('Keep the log', 'Keep the  log').changed, 1);
  assert.equal(diffLines('Keep the log', 'keep the log').changed, 1);
});

test('plainLines marks nothing, and a very long copy is still compared (with the looser rule)', () => {
  assert.deepEqual(plainLines('a\nb').map(l => l.changed), [false, false]);
  const big = Array.from({ length: 2500 }, (_, i) => `line ${i}`).join('\n'), other = big.replace('line 1000', 'line one thousand');
  const d = diffLines(big, other);
  assert.equal(d.lines.length, 2500); assert.equal(d.changed, 1); assert.equal(d.missing, 1);
});

test('special characters and long lines pass through as text', () => {
  const d = diffLines('é\u{1F600}\n<b>&"\'', 'é\u{1F600}\n<i>&"\'');
  assert.deepEqual(d.lines.map(l => l.text), ['é\u{1F600}', '<i>&"\'']); assert.equal(d.changed, 1);
});

test('a path is cut in two parts that join back into the path, and the end holds the last folder and the file', () => {
  for (const path of ['/Users/sample/Studio/.claude/skills/lantern-check/SKILL.md', '/a/b/c.md', '/a.md', 'a/b.md', 'file.md', '']) {
    const { head, tail } = splitPath(path);
    assert.equal(head + tail, path, path);
  }
  assert.deepEqual(splitPath('/Users/sample/Studio/.claude/skills/lantern-check/SKILL.md'), { head: '/Users/sample/Studio/.claude/skills', tail: '/lantern-check/SKILL.md' });
  assert.deepEqual(splitPath('/a.md'), { head: '', tail: '/a.md' });
});
