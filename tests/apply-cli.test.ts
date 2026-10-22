// `bowerloom apply [--harness claude|codex|both]` (build plan 01, M6), run as a person or an agent runs it.
import test from './support/lock-slot-retry.js';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { TestContext } from 'node:test';
import { renderApplyReview } from '../apps/cli/src/apply.js';
import { applyPointer } from '../packages/project-sync/src/index.js';
import type { AgentItem, ApplyPlan } from '../packages/project-sync/src/index.js';

const cli = fileURLToPath(new URL('../apps/cli/src/main.js', import.meta.url));
const preload = pathToFileURL(fileURLToPath(new URL('./support/fake-network.js', import.meta.url))).href;
const fixtures = fileURLToPath(new URL('../../packages/skill-manifest/test/fixtures/', import.meta.url));
const NPM_SPEC = 'npm:@synthetic/db-skills@0.0.1:skills/synthetic-db/collections';
const OUTPUT_DIR = process.env.BOWERLOOM_M6_OUTPUT_DIR;

function folder(t: TestContext) { const root = realpathSync(mkdtempSync(join(tmpdir(), 'bowerloom-apply-cli-'))); t.after(() => rmSync(root, { recursive: true, force: true })); return root; }
function network(root: string, serve: boolean) {
  const log = join(root, `network-${serve ? 'serve' : 'deny'}.log`), file = join(root, `network-${serve ? 'serve' : 'deny'}.json`);
  const routes = serve ? {
    'https://registry.npmjs.org/@synthetic/db-skills/0.0.1': join(fixtures, 'npm-db-skills', 'metadata.json'),
    'https://registry.npmjs.org/@synthetic/db-skills/-/db-skills-0.0.1.tgz': join(fixtures, 'npm-db-skills', 'archive.tgz'),
  } : undefined;
  writeFileSync(file, JSON.stringify({ log, ...(routes ? { routes } : {}) })); writeFileSync(log, '');
  return { env: { TEST_FAKE_NETWORK_PLAN: file }, calls: () => readFileSync(log, 'utf8').split('\n').filter(Boolean) };
}
function run(cwd: string, args: string[], env: Record<string, string>) {
  const r = spawnSync(process.execPath, ['--import', preload, cli, ...args], { cwd, encoding: 'utf8', timeout: 120000, env: { ...process.env, ...env } });
  assert.equal(r.error, undefined); return r;
}
/** A project made by the real init, with the user's own AGENTS.md and CLAUDE.md, a prompt and a skill of its own. */
function project(t: TestContext) {
  const home = folder(t), dir = join(home, 'studio'); mkdirSync(dir);
  writeFileSync(join(dir, 'AGENTS.md'), 'Team rules stay with the team.\n'); writeFileSync(join(dir, 'CLAUDE.md'), '# Memory\nKeep it short.\n');
  const deny = network(home, false), serve = network(home, true), base = { HOME: home, XDG_STATE_HOME: join(home, 'state') };
  const p = { home, dir, deny: { ...base, ...deny.env }, serve: { ...base, ...serve.env }, denied: deny.calls };
  const args = ['--mode', 'existing', '--target', dir, '--name', 'Studio handbook', '--goal', 'Prepare a fictional onboarding kit for an independent design studio.'];
  const plan = run(home, ['init', 'plan', ...args, '--json'], p.deny); assert.equal(plan.status, 0, plan.stderr);
  assert.equal(run(home, ['init', 'apply', ...args, '--approve', JSON.parse(plan.stdout).revision], p.deny).status, 0);
  approve(p, ['prompt', 'create', 'weekly-update'], p.deny); approve(p, ['skill', 'create', 'house-style'], p.deny);
  return p;
}
function approve(p: { dir: string }, args: string[], env: Record<string, string>) {
  const planned = run(p.dir, [...args, '--json'], env); assert.equal(planned.status, 3, planned.stderr);
  const applied = run(p.dir, [...args, '--approve', JSON.parse(planned.stdout).revision], env); assert.equal(applied.status, 0, applied.stderr); return applied;
}
function tree(dir: string): string {
  return JSON.stringify(readdirSync(dir, { recursive: true }).map(String).sort().map(rel => { const s = lstatSync(join(dir, rel)); return [rel, s.isFile() ? createHash('sha256').update(readFileSync(join(dir, rel))).digest('hex') : 'dir']; }));
}
const errorOf = (stderr: string) => (JSON.parse(stderr) as { error: { code: string; message: string } }).error;
const revisionIn = (stdout: string): string => { const m = /^Revision: ([a-f0-9]{64})$/m.exec(stdout); assert.ok(m, stdout); return m[1]!; };
const POINTER = /^Bowerloom never edits AGENTS\.md or CLAUDE\.md\./m;

