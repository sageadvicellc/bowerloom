// Decision D8B: "Use for every engine", one choice per part for guardrails, hooks, and MCP servers. The choice removes the
// engine filter from every item of that part, so the item applies to every engine the harness lists. A difference keeps
// its per-engine items, the choice is part of the plan input and its revision, and the plan counts what it widens.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadDefinition } from '../../../dist/packages/harness-definition/src/index.js';
import { applyAdoption, planAdoption } from '../../../dist/packages/adoption/src/index.js';
import { code, item, json, project } from './fixture.mjs';

const THREE = [{ id: 'claude-code' }, { id: 'codex' }, { id: 'opencode' }];
const CC_OC = [{ id: 'claude-code' }, { id: 'opencode' }];
const PARTS = ['guardrails', 'hooks', 'mcp'];
const hooks = { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo check', timeout: 5 }] }] };

/** A Claude Code project with one rule, one hook, and two servers: each item is read by Claude Code only. */
const claudeOnly = t => project(t, {
  '.claude/settings.json': json({ permissions: { deny: ['Bash(rm -rf:*)'] }, hooks }),
  '.mcp.json': json({ mcpServers: { files: { command: 'npx', args: ['-y', 'files-server'] }, lint: { command: 'lint-server', args: ['--fix'] } } }),
});
const ofPart = (plan, part) => plan.items.filter(i => i.part === part);
const summary = plan => plan.everyEngine.map(e => [e.part, e.chosen, e.widens, e.notWidened.length]);

test('D8B rule 1: without the choice the plan is as before; the plan counts what each part would widen', t => {
  const p = claudeOnly(t);
  const plan = planAdoption(p.input({ engines: THREE }));
  for (const part of PARTS) for (const i of ofPart(plan, part)) assert.deepEqual(i.engines, ['claude-code'], `${part}/${i.id}`);
  assert.deepEqual(summary(plan), [['guardrails', false, 1, 0], ['hooks', false, 1, 0], ['mcp', false, 2, 0]]);
  // An empty choice is no choice: the same plan, the same revision.
  assert.equal(planAdoption(p.input({ engines: THREE, everyEngine: [] })).revision, plan.revision);
});

for (const part of PARTS) {
  test(`D8B: "Use for every engine" for ${part} widens only that part`, t => {
    const p = claudeOnly(t);
    const plan = planAdoption(p.input({ engines: THREE, everyEngine: [part] }));
    for (const other of PARTS) {
      for (const i of ofPart(plan, other)) {
        if (other === part) { assert.equal(i.engines, null, `${other}/${i.id}`); assert.ok(i.notes.some(n => /every engine/.test(n)), i.notes.join(' ')); }
        else assert.deepEqual(i.engines, ['claude-code'], `${other}/${i.id}`);
      }
    }
    const row = plan.everyEngine.find(e => e.part === part);
    assert.equal(row.chosen, true);
    assert.equal(row.widens, part === 'mcp' ? 2 : 1);
    assert.equal(plan.ready, true);
  });
}

test('D8B: apply writes the widened items with no engine filter, and the definition loads', async t => {
  const p = claudeOnly(t);
  const input = p.input({ engines: THREE, everyEngine: ['mcp', 'guardrails', 'hooks'] });
  const plan = planAdoption(input);
  assert.deepEqual(summary(plan), [['guardrails', true, 1, 0], ['hooks', true, 1, 0], ['mcp', true, 2, 0]]);
  await applyAdoption(input, plan.revision, plan.approvalsRequired);
  const r = loadDefinition(p.def);
  assert.equal(r.ok, true, JSON.stringify(r.problems));
  const { entries } = r.definition;
  assert.deepEqual([...entries.rules, ...entries.hooks, ...entries.mcp].map(e => e.engines ?? null), [null, null, null, null]);
});

test('D8B rule 2: a rule whose effect differs between engines keeps its per-engine items; the plan lists each as not widened', async t => {
  const p = project(t, {
    '.claude/settings.json': json({ permissions: { deny: ['Bash(rm -rf *)'], ask: ['Bash(git push *)'] } }),
    'opencode.json': json({ permission: { bash: { 'rm -rf *': 'ask' } } }),
  });
  const plain = planAdoption(p.input({ engines: CC_OC }));
  const input = p.input({ engines: CC_OC, everyEngine: ['guardrails'] });
  const plan = planAdoption(input);
  assert.deepEqual(plan.differences, plain.differences, 'the choice never merges or drops a difference');
  const differing = plan.differences.flatMap(d => d.rules.map(r => r.id)).sort();
  assert.equal(differing.length, 2);
  for (const id of differing) assert.deepEqual(item(plan, 'guardrails', id).engines, item(plain, 'guardrails', id).engines);
  const row = plan.everyEngine.find(e => e.part === 'guardrails');
  assert.deepEqual(row.notWidened.map(n => n.id).sort(), differing);
  for (const n of row.notWidened) assert.match(n.reason, /differs between engines/);
  // The ask rule only Claude Code had is widened.
  const push = plan.items.filter(i => i.part === 'guardrails' && !differing.includes(i.id));
  assert.equal(push.length, 1); assert.equal(push[0].engines, null);
  assert.equal(row.widens, 1);
  await applyAdoption(input, plan.revision, plan.approvalsRequired);
  const rules = loadDefinition(p.def).definition.entries.rules.map(r => [r.pattern, r.effect, r.engines ?? null]).sort();
  assert.deepEqual(rules, [['git push *', 'ask', null], ['rm -rf *', 'ask', ['opencode']], ['rm -rf *', 'deny', ['claude-code']]]);
});

test('D8B rule 2: a server kept under two ids because it differs between engines keeps each filter', t => {
  const p = project(t, {
    '.mcp.json': json({ mcpServers: { docs: { command: 'npx', args: ['-y', 'example-docs-mcp@1'] } } }),
    'opencode.json': json({ mcp: { docs: { type: 'local', command: ['npx', '-y', 'example-docs-mcp@2'] } } }),
  });
  const choices = { 'mcp/docs': { rename: { 'opencode.json#/mcp/docs': 'docs-opencode' } } };
  const plan = planAdoption(p.input({ engines: CC_OC, choices, everyEngine: ['mcp'] }));
  assert.deepEqual([item(plan, 'mcp', 'docs').engines, item(plan, 'mcp', 'docs-opencode').engines], [['claude-code'], ['opencode']]);
  const row = plan.everyEngine.find(e => e.part === 'mcp');
  assert.deepEqual(row.notWidened.map(n => n.id), ['docs', 'docs-opencode']);
  for (const n of row.notWidened) assert.match(n.reason, /differs between/);
  assert.equal(row.widens, 0);
});

test('D8B rule 2: two engines with different hooks for the same event and matcher keep them per engine; the plan lists each as not widened', t => {
  const cc = { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo from-claude', timeout: 5 }] }, { matcher: 'Edit', hooks: [{ type: 'command', command: 'echo edit', timeout: 5 }] }] };
  const p = project(t, {
    '.claude/settings.json': json({ hooks: cc }),
    '.codex/hooks.json': json({ hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo from-codex', timeout: 5 }] }] } }),
  });
  const plan = planAdoption(p.input({ engines: THREE, everyEngine: ['hooks'] }));
  const hooksOf = plan.items.filter(i => i.part === 'hooks');
  assert.equal(hooksOf.length, 3);
  const byCommand = id => plan.items.find(i => i.part === 'hooks' && i.id === id);
  const row = plan.everyEngine.find(e => e.part === 'hooks');
  const kept = row.notWidened.map(n => n.id).sort();
  assert.equal(kept.length, 2, JSON.stringify(row));
  for (const n of row.notWidened) assert.match(n.reason, /different hook for the same event/);
  assert.deepEqual(kept.map(id => byCommand(id).engines).sort(), [['claude-code'], ['codex']], 'each engine keeps its own Bash hook');
  // The Edit hook has no other version in another engine, so it is widened.
  const edit = hooksOf.find(i => !kept.includes(i.id));
  assert.equal(edit.engines, null);
  assert.equal(row.widens, 1);
});

test('D8B: an identical hook from two engines merges into one item and is widened', t => {
  const hooks = { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: '${CLAUDE_PROJECT_DIR}/scripts/check.sh', timeout: 5 }] }] };
  const p = project(t, {
    '.claude/settings.json': json({ hooks }),
    '.codex/hooks.json': json({ hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: '$(git rev-parse --show-toplevel)/scripts/check.sh', timeout: 5 }] }] } }),
  });
  const plain = planAdoption(p.input({ engines: THREE }));
  const one = plain.items.filter(i => i.part === 'hooks');
  assert.equal(one.length, 1);
  assert.deepEqual(one[0].engines, ['claude-code', 'codex']);
  const wide = planAdoption(p.input({ engines: THREE, everyEngine: ['hooks'] }));
  assert.equal(wide.items.find(i => i.part === 'hooks').engines, null);
  assert.deepEqual(wide.everyEngine.find(e => e.part === 'hooks'), { part: 'hooks', chosen: true, widens: 1, notWidened: [] });
});

