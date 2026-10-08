// `bowerloom up --team <name>` with workers held (build plan 01, M6). Each run computes the next step; --approve applies
// only the step whose revision matches. PATH starts with `claude` and `codex` shims that leave a sentinel file when run,
// and the network is denied in every child process.
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
const GOAL = 'Prepare a fictional onboarding kit for an independent design studio.';
const OUTPUT_DIR = process.env.BOWERLOOM_M6_OUTPUT_DIR;

function folder(t: TestContext) { const root = realpathSync(mkdtempSync(join(tmpdir(), 'bowerloom-up-team-'))); t.after(() => rmSync(root, { recursive: true, force: true })); return root; }
/** A fresh folder (no .bowerloom) with the user's own AGENTS.md and CLAUDE.md, shims first on PATH, and the network denied. */
function fresh(t: TestContext) {
  const home = folder(t), dir = join(home, 'studio'), shims = join(home, 'shims'), sentinels = join(home, 'sentinels');
  for (const p of [dir, shims, sentinels]) mkdirSync(p);
  writeFileSync(join(dir, 'AGENTS.md'), 'Team rules stay with the team.\n'); writeFileSync(join(dir, 'CLAUDE.md'), '# Memory\nKeep it short.\n');
  for (const name of ['claude', 'codex']) writeFileSync(join(shims, name), `#!/bin/sh\nprintf 'ran %s\\n' "$*" > "$BOWERLOOM_TEST_SENTINELS/${name}"\n`, { mode: 0o755 });
  const log = join(home, 'network.log'), plan = join(home, 'network.json'); writeFileSync(log, ''); writeFileSync(plan, JSON.stringify({ log }));
  const env = { HOME: home, XDG_STATE_HOME: join(home, 'state'), PATH: `${shims}:${process.env.PATH ?? ''}`, BOWERLOOM_TEST_SENTINELS: sentinels, TEST_FAKE_NETWORK_PLAN: plan };
  return { home, dir, shims, sentinels, env, network: () => readFileSync(log, 'utf8').split('\n').filter(Boolean) };
}
type Fresh = ReturnType<typeof fresh>;
function run(p: Fresh, args: string[], cwd = p.dir) {
  const r = spawnSync(process.execPath, ['--import', preload, cli, ...args], { cwd, encoding: 'utf8', timeout: 120000, env: { ...process.env, ...p.env } });
  assert.equal(r.error, undefined); return r;
}
function tree(dir: string): string {
  return JSON.stringify(readdirSync(dir, { recursive: true }).map(String).sort().map(rel => { const s = lstatSync(join(dir, rel)); return [rel, s.isFile() ? createHash('sha256').update(readFileSync(join(dir, rel))).digest('hex') : 'dir']; }));
}
const errorOf = (stderr: string) => (JSON.parse(stderr) as { error: { code: string; message: string } }).error;
const revisionIn = (stdout: string): string => { const m = /^Revision: ([a-f0-9]{64})$/m.exec(stdout); assert.ok(m, stdout); return m[1]!; };
const save = (name: string, text: string): void => { if (OUTPUT_DIR) writeFileSync(join(OUTPUT_DIR, name), text); };
/** Plans with --json, then applies with --approve: the way an agent runs a create command. */
function create(p: Fresh, args: string[]) {
  const planned = run(p, [...args, '--json']); assert.equal(planned.status, 3, planned.stderr);
  const applied = run(p, [...args, '--approve', JSON.parse(planned.stdout).revision]); assert.equal(applied.status, 0, applied.stderr);
}
function held(r: ReturnType<typeof run>): void {
  assert.equal(r.status, 4, r.stderr + r.stdout);
  assert.match(r.stdout, /^prepared, workers held$/m); assert.match(r.stdout, /\.bowerloom\/START-HERE\.md/);
  assert.equal(errorOf(r.stderr).code, 'WORKERS_HELD');
}