test('apply: exit 3 shows the plan and the AGENTS.md pointer and writes nothing; --approve puts skills and prompts in place; AGENTS.md and CLAUDE.md stay as they were', t => {
  const p = project(t), own = { agents: readFileSync(join(p.dir, 'AGENTS.md')), claude: readFileSync(join(p.dir, 'CLAUDE.md')) };
  const before = tree(p.home), shown = run(p.dir, ['apply'], p.deny);
  assert.equal(shown.status, 3, shown.stderr); assert.equal(shown.stderr, ''); if (OUTPUT_DIR) writeFileSync(join(OUTPUT_DIR, 'apply-exit3.txt'), shown.stdout);
  assert.match(shown.stdout, /^Apply skills, prompts, and agents for Claude Code and Codex$/m);
  assert.match(shown.stdout, /^ {2}house-style +install +your skill in \.bowerloom\/skills\/house-style {2}\[project\]$/m);
  assert.match(shown.stdout, /^ {2}weekly-update +install +prompt: \.claude\/commands\/weekly-update\.md and \.agents\/skills\/prompt-weekly-update {2}\[project\]$/m);
  assert.match(shown.stdout, /^Network: none\. Apply never fetches\./m); assert.match(shown.stdout, POINTER);
  const revision = revisionIn(shown.stdout);
  assert.ok(shown.stdout.endsWith(`Approval required. Run the same command again with --approve ${revision}\n`), shown.stdout);
  assert.equal(tree(p.home), before);
  const json = run(p.dir, ['apply', '--json'], p.deny); assert.equal(json.status, 3);
  const body = JSON.parse(json.stdout); assert.equal(body.revision, revision); assert.equal(body.plan.format, 'bowerloom/project-apply-plan/v1beta2'); assert.match(body.plan.pointer, /AGENTS\.md and CLAUDE\.md/);
  const applied = run(p.dir, ['apply', '--approve', revision], p.deny);
  assert.equal(applied.status, 0, applied.stderr); if (OUTPUT_DIR) writeFileSync(join(OUTPUT_DIR, 'apply-exit0.txt'), applied.stdout);
  assert.match(applied.stdout, new RegExp(`^Applied plan ${revision}\\.$`, 'm'));
  assert.match(applied.stdout, /^ {2}house-style: installed$/m); assert.match(applied.stdout, /^ {2}prompt weekly-update: installed$/m); assert.match(applied.stdout, POINTER);
  assert.equal(readFileSync(join(p.dir, '.claude/commands/weekly-update.md'), 'utf8'), readFileSync(join(p.dir, '.bowerloom/prompts/weekly-update.md'), 'utf8'));
  assert.ok(existsSync(join(p.dir, '.agents/skills/prompt-weekly-update/SKILL.md')));
  assert.deepEqual(readFileSync(join(p.dir, 'AGENTS.md')), own.agents); assert.deepEqual(readFileSync(join(p.dir, 'CLAUDE.md')), own.claude);
  const again = run(p.dir, ['apply'], p.deny); assert.equal(again.status, 0, again.stderr); assert.match(again.stdout, /Nothing to change\.\n/); assert.match(again.stdout, POINTER);
  const status = JSON.parse(run(p.dir, ['status', '--json'], p.deny).stdout); assert.equal(status.status, 'ready', JSON.stringify(status.drift));
  assert.deepEqual(p.denied(), []);
});

test('apply --harness claude adds Claude Code copies only; --harness codex later adds Codex and removes nothing', t => {
  const p = project(t);
  const claude = run(p.dir, ['apply', '--harness', 'claude'], p.deny); assert.equal(claude.status, 3);
  assert.match(claude.stdout, /^Apply skills, prompts, and agents for Claude Code$/m);
  assert.equal(run(p.dir, ['apply', '--harness', 'claude', '--approve', revisionIn(claude.stdout)], p.deny).status, 0);
  assert.ok(existsSync(join(p.dir, '.claude/commands/weekly-update.md'))); assert.ok(existsSync(join(p.dir, '.claude/skills/house-style/SKILL.md')));
  assert.equal(existsSync(join(p.dir, '.agents')), false);
  const codex = run(p.dir, ['apply', '--harness', 'codex'], p.deny); assert.equal(codex.status, 3);
  assert.match(codex.stdout, /^ {2}weekly-update +add Codex copies {2}\[project\]$/m);
  assert.equal(run(p.dir, ['apply', '--harness', 'codex', '--approve', revisionIn(codex.stdout)], p.deny).status, 0);
  assert.ok(existsSync(join(p.dir, '.agents/skills/prompt-weekly-update/SKILL.md'))); assert.ok(existsSync(join(p.dir, '.claude/commands/weekly-update.md')));
  const both = run(p.dir, ['apply', '--harness', 'both'], p.deny); assert.equal(both.status, 0); assert.match(both.stdout, /Nothing to change\./);
});

