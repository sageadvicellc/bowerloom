// Definition spec section 10, rules 4 to 6, across engines: an identical entry from two engines is one item with two
// places; the same entry that differs between engines is shown side by side and never picked by import order.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadDefinition } from '../../../dist/packages/harness-definition/src/index.js';
import { applyAdoption, planAdoption } from '../../../dist/packages/adoption/src/index.js';
import { code, item, json, project } from './fixture.mjs';

const CC_OC = [{ id: 'claude-code' }, { id: 'opencode' }];
const CC_CX = [{ id: 'claude-code' }, { id: 'codex' }];

test('the same MCP server in two engines merges into one item with both places and no filter', t => {
  const p = project(t, {
    '.mcp.json': json({ mcpServers: { docs: { command: 'npx', args: ['-y', 'example-docs-mcp'] } } }),
    'opencode.json': json({ mcp: { docs: { type: 'local', command: ['npx', '-y', 'example-docs-mcp'] } } }),
  });
  const plan = planAdoption(p.input({ engines: CC_OC }));
  const docs = item(plan, 'mcp', 'docs');
  assert.deepEqual(docs.places.map(x => [x.path, x.engines]), [['.mcp.json', ['claude-code']], ['opencode.json', ['opencode']]]);
  assert.equal(docs.engines, null);
  assert.deepEqual(plan.conflicts, []);
});

test('the same MCP server that differs between engines is shown side by side; keeping both filters each to its engine', async t => {
  const files = {
    '.mcp.json': json({ mcpServers: { docs: { command: 'npx', args: ['-y', 'example-docs-mcp@1'] } } }),
    'opencode.json': json({ mcp: { docs: { type: 'local', command: ['npx', '-y', 'example-docs-mcp@2'] } } }),
  };
  // The order the files are found in never decides: both orders of the same content give the same plan.
  const p = project(t, files);
  const plan = planAdoption(p.input({ engines: CC_OC }));
  assert.equal(plan.ready, false);
  assert.deepEqual(plan.conflicts.map(c => [c.key, c.variants.map(v => v.key), c.options]), [['mcp/docs', ['.mcp.json#/mcpServers/docs', 'opencode.json#/mcp/docs'], ['pick', 'rename']]]);
  const input = p.input({ engines: CC_OC, choices: { 'mcp/docs': { rename: { 'opencode.json#/mcp/docs': 'docs-opencode' } } } });
  const both = planAdoption(input);
  assert.deepEqual([item(both, 'mcp', 'docs').engines, item(both, 'mcp', 'docs-opencode').engines], [['claude-code'], ['opencode']]);
  await applyAdoption(input, both.revision, both.approvalsRequired);
  const def = loadDefinition(p.def).definition;
  assert.deepEqual(def.entries.mcp.map(s => [s.name, s.args, s.engines]), [['docs', ['-y', 'example-docs-mcp@1'], ['claude-code']], ['docs-opencode', ['-y', 'example-docs-mcp@2'], ['opencode']]]);
});

test('a rule whose effect differs between engines: both are kept, each for its engine, and the plan shows the difference', async t => {
  const p = project(t, {
    '.claude/settings.json': json({ permissions: { deny: ['Bash(rm -rf *)'], ask: ['Bash(git push *)'] } }),
    'opencode.json': json({ permission: { bash: { 'rm -rf *': 'ask', 'git push *': 'ask' } } }),
  });
  const plan = planAdoption(p.input({ engines: CC_OC }));
  assert.equal(plan.ready, true);
  assert.deepEqual(plan.differences.map(d => [d.action, d.pattern, d.rules.map(r => [r.effect, r.engines])]), [
    ['shell', 'rm -rf *', [['ask', ['opencode']], ['deny', ['claude-code']]]],
  ]);
  const push = plan.items.filter(i => i.part === 'guardrails' && i.places.some(x => x.pointer?.includes('git push')  || x.pointer === '/permissions/ask/0'));
  assert.equal(push.length, 1, 'the identical ask rule from both engines is one item');
  assert.equal(push[0].engines, null);
  await applyAdoption(p.input({ engines: CC_OC }), plan.revision, plan.approvalsRequired);
  const def = loadDefinition(p.def).definition;
  assert.deepEqual(def.entries.rules.map(r => [r.pattern, r.effect, r.engines ?? null]).sort(), [['git push *', 'ask', null], ['rm -rf *', 'ask', ['opencode']], ['rm -rf *', 'deny', ['claude-code']]]);
});

test('an identical hook from Claude Code and Codex is one item; a sandbox that differs is a conflict a person picks', t => {
  const hooks = { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: '${CLAUDE_PROJECT_DIR}/scripts/check.sh', timeout: 5 }] }] };
  const p = project(t, {
    '.claude/settings.json': json({ hooks, sandbox: { enabled: true } }),
    '.codex/hooks.json': json({ hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: '$(git rev-parse --show-toplevel)/scripts/check.sh', timeout: 5 }] }] } }),
    '.codex/config.toml': 'sandbox_mode = "workspace-write"\n[sandbox_workspace_write]\nnetwork_access = true\n',
  });
  const plan = planAdoption(p.input({ engines: CC_CX }));
  const hookItems = plan.items.filter(i => i.part === 'hooks');
  assert.equal(hookItems.length, 1);
  assert.deepEqual(hookItems[0].places.map(x => x.path), ['.claude/settings.json', '.codex/hooks.json']);
  assert.deepEqual(plan.conflicts.map(c => [c.key, c.options]), [['guardrails/sandbox', ['pick']]]);
  assert.throws(() => planAdoption(p.input({ engines: CC_CX, choices: { 'guardrails/sandbox': { rename: { '.codex/config.toml#/sandbox_mode': 'box' } } } })), code('ADOPTION_CHOICE_INVALID'));
  const picked = planAdoption(p.input({ engines: CC_CX, choices: { 'guardrails/sandbox': { pick: '.claude/settings.json#/sandbox' } } }));
  assert.equal(picked.ready, true);
  assert.equal(item(picked, 'guardrails', 'sandbox').engines, null);
});
