// Harness definition spec, section 6, and section 12, checks 4 and 5. Lead rulings R1, R2, and R7 (restriction only).
import test from 'node:test';
import assert from 'node:assert/strict';
import { entriesOf, entryHash, loadDefinition, resolveLayers } from '../../../dist/packages/harness-definition/src/index.js';
import { NOW, agent, cleanup, harness, json, makeDefinition, skill, tempRoot } from './fixture.mjs';

test.after(cleanup);

/** Where each layer lives: the user store, then nested project layers. */
const WHERE = { user: 'home', project: 'work/project', sub: 'work/project/sub', leaf: 'work/project/sub/leaf', sibling: 'work/project/sibling' };

function layer(root, where, { id = 'layer', overrides = [], skills = {}, agents = {}, rules, sandbox, hooks, mcp, engines, skillSettings } = {}) {
  const parts = {};
  const files = {};
  if (Object.keys(skills).length) { parts.skills = 'skills/'; for (const [name, desc] of Object.entries(skills)) files[`skills/${name}/SKILL.md`] = skill(name, desc); }
  if (Object.keys(agents).length) { parts.subagents = 'agents/'; for (const [name, extra] of Object.entries(agents)) files[`agents/${name}.md`] = agent(name, extra); }
  if (rules || sandbox) { parts.guardrails = 'guardrails.json'; files['guardrails.json'] = json({ rules: rules ?? [], ...(sandbox ? { sandbox } : {}) }); }
  if (hooks) { parts.hooks = 'hooks.json'; files['hooks.json'] = json({ hooks }); }
  if (mcp) { parts.mcp = 'mcp.json'; files['mcp.json'] = json({ servers: mcp }); }
  files['harness.json'] = harness({ id, parts, overrides, ...(engines ? { engines: engines.map(e => ({ id: e })) } : {}), ...(skillSettings ? { skills: skillSettings } : {}) });
  const r = loadDefinition(makeDefinition(files, WHERE[where] ?? where, root));
  assert.equal(r.ok, true, JSON.stringify(r.ok ? null : r.problems));
  return r.definition;
}
/** Builds layers in one temporary root. */
function layers(specs) {
  const root = tempRoot();
  return Object.fromEntries(Object.entries(specs).map(([where, spec]) => [where, layer(root, where, { id: where, ...spec })]));
}
const resolved = (chain, options) => { const r = resolveLayers(chain, options); assert.equal(r.ok, true, JSON.stringify(r.ok ? null : r.problems)); return r.resolved; };
const refusedCodes = (chain, options) => { const r = resolveLayers(chain, options); assert.equal(r.ok, false, 'expected a refusal'); return r.problems.map(p => p.code); };
const rule = (id, effect, pattern = id, extra = {}) => ({ id, action: 'shell', pattern, effect, strength: 'enforced', ...extra });
/** A layer approval for a change that `by` makes. `target` is the replaced item, for replace. */
const approval = (by, part, entry, change, item, target, extra = {}) => ({
  part, entry, change, folder: by.folder, entryHash: entryHash(item), ...(target ? { targetHash: entryHash(target) } : {}),
  who: 'Hanna Sage', when: '2026-10-28T14:00:00Z', reason: 'Reviewed.', ...extra,
});
const find = (def, key, id) => def.entries[key].find(e => e.id === id);

test('additive parts combine across layers, and inherited items are marked', () => {
  const { user, project } = layers({ user: { skills: { a: 'User A.' }, agents: { reader: '' } }, project: { skills: { b: 'Project B.' } } });
  const r = resolved([user, project]);
  assert.deepEqual(r.skills.map(p => [p.item.id, p.inherited, p.layer]), [['a', true, 0], ['b', false, 1]]);
  assert.deepEqual(r.subagents.map(p => [p.item.id, p.inherited]), [['reader', true]]);
  assert.deepEqual(entriesOf(r).skills.map(s => s.id), ['a', 'b']);
  assert.equal(r.id, 'project');
  assert.deepEqual(r.engines.map(e => e.id), ['claude-code', 'codex']);
});

