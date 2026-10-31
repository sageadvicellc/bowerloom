// Spec 04, store writes, through the real binary: `--global` on the create commands, `skills add`, `skills check`, and `ls`.
// Every run gets its own HOME and XDG_STATE_HOME under a temporary folder. Nothing here touches the real home folder.
import './support/isolate-home.js';
import test from './support/lock-slot-retry.js';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, lstatSync, renameSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { TestContext } from 'node:test';
import { withProjectLock } from '../packages/project-context/src/index.js';
import { addLocalEntry } from '../packages/skill-manifest/src/add.js';
import { STORE_MANIFEST_LIMITS, serializeManifest } from '../packages/skill-manifest/src/schema.js';
import { seedWords } from '../apps/cli/src/manifest.js';

const cli = fileURLToPath(new URL('../apps/cli/src/main.js', import.meta.url));
const preload = pathToFileURL(fileURLToPath(new URL('./support/fake-network.js', import.meta.url))).href;
const fixtures = fileURLToPath(new URL('../../packages/skill-manifest/test/fixtures/', import.meta.url));
const NPM_SPEC = 'npm:@synthetic/db-skills@0.0.1:skills/synthetic-db/collections';

function world(t: TestContext) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'bowerloom-store-write-')));
  t.after(() => { try { chmodSync(join(base, 'home'), 0o700); } catch { /* gone */ } rmSync(base, { recursive: true, force: true }); });
  const home = join(base, 'home'); mkdirSync(home, { mode: 0o700 });
  const work = join(base, 'work'); mkdirSync(work, { mode: 0o700 });
  return { base, home, work, store: join(home, '.bowerloom'), state: join(base, 'state'), env: { HOME: home, XDG_STATE_HOME: join(base, 'state') } as Record<string, string> };
}
type W = ReturnType<typeof world>;
function run(cwd: string, args: string[], env: Record<string, string>, node: string[] = []) {
  const r = spawnSync(process.execPath, [...node, cli, ...args], { cwd, encoding: 'utf8', timeout: 60000, env: { ...process.env, ...env } });
  assert.equal(r.error, undefined); return r;
}
function runAsync(cwd: string, args: string[], env: Record<string, string>): Promise<{ status: number | null; stdout: string; stderr: string }> {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [cli, ...args], { cwd, env: { ...process.env, ...env } });
    let stdout = '', stderr = '';
    child.stdout.on('data', d => { stdout += d; }); child.stderr.on('data', d => { stderr += d; });
    child.on('close', status => resolve({ status, stdout, stderr }));
  });
}
const errorCode = (stderr: string): string => (JSON.parse(stderr) as { error: { code: string } }).error.code;
/** Plans a command (exit 3), then applies it with the revision. Returns both runs. */
function approve(w: W, args: string[], cwd = w.work, node: string[] = [], env: Record<string, string> = w.env) {
  const planned = run(cwd, [...args, '--json'], env, node); assert.equal(planned.status, 3, planned.stderr);
  const body = JSON.parse(planned.stdout) as { revision: string; plan: Record<string, unknown> };
  return { body, applied: run(cwd, [...args, '--approve', body.revision], env, node) };
}
const mustApprove = (w: W, args: string[], cwd = w.work) => { const r = approve(w, args, cwd); assert.equal(r.applied.status, 0, r.applied.stderr); return r; };
const tree = (dir: string): string => JSON.stringify(readdirSync(dir, { recursive: true }).map(String).sort());

function network(root: string) {
  const log = join(root, 'network.log'), planFile = join(root, 'network.json');
  const out: Record<string, string> = {
    'https://registry.npmjs.org/@synthetic/db-skills/0.0.1': join(fixtures, 'npm-db-skills', 'metadata.json'),
    'https://registry.npmjs.org/@synthetic/db-skills/-/db-skills-0.0.1.tgz': join(fixtures, 'npm-db-skills', 'archive.tgz'),
  };
  writeFileSync(planFile, JSON.stringify({ log, routes: out })); writeFileSync(log, '');
  return { TEST_FAKE_NETWORK_PLAN: planFile };
}
function project(w: W) {
  const dir = join(w.home, 'studio'); mkdirSync(dir);
  const args = ['--mode', 'existing', '--target', dir, '--name', 'Studio handbook', '--goal', 'Prepare a fictional onboarding kit for an independent design studio.'];
  const plan = run(w.home, ['init', 'plan', ...args, '--json'], w.env); assert.equal(plan.status, 0, plan.stderr);
  const applied = run(w.home, ['init', 'apply', ...args, '--approve', JSON.parse(plan.stdout).revision], w.env); assert.equal(applied.status, 0, applied.stderr);
  return dir;
}

