// Verification review of 6ef5ffa..94ea26f, items C1 to C8. Every file is synthetic, and the secret-shaped strings are
// made up.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { applyAdoption, applyAdoptionRecovery, planAdoption, planAdoptionRecovery } from '../../../dist/packages/adoption/src/index.js';
import { toolClasses } from '../../../dist/packages/adoption/src/claude-code.js';
import { agent, item, json, project, skill } from './fixture.mjs';

const at = (plan, p, pointer) => plan.unmapped.find(u => u.path === p && (pointer === undefined || u.pointer === pointer));
const rules = plan => plan.items.filter(i => i.part === 'guardrails' && i.id !== 'sandbox').map(i => i.id.split('-').slice(0, 2).join('-')).sort();

test('C1: an unrestricted 0.7 managed skill whose disallowed-tools deny is lost drops the allows of every harness engine', t => {
  const p = project(t, {
    '.bowerloom-skills/catalog.json': json({ format: 'bowerloom/observed-managed-skill-catalog/v1beta1', source: { kind: 'npm', registry: 'https://registry.example.test', package: 'x', version: '1.0.0' } }),
    '.bowerloom-skills/skills/foo/SKILL.md': skill('foo', 'disallowed-tools: Read(~/.ssh/**), Bash(rm *)\n'),
    '.claude/settings.json': json({ permissions: { allow: ['Read(./a/**)'] } }),
  });
  const plan = planAdoption(p.input({ engines: [{ id: 'claude-code' }, { id: 'codex' }] }));
  assert.deepEqual(rules(plan), ['deny-shell']);
  assert.match(at(plan, '.claude/settings.json', '/permissions/allow/0').reason, /a deny of this action could not be carried/);
  const deny = plan.items.find(i => i.id.startsWith('deny-shell'));
  assert.equal(deny.engines, null, 'the deny of an unrestricted skill applies to every harness engine');
});

test('C2: MCP denies match allowed servers by whole name and prefix', () => {
  const tc = (a, d) => toolClasses(a, d).tools.filter(x => x.startsWith('mcp:'));
  assert.deepEqual(tc(['mcp__a', 'mcp__b'], ['mcp__*']), []);
  assert.deepEqual(tc(['mcp__srv', 'mcp__other'], ['mcp__srv*']), ['mcp:other']);
  assert.deepEqual(tc(['mcp__a__b__*', 'mcp__c'], ['mcp__a__b__delete']), ['mcp:c']);
  assert.deepEqual(tc(['mcp__a__b__*', 'mcp__a'], ['mcp__a__b']), ['mcp:a']);
  assert.deepEqual(tc(['mcp__srv-x__*', 'mcp__y'], ['mcp__srv-x']), ['mcp:y']);
  assert.deepEqual(tc(['mcp__a', 'mcp__b'], ['mcp__zzz']), ['mcp:a', 'mcp:b'], 'a deny that names no allowed server removes none');
});

test('C3: a dropped key that restricts needs acknowledgement; one that only widens does not; a read-only Codex agent is not adopted', t => {
  const p = project(t, {
    '.claude/agents/ro.md': agent('ro', 'permissionMode: plan\ntools: Read, Grep\n'),
    '.codex/agents/ro3.toml': 'name = "ro3"\ndescription = "ro"\nsandbox_mode = "read-only"\ndeveloper_instructions = "review"\n',
    '.codex/agents/wr.toml': 'name = "wr"\ndescription = "wr"\nsandbox_mode = "workspace-write"\napproval_policy = "untrusted"\ndeveloper_instructions = "work"\n',
    '.claude/settings.json': json({ permissions: { defaultMode: 'plan', disableBypassPermissionsMode: 'disable', additionalDirectories: ['../x'] } }),
    '.codex/config.toml': 'approval_policy = "untrusted"\n',
  });
  const plan = planAdoption(p.input({ engines: [{ id: 'claude-code' }, { id: 'codex' }] }));
  const gate = (f, ptr) => at(plan, f, ptr)?.gate;
  assert.equal(gate('.claude/agents/ro.md', '/permissionMode'), 'acknowledge');
  assert.equal(gate('.claude/settings.json', '/permissions/defaultMode'), 'acknowledge');
  assert.equal(gate('.claude/settings.json', '/permissions/disableBypassPermissionsMode'), 'acknowledge');
  assert.equal(gate('.claude/settings.json', '/permissions/additionalDirectories'), 'none');
  assert.equal(gate('.codex/config.toml', '/approval_policy'), 'acknowledge');
  assert.equal(gate('.codex/agents/wr.toml', '/sandbox_mode'), 'acknowledge');
  assert.equal(gate('.codex/agents/wr.toml', '/approval_policy'), 'acknowledge');
  assert.equal(item(plan, 'subagents', 'ro3'), undefined);
  assert.match(at(plan, '.codex/agents/ro3.toml').reason, /read-only/);
  assert.ok(item(plan, 'subagents', 'wr'));
});

test('C4: a lost deny adds one warning that the allows of other actions stay', t => {
  const p = project(t, { '.claude/settings.json': json({ permissions: { deny: ['Read(~/.ssh/**)', 'WebSearch'], allow: ['Bash(ls)'] } }) });
  const plan = planAdoption(p.input({ engines: [{ id: 'claude-code' }] }));
  assert.equal(plan.warnings.filter(w => /allows of other actions stay/.test(w)).length, 1);
  assert.deepEqual(rules(plan), ['allow-shell']);
});