test('check 4: a child layer with a replace override resolves to its own item', () => {
  const { user, project } = layers({ user: { skills: { a: 'User A.', keep: 'Kept.' } }, project: { skills: { a: 'Project A.' }, overrides: [{ part: 'skills', id: 'a', action: 'replace' }] } });
  const r = resolved([user, project]);
  const a = r.skills.find(p => p.item.id === 'a');
  assert.equal(a.item.description, 'Project A.');
  assert.equal(a.inherited, false);
  assert.equal(a.layer, 1);
  assert.equal(a.replaces.layer, 0);
  assert.deepEqual(r.skills.map(p => p.item.id), ['a', 'keep']);
  assert.equal(resolved([user]).skills.find(p => p.item.id === 'a').item.description, 'User A.');
});

test('check 4: a hide override removes the item from that layer only', () => {
  const { user, project, sibling } = layers({ user: { skills: { a: 'A.', b: 'B.' } }, project: { overrides: [{ part: 'skills', id: 'b', action: 'hide' }] }, sibling: {} });
  const r = resolved([user, project]);
  assert.deepEqual(r.skills.map(p => p.item.id), ['a']);
  assert.deepEqual(r.hidden, [{ part: 'skills', id: 'b', layer: 1, from: 0 }]);
  assert.deepEqual(resolved([user]).skills.map(p => p.item.id), ['a', 'b']);
  assert.deepEqual(resolved([user, sibling]).skills.map(p => p.item.id), ['a', 'b']);
});

test('a hide carries to the layers below the hiding layer, which inherit from it', () => {
  const { user, project, sub } = layers({ user: { skills: { a: 'A.', b: 'B.' } }, project: { overrides: [{ part: 'skills', id: 'b', action: 'hide' }] }, sub: {} });
  assert.deepEqual(resolved([user, project, sub]).skills.map(p => p.item.id), ['a']);
});

test('the same id in a lower layer without replace is refused', () => {
  const { user, project } = layers({ user: { skills: { a: 'User A.' } }, project: { skills: { a: 'Project A.' } } });
  assert.deepEqual(refusedCodes([user, project]), ['DUPLICATE_WITHOUT_REPLACE']);
});

test('an override needs a target, and replace needs the layer\'s own item', () => {
  const root = tempRoot();
  const user = layer(root, 'user', { skills: { a: 'A.' } });
  assert.deepEqual(refusedCodes([user, layer(root, 'p1', { overrides: [{ part: 'skills', id: 'zz', action: 'hide' }] })]), ['OVERRIDE_TARGET_MISSING']);
  assert.deepEqual(refusedCodes([user, layer(root, 'p2', { overrides: [{ part: 'skills', id: 'a', action: 'replace' }] })]), ['REPLACE_WITHOUT_ITEM']);
  assert.deepEqual(refusedCodes([user, layer(root, 'p3', { skills: { a: 'Mine.' }, overrides: [{ part: 'skills', id: 'a', action: 'hide' }] })]), ['HIDE_WITH_ITEM']);
  assert.deepEqual(refusedCodes([layer(root, 'top', { overrides: [{ part: 'skills', id: 'a', action: 'hide' }] })]), ['OVERRIDE_TARGET_MISSING']);
  assert.deepEqual(refusedCodes([]), ['NO_LAYERS']);
});

test('check 5: a child layer cannot hide or replace a deny rule from a higher layer', () => {
  const l = layers({
    user: { rules: [rule('no-push', 'deny', 'git push *')] },
    project: { overrides: [{ part: 'guardrails', id: 'no-push', action: 'hide' }] },
    sibling: { rules: [rule('no-push', 'deny', 'git push origin main')], overrides: [{ part: 'guardrails', id: 'no-push', action: 'replace' }] },
  });
  assert.deepEqual(refusedCodes([l.user, l.project]), ['GUARDRAIL_LOCKED']);
  assert.deepEqual(refusedCodes([l.user, l.sibling]), ['GUARDRAIL_LOCKED']);
  // No approval opens the lock.
  const opened = approval(l.project, 'guardrails', 'no-push', 'hide', find(l.user, 'rules', 'no-push'));
  assert.deepEqual(refusedCodes([l.user, l.project], { approvals: [opened], now: NOW }), ['GUARDRAIL_LOCKED']);
});

