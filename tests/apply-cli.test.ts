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
  assert.match(shown.stdout, /^Apply skills and prompts for Claude Code and Codex$/m);
  assert.match(shown.stdout, /^ {2}house-style +install +your skill in \.bowerloom\/skills\/house-style$/m);
  assert.match(shown.stdout, /^ {2}weekly-update +install +prompt: \.claude\/commands\/weekly-update\.md and \.agents\/skills\/prompt-weekly-update$/m);
  assert.match(shown.stdout, /^Network: none\. Apply never fetches\./m); assert.match(shown.stdout, POINTER);
  const revision = revisionIn(shown.stdout);
  assert.ok(shown.stdout.endsWith(`Approval required. Run the same command again with --approve ${revision}\n`), shown.stdout);
  assert.equal(tree(p.home), before);
  const json = run(p.dir, ['apply', '--json'], p.deny); assert.equal(json.status, 3);
  const body = JSON.parse(json.stdout); assert.equal(body.revision, revision); assert.equal(body.plan.format, 'bowerloom/project-apply-plan/v1beta1'); assert.match(body.plan.pointer, /AGENTS\.md and CLAUDE\.md/);
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
  assert.match(claude.stdout, /^Apply skills and prompts for Claude Code$/m);
  assert.equal(run(p.dir, ['apply', '--harness', 'claude', '--approve', revisionIn(claude.stdout)], p.deny).status, 0);
  assert.ok(existsSync(join(p.dir, '.claude/commands/weekly-update.md'))); assert.ok(existsSync(join(p.dir, '.claude/skills/house-style/SKILL.md')));
  assert.equal(existsSync(join(p.dir, '.agents')), false);
  const codex = run(p.dir, ['apply', '--harness', 'codex'], p.deny); assert.equal(codex.status, 3);
  assert.match(codex.stdout, /^ {2}weekly-update +add Codex copies$/m);
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
