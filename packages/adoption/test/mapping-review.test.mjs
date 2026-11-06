// Review rulings on reading and mapping: A1 to A6, A8, A10, A12, A13 (mapping mutants), A15, A18, and A19.
// Every file is synthetic.
import test from 'node:test';
import assert from 'node:assert/strict';
import { applyAdoption, parseTomlSubset, planAdoption } from '../../../dist/packages/adoption/src/index.js';
import { loadDefinition } from '../../../dist/packages/harness-definition/src/index.js';
import { agent, code, gated, item, json, project, skill } from './fixture.mjs';

const CC = [{ id: 'claude-code' }];
const at = (plan, path, pointer) => plan.unmapped.find(u => u.path === path && (pointer === undefined || u.pointer === pointer));
const rules = plan => plan.items.filter(i => i.part === 'guardrails' && i.id !== 'sandbox').map(i => i.id.split('-').slice(0, 2).join('-')).sort();

test('A1: every entry of a rules folder a reader consumes is taken or listed; one that could hold a deny needs acknowledgement', t => {
  const p = project(t, {
    '.codex/rules/default.rules': 'prefix_rule(pattern = ["ls"])\n',
    '.codex/rules/extra.txt': 'x\n',
    '.codex/rules/nested/more.rules': 'prefix_rule(pattern = ["rm"], decision = "forbidden")\n',
    '.codex/rules/linked.rules': { link: 'default.rules' },
    '.claude/agents/notes.txt': 'x\n',
    '.claude/agents/sub/reader.md': agent('reader'),
    '.opencode/agents/linked.md': { link: '../x.md' },
  });
  const plan = planAdoption(p.input({ engines: [{ id: 'claude-code' }, { id: 'codex' }, { id: 'opencode' }] }));
  for (const path of ['.codex/rules/extra.txt', '.codex/rules/nested', '.codex/rules/linked.rules']) {
    const u = at(plan, path);
    assert.ok(u, path);
    assert.equal(u.gate, 'acknowledge', path);
  }
  for (const path of ['.claude/agents/notes.txt', '.claude/agents/sub', '.opencode/agents/linked.md']) {
    const u = at(plan, path);
    assert.ok(u, path);
    assert.equal(u.gate, 'none', path);
  }
  assert.equal(plan.ready, false);
  // A2: a rules file that may hold a deny was not read, so the Codex shell allow is dropped too.
  assert.deepEqual(rules(plan), []);
  assert.match(at(plan, '.codex/rules/default.rules', '/0').reason, /a deny of this action could not be carried/);
});

test('A2: a deny that cannot be mapped drops every allow of the same action from that engine, with a warning', t => {
  const p = project(t, {
    'opencode.json': json({ permission: { edit: { '*': 'allow', '*.env': 'deny' }, bash: { 'git status': 'allow' } } }),
    '.claude/settings.json': json({ permissions: { allow: ['Edit(src/**)', 'Read(docs/**)'], deny: ['Read(~/.ssh/**)'] } }),
  });
  const plan = planAdoption(p.input({ engines: [{ id: 'claude-code' }, { id: 'opencode' }] }));
  assert.deepEqual(rules(plan), ['allow-shell']);
  assert.match(at(plan, 'opencode.json', '/permission/edit/#0').reason, /a deny of this action could not be carried/);
  assert.match(at(plan, '.claude/settings.json', '/permissions/allow/0').reason, /a deny of this action could not be carried/);
  assert.match(at(plan, '.claude/settings.json', '/permissions/allow/1').reason, /a deny of this action could not be carried/);
  assert.match(plan.warnings.join('\n'), /opencode: a deny or ask of edit could not be carried/);
  assert.match(plan.warnings.join('\n'), /claude-code: a deny or ask of read could not be carried/);
});

test('A3: a server-wide MCP deny removes the server, and a disallowed tool with a specifier drops its whole class', async t => {
  const p = project(t, { '.claude/agents/a.md': agent('a', 'tools: Read, Bash, mcp__srv__*\ndisallowedTools: mcp__srv, Bash(rm:*), FooTool\n') });
  const plan = planAdoption(p.input({ engines: CC }));
  const notes = item(plan, 'subagents', 'a').notes.join(' ');
  assert.match(notes, /a disallowed Bash entry with a specifier removes the whole shell class/);
  assert.match(notes, /FooTool names no neutral class/);
  await applyAdoption(p.input({ engines: CC }), plan.revision, plan.approvalsRequired);
  const def = loadDefinition(p.def).definition;
  assert.deepEqual(def.entries.subagents[0].tools, ['read']);
});