test('check 5: the lock holds through every layer below, for ask rules, and for the sandbox', () => {
  const l = layers({
    user: { rules: [rule('no-push', 'deny'), rule('ask-rm', 'ask')], sandbox: { id: 'box', files: true, network: true } },
    project: {},
    sub: { overrides: [{ part: 'guardrails', id: 'no-push', action: 'hide' }] },
    sibling: { overrides: [{ part: 'guardrails', id: 'ask-rm', action: 'hide' }] },
  });
  assert.deepEqual(refusedCodes([l.user, l.project, l.sub]), ['GUARDRAIL_LOCKED']);
  assert.deepEqual(refusedCodes([l.user, l.sibling]), ['GUARDRAIL_LOCKED']);
  const box = layers({ user: { sandbox: { id: 'box', files: true, network: true } }, project: { overrides: [{ part: 'guardrails', id: 'box', action: 'hide' }] }, sibling: { sandbox: { id: 'box', files: true, network: false } } });
  assert.deepEqual(refusedCodes([box.user, box.project]), ['GUARDRAIL_LOCKED']);
  assert.deepEqual(refusedCodes([box.user, box.sibling]), ['DUPLICATE_WITHOUT_REPLACE']);
});

test('check 5: inherited deny and ask rules stay in force below, and a child can add its own', () => {
  const { user, project } = layers({
    user: { rules: [rule('no-push', 'deny'), rule('ask-rm', 'ask'), rule('git', 'allow', 'git *')] },
    project: { rules: [rule('no-curl', 'deny', 'curl *')], overrides: [{ part: 'guardrails', id: 'git', action: 'hide' }] },
  });
  assert.deepEqual(resolved([user, project]).rules.map(p => [p.item.id, p.item.effect, p.inherited]), [
    ['no-push', 'deny', true], ['ask-rm', 'ask', true], ['no-curl', 'deny', false],
  ]);
});

test('R1: a lower layer cannot add an allow rule without an approval bound to the rule', () => {
  const { user, project } = layers({ user: { rules: [rule('no-push', 'deny')] }, project: { rules: [rule('git', 'allow', 'git *', { strength: 'advisory' })] } });
  assert.deepEqual(refusedCodes([user, project]), ['LAYER_WIDENS']);
  const item = find(project, 'rules', 'git');
  const r = resolved([user, project], { approvals: [approval(project, 'guardrails', 'git', 'add-allow', item)], now: NOW });
  assert.deepEqual(r.rules.map(p => p.item.id), ['no-push', 'git']);
  assert.equal(r.approved.length, 1);
  // An approval of another version of the rule is void.
  const other = approval(project, 'guardrails', 'git', 'add-allow', { ...item, pattern: 'git status' });
  assert.deepEqual(refusedCodes([user, project], { approvals: [other], now: NOW }), ['LAYER_WIDENS']);
  // The top layer may add allow rules.
  assert.equal(resolveLayers([project]).ok, true);
});

test('R1: a lower layer can restrict an allow rule but not replace it with another allow', () => {
  const l = layers({
    user: { rules: [rule('git', 'allow', 'git *')] },
    project: { rules: [rule('git', 'deny', 'git push *')], overrides: [{ part: 'guardrails', id: 'git', action: 'replace' }] },
    sibling: { rules: [rule('git', 'allow', 'git push *')], overrides: [{ part: 'guardrails', id: 'git', action: 'replace' }] },
  });
  assert.equal(resolved([l.user, l.project]).rules[0].item.effect, 'deny');
  assert.deepEqual(refusedCodes([l.user, l.sibling]), ['LAYER_WIDENS']);
  const ok = resolved([l.user, l.sibling], { approvals: [approval(l.sibling, 'guardrails', 'git', 'replace', find(l.sibling, 'rules', 'git'), find(l.user, 'rules', 'git'))], now: NOW });
  assert.equal(ok.rules[0].item.pattern, 'git push *');
});

