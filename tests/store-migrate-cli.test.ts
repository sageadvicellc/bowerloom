// Spec 08, through the real binary: `store migrate` and `receipt clean`. Every run gets its own HOME and XDG_STATE_HOME
// under a temporary folder, and the GitHub token variables are unset. Nothing here touches the real home folder.
import './support/isolate-home.js';
import test from './support/lock-slot-retry.js';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { world, run, approve, mustApprove, errorCode, errorMessage, project, network, NETWORK, pushStore, shared, baseEnv, cli, loggedHosts, STORE_COMMIT } from './support/config-cli.js';
import type { World } from './support/config-cli.js';
import { TOPICS } from '../apps/cli/src/human.js';
import { readInstalledRelease } from '../apps/cli/src/release.js';
import { withProjectLock, withStoreForWrite } from '../packages/project-context/src/index.js';
import { parseLock, serializeLock } from '../packages/project-config/src/index.js';

const heading = `Bowerloom ${readInstalledRelease().version}: open beta\n${readInstalledRelease().execution}\n\n`;
/** Every path under a folder with the bytes of each file. */
function snapshot(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rel of readdirSync(dir, { recursive: true }).map(String).sort()) { const s = lstatSync(join(dir, rel)); out[rel] = s.isFile() ? createHash('sha256').update(readFileSync(join(dir, rel))).digest('hex') : 'dir'; }
  return out;
}
/** A project with `.bowerloom` (the marker of a beta.2 project). */
function bowerloomProject(w: World, name = 'app'): string { const dir = project(w, name); mkdirSync(join(dir, '.bowerloom'), { mode: 0o755 }); return dir; }

test('5 (receipt clean alone). a deleted skill is held; receipt clean shows its plan, exits 3, applies, and status no longer names it', t => {
  const w = world(t), dir = bowerloomProject(w);
  mustApprove(dir, ['skill', 'create', 'notes'], w.env);
  mustApprove(dir, ['prompt', 'create', 'brief'], w.env);
  rmSync(join(dir, '.bowerloom', 'skills', 'notes'), { recursive: true });
  assert.match(run(dir, ['status'], w.env).stdout, /^ {2}skill notes: held \(AUTHORING_ITEM_MISSING\)\./m);
  const planned = run(dir, ['receipt', 'clean'], w.env);
  assert.equal(planned.status, 3, planned.stderr);
  assert.match(planned.stdout, /^Remove 1 entry from the record of created items \(\.bowerloom\/authoring\/receipt\.json\)\n {2}skill notes {4}its files are gone\nskills\.json: removes the local entry for skill notes\nThis deletes no file and no installed copy\. Copies of these items stay where they are\.\nRevision: [a-f0-9]{64}\n/);
  const { applied } = approve(dir, ['receipt', 'clean'], w.env);
  assert.equal(applied.status, 0, applied.stderr);
  const words = run(dir, ['receipt', 'clean', '--approve', 'f'.repeat(64)], w.env);
  assert.equal(words.status, 0, 'a second run has nothing to clean and asks for nothing');
  assert.equal(words.stdout, 'Nothing to clean.\n');
  assert.doesNotMatch(run(dir, ['status'], w.env).stdout, /AUTHORING_ITEM_MISSING/);
  assert.equal(JSON.parse(readFileSync(join(dir, '.bowerloom', 'skills.json'), 'utf8')).skills.length, 0);
  assert.ok(existsSync(join(dir, '.bowerloom', 'prompts', 'brief.md')), 'the prompt that is there stays');
  // The plain result words.
  const again = bowerloomProject(w, 'again');
  mustApprove(again, ['prompt', 'create', 'brief'], w.env); rmSync(join(again, '.bowerloom', 'prompts', 'brief.md'));
  const plan = approve(again, ['receipt', 'clean'], w.env);
  assert.equal(plan.applied.status, 0); assert.equal(plan.applied.stdout, `Applied plan ${plan.body.revision}.\nRemoved 1 entry from the record of created items.\n`);
});

