// Spec 01a review fixes: tech-lead settlements D1 and D2, security S1 to S6, and silent-failure F1 to F4 with C2.
import test from '../../../dist/tests/support/lock-slot-retry.js';
import { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { denyNetwork } from './sync-fixture.mjs';
import { applyProjectApply } from '../../../dist/packages/project-sync/src/index.js';
import { sourceHash } from '../../../dist/packages/project-sync/src/agents.js';
import { agentProject, createPrompt, agentText, agentSource, claudeAgent, target, plan, applied, review, byId, read, exists, code, signal } from './agents-fixture.mjs';

const network = denyNetwork();
after(() => assert.deepEqual(network, []));
const allowFor = (role, text) => `${role}:${sourceHash(text)}`;
const notices = async (f, extra) => (await plan(f, ['claude'])).agents.map(a => [a.id, a.notices]);

test('D1: hidden files and editor backups in agents/ are neither agents nor holds, and do not count', async t => {
  const f = await agentProject(t);
  for (const name of ['.DS_Store', '.foo.md.swp', 'foo.md~']) agentSource(f, 'first-team', name, 'junk');
  const p = await plan(f, ['claude', 'codex']);
  assert.deepEqual(p.agents, []); assert.equal(p.codexAgentsSkipped, false); assert.equal(p.actionable, false);
  agentSource(f, 'first-team', 'scribe.md', agentText('scribe'));
  assert.deepEqual((await plan(f, ['claude'])).agents.map(a => a.id), ['scribe']);
});

test('D2: a linked teams/first-team is skipped, and a prompt still applies', async t => {
  const f = await agentProject(t); await createPrompt(f, 'review', 'Review it.\n');
  const real = path.join(f.base, 'first-team-real'); fs.renameSync(path.join(f.bowerloom, 'teams/first-team'), real); fs.symlinkSync(real, path.join(f.bowerloom, 'teams/first-team'));
  const { result } = await applied(f, ['claude']);
  assert.deepEqual(result.applied.map(x => [x.kind, x.id]), [['prompt', 'review']]);
});

test('F1: an agent in a team that is not registered is held, and is never called kept', async t => {
  const f = await agentProject(t); const dir = path.join(f.bowerloom, 'teams/ghost/agents'); fs.mkdirSync(dir, { recursive: true, mode: 0o755 });
  for (const p of [path.join(f.bowerloom, 'teams/ghost'), dir]) fs.chmodSync(p, 0o755);
  fs.writeFileSync(path.join(dir, 'scribe.md'), agentText('scribe'), { mode: 0o644 });
  let p = await plan(f, ['claude']), a = p.agents[0];
  assert.deepEqual([a.id, a.team, a.state, a.action, a.hold.code], ['scribe', 'ghost', 'held', 'hold', 'AGENT_TEAM_UNREGISTERED']);
  assert.equal(a.hold.next, 'Create the team with bowerloom team create, or move the agent into a registered team.'); assert.equal(p.actionable, false);
  // An installed agent whose source moved into such a folder is held, not kept.
  const g = await agentProject(t); const file = agentSource(g, 'first-team', 'scribe.md', agentText('scribe')); await applied(g, ['claude']);
  fs.rmSync(file); const gdir = path.join(g.bowerloom, 'teams/ghost/agents'); fs.mkdirSync(gdir, { recursive: true, mode: 0o755 }); fs.chmodSync(path.join(g.bowerloom, 'teams/ghost'), 0o755); fs.chmodSync(gdir, 0o755);
  fs.writeFileSync(path.join(gdir, 'scribe.md'), agentText('scribe'), { mode: 0o644 });
  p = await plan(g, ['claude']); assert.deepEqual(p.agents.map(x => [x.id, x.state, x.hold?.code]), [['scribe', 'held', 'AGENT_TEAM_UNREGISTERED']]); assert.doesNotMatch(review(p), /kept/);
});

test('F3: an orphan whose copy changed, or whose copy is gone, is held with the managed code, not kept', async t => {
  const f = await agentProject(t); const file = agentSource(f, 'first-team', 'scribe.md', agentText('scribe')); await applied(f, ['claude']);
  fs.rmSync(file); let p = await plan(f, ['claude']); assert.deepEqual([p.agents[0].state, p.agents[0].action], ['orphaned', 'none']);
  fs.appendFileSync(target(f, 'scribe'), 'My edit.\n'); p = await plan(f, ['claude']);
  assert.deepEqual([p.agents[0].state, p.agents[0].action, p.agents[0].hold.code], ['drift', 'hold', 'MANAGED_SKILL_LOCAL_DRIFT']); assert.doesNotMatch(review(p), /kept/); assert.match(review(p), /agent held \(MANAGED_SKILL_LOCAL_DRIFT\)/);
  fs.rmSync(target(f, 'scribe')); p = await plan(f, ['claude']);
  assert.deepEqual([p.agents[0].action, p.agents[0].hold.code], ['hold', 'MANAGED_SKILL_LOCAL_DRIFT']); assert.equal(p.actionable, false);
});

test('F4: the managed code reaches the target hold text', async t => {
  const f = await agentProject(t); agentSource(f, 'first-team', 'scribe.md', agentText('scribe')); claudeAgent(f, 'scribe.md', agentText('scribe'), 0o600);
  const a = (await plan(f, ['claude'])).agents[0];
  assert.equal(a.hold.code, 'AGENT_TARGET_OCCUPIED'); assert.match(a.hold.next, /cannot be read as a plain file that you own \(MANAGED_SKILL_[A-Z_]+\)\. Move it aside, then run bowerloom apply\.$/);
});

test('C2: an unsafe agents folder names the folder', async t => {
  const f = await agentProject(t); agentSource(f, 'first-team', 'scribe.md', agentText('scribe')); fs.chmodSync(path.join(f.bowerloom, 'teams/first-team/agents'), 0o775);
  await assert.rejects(plan(f, ['claude']), e => code('AUTHORING_UNSAFE_PATH')(e) && e.message.includes('.bowerloom/teams/first-team/agents'));
});

test('S1 and S4: tool notices name wildcards, empty lists, MCP, editing, web and agent tools', async t => {
  const f = await agentProject(t);
  const cases = {
    star: ['tools: "*"', ['all-tools']], pattern: ['tools:\n  - Bash(*)', ['shell-tools']], empty: ['tools: []', ['all-tools']], mcpstar: ['tools: mcp__*', ['mcp-tools', 'all-tools']],
    mcp: ['tools: Read, mcp__server__tool', ['mcp-tools']], editor: ['tools: Read, Write, NotebookEdit', ['edit-tools']], editing: ['tools: Edit', ['edit-tools']], web: ['tools: WebFetch, WebSearch', ['web-tools']],
    spawner: ['tools: Agent', ['agent-tools']], tasker: ['tools: Task', ['agent-tools']], quiet: ['tools: Read, Grep', []], all: ['tools: Bash, Write, WebFetch, mcp__a__b, Agent', ['shell-tools', 'edit-tools', 'web-tools', 'mcp-tools', 'agent-tools']],
  };
  for (const [role, [extra]] of Object.entries(cases)) agentSource(f, 'first-team', role + '.md', agentText(role, extra));
  const got = Object.fromEntries((await plan(f, ['claude'])).agents.map(a => [a.id, a.notices]));
  for (const [role, [, want]] of Object.entries(cases)) assert.deepEqual(got[role], want, role);
  const text = review(await plan(f, ['claude']));
  for (const phrase of ['lists file-editing tools in tools', 'lists web tools in tools', 'lists MCP tools in tools', 'lists the Agent tool in tools', 'lists shell tools in tools']) assert.ok(text.includes(phrase), phrase);
  assert.ok(text.includes('Note: agent all lists shell tools in tools, lists file-editing tools in tools, lists web tools in tools, lists MCP tools in tools and lists the Agent tool in tools.'), text);
});

test('S2: bypassPermissions, hooks and mcpServers hold the agent until --allow-agent names its hash', async t => {
  const f = await agentProject(t), specs = { bypass: 'permissionMode: bypassPermissions\ntools: Read', hooked: 'hooks:\n  PreToolUse:\n    - matcher: Bash\ntools: Read', served: 'mcpServers:\n  docs:\n    command: docs\ntools: Read', calm: 'permissionMode: dontAsk\ntools: Read' };
  for (const [role, extra] of Object.entries(specs)) agentSource(f, 'first-team', role + '.md', agentText(role, extra));
  const text = role => agentText(role, specs[role]);
  const p = await plan(f, ['claude']), agents = byId(p.agents);
  for (const role of ['bypass', 'hooked', 'served']) {
    assert.deepEqual([agents[role].state, agents[role].action, agents[role].hold.code], ['held', 'hold', 'AGENT_GRANT_REVIEW_REQUIRED'], role);
    assert.equal(agents[role].hold.next, `Read .bowerloom/teams/first-team/agents/${role}.md, then run bowerloom apply --allow-agent ${allowFor(role, text(role))}.`);
  }
  assert.equal(agents.calm.action, 'install');
  assert.match(review(p), /^ {2} +Next: Read \.bowerloom\/teams\/first-team\/agents\/bypass\.md, then run bowerloom apply --allow-agent bypass:[a-f0-9]{12}\.$/m);
  // The right allowance installs that agent only, and it is part of the revision.
  const allow = [allowFor('hooked', text('hooked'))], withAllow = await plan(f, ['claude'], { allow });
  assert.equal(byId(withAllow.agents).hooked.action, 'install'); assert.equal(byId(withAllow.agents).bypass.action, 'hold'); assert.notEqual(withAllow.revision, p.revision); assert.deepEqual(withAllow.allow, allow);
  await assert.rejects(applyProjectApply(f.input(['claude']), withAllow.revision, signal()), code('STALE_APPROVAL'));
  const result = await applyProjectApply(f.input(['claude'], { allow }), withAllow.revision, signal());
  assert.deepEqual(result.applied.map(x => x.id), ['calm', 'hooked']); assert.equal(exists(f, '.claude/agents/bypass.md'), false); assert.equal(read(f, '.claude/agents/hooked.md'), text('hooked'));
  // A wrong hash holds. An edit holds again, even with the old allowance.
  assert.equal(byId((await plan(f, ['claude'], { allow: ['bypass:000000000000'] })).agents).bypass.action, 'hold');
  agentSource(f, 'first-team', 'hooked.md', agentText('hooked', specs.hooked, 'Changed.\n'));
  const edited = byId((await plan(f, ['claude'], { allow })).agents).hooked; assert.deepEqual([edited.state, edited.action, edited.hold.code], ['held', 'hold', 'AGENT_GRANT_REVIEW_REQUIRED']);
  // An edit between the plan and the apply makes the approval stale.
  const fresh = [allowFor('hooked', agentText('hooked', specs.hooked, 'Changed.\n'))], good = await plan(f, ['claude'], { allow: fresh });
  agentSource(f, 'first-team', 'hooked.md', agentText('hooked', specs.hooked, 'Changed again.\n'));
  await assert.rejects(applyProjectApply(f.input(['claude'], { allow: fresh }), good.revision, signal()), code('STALE_APPROVAL'));
  // A malformed allowance is a usage error.
  for (const bad of ['hooked', 'hooked:xyz', 'Hooked:000000000000', 'hooked:00000000000']) await assert.rejects(plan(f, ['claude'], { allow: [bad] }), code('USAGE'));
});

test('S2: an agent that is already installed and unchanged needs no allowance', async t => {
  const f = await agentProject(t), extra = 'hooks:\n  a: 1\ntools: Read', source = agentText('hooked', extra); agentSource(f, 'first-team', 'hooked.md', source);
  await applied(f, ['claude'], { allow: [allowFor('hooked', source)] });
  const p = await plan(f, ['claude']); assert.deepEqual([p.agents[0].state, p.agents[0].action, p.agents[0].hold], ['up-to-date', 'none', null]);
});

test('S4: on an update, a notice the installed copy did not have is marked new', async t => {
  const f = await agentProject(t); agentSource(f, 'first-team', 'scribe.md', agentText('scribe', 'tools: Read'));
  const first = await plan(f, ['claude']); assert.deepEqual(first.agents[0].newNotices, []);
  await applied(f, ['claude']);
  agentSource(f, 'first-team', 'scribe.md', agentText('scribe', 'tools: Read, Bash'));
  let p = await plan(f, ['claude']); assert.deepEqual([p.agents[0].action, p.agents[0].notices, p.agents[0].newNotices], ['update', ['shell-tools'], ['shell-tools']]);
  assert.ok(review(p).includes('Note: agent scribe lists shell tools in tools (new). Claude Code applies them'), review(p));
  await applied(f, ['claude']);
  agentSource(f, 'first-team', 'scribe.md', agentText('scribe', 'tools: Read, Bash, WebFetch'));
  p = await plan(f, ['claude']); assert.deepEqual(p.agents[0].newNotices, ['web-tools']);
  assert.ok(review(p).includes('Note: agent scribe lists shell tools in tools and lists web tools in tools (new).'), review(p));
});

test('S5: a plan with agent notices adds the hooks line and keeps the closing sentence true', async t => {
  const f = await agentProject(t); agentSource(f, 'first-team', 'quiet.md', agentText('quiet', 'tools: Read'));
  assert.doesNotMatch(review(await plan(f, ['claude'])), /Hooks run shell commands/); assert.match(review(await plan(f, ['claude'])), /^This copies text files only\. It starts no workers and runs nothing\.$/m);
  agentSource(f, 'first-team', 'loud.md', agentText('loud', 'tools: Read, Bash'));
  const text = review(await plan(f, ['claude'])).split('\n');
  assert.equal(text.filter(l => l === '  Hooks run shell commands, and Claude Code may use an agent without being asked, based on its description.').length, 1);
  assert.ok(text.includes('This copies text files only. Bowerloom starts no workers and runs nothing itself.')); assert.ok(!text.includes('This copies text files only. It starts no workers and runs nothing.'));
});

test('S6: a user agent of the same name in ~/.claude/agents gets a warning, and nothing is written there', async t => {
  const role = 'zz-userwarn', file = path.join(os.homedir(), '.claude/agents', role + '.md'); fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, 'mine\n'); t.after(() => fs.rmSync(file, { force: true }));
  const f = await agentProject(t); agentSource(f, 'first-team', role + '.md', agentText(role, 'tools: Read')); agentSource(f, 'first-team', 'other.md', agentText('other', 'tools: Read'));
  const p = await plan(f, ['claude']), text = review(p);
  assert.equal(byId(p.agents)[role].userCopy, true); assert.equal(byId(p.agents).other.userCopy, false);
  assert.ok(text.includes(`Warning: ${role} also exists in ~/.claude/agents. This project's agent takes precedence in this project.`), text); assert.equal((text.match(/also exists in ~\/\.claude\/agents/g) ?? []).length, 1);
  await applied(f, ['claude']); assert.doesNotMatch(review(await plan(f, ['claude'])), /also exists in/); assert.equal(fs.readFileSync(file, 'utf8'), 'mine\n');
});