test('1. skill create --global in a folder that is not a project prints the plan, Create the store line first, and exits 3', t => {
  const w = world(t), r = run(w.work, ['skill', 'create', 'x', '--global'], w.env);
  assert.equal(r.status, 3, r.stderr);
  const lines = r.stdout.split('\n');
  assert.equal(lines[0], 'Create the store at ~/.bowerloom (store.json, and a .gitignore that leaves out the files of this machine). It holds definitions only.');
  assert.equal(lines[1], 'Create skill x in the store at ~/.bowerloom/skills/x');
  assert.deepEqual(lines.slice(2, 8), ['  Teams: every team', '  Files: 1', '  skills.json: adds a local entry for x', 'You and your agents own these files and can edit them.', 'This writes the store only. It changes no project, and it installs nothing.', `Revision: ${/Revision: ([a-f0-9]{64})/.exec(r.stdout)![1]}`]);
  assert.equal(existsSync(w.store), false, 'a plan writes nothing');
});

test('2. the same command with --approve makes store.json, skills.json, skills/x/SKILL.md and the receipt, and exits 0', t => {
  const w = world(t), { applied } = mustApprove(w, ['skill', 'create', 'x', '--global']);
  assert.match(applied.stdout, /^Applied plan [a-f0-9]{64}\.\n$/);
  assert.equal(readFileSync(join(w.store, 'store.json'), 'utf8'), '{"format":"bowerloom/store/v1beta1"}\n');
  assert.match(readFileSync(join(w.store, 'skills', 'x', 'SKILL.md'), 'utf8'), /^---\nname: x\n/);
  assert.deepEqual(JSON.parse(readFileSync(join(w.store, 'skills.json'), 'utf8')).skills, [{ id: 'x', source: { kind: 'local', path: 'skills/x' } }]);
  assert.deepEqual(JSON.parse(readFileSync(join(w.store, 'authoring', 'receipt.json'), 'utf8')).items.map((i: { id: string }) => i.id), ['x']);
  assert.equal(existsSync(join(w.store, '.bowerloom')), false);
  assert.equal(existsSync(join(w.home, '.local')), false, 'no cache or state is made by a create');
});

test('3. a second run refuses SKILL_EXISTS', t => {
  const w = world(t); mustApprove(w, ['skill', 'create', 'x', '--global']);
  const r = run(w.work, ['skill', 'create', 'x', '--global'], w.env);
  assert.equal(r.status, 1); assert.equal(errorCode(r.stderr), 'SKILL_EXISTS');
});

test('4. prompt create and team create work once the store exists, and their plans have no Create the store line', t => {
  const w = world(t); mustApprove(w, ['skill', 'create', 'x', '--global']);
  const prompt = run(w.work, ['prompt', 'create', 'p', '--global'], w.env);
  assert.equal(prompt.status, 3); assert.doesNotMatch(prompt.stdout, /Create the store/);
  assert.match(prompt.stdout, /^Create prompt p in the store at ~\/\.bowerloom\/prompts\/p\.md\n  Teams: every team\n  Files: 1\n/);
  mustApprove(w, ['prompt', 'create', 'p', '--global']);
  assert.ok(existsSync(join(w.store, 'prompts', 'p.md')));
  const team = run(w.work, ['team', 'create', 't', '--global', '--profile', 'founder'], w.env);
  assert.equal(team.status, 3); assert.doesNotMatch(team.stdout, /Create the store/);
  assert.match(team.stdout, /^Create team t in the store at ~\/\.bowerloom\/teams\/t\n  Profile: founder\n  Built from a fixed store brief, with the lead, maker and reviewer templates\.\n  Files: 10\n/);
  mustApprove(w, ['team', 'create', 't', '--global', '--profile', 'founder']);
  assert.ok(existsSync(join(w.store, 'teams', 't', 'team.yaml')));
  assert.match(readFileSync(join(w.store, 'teams', 't', 'assets', 'brief.json'), 'utf8'), /"projectName": "Store team"/);
});

test('5. team create --global --team a exits 2', t => {
  const w = world(t), r = run(w.work, ['team', 'create', 't', '--global', '--team', 'a'], w.env);
  assert.equal(r.status, 2); assert.equal(errorCode(r.stderr), 'USAGE');
  assert.equal(JSON.parse(r.stderr).error.message, 'Use bowerloom team create <name> [--profile engineer|founder|research], with optional --global, --approve <revision> and --json.');
});

