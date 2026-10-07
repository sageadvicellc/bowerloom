import test from './support/lock-slot-retry.js';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
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

function folder(t: TestContext) { const root = realpathSync(mkdtempSync(join(tmpdir(), 'bowerloom-skills-add-'))); t.after(() => rmSync(root, { recursive: true, force: true })); return root; }
/** The recorded npm and GitHub responses, one file per URL, as fake-network routes. */
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
interface Net { log: string; calls(): { name: string; target: string }[] }
function network(root: string, serve: boolean): { env: Record<string, string>; net: Net } {
  const log = join(root, `network-${serve ? 'serve' : 'deny'}.log`), planFile = join(root, `network-${serve ? 'serve' : 'deny'}.json`);
  writeFileSync(planFile, JSON.stringify({ log, ...(serve ? { routes: routes(root) } : {}) })); writeFileSync(log, '');
  return { env: { TEST_FAKE_NETWORK_PLAN: planFile }, net: { log, calls: () => readFileSync(log, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line)) } };
}
function run(cwd: string, args: string[], env: Record<string, string>) {
  const r = spawnSync(process.execPath, ['--import', preload, cli, ...args], { cwd, encoding: 'utf8', timeout: 60000, env: { ...process.env, ...env } });
  assert.equal(r.error, undefined); return r;
}
/** A project prepared by the real init plan and apply, with HOME as the outer folder. */
function project(t: TestContext) {
  const home = folder(t), dir = join(home, 'studio'); mkdirSync(dir);
  const deny = network(home, false), env = { HOME: home, ...deny.env };
  const args = ['--mode', 'existing', '--target', dir, '--name', 'Studio handbook', '--goal', 'Prepare a fictional onboarding kit for an independent design studio.'];
  const plan = run(home, ['init', 'plan', ...args, '--json'], env); assert.equal(plan.status, 0, plan.stderr);
  const applied = run(home, ['init', 'apply', ...args, '--approve', JSON.parse(plan.stdout).revision], env); assert.equal(applied.status, 0, applied.stderr);
  const serve = network(home, true);
  return { home, dir, manifest: join(dir, '.bowerloom', 'skills.json'), deny: { HOME: home, ...deny.env }, serve: { HOME: home, ...serve.env }, denied: deny.net, served: serve.net };
}
const tree = (dir: string) => JSON.stringify(readdirSync(dir, { recursive: true }).map(String).sort());
const errorCode = (stderr: string) => (JSON.parse(stderr) as { error: { code: string } }).error.code;

test('range, tag, latest, short-SHA and branch pins, and a missing path, refuse before any network call or project read', t => {
  const p = project(t), before = tree(p.dir);
  const cases: [string, string][] = [
    ['npm:@synthetic/db-skills@^0.0.1:skills/synthetic-db/collections', 'MANIFEST_PIN_NOT_EXACT'],
    ['npm:@synthetic/db-skills@~0.0.1:skills/synthetic-db/collections', 'MANIFEST_PIN_NOT_EXACT'],
    ['npm:@synthetic/db-skills@latest:skills/synthetic-db/collections', 'MANIFEST_PIN_NOT_EXACT'],
    ['npm:@synthetic/db-skills@v0.0.1:skills/synthetic-db/collections', 'MANIFEST_PIN_NOT_EXACT'],
    ['npm:@synthetic/db-skills@0.0:skills/synthetic-db/collections', 'MANIFEST_PIN_NOT_EXACT'],
    ['github:synthetic-owner/skills-repo@main:skills/verification-loop', 'MANIFEST_PIN_NOT_EXACT'],
    ['github:synthetic-owner/skills-repo@v1.0.0:skills/verification-loop', 'MANIFEST_PIN_NOT_EXACT'],
    ['github:synthetic-owner/skills-repo@c0ffee0:skills/verification-loop', 'MANIFEST_PIN_NOT_EXACT'],
    ['npm:@synthetic/db-skills@0.0.1', 'SKILLS_ADD_SPEC_INVALID'],
    ['npm:@synthetic/db-skills@0.0.1:', 'SKILLS_ADD_SPEC_INVALID'],
    [`github:synthetic-owner/skills-repo@${COMMIT}`, 'SKILLS_ADD_SPEC_INVALID'],
    [`github:synthetic-owner/skills-repo@${COMMIT}:../outside`, 'SKILLS_ADD_SPEC_INVALID'],
    ['pypi:requests@2.0.0:skills/x', 'SKILLS_ADD_SPEC_INVALID'],
  ];
  for (const [spec, code] of cases) {
    for (const cwd of [p.dir, p.home]) {
      const r = run(cwd, ['skills', 'add', spec], p.deny); assert.equal(r.status, 1, `${spec}\n${r.stderr}`); assert.equal(r.stdout, '');
      assert.equal(errorCode(r.stderr), code, spec);
    }
  }
  assert.deepEqual(p.denied.calls(), []); assert.equal(tree(p.dir), before); assert.equal(existsSync(p.manifest), false);
});

