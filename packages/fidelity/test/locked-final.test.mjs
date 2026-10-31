// Final round of the step 3 translations: items D3, D4, and D5 of the verification review. Synthetic entries only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { translateMcp, translateSubagents } from '../../../dist/packages/fidelity/src/index.js';

const server = (name, extra = {}) => ({ id: name, name, transport: 'stdio', command: 'docs-mcp', privateBlocks: {}, ...extra });
const agent = (id, extra = {}) => ({ id, name: id, description: `The ${id} subagent.`, body: `Act as ${id}.\n`, privateBlocks: {}, ...extra });
const entryLine = (t, entry) => t.lines.find(l => l.entry === entry && l.field === undefined);
const fieldLine = (t, entry, field) => t.lines.find(l => l.entry === entry && l.field === field);

test('D3: an empty tool limit writes no OpenCode agent file either; both lines are absent and say why', () => {
  const t = translateSubagents('opencode', [agent('none', { tools: [] })]);
  assert.equal(t.subagents.length, 0);
  assert.equal(fieldLine(t, 'none', 'tools').result, 'absent');
  assert.equal(entryLine(t, 'none').result, 'absent'); assert.match(entryLine(t, 'none').reason, /not written/);
});

test('D4: the OpenCode substitution check reads object keys of a private block too', () => {
  const t = translateMcp('opencode', [server('docs', { privateBlocks: { opencode: { oauth: { '{env:K}': 1 } } } })]);
  assert.deepEqual(t.problems, [{ part: 'mcp', entry: 'docs', code: 'OPENCODE_SUBSTITUTION' }]);
});

test('D5: {env: or {file: in any string of an OpenCode agent frontmatter is refused; the body is not scanned', () => {
  for (const extra of [{ description: 'Reads {env:HOME}.' }, { model: { opencode: 'p/{file:m}' } }, { privateBlocks: { opencode: { color: '{env:C}' } } }]) {
    const t = translateSubagents('opencode', [agent('x', extra)]);
    assert.deepEqual(t.problems, [{ part: 'subagents', entry: 'x', code: 'OPENCODE_SUBSTITUTION' }], JSON.stringify(extra));
    assert.equal(t.subagents.length, 0);
  }
  assert.deepEqual(translateSubagents('opencode', [agent('x', { body: 'Use {env:HOME}.\n' })]).problems, []);
  assert.deepEqual(translateSubagents('claude-code', [agent('x', { description: 'Reads {env:HOME}.' })]).problems, [], 'only OpenCode replaces it');
});
