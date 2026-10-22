// Spec 01a, section 10.8: team agents in `bowerloom status`, `up`, `apply` and `help`, run as a person or an agent runs them.
import test from './support/lock-slot-retry.js';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { TestContext } from 'node:test';

const cli = fileURLToPath(new URL('../apps/cli/src/main.js', import.meta.url));
const preload = pathToFileURL(fileURLToPath(new URL('./support/fake-network.js', import.meta.url))).href;
const GOAL = 'Prepare a fictional onboarding kit for an independent design studio.';

function fresh(t: TestContext) {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'bowerloom-status-agents-'))); t.after(() => rmSync(home, { recursive: true, force: true }));
  const dir = join(home, 'studio'); mkdirSync(dir);
  writeFileSync(join(dir, 'AGENTS.md'), 'Team rules stay with the team.\n'); writeFileSync(join(dir, 'CLAUDE.md'), '# Memory\nKeep it short.\n');
  const log = join(home, 'network.log'), plan = join(home, 'network.json'); writeFileSync(log, ''); writeFileSync(plan, JSON.stringify({ log }));
  return { home, dir, env: { HOME: home, XDG_STATE_HOME: join(home, 'state'), TEST_FAKE_NETWORK_PLAN: plan }, network: () => readFileSync(log, 'utf8').split('\n').filter(Boolean) };
}
type Fresh = ReturnType<typeof fresh>;
function run(p: Fresh, args: string[]) {
  const r = spawnSync(process.execPath, ['--import', preload, cli, ...args], { cwd: p.dir, encoding: 'utf8', timeout: 120000, env: { ...process.env, ...p.env } });
  assert.equal(r.error, undefined); return r;
}
const revisionIn = (stdout: string): string => { const m = /^Revision: ([a-f0-9]{64})$/m.exec(stdout); assert.ok(m, stdout); return m[1]!; };
const errorOf = (stderr: string) => (JSON.parse(stderr) as { error: { code: string; message: string } }).error;
function create(p: Fresh, args: string[]) {
  const planned = run(p, [...args, '--json']); assert.equal(planned.status, 3, planned.stderr);
  assert.equal(run(p, [...args, '--approve', JSON.parse(planned.stdout).revision]).status, 0);
}
/** A project made by `up`, then a created team `desk`. */
function project(t: TestContext) {
  const p = fresh(t), up = run(p, ['up', '--team', 'Studio crew', '--goal', GOAL]); assert.equal(up.status, 3, up.stderr);
  assert.equal(run(p, ['up', '--team', 'Studio crew', '--goal', GOAL, '--approve', revisionIn(up.stdout)]).status, 4);
  create(p, ['team', 'create', 'desk']); return p;
}
const agent = (role: string, extra = '') => `---\nname: ${role}\ndescription: ${role} helps the team.\n${extra ? extra + '\n' : ''}---\nDo the work.\n`;
function place(p: Fresh, team: string, entry: string, text: string): string {
  const dir = join(p.dir, '.bowerloom/teams', team, 'agents'); mkdirSync(dir, { recursive: true, mode: 0o755 });
  const file = join(dir, entry); writeFileSync(file, text, { mode: 0o644 }); chmodSync(file, 0o644); return file;
}
function hand(p: Fresh, name: string, text: string): string {
  const dir = join(p.dir, '.claude/agents'); mkdirSync(dir, { recursive: true, mode: 0o755 }); const file = join(dir, name); writeFileSync(file, text, { mode: 0o644 }); chmodSync(file, 0o644); return file;
}

test('status reports no edited line and no drift for a team that holds agents', t => {
  const p = project(t); place(p, 'desk', 'scribe.md', agent('scribe')); place(p, 'first-team', 'helper.md', agent('helper'));
  const words = run(p, ['status']); assert.equal(words.status, 0, words.stderr);
  assert.doesNotMatch(words.stdout, /^ {2}edited:/m); assert.doesNotMatch(words.stdout, /unexpected|owner-refused|unsafe/);
  const json = JSON.parse(run(p, ['status', '--json']).stdout); assert.deepEqual(json.drift, []);
  assert.ok(!json.owned.some((o: { state: string }) => o.state === 'edited'), JSON.stringify(json.owned));
  assert.ok(json.owned.some((o: { path: string; state: string }) => o.path === '.bowerloom/teams/first-team/agents' && o.state === 'verified'), JSON.stringify(json.owned));
  assert.ok(json.owned.some((o: { path: string; state: string }) => o.path === '.bowerloom/teams/desk' && o.state === 'verified'), JSON.stringify(json.owned));
  assert.deepEqual(p.network(), []);
});