test('A4: a Codex MCP server with enabled_tools, or disabled_tools it cannot carry, is not adopted; a dropped server names its disabled tools', t => {
  const p = project(t, {
    '.codex/config.toml': [
      '[mcp_servers.allowlisted]', 'command = "npx"', 'enabled_tools = ["read_page"]',
      '[mcp_servers.badlist]', 'command = "npx"', 'disabled_tools = ["a b"]',
      '[mcp_servers.broken]', 'command = "npx"', 'env_vars = ["not a name"]', 'disabled_tools = ["delete_page"]',
    ].join('\n') + '\n',
  });
  const plan = planAdoption(p.input({ engines: [{ id: 'codex' }] }));
  assert.deepEqual(plan.items.filter(i => i.part === 'mcp'), []);
  assert.match(at(plan, '.codex/config.toml', '/mcp_servers/allowlisted/enabled_tools').reason, /not adopted/);
  assert.match(at(plan, '.codex/config.toml', '/mcp_servers/badlist/disabled_tools').reason, /not adopted/);
  assert.match(at(plan, '.codex/config.toml', '/mcp_servers/broken/disabled_tools').reason, /"delete_page"/);
});

test('A5: the parsers refuse nesting past 64 with a code, and a rule with too many alternatives is refused before it expands', t => {
  const deep = 'x = ' + '['.repeat(70) + ']'.repeat(70) + '\n';
  assert.deepEqual(parseTomlSubset(deep).code, 'TOML_TOO_DEEP');
  const p = project(t, {
    '.codex/rules/deep.rules': `prefix_rule(pattern = ${'['.repeat(70)}"x"${']'.repeat(70)})\n`,
    '.codex/rules/wide.rules': `prefix_rule(pattern = [${Array.from({ length: 12 }, () => '["a", "b", "c", "d"]').join(', ')}], decision = "forbidden")\n`,
  });
  const plan = planAdoption(p.input({ engines: [{ id: 'codex' }] }));
  assert.match(at(plan, '.codex/rules/deep.rules').reason, /deeper than 64/);
  assert.match(at(plan, '.codex/rules/wide.rules', '/0').reason, /more than 64 alternatives/);
});

test('A5: the reader refuses a project past the loader limits before it reads past them, and caps the unmapped list', t => {
  const files = {};
  for (let i = 0; i < 1100; i++) files[`.claude/junk/f${i}.txt`] = 'x\n';
  const p = project(t, files);
  const plan = planAdoption(p.input({ engines: CC }));
  assert.equal(plan.unmapped.length, 1001);
  assert.match(plan.unmapped.at(-1).reason, /100 more entries are not listed/);
  const big = project(t, { '.claude/skills/huge/SKILL.md': skill('huge'), ...Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`.claude/skills/huge/blob${i}.bin`, 'x'.repeat(1000 * 1000)])) });
  assert.throws(() => planAdoption(big.input({ engines: CC })), code('ADOPTION_TOO_LARGE'));
});

test('A6: skill allowed-tools is not adopted as a rule; it is listed with the reason', t => {
  const p = project(t, { '.claude/skills/deploy/SKILL.md': skill('deploy', 'allowed-tools: Bash(git add:*), Read\ndisallowed-tools: Bash(rm:*)\n') });
  const plan = planAdoption(p.input({ engines: CC }));
  assert.deepEqual(rules(plan), ['deny-shell']);
  assert.match(at(plan, '.claude/skills/deploy/SKILL.md', '/allowed-tools').reason, /a skill-scoped grant has no neutral form; without it the engine asks more often/);
});

const TIDY = skill('tidy');
const catalog = extra => json({ format: 'bowerloom/managed-catalog/v1beta2', item: { kind: 'skill', id: 'tidy' }, source: { kind: 'npm', registry: 'https://registry.example.test', package: 'example-tidy', version: '1.0.0' }, harnesses: ['claude'], surfaces: [{ id: 'projection-claude', path: '.claude/skills/tidy' }], ...extra });