test('6. skill create --global --team nope refuses TEAM_NOT_FOUND; first-team is no store team', t => {
  const w = world(t);
  const r = run(w.work, ['skill', 'create', 'x', '--global', '--team', 'nope'], w.env);
  assert.equal(r.status, 1); assert.equal(errorCode(r.stderr), 'TEAM_NOT_FOUND');
  mustApprove(w, ['team', 'create', 'research', '--global']);
  assert.equal(run(w.work, ['skill', 'create', 'x', '--global', '--team', 'research'], w.env).status, 3);
  assert.equal(errorCode(run(w.work, ['skill', 'create', 'x', '--global', '--team', 'first-team'], w.env).stderr), 'TEAM_NOT_FOUND');
  assert.equal(errorCode(run(w.work, ['team', 'create', 'first-team', '--global'], w.env).stderr), 'TEAM_ID_RESERVED');
});

test('7. skills add --global writes the store skills.json and the cache under XDG_STATE_HOME, and nothing cache-like inside the store', t => {
  const w = world(t), env = { ...w.env, ...network(w.base) };
  const planned = run(w.work, ['skills', 'add', NPM_SPEC, '--global'], env, ['--import', preload]);
  assert.equal(planned.status, 3, planned.stderr);
  assert.match(planned.stdout, /^Create the store at ~\/\.bowerloom \(store\.json, and a \.gitignore that leaves out the files of this machine\)\. It holds definitions only\.\nAdd skill [a-z0-9-]+ to ~\/\.bowerloom\/skills\.json\n/);
  assert.match(planned.stdout, /\n {2}Scope: store\. A project picks this skill with bowerloom use\.\n/);
  const r = approve(w, ['skills', 'add', NPM_SPEC, '--global'], w.work, ['--import', preload], env);
  assert.equal(r.applied.status, 0, r.applied.stderr);
  assert.match(r.applied.stdout, new RegExp(`Cache: kept the checked bytes in ${w.state.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/bowerloom/cache\\.`));
  const manifest = JSON.parse(readFileSync(join(w.store, 'skills.json'), 'utf8'));
  assert.equal(manifest.skills.length, 1); assert.equal(manifest.skills[0].source.kind, 'npm');
  assert.ok(existsSync(join(w.state, 'bowerloom', 'cache')));
  assert.equal(readdirSync(join(w.state, 'bowerloom', 'cache')).length > 0, true);
  assert.deepEqual(readdirSync(w.store).sort(), ['.gitignore', 'skills.json', 'store.json']);
});

test('8. skills add --global with XDG_STATE_HOME inside the store refuses STORE_STATE_NESTED at plan time', t => {
  const w = world(t), env = { ...w.env, ...network(w.base), XDG_STATE_HOME: join(w.store, 'state') };
  const r = run(w.work, ['skills', 'add', NPM_SPEC, '--global'], env, ['--import', preload]);
  assert.equal(r.status, 1); assert.equal(errorCode(r.stderr), 'STORE_STATE_NESTED');
  assert.equal(existsSync(w.store), false);
});

test('9. skills check --global prints skills.json (store) is valid; with no store it refuses MANIFEST_NOT_FOUND', t => {
  const w = world(t);
  const none = run(w.work, ['skills', 'check', '--global'], w.env);
  assert.equal(none.status, 1); assert.equal(errorCode(none.stderr), 'MANIFEST_NOT_FOUND');
  mustApprove(w, ['skill', 'create', 'x', '--global']);
  const r = run(w.work, ['skills', 'check', '--global'], w.env);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, 'skills.json (store) is valid: 1 skill, for Claude Code and Codex.\n  x  local skills/x\n');
  const j = JSON.parse(run(w.work, ['skills', 'check', '--global', '--json'], w.env).stdout);
  assert.equal(j.format, 'bowerloom/skills-manifest-check/v1beta3'); assert.equal(j.scope, 'store'); assert.equal(j.skills[0].source, 'store');
  assert.equal(errorCode(run(w.work, ['skills', 'check', '--global', '--global'], w.env).stderr), 'USAGE');
});

test('10. ls --global lists the store items with the source store; --json has scope store and storeState ready', t => {
  const w = world(t); mustApprove(w, ['skill', 'create', 'x', '--global']); mustApprove(w, ['team', 'create', 'research', '--global']); mustApprove(w, ['prompt', 'create', 'weekly', '--global']);
  const r = run(w.work, ['ls', '--global'], w.env); assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, 'Teams\n  research  store\n\nSkills\n  x  store\n\nPrompts\n  weekly  store\n');
  const j = JSON.parse(run(w.work, ['ls', '--global', '--json'], w.env).stdout);
  assert.deepEqual(j, {
    format: 'bowerloom/ls/v1beta2', scope: 'store', listedBy: 'folders',
    teams: [{ id: 'research', source: 'store', via: [], locked: null, resolvedFrom: 'store', displayName: null, state: 'ok' }],
    skills: [{ id: 'x', source: 'store', via: [], locked: null, resolvedFrom: 'store', kind: 'local', pin: null, state: 'ok' }],
    prompts: [{ id: 'weekly', source: 'store', via: [], locked: null, resolvedFrom: 'store', state: 'ok' }],
    pinsReadable: true, pinsError: null, unselected: { skills: [], prompts: [], teams: [] }, unlisted: 0, storeState: 'ready',
  });
});