test('status names a bad agent file as owner-refused on the team folder, with AGENT_INVALID', t => {
  const p = project(t); place(p, 'desk', 'typo.md', agent('typo', 'tool: Read'));
  const words = run(p, ['status']); assert.equal(words.status, 0, words.stderr);
  assert.match(words.stdout, /^ {2}owner-refused: \.bowerloom\/teams\/desk \(AGENT_INVALID\)$/m);
  place(p, 'first-team', 'bad.md', 'not an agent');
  assert.match(run(p, ['status']).stdout, /^ {2}owner-refused: \.bowerloom\/teams\/first-team\/agents \(AGENT_INVALID\)$/m);
});

test('status and up print a held agent with its code and next step, which proves both planHolds callers pass agents', t => {
  const p = project(t); place(p, 'desk', 'scribe.md', agent('scribe')); hand(p, 'scribe.md', 'My own agent.\n');
  const next = '.claude/agents/scribe.md was not installed by Bowerloom and differs from .bowerloom/teams/desk/agents/scribe.md. Move it aside, then run bowerloom apply.';
  const status = run(p, ['status']); assert.equal(status.status, 0, status.stderr);
  assert.match(status.stdout, new RegExp(`^ {2}agent scribe: held \\(AGENT_TARGET_OCCUPIED\\)\\. Next: ${next.replace(/[.]/g, '\\.')}$`, 'm'));
  const up = run(p, ['up', '--team', 'desk']); assert.equal(up.status, 4, up.stderr + up.stdout);
  assert.match(up.stdout, /^prepared, 1 item held$/m); assert.match(up.stdout, /^ {2}Held: agent scribe \(AGENT_TARGET_OCCUPIED\)$/m); assert.ok(up.stdout.includes(`    Next: ${next}`), up.stdout);
  assert.equal(readFileSync(join(p.dir, '.claude/agents/scribe.md'), 'utf8'), 'My own agent.\n');
});

test('up --team stops at the apply step when agents are the only work, and ends with the agents text', t => {
  const p = project(t); place(p, 'desk', 'scribe.md', agent('scribe'));
  const shown = run(p, ['up', '--team', 'desk']); assert.equal(shown.status, 3, shown.stderr);
  assert.match(shown.stdout, /^Next step: apply\. Put the skills, prompts, and agents of team desk in place for Claude Code and Codex\.$/m);
  assert.match(shown.stdout, /^Apply skills, prompts, and agents for Claude Code and Codex, team desk$/m); assert.match(shown.stdout, /^ {2}scribe +install agent: \.claude\/agents\/scribe\.md$/m);
  assert.match(shown.stdout, /^Codex agents are not projected in this beta\. See the capability model design\.$/m);
  assert.equal(existsSync(join(p.dir, '.claude/agents')), false);
  const done = run(p, ['up', '--team', 'desk', '--approve', revisionIn(shown.stdout)]); assert.equal(done.status, 4, done.stderr + done.stdout);
  assert.match(done.stdout, /^ {2}Team: desk, with skills, prompts, and agents in place for Claude Code and Codex\.$/m);
  assert.equal(readFileSync(join(p.dir, '.claude/agents/scribe.md'), 'utf8'), agent('scribe')); assert.deepEqual(p.network(), []);
});