test('9. receipt clean --global works outside a project; with no store it refuses STORE_NOT_FOUND', t => {
  const w = world(t), outside = join(w.base, 'outside'); mkdirSync(outside);
  const none = run(outside, ['receipt', 'clean', '--global'], w.env);
  assert.equal(none.status, 1); assert.equal(errorCode(none.stderr), 'STORE_NOT_FOUND');
  assert.equal(existsSync(w.store), false, 'the check makes no store');
  // Decision D: a ~/.bowerloom with no store.json is not a store Bowerloom made.
  const foreign = world(t); mkdirSync(foreign.store, { mode: 0o700 }); writeFileSync(join(foreign.store, 'notes.md'), 'mine\n');
  const refused = run(outside, ['receipt', 'clean', '--global'], foreign.env);
  assert.equal(refused.status, 1); assert.equal(errorCode(refused.stderr), 'STORE_INVALID');
  assert.equal(existsSync(join(foreign.store, 'store.json')), false, 'no store.json is written');
  mustApprove(outside, ['skill', 'create', 'house-style', '--global'], w.env);
  mustApprove(outside, ['prompt', 'create', 'weekly', '--global'], w.env);
  assert.equal(run(outside, ['receipt', 'clean', '--global'], w.env).stdout, 'Nothing to clean.\n');
  rmSync(join(w.store, 'skills', 'house-style'), { recursive: true });
  const planned = run(outside, ['receipt', 'clean', '--global'], w.env);
  assert.equal(planned.status, 3);
  assert.match(planned.stdout, /^Remove 1 entry from the record of created items \(~\/\.bowerloom\/authoring\/receipt\.json\)$/m);
  mustApprove(outside, ['receipt', 'clean', '--global'], w.env);
  assert.deepEqual(JSON.parse(readFileSync(join(w.store, 'skills.json'), 'utf8')).skills, []);
  assert.equal(run(outside, ['receipt', 'clean', '--global', '--json'], w.env).stdout.includes('"nothingToDo":true'), true);
});

test('7 and 8 (receipt). help receipt, receipt --help and receipt clean --help print the topic; bare receipt and unknown flags are USAGE', t => {
  const w = world(t);
  for (const args of [['help', 'receipt'], ['receipt', '--help'], ['receipt', 'clean', '--help']]) {
    const r = run(w.base, args, w.env); assert.equal(r.status, 0, args.join(' ')); assert.equal(r.stdout, heading + TOPICS.receipt, args.join(' '));
  }
  for (const args of [['receipt'], ['receipt', 'purge'], ['receipt', 'clean', '--global', '--global'], ['receipt', 'clean', '--all']]) {
    const r = run(w.base, args, w.env); assert.equal(r.status, 2, args.join(' ')); assert.equal(errorCode(r.stderr), 'USAGE');
    assert.equal(errorMessage(r.stderr), 'Use bowerloom receipt clean [--global] [--approve <revision>] [--json].');
  }
});

// --- store migrate ---

const GOAL = 'Prepare a fictional onboarding kit for an independent design studio.';
const fixtures = fileURLToPath(new URL('../../packages/skill-manifest/test/fixtures/', import.meta.url));
const NPM_SPEC = 'npm:@synthetic/db-skills@0.0.1:skills/synthetic-db/collections';
const NPM_ROUTES = {
  'https://registry.npmjs.org/@synthetic/db-skills/0.0.1': join(fixtures, 'npm-db-skills', 'metadata.json'),
  'https://registry.npmjs.org/@synthetic/db-skills/-/db-skills-0.0.1.tgz': join(fixtures, 'npm-db-skills', 'archive.tgz'),
};
const revisionIn = (stdout: string): string => { const m = /^Revision: ([a-f0-9]{64})$/m.exec(stdout); assert.ok(m, stdout); return m[1]!; };
/** A beta.2 project: `up --team` on a fresh folder, every step approved until workers are held. */
function upProject(w: World, name = 'studio'): string {
  const dir = project(w, name);
  for (let i = 0; i < 8; i++) {
    const r = run(dir, ['up', '--team', 'studio', '--goal', GOAL], w.env);
    if (r.status === 4) return dir;
    assert.equal(r.status, 3, r.stderr + r.stdout);
    const done = run(dir, ['up', '--team', 'studio', '--goal', GOAL, '--approve', revisionIn(r.stdout)], w.env);
    assert.ok(done.status === 0 || done.status === 3 || done.status === 4, done.stderr + done.stdout);
  }
  return assert.fail('up did not reach exit 4');
}
/** The beta.2 project of test 1: a pinned skill from the fake npm registry, a written skill, a prompt, and a team. */
function fourItems(w: World): string {
  const dir = upProject(w), net = network(w, NPM_ROUTES);
  mustApprove(dir, ['skills', 'add', NPM_SPEC], net.env, NETWORK);
  mustApprove(dir, ['skill', 'create', 'house-style'], w.env);
  mustApprove(dir, ['prompt', 'create', 'brief'], w.env);
  mustApprove(dir, ['team', 'create', 'research'], w.env);
  // The copies are installed before the move, as in a project that is in use.
  mustApprove(dir, ['skills', 'sync'], net.env, NETWORK);
  mustApprove(dir, ['apply'], net.env, NETWORK);
  return dir;
}
const git = (cwd: string, args: string[], w: World) => { const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'init.defaultBranch=main', ...args], { cwd, encoding: 'utf8', env: { ...baseEnv(), ...w.env, GIT_CONFIG_NOSYSTEM: '1' } }); assert.equal(r.status, 0, r.stderr); return r; };
function runAsync(cwd: string, args: string[], env: Record<string, string>): Promise<{ status: number | null; stdout: string; stderr: string }> {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [cli, ...args], { cwd, env: { ...baseEnv(), ...env } });
    let stdout = '', stderr = '';
    child.stdout.on('data', d => { stdout += d; }); child.stderr.on('data', d => { stderr += d; });
    child.on('close', status => resolve({ status, stdout, stderr }));
  });
}