test('R1: a lower layer cannot hide or replace a hook, an MCP server, or a subagent', () => {
  const hook = cmd => [{ id: 'h', event: 'Stop', command: cmd, strength: 'enforced' }];
  const server = cmd => [{ name: 's', transport: 'stdio', command: cmd }];
  const l = layers({
    user: { agents: { r: 'tools:\n  - read\n' }, hooks: hook('up'), mcp: server('up') },
    project: { agents: { r: 'tools:\n  - read\n  - shell\n' }, hooks: hook('down'), mcp: server('down'), overrides: [
      { part: 'subagents', id: 'r', action: 'replace' }, { part: 'hooks', id: 'h', action: 'replace' }, { part: 'mcp', id: 's', action: 'replace' },
    ] },
    sibling: { overrides: [{ part: 'subagents', id: 'r', action: 'hide' }, { part: 'hooks', id: 'h', action: 'hide' }, { part: 'mcp', id: 's', action: 'hide' }] },
  });
  assert.deepEqual(refusedCodes([l.user, l.project]), ['LAYER_WIDENS', 'LAYER_WIDENS', 'LAYER_WIDENS']);
  assert.deepEqual(refusedCodes([l.user, l.sibling]), ['LAYER_WIDENS', 'LAYER_WIDENS', 'LAYER_WIDENS']);
  const approvals = [
    approval(l.project, 'subagents', 'r', 'replace', find(l.project, 'subagents', 'r'), find(l.user, 'subagents', 'r')),
    approval(l.project, 'hooks', 'h', 'replace', find(l.project, 'hooks', 'h'), find(l.user, 'hooks', 'h')),
    approval(l.project, 'mcp', 's', 'replace', find(l.project, 'mcp', 's'), find(l.user, 'mcp', 's')),
  ];
  const r = resolved([l.user, l.project], { approvals, now: NOW });
  assert.deepEqual(r.subagents[0].item.tools, ['read', 'shell']);
  const hides = [
    approval(l.sibling, 'subagents', 'r', 'hide', find(l.user, 'subagents', 'r')),
    approval(l.sibling, 'hooks', 'h', 'hide', find(l.user, 'hooks', 'h')),
    approval(l.sibling, 'mcp', 's', 'hide', find(l.user, 'mcp', 's')),
  ];
  assert.equal(resolved([l.user, l.sibling], { approvals: hides, now: NOW }).hooks.length, 0);
});

test('R2: items a lower layer adds that hold references or commands need approval in the plan', () => {
  const l = layers({
    user: { hooks: [{ id: 'up', event: 'Stop', command: 'true', strength: 'advisory' }], mcp: [{ name: 'top', transport: 'http', url: 'https://a.example.com', headers: { Authorization: 'Bearer ${A}' } }] },
    project: {
      hooks: [{ id: 'down', event: 'Stop', command: 'true', strength: 'advisory' }],
      mcp: [
        { name: 'ref', transport: 'http', url: 'https://b.example.com', headers: { Authorization: 'Bearer ${ANTHROPIC_API_KEY}' } },
        { name: 'kc', transport: 'stdio', command: 'run', env: { K: { keychain: 'k' } } },
        { name: 'plain', transport: 'http', url: 'https://c.example.com' },
        { name: 'local', transport: 'stdio', command: 'run' },
      ],
    },
  });
  const r = resolved([l.user, l.project]);
  const flag = (list, id) => { const n = list.find(p => p.item.id === id).needsApproval; return n && { layer: n.layer, reason: n.reason }; };
  const reasons = (list, id) => list.find(p => p.item.id === id).needsApproval?.reasons;
  assert.equal(flag(r.hooks, 'up'), undefined);
  assert.equal(flag(r.mcp, 'top'), undefined);
  assert.deepEqual(flag(r.hooks, 'down'), { layer: 1, reason: 'hook-command' });
  assert.deepEqual(flag(r.mcp, 'ref'), { layer: 1, reason: 'secret-reference' });
  // M4: a stdio server runs a command, like a hook.
  assert.deepEqual(flag(r.mcp, 'kc'), { layer: 1, reason: 'server-command' });
  assert.deepEqual(reasons(r.mcp, 'kc'), ['server-command', 'secret-reference']);
  assert.deepEqual(flag(r.mcp, 'local'), { layer: 1, reason: 'server-command' });
  assert.equal(flag(r.mcp, 'plain'), undefined);
});

