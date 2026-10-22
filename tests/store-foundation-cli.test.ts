// Spec 03, the store foundation, through the real binary: `store status`, the config marker, and the store at home.
// Every run gets its own HOME and XDG_STATE_HOME under a temporary folder. Nothing here touches the real home folder.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TOPICS } from '../apps/cli/src/human.js';

const cli = fileURLToPath(new URL('../apps/cli/src/main.js', import.meta.url));
const STORE_JSON = '{"format":"bowerloom/store/v1beta1"}\n';
const CONFIG = { format: 'bowerloom/project/v1beta1', harnesses: ['claude', 'codex'], skills: [{ id: 'house-style', source: 'store' }], prompts: [], teams: [{ id: 'research', source: 'store' }] };

function world(t: test.TestContext) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'bowerloom-store-foundation-')));
  t.after(() => { try { chmodSync(join(base, 'home'), 0o700); } catch { /* gone */ } rmSync(base, { recursive: true, force: true }); });
  const home = join(base, 'home'); mkdirSync(home, { mode: 0o700 });
  return { base, home, store: join(home, '.bowerloom'), env: { HOME: home, XDG_STATE_HOME: join(base, 'state') } as Record<string, string> };
}
function run(cwd: string, args: string[], env: Record<string, string>) {
  const r = spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8', timeout: 60000, env: { ...process.env, ...env } });
  assert.equal(r.error, undefined); return r;
}
const errorCode = (stderr: string): string => (JSON.parse(stderr) as { error: { code: string } }).error.code;
const mkStore = (w: { store: string }) => { mkdirSync(w.store, { mode: 0o700 }); writeFileSync(join(w.store, 'store.json'), STORE_JSON, { mode: 0o600 }); };
const snapshot = (dir: string): string => JSON.stringify(readdirSync(dir, { recursive: true, withFileTypes: true }).map(e => `${e.parentPath}/${e.name}`).sort());
function configProject(w: { home: string }, config: unknown = CONFIG, name = 'app') {
  const dir = join(w.home, name); mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'bowerloom.json'), typeof config === 'string' ? config : `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  return dir;
}

test('1. store status on a fresh home prints Store: none yet and exits 0', t => {
  const w = world(t), r = run(w.home, ['store', 'status'], w.env);
  assert.equal(r.status, 0, r.stderr); assert.equal(r.stdout, 'Store: none yet\n  Create one with bowerloom skill create <name> --global.\n'); assert.equal(r.stderr, '');
});

test('2. store status --json on a fresh home', t => {
  const w = world(t), r = run(w.home, ['store', 'status', '--json'], w.env);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout), { format: 'bowerloom/store-status/v1beta1', state: 'absent', path: w.store, code: null, counts: null, leftoverTemps: 0, git: null });
});

test('3. a valid store prints its counts, and the counts ignore a link and a stray file', t => {
  const w = world(t); mkStore(w);
  for (const name of ['house-style', 'notes']) mkdirSync(join(w.store, 'skills', name), { recursive: true });
  mkdirSync(join(w.store, 'skills', 'Bad_Name')); writeFileSync(join(w.store, 'skills', 'stray.txt'), 'x'); symlinkSync(join(w.base), join(w.store, 'skills', 'linked'));
  mkdirSync(join(w.store, 'prompts')); writeFileSync(join(w.store, 'prompts', 'weekly-update.md'), 'x'); writeFileSync(join(w.store, 'prompts', 'readme.txt'), 'x'); mkdirSync(join(w.store, 'prompts', 'folder.md'));
  mkdirSync(join(w.store, 'teams', 'research'), { recursive: true }); writeFileSync(join(w.store, 'teams', 'file'), 'x');
  writeFileSync(join(w.store, 'skills.json'), JSON.stringify({ format: 'bowerloom/skills/v1beta1', harnesses: ['claude'], skills: [{ id: 'a', source: { kind: 'npm' } }, { id: 'b', source: { kind: 'git' } }, { id: 'c', source: { kind: 'local', path: 'skills/c' } }] }));
  const r = run(w.home, ['store', 'status'], w.env);
  assert.equal(r.status, 0, r.stderr);
  // Silent-failure F1 and F2: what the count skipped is shown, and so is whether a count was capped.
  assert.equal(r.stdout, `Store: ready\n  Path: ${w.store}\n  Skill folders: 2 (3 entries ignored)\n  Pinned skills: 2\n  Prompts: 1 (2 entries ignored)\n  Teams: 1 (1 entry ignored)\n`);
  const j = JSON.parse(run(w.home, ['store', 'status', '--json'], w.env).stdout);
  assert.deepEqual(j.counts, { skillFolders: 2, pinnedSkills: 2, pinnedSkillsProblem: null, prompts: 1, teams: 1, ignored: { skillFolders: 3, prompts: 2, teams: 1 }, capped: { skillFolders: false, prompts: false, teams: false } }); assert.equal(j.state, 'store'); assert.equal(j.code, null); assert.equal(j.git, null);
});

test('3b. a skills.json that cannot be used says why; no skills.json counts 0; 256 names print as 256 or more and say capped', t => {
  const w = world(t); mkStore(w);
  assert.match(run(w.home, ['store', 'status'], w.env).stdout, /Pinned skills: 0\n/);
  const counts = () => JSON.parse(run(w.home, ['store', 'status', '--json'], w.env).stdout).counts;
  const file = join(w.store, 'skills.json');
  writeFileSync(file, '{"a":1,"a":2}');
  assert.match(run(w.home, ['store', 'status'], w.env).stdout, /Pinned skills: unreadable \(invalid\)\n/);
  assert.deepEqual([counts().pinnedSkills, counts().pinnedSkillsProblem], [null, 'invalid']);
  writeFileSync(file, '{}'); chmodSync(file, 0o666);
  assert.match(run(w.home, ['store', 'status'], w.env).stdout, /Pinned skills: unreadable \(unsafe\)\n/);
  assert.equal(counts().pinnedSkillsProblem, 'unsafe');
  chmodSync(file, 0o600); writeFileSync(file, ' '.repeat(4 * 1024 * 1024 + 1));
  assert.match(run(w.home, ['store', 'status'], w.env).stdout, /Pinned skills: unreadable \(too-large\)\n/);
  assert.equal(counts().pinnedSkillsProblem, 'too-large');
  rmSync(file);
  for (let i = 0; i < 257; i++) mkdirSync(join(w.store, 'teams', `t${i}`), { recursive: true });
  assert.match(run(w.home, ['store', 'status'], w.env).stdout, /Teams: 256 or more\n/);
  assert.equal(counts().teams, 256); assert.equal(counts().capped.teams, true); assert.equal(counts().capped.prompts, false);
});

test('3c. a skills, prompts, or teams entry that is a link or not a folder refuses STORE_UNSAFE', t => {
  for (const name of ['skills', 'prompts', 'teams']) {
    const w = world(t); mkStore(w); writeFileSync(join(w.store, name), 'x');
    let r = run(w.home, ['store', 'status'], w.env); assert.equal(r.status, 0, name); assert.match(r.stdout, /^Store: refused \(STORE_UNSAFE\)\n/, name);
    rmSync(join(w.store, name)); mkdirSync(join(w.base, 'elsewhere')); symlinkSync(join(w.base, 'elsewhere'), join(w.store, name));
    r = run(w.home, ['store', 'status'], w.env); assert.match(r.stdout, /^Store: refused \(STORE_UNSAFE\)\n/, `${name} link`);
  }
});

test('4. a store folder without store.json prints Store: not a store and exits 0', t => {
  const w = world(t); mkdirSync(w.store, { mode: 0o700 }); writeFileSync(join(w.store, 'x'), 'x');
  const r = run(w.home, ['store', 'status'], w.env);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, `Store: not a store\n  ${w.store} exists, but it has no store.json. Bowerloom will not use it.\n  Move it somewhere else first. Then run bowerloom skill create <name> --global.\n`);
  assert.equal(JSON.parse(run(w.home, ['store', 'status', '--json'], w.env).stdout).state, 'foreign');
});

test('5. a store that is a link prints Store: refused (STORE_UNSAFE) and exits 0', t => {
  const w = world(t); mkdirSync(join(w.base, 'elsewhere'), { mode: 0o700 }); symlinkSync(join(w.base, 'elsewhere'), w.store);
  const r = run(w.home, ['store', 'status'], w.env);
  assert.equal(r.status, 0, r.stderr); assert.match(r.stdout, /^Store: refused \(STORE_UNSAFE\)\n  The store is not safe to use\./);
  const j = JSON.parse(run(w.home, ['store', 'status', '--json'], w.env).stdout);
  assert.equal(j.state, 'refused'); assert.equal(j.code, 'STORE_UNSAFE'); assert.equal(j.counts, null);
});

test('6. store status writes nothing', t => {
  const w = world(t); mkStore(w); mkdirSync(join(w.store, 'skills', 'a'), { recursive: true });
  const before = snapshot(w.base);
  run(w.home, ['store', 'status'], w.env); run(w.home, ['store', 'status', '--json'], w.env);
  assert.equal(snapshot(w.base), before);
  const bare = world(t), beforeBare = snapshot(bare.base); run(bare.home, ['store', 'status'], bare.env); assert.equal(snapshot(bare.base), beforeBare);
});

test('7. store frobnicate, store, and store status --x exit 2 with USAGE', t => {
  const w = world(t);
  for (const args of [['store', 'frobnicate'], ['store'], ['store', 'status', '--x'], ['store', 'status', '--json', '--json'], ['store', 'status', 'extra']]) {
    const r = run(w.home, args, w.env); assert.equal(r.status, 2, args.join(' ')); assert.equal(errorCode(r.stderr), 'USAGE');
  }
  assert.equal((JSON.parse(run(w.home, ['store', 'status', '--x'], w.env).stderr) as { error: { message: string } }).error.message, 'Use bowerloom store status [--json].');
});

test('8. up in a fresh folder under a home that has a valid store reaches the init plan and exits 3', t => {
  const w = world(t); mkStore(w); const dir = join(w.home, 'fresh'); mkdirSync(dir);
  const r = run(dir, ['up', '--team', 'x', '--goal', 'g'], w.env);
  assert.equal(r.status, 3, r.stderr + r.stdout); assert.match(r.stdout, /Next step: init/);
  assert.deepEqual(readdirSync(dir), []);
});

test('9. up inside the store, and init plan with the store as the target, refuse STORE_NOT_A_PROJECT', t => {
  const w = world(t); mkStore(w);
  const up = run(w.store, ['up', '--team', 'x', '--goal', 'g'], w.env); assert.equal(up.status, 1, up.stdout); assert.equal(errorCode(up.stderr), 'STORE_NOT_A_PROJECT');
  const inner = join(w.store, 'skills'); mkdirSync(inner);
  const deep = run(inner, ['up', '--team', 'x', '--goal', 'g'], w.env); assert.equal(errorCode(deep.stderr), 'STORE_NOT_A_PROJECT');
  for (const mode of ['plan', 'apply']) {
    const args = ['init', mode, '--mode', 'existing', '--target', w.store, '--name', 'n', '--goal', 'g', ...(mode === 'apply' ? ['--approve', 'a'.repeat(64)] : [])];
    const r = run(w.home, args, w.env); assert.equal(r.status, 1, mode); assert.equal(errorCode(r.stderr), 'STORE_NOT_A_PROJECT');
  }
  assert.deepEqual(readdirSync(w.store).sort(), ['skills', 'store.json']);
});

test('10. status --json in a config-only project', t => {
  const w = world(t), dir = configProject(w), run1 = run(dir, ['status', '--json'], w.env);
  assert.equal(run1.status, 0, run1.stderr);
  const j = JSON.parse(run1.stdout);
  assert.equal(j.format, 'bowerloom/project-status/v1beta2'); assert.deepEqual(j.markers, { folder: false, config: true }); assert.equal(j.setup, 'none'); assert.equal(j.status, 'ready');
  assert.equal(j.specReady, false); assert.equal(j.revision, null); assert.deepEqual(j.drift, []); assert.deepEqual(j.owned, []); assert.equal(j.runtimeReady, false); assert.equal(j.executionAuthorized, false);
  assert.deepEqual(Object.keys(j.config), ['bytes', 'code', 'counts', 'harnesses', 'path', 'sha256', 'state']);
  assert.deepEqual({ ...j.config, sha256: 'x' }, { path: 'bowerloom.json', sha256: 'x', bytes: readFileSync(join(dir, 'bowerloom.json')).length, state: 'valid', code: null, harnesses: ['claude', 'codex'], counts: { skills: 1, prompts: 0, teams: 1 } });
  assert.match(j.config.sha256, /^[a-f0-9]{64}$/);
  const text = run(dir, ['status'], w.env);
  assert.equal(text.stdout, `Project: ${dir}\nConfig: bowerloom.json (1 skills, 0 prompts, 1 teams)\nSetup: ready (no startup setup, this project uses bowerloom.json)\nWorkers: none started (this beta starts none)\n`);
});

test('11. status in a config-only project with an invalid config prints drift config-invalid and exits 0', t => {
  const w = world(t), dir = configProject(w, '{"format":"nope"}\n');
  const j = JSON.parse(run(dir, ['status', '--json'], w.env).stdout);
  assert.equal(j.status, 'drifted'); assert.deepEqual(j.drift, [{ path: 'bowerloom.json', kind: 'config-invalid', code: 'CONFIG_INVALID' }]);
  assert.deepEqual({ ...j.config, sha256: 'x', bytes: 0 }, { path: 'bowerloom.json', sha256: 'x', bytes: 0, state: 'invalid', code: 'CONFIG_INVALID', harnesses: [], counts: { skills: 0, prompts: 0, teams: 0 } });
  const r = run(dir, ['status'], w.env);
  assert.equal(r.status, 0); assert.match(r.stdout, /Config: bowerloom\.json \(invalid, CONFIG_INVALID\)\nSetup: drifted \(no startup setup/); assert.match(r.stdout, /\n  config-invalid: bowerloom\.json \(CONFIG_INVALID\)\n/);
  const big = configProject(w, { ...CONFIG, skills: Array.from({ length: 129 }, (_, i) => ({ id: `s-${String(i).padStart(4, '0')}`, source: 'project' })) }, 'big');
  assert.equal(JSON.parse(run(big, ['status', '--json'], w.env).stdout).config.code, 'CONFIG_LIMIT');
});

/** An existing project prepared through the real init plan and apply. */
function startupProject(w: ReturnType<typeof world>) {
  const dir = join(w.home, 'studio'); mkdirSync(dir);
  const args = ['--mode', 'existing', '--target', dir, '--name', 'Studio handbook', '--goal', 'Prepare a fictional onboarding kit for an independent design studio.'];
  const plan = run(w.home, ['init', 'plan', ...args, '--json'], w.env); assert.equal(plan.status, 0, plan.stderr);
  const applied = run(w.home, ['init', 'apply', ...args, '--approve', JSON.parse(plan.stdout).revision], w.env); assert.equal(applied.status, 0, applied.stderr);
  return dir;
}

test('12. status --json in a project with .bowerloom, a config, and a receipt keeps setup startup', t => {
  const w = world(t), dir = startupProject(w);
  assert.equal(JSON.parse(run(dir, ['status', '--json'], w.env).stdout).config, null, 'no config yet');
  writeFileSync(join(dir, 'bowerloom.json'), `${JSON.stringify(CONFIG, null, 2)}\n`, { mode: 0o600 });
  const j = JSON.parse(run(dir, ['status', '--json'], w.env).stdout);
  assert.equal(j.setup, 'startup'); assert.deepEqual(j.markers, { folder: true, config: true }); assert.equal(j.status, 'ready'); assert.equal(j.specReady, true); assert.match(j.revision, /^[a-f0-9]{64}$/); assert.equal(j.config.state, 'valid');
  assert.match(run(dir, ['status'], w.env).stdout, /^Project: .*\nConfig: bowerloom\.json \(1 skills, 0 prompts, 1 teams\)\nSetup: ready\nRevision: [a-f0-9]{64}\n/);
});

test('12b. a project with .bowerloom and no config keeps the old behavior, with the new format', t => {
  const w = world(t), dir = startupProject(w);
  const j = JSON.parse(run(dir, ['status', '--json'], w.env).stdout);
  assert.equal(j.format, 'bowerloom/project-status/v1beta2'); assert.deepEqual(j.markers, { folder: true, config: false }); assert.equal(j.setup, 'startup'); assert.equal(j.config, null);
  assert.equal(j.status, 'ready'); assert.deepEqual(j.drift, []);
  // A missing receipt with no config is still drift.
  rmSync(join(dir, '.bowerloom', 'installation-receipt.json'));
  const bad = JSON.parse(run(dir, ['status', '--json'], w.env).stdout);
  assert.equal(bad.setup, 'startup'); assert.equal(bad.status, 'drifted'); assert.deepEqual(bad.drift, [{ path: '.bowerloom/installation-receipt.json', kind: 'invalid-receipt' }]);
});

test('13. status in a project with .bowerloom, a config, and no receipt reports setup none', t => {
  const w = world(t), dir = join(w.home, 'authored'); mkdirSync(join(dir, '.bowerloom'), { recursive: true, mode: 0o700 });
  writeFileSync(join(dir, 'bowerloom.json'), `${JSON.stringify(CONFIG, null, 2)}\n`, { mode: 0o600 });
  const j = JSON.parse(run(dir, ['status', '--json'], w.env).stdout);
  assert.equal(j.setup, 'none'); assert.equal(j.status, 'ready'); assert.deepEqual(j.markers, { folder: true, config: true }); assert.deepEqual(j.drift, []); assert.equal(j.revision, null); assert.equal(j.specReady, false);
  writeFileSync(join(dir, '.bowerloom', 'stray.txt'), 'x');
  const stray = JSON.parse(run(dir, ['status', '--json'], w.env).stdout);
  assert.equal(stray.status, 'drifted'); assert.deepEqual(stray.drift, [{ path: '.bowerloom/stray.txt', kind: 'unexpected' }]);
});

test('14. ls in a config-only project lists three empty sections, and ls --json has pinned []', t => {
  const w = world(t), dir = configProject(w), r = run(dir, ['ls'], w.env);
  assert.equal(r.status, 0, r.stderr); assert.equal(r.stdout, 'Config: bowerloom.json (1 skills, 0 prompts, 1 teams)\n\nTeams\n  none yet\n\nSkills\n  none yet\n\nPrompts\n  none yet\n');
  const bad = configProject(w, '{}\n', 'bad'); assert.match(run(bad, ['ls'], w.env).stdout, /^Config: bowerloom\.json \(invalid, CONFIG_INVALID\)\n\nTeams\n/);
  assert.deepEqual(JSON.parse(run(dir, ['ls', '--json'], w.env).stdout), { format: 'bowerloom/ls/v1beta2', scope: 'project', listedBy: 'folders', teams: [], skills: [], prompts: [], pinsReadable: true, pinsError: null, unselected: { skills: [], prompts: [], teams: [] }, unlisted: 0 });
});

test('15. help store and store --help print the store topic, and the first screen names it', t => {
  const w = world(t);
  for (const args of [['help', 'store'], ['store', '--help']]) { const r = run(w.home, args, w.env); assert.equal(r.status, 0, r.stderr); assert.ok(r.stdout.endsWith(TOPICS.store!), args.join(' ')); }
  assert.match(run(w.home, ['--help'], w.env).stdout, /\n {2}bowerloom help store {7}Your store, ~\/\.bowerloom, and how a project uses it\.\n/);
});

test('16. store status with the home folder at mode 0 prints Store: refused (STORE_UNREADABLE) and exits 0', t => {
  const w = world(t); mkStore(w); const elsewhere = join(w.base, 'cwd'); mkdirSync(elsewhere);
  chmodSync(w.home, 0);
  try {
    const r = run(elsewhere, ['store', 'status'], w.env);
    assert.equal(r.status, 0, r.stderr); assert.match(r.stdout, /^Store: refused \(STORE_UNREADABLE\)\n  Bowerloom cannot read the store or a folder on the way to it\.\n$/);
  } finally { chmodSync(w.home, 0o700); }
});

test('17. the interim codes in a config-only folder: each command refuses with its code and changes nothing', t => {
  const w = world(t), dir = configProject(w), before = snapshot(w.base);
  const cases: [string[], string][] = [
    [['skills', 'add', 'npm:@scope/pkg@1.0.0:skills/x', '--json'], 'MANIFEST_UNSAFE'],
    [['skills', 'check'], 'MANIFEST_UNSAFE'],
    [['skills', 'sync', '--json'], 'MANIFEST_UNSAFE'],
    [['apply', '--json'], 'MANIFEST_UNSAFE'],
    [['skill', 'create', 'house-style', '--json'], 'AUTHORING_UNSAFE_PATH'],
    [['prompt', 'create', 'weekly-update', '--json'], 'AUTHORING_UNSAFE_PATH'],
    [['team', 'create', 'research', '--json'], 'AUTHORING_UNSAFE_PATH'],
    [['up', '--team', 'first-team', '--json'], 'PROJECT_BRIEF_INVALID'],
    [['skills', 'migrate', 'plan', '--state', join(w.base, 'earlier')], 'SKILLS_MIGRATE_NOTHING'],
  ];
  for (const [args, code] of cases) {
    const r = run(dir, args, w.env);
    assert.notEqual(r.status, 0, args.join(' ')); assert.equal(errorCode(r.stderr), code, `${args.join(' ')}: ${r.stderr}`);
    assert.equal(snapshot(w.base), before, args.join(' '));
  }
});

test('18. a leftover temporary file beside a valid store.json prints the Leftover line', t => {
  const w = world(t); mkStore(w); writeFileSync(join(w.store, '.store.json.0123456789abcdef.tmp'), 'x');
  const r = run(w.home, ['store', 'status'], w.env);
  assert.equal(r.status, 0); assert.match(r.stdout, /\n {2}Leftover: \.store\.json\.0123456789abcdef\.tmp \(the next --global write removes it\)\n$/);
  assert.equal(JSON.parse(run(w.home, ['store', 'status', '--json'], w.env).stdout).leftoverTemps, 1);
  // A store holding only a leftover file is "none yet".
  const bare = world(t); mkdirSync(bare.store, { mode: 0o700 }); writeFileSync(join(bare.store, '.store.json.0123456789abcdef.tmp'), 'x');
  const b = run(bare.home, ['store', 'status', '--json'], bare.env); assert.equal(JSON.parse(b.stdout).state, 'absent');
  assert.equal(JSON.parse(b.stdout).leftoverTemps, 1, 'F4: the leftover is counted');
  assert.match(run(bare.home, ['store', 'status'], bare.env).stdout, /^Store: none yet\n.*\n {2}Leftover: \.store\.json\.0123456789abcdef\.tmp \(the next --global write removes it\)\n$/s);
});

test('a project under a home that holds a store is found, and a bowerloom.json at home is refused', t => {
  const w = world(t); mkStore(w);
  const app = join(w.home, 'app'); mkdirSync(join(app, '.bowerloom'), { recursive: true, mode: 0o700 });
  assert.equal(run(app, ['ls'], w.env).status, 0);
  const bare = world(t); writeFileSync(join(bare.home, 'bowerloom.json'), '{}', { mode: 0o600 }); mkdirSync(join(bare.home, 'sub'));
  assert.equal(errorCode(run(join(bare.home, 'sub'), ['ls'], bare.env).stderr), 'PROJECT_ROOT_REFUSED');
});

test('F11: a relative init target inside the store refuses STORE_NOT_A_PROJECT', t => {
  const w = world(t); mkStore(w); mkdirSync(join(w.store, 'skills'));
  for (const target of ['.', 'skills', '../.bowerloom']) {
    const cwd = target === '../.bowerloom' ? join(w.store, 'skills') : w.store;
    const r = run(cwd, ['init', 'plan', '--mode', 'existing', '--target', target, '--name', 'n', '--goal', 'g'], w.env);
    assert.equal(r.status, 1, target); assert.equal(errorCode(r.stderr), 'STORE_NOT_A_PROJECT', target);
  }
});

test('S9: deleting the receipt of a startup project that also has a bowerloom.json is still drift', t => {
  const w = world(t), dir = startupProject(w);
  writeFileSync(join(dir, 'bowerloom.json'), `${JSON.stringify(CONFIG, null, 2)}\n`, { mode: 0o600 });
  rmSync(join(dir, '.bowerloom', 'installation-receipt.json'));
  const j = JSON.parse(run(dir, ['status', '--json'], w.env).stdout);
  assert.equal(j.setup, 'startup'); assert.equal(j.status, 'drifted'); assert.deepEqual(j.drift, [{ path: '.bowerloom/installation-receipt.json', kind: 'invalid-receipt' }]);
});

test('S1: a config-only project folder that others can write refuses PROJECT_UNSAFE', t => {
  const w = world(t), dir = configProject(w); chmodSync(dir, 0o777);
  const r = run(dir, ['status'], w.env); assert.equal(r.status, 1); assert.equal(errorCode(r.stderr), 'PROJECT_FOLDER_UNSAFE');
});