test('11. ls --global with no store prints No store yet and exits 0; a foreign store refuses STORE_INVALID', t => {
  const w = world(t), r = run(w.work, ['ls', '--global'], w.env);
  assert.equal(r.status, 0, r.stderr); assert.equal(r.stdout, 'No store yet. Create one with bowerloom skill create <name> --global.\n');
  const j = JSON.parse(run(w.work, ['ls', '--global', '--json'], w.env).stdout);
  assert.equal(j.storeState, 'absent'); assert.deepEqual([j.teams, j.skills, j.prompts], [[], [], []]); assert.equal(j.scope, 'store');
  mkdirSync(w.store, { mode: 0o700 }); writeFileSync(join(w.store, 'mine.txt'), 'x');
  const foreign = run(w.work, ['ls', '--global'], w.env);
  assert.equal(foreign.status, 1); assert.equal(errorCode(foreign.stderr), 'STORE_INVALID');
  assert.equal(errorCode(run(w.work, ['skill', 'create', 'x', '--global'], w.env).stderr), 'STORE_INVALID');
  assert.equal(errorCode(run(w.work, ['skills', 'check', '--global'], w.env).stderr), 'STORE_INVALID');
});

test('12. ls in a project lists items with the source project, and never mixes in store items', t => {
  const w = world(t); mustApprove(w, ['skill', 'create', 'storeskill', '--global']);
  const dir = project(w);
  assert.equal(run(dir, ['ls'], w.env).stdout, 'Teams\n  first-team (First team)  project\n\nSkills\n  personal-assistant  project\n\nPrompts\n  none yet\n\nSlices\n  none yet\n');
  const j = JSON.parse(run(dir, ['ls', '--json'], w.env).stdout);
  assert.equal(j.format, 'bowerloom/ls/v1beta2'); assert.equal(j.scope, 'project'); assert.equal(j.listedBy, 'folders'); assert.equal(j.storeState, undefined);
  assert.deepEqual(j.teams, [{ id: 'first-team', source: 'project', via: [], locked: null, resolvedFrom: 'project', displayName: 'First team', state: 'ok' }]);
  assert.deepEqual(j.skills.map((s: { id: string }) => s.id), ['personal-assistant']);
  assert.equal(j.pinsReadable, true);
});

test('13. ls teams --global --json has only the teams array plus the fixed fields', t => {
  const w = world(t); mustApprove(w, ['team', 'create', 'research', '--global']);
  const j = JSON.parse(run(w.work, ['ls', 'teams', '--global', '--json'], w.env).stdout);
  assert.deepEqual(Object.keys(j).sort(), ['format', 'listedBy', 'scope', 'storeState', 'teams', 'unlisted', 'unselected']);
  const s = JSON.parse(run(w.work, ['ls', 'skills', '--global', '--json'], w.env).stdout);
  assert.deepEqual(Object.keys(s).sort(), ['format', 'listedBy', 'pinsError', 'pinsReadable', 'scope', 'skills', 'storeState', 'unlisted', 'unselected']);
  assert.equal(run(w.work, ['ls', 'prompts', '--global'], w.env).stdout, 'Prompts\n  none yet\n');
});

test('14. a --global write leaves the project .bowerloom untouched', t => {
  const w = world(t), dir = project(w), before = tree(join(dir, '.bowerloom')), files = readFileSync(join(dir, '.bowerloom', 'brief.json'), 'utf8');
  mustApprove(w, ['skill', 'create', 'x', '--global'], dir); mustApprove(w, ['team', 'create', 't', '--global'], dir); mustApprove(w, ['prompt', 'create', 'p', '--global'], dir);
  assert.equal(tree(join(dir, '.bowerloom')), before); assert.equal(readFileSync(join(dir, '.bowerloom', 'brief.json'), 'utf8'), files);
  assert.ok(existsSync(join(w.store, 'teams', 't')));
  // A project with the same skill id is not read, and a project create leaves the store as it is.
  const storeBefore = tree(w.store);
  mustApprove(w, ['skill', 'create', 'x'], dir);
  assert.equal(tree(w.store), storeBefore);
});