test('R1: skills stay free to hide and replace below', () => {
  const { user, project } = layers({ user: { skills: { a: 'A.' } }, project: { skills: { a: 'B.' }, overrides: [{ part: 'skills', id: 'a', action: 'replace' }] } });
  assert.equal(resolved([user, project]).skills[0].item.description, 'B.');
});

test('R7: a child layer can only narrow the engines of its parent', () => {
  const l = layers({ user: { engines: ['claude-code', 'codex', 'pi'] }, project: { engines: ['codex'] }, sibling: { engines: ['codex', 'opencode'] } });
  assert.deepEqual(resolved([l.user, l.project]).engines.map(e => e.id), ['codex']);
  assert.deepEqual(refusedCodes([l.user, l.sibling]), ['ENGINE_NOT_INHERITED']);
});

test('S8: layer order is checked: each project layer sits inside the one above it', () => {
  const l = layers({ user: {}, project: {}, sub: {}, sibling: {} });
  assert.equal(resolveLayers([l.user, l.project, l.sub]).ok, true);
  assert.deepEqual(refusedCodes([l.user, l.sub, l.project]), ['LAYER_ORDER']);
  assert.deepEqual(refusedCodes([l.user, l.project, l.sibling, l.sub]), ['LAYER_ORDER']);
  assert.deepEqual(refusedCodes([l.user, l.project, l.project]), ['LAYER_ORDER']);
  // Without a user store, the first layer is a project layer too.
  assert.deepEqual(refusedCodes([l.project, l.user], { userStore: false }), ['LAYER_ORDER']);
});

test('S8 and silent 9: a layer input that did not come from the loader is checked', () => {
  const { user, project } = layers({ user: { rules: [rule('d', 'deny')] }, project: {} });
  const forged = (change) => ({ ...project, ...change });
  assert.ok(refusedCodes([user, forged({ harness: { ...project.harness, overrides: [{ part: 'guardrails', id: 'd', action: 'remove' }] } })]).includes('LAYER_INVALID'));
  assert.ok(refusedCodes([user, forged({ entries: { ...project.entries, rules: [rule('x', 'forbid')] } })]).includes('LAYER_INVALID'));
  assert.ok(refusedCodes([forged({ entries: { ...project.entries, rules: [rule('x', 'deny'), rule('x', 'deny')] } })]).includes('DUPLICATE_ID'));
  // A rule whose effect is not allow is locked, whatever the effect says.
  const odd = { ...user, entries: { ...user.entries, rules: [rule('d', 'block')] } };
  assert.ok(refusedCodes([odd, forged({ harness: { ...project.harness, overrides: [{ part: 'guardrails', id: 'd', action: 'hide' }] } })]).includes('LAYER_INVALID'));
});

