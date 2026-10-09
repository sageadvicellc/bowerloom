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
const COMMIT = 'c0ffee00c0ffee00c0ffee00c0ffee00c0ffee00';
const NPM_SPEC = 'npm:@synthetic/db-skills@0.0.1:skills/synthetic-db/collections';
const GIT_SPEC = `github:synthetic-owner/skills-repo@${COMMIT}:skills/verification-loop`;
const EXIT3_OUTPUT_FILE = process.env.BOWERLOOM_M5_EXIT3_OUT;

function folder(t: TestContext) { const root = realpathSync(mkdtempSync(join(tmpdir(), 'bowerloom-skills-sync-'))); t.after(() => rmSync(root, { recursive: true, force: true })); return root; }
function routes(root: string): Record<string, string> {
  const out: Record<string, string> = {
    'https://registry.npmjs.org/@synthetic/db-skills/0.0.1': join(fixtures, 'npm-db-skills', 'metadata.json'),
    'https://registry.npmjs.org/@synthetic/db-skills/-/db-skills-0.0.1.tgz': join(fixtures, 'npm-db-skills', 'archive.tgz'),
  };
  const recorded = JSON.parse(readFileSync(join(fixtures, 'github-skills-repo.json'), 'utf8')) as { responses: Record<string, string> };
  const dir = join(root, 'responses'); mkdirSync(dir);
  Object.entries(recorded.responses).forEach(([url, body], i) => { const file = join(dir, `${i}.json`); writeFileSync(file, Buffer.from(body, 'base64')); out[url] = file; });
  return out;
}
function network(root: string, serve: boolean) {
  const log = join(root, `network-${serve ? 'serve' : 'deny'}.log`), planFile = join(root, `network-${serve ? 'serve' : 'deny'}.json`);
  writeFileSync(planFile, JSON.stringify({ log, ...(serve ? { routes: routes(root) } : {}) })); writeFileSync(log, '');
  return { env: { TEST_FAKE_NETWORK_PLAN: planFile }, calls: () => readFileSync(log, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line) as { name: string; target: string }) };
}
function run(cwd: string, args: string[], env: Record<string, string>) {
  const r = spawnSync(process.execPath, ['--import', preload, cli, ...args], { cwd, encoding: 'utf8', timeout: 120000, env: { ...process.env, ...env } });
  assert.equal(r.error, undefined); return r;
}
/** A project made by the real init, with HOME as the outer folder and private state under HOME/state. */
function project(t: TestContext) {
  const home = folder(t), dir = join(home, 'studio'); mkdirSync(dir);
  const deny = network(home, false), serve = network(home, true), base = { HOME: home, XDG_STATE_HOME: join(home, 'state') };
  const args = ['--mode', 'existing', '--target', dir, '--name', 'Studio handbook', '--goal', 'Prepare a fictional onboarding kit for an independent design studio.'];
  const plan = run(home, ['init', 'plan', ...args, '--json'], { ...base, ...deny.env }); assert.equal(plan.status, 0, plan.stderr);
  assert.equal(run(home, ['init', 'apply', ...args, '--approve', JSON.parse(plan.stdout).revision], { ...base, ...deny.env }).status, 0);
  return { home, dir, state: join(home, 'state'), deny: { ...base, ...deny.env }, serve: { ...base, ...serve.env }, denied: deny.calls, served: serve.calls };
}
/** Plans with --json, then applies with --approve. */
function approve(p: ReturnType<typeof project>, args: string[], env: Record<string, string>) {
  const planned = run(p.dir, [...args, '--json'], env); assert.equal(planned.status, 3, planned.stderr);
  const applied = run(p.dir, [...args, '--approve', JSON.parse(planned.stdout).revision], env); assert.equal(applied.status, 0, applied.stderr); return applied;
}
function tree(dir: string): string {
  return JSON.stringify(readdirSync(dir, { recursive: true }).map(String).sort().map(rel => { const s = lstatSync(join(dir, rel)); return [rel, s.isFile() ? createHash('sha256').update(readFileSync(join(dir, rel))).digest('hex') : 'dir']; }));
}
const errorOf = (stderr: string) => (JSON.parse(stderr) as { error: { code: string; message: string } }).error;
const revisionIn = (stdout: string): string => { const m = /^Revision: ([a-f0-9]{64})$/m.exec(stdout); assert.ok(m, stdout); return m[1]!; };

