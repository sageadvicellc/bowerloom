// Spec 01a, section 10.5: planning team agents in `bowerloom apply`. Every test runs with the network denied.
import test from '../../../dist/tests/support/lock-slot-retry.js';
import { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { denyNetwork, localSkill, localEntry, writeManifest } from './sync-fixture.mjs';
import { applyProjectApply, APPLY_PLAN_FORMAT, APPLY_RESULT_FORMAT } from '../../../dist/packages/project-sync/src/index.js';
import { claudeCopyBytes, BUILTIN_AGENT_NAMES } from '../../../dist/packages/project-sync/src/agents.js';
import { sourceHash } from '../../../dist/packages/project-sync/src/agents.js';
import { agentProject, createTeam, createPrompt, agentText, agentSource, agentDir, claudeAgent, target, plan, applied, review, byId, read, exists, code, exactTree, signal } from './agents-fixture.mjs';

const network = denyNetwork();
after(() => assert.deepEqual(network, []));

const lines = text => text.split('\n');
const WARNING = role => `${role} is also the name of a built-in Claude Code agent. Check which one Claude Code uses.`;

test('1. the plan lists a first-team agent as install agent with the Claude path', async t => {
  const f = await agentProject(t); agentSource(f, 'first-team', 'scribe.md', agentText('scribe'));
  const p = await plan(f, ['claude']);
  assert.equal(p.format, APPLY_PLAN_FORMAT); assert.equal(p.agents.length, 1); assert.equal(p.actionable, true);
  const a = p.agents[0];
  assert.deepEqual([a.id, a.team, a.itemId, a.state, a.action, a.harnesses], ['scribe', 'first-team', 'agent_scribe', 'new', 'install', ['claude']]);
  assert.deepEqual(a.expected.surfaces, [{ id: 'agent-claude', path: '.claude/agents/scribe.md' }, { id: 'catalog', path: '.bowerloom/managed/catalog/agent_scribe.json' }]);
  assert.deepEqual(a.expected.source, { kind: 'agent', path: 'teams/first-team/agents/scribe.md' });
  assert.equal(a.expected.files.length, 1); assert.equal(a.hold, null); assert.equal(a.builtin, false); assert.deepEqual(a.notices, ['all-tools']);
  assert.equal(p.writesAuthorized, false); assert.equal(p.executionAuthorized, false);
  assert.match(review(p), /^ {2}scribe +install agent: \.claude\/agents\/scribe\.md$/m);
  assert.match(review(p), /^Apply skills, prompts, and agents for Claude Code$/m);
});

test('2. after apply, a second plan says agent up to date and has nothing to change', async t => {
  const f = await agentProject(t); agentSource(f, 'first-team', 'scribe.md', agentText('scribe'));
  await applied(f, ['claude']);
  const p = await plan(f, ['claude']);
  assert.equal(p.actionable, false); assert.deepEqual([p.agents[0].state, p.agents[0].action], ['up-to-date', 'none']);
  assert.match(review(p), /^ {2}scribe +agent up to date$/m); assert.doesNotMatch(review(p), /Warning:|Note:/);
});

test('3. editing the source gives update agent and a different revision', async t => {
  const f = await agentProject(t); agentSource(f, 'first-team', 'scribe.md', agentText('scribe'));
  await applied(f, ['claude']); const before = await plan(f, ['claude']);
  agentSource(f, 'first-team', 'scribe.md', agentText('scribe', '', 'Changed.\n'));
  const p = await plan(f, ['claude']);
  assert.deepEqual([p.agents[0].state, p.agents[0].action], ['edited', 'update']); assert.notEqual(p.revision, before.revision);
  assert.match(review(p), /^ {2}scribe +update agent: \.claude\/agents\/scribe\.md$/m);
});

test('4. the plan revision changes when an agent is added', async t => {
  const f = await agentProject(t); const none = await plan(f, ['claude']);
  assert.deepEqual(none.agents, []); assert.equal(none.codexAgentsSkipped, false);
  agentSource(f, 'first-team', 'scribe.md', agentText('scribe')); const one = await plan(f, ['claude']);
  agentSource(f, 'first-team', 'editor.md', agentText('editor')); const two = await plan(f, ['claude']);
  assert.equal(new Set([none.revision, one.revision, two.revision]).size, 3);
  assert.deepEqual(two.agents.map(a => a.id), ['editor', 'scribe']);
});

test('5. a source that changes after the plan refuses STALE_APPROVAL and writes nothing', async t => {
  const f = await agentProject(t); agentSource(f, 'first-team', 'scribe.md', agentText('scribe'));
  const p = await plan(f, ['claude']); agentSource(f, 'first-team', 'scribe.md', agentText('scribe', '', 'Other.\n'));
  const before = exactTree(f.base);
  await assert.rejects(applyProjectApply(f.input(['claude']), p.revision, signal()), code('STALE_APPROVAL'));
  assert.equal(exactTree(f.base), before); assert.equal(exists(f, '.claude'), false);
});

test('6. --team plans only that team\'s agents and does not show the others as kept', async t => {
  const f = await agentProject(t); await createTeam(f, 'desk');
  agentSource(f, 'first-team', 'scribe.md', agentText('scribe')); agentSource(f, 'desk', 'editor.md', agentText('editor'));
  await applied(f, ['claude']);
  const desk = await plan(f, ['claude'], { team: 'desk' }), first = await plan(f, ['claude'], { team: 'first-team' });
  assert.deepEqual(desk.agents.map(a => [a.id, a.state]), [['editor', 'up-to-date']]); assert.deepEqual(first.agents.map(a => [a.id, a.state]), [['scribe', 'up-to-date']]);
  assert.doesNotMatch(review(desk), /scribe/); assert.doesNotMatch(review(first), /editor/); assert.doesNotMatch(review(desk) + review(first), /kept/);
  // A new agent in another team is not planned either.
  agentSource(f, 'first-team', 'writer.md', agentText('writer'));
  assert.deepEqual((await plan(f, ['claude'], { team: 'desk' })).agents.map(a => a.id), ['editor']);
});

test('7. a deleted source is kept: the copy and the catalog stay', async t => {
  const f = await agentProject(t); const file = agentSource(f, 'first-team', 'scribe.md', agentText('scribe'));
  await applied(f, ['claude']); fs.rmSync(file);
  const p = await plan(f, ['claude']), a = p.agents[0];
  assert.deepEqual([a.id, a.team, a.state, a.action], ['scribe', null, 'orphaned', 'none']); assert.equal(p.actionable, false);
  assert.match(review(p), /^ {2}scribe +agent kept: no longer an agent of this project, and apply removes nothing$/m);
  const before = exactTree(path.join(f.projectDir, '.claude')), result = await applyProjectApply(f.input(['claude']), p.revision, signal());
  assert.deepEqual(result.orphaned, [{ kind: 'agent', id: 'scribe' }]); assert.equal(exactTree(path.join(f.projectDir, '.claude')), before);
  assert.ok(exists(f, '.bowerloom/managed/catalog/agent_scribe.json'));
});

test('8. the same role in two teams holds both with APPLY_AGENT_DUPLICATE, writes neither, and the rest applies', async t => {
  const f = await agentProject(t); await createTeam(f, 'desk');
  agentSource(f, 'first-team', 'scribe.md', agentText('scribe')); agentSource(f, 'desk', 'scribe.md', agentText('scribe')); agentSource(f, 'desk', 'editor.md', agentText('editor'));
  const { plan: p, result } = await applied(f, ['claude']);
  const twins = p.agents.filter(a => a.id === 'scribe');
  assert.deepEqual(twins.map(a => [a.team, a.state, a.action, a.hold.code]), [['desk', 'held', 'hold', 'APPLY_AGENT_DUPLICATE'], ['first-team', 'held', 'hold', 'APPLY_AGENT_DUPLICATE']]);
  for (const a of twins) { assert.match(a.hold.next, /\.bowerloom\/teams\/desk\/agents\/scribe\.md/); assert.match(a.hold.next, /\.bowerloom\/teams\/first-team\/agents\/scribe\.md/); assert.match(a.hold.next, /both define scribe\. Rename or remove one, then run bowerloom apply\.$/); }
  assert.equal(exists(f, '.claude/agents/scribe.md'), false); assert.equal(read(f, '.claude/agents/editor.md'), agentText('editor'));
  assert.deepEqual(result.applied.map(x => [x.kind, x.id]), [['agent', 'editor']]); assert.equal(result.held.filter(h => h.code === 'APPLY_AGENT_DUPLICATE').length, 2);
  // With one twin invalid, both are still held as duplicates.
  const g = await agentProject(t); await createTeam(g, 'desk');
  agentSource(g, 'first-team', 'scribe.md', agentText('scribe')); agentSource(g, 'desk', 'scribe.md', 'not an agent file');
  assert.deepEqual((await plan(g, ['claude'])).agents.map(a => a.hold.code), ['APPLY_AGENT_DUPLICATE', 'APPLY_AGENT_DUPLICATE']);
});

test('8b. a role that was installed stays installed when a twin appears', async t => {
  const f = await agentProject(t); await createTeam(f, 'desk'); agentSource(f, 'first-team', 'scribe.md', agentText('scribe'));
  await applied(f, ['claude']); const copy = read(f, '.claude/agents/scribe.md');
  agentSource(f, 'desk', 'scribe.md', agentText('scribe', '', 'Other.\n'));
  const { plan: p } = await applied(f, ['claude']);
  assert.ok(p.agents.every(a => a.hold?.code === 'APPLY_AGENT_DUPLICATE')); assert.equal(read(f, '.claude/agents/scribe.md'), copy);
});

test('9. an invalid agent file holds only that agent; a skill and a prompt in the plan still install', async t => {
  const f = await agentProject(t); localSkill(f, 'house-style'); writeManifest(f, [localEntry('house-style')]); await createPrompt(f, 'weekly-update', 'Week.\n');
  agentSource(f, 'first-team', 'good.md', agentText('good')); agentSource(f, 'first-team', 'broken.md', '---\nname: broken\n---\nBody\n');
  const { plan: p, result } = await applied(f, ['claude']);
  const agents = byId(p.agents);
  assert.deepEqual([agents.broken.action, agents.broken.hold.code, agents.good.action], ['hold', 'AGENT_INVALID', 'install']);
  assert.match(agents.broken.hold.next, /^Fix \.bowerloom\/teams\/first-team\/agents\/broken\.md: .*\. Then run bowerloom apply\.$/);
  assert.deepEqual(result.applied.map(x => [x.kind, x.id]), [['skill', 'house-style'], ['prompt', 'weekly-update'], ['agent', 'good']]);
  assert.deepEqual(result.held.map(h => [h.kind, h.id, h.code]), [['agent', 'broken', 'AGENT_INVALID']]);
  assert.equal(exists(f, '.claude/agents/broken.md'), false);
});

test('9b. the other parse failures hold with their own codes and next steps', async t => {
  const f = await agentProject(t);
  agentSource(f, 'first-team', 'typo.md', agentText('typo', 'tool: Read')); agentSource(f, 'first-team', 'mismatch.md', agentText('other'));
  agentSource(f, 'first-team', 'Scribe.md', agentText('Scribe')); agentSource(f, 'first-team', 'notes.txt', 'text'); fs.mkdirSync(path.join(agentDir(f, 'first-team'), 'folder.md'));
  agentSource(f, 'first-team', '.hidden.md', agentText('hidden'));
  fs.symlinkSync(path.join(f.base, 'outside.md'), path.join(agentDir(f, 'first-team'), 'linked.md')); fs.writeFileSync(path.join(f.base, 'outside.md'), agentText('linked'));
  const p = await plan(f, ['claude']), agents = byId(p.agents);
  const held = Object.fromEntries(p.agents.map(a => [a.id, a.hold?.code]));
  assert.deepEqual(held, { typo: 'AGENT_KEY_UNKNOWN', mismatch: 'AGENT_NAME_MISMATCH', Scribe: 'AGENT_NAME_MISMATCH', 'notes.txt': 'AGENT_INVALID', folder: 'AGENT_INVALID', linked: 'AGENT_INVALID' });
  assert.equal(agents.typo.hold.next, 'Remove the key tool from .bowerloom/teams/first-team/agents/typo.md, then run bowerloom apply.');
  assert.equal(agents.mismatch.hold.next, 'Make the name key equal mismatch in .bowerloom/teams/first-team/agents/mismatch.md, and name the file with lowercase letters, digits, and single hyphens. Then run bowerloom apply.');
  assert.equal(p.actionable, false);
});

test('10. a differing hand-made copy is held with AGENT_TARGET_OCCUPIED and is not refused', async t => {
  const f = await agentProject(t); agentSource(f, 'first-team', 'scribe.md', agentText('scribe')); const mine = claudeAgent(f, 'scribe.md', 'Mine.\n');
  const p = await plan(f, ['claude']), a = p.agents[0];
  assert.deepEqual([a.state, a.action, a.hold.code], ['held', 'hold', 'AGENT_TARGET_OCCUPIED']); assert.equal(p.actionable, false);
  assert.equal(a.hold.next, '.claude/agents/scribe.md was not installed by Bowerloom and differs from .bowerloom/teams/first-team/agents/scribe.md. Move it aside, then run bowerloom apply.');
  assert.match(review(p), /^ {2}scribe +agent held \(AGENT_TARGET_OCCUPIED\)$/m); assert.match(review(p), /^ {2} +Next: \.claude\/agents\/scribe\.md was not installed/m);
  const before = exactTree(path.join(f.projectDir, '.claude')), result = await applyProjectApply(f.input(['claude']), p.revision, signal());
  assert.deepEqual(result.applied, []); assert.equal(exactTree(path.join(f.projectDir, '.claude')), before); assert.equal(fs.readFileSync(mine, 'utf8'), 'Mine.\n');
});

test('11. the built-in warning prints for Claude Code built-in names, not for others, and not for up to date', async t => {
  assert.deepEqual([...BUILTIN_AGENT_NAMES], ['Explore', 'Plan', 'general-purpose', 'statusline-setup', 'claude-code-guide', 'claude']);
  const f = await agentProject(t), roles = ['plan', 'explore', 'claude', 'statusline-setup', 'claude-code-guide', 'general-purpose', 'scribe'];
  for (const r of roles) agentSource(f, 'first-team', r + '.md', agentText(r));
  const p = await plan(f, ['claude']), text = review(p);
  for (const r of roles.filter(r => r !== 'scribe')) assert.ok(text.includes(`Warning: ${WARNING(r)}`), r);
  assert.equal((text.match(/Warning:/g) ?? []).length, 6); assert.ok(!text.includes('Warning: scribe'));
  assert.deepEqual(p.agents.filter(a => a.builtin).map(a => a.id).sort(), ['claude', 'claude-code-guide', 'explore', 'general-purpose', 'plan', 'statusline-setup']);
  const line = lines(text).find(l => l.includes('Warning: plan ')); assert.match(line, /^ {2} +Warning: plan is also the name of a built-in Claude Code agent\. Check which one Claude Code uses\.$/);
  await applied(f, ['claude']); assert.doesNotMatch(review(await plan(f, ['claude'])), /Warning:/);
});

test('12. the notice line is exact for each notice item, for the items together, and on an adopt', async t => {
  const f = await agentProject(t);
  const cases = {
    hooked: ['hooks:\n  PreToolUse:\n    - matcher: Bash\ntools: Read', 'sets hooks'],
    served: ['mcpServers:\n  docs:\n    command: docs\ntools: Read', 'sets mcpServers'],
    loose: ['permissionMode: bypassPermissions\ntools: Read', 'sets permissionMode bypassPermissions'],
    dont: ['permissionMode: dontAsk\ntools: Read', 'sets permissionMode dontAsk'],
    shelled: ['tools: Read, Bash(npm run *)', 'lists shell tools in tools'],
    monitor: ['tools: Monitor', 'lists shell tools in tools'],
    power: ['tools: PowerShell', 'lists shell tools in tools'],
    inherit: ['model: sonnet', 'inherits every tool, including shell tools'],
    together: ['hooks:\n  a: 1\nmcpServers:\n  b: 1\npermissionMode: bypassPermissions\ntools: Bash', 'sets hooks, sets mcpServers, sets permissionMode bypassPermissions and lists shell tools in tools'],
    inheriting: ['hooks:\n  a: 1\nmcpServers:\n  b: 1\npermissionMode: auto', 'sets hooks, sets mcpServers, sets permissionMode auto and inherits every tool, including shell tools'],
    quiet: ['tools: Read, Grep\npermissionMode: plan', null], safe: ['tools: Read\npermissionMode: default', null], notbash: ['tools: bash, MultiEdit', null],
  };
  for (const [role, [extra]] of Object.entries(cases)) agentSource(f, 'first-team', role + '.md', agentText(role, extra));
  const allow = ['hooked', 'served', 'loose', 'together', 'inheriting'].map(r => `${r}:${sourceHash(agentText(r, cases[r][0]))}`);
  const text = review(await plan(f, ['claude'], { allow }));
  for (const [role, [, what]] of Object.entries(cases)) {
    const note = `Note: agent ${role} ${what}. Claude Code applies them when the agent runs. Review .bowerloom/teams/first-team/agents/${role}.md.`;
    if (what) assert.ok(lines(text).includes(`  ${note}`), `${role}\n${text}`); else assert.ok(!text.includes(`Note: agent ${role} `), role);
  }
  // Order: main line, warning, notice.
  const g = await agentProject(t); agentSource(g, 'first-team', 'plan.md', agentText('plan', 'tools: Bash'));
  const order = lines(review(await plan(g, ['claude']))).filter(l => /plan|Warning|Note/.test(l) && !/^Apply|^Network|^Copies/.test(l));
  assert.match(order[0], /install agent/); assert.match(order[1], /Warning:/); assert.match(order[2], /Note: agent plan lists shell tools/);
  // An adopt prints the notice too.
  const h = await agentProject(t), text2 = agentText('scribe', 'tools: Bash'); agentSource(h, 'first-team', 'scribe.md', text2); claudeAgent(h, 'scribe.md', text2);
  const adopt = await plan(h, ['claude']); assert.equal(adopt.agents[0].state, 'adopt'); assert.match(review(adopt), /Note: agent scribe lists shell tools in tools\./);
});

test('13. --harness codex with agents: no agent line, the Codex line once, no kept line, the old title and empty text', async t => {
  const f = await agentProject(t); agentSource(f, 'first-team', 'scribe.md', agentText('scribe')); await applied(f, ['claude']);
  const p = await plan(f, ['codex']), text = review(p);
  assert.deepEqual(p.agents, []); assert.equal(p.codexAgentsSkipped, true); assert.equal(p.actionable, false);
  assert.match(text, /^Apply skills and prompts for Codex$/m);
  assert.match(text, /^ {2}Nothing in \.bowerloom\/skills\.json or \.bowerloom\/prompts to apply yet\.$/m);
  assert.equal(lines(text).filter(l => l === 'Codex agents are not projected in this beta. See the capability model design.').length, 1);
  assert.doesNotMatch(text, /scribe|kept/);
  const order = lines(text); assert.ok(order.indexOf('Codex agents are not projected in this beta. See the capability model design.') < order.findIndex(l => l.startsWith('Network:')));
  assert.doesNotMatch(p.pointer, /Agents are in/);
});

test('14. --harness both with agents: agent lines and the Codex line', async t => {
  const f = await agentProject(t); agentSource(f, 'first-team', 'scribe.md', agentText('scribe'));
  const p = await plan(f, ['claude', 'codex']), text = review(p);
  assert.equal(p.agents.length, 1); assert.equal(p.codexAgentsSkipped, true); assert.match(text, /install agent: \.claude\/agents\/scribe\.md/);
  assert.equal(lines(text).filter(l => l === 'Codex agents are not projected in this beta. See the capability model design.').length, 1);
  assert.match(text, /^Apply skills, prompts, and agents for Claude Code and Codex$/m); assert.match(p.pointer, / Agents are in \.claude\/agents\.$/);
});

test('15. --harness claude: agent lines and no Codex line', async t => {
  const f = await agentProject(t); agentSource(f, 'first-team', 'scribe.md', agentText('scribe'));
  const p = await plan(f, ['claude']), text = review(p);
  assert.equal(p.codexAgentsSkipped, false); assert.doesNotMatch(text, /Codex agents are not projected/); assert.match(p.pointer, /Project skills are in \.claude\/skills\. Prompts are Claude Code commands in \.claude\/commands\. Agents are in \.claude\/agents\./);
});

test('16. --harness codex with no agent files: no Codex line', async t => {
  const f = await agentProject(t); await createTeam(f, 'desk'); fs.mkdirSync(agentDir(f, 'desk'), { mode: 0o755 });
  const p = await plan(f, ['codex']); assert.equal(p.codexAgentsSkipped, false); assert.doesNotMatch(review(p), /Codex agents are not projected/);
  assert.equal(p.pointer.includes('Agents are in'), false);
});

test('17. --harness codex with 129 agents refuses AGENT_LIMIT, and an unsafe agents folder outranks it', async t => {
  const f = await agentProject(t);
  for (let i = 0; i < 129; i++) agentSource(f, 'first-team', `agent-${String(i).padStart(3, '0')}.md`, agentText(`agent-${String(i).padStart(3, '0')}`));
  await assert.rejects(plan(f, ['codex']), code('AGENT_LIMIT')); await assert.rejects(plan(f, ['claude']), code('AGENT_LIMIT'));
  fs.rmSync(path.join(agentDir(f, 'first-team'), 'agent-128.md')); assert.equal((await plan(f, ['claude'])).agents.length, 128);
  fs.writeFileSync(path.join(agentDir(f, 'first-team'), 'agent-128.md'), agentText('agent-128'));
  await createTeam(f, 'desk'); fs.mkdirSync(agentDir(f, 'desk'), { mode: 0o777 }); fs.chmodSync(agentDir(f, 'desk'), 0o777);
  await assert.rejects(plan(f, ['codex']), code('AUTHORING_UNSAFE_PATH')); await assert.rejects(plan(f, ['claude']), code('AUTHORING_UNSAFE_PATH'));
});

test('18. refusal precedence: unsafe folder, then the limit, then per-file holds in team and role order, then duplicates', async t => {
  const f = await agentProject(t); await createTeam(f, 'desk');
  agentSource(f, 'first-team', 'zeta.md', 'bad'); agentSource(f, 'first-team', 'alpha.md', agentText('alpha', 'tool: x')); agentSource(f, 'desk', 'mid.md', agentText('other'));
  agentSource(f, 'desk', 'alpha.md', 'also bad');
  const p = await plan(f, ['claude']);
  // Sorted by role, then team. The duplicate hold replaces the per-file hold of both alpha twins.
  assert.deepEqual(p.agents.map(a => [a.id, a.team, a.hold.code]), [['alpha', 'desk', 'APPLY_AGENT_DUPLICATE'], ['alpha', 'first-team', 'APPLY_AGENT_DUPLICATE'], ['mid', 'desk', 'AGENT_NAME_MISMATCH'], ['zeta', 'first-team', 'AGENT_INVALID']]);
});

test('19. an agent that moves to another team with the same bytes plans update agent, and the catalog names the new team', async t => {
  const f = await agentProject(t); await createTeam(f, 'desk'); const file = agentSource(f, 'first-team', 'scribe.md', agentText('scribe')); await applied(f, ['claude']);
  fs.rmSync(file); agentSource(f, 'desk', 'scribe.md', agentText('scribe'));
  const { plan: p } = await applied(f, ['claude']);
  assert.deepEqual([p.agents[0].team, p.agents[0].state, p.agents[0].action], ['desk', 'edited', 'update']); assert.match(review(p), /update agent/);
  assert.equal(JSON.parse(read(f, '.bowerloom/managed/catalog/agent_scribe.json')).source.path, 'teams/desk/agents/scribe.md');
  assert.equal((await plan(f, ['claude'])).agents[0].state, 'up-to-date');
});

test('20. first-team agents are planned like any team\'s', async t => {
  const f = await agentProject(t); agentSource(f, 'first-team', 'helper.md', agentText('helper'));
  const { result } = await applied(f, ['claude']); assert.deepEqual(result.applied.map(x => [x.kind, x.id, x.action]), [['agent', 'helper', 'install']]);
});

test('21. the JSON plan has format v1beta2, the agents field with reserved capability fields, and codexAgentsSkipped', async t => {
  const f = await agentProject(t); agentSource(f, 'first-team', 'scribe.md', agentText('scribe'));
  const json = JSON.parse(JSON.stringify(await plan(f)));
  assert.equal(json.format, 'bowerloom/project-apply-plan/v1beta2'); assert.equal(APPLY_PLAN_FORMAT, 'bowerloom/project-apply-plan/v1beta2');
  assert.equal(APPLY_RESULT_FORMAT, 'bowerloom/project-apply-result/v1beta2');
  assert.equal(json.codexAgentsSkipped, true); assert.equal(json.agents.length, 1);
  assert.equal(json.agents[0].capabilities, null); assert.deepEqual(json.agents[0].enforcement, []);
  for (const key of ['id', 'team', 'itemId', 'state', 'action', 'harnesses', 'expected', 'before', 'previousReceiptRevision', 'history', 'hold', 'notices', 'builtin', 'capabilities', 'enforcement']) assert.ok(key in json.agents[0], key);
});

test('22. .claude as a link and .claude/agents writable by the group refuse APPLY_AGENTS_FOLDER_UNSAFE; codex plans without it', async t => {
  const f = await agentProject(t); agentSource(f, 'first-team', 'scribe.md', agentText('scribe'));
  fs.mkdirSync(path.join(f.base, 'elsewhere')); fs.symlinkSync(path.join(f.base, 'elsewhere'), path.join(f.projectDir, '.claude'));
  const before = exactTree(f.base);
  await assert.rejects(plan(f, ['claude']), code('APPLY_AGENTS_FOLDER_UNSAFE')); await assert.rejects(plan(f, ['claude', 'codex']), code('APPLY_AGENTS_FOLDER_UNSAFE'));
  assert.equal(exactTree(f.base), before); assert.equal((await plan(f, ['codex'])).codexAgentsSkipped, true);
  fs.unlinkSync(path.join(f.projectDir, '.claude')); fs.mkdirSync(path.join(f.projectDir, '.claude/agents'), { recursive: true, mode: 0o755 }); fs.chmodSync(path.join(f.projectDir, '.claude/agents'), 0o775);
  await assert.rejects(plan(f, ['claude']), code('APPLY_AGENTS_FOLDER_UNSAFE')); await plan(f, ['codex']);
  fs.chmodSync(path.join(f.projectDir, '.claude'), 0o777); fs.chmodSync(path.join(f.projectDir, '.claude/agents'), 0o755);
  await assert.rejects(plan(f, ['claude']), code('APPLY_AGENTS_FOLDER_UNSAFE'));
  fs.chmodSync(path.join(f.projectDir, '.claude'), 0o755); assert.equal((await plan(f, ['claude'])).agents.length, 1);
});

test('23. claudeCopyBytes returns its input for any string', () => {
  for (const s of ['', 'a', '---\nname: x\n---\nBody\n', 'é🌿\u0000\r\n', 'x'.repeat(70000)]) assert.equal(claudeCopyBytes(s), s);
});

test('24. a catalog with no private state, or one the managed code calls occupied, holds that agent only', async t => {
  const f = await agentProject(t); agentSource(f, 'first-team', 'scribe.md', agentText('scribe')); agentSource(f, 'first-team', 'editor.md', agentText('editor'));
  fs.mkdirSync(path.join(f.bowerloom, 'managed/catalog'), { recursive: true, mode: 0o755 });
  const catalog = path.join(f.bowerloom, 'managed/catalog/agent_scribe.json'); fs.writeFileSync(catalog, '{}\n', { mode: 0o644 }); fs.chmodSync(catalog, 0o644);
  const next = 'Move .bowerloom/managed/catalog/agent_scribe.json aside, then run bowerloom apply.';
  const p = await plan(f, ['claude']), scribe = byId(p.agents).scribe;
  assert.deepEqual([scribe.action, scribe.hold.code, scribe.hold.next], ['hold', 'MANAGED_SKILL_PATH_OCCUPIED', next]); assert.equal(byId(p.agents).editor.action, 'install');
  // A catalog the managed code refuses with PATH_OCCUPIED: a private state folder with no committed receipt.
  const g = await agentProject(t); agentSource(g, 'first-team', 'scribe.md', agentText('scribe')); await applied(g, ['claude']);
  for (const n of fs.readdirSync(path.join(g.itemsRoot, 'agent_scribe'))) fs.rmSync(path.join(g.itemsRoot, 'agent_scribe', n), { recursive: true });
  const h = byId((await plan(g, ['claude'])).agents).scribe; assert.deepEqual([h.action, h.hold.code, h.hold.next], ['hold', 'MANAGED_SKILL_PATH_OCCUPIED', next]);
});

test('25. the shared ignore file is put back through an up-to-date agent, after prompts, and only for the claude harness', async t => {
  const f = await agentProject(t); agentSource(f, 'first-team', 'scribe.md', agentText('scribe')); await applied(f, ['claude']);
  fs.rmSync(path.join(f.bowerloom, 'managed/.gitignore'));
  const p = await plan(f, ['claude']); assert.deepEqual([p.agents[0].state, p.agents[0].action], ['up-to-date', 'update']); assert.equal(p.actionable, true);
  assert.match(review(p), /^ {2}scribe +agent up to date \(puts back \.bowerloom\/managed\/\.gitignore\)$/m);
  assert.equal((await plan(f, ['codex'])).actionable, false);
  await applyProjectApply(f.input(['claude']), p.revision, signal()); assert.equal(read(f, '.bowerloom/managed/.gitignore'), '*\n');
  // With a prompt that is also up to date, the prompt carries the file and the agent does not.
  const g = await agentProject(t); await createPrompt(g, 'review', 'Review.\n'); agentSource(g, 'first-team', 'scribe.md', agentText('scribe')); await applied(g, ['claude']);
  fs.rmSync(path.join(g.bowerloom, 'managed/.gitignore'));
  const q = await plan(g, ['claude']); assert.deepEqual([q.prompts[0].action, q.agents[0].action], ['update', 'none']);
});

test('26. a skill named agent-scribe and an agent named scribe both install with no collision', async t => {
  const f = await agentProject(t); localSkill(f, 'agent-scribe'); writeManifest(f, [localEntry('agent-scribe')]); agentSource(f, 'first-team', 'scribe.md', agentText('scribe'));
  const { result } = await applied(f, ['claude']);
  assert.deepEqual(result.applied.map(x => [x.kind, x.id]), [['skill', 'agent-scribe'], ['agent', 'scribe']]);
  assert.ok(exists(f, '.bowerloom/managed/catalog/agent-scribe.json')); assert.ok(exists(f, '.bowerloom/managed/catalog/agent_scribe.json'));
});

test('27. a byte order mark, invalid UTF-8, a null byte and a carriage return each hold the agent with AGENT_INVALID', async t => {
  const f = await agentProject(t), ok = agentText('plain');
  agentSource(f, 'first-team', 'bom.md', Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(agentText('bom'))]));
  agentSource(f, 'first-team', 'utf.md', Buffer.concat([Buffer.from(agentText('utf')), Buffer.from([0xed, 0xa0, 0x80])]));
  agentSource(f, 'first-team', 'nul.md', agentText('nul', '', 'Body\0here\n')); agentSource(f, 'first-team', 'crlf.md', agentText('crlf').replace(/\n/g, '\r\n')); agentSource(f, 'first-team', 'plain.md', ok);
  const p = await plan(f, ['claude']), codes = Object.fromEntries(p.agents.map(a => [a.id, a.hold?.code ?? null]));
  assert.deepEqual(codes, { bom: 'AGENT_INVALID', crlf: 'AGENT_INVALID', nul: 'AGENT_INVALID', plain: null, utf: 'AGENT_INVALID' });
  assert.equal(byId(p.agents).plain.action, 'install');
});

test('28. a source file over 64 KiB, or one that others can write, holds that agent with AGENT_INVALID', async t => {
  const f = await agentProject(t);
  agentSource(f, 'first-team', 'big.md', agentText('big', '', 'x'.repeat(66000))); agentSource(f, 'first-team', 'loose.md', agentText('loose'), 0o664); agentSource(f, 'first-team', 'fine.md', agentText('fine'));
  const p = await plan(f, ['claude']), codes = Object.fromEntries(p.agents.map(a => [a.id, a.hold?.code ?? null]));
  assert.deepEqual(codes, { big: 'AGENT_INVALID', fine: null, loose: 'AGENT_INVALID' });
});