test('apply refusals: a collision, an uncached pin, and usage errors; nothing is written', t => {
  const p = project(t);
  mkdirSync(join(p.dir, '.claude/commands'), { recursive: true }); writeFileSync(join(p.dir, '.claude/commands/weekly-update.md'), 'My own command.\n');
  let before = tree(p.home);
  const collision = run(p.dir, ['apply'], p.deny); assert.equal(collision.status, 1);
  assert.equal(errorOf(collision.stderr).code, 'APPLY_NAME_COLLISION'); assert.match(errorOf(collision.stderr).message, /\.claude\/commands\/weekly-update\.md/);
  assert.equal(tree(p.home), before);
  rmSync(join(p.dir, '.claude'), { recursive: true });
  approve(p, ['skills', 'add', NPM_SPEC], p.serve);
  // skills add kept its checked bytes in the machine cache. Without them the pin is not cached.
  rmSync(join(p.home, 'state', 'bowerloom'), { recursive: true, force: true });
  before = tree(p.home);
  const offline = run(p.dir, ['apply'], p.deny); assert.equal(offline.status, 1);
  assert.equal(errorOf(offline.stderr).code, 'SKILLS_OFFLINE'); assert.match(errorOf(offline.stderr).message, /bowerloom skills sync/);
  assert.equal(tree(p.home), before); assert.deepEqual(p.denied(), []);
  for (const args of [['--harness'], ['--harness', 'cursor'], ['--harness', 'claude', '--harness', 'codex'], ['--yes'], ['--approve', 'abc'], ['--offline'], ['extra']]) {
    const r = run(p.dir, ['apply', ...args], p.deny); assert.equal(r.status, 2, args.join(' ')); assert.equal(errorOf(r.stderr).code, 'USAGE');
  }
  for (const args of [['help', 'apply'], ['apply', '--help']]) { const r = run(p.dir, args, p.deny); assert.equal(r.status, 0); assert.match(r.stdout, /bowerloom apply \[--harness claude\|codex\|both\]/); }
});

// Spec 01a, section 10.8: the exact words of the apply review for agents.
const agentItem = (id: string, extra: Partial<AgentItem>): AgentItem => ({
  id, team: 'first-team', itemId: `agent_${id}`, state: 'new', action: 'install', harnesses: ['claude'],
  expected: { files: [], surfaces: [{ id: 'agent-claude', path: `.claude/agents/${id}.md` }, { id: 'catalog', path: `.bowerloom/managed/catalog/agent_${id}.json` }], source: { kind: 'agent', path: `teams/first-team/agents/${id}.md` } },
  before: [], previousReceiptRevision: null, history: 0, hold: null, notices: [], newNotices: [], installed: null, sourceSha256: null, builtin: false, userCopy: false, capabilities: null, enforcement: [], ...extra,
});
const planOf = (agents: AgentItem[], harnesses: ('claude' | 'codex')[], extra: Partial<ApplyPlan> = {}): ApplyPlan => ({
  format: 'bowerloom/project-apply-plan/v1beta2', harnesses, team: null, skills: null, prompts: [], agents, codexAgentsSkipped: false, actionable: true,
  pointer: applyPointer(harnesses), ...extra,
} as unknown as ApplyPlan);

