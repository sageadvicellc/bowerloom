// Harness definition spec, section 6, and section 12, checks 4 and 5.
import test from 'node:test';
import assert from 'node:assert/strict';
import { entriesOf, loadDefinition, resolveLayers } from '../../../dist/packages/harness-definition/src/index.js';
import { agent, cleanup, harness, json, makeDefinition, skill } from './fixture.mjs';

test.after(cleanup);

function layer({ id = 'layer', overrides = [], skills = {}, agents = {}, rules, hooks, mcp } = {}) {
  const parts = {};
  const files = {};
  if (Object.keys(skills).length) { parts.skills = 'skills/'; for (const [name, desc] of Object.entries(skills)) files[`skills/${name}/SKILL.md`] = skill(name, desc); }
  if (Object.keys(agents).length) { parts.subagents = 'agents/'; for (const [name, body] of Object.entries(agents)) files[`agents/${name}.md`] = agent(name, '', body); }
  if (rules) { parts.guardrails = 'guardrails.json'; files['guardrails.json'] = json({ rules }); }
  if (hooks) { parts.hooks = 'hooks.json'; files['hooks.json'] = json({ hooks }); }
  if (mcp) { parts.mcp = 'mcp.json'; files['mcp.json'] = json({ servers: mcp }); }
  files['harness.json'] = harness({ id, parts, overrides });
  const r = loadDefinition(makeDefinition(files, id));
  assert.equal(r.ok, true, JSON.stringify(r.ok ? null : r.problems));
  return r.definition;
}
const resolved = chain => { const r = resolveLayers(chain); assert.equal(r.ok, true, JSON.stringify(r.ok ? null : r.problems)); return r.resolved; };
const refusedCodes = chain => { const r = resolveLayers(chain); assert.equal(r.ok, false); return r.problems.map(p => p.code); };
const rule = (id, effect, pattern = id) => ({ id, action: 'shell', pattern, effect, strength: 'enforced' });

test('additive parts combine across layers, and inherited items are marked', () => {
  const user = layer({ id: 'user', skills: { a: 'User A.' }, agents: { reader: 'User reader.\n' } });
  const project = layer({ id: 'project', skills: { b: 'Project B.' } });
  const r = resolved([user, project]);
  assert.deepEqual(r.skills.map(p => [p.item.id, p.inherited, p.layer]), [['a', true, 0], ['b', false, 1]]);
  assert.deepEqual(r.subagents.map(p => [p.item.id, p.inherited]), [['reader', true]]);
  assert.deepEqual(entriesOf(r).skills.map(s => s.id), ['a', 'b']);
});

test('check 4: a child layer with a replace override resolves to its own item', () => {
  const user = layer({ id: 'user', skills: { a: 'User A.', keep: 'Kept.' } });
  const project = layer({ id: 'project', skills: { a: 'Project A.' }, overrides: [{ part: 'skills', id: 'a', action: 'replace' }] });
  const r = resolved([user, project]);
  const a = r.skills.find(p => p.item.id === 'a');
  assert.equal(a.item.description, 'Project A.');
  assert.equal(a.inherited, false);
  assert.equal(a.layer, 1);
  assert.equal(a.replaces.layer, 0);
  // The replacement keeps the place of the item it replaces, so the order is stable.
  assert.deepEqual(r.skills.map(p => p.item.id), ['a', 'keep']);
  // The upper layer on its own still resolves to its own item.
  assert.equal(resolved([user]).skills.find(p => p.item.id === 'a').item.description, 'User A.');
});

test('check 4: replace works for subagents, hooks, MCP servers, and allow rules', () => {
  const hook = (cmd) => [{ id: 'h', event: 'Stop', command: cmd, strength: 'advisory' }];
  const server = (cmd) => [{ name: 's', transport: 'stdio', command: cmd }];
  const user = layer({ id: 'user', agents: { r: 'Up.\n' }, hooks: hook('up'), mcp: server('up'), rules: [rule('git', 'allow', 'git *')] });
  const project = layer({
    id: 'project', agents: { r: 'Down.\n' }, hooks: hook('down'), mcp: server('down'), rules: [rule('git', 'allow', 'git status')],
    overrides: ['subagents', 'hooks', 'mcp', 'guardrails'].map(part => ({ part, id: part === 'subagents' ? 'r' : part === 'hooks' ? 'h' : part === 'mcp' ? 's' : 'git', action: 'replace' })),
  });
  const e = entriesOf(resolved([user, project]));
  assert.match(e.subagents[0].body, /Down/);
  assert.equal(e.hooks[0].command, 'down');
  assert.equal(e.mcp[0].command, 'down');
  assert.equal(e.rules[0].pattern, 'git status');
});

test('check 4: a hide override removes the item from that layer only', () => {
  const user = layer({ id: 'user', skills: { a: 'A.', b: 'B.' } });
  const project = layer({ id: 'project', overrides: [{ part: 'skills', id: 'b', action: 'hide' }] });
  const r = resolved([user, project]);
  assert.deepEqual(r.skills.map(p => p.item.id), ['a']);
  assert.deepEqual(r.hidden, [{ part: 'skills', id: 'b', layer: 1, from: 0 }]);
  // The layer that defines the item still has it.
  assert.deepEqual(resolved([user]).skills.map(p => p.item.id), ['a', 'b']);
  // A sibling layer under the same parent still has it.
  const sibling = layer({ id: 'sibling' });
  assert.deepEqual(resolved([user, sibling]).skills.map(p => p.item.id), ['a', 'b']);
});