test('silent 5: references must resolve after layers, for each engine', () => {
  const l = layers({
    user: { skills: { a: 'A.' }, mcp: [{ name: 'gh', transport: 'stdio', command: 'run' }] },
    project: { agents: { r: 'skills:\n  - a\ntools:\n  - "mcp:gh"\n' } },
    sub: { overrides: [{ part: 'skills', id: 'a', action: 'hide' }] },
    sibling: { agents: { r: 'skills:\n  - missing\ntools:\n  - "mcp:none"\n' } },
  });
  assert.equal(resolveLayers([l.user, l.project]).ok, true);
  // One problem per broken reference; the message names the engines.
  assert.deepEqual(refusedCodes([l.user, l.project, l.sub]), ['DANGLING_REFERENCE']);
  assert.deepEqual(refusedCodes([l.user, l.sibling]), ['DANGLING_REFERENCE', 'DANGLING_REFERENCE']);
  // A skill filtered away from one engine dangles for that engine only.
  const f = layers({ user: { skills: { a: 'A.' }, skillSettings: { a: { engines: ['claude-code'] } }, agents: { r: 'skills:\n  - a\n' } } });
  assert.deepEqual(refusedCodes([f.user]), ['DANGLING_REFERENCE']);
  // An allow rule that names a missing skill dangles; a deny rule for one is a ban, and passes.
  const g = layers({ user: { rules: [{ id: 'use-x', action: 'skill', pattern: 'x', effect: 'allow', strength: 'advisory' }] } });
  assert.deepEqual(refusedCodes([g.user]), ['DANGLING_REFERENCE']);
  const h = layers({ user: { rules: [{ id: 'ban-x', action: 'mcp', pattern: 'x/*', effect: 'deny', strength: 'enforced' }] } });
  assert.equal(resolveLayers([h.user]).ok, true);
});

test('layer resolution is the same on every call', () => {
  const { user, project } = layers({ user: { skills: { a: 'A.' }, rules: [rule('d', 'deny')] }, project: { skills: { b: 'B.' } } });
  assert.deepEqual(resolved([user, project]), resolved([user, project]));
});

test('M3: every private block on an entry from a lower layer needs approval', () => {
  const l = layers({
    user: { rules: [rule('top', 'deny', 'top', { 'x-claude-code': { note: 'a' } })] },
    project: { rules: [rule('mine', 'deny', 'mine', { 'x-claude-code': { note: 'b' } })], skills: { s: 'S.' }, skillSettings: { s: { 'x-codex': { note: 'c' } } } },
  });
  const r = resolved([l.user, l.project]);
  assert.equal(r.rules.find(p => p.item.id === 'top').needsApproval, undefined);
  assert.deepEqual(r.rules.find(p => p.item.id === 'mine').needsApproval, { layer: 1, reason: 'private-block', reasons: ['private-block'] });
  assert.deepEqual(r.skills.find(p => p.item.id === 's').needsApproval.reasons, ['private-block']);
});

test('L1: a layer approval binds the layer folder, and for replace the replaced item', () => {
  const root = tempRoot();
  const user = layer(root, 'home', { rules: [rule('git', 'allow', 'git *')] });
  const a = layer(root, 'work/a', { rules: [rule('git', 'allow', 'git push *')], overrides: [{ part: 'guardrails', id: 'git', action: 'replace' }] });
  const b = layer(root, 'work/b', { rules: [rule('git', 'allow', 'git push *')], overrides: [{ part: 'guardrails', id: 'git', action: 'replace' }] });
  const forA = approval(a, 'guardrails', 'git', 'replace', find(a, 'rules', 'git'), find(user, 'rules', 'git'));
  assert.equal(resolveLayers([user, a], { approvals: [forA], now: NOW }).ok, true);
  assert.deepEqual(refusedCodes([user, b], { approvals: [forA], now: NOW }), ['LAYER_WIDENS']);
  // Another replaced item voids it.
  const otherTarget = approval(a, 'guardrails', 'git', 'replace', find(a, 'rules', 'git'), { ...find(user, 'rules', 'git'), pattern: 'git status' });
  assert.deepEqual(refusedCodes([user, a], { approvals: [otherTarget], now: NOW }), ['LAYER_WIDENS']);
  // A replace approval with no target hash, or a relative folder, is not a valid record.
  const { targetHash: _, ...noTarget } = forA;
  assert.ok(refusedCodes([user, a], { approvals: [noTarget], now: NOW }).includes('APPROVAL_INVALID'));
  assert.ok(refusedCodes([user, a], { approvals: [{ ...forA, folder: 'work/a/.bowerloom' }], now: NOW }).includes('APPROVAL_INVALID'));
});