test('15. an empty ~/.bowerloom is a leftover: skill create --global --approve succeeds', t => {
  const w = world(t); mkdirSync(w.store, { mode: 0o700 });
  const planned = run(w.work, ['skill', 'create', 'x', '--global', '--json'], w.env);
  assert.equal(planned.status, 3, planned.stderr);
  const body = JSON.parse(planned.stdout); assert.equal(body.plan.storeCreate, true);
  const applied = run(w.work, ['skill', 'create', 'x', '--global', '--approve', body.revision], w.env);
  assert.equal(applied.status, 0, applied.stderr);
  assert.ok(existsSync(join(w.store, 'store.json')));
});

test('16. --global twice exits 2 with Use --global once.', t => {
  const w = world(t);
  for (const args of [['skill', 'create', 'x', '--global', '--global'], ['prompt', 'create', 'x', '--global', '--global'], ['team', 'create', 'x', '--global', '--global'], ['skills', 'add', NPM_SPEC, '--global', '--global'], ['skills', 'check', '--global', '--global'], ['ls', '--global', '--global']]) {
    const r = run(w.work, args, w.env);
    assert.equal(r.status, 2, args.join(' ')); assert.equal(JSON.parse(r.stderr).error.message, 'Use --global once.', args.join(' '));
  }
});

test('17. a project skill create still works and writes a v1beta2 plan', t => {
  const w = world(t), dir = project(w);
  const r = approve(w, ['skill', 'create', 'house-style'], dir);
  assert.equal(r.body.plan.format, 'bowerloom/authoring-plan/v1beta2'); assert.equal(r.body.plan.scope, 'project'); assert.equal(r.body.plan.storeCreate, false);
  assert.equal(r.applied.status, 0, r.applied.stderr);
  assert.ok(existsSync(join(dir, '.bowerloom', 'skills', 'house-style', 'SKILL.md')));
  assert.equal(existsSync(w.store), false, 'a project create never makes the store');
});

test('18. the usage words are exact', t => {
  const w = world(t);
  const say = (args: string[]) => JSON.parse(run(w.work, args, w.env).stderr).error.message;
  assert.equal(say(['skill', 'create', '--global']), 'Use bowerloom skill create <name> [--team <team>]..., with optional --global, --approve <revision> and --json.');
  assert.equal(say(['prompt', 'create', '--global']), 'Use bowerloom prompt create <name> [--team <team>]..., with optional --global, --approve <revision> and --json.');
  assert.equal(say(['team', 'create', '--global']), 'Use bowerloom team create <name> [--profile engineer|founder|research], with optional --global, --approve <revision> and --json.');
  assert.equal(say(['skills', 'add', '--global']), 'Use bowerloom skills add npm:<package>@<version>:<path> or github:<owner>/<repo>@<40-character-commit>:<path>, with optional --id <id>, --team <team>, --replace, --global, --approve <revision> and --json.');
  assert.equal(say(['skills', 'check', '--global', 'x']), 'Use bowerloom skills check [--global] [--json].');
  assert.equal(say(['ls', '--global', 'x']), 'Use bowerloom ls [teams|skills|prompts|slices] [--global] [--json].');
  assert.equal(say(['ls', 'x']), 'Use bowerloom ls [teams|skills|prompts|slices] [--global] [--json].');
});

test('19. a held store lock refuses a --global apply with STORE_LOCKED and writes nothing', async t => {
  const w = world(t); mustApprove(w, ['skill', 'create', 'first', '--global']);
  const planned = run(w.work, ['prompt', 'create', 'p', '--global', '--json'], w.env), revision = JSON.parse(planned.stdout).revision as string;
  const before = tree(w.store);
  await withProjectLock(w.store, new AbortController().signal, async () => {
    const r = await runAsync(w.work, ['prompt', 'create', 'p', '--global', '--approve', revision], w.env);
    assert.equal(r.status, 1, r.stderr); assert.equal(errorCode(r.stderr), 'STORE_LOCKED');
  });
  assert.equal(tree(w.store), before);
  const after = run(w.work, ['prompt', 'create', 'p', '--global', '--approve', revision], w.env);
  assert.equal(after.status, 0, after.stderr);
});

test('20. ls text pads team ids and skill ids to the widest label of each section', t => {
  const w = world(t);
  mustApprove(w, ['team', 'create', 'research', '--global']); mustApprove(w, ['team', 'create', 'a', '--global']);
  mustApprove(w, ['skill', 'create', 'short', '--global']); mustApprove(w, ['skill', 'create', 'a-much-longer-skill-name', '--global']);
  assert.equal(run(w.work, ['ls', '--global'], w.env).stdout,
    'Teams\n  a         store\n  research  store\n\nSkills\n  a-much-longer-skill-name  store\n  short                     store\n\nPrompts\n  none yet\n');
});