test('up --team chains from a fresh folder to exit 4 with --approve only; each step prints the next revision; no worker starts', t => {
  const p = fresh(t), up = ['up', '--team', 'Studio crew', '--goal', GOAL];
  // The shims work: run directly, each leaves its sentinel. Then the folder is emptied, so only the CLI could fill it.
  for (const name of ['claude', 'codex']) assert.equal(spawnSync(name, ['--version'], { env: { ...process.env, ...p.env } }).status, 0);
  assert.deepEqual(readdirSync(p.sentinels).sort(), ['claude', 'codex']); for (const name of readdirSync(p.sentinels)) rmSync(join(p.sentinels, name));
  const own = { agents: readFileSync(join(p.dir, 'AGENTS.md'), 'utf8'), claude: readFileSync(join(p.dir, 'CLAUDE.md'), 'utf8') };

  // 1. init: shown, nothing written.
  const before = tree(p.home), shown = run(p, up);
  assert.equal(shown.status, 3, shown.stderr); assert.equal(shown.stderr, ''); save('up-exit3-init.txt', shown.stdout);
  assert.match(shown.stdout, /^Next step: init\. Set up \.bowerloom in this folder for team Studio crew\.$/m);
  assert.match(shown.stdout, /^ {2}Project: studio$/m); assert.match(shown.stdout, /^ {2}Team: Studio crew \(first-team\)$/m);
  const r1 = revisionIn(shown.stdout);
  assert.ok(shown.stdout.endsWith(`Approval required. Run the same command again with --approve ${r1}\n`), shown.stdout);
  assert.equal(tree(p.home), before); assert.equal(existsSync(join(p.dir, '.bowerloom')), false);
  const json = run(p, [...up, '--json']); assert.equal(json.status, 3, json.stderr);
  const body = JSON.parse(json.stdout); assert.equal(body.code, 'APPROVAL_REQUIRED'); assert.equal(body.revision, r1); assert.equal(body.plan.step, 'init'); assert.equal(body.plan.format, 'bowerloom/up-step/v1beta1');
  // 2. init applied. Nothing else to prepare yet: held, exit 4.
  const first = run(p, [...up, '--approve', r1]); held(first); save('up-exit4-after-init.txt', first.stdout + first.stderr);
  assert.match(first.stdout, new RegExp(`^Applied plan ${r1}\\.$`, 'm'));
  const teams = JSON.parse(run(p, ['ls', 'teams', '--json']).stdout); assert.deepEqual(teams.teams, ['first-team']);
  assert.equal(JSON.parse(readFileSync(join(p.dir, '.bowerloom/brief.json'), 'utf8')).teamName, 'Studio crew');
  assert.equal(JSON.parse(readFileSync(join(p.dir, '.bowerloom/brief.json'), 'utf8')).projectName, 'studio');

  // An agent adds a prompt and a skill of the project's own.
  create(p, ['prompt', 'create', 'weekly-update']); create(p, ['skill', 'create', 'house-style']);
  // 3. sync, shown.
  const sync = run(p, up); assert.equal(sync.status, 3, sync.stderr); save('up-exit3-sync.txt', sync.stdout);
  assert.match(sync.stdout, /^Next step: sync\./m); assert.match(sync.stdout, /house-style +install +your skill/);
  const r2 = revisionIn(sync.stdout);
  // 4. sync applied; the apply step is shown with its own revision, exit 3.
  const afterSync = run(p, [...up, '--approve', r2]); assert.equal(afterSync.status, 3, afterSync.stderr); save('up-exit3-apply.txt', afterSync.stdout);
  assert.match(afterSync.stdout, new RegExp(`^Applied plan ${r2}\\.$`, 'm')); assert.match(afterSync.stdout, /^Next step: apply\./m);
  assert.match(afterSync.stdout, /weekly-update/); assert.match(afterSync.stdout, /AGENTS\.md and CLAUDE\.md/);
  const r3 = revisionIn(afterSync.stdout); assert.notEqual(r3, r2);
  // A revision that is not the current step's refuses and changes nothing.
  const snapshot = tree(p.dir), stale = run(p, [...up, '--approve', r2]);
  assert.equal(stale.status, 1); assert.equal(errorOf(stale.stderr).code, 'STALE_APPROVAL'); assert.equal(tree(p.dir), snapshot);
  // 5. apply applied: prepared, workers held.
  const done = run(p, [...up, '--approve', r3]); held(done); save('up-exit4-held.txt', done.stdout + done.stderr);
  assert.match(done.stdout, new RegExp(`^Applied plan ${r3}\\.$`, 'm'));
  assert.equal(readFileSync(join(p.dir, '.claude/commands/weekly-update.md'), 'utf8'), readFileSync(join(p.dir, '.bowerloom/prompts/weekly-update.md'), 'utf8'));
  assert.ok(existsSync(join(p.dir, '.agents/skills/prompt-weekly-update/SKILL.md')));
  for (const root of ['.claude/skills', '.agents/skills']) assert.ok(existsSync(join(p.dir, root, 'house-style/SKILL.md')), root);
  // 6. Stateless: the same command again is held at once, and changes nothing.
  const quiet = tree(p.dir), again = run(p, up); held(again); assert.equal(tree(p.dir), quiet);

  assert.equal(readFileSync(join(p.dir, 'AGENTS.md'), 'utf8'), own.agents); assert.equal(readFileSync(join(p.dir, 'CLAUDE.md'), 'utf8'), own.claude);
  assert.deepEqual(JSON.parse(run(p, ['ls', 'teams', '--json']).stdout).teams, ['first-team']);
  const status = JSON.parse(run(p, ['status', '--json']).stdout); assert.equal(status.status, 'ready', JSON.stringify(status.drift));
  assert.deepEqual(readdirSync(p.sentinels), [], 'no claude or codex process ran'); assert.deepEqual(p.network(), []);
});