test('1 to 5. a beta.2 project: migrate --all plans and moves; ls, sync and apply agree; the removal lines, status, and receipt clean', t => {
  const w = world(t), dir = fourItems(w);
  // 1. The plan, then the approval.
  const planned = run(dir, ['store', 'migrate', '--all'], w.env);
  assert.equal(planned.status, 3, planned.stderr + planned.stdout);
  const text = planned.stdout;
  for (const line of [
    'Move 4 items from this project to the store at ~/.bowerloom',
    'Create the store at ~/.bowerloom (store.json). It holds definitions only.',
    '  skill synthetic-db-collections    pin copied to ~/.bowerloom/skills.json (npm @synthetic/db-skills@0.0.1)',
    '  skill house-style    copy of .bowerloom/skills/house-style (1 file)',
    '  prompt brief   copy of .bowerloom/prompts/brief.md',
    'bowerloom.json: skill house-style changes from project to store',
    'Nothing in this project is deleted. When you have checked the result, you can remove the old copies yourself:',
    '  git rm -r .bowerloom/skills/house-style', '  git rm .bowerloom/prompts/brief.md', '  git rm -r .bowerloom/teams/research',
    'Bowerloom does not edit .bowerloom/skills.json. Remove the line for skill synthetic-db-collections yourself.',
    'After you delete the old files, run bowerloom receipt clean.',
  ]) assert.ok(text.split('\n').includes(line), `${line}\n---\n${text}`);
  assert.match(text, /^ {2}team research {5}copy of \.bowerloom\/teams\/research \(\d+ files\)$/m);
  assert.match(text, /^bowerloom\.json: creates it, and lists \d+ items of this project$/m);
  assert.ok(!existsSync(w.store), 'the plan writes nothing');
  const applied = run(dir, ['store', 'migrate', '--all', '--approve', revisionIn(text)], w.env);
  assert.equal(applied.status, 0, applied.stderr);
  assert.match(applied.stdout, /^Moved 4 items to the store\.$/m);
  assert.match(applied.stdout, /^ {2}git rm -r \.bowerloom\/teams\/research$/m);
  assert.match(applied.stdout, /\nNext: bowerloom receipt clean\n$/);
  // 2. ls and ls --global.
  const ls = JSON.parse(run(dir, ['ls', '--json'], w.env).stdout) as { skills: { id: string; source: string }[]; prompts: { id: string; source: string }[]; teams: { id: string; source: string }[] };
  for (const [list, id] of [[ls.skills, 'house-style'], [ls.skills, 'synthetic-db-collections'], [ls.prompts, 'brief'], [ls.teams, 'research']] as const) assert.equal(list.find(i => i.id === id)?.source, 'store', id);
  const global = run(w.base, ['ls', '--global'], w.env).stdout;
  for (const id of ['house-style', 'synthetic-db-collections', 'brief', 'research']) assert.match(global, new RegExp(`\\b${id}\\b`));
  // 3. sync and apply: every item is up to date, because the bytes are equal.
  const net = network(w, NPM_ROUTES);
  const sync = run(dir, ['skills', 'sync'], net.env, NETWORK);
  assert.ok(sync.status === 0 || sync.status === 3, sync.stderr);
  assert.doesNotMatch(sync.stdout, /\binstall\b|\bupdate\b(?! to date)/, sync.stdout);
  const apply = run(dir, ['apply'], net.env, NETWORK);
  assert.ok(apply.status === 0 || apply.status === 3, apply.stderr);
  for (const id of ['house-style', 'synthetic-db-collections', 'brief']) assert.match(apply.stdout, new RegExp(`^ {2}${id} +up to date {2}\\[store\\]$`, 'm'), id);
  assert.match(apply.stdout, /\nNothing to change\.\n$/);
  // 4. git, the printed removal lines, the skills.json line, then status.
  git(dir, ['init', '-q'], w); git(dir, ['add', '-A'], w); git(dir, ['commit', '-q', '-m', 'base'], w);
  for (const line of applied.stdout.split('\n').filter(l => l.startsWith('  git rm '))) git(dir, line.trim().split(' ').slice(1), w);
  const manifestFile = join(dir, '.bowerloom', 'skills.json'), manifest = JSON.parse(readFileSync(manifestFile, 'utf8'));
  manifest.skills = manifest.skills.filter((s: { id: string }) => s.id !== 'synthetic-db-collections');
  writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
  const status = run(dir, ['status'], w.env).stdout;
  for (const [kind, id] of [['skill', 'house-style'], ['prompt', 'brief'], ['team', 'research']]) assert.equal(status.split('\n').filter(l => l.startsWith(`  ${kind} ${id}: held (AUTHORING_ITEM_MISSING)`)).length, 1, `${kind} ${id}\n${status}`);
  // 5. receipt clean shows its plan, exits 3, applies, and status no longer names the items.
  const clean = run(dir, ['receipt', 'clean'], w.env);
  assert.equal(clean.status, 3, clean.stderr); assert.match(clean.stdout, /^Remove 3 entries from the record of created items/m);
  assert.match(clean.stdout, /^skills\.json: removes the local entry for skill house-style$/m);
  assert.doesNotMatch(clean.stdout, /^bowerloom\.json: removes/m, 'store entries stay in bowerloom.json');
  mustApprove(dir, ['receipt', 'clean'], w.env);
  assert.doesNotMatch(run(dir, ['status'], w.env).stdout, /AUTHORING_ITEM_MISSING/);
});