test('a hide carries to the layers below the hiding layer, which inherit from it', () => {
  const user = layer({ id: 'user', skills: { a: 'A.', b: 'B.' } });
  const project = layer({ id: 'project', overrides: [{ part: 'skills', id: 'b', action: 'hide' }] });
  const sub = layer({ id: 'sub' });
  assert.deepEqual(resolved([user, project, sub]).skills.map(p => p.item.id), ['a']);
});

test('the same id in a lower layer without replace is refused', () => {
  const user = layer({ id: 'user', skills: { a: 'User A.' } });
  const project = layer({ id: 'project', skills: { a: 'Project A.' } });
  assert.deepEqual(refusedCodes([user, project]), ['DUPLICATE_WITHOUT_REPLACE']);
});

test('an override needs a target, and replace needs the layer\'s own item', () => {
  const user = layer({ id: 'user', skills: { a: 'A.' } });
  assert.deepEqual(refusedCodes([user, layer({ id: 'p1', overrides: [{ part: 'skills', id: 'zz', action: 'hide' }] })]), ['OVERRIDE_TARGET_MISSING']);
  assert.deepEqual(refusedCodes([user, layer({ id: 'p2', overrides: [{ part: 'skills', id: 'a', action: 'replace' }] })]), ['REPLACE_WITHOUT_ITEM']);
  assert.deepEqual(refusedCodes([user, layer({ id: 'p3', skills: { a: 'Mine.' }, overrides: [{ part: 'skills', id: 'a', action: 'hide' }] })]), ['HIDE_WITH_ITEM']);
  // An override in the top layer has nothing to act on.
  assert.deepEqual(refusedCodes([layer({ id: 'top', overrides: [{ part: 'skills', id: 'a', action: 'hide' }] })]), ['OVERRIDE_TARGET_MISSING']);
  assert.deepEqual(refusedCodes([]), ['NO_LAYERS']);
});

test('check 5: a child layer cannot hide a deny rule from a higher layer', () => {
  const user = layer({ id: 'user', rules: [rule('no-push', 'deny', 'git push *')] });
  const project = layer({ id: 'project', overrides: [{ part: 'guardrails', id: 'no-push', action: 'hide' }] });
  assert.deepEqual(refusedCodes([user, project]), ['GUARDRAIL_LOCKED']);
});

test('check 5: a child layer cannot replace a deny rule from a higher layer', () => {
  const user = layer({ id: 'user', rules: [rule('no-push', 'deny', 'git push *')] });
  const project = layer({ id: 'project', rules: [rule('no-push', 'deny', 'git push origin main')], overrides: [{ part: 'guardrails', id: 'no-push', action: 'replace' }] });
  assert.deepEqual(refusedCodes([user, project]), ['GUARDRAIL_LOCKED']);
  // Nor by reusing the id without an override.
  const sneaky = layer({ id: 'sneaky', rules: [rule('no-push', 'allow', 'git push *')] });
  assert.deepEqual(refusedCodes([user, sneaky]), ['DUPLICATE_WITHOUT_REPLACE']);
});

test('check 5: the lock holds through every layer below, and for ask rules', () => {
  const user = layer({ id: 'user', rules: [rule('no-push', 'deny'), rule('ask-rm', 'ask')] });
  const middle = layer({ id: 'middle' });
  const leaf = layer({ id: 'leaf', overrides: [{ part: 'guardrails', id: 'no-push', action: 'hide' }] });
  assert.deepEqual(refusedCodes([user, middle, leaf]), ['GUARDRAIL_LOCKED']);
  const leafAsk = layer({ id: 'leaf-ask', overrides: [{ part: 'guardrails', id: 'ask-rm', action: 'hide' }] });
  assert.deepEqual(refusedCodes([user, middle, leafAsk]), ['GUARDRAIL_LOCKED']);
});

test('check 5: inherited deny and ask rules stay in force below, and a child can add its own', () => {
  const user = layer({ id: 'user', rules: [rule('no-push', 'deny'), rule('ask-rm', 'ask'), rule('git', 'allow', 'git *')] });
  const project = layer({ id: 'project', rules: [rule('no-curl', 'deny', 'curl *')], overrides: [{ part: 'guardrails', id: 'git', action: 'hide' }] });
  const r = resolved([user, project]);
  assert.deepEqual(r.rules.map(p => [p.item.id, p.item.effect, p.inherited]), [
    ['no-push', 'deny', true], ['ask-rm', 'ask', true], ['no-curl', 'deny', false],
  ]);
});

test('layer resolution is the same on every call', () => {
  const user = layer({ id: 'user', skills: { a: 'A.' }, rules: [rule('d', 'deny')] });
  const project = layer({ id: 'project', skills: { b: 'B.' } });
  assert.deepEqual(resolved([user, project]), resolved([user, project]));
});