test('up --team reuses first-team by id or display name; a new id becomes a team create step', t => {
  const p = fresh(t), up = (team: string, ...extra: string[]) => ['up', '--team', team, '--goal', GOAL, ...extra];
  const init = run(p, up('Studio crew')); assert.equal(init.status, 3); held(run(p, up('Studio crew', '--approve', revisionIn(init.stdout))));
  for (const name of ['first-team', 'Studio crew']) held(run(p, up(name)));
  // Run from a folder inside the project, as git would be: the project is found by walking up.
  const sub = join(p.dir, 'src'); mkdirSync(sub); held(run(p, ['up', '--team', 'Studio crew'], sub));
  assert.deepEqual(JSON.parse(run(p, ['ls', 'teams', '--json']).stdout).teams, ['first-team']);
  const team = run(p, up('research-desk')); assert.equal(team.status, 3, team.stderr);
  assert.match(team.stdout, /^Next step: team\./m); assert.match(team.stdout, /^Create team research-desk in \.bowerloom\/teams\/research-desk$/m);
  held(run(p, up('research-desk', '--approve', revisionIn(team.stdout))));
  assert.deepEqual(JSON.parse(run(p, ['ls', 'teams', '--json']).stdout).teams, ['first-team', 'research-desk']);
  held(run(p, up('research-desk')));
  const invalid = run(p, up('Another Team')); assert.equal(invalid.status, 1); assert.equal(errorOf(invalid.stderr).code, 'TEAM_NAME_INVALID');
  assert.deepEqual(readdirSync(p.sentinels), []); assert.deepEqual(p.network(), []);
});

test('up --team usage: a missing --goal on a fresh folder exits 2; bad flags exit 2; up --demo keeps its own usage', t => {
  const p = fresh(t), before = tree(p.home);
  const noGoal = run(p, ['up', '--team', 'Studio crew']); assert.equal(noGoal.status, 2); assert.equal(errorOf(noGoal.stderr).code, 'USAGE');
  assert.match(errorOf(noGoal.stderr).message, /--goal/);
  for (const args of [['up', '--team'], ['up', '--team', 'x', '--goal'], ['up', '--team', 'x', '--goal', GOAL, '--yes'], ['up', '--team', 'x', '--goal', GOAL, '--approve', 'abc'],
    ['up', '--team', 'x', '--team', 'y', '--goal', GOAL], ['up', '--team', 'x', '--goal', GOAL, 'extra'], ['up', '--team', 'x', '--goal', GOAL, '--demo']]) {
    const r = run(p, args); assert.equal(r.status, 2, args.join(' ') + r.stderr); assert.equal(errorOf(r.stderr).code, 'USAGE');
  }
  const wrong = run(p, ['up', '--team', 'x', '--goal', GOAL, '--approve', 'a'.repeat(64)]); assert.equal(wrong.status, 1); assert.equal(errorOf(wrong.stderr).code, 'STALE_APPROVAL');
  assert.equal(tree(p.home), before);
  // up without --team is the --demo session command, unchanged: it still needs its installation file.
  for (const args of [['up'], ['up', '--demo'], ['up', '--demo', '--pro']]) { const r = run(p, args); assert.equal(r.status, 2, args.join(' ')); assert.equal(errorOf(r.stderr).code, 'USAGE'); }
  for (const args of [['help', 'up'], ['up', '--help']]) { const r = run(p, args); assert.equal(r.status, 0, r.stderr); assert.match(r.stdout, /bowerloom up --team <name>/); assert.match(r.stdout, /--demo/); }
  assert.deepEqual(readdirSync(p.sentinels), []); assert.deepEqual(p.network(), []);
});
