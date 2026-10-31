// Step 3 contract changes (harness definition README, "For the adoption lane"): an OpenCode agent's mode rides in its
// x-opencode block, and the subagent writer writes it back in place of the default `mode: subagent`. Synthetic entries.
import test from 'node:test';
import assert from 'node:assert/strict';
import { codexJustification, translateGuardrails, translateHooks, translateSubagents } from '../../../dist/packages/fidelity/src/index.js';

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

test('review item K1: a Claude Code hook whose matcher names no Claude Code tool is absent, and a partial one is weakened and writes the known names', () => {
  const hook = (id, matcher) => ({ id, event: 'PreToolUse', matcher, command: 'check', strength: 'enforced', privateBlocks: {} });
  const t = translateHooks('claude-code', [hook('none', 'apply_patch'), hook('some', 'Bash|apply_patch'), hook('all', 'Edit|Write|MultiEdit|NotebookEdit'), hook('mcp', 'mcp__docs__search')]);
  const line = id => t.lines.find(l => l.entry === id && l.field === undefined);
  assert.equal(line('none').result, 'absent');
  assert.match(line('none').reason, /apply_patch/);
  assert.equal(t.hooks.some(h => h.entry === 'none'), false, 'no hook is written that would never fire');
  assert.equal(line('some').result, 'weakened');
  assert.match(line('some').reason, /apply_patch/);
  assert.equal(t.hooks.find(h => h.entry === 'some').matcher, 'Bash');
  assert.equal(line('all').result, 'exact');
  assert.equal(line('mcp').result, 'exact');
});

test('review item K4: a justification with a format, line or paragraph separator, or C1 control character is not used; a used one is named as definition text', () => {
  const rule = (id, justification) => ({ id, action: 'shell', pattern: 'git push *', effect: 'deny', strength: 'enforced', privateBlocks: { codex: { justification } } });
  for (const bad of ['No​pushes', 'No‮pushes', 'No pushes', 'No pushes', 'No\u0085pushes', 'No\u009Fpushes', 'No﻿pushes']) {
    assert.equal(codexJustification({ justification: bad }), undefined, JSON.stringify(bad));
    assert.equal(translateGuardrails('codex', { rules: [rule('r', bad)], sandbox: [] }).form.prefixRules[0].justification, 'Bowerloom guardrail r');
  }
  assert.equal(codexJustification({ justification: 'Keine Pushes, bitte. ✓' }), 'Keine Pushes, bitte. ✓');
  const t = translateGuardrails('codex', { rules: [rule('own', 'No pushes.')], sandbox: [] });
  assert.match(t.lines.find(l => l.entry === 'own').reason, /justification .*comes from the definition/);
});