test('21. a linked entry inside the store counts as unlisted and is never followed', t => {
  const w = world(t); mustApprove(w, ['skill', 'create', 'x', '--global']);
  symlinkSync(w.base, join(w.store, 'skills', 'linked'));
  const r = run(w.work, ['ls', '--global'], w.env);
  assert.equal(r.status, 0, r.stderr); assert.match(r.stdout, /\nNot listed: 1 entry with an unusual name or type\. Run bowerloom status\.\n$/);
  assert.equal(JSON.parse(run(w.work, ['ls', '--global', '--json'], w.env).stdout).unlisted, 1);
});

test('22. ls outside any project without --global still refuses PROJECT_NOT_FOUND', t => {
  const w = world(t), r = run(w.work, ['ls'], w.env);
  assert.equal(r.status, 1); assert.equal(errorCode(r.stderr), 'PROJECT_NOT_FOUND');
});

test('23. the store keeps pinned skills in ls with their pin, and an unreadable skills.json says so', t => {
  const w = world(t), env = { ...w.env, ...network(w.base) };
  const r = approve(w, ['skills', 'add', NPM_SPEC, '--global'], w.work, ['--import', preload], env);
  assert.equal(r.applied.status, 0, r.applied.stderr);
  const text = run(w.work, ['ls', 'skills', '--global'], w.env).stdout;
  assert.match(text, /^Skills\n {2}[a-z0-9-]+ {2}store {2}pinned: npm @synthetic\/db-skills@0\.0\.1:skills\/synthetic-db\/collections\n$/);
  const j = JSON.parse(run(w.work, ['ls', 'skills', '--global', '--json'], w.env).stdout);
  assert.equal(j.skills[0].kind, 'npm'); assert.equal(j.skills[0].pin, '@synthetic/db-skills@0.0.1:skills/synthetic-db/collections');
  writeFileSync(join(w.store, 'skills.json'), '{ not json'); chmodSync(join(w.store, 'skills.json'), 0o644);
  const bad = run(w.work, ['ls', 'skills', '--global'], w.env);
  assert.match(bad.stdout, /\nPinned skills are not listed: the store skills\.json cannot be read\. Run bowerloom skills check --global\.\n$/);
  assert.equal(JSON.parse(run(w.work, ['ls', 'skills', '--global', '--json'], w.env).stdout).pinsReadable, false);
});

/** A store with 200 local skills in skills.json, written with the store limits. */
function bigStore(w: W, count = 200) {
  mustApprove(w, ['skill', 'create', 'x', '--global']);
  let m = null as ReturnType<typeof addLocalEntry> | null;
  for (let i = 0; i < count - 1; i++) m = addLocalEntry(m, `s-${String(i).padStart(3, '0')}`, [], STORE_MANIFEST_LIMITS);
  m = addLocalEntry(m, 'x', [], STORE_MANIFEST_LIMITS);
  writeFileSync(join(w.store, 'skills.json'), serializeManifest(m, STORE_MANIFEST_LIMITS), { mode: 0o644 });
}

test('24. C1: a store with 200 skills lists, checks, and takes a new pin', t => {
  const w = world(t), env = { ...w.env, ...network(w.base) }; bigStore(w);
  const j = JSON.parse(run(w.work, ['ls', '--global', '--json'], w.env).stdout);
  assert.equal(j.pinsReadable, true); assert.equal(j.skills.length, 200);
  assert.match(run(w.work, ['skills', 'check', '--global'], w.env).stdout, /^skills\.json \(store\) is valid: 200 skills,/);
  const add = run(w.work, ['skills', 'add', NPM_SPEC, '--global'], env, ['--import', preload]);
  assert.equal(add.status, 3, add.stderr);
});

test('25. F3: a store skills.json over the limit is shown as unreadable, with its code', t => {
  const w = world(t); mustApprove(w, ['skill', 'create', 'x', '--global']);
  const entries = Array.from({ length: 257 }, (_, i) => ({ id: i === 0 ? 'x' : `s-${i}`, source: { kind: 'local', path: `skills/${i === 0 ? 'x' : `s-${i}`}` } }));
  writeFileSync(join(w.store, 'skills.json'), JSON.stringify({ format: 'bowerloom/skills/v1beta1', harnesses: ['claude', 'codex'], skills: entries }), { mode: 0o644 });
  const j = JSON.parse(run(w.work, ['ls', '--global', '--json'], w.env).stdout);
  assert.equal(j.pinsReadable, false); assert.equal(j.pinsError, 'MANIFEST_LIMIT');
  assert.deepEqual(j.skills.map((x: { id: string; state: string }) => [x.id, x.state]), [['x', 'pins-unreadable']]);
  assert.match(run(w.work, ['ls', '--global'], w.env).stdout, /Run bowerloom skills check --global\./);
  const ok = JSON.parse(run(w.work, ['ls', 'teams', '--global', '--json'], w.env).stdout);
  assert.equal(ok.pinsReadable, undefined);
});