test('6. a shared project: the first run copies and prints Not switched; after the push the items switch and the lock is exact', t => {
  const w = world(t), dir = fourItems(w); shared(dir);
  const plan = run(dir, ['store', 'migrate', '--all'], w.env);
  assert.equal(plan.status, 3, plan.stderr);
  assert.match(plan.stdout, /^Not switched: prompt brief cannot be locked yet\. It is new in your store and not pushed yet\. Push the store, then run this command again\.$/m);
  assert.match(plan.stdout, /^bowerloom\.lock\.json: adds skill synthetic-db-collections \(npm @synthetic\/db-skills@0\.0\.1\)$/m);
  const first = approve(dir, ['store', 'migrate', '--all'], w.env);
  assert.equal(first.applied.status, 0, first.applied.stderr);
  // Review M2: the result counts only what switched, and names the copies apart.
  assert.match(first.applied.stdout, /^Moved 1 item to the store\.$/m);
  assert.match(first.applied.stdout, /^Copied but not switched: skill house-style, prompt brief, team research\.$/m);
  assert.match(first.applied.stdout, /^Push the store, then run bowerloom store migrate again to switch them\.$/m);
  // The next run: the copies are present, and the store has no git repository yet.
  const repoRun = run(dir, ['store', 'migrate', '--all'], w.env);
  assert.equal(repoRun.status, 0, 'present items with no store .git change nothing');
  assert.match(repoRun.stdout, /^Not switched: skill house-style cannot be locked yet\. The store is not a git repository\. Push the store, then run this command again\.$/m);
  assert.match(repoRun.stdout, /\nNothing to change\.\n$/);
  const repo = pushStore(w), net = network(w, repo.routes);
  const second = approve(dir, ['store', 'migrate', '--all'], net.env, NETWORK);
  assert.equal(second.applied.status, 0, second.applied.stderr + second.applied.stdout);
  assert.deepEqual(loggedHosts(net.log), ['api.github.com']);
  const lockText = readFileSync(join(dir, 'bowerloom.lock.json'), 'utf8'), lock = parseLock(Buffer.from(lockText));
  assert.equal(serializeLock(lock), lockText, 'the exact serialization');
  assert.deepEqual(lock.skills.map(i => [i.id, 'pin' in i ? 'pin' : i.authored.commit]), [['house-style', STORE_COMMIT], ['synthetic-db-collections', 'pin']]);
  assert.deepEqual(lock.prompts.map(i => i.id), ['brief']); assert.deepEqual(lock.teams.map(i => i.id), ['research']);
  assert.equal(run(dir, ['lock', 'verify'], w.env).status, 0);
  assert.equal(JSON.parse(readFileSync(join(dir, 'bowerloom.json'), 'utf8')).teams.find((e: { id: string }) => e.id === 'research').source, 'store');
  // Review C3 (test 13 in words): a lock that lacks a store entry, then --all: the stale-lock line, the old copies, and nothing to move.
  const lockFile = join(dir, 'bowerloom.lock.json');
  writeFileSync(lockFile, serializeLock({ ...lock, prompts: [] }));
  const stale = run(dir, ['store', 'migrate', '--all'], w.env);
  assert.equal(stale.status, 0, stale.stderr);
  assert.match(stale.stdout, /^ {2}prompt brief {3}already listed from the store; its old copy is still in this project\.$/m);
  assert.match(stale.stdout, /^The lock is out of date for prompt brief\. Run bowerloom lock update\.$/m);
  assert.match(stale.stdout, /^ {2}git rm \.bowerloom\/prompts\/brief\.md$/m);
  assert.match(stale.stdout, /\nNothing to move\.\n$/);
});