test('without a terminal, skills add plans, prints the review and revision, exits 3 and writes nothing; --approve applies', t => {
  const p = project(t), before = tree(p.dir);
  const planned = run(p.dir, ['skills', 'add', NPM_SPEC], p.serve);
  assert.equal(planned.status, 3, planned.stderr); assert.equal(planned.stderr, '');
  const revision = /Revision: ([a-f0-9]{64})\n/.exec(planned.stdout)?.[1]; assert.ok(revision, planned.stdout);
  assert.equal(planned.stdout, [
    'Add skill synthetic-db-collections to .bowerloom/skills.json',
    '  Source: npm @synthetic/db-skills 0.0.1, folder skills/synthetic-db/collections',
    '  Skill name: synthetic-db-collections',
    '  License: MIT (LICENSE)',
    '  Files: 4',
    '  Teams: every team',
    '  skills.json: a new file',
    'This records the pin only. Nothing is installed or run.',
    `Revision: ${revision}`,
    `Approval required. Run the same command again with --approve ${revision}`, '',
  ].join('\n'));
  assert.equal(tree(p.dir), before);
  assert.deepEqual(p.served.calls().map(c => c.target), ['registry.npmjs.org', 'https://registry.npmjs.org/@synthetic/db-skills/0.0.1', 'https://registry.npmjs.org/@synthetic/db-skills/-/db-skills-0.0.1.tgz']);
  const json = run(p.dir, ['skills', 'add', NPM_SPEC, '--json'], p.serve); assert.equal(json.status, 3);
  const body = JSON.parse(json.stdout); assert.equal(body.code, 'APPROVAL_REQUIRED'); assert.equal(body.revision, revision); assert.equal(body.plan.before, null);
  const stale = run(p.dir, ['skills', 'add', NPM_SPEC, '--approve', 'ab'.repeat(32)], p.serve); assert.equal(stale.status, 1); assert.equal(errorCode(stale.stderr), 'STALE_APPROVAL');
  assert.equal(existsSync(p.manifest), false);
  const applied = run(p.dir, ['skills', 'add', NPM_SPEC, '--approve', revision], p.serve);
  assert.equal(applied.status, 0, applied.stderr); assert.equal(applied.stdout, `Applied plan ${revision}.\n`);
  const manifest = JSON.parse(readFileSync(p.manifest, 'utf8'));
  assert.deepEqual(manifest.skills.map((s: { id: string }) => s.id), ['synthetic-db-collections']); assert.deepEqual(manifest.harnesses, ['claude', 'codex']);
  assert.equal(readFileSync(p.manifest, 'utf8'), JSON.stringify(manifest, null, 2) + '\n');
  const again = run(p.dir, ['skills', 'add', NPM_SPEC], p.serve); assert.equal(again.status, 1); assert.equal(errorCode(again.stderr), 'SKILLS_ADD_EXISTS');
  assert.equal(p.served.calls().filter(c => c.name !== 'https.request' && c.name !== 'dns.promises.lookup').length, 0);
});

