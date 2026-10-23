// Spec 05, section 10.4: the index skill and the slice template.
import test from 'node:test';
import assert from 'node:assert/strict';
import { renderSliceIndex, sliceTemplate } from '../../../dist/packages/context-slices/src/render.js';
import { parseSlice } from '../../../dist/packages/context-slices/src/slice-file.js';
import { def } from './tree-fixture.mjs';

const res = (members, extra = {}) => ({ members: members.map(([path, summary]) => ({ path, bytes: 10, summary: summary ?? null, oversize: false })), covered: [], notes: {}, hold: null, readBytes: 0, ...extra });
const HEAD = (id, description) => `---\nname: slice-${id}\ndescription: ${JSON.stringify(description)}\nuser-invocable: false\n---\n\n# Context slice ${id}\n\nBowerloom made this file from .bowerloom/slices/${id}.yaml. Do not edit it. Edit the slice file, then run bowerloom apply.\n\nThe files below are the context for your work. They stay where they are. Read a file with the Read tool when your task needs it. Paths are relative to the project folder, the nearest folder above your working folder that holds .bowerloom.\n\n`;
const GUARD = "Bowerloom's guard blocks a read under the source folder that this list does not name.\n";

test('1. golden bytes for a project root . slice with headings', () => {
  const text = renderSliceIndex('wiki', def({ description: 'Wiki pages for the lead.' }), res([['a.md', 'Alpha'], ['sub/b.md', 'Beta page']]), { source: 'the project folder', prefix: '' });
  assert.equal(text, HEAD('wiki', 'Wiki pages for the lead.') + `Source folder: the project folder\nFiles: 2\n${GUARD}\n- \`a.md\`: Alpha\n- \`sub/b.md\`: Beta page\n`);
});
test('2. golden bytes for a project root wiki slice', () => {
  const text = renderSliceIndex('eng', def({ description: 'Engineering.', root: { kind: 'project', path: 'wiki' } }), res([['a.md', 'Alpha'], ['x/y.md']]), { source: 'wiki', prefix: 'wiki' });
  assert.equal(text, HEAD('eng', 'Engineering.') + `Source folder: wiki\nFiles: 2\n${GUARD}\n- \`wiki/a.md\`: Alpha\n- \`wiki/x/y.md\`\n`);
});
test('3. golden bytes for a registered folder slice with ../knowledge-base/wiki paths', () => {
  const text = renderSliceIndex('kb', def({ description: 'KB.', root: { kind: 'registered', name: 'kb', path: 'wiki' } }), res([['a.md', 'Alpha']]), { source: '../knowledge-base/wiki (registered folder kb)', prefix: '../knowledge-base/wiki' });
  assert.equal(text, HEAD('kb', 'KB.') + `Source folder: ../knowledge-base/wiki (registered folder kb)\nFiles: 1\n${GUARD}\n- \`../knowledge-base/wiki/a.md\`: Alpha\n`);
});
test('4. the guard line appears for guard: root and not for guard: none', () => {
  const on = renderSliceIndex('w', def(), res([['a.md']]), { source: 'the project folder', prefix: '' }), off = renderSliceIndex('w', def({ guard: 'none' }), res([['a.md']]), { source: 'the project folder', prefix: '' });
  assert.match(on, /Bowerloom's guard blocks/); assert.doesNotMatch(off, /guard blocks/);
  assert.match(off, /Files: 1\n\n- `a.md`\n$/);
});
test('5. summary: none gives path-only lines', () => {
  const text = renderSliceIndex('w', def({ summary: { kind: 'none' } }), res([['a.md', 'ignored'], ['b.md', 'ignored']]), { source: 'the project folder', prefix: '' });
  assert.match(text, /\n- `a.md`\n- `b.md`\n$/); assert.doesNotMatch(text, /ignored/);
});
test('6. a description with a colon and quotes is written as a JSON string and parses back equal', () => {
  const description = 'Notes: the "lead" agent\'s view # not a comment';
  const text = renderSliceIndex('w', def({ description }), res([['a.md']]), { source: 'the project folder', prefix: '' });
  const line = text.split('\n')[2]; assert.equal(line, `description: ${JSON.stringify(description)}`); assert.equal(JSON.parse(line.slice('description: '.length)), description);
});
test('7. a summary of 200 characters is cut to 160 by the resolver, and the renderer prints what it is given', () => {
  const text = renderSliceIndex('w', def(), res([['a.md', 'x'.repeat(160)]]), { source: 'the project folder', prefix: '' }); assert.match(text, /: x{160}\n$/);
});
test('8. a path with spaces renders inside backticks', () => {
  assert.match(renderSliceIndex('w', def(), res([['My Page.md', 'T']]), { source: 'the project folder', prefix: '' }), /- `My Page.md`: T\n/);
});
test('9. no output holds an absolute path, a hash, or a size', () => {
  const text = renderSliceIndex('w', def(), res([['a.md', 'A']]), { source: 'the project folder', prefix: '' });
  assert.doesNotMatch(text, /\/Users|[a-f0-9]{32}|bytes|sha256/); assert.doesNotMatch(text, /\b10\b/);
});
test('10. the same input gives the same bytes twice', () => {
  const a = () => renderSliceIndex('w', def(), res([['a.md', 'A'], ['b.md']]), { source: 'the project folder', prefix: '' }); assert.equal(a(), a());
});
test('lines are sorted by path in byte order', () => {
  const text = renderSliceIndex('w', def(), res([['b.md'], ['B.md'], ['a.md']]), { source: 'the project folder', prefix: '' });
  assert.deepEqual(text.split('\n').filter(l => l.startsWith('- ')), ['- `B.md`', '- `a.md`', '- `b.md`']);
});
test('11. sliceTemplate output passes parseSlice for a project root, a registered folder, and three patterns', () => {
  const cases = [
    { root: { kind: 'project', path: '.' }, includes: ['**/*.md'] },
    { root: { kind: 'project', path: 'wiki/x y' }, includes: ['a/*.md', 'b.md', 'c\\*d.md'] },
    { root: { kind: 'registered', name: 'kb', path: 'wiki' }, includes: ['**/*.md', 'index.md', 'notes/**'] },
    { root: { kind: 'registered', name: 'kb', path: '.' }, includes: ['**/*.md'] },
  ];
  for (const input of cases) {
    const text = sliceTemplate(input), r = parseSlice(text, 'wiki'); assert.equal(r.ok, true, text + JSON.stringify(r));
    assert.deepEqual(r.slice.root, input.root); assert.deepEqual(r.slice.include, input.includes); assert.ok(text.endsWith('\n') && !text.endsWith('\n\n'));
  }
  assert.equal(sliceTemplate(cases[0]), 'format: bowerloom/context-slice/v1beta1\ndescription: Describe what this slice holds and which agents use it.\nroot: "."\ninclude:\n  - "**/*.md"\nsummary: heading\nguard: root\n');
  assert.equal(sliceTemplate(cases[2]).includes('root:\n  registered: kb\n  path: "wiki"\n'), true);
});