test('26. F7: a local skills.json entry whose folder is gone is listed with state missing', t => {
  const w = world(t); mustApprove(w, ['skill', 'create', 'x', '--global']); mustApprove(w, ['skill', 'create', 'y', '--global']);
  rmSync(join(w.store, 'skills', 'x'), { recursive: true });
  const j = JSON.parse(run(w.work, ['ls', '--global', '--json'], w.env).stdout);
  assert.deepEqual(j.skills.map((x: { id: string; state: string }) => [x.id, x.state]), [['x', 'missing'], ['y', 'ok']]);
  assert.match(run(w.work, ['ls', '--global'], w.env).stdout, /^ {2}x {2}store {2}missing$/m);
});

test('27. S2: a state folder that reaches the store through a link fails closed, store or no store', t => {
  const w = world(t), env = (x: string) => ({ ...w.env, ...network(w.base), XDG_STATE_HOME: x });
  mustApprove(w, ['skill', 'create', 'x', '--global']);
  const link = join(w.base, 'link'); symlinkSync(w.store, link);
  const r = run(w.work, ['skills', 'add', NPM_SPEC, '--global'], env(link), ['--import', preload]);
  assert.equal(r.status, 1); assert.equal(errorCode(r.stderr), 'STORE_STATE_NESTED');
  const dangling = join(w.base, 'dangling'); symlinkSync(join(w.base, 'nowhere'), dangling);
  const d = run(w.work, ['skills', 'add', NPM_SPEC, '--global'], env(dangling), ['--import', preload]);
  assert.equal(d.status, 1); assert.equal(errorCode(d.stderr), 'SKILLS_STATE_UNSAFE');
});

test('28. C3: a state folder aliased to the store after the plan is refused at apply, and nothing is written', t => {
  const w = world(t), state = join(w.base, 'swap'); mkdirSync(state, { mode: 0o700 });
  const env = { ...w.env, ...network(w.base), XDG_STATE_HOME: state };
  mkdirSync(w.store, { mode: 0o700 });
  const planned = run(w.work, ['skills', 'add', NPM_SPEC, '--global', '--json'], env, ['--import', preload]);
  assert.equal(planned.status, 3, planned.stderr);
  const revision = JSON.parse(planned.stdout).revision as string;
  rmSync(state, { recursive: true }); symlinkSync(w.store, state);
  const r = run(w.work, ['skills', 'add', NPM_SPEC, '--global', '--approve', revision], env, ['--import', preload]);
  assert.equal(r.status, 1, r.stderr); assert.equal(errorCode(r.stderr), 'STORE_STATE_NESTED');
  assert.deepEqual(readdirSync(w.store), []);
});

test('29. F6: a seed that fails after the pin is written says so in plain words for the store', t => {
  const w = world(t), parent = join(w.base, 'ro'); mkdirSync(parent, { mode: 0o700 });
  const env = { ...w.env, ...network(w.base), XDG_STATE_HOME: join(parent, 'state') };
  const planned = run(w.work, ['skills', 'add', NPM_SPEC, '--global', '--json'], env, ['--import', preload]);
  assert.equal(planned.status, 3, planned.stderr);
  chmodSync(parent, 0o500);
  try {
    const r = run(w.work, ['skills', 'add', NPM_SPEC, '--global', '--approve', JSON.parse(planned.stdout).revision], env, ['--import', preload]);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /Cache: the checked bytes were not kept in .*\(SKILLS_STATE_UNSAFE\)\. The pin is recorded; a project that selects this skill fetches it\.\n$/);
    assert.doesNotMatch(r.stdout, /skills sync/);
  } finally { chmodSync(parent, 0o700); }
  assert.equal(JSON.parse(readFileSync(join(w.store, 'skills.json'), 'utf8')).skills.length, 1);
});

test('30. F6: seedWords names the next step by scope', () => {
  const failed = { root: '/c', status: 'failed' as const, codes: [] };
  assert.match(seedWords({ ...failed, codes: ['X'] }, false), /skills sync fetches it again\.\n$/);
  assert.match(seedWords({ ...failed, codes: ['X'] }, true), /a project that selects this skill fetches it\.\n$/);
});