test('a GitHub skill with --id and --team is added next to the npm one, and skills check passes', t => {
  const p = project(t);
  const plan = (args: string[]) => { const r = run(p.dir, ['skills', 'add', ...args, '--json'], p.serve); assert.equal(r.status, 3, r.stderr); return JSON.parse(r.stdout).revision as string; };
  const npm = plan([NPM_SPEC]); assert.equal(run(p.dir, ['skills', 'add', NPM_SPEC, '--approve', npm], p.serve).status, 0);
  const args = [GIT_SPEC, '--id', 'verify', '--team', 'first-team'];
  const words = run(p.dir, ['skills', 'add', ...args], p.serve); assert.equal(words.status, 3, words.stderr);
  assert.match(words.stdout, /^Add skill verify to \.bowerloom\/skills\.json\n  Source: GitHub synthetic-owner\/skills-repo at c0ffee00c0ffee00c0ffee00c0ffee00c0ffee00, folder skills\/verification-loop\n  Skill name: verification-loop\n  License: MIT \(LICENSE\)\n  Files: 3\n  Teams: first-team\n  skills\.json: replaces the file with sha256 [a-f0-9]{64}\n/);
  const git = plan(args);
  const applied = run(p.dir, ['skills', 'add', ...args, '--approve', git], p.serve); assert.equal(applied.status, 0, applied.stderr);
  const manifest = JSON.parse(readFileSync(p.manifest, 'utf8'));
  assert.deepEqual(manifest.skills.map((s: { id: string; teams?: string[] }) => [s.id, s.teams ?? null]), [['synthetic-db-collections', null], ['verify', ['first-team']]]);
  const check = run(p.dir, ['skills', 'check'], p.deny); assert.equal(check.status, 0, check.stderr);
  assert.match(check.stdout, /^skills\.json is valid: 2 skills, for claude and codex\.\n/);
  const json = run(p.dir, ['skills', 'check', '--json'], p.deny); assert.equal(json.status, 0);
  assert.equal(JSON.parse(json.stdout).valid, true); assert.deepEqual(p.denied.calls(), []);
});

test('--team must name a team in this project, and --id must be a valid id; both refuse before any network call', t => {
  const p = project(t);
  const missing = run(p.dir, ['skills', 'add', NPM_SPEC, '--team', 'writers'], p.deny); assert.equal(missing.status, 1); assert.equal(errorCode(missing.stderr), 'TEAM_NOT_FOUND');
  for (const args of [['--id', 'Bad Id'], ['--id', 'personal-assistant'], ['--id', 'prompt-x'], ['--team', 'Bad Team'], ['--id'], ['--id', 'a', '--id', 'b'], ['--bogus'], ['extra'], ['--team']]) {
    const r = run(p.dir, ['skills', 'add', NPM_SPEC, ...args], p.deny); assert.equal(r.status, 2, args.join(' ') + r.stderr); assert.equal(errorCode(r.stderr), 'USAGE');
  }
  for (const args of [['skills', 'add'], ['skills', 'add', NPM_SPEC, '--yes'], ['skills', 'add', NPM_SPEC, '--approve', 'xyz'], ['skills', 'check', 'extra'], ['skills', 'check', '--approve', 'ab'.repeat(32)]]) {
    const r = run(p.dir, args, p.deny); assert.equal(r.status, 2, args.join(' ')); assert.equal(errorCode(r.stderr), 'USAGE');
  }
  assert.deepEqual(p.denied.calls(), []);
});

test('outside a project, skills add and skills check refuse with PROJECT_NOT_FOUND and no network call', t => {
  const home = folder(t), empty = join(home, 'empty'); mkdirSync(empty); const deny = network(home, false);
  for (const args of [['skills', 'add', NPM_SPEC], ['skills', 'check']]) {
    const r = run(empty, args, { HOME: home, ...deny.env }); assert.equal(r.status, 1); assert.equal(errorCode(r.stderr), 'PROJECT_NOT_FOUND');
  }
  assert.deepEqual(deny.net.calls(), []);
});