test('7. help store and help receipt print the topics; store migrate --help prints the store topic', t => {
  const w = world(t);
  for (const args of [['help', 'store'], ['store', '--help'], ['store', 'migrate', '--help']]) { const r = run(w.base, args, w.env); assert.equal(r.status, 0, args.join(' ')); assert.equal(r.stdout, heading + TOPICS.store, args.join(' ')); }
  assert.match(TOPICS.store!, /^ {2}bowerloom store migrate \[--skill <id>\]\.\.\. \[--prompt <id>\]\.\.\. \[--team <id>\]\.\.\. \[--all\] \[--commit <sha>\] \[--approve <revision>\] \[--json\]\n {2}bowerloom receipt clean \[--global\] \[--approve <revision>\] \[--json\]\n\n/m);
  assert.match(TOPICS.store!, /\nAdd --json for one machine-readable object\.\n\nstore migrate copies skills, prompts, and teams from this project/);
  assert.match(TOPICS.store!, /^store status reads only and writes nothing\. No store command starts workers\.$/m);
});

test('8. error paths: no selector and --all with a selector exit 2; bare store is USAGE; reserved names and missing items refuse', t => {
  const w = world(t), dir = bowerloomProject(w);
  for (const args of [['store', 'migrate'], ['store', 'migrate', '--all', '--skill', 'x'], ['store', 'migrate', '--skill', 'x', '--skill', 'x'], ['store', 'migrate', '--all', '--commit', 'abc']]) {
    const r = run(dir, args, w.env); assert.equal(r.status, 2, args.join(' ')); assert.equal(errorCode(r.stderr), 'USAGE');
  }
  const flag = run(dir, ['store', 'migrate', '--all', '--frobnicate'], w.env);
  assert.equal(flag.status, 2); assert.equal(errorMessage(flag.stderr), 'Use bowerloom store migrate [--skill <id>]... [--prompt <id>]... [--team <id>]... [--all], with optional --commit <sha>, --approve <revision> and --json.');
  const bare = run(dir, ['store'], w.env);
  assert.equal(bare.status, 2); assert.equal(errorMessage(bare.stderr), 'Use bowerloom store status [--json] or bowerloom store migrate. See bowerloom help store.');
  for (const [args, code] of [[['--team', 'first-team'], 'MIGRATE_RESERVED'], [['--skill', 'personal-assistant'], 'MIGRATE_RESERVED'], [['--skill', 'nope'], 'MIGRATE_ITEM_NOT_FOUND']] as const) {
    const r = run(dir, ['store', 'migrate', ...args], w.env); assert.equal(r.status, 1, args.join(' ')); assert.equal(errorCode(r.stderr), code);
  }
  const words = run(dir, ['store', 'migrate', '--all'], w.env);
  assert.equal(words.status, 0); assert.equal(words.stdout, 'Nothing to move.\n');
  const outside = join(w.base, 'outside'); mkdirSync(outside);
  assert.equal(errorCode(run(outside, ['store', 'migrate', '--all'], w.env).stderr), 'PROJECT_NOT_FOUND');
});