test('D8B rule 3: the choice changes the revision, so an approval made without it does not match, nor the other way round', async t => {
  const p = claudeOnly(t);
  const plain = planAdoption(p.input({ engines: THREE }));
  const wide = planAdoption(p.input({ engines: THREE, everyEngine: ['hooks'] }));
  assert.notEqual(wide.revision, plain.revision);
  assert.equal(planAdoption(p.input({ engines: THREE, everyEngine: ['mcp', 'hooks'] })).revision, planAdoption(p.input({ engines: THREE, everyEngine: ['hooks', 'mcp'] })).revision, 'the order of the parts does not count');
  await assert.rejects(applyAdoption(p.input({ engines: THREE, everyEngine: ['hooks'] }), plain.revision, plain.approvalsRequired), code('ADOPTION_STALE_APPROVAL'));
  await assert.rejects(applyAdoption(p.input({ engines: THREE }), wide.revision, wide.approvalsRequired), code('ADOPTION_STALE_APPROVAL'));
});

test('D8B: a choice for a part with nothing to widen still counts in the revision; one engine has nothing to widen', t => {
  const p = claudeOnly(t);
  const one = [{ id: 'claude-code' }];
  const plain = planAdoption(p.input({ engines: one }));
  assert.deepEqual(summary(plain), [['guardrails', false, 0, 0], ['hooks', false, 0, 0], ['mcp', false, 0, 0]]);
  const chosen = planAdoption(p.input({ engines: one, everyEngine: ['guardrails'] }));
  assert.notEqual(chosen.revision, plain.revision);
  assert.deepEqual(chosen.files, plain.files, 'the files are the same');
});

test('D8B: an unknown part, a repeated part, or a choice that is not a list is refused as usage', t => {
  const p = claudeOnly(t);
  for (const bad of [['skills'], ['bogus'], ['hooks', 'hooks'], 'hooks', [null], [1], { hooks: true }, null]) {
    assert.throws(() => planAdoption(p.input({ engines: THREE, everyEngine: bad })), code('ADOPTION_USAGE'), JSON.stringify(bad));
  }
});