test('skills sync: exit 3 shows the plan and writes nothing; --approve installs npm, GitHub and local skills; then nothing to change, offline', t => {
  const p = project(t);
  approve(p, ['skills', 'add', NPM_SPEC], p.serve); approve(p, ['skills', 'add', GIT_SPEC], p.serve); approve(p, ['skill', 'create', 'house-style'], p.deny);
  const before = tree(p.dir), served = p.served().length;
  const shown = run(p.dir, ['skills', 'sync'], p.serve);
  assert.equal(shown.status, 3, shown.stderr); assert.equal(shown.stderr, '');
  if (EXIT3_OUTPUT_FILE) writeFileSync(EXIT3_OUTPUT_FILE, shown.stdout);
  assert.match(shown.stdout, /^Sync skills from \.bowerloom\/skills\.json for Claude Code and Codex$/m);
  assert.match(shown.stdout, /^ {2}synthetic-db-collections +install npm @synthetic\/db-skills@0\.0\.1:skills\/synthetic-db\/collections, fetched from registry\.npmjs\.org$/m);
  assert.match(shown.stdout, /^ {2}house-style +install +your skill in \.bowerloom\/skills\/house-style$/m);
  assert.match(shown.stdout, /^Network: reads api\.github\.com and registry\.npmjs\.org for 2 skills, public and without credentials\./m);
  const revision = revisionIn(shown.stdout);
  assert.ok(shown.stdout.endsWith(`Approval required. Run the same command again with --approve ${revision}\n`));
  const json = run(p.dir, ['skills', 'sync', '--json'], p.serve); assert.equal(json.status, 3);
  const body = JSON.parse(json.stdout); assert.equal(body.code, 'APPROVAL_REQUIRED'); assert.equal(body.revision, revision); assert.equal(body.plan.format, 'bowerloom/skills-sync-plan/v1beta1');
  assert.equal(tree(p.dir), before); assert.equal(p.served().length, served, 'planning reads no network');
  const applied = run(p.dir, ['skills', 'sync', '--approve', revision], p.serve);
  assert.equal(applied.status, 0, applied.stderr); assert.match(applied.stdout, new RegExp(`^Applied plan ${revision}\\.$`, 'm'));
  assert.match(applied.stdout, /^ {2}house-style: installed$/m);
  assert.ok(p.served().slice(served).every(c => /^https:\/\/(?:registry\.npmjs\.org|api\.github\.com)\//.test(c.target) || ['registry.npmjs.org', 'api.github.com'].includes(c.target)), JSON.stringify(p.served()));
  for (const root of ['.claude/skills', '.agents/skills']) assert.ok(existsSync(join(p.dir, root, 'house-style', 'SKILL.md')), root);
  assert.equal(readdirSync(join(p.dir, '.bowerloom/managed/catalog')).length, 3);
  const again = run(p.dir, ['skills', 'sync', '--offline'], p.deny);
  assert.equal(again.status, 0, again.stderr); assert.match(again.stdout, /Nothing to change\.\n$/); assert.deepEqual(p.denied(), []);
  const status = JSON.parse(run(p.dir, ['status', '--json'], p.deny).stdout); assert.equal(status.status, 'ready', JSON.stringify(status.drift)); assert.deepEqual(status.drift, []);
});

test('skills sync --offline refuses before any write when a pin is not cached', t => {
  const p = project(t); approve(p, ['skills', 'add', NPM_SPEC], p.serve);
  const before = tree(p.home), r = run(p.dir, ['skills', 'sync', '--offline'], p.deny);
  assert.equal(r.status, 1); assert.equal(errorOf(r.stderr).code, 'SKILLS_OFFLINE'); assert.match(errorOf(r.stderr).message, /collections/);
  assert.equal(tree(p.home), before); assert.equal(existsSync(join(p.state, 'bowerloom')), false); assert.deepEqual(p.denied(), []);
});

test('skills sync usage and refusals: --yes, a malformed --approve, a bad team, an unknown team, legacy content', t => {
  const p = project(t); approve(p, ['skill', 'create', 'house-style'], p.deny);
  for (const args of [['--yes'], ['--approve', 'abc'], ['--team', 'Bad_Id'], ['--team'], ['extra']]) assert.equal(run(p.dir, ['skills', 'sync', ...args], p.deny).status, 2, args.join(' '));
  const team = run(p.dir, ['skills', 'sync', '--team', 'ghost-team'], p.deny); assert.equal(team.status, 1); assert.equal(errorOf(team.stderr).code, 'TEAM_NOT_FOUND');
  mkdirSync(join(p.dir, '.bowerloom-skills'), { mode: 0o700 });
  const legacy = run(p.dir, ['skills', 'sync'], p.deny); assert.equal(legacy.status, 1);
  assert.equal(errorOf(legacy.stderr).code, 'MANAGED_SKILL_LEGACY_PRESENT'); assert.match(errorOf(legacy.stderr).message, /bowerloom skills migrate plan --state/);
  const help = run(p.dir, ['skills', 'sync', '--help'], p.deny); assert.equal(help.status, 0); assert.match(help.stdout, /bowerloom skills sync \[--offline\]/);
});