test('skills check exits 0 for a valid file and 1 with a code for a bad, absent or unsafe one', t => {
  const p = project(t);
  const absent = run(p.dir, ['skills', 'check'], p.deny); assert.equal(absent.status, 1); assert.equal(errorCode(absent.stderr), 'MANIFEST_NOT_FOUND');
  writeFileSync(p.manifest, JSON.stringify({ format: 'bowerloom/skills/v1beta1', harnesses: ['claude', 'codex'], skills: [{ id: 'house-style', source: { kind: 'local', path: 'skills/house-style' } }] }, null, 2) + '\n');
  const ok = run(p.dir, ['skills', 'check'], p.deny); assert.equal(ok.status, 0, ok.stderr); assert.equal(ok.stdout, 'skills.json is valid: 1 skill, for claude and codex.\n  house-style  local skills/house-style\n');
  for (const [text, code] of [['{"format":"bowerloom/skills/v1beta1","format":"x"}', 'MANIFEST_INVALID'], ['{"format":"bowerloom/skills/v1beta1","harnesses":["claude"],"skills":[{"id":"a","source":{"kind":"local","path":"skills/b"}}]}', 'MANIFEST_INVALID'], ['not json', 'MANIFEST_INVALID']] as const) {
    writeFileSync(p.manifest, text); const r = run(p.dir, ['skills', 'check'], p.deny); assert.equal(r.status, 1, text); assert.equal(errorCode(r.stderr), code);
  }
  chmodSync(p.manifest, 0o666); const unsafe = run(p.dir, ['skills', 'check'], p.deny); assert.equal(unsafe.status, 1); assert.equal(errorCode(unsafe.stderr), 'MANIFEST_UNSAFE');
  assert.deepEqual(p.denied.calls(), []);
});

test('a refused fetch writes nothing and names its code; a host other than the two public ones is never asked', t => {
  const p = project(t), before = tree(p.dir);
  for (const [spec, code] of [['npm:@synthetic/db-skills@0.0.1:skills/synthetic-db/live-queries', 'SKILLS_ADD_UNSAFE_CONTENT'], ['npm:@synthetic/db-skills@0.0.1:skills/synthetic-db/none', 'SKILLS_ADD_NOT_FOUND'], ['npm:@synthetic/db-skills@9.9.9:skills/x', 'SKILLS_ADD_NOT_FOUND']] as const) {
    const r = run(p.dir, ['skills', 'add', spec], p.serve); assert.equal(r.status, 1, spec); assert.equal(errorCode(r.stderr), code, spec);
  }
  const net = run(p.dir, ['skills', 'add', NPM_SPEC], p.deny); assert.equal(net.status, 1); assert.equal(errorCode(net.stderr), 'SKILLS_ADD_NETWORK');
  assert.equal(tree(p.dir), before);
  const hosts = new Set(p.served.calls().filter(c => c.name === 'https.request').map(c => new URL(c.target).hostname));
  assert.deepEqual([...hosts], ['registry.npmjs.org']);
});

test('help skills, skills --help, skills add --help and skills check --help print the skills topic and write nothing', t => {
  const home = folder(t), deny = network(home, false), env = { HOME: home, ...deny.env }, before = tree(home);
  const topic = run(home, ['help', 'skills'], env); assert.equal(topic.status, 0, topic.stderr);
  assert.match(topic.stdout, /bowerloom skills add npm:<package>@<version>:<path>/); assert.match(topic.stdout, /bowerloom skills check/);
  for (const args of [['skills', '--help'], ['skills', 'add', '--help'], ['skills', 'check', '--help']]) { const r = run(home, args, env); assert.equal(r.status, 0, args.join(' ')); assert.equal(r.stdout, topic.stdout, args.join(' ')); }
  assert.equal(tree(home), before); assert.deepEqual(deny.net.calls(), []);
});