test('31. F8: an unsafe store refuses ls, skills check, and a write, for a group-writable store and a link', t => {
  const w = world(t); mustApprove(w, ['skill', 'create', 'x', '--global']);
  const all = (code: string) => {
    for (const args of [['ls', '--global'], ['skills', 'check', '--global'], ['skill', 'create', 'y', '--global'], ['skill', 'create', 'y', '--global', '--approve', 'ab'.repeat(32)]]) {
      const r = run(w.work, args, w.env); assert.equal(r.status, 1, args.join(' ')); assert.equal(errorCode(r.stderr), code, args.join(' '));
    }
  };
  chmodSync(w.store, 0o770); all('STORE_UNSAFE'); chmodSync(w.store, 0o700);
  const moved = join(w.base, 'moved'); renameSync(w.store, moved); symlinkSync(moved, w.store);
  all('STORE_UNSAFE'); assert.ok(lstatSync(w.store).isSymbolicLink()); assert.equal(existsSync(join(moved, 'skills', 'y')), false);
});

test('32. F8: skills add --global --replace needs an existing id, and an unchanged pin is refused', t => {
  const w = world(t), env = { ...w.env, ...network(w.base) };
  const none = run(w.work, ['skills', 'add', NPM_SPEC, '--global', '--replace'], env, ['--import', preload]);
  assert.equal(none.status, 1); assert.equal(errorCode(none.stderr), 'SKILLS_ADD_REPLACE_MISSING');
  const added = approve(w, ['skills', 'add', NPM_SPEC, '--global'], w.work, ['--import', preload], env); assert.equal(added.applied.status, 0, added.applied.stderr);
  const id = JSON.parse(readFileSync(join(w.store, 'skills.json'), 'utf8')).skills[0].id as string;
  const same = run(w.work, ['skills', 'add', NPM_SPEC, '--global', '--replace', '--id', id], env, ['--import', preload]);
  assert.equal(same.status, 1); assert.equal(errorCode(same.stderr), 'SKILLS_ADD_EXISTS');
  const missing = run(w.work, ['skills', 'add', NPM_SPEC, '--global', '--replace', '--id', 'other'], env, ['--import', preload]);
  assert.equal(errorCode(missing.stderr), 'SKILLS_ADD_REPLACE_MISSING');
});

test('33. F8: skills add --global --team names a store team', t => {
  const w = world(t), env = { ...w.env, ...network(w.base) };
  assert.equal(errorCode(run(w.work, ['skills', 'add', NPM_SPEC, '--global', '--team', 'research'], env, ['--import', preload]).stderr), 'TEAM_NOT_FOUND');
  mustApprove(w, ['team', 'create', 'research', '--global']);
  assert.equal(errorCode(run(w.work, ['skills', 'add', NPM_SPEC, '--global', '--team', 'nope'], env, ['--import', preload]).stderr), 'TEAM_NOT_FOUND');
  assert.equal(errorCode(run(w.work, ['skills', 'add', NPM_SPEC, '--global', '--team', 'first-team'], env, ['--import', preload]).stderr), 'TEAM_NOT_FOUND');
  const r = approve(w, ['skills', 'add', NPM_SPEC, '--global', '--team', 'research'], w.work, ['--import', preload], env);
  assert.equal(r.applied.status, 0, r.applied.stderr);
  assert.deepEqual(JSON.parse(readFileSync(join(w.store, 'skills.json'), 'utf8')).skills[0].teams, ['research']);
});

test('34. F5: a store team folder that cannot be read is not "not found"', t => {
  const w = world(t), env = { ...w.env, ...network(w.base) };
  mustApprove(w, ['team', 'create', 'research', '--global']);
  chmodSync(join(w.store, 'teams'), 0o000);
  try {
    const r = run(w.work, ['skills', 'add', NPM_SPEC, '--global', '--team', 'research'], env, ['--import', preload]);
    assert.equal(r.status, 1); assert.equal(errorCode(r.stderr), 'STORE_UNREADABLE');
  } finally { chmodSync(join(w.store, 'teams'), 0o700); }
});

test('35. S6: an empty store folder holding only .DS_Store is a leftover for a create', t => {
  const w = world(t); mkdirSync(w.store, { mode: 0o700 }); writeFileSync(join(w.store, '.DS_Store'), 'x');
  const planned = JSON.parse(run(w.work, ['skill', 'create', 'x', '--global', '--json'], w.env).stdout);
  assert.equal(planned.plan.storeCreate, true);
  assert.equal(run(w.work, ['skill', 'create', 'x', '--global', '--approve', planned.revision], w.env).status, 0);
  assert.equal(JSON.parse(run(w.work, ['ls', '--global', '--json'], w.env).stdout).storeState, 'ready');
});
