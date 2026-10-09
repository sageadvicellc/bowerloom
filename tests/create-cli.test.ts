import test from './support/lock-slot-retry.js';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { TestContext } from 'node:test';

const cli = fileURLToPath(new URL('../apps/cli/src/main.js', import.meta.url));
const HEX = /^[a-f0-9]{64}$/;
function folder(t: TestContext) { const root = realpathSync(mkdtempSync(join(tmpdir(), 'bowerloom-create-cli-'))); t.after(() => rmSync(root, { recursive: true, force: true })); return root; }
function run(cwd: string, args: string[], home: string) {
  const r = spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8', timeout: 60000, env: { ...process.env, HOME: home, XDG_STATE_HOME: join(home, 'state') } });
  assert.equal(r.error, undefined); return r;
}
/** A project prepared by the real init plan and apply, with HOME as the outer folder. */
function project(t: TestContext) {
  const home = folder(t), dir = join(home, 'studio'); mkdirSync(dir);
  const args = ['--mode', 'existing', '--target', dir, '--name', 'Studio handbook', '--goal', 'Prepare a fictional onboarding kit for an independent design studio.'];
  const plan = run(home, ['init', 'plan', ...args, '--json'], home); assert.equal(plan.status, 0, plan.stderr);
  const applied = run(home, ['init', 'apply', ...args, '--approve', JSON.parse(plan.stdout).revision], home); assert.equal(applied.status, 0, applied.stderr);
  return { home, dir };
}
/** Every path under the project with its bytes, so any write shows. */
function tree(dir: string): string {
  return JSON.stringify(readdirSync(dir, { recursive: true }).map(String).sort().map(rel => {
    const s = lstatSync(join(dir, rel)); return [rel, s.isFile() ? createHash('sha256').update(readFileSync(join(dir, rel))).digest('hex') : s.isSymbolicLink() ? 'link' : 'dir'];
  }));
}
const errorCode = (stderr: string) => (JSON.parse(stderr) as { error: { code: string } }).error.code;
const revisionIn = (stdout: string): string => { const m = /^Revision: ([a-f0-9]{64})$/m.exec(stdout); assert.ok(m, stdout); return m[1]!; };

const COMMANDS: { args: string[]; review: RegExp; listed: [string, string] }[] = [
  { args: ['team', 'create', 'research-desk', '--profile', 'research'], review: /^Create team research-desk in \.bowerloom\/teams\/research-desk$/m, listed: ['teams', 'research-desk'] },
  { args: ['skill', 'create', 'house-style', '--team', 'first-team'], review: /^Create skill house-style in \.bowerloom\/skills\/house-style$/m, listed: ['skills', 'house-style'] },
  { args: ['prompt', 'create', 'weekly-update'], review: /^Create prompt weekly-update in \.bowerloom\/prompts\/weekly-update\.md$/m, listed: ['prompts', 'weekly-update'] },
];

test('each create command exits 3 without approval and writes nothing; --approve applies; ls shows the item; status stays ready', t => {
  const p = project(t), sub = join(p.dir, 'src'); mkdirSync(sub);
  for (const { args, review, listed } of COMMANDS) {
    const before = tree(p.dir);
    const planned = run(sub, args, p.home);
    assert.equal(planned.status, 3, planned.stderr); assert.equal(planned.stderr, '');
    assert.match(planned.stdout, review); assert.match(planned.stdout, /It starts no workers and runs nothing\./);
    const revision = revisionIn(planned.stdout);
    assert.ok(planned.stdout.endsWith(`Approval required. Run the same command again with --approve ${revision}\n`), planned.stdout);
    assert.equal(tree(p.dir), before, args.join(' '));
    // --json: the full plan, still exit 3, still no write.
    const json = run(sub, [...args, '--json'], p.home); assert.equal(json.status, 3, json.stderr);
    const body = JSON.parse(json.stdout); assert.equal(body.code, 'APPROVAL_REQUIRED'); assert.equal(body.revision, revision); assert.equal(body.plan.format, 'bowerloom/authoring-plan/v1beta1');
    assert.equal(tree(p.dir), before);
    const applied = run(sub, [...args, '--approve', revision], p.home);
    assert.equal(applied.status, 0, applied.stderr); assert.equal(applied.stdout, `Applied plan ${revision}.\n`);
    const ls = JSON.parse(run(p.dir, ['ls', listed[0], '--json'], p.home).stdout); assert.ok(ls[listed[0]].includes(listed[1]), JSON.stringify(ls));
    const again = run(sub, [...args, '--approve', revision], p.home); assert.equal(again.status, 1); assert.match(errorCode(again.stderr), /_EXISTS$/);
  }
  const status = run(p.dir, ['status', '--json'], p.home); assert.equal(status.status, 0, status.stderr);
  const s = JSON.parse(status.stdout);
  assert.equal(s.status, 'ready', JSON.stringify(s.drift)); assert.deepEqual(s.drift, []);
  assert.deepEqual(s.owned.map((o: { path: string; owner: string; state: string }) => [o.path, o.owner, o.state]), [
    ['.bowerloom/authoring', 'authoring', 'verified'], ['.bowerloom/prompts', 'authoring', 'verified'], ['.bowerloom/skills.json', 'manifest', 'verified'],
    ['.bowerloom/skills/house-style', 'authoring', 'verified'], ['.bowerloom/teams/research-desk', 'authoring', 'verified']]);
  const words = run(p.dir, ['status'], p.home); assert.equal(words.status, 0); assert.match(words.stdout, /Setup: ready/);
});