test('apply review: the agent lines, warning, notice and Codex line are exact', () => {
  const agents = [
    agentItem('broken', { state: 'held', action: 'hold', expected: { files: [], surfaces: [], source: null }, hold: { code: 'AGENT_INVALID', next: 'Fix .bowerloom/teams/first-team/agents/broken.md: the key description is required, from 1 to 2048 characters. Then run bowerloom apply.' } }),
    agentItem('editor', { state: 'up-to-date', action: 'none' }),
    agentItem('plan', { state: 'edited', action: 'update', builtin: true }),
    agentItem('scribe', { notices: ['hooks', 'shell-tools'] }),
    agentItem('writer', { state: 'adopt' }),
    agentItem('archive', { team: null, state: 'orphaned', action: 'none', expected: { files: [], surfaces: [], source: null } }),
  ];
  const text = renderApplyReview(planOf(agents, ['claude', 'codex'], { codexAgentsSkipped: true })).split('\n');
  const head = text.slice(0, text.findIndex(l => l.startsWith('Network:')));
  assert.deepEqual(head, [
    'Apply skills, prompts, and agents for Claude Code and Codex',
    '  broken   agent held (AGENT_INVALID)',
    '           Next: Fix .bowerloom/teams/first-team/agents/broken.md: the key description is required, from 1 to 2048 characters. Then run bowerloom apply.',
    '  editor   agent up to date',
    '  plan     update agent: .claude/agents/plan.md',
    '           Warning: plan is also the name of a built-in Claude Code agent. Check which one Claude Code uses.',
    '  scribe   install agent: .claude/agents/scribe.md',
    '  Note: agent scribe sets hooks and lists shell tools in tools. Claude Code applies them when the agent runs. Review .bowerloom/teams/first-team/agents/scribe.md.',
    '  writer   adopt agent: .claude/agents/writer.md',
    '  archive  agent kept: no longer an agent of this project, and apply removes nothing',
    '  Hooks run shell commands, and Claude Code may use an agent without being asked, based on its description.',
    'Codex agents are not projected in this beta. See the capability model design.',
  ]);
});

test('apply review: title, empty plan and pointer for each harness list', () => {
  const claude = renderApplyReview(planOf([], ['claude'], { team: 'desk', actionable: false })).split('\n');
  assert.equal(claude[0], 'Apply skills, prompts, and agents for Claude Code, team desk');
  assert.equal(claude[1], '  Nothing in .bowerloom/skills.json, .bowerloom/prompts, or .bowerloom/teams/*/agents to apply yet.');
  const codex = renderApplyReview(planOf([], ['codex'], { actionable: false })).split('\n');
  assert.equal(codex[0], 'Apply skills and prompts for Codex'); assert.equal(codex[1], '  Nothing in .bowerloom/skills.json or .bowerloom/prompts to apply yet.');
  assert.ok(!codex.some(l => l.startsWith('Codex agents')));
  const both = renderApplyReview(planOf([], ['claude', 'codex'], { actionable: false })).split('\n');
  assert.equal(both[0], 'Apply skills, prompts, and agents for Claude Code and Codex');
  assert.equal(applyPointer(['claude']), 'Bowerloom never edits AGENTS.md or CLAUDE.md. To point Claude Code at these copies, add a line like this to CLAUDE.md yourself:\n  Project skills are in .claude/skills. Prompts are Claude Code commands in .claude/commands. Agents are in .claude/agents.');
  assert.equal(applyPointer(['claude', 'codex']), 'Bowerloom never edits AGENTS.md or CLAUDE.md. To point your agents at these copies, add a line like this to AGENTS.md and CLAUDE.md yourself:\n  Project skills are in .claude/skills and .agents/skills. Prompts are Claude Code commands in .claude/commands, and Codex skills named prompt-<name>. Agents are in .claude/agents.');
  assert.equal(applyPointer(['codex']), 'Bowerloom never edits AGENTS.md or CLAUDE.md. To point Codex at these copies, add a line like this to AGENTS.md yourself:\n  Project skills are in .agents/skills. Prompts are Codex skills named prompt-<name>.');
});

test('apply with an agent: the CLI plan lists it, the result words say installed, and the Codex line is printed', t => {
  const p = project(t), dir = join(p.dir, '.bowerloom/teams/first-team/agents'); mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'scribe.md'), '---\nname: scribe\ndescription: Writes things down.\n---\nTake notes.\n', { mode: 0o644 });
  const shown = run(p.dir, ['apply'], p.deny); assert.equal(shown.status, 3, shown.stderr);
  assert.match(shown.stdout, /^ {2}scribe +install agent: \.claude\/agents\/scribe\.md$/m); assert.match(shown.stdout, /^Codex agents are not projected in this beta\. See the capability model design\.$/m);
  const applied = run(p.dir, ['apply', '--approve', revisionIn(shown.stdout)], p.deny); assert.equal(applied.status, 0, applied.stderr);
  assert.match(applied.stdout, /^ {2}agent scribe: installed$/m); assert.match(applied.stdout, /^ {2}house-style: installed$/m);
  assert.equal(readFileSync(join(p.dir, '.claude/agents/scribe.md'), 'utf8'), readFileSync(join(dir, 'scribe.md'), 'utf8'));
  assert.deepEqual(p.denied(), []);
});