test('A8: a catalog copy path that is absolute or holds .. is refused; a converted source is marked as claimed and needs approval', t => {
  const p = project(t, { '.bowerloom/managed/catalog/tidy.json': catalog({ surfaces: [{ id: 'projection-claude', path: '../outside/tidy' }] }), '.bowerloom/managed/skills/tidy/SKILL.md': TIDY });
  const bad = planAdoption(p.input({ engines: CC }));
  assert.equal(item(bad, 'skills', 'tidy'), undefined);
  assert.match(at(bad, '.bowerloom/managed/catalog/tidy.json').reason, /relative/);
  const q = project(t, { '.bowerloom/managed/catalog/tidy.json': catalog(), '.bowerloom/managed/skills/tidy/SKILL.md': TIDY });
  const plan = planAdoption(q.input({ engines: CC }));
  assert.equal(item(plan, 'skills', 'tidy').source.claimed, true);
  assert.ok(item(plan, 'skills', 'tidy').needsApproval.some(n => /claims/.test(n)));
});

test('A10: a key that is not a safe name shows in a pointer as its index', t => {
  const p = project(t, { 'opencode.json': json({ permission: { bash: { 'git status': 'allow', 'rm -rf *': 'deny' }, read: { 'docs/*': 'deny' } } }) });
  const plan = planAdoption(p.input({ engines: [{ id: 'opencode' }] }));
  assert.ok(at(plan, 'opencode.json', '/permission/read/#0'));
  const places = plan.items.filter(i => i.part === 'guardrails').flatMap(i => i.places.map(x => x.pointer)).sort();
  assert.deepEqual(places, ['/permission/bash/#0', '/permission/bash/#1']);
});

test('A12: a 0.7 restriction that names no engine of this harness is not widened to every engine', t => {
  const p = project(t, { '.bowerloom/managed/catalog/tidy.json': catalog({ harnesses: ['hermes'] }), '.bowerloom/managed/skills/tidy/SKILL.md': TIDY });
  const plan = planAdoption(p.input({ engines: CC }));
  assert.equal(item(plan, 'skills', 'tidy'), undefined);
  assert.match(at(plan, '.bowerloom/managed/skills/tidy').reason, /names no engine of this harness/);
});

test('A15: nested instruction files are listed; an @path import in adopted instructions makes the plan not ready', async t => {
  const p = project(t, {
    'CLAUDE.md': '# Rules\n\nSee @docs/style.md for the style.\n',
    'docs/style.md': 'Style.\n',
    'packages/web/AGENTS.md': '# Web\n',
    'packages/web/CLAUDE.md': '# Web for Claude\n',
    'node_modules/dep/AGENTS.md': '# dependency\n',
  });
  const plan = planAdoption(p.input({ engines: CC }));
  assert.ok(at(plan, 'packages/web/AGENTS.md'));
  assert.ok(at(plan, 'packages/web/CLAUDE.md'));
  assert.equal(at(plan, 'node_modules/dep/AGENTS.md'), undefined);
  const imp = at(plan, 'CLAUDE.md', '/lines/3');
  assert.equal(imp.gate, 'block');
  assert.match(imp.reason, /Inline/);
  assert.equal(plan.ready, false);
  await assert.rejects(applyAdoption(p.input({ engines: CC }), plan.revision, plan.approvalsRequired), code('ADOPTION_AT_IMPORT'));
});

test('A18: an input model over a file model warns; dropped sandbox values are each listed; differences name real engines; a user header is never overwritten', t => {
  const p = project(t, {
    '.claude/settings.json': json({ model: 'model-a', permissions: { deny: ['Bash(rm *)'] } }),
    'opencode.json': json({ permission: { bash: { 'rm *': 'ask' } } }),
    '.codex/config.toml': '[sandbox_workspace_write]\nnetwork_access = true\nexclude_slash_tmp = true\n[mcp_servers.r]\nurl = "https://mcp.example.test/"\nbearer_token_env_var = "R_TOKEN"\nhttp_headers = { Authorization = "Basic ${R_BASIC}" }\n',
  });
  const harness = [{ id: 'claude-code', model: 'model-b' }, { id: 'codex' }, { id: 'opencode' }];
  const plan = planAdoption(p.input({ engines: harness }));
  assert.match(plan.warnings.join('\n'), /input model for claude-code overrides the model in \.claude\/settings\.json/);
  for (const k of ['network_access', 'exclude_slash_tmp']) assert.equal(at(plan, '.codex/config.toml', `/sandbox_workspace_write/${k}`)?.gate, 'acknowledge', k);
  assert.deepEqual(plan.differences[0].rules.map(r => [r.effect, r.engines]), [['ask', ['opencode']], ['deny', ['claude-code']]]);
  const r = item(plan, 'mcp', 'r');
  assert.ok(r);
  assert.match(at(plan, '.codex/config.toml', '/mcp_servers/r/bearer_token_env_var').reason, /Authorization/);
  const q = project(t, { '.claude/settings.json': json({ permissions: { deny: ['Bash(rm *)'], ask: ['Bash(rm *)'] } }), 'opencode.json': json({ permission: { bash: { 'rm *': 'deny' } } }) });
  const shared = planAdoption(q.input({ engines: [{ id: 'claude-code' }, { id: 'opencode' }] }));
  assert.deepEqual(shared.differences[0].rules.map(r => [r.effect, r.engines]), [['ask', ['claude-code']], ['deny', ['claude-code', 'opencode']]]);
});