test('status reports ready with skills.json present, and names an edited item', t => {
  const p = project(t);
  const planned = run(p.dir, ['skill', 'create', 'voice'], p.home); assert.equal(planned.status, 3, planned.stderr);
  assert.equal(run(p.dir, ['skill', 'create', 'voice', '--approve', revisionIn(planned.stdout)], p.home).status, 0);
  assert.equal(JSON.parse(run(p.dir, ['status', '--json'], p.home).stdout).status, 'ready');
  writeFileSync(join(p.dir, '.bowerloom', 'skills', 'voice', 'SKILL.md'), '---\nname: voice\ndescription: Our voice.\n---\n\n# Voice\n');
  const j = JSON.parse(run(p.dir, ['status', '--json'], p.home).stdout);
  assert.equal(j.status, 'ready'); assert.deepEqual(j.drift, []);
  assert.ok(j.owned.some((o: { path: string; state: string }) => o.path === '.bowerloom/skills/voice' && o.state === 'edited'), JSON.stringify(j.owned));
  const words = run(p.dir, ['status'], p.home); assert.match(words.stdout, /Setup: ready/); assert.match(words.stdout, /^ {2}edited: \.bowerloom\/skills\/voice$/m);
});

test('revise plan still refuses with REVISION_DRIFT once a project holds created content, and writes nothing', t => {
  const p = project(t);
  const planned = run(p.dir, ['prompt', 'create', 'hello'], p.home); assert.equal(planned.status, 3);
  assert.equal(run(p.dir, ['prompt', 'create', 'hello', '--approve', revisionIn(planned.stdout)], p.home).status, 0);
  const brief = join(p.home, 'brief.json'); writeFileSync(brief, JSON.stringify({ projectName: 'Studio handbook', goal: 'A new goal for the studio kit.' }));
  const before = tree(p.dir), homeBefore = readdirSync(p.home).sort();
  const r = run(p.home, ['revise', 'plan', '--target', p.dir, '--brief', brief], p.home);
  assert.equal(r.status, 1); assert.equal(errorCode(r.stderr), 'REVISION_DRIFT');
  assert.equal(tree(p.dir), before); assert.deepEqual(readdirSync(p.home).sort(), homeBefore);
});

test('refusals exit 1 with a fixed code; malformed command lines exit 2; nothing is written', t => {
  const p = project(t), before = tree(p.dir);
  for (const [args, code] of [
    [['skill', 'create', 'voice', '--team', 'nobody'], 'TEAM_NOT_FOUND'],
    [['prompt', 'create', 'hello', '--team', 'nobody'], 'TEAM_NOT_FOUND'],
    [['team', 'create', 'first-team'], 'TEAM_ID_RESERVED'],
    [['team', 'create', 'Desk'], 'TEAM_NAME_INVALID'],
    [['skill', 'create', 'personal-assistant'], 'SKILL_NAME_RESERVED'],
    [['skill', 'create', 'prompt-x'], 'SKILL_NAME_RESERVED'],
    [['skill', 'create', 'a_b'], 'SKILL_NAME_INVALID'],
    [['prompt', 'create', 'A'], 'PROMPT_NAME_INVALID'],
    [['prompt', 'create', 'hello', '--approve', 'a'.repeat(64)], 'STALE_APPROVAL'],
  ] as [string[], string][]) {
    const r = run(p.dir, args, p.home); assert.equal(r.status, 1, `${args.join(' ')}\n${r.stderr}`); assert.equal(r.stdout, ''); assert.equal(errorCode(r.stderr), code, args.join(' '));
  }
  for (const args of [['team', 'create'], ['team', 'create', 'a', 'b'], ['team', 'create', '--profile', 'engineer'], ['team', 'create', 'a', '--profile', 'pirate'], ['team', 'create', 'a', '--team', 'first-team'],
    ['skill', 'create', 'a', '--profile', 'engineer'], ['skill', 'create', 'a', '--team'], ['skill', 'create', 'a', '--team', 'x', '--team', 'x'], ['prompt', 'create', 'a', '--yes'], ['prompt', 'create', 'a', '-y'],
    ['prompt', 'create', 'a', '--approve', 'abc'], ['team', 'delete', 'a'], ['skill', 'make', 'a'], ['prompt']]) {
    const r = run(p.dir, args, p.home); assert.equal(r.status, 2, `${args.join(' ')}\n${r.stderr}`); assert.equal(errorCode(r.stderr), 'USAGE', args.join(' '));
  }
  const outside = join(p.home, 'elsewhere'); mkdirSync(outside);
  const nowhere = run(outside, ['team', 'create', 'desk'], p.home); assert.equal(nowhere.status, 1); assert.equal(errorCode(nowhere.stderr), 'PROJECT_NOT_FOUND');
  assert.equal(tree(p.dir), before);
});

test('help lists the create commands, and each has help of its own', t => {
  const root = folder(t);
  const short = run(root, ['--help'], root); assert.equal(short.status, 0);
  for (const line of ['bowerloom team create <name>', 'bowerloom skill create <name>', 'bowerloom prompt create <name>']) assert.ok(short.stdout.includes(line), line);
  for (const name of ['team', 'skill', 'prompt']) {
    const a = run(root, ['help', name], root), b = run(root, [name, '--help'], root), c = run(root, [name, 'create', '--help'], root);
    assert.equal(a.status, 0, name); assert.equal(a.stdout, b.stdout); assert.equal(a.stdout, c.stdout); assert.match(a.stdout, new RegExp(`bowerloom ${name} create <name>`));
  }
  assert.ok(HEX.test('a'.repeat(64)));
});