test('C5: the nested search skips .git and node_modules at every depth; a search that stops early makes the plan not ready', t => {
  const p = project(t, { 'AGENTS.md': '# a\n', 'packages/a/node_modules/dep/AGENTS.md': 'x\n', 'packages/a/.git/AGENTS.md': 'x\n', 'zz/AGENTS.md': 'nested\n' });
  const plan = planAdoption(p.input({ engines: [{ id: 'claude-code' }] }));
  assert.deepEqual(plan.unmapped.map(u => u.path), ['zz/AGENTS.md']);
  let deep = 'd';
  for (let i = 0; i < 20; i++) deep += '/d';
  const q = project(t, { 'AGENTS.md': '# a\n', [`${deep}/AGENTS.md`]: 'x\n' });
  const stopped = planAdoption(q.input({ engines: [{ id: 'claude-code' }] }));
  const stop = stopped.unmapped.find(u => /search for nested instruction files stopped/.test(u.reason));
  assert.equal(stop.gate, 'acknowledge');
  assert.equal(stopped.ready, false);
});

test('C6, closed by the step 3 contract: a claimed 0.7 source is written to sources.json marked claimed, and still needs approval', async t => {
  const TIDY = skill('tidy');
  const p = project(t, {
    '.bowerloom/managed/catalog/tidy.json': json({ format: 'bowerloom/managed-catalog/v1beta2', item: { kind: 'skill', id: 'tidy' }, source: { kind: 'npm', registry: 'https://registry.example.test', package: 'example-tidy', version: '1.0.0' }, harnesses: ['claude'] }),
    '.bowerloom/managed/skills/tidy/SKILL.md': TIDY,
  });
  const plan = planAdoption(p.input({ engines: [{ id: 'claude-code' }] }));
  assert.equal(item(plan, 'skills', 'tidy').source.claimed, true);
  assert.ok(plan.approvalsRequired.includes('skills/tidy'));
  assert.ok(item(plan, 'skills', 'tidy').needsApproval.some(n => /claimed: true/.test(n)));
  await applyAdoption(p.input({ engines: [{ id: 'claude-code' }] }), plan.revision, plan.approvalsRequired);
  const written = JSON.parse(fs.readFileSync(path.join(p.def, 'sources.json'), 'utf8'));
  assert.deepEqual(written.sources, [{ name: 'example-tidy', marketplace: 'https://registry.example.test', version: '1.0.0', claimed: true, items: [{ part: 'skills', id: 'tidy' }] }]);
  assert.deepEqual(written.adopted.map(a => [a.id, a.adoptedFrom.kind, a.adoptedFrom.path]), [['tidy', '0.7-managed', '.bowerloom/managed/skills/tidy']]);
});

const S1 = 'sk-ant-' + 'synthetic0value0'.repeat(2);
const S2 = 'ghp_' + 'A1b2C3d4'.repeat(4) + 'E5f6';
const S3 = 'AKIA' + 'SYNTHETIC0123456';

test('C7: a key name or a server name shaped like a secret: the entry is not adopted, and it is listed by index, never by name', t => {
  const p = project(t, {
    '.mcp.json': json({ mcpServers: { a: { command: 'node', env: { [S2]: 'x' } }, ok: { command: 'node' }, [S1]: { command: 'node' } } }),
    '.claude/settings.json': json({ [S2]: true, outputStyle: 'Explanatory', permissions: { allow: [`Bash(curl -H "x: ${S1}" *)`] }, hooks: { Stop: [{ hooks: [{ type: 'command', command: 'true', [S3]: 1 }] }] } }),
    '.codex/config.toml': `model = "${S3}"\n[mcp_servers.c]\ncommand = "x"\ndisabled_tools = ["${S2}"]\n`,
  });
  const plan = planAdoption(p.input({ engines: [{ id: 'claude-code' }, { id: 'codex' }] }));
  const text = JSON.stringify(plan);
  for (const s of [S1, S2, S3]) assert.equal(text.includes(s), false);
  assert.deepEqual(plan.items.filter(i => i.part === 'mcp').map(i => i.id), ['ok']);
  assert.match(at(plan, '.mcp.json', '/mcpServers/#2').reason, /looks like a secret/);
  assert.match(at(plan, '.mcp.json', '/mcpServers/a/env/#0').reason, /looks like a secret/);
  assert.match(at(plan, '.claude/settings.json', '/#0').reason, /looks like a secret/);
  assert.match(at(plan, '.claude/settings.json', '/permissions/allow/0').reason, /looks like a secret/);
  assert.equal(plan.items.filter(i => i.part === 'hooks').length, 0);
  assert.equal(plan.engines.find(e => e.id === 'codex').model, null);
  assert.deepEqual(plan.problems, []);
});

test('C8: a journal that does not parse: recovery only clears the journal, after approval, and lists the files to check', async t => {
  const p = project(t, { 'AGENTS.md': '# a\n', '.bowerloom/skills.json': json({ format: 'bowerloom/skills/v1beta1', harnesses: ['claude'], skills: [] }), '.bowerloom/instructions/AGENTS.md': '# half written\n' });
  fs.mkdirSync(p.stateDir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(p.stateDir, 'adoption-pending.json'), '{ not json', { mode: 0o600 });
  assert.throws(() => planAdoption(p.input({ engines: [{ id: 'claude-code' }] })), e => e?.code === 'ADOPTION_RECOVERY_REQUIRED');
  const recovery = planAdoptionRecovery({ projectDir: p.dir, stateDir: p.stateDir });
  assert.equal(recovery.journal, 'damaged');
  assert.deepEqual(recovery.remove, []);
  assert.deepEqual(recovery.check, ['.bowerloom/instructions/AGENTS.md']);
  await applyAdoptionRecovery({ projectDir: p.dir, stateDir: p.stateDir }, recovery.revision);
  assert.deepEqual(fs.readdirSync(p.stateDir), []);
  assert.equal(fs.readFileSync(path.join(p.def, 'instructions/AGENTS.md'), 'utf8'), '# half written\n', 'no project file is removed');
});
