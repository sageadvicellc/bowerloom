// Step 3 contract changes (harness definition README, "For the adoption lane"): an OpenCode agent's mode rides in its
// x-opencode block, and the subagent writer writes it back in place of the default `mode: subagent`. Synthetic entries.
import test from 'node:test';
import assert from 'node:assert/strict';
import { translateGuardrails, translateSubagents } from '../../../dist/packages/fidelity/src/index.js';

const agent = (id, extra = {}) => ({ id, name: id, description: `The ${id} subagent.`, body: `Act as ${id}.\n`, privateBlocks: {}, ...extra });
const modeOf = form => form.frontmatter.filter(([k]) => k === 'mode').map(([, v]) => v);

test('OpenCode: the mode of an x-opencode block replaces the default subagent mode, and nothing is dropped', () => {
  for (const mode of ['primary', 'subagent', 'all']) {
    const t = translateSubagents('opencode', [agent('lead', { privateBlocks: { opencode: { mode, temperature: 0.2 } } })]);
    assert.deepEqual(modeOf(t.subagents[0]), [mode], mode);
    assert.equal(t.lines.some(l => l.field === 'x-opencode'), false, 'no key of the block is dropped');
    assert.deepEqual(t.subagents[0].frontmatter.find(([k]) => k === 'temperature'), ['temperature', 0.2]);
    assert.match(t.lines.find(l => l.field === undefined).reason, new RegExp(`mode is ${mode}`));
  }
});

test('OpenCode: with no mode in the block the writer writes mode subagent; a mode OpenCode 1.x lacks is dropped and reported', () => {
  const plain = translateSubagents('opencode', [agent('plain')]);
  assert.deepEqual(modeOf(plain.subagents[0]), ['subagent']);
  const odd = translateSubagents('opencode', [agent('odd', { privateBlocks: { opencode: { mode: 'background' } } })]);
  assert.deepEqual(modeOf(odd.subagents[0]), ['subagent']);
  assert.match(odd.lines.find(l => l.field === 'x-opencode').reason, /mode/);
});

test('Codex: a string justification in a rule\'s x-codex block is the justification of its prefix rule; else Bowerloom names the rule', () => {
  const rule = (id, privateBlocks) => ({ id, action: 'shell', pattern: 'git push *', effect: 'deny', strength: 'enforced', privateBlocks });
  const t = translateGuardrails('codex', { rules: [rule('own', { codex: { justification: 'No pushes.' } }), rule('plain', {}), rule('odd', { codex: { justification: 7 } })], sandbox: [] });
  assert.deepEqual(t.form.prefixRules.map(r => r.justification), ['No pushes.', 'Bowerloom guardrail plain', 'Bowerloom guardrail odd']);
});