test('10. two store migrate runs at once: the second refuses STORE_LOCKED; after the first, its old plan is STALE_APPROVAL', async t => {
  const w = world(t), dir = bowerloomProject(w);
  mustApprove(dir, ['prompt', 'create', 'notes'], w.env);
  // The store exists before the plan, so holding its lock changes nothing the plan read.
  mustApprove(w.base, ['prompt', 'create', 'seed', '--global'], w.env);
  const first = run(dir, ['store', 'migrate', '--prompt', 'notes', '--json'], w.env);
  const revision = (JSON.parse(first.stdout) as { revision: string }).revision;
  // The store lock is held by another command while this one applies.
  const held = await withStoreForWrite(w.home, new AbortController().signal, async () => runAsync(dir, ['store', 'migrate', '--prompt', 'notes', '--approve', revision], w.env));
  assert.equal(held.status, 1, held.stderr); assert.equal(errorCode(held.stderr), 'STORE_LOCKED');
  // Another migrate finishes first: the plan made before it is stale.
  const second = run(dir, ['store', 'migrate', '--prompt', 'notes', '--json'], w.env), rev2 = (JSON.parse(second.stdout) as { revision: string }).revision;
  mustApprove(w.base, ['prompt', 'create', 'weekly', '--global'], w.env);
  const stale = run(dir, ['store', 'migrate', '--prompt', 'notes', '--approve', rev2], w.env);
  assert.equal(stale.status, 1); assert.equal(errorCode(stale.stderr), 'STALE_APPROVAL');
});

test('11. while another command holds the project lock, store migrate --approve refuses PROJECT_LOCKED, not STORE_LOCKED', async t => {
  const w = world(t), dir = bowerloomProject(w);
  mustApprove(dir, ['prompt', 'create', 'brief'], w.env);
  const revision = (JSON.parse(run(dir, ['store', 'migrate', '--prompt', 'brief', '--json'], w.env).stdout) as { revision: string }).revision;
  const before = snapshot(dir);
  const r = await withProjectLock(dir, new AbortController().signal, async () => runAsync(dir, ['store', 'migrate', '--prompt', 'brief', '--approve', revision], w.env));
  assert.equal(r.status, 1, r.stderr); assert.equal(errorCode(r.stderr), 'PROJECT_LOCKED');
  // Review L3: the store lock came first and made the store, and the words say so.
  assert.match(errorMessage(r.stderr), /Bowerloom made the store at ~\/\.bowerloom before it waited for the project\. Run the command again without --approve to see the next plan\.$/);
  assert.deepEqual(snapshot(dir), before, 'nothing in the project changed: no bowerloom.json, no lock, and .bowerloom as it was');
  // The store lock came first, so the store was made; with the lock free again, a new plan applies.
  mustApprove(dir, ['store', 'migrate', '--prompt', 'brief'], w.env);
  assert.equal(JSON.parse(readFileSync(join(dir, 'bowerloom.json'), 'utf8')).prompts[0].source, 'store');
});

test('9b. a team with agents prints the agents line; a plan with nothing to change says so and asks nothing', t => {
  const w = world(t), dir = bowerloomProject(w);
  writeFileSync(join(dir, 'bowerloom.json'), `${JSON.stringify({ format: 'bowerloom/project/v1beta1', harnesses: ['claude', 'codex'], skills: [], prompts: [], teams: [] }, null, 2)}\n`);
  mustApprove(dir, ['team', 'create', 'research'], w.env);
  mkdirSync(join(dir, '.bowerloom', 'teams', 'research', 'agents')); writeFileSync(join(dir, '.bowerloom', 'teams', 'research', 'agents', 'lead.md'), '---\nname: lead\ndescription: Leads.\n---\nLead.\n');
  const r = run(dir, ['store', 'migrate', '--team', 'research'], w.env);
  assert.equal(r.status, 3, r.stderr);
  assert.match(r.stdout, /^ {2}team research {5}its agents stop being projected\. A store team projects no agents in this beta\. Copies in \.claude\/agents stay\.$/m);
  assert.match(r.stdout, /^bowerloom\.json: team research changes from project to store$/m);
});
