// Spec 05, section 10.6: the instruction chain of an agent.
import test from 'node:test';
import assert from 'node:assert/strict';
import { instructionFiles, parseImports, onDemandInstructions } from '../../../dist/packages/context-slices/src/instructions.js';

/** A reader over an object of path -> text. `ids` maps a path to a shared identity (a hard link). */
const mem = (files, ids = {}) => ({
  read: p => (Object.hasOwn(files, p) ? { text: files[p], id: ids[p] ?? p } : null),
  list: d => { const prefix = d === '/' ? '/' : d + '/', out = new Set(); for (const p of Object.keys(files)) if (p.startsWith(prefix) && !p.slice(prefix.length).includes('/')) out.add(p.slice(prefix.length)); return out.size ? [...out] : null; },
});
const OPT = { omitClaudeMd: false, user: false, home: '/home/u' };
const paths = r => r.files.map(f => f.path);

test('1. a CLAUDE.md anywhere in the chain stops AGENTS.md from counting', () => {
  const r = instructionFiles('/a/b', OPT, mem({ '/a/b/AGENTS.md': 'agents', '/a/CLAUDE.md': 'claude', '/AGENTS.md': 'root' }));
  assert.deepEqual(paths(r), ['/a/CLAUDE.md']); assert.equal(r.usesAgents, false);
  assert.deepEqual(paths(instructionFiles('/a/b', OPT, mem({ '/a/b/.claude/CLAUDE.md': 'c', '/a/AGENTS.md': 'x' }))), ['/a/b/.claude/CLAUDE.md']);
  assert.deepEqual(paths(instructionFiles('/a/b', OPT, mem({ '/a/CLAUDE.local.md': 'local', '/a/b/AGENTS.md': 'x' }))), ['/a/CLAUDE.local.md']);
});
test('2. without CLAUDE.md, AGENTS.md counts at every level', () => {
  const r = instructionFiles('/a/b', OPT, mem({ '/a/b/AGENTS.md': '1', '/a/.claude/AGENTS.md': '22', '/AGENTS.md': '333' }));
  assert.deepEqual(paths(r).sort(), ['/AGENTS.md', '/a/.claude/AGENTS.md', '/a/b/AGENTS.md']); assert.equal(r.usesAgents, true);
  assert.equal(r.files.reduce((n, f) => n + f.bytes, 0), 6);
});
test('3. @path imports count to four hops and stop at the fifth', () => {
  const files = { '/p/CLAUDE.md': '@h1.md', '/p/h1.md': '@h2.md', '/p/h2.md': '@h3.md', '/p/h3.md': '@h4.md', '/p/h4.md': '@h5.md', '/p/h5.md': 'deep' };
  assert.deepEqual(paths(instructionFiles('/p', OPT, mem(files))), ['/p/CLAUDE.md', '/p/h1.md', '/p/h2.md', '/p/h3.md', '/p/h4.md']);
});
test('4. an import inside a code span or a fence is skipped', () => {
  const files = { '/p/CLAUDE.md': 'use `@span.md` and\n```\n@fenced.md\n```\n@real.md\n', '/p/span.md': 's', '/p/fenced.md': 'f', '/p/real.md': 'r' };
  assert.deepEqual(paths(instructionFiles('/p', OPT, mem(files))), ['/p/CLAUDE.md', '/p/real.md']);
});
test('5. @my\\ notes.md imports the file my notes.md', () => {
  assert.deepEqual(parseImports('see @my\\ notes.md now'), ['my notes.md']);
  assert.deepEqual(paths(instructionFiles('/p', OPT, mem({ '/p/CLAUDE.md': '@my\\ notes.md', '/p/my notes.md': 'n' }))), ['/p/CLAUDE.md', '/p/my notes.md']);
});
test('6. a@b.com in prose is not an import', () => { assert.deepEqual(parseImports('mail a@b.com or (@no.md)'), []); assert.deepEqual(parseImports('@start.md and\n@next.md\n\t@tab.md'), ['start.md', 'next.md', 'tab.md']); });
test('7. a rule with no paths counts at start, and a rule with paths does not', () => {
  const files = { '/p/CLAUDE.md': 'x', '/p/.claude/rules/always.md': 'always', '/p/.claude/rules/scoped.md': '---\npaths:\n  - "src/**"\n---\nscoped', '/.claude/rules/top.md': 'top', '/p/.claude/rules/other.txt': 'no' };
  assert.deepEqual(paths(instructionFiles('/p', OPT, mem(files))).sort(), ['/.claude/rules/top.md', '/p/.claude/rules/always.md', '/p/CLAUDE.md']);
});
test('8. omitClaudeMd gives zero files at start', () => {
  const files = { '/p/CLAUDE.md': 'x', '/p/AGENTS.md': 'y', '/p/.claude/rules/a.md': 'r' };
  assert.deepEqual(instructionFiles('/p', { ...OPT, omitClaudeMd: true }, mem(files)).files, []);
  assert.equal(instructionFiles('/p', OPT, mem(files)).files.length, 2);
});
test('9. a subfolder AGENTS.md between --from and a member counts on demand', () => {
  const files = { '/p/CLAUDE.md': 'x', '/p/wiki/CLAUDE.md': 'sub', '/p/wiki/deep/CLAUDE.md': 'deeper', '/p/other/CLAUDE.md': 'no' }, reader = mem(files);
  const start = instructionFiles('/p', OPT, reader);
  assert.deepEqual(paths(onDemandInstructions('/p', ['/p/wiki/deep/a.md'], OPT, reader, start)), ['/p/wiki/CLAUDE.md', '/p/wiki/deep/CLAUDE.md']);
  const agents = mem({ '/p/AGENTS.md': 'x', '/p/wiki/AGENTS.md': 'sub', '/p/wiki/.claude/AGENTS.md': 'sub2' }), s2 = instructionFiles('/p', OPT, agents);
  assert.deepEqual(paths(onDemandInstructions('/p', ['/p/wiki/a.md'], OPT, agents, s2)).sort(), ['/p/wiki/.claude/AGENTS.md', '/p/wiki/AGENTS.md']);
  assert.deepEqual(paths(onDemandInstructions('/p', ['/q/kb/a.md'], OPT, mem({ '/p/CLAUDE.md': 'x', '/q/kb/CLAUDE.md': 'kb', '/q/CLAUDE.md': 'q' }), start)), ['/q/CLAUDE.md', '/q/kb/CLAUDE.md']);
  assert.deepEqual(paths(onDemandInstructions('/p', ['/p/a.md'], OPT, reader, start)), [], 'a member in the start folder adds none');
});
test('10. a file reached twice counts once', () => {
  const r = instructionFiles('/p', OPT, mem({ '/p/CLAUDE.md': '@AGENTS.md\n@AGENTS.md', '/p/AGENTS.md': 'twice' }, {}));
  assert.deepEqual(paths(r), ['/p/CLAUDE.md', '/p/AGENTS.md']);
  const linked = instructionFiles('/p/sub', OPT, mem({ '/p/AGENTS.md': 'same', '/p/sub/AGENTS.md': 'same' }, { '/p/AGENTS.md': 'id1', '/p/sub/AGENTS.md': 'id1' }));
  assert.equal(linked.files.length, 1);
});
test('a missing or non-file import is skipped and listed', () => {
  const r = instructionFiles('/p', OPT, mem({ '/p/CLAUDE.md': '@missing.md @ok.md', '/p/ok.md': 'ok' }));
  assert.deepEqual(paths(r), ['/p/CLAUDE.md', '/p/ok.md']); assert.deepEqual(r.skippedImports, [{ from: '/p/CLAUDE.md', target: 'missing.md' }]);
});
test('with user, ~/.claude/CLAUDE.md and its rules count, and omitClaudeMd removes them', () => {
  const files = { '/home/u/.claude/CLAUDE.md': 'user', '/home/u/.claude/rules/r.md': 'rule', '/p/CLAUDE.md': 'p' };
  assert.deepEqual(paths(instructionFiles('/p', { ...OPT, user: true }, mem(files))).sort(), ['/home/u/.claude/CLAUDE.md', '/home/u/.claude/rules/r.md', '/p/CLAUDE.md']);
  assert.deepEqual(paths(instructionFiles('/p', OPT, mem(files))), ['/p/CLAUDE.md']);
  assert.deepEqual(instructionFiles('/p', { ...OPT, user: true, omitClaudeMd: true }, mem(files)).files, []);
});
test('a ~/ import resolves against the home folder', () => {
  assert.deepEqual(paths(instructionFiles('/p', OPT, mem({ '/p/CLAUDE.md': '@~/shared.md', '/home/u/shared.md': 's' }))), ['/p/CLAUDE.md', '/home/u/shared.md']);
});