test('apply exit codes: 3 for approval required, 0 for done and for nothing to change; the result words name the agent', t => {
  const p = project(t);
  const none = run(p, ['apply']); assert.equal(none.status, 0, none.stderr); assert.match(none.stdout, /Nothing to change\.\n/); assert.match(none.stdout, /^ {2}Nothing in \.bowerloom\/skills\.json, \.bowerloom\/prompts, or \.bowerloom\/teams\/\*\/agents to apply yet\.$/m);
  place(p, 'desk', 'scribe.md', agent('scribe', 'tools: Read, Bash(npm run *)')); place(p, 'first-team', 'plan.md', agent('plan'));
  const shown = run(p, ['apply']); assert.equal(shown.status, 3, shown.stderr);
  assert.ok(shown.stdout.endsWith(`Approval required. Run the same command again with --approve ${revisionIn(shown.stdout)}\n`), shown.stdout);
  assert.match(shown.stdout, /^ {2}Note: agent scribe lists shell tools in tools\. Claude Code applies them when the agent runs\. Review \.bowerloom\/teams\/desk\/agents\/scribe\.md\.$/m);
  assert.match(shown.stdout, /^ +Warning: plan is also the name of a built-in Claude Code agent\. Check which one Claude Code uses\.$/m);
  assert.match(shown.stdout, /^Copies go to \.bowerloom\/managed, \.claude and \.agents, and stay on this machine\./m);
  const json = JSON.parse(run(p, ['apply', '--json']).stdout); assert.equal(json.plan.format, 'bowerloom/project-apply-plan/v1beta2'); assert.equal(json.plan.agents.length, 2); assert.equal(json.plan.codexAgentsSkipped, true);
  const done = run(p, ['apply', '--approve', revisionIn(shown.stdout)]); assert.equal(done.status, 0, done.stderr);
  assert.match(done.stdout, /^ {2}agent plan: installed$/m); assert.match(done.stdout, /^ {2}agent scribe: installed$/m);
  assert.match(done.stdout, /Project skills are in \.claude\/skills and \.agents\/skills\. Prompts are Claude Code commands in \.claude\/commands, and Codex skills named prompt-<name>\. Agents are in \.claude\/agents\./);
  const again = run(p, ['apply']); assert.equal(again.status, 0); assert.match(again.stdout, /agent up to date/); assert.match(again.stdout, /Nothing to change\./);
  place(p, 'desk', 'scribe.md', agent('scribe', 'tools: Read'));
  const update = run(p, ['apply']); assert.equal(update.status, 3); assert.match(update.stdout, /update agent: \.claude\/agents\/scribe\.md/);
  assert.equal(run(p, ['apply', '--approve', revisionIn(update.stdout)]).stdout.includes('  agent scribe: updated'), true);
  rmSync(join(p.dir, '.bowerloom/teams/desk/agents/scribe.md'));
  const kept = run(p, ['apply']); assert.equal(kept.status, 0); assert.match(kept.stdout, /agent kept: no longer an agent of this project, and apply removes nothing/);
  assert.deepEqual(p.network(), []);
});

test('apply --harness codex prints the Codex line and no agent line; usage errors still exit 2', t => {
  const p = project(t); place(p, 'desk', 'scribe.md', agent('scribe'));
  const codex = run(p, ['apply', '--harness', 'codex']); assert.equal(codex.status, 0, codex.stderr);
  assert.match(codex.stdout, /^Apply skills and prompts for Codex$/m); assert.match(codex.stdout, /^Codex agents are not projected in this beta\. See the capability model design\.$/m);
  assert.doesNotMatch(codex.stdout, /scribe/); assert.match(codex.stdout, /Nothing to change\./);
  assert.equal(existsSync(join(p.dir, '.claude/agents')), false); assert.equal(existsSync(join(p.dir, '.codex')), false);
  const bad = run(p, ['apply', '--harness', 'cursor']); assert.equal(bad.status, 2); assert.equal(errorOf(bad.stderr).code, 'USAGE');
});

test('a refusal prints its code, sentence and next step; AGENT_LIMIT stops the whole apply', t => {
  const p = project(t);
  for (let i = 0; i < 129; i++) { const role = `agent-${String(i).padStart(3, '0')}`; place(p, 'desk', role + '.md', agent(role)); }
  const r = run(p, ['apply']); assert.equal(r.status, 1, r.stdout); assert.equal(errorOf(r.stderr).code, 'AGENT_LIMIT');
  assert.match(errorOf(r.stderr).message, /more than 128 agents/);
});

test('help apply and help up carry the agent sentences', t => {
  const p = fresh(t), apply = run(p, ['help', 'apply']); assert.equal(apply.status, 0);
  for (const line of [
    'and the Codex skill .agents/skills/prompt-<name>. An agent becomes .claude/agents/<role>.md. Codex agents are not projected in this beta. These copies stay on this machine.',
    'Agents come from .bowerloom/teams/<team>/agents/<role>.md. A file at the target that Bowerloom did not install is adopted when it equals the copy.',
    'If it differs, apply holds that agent. Move the file aside, then run bowerloom apply. A bad agent file holds only that agent.',
  ]) assert.ok(apply.stdout.includes(line + '\n'), line);
  const up = run(p, ['help', 'up']); assert.equal(up.status, 0);
  assert.ok(up.stdout.includes('  apply   when skills, prompts, or agents of the team need copies for Claude Code and Codex: apply.\n'));
  assert.ok(up.stdout.includes('exits 4. When a skill, prompt,\n') && up.stdout.includes('agent, or team is held or gone, it prints "prepared, N items held" instead, with the next command for each item.\n'));
});