test('A19: copies read by one engine, one with a private block and one without, are a conflict; merged copies with different bytes say so', t => {
  const p = project(t, {
    '.claude/skills/review/SKILL.md': skill('review', 'when_to_use: Before a merge.\n'),
    '.agents/skills/review/SKILL.md': skill('review'),
  });
  const plan = planAdoption(p.input({ engines: [{ id: 'opencode' }] }));
  assert.deepEqual(plan.conflicts.map(c => c.key), ['skills/review']);
  const q = project(t, {
    '.claude/skills/lint/SKILL.md': skill('lint'),
    '.agents/skills/lint/SKILL.md': skill('lint').replace('description: Reviews', 'description: "Reviews').replace('merge.\n', 'merge."\n'),
  });
  const merged = planAdoption(q.input({ engines: [{ id: 'claude-code' }, { id: 'codex' }] }));
  assert.match(item(merged, 'skills', 'lint').notes.join(' '), /\.agents\/skills\/lint.*\.claude\/skills\/lint.*differ in bytes/);
});

test('A13: a private-block clash and a model clash between copies of one item are conflicts, not merges', t => {
  const p = project(t, {
    'opencode.json': json({ agent: { helper: { description: 'Helps.', prompt: 'Help.', model: 'provider/model-a' } } }),
    '.opencode/agents/helper.md': '---\ndescription: Helps.\nmodel: provider/model-b\n---\nHelp.\n',
  });
  assert.deepEqual(planAdoption(p.input({ engines: [{ id: 'opencode' }] })).conflicts.map(c => c.key), ['subagents/helper']);
  const q = project(t, {
    'opencode.json': json({ agent: { helper: { description: 'Helps.', prompt: 'Help.', temperature: 0.1 } } }),
    '.opencode/agents/helper.md': '---\ndescription: Helps.\ntemperature: 0.2\n---\nHelp.\n',
  });
  assert.deepEqual(planAdoption(q.input({ engines: [{ id: 'opencode' }] })).conflicts.map(c => c.key), ['subagents/helper']);
});

test('A13: picking an engine copy over a 0.7 skill fixed in place is refused; picking the fixed one works', t => {
  const p = project(t, { '.bowerloom/skills/house/SKILL.md': skill('house', '', 'Fixed.\n'), '.claude/skills/house/SKILL.md': skill('house', '', 'Edited.\n') });
  assert.throws(() => planAdoption(p.input({ engines: CC, choices: { 'skills/house': { pick: '.claude/skills/house' } } })), code('ADOPTION_CHOICE_INVALID'));
  assert.equal(planAdoption(p.input({ engines: CC, choices: { 'skills/house': { pick: '.bowerloom/skills/house' } } })).ready, true);
});

test('A13: a subagent whose disallowedTools is not a list is not adopted; an OpenCode permission key with a bad value is listed', t => {
  const p = project(t, { '.claude/agents/a.md': agent('a', 'disallowedTools: 5\n'), 'opencode.json': json({ permission: { bash: 5 } }) });
  const plan = planAdoption(p.input({ engines: [{ id: 'claude-code' }, { id: 'opencode' }] }));
  assert.equal(item(plan, 'subagents', 'a'), undefined);
  assert.match(at(plan, '.claude/agents/a.md').reason, /not a list of tool names/);
  assert.equal(at(plan, 'opencode.json', '/permission/bash').gate, 'acknowledge');
  assert.deepEqual(gated(plan), ['opencode.json#/permission/bash']);
});
