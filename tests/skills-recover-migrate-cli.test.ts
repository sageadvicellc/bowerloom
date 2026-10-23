import test from './support/lock-slot-retry.js';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { TestContext } from 'node:test';
import { discoverProject, privateStateRoot } from '../packages/project-context/src/index.js';
import { planSync, applySync, planMigrate, applyMigrate } from '../packages/project-sync/src/index.js';
import { planObservedManagedSkill } from '../packages/managed-skills/src/observed.js';
import { applyObservedManagedSkill } from '../packages/managed-skills/src/transaction.js';
import { serializeManifest, validateManifest, MANIFEST_LIMITS } from '../packages/skill-manifest/src/schema.js';
import { npmPackage, cachePackage } from './support/sync-packages.js';

const cli = fileURLToPath(new URL('../apps/cli/src/main.js', import.meta.url));
const preload = pathToFileURL(fileURLToPath(new URL('./support/fake-network.js', import.meta.url))).href;
const MARKER = '.bowerloom/managed-pending.json';

/** A project with only `.bowerloom/` (sync needs no init), HOME as its parent, and the network denied to the CLI. */
function project(t: TestContext) {
  const home = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), 'bowerloom-recover-migrate-'))); t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const dir = join(home, 'studio'); fs.mkdirSync(join(dir, '.bowerloom'), { recursive: true, mode: 0o755 });
  const log = join(home, 'network.log'), planFile = join(home, 'network.json'); fs.writeFileSync(planFile, JSON.stringify({ log })); fs.writeFileSync(log, '');
  const env = { HOME: home, XDG_STATE_HOME: join(home, 'state'), TEST_FAKE_NETWORK_PLAN: planFile };
  return { home, dir, env, stateRoot: privateStateRoot(env, home), calls: () => fs.readFileSync(log, 'utf8').split('\n').filter(Boolean) };
}
function run(p: ReturnType<typeof project>, args: string[]) {
  const r = spawnSync(process.execPath, ['--import', preload, cli, ...args], { cwd: p.dir, encoding: 'utf8', timeout: 120000, env: { ...process.env, ...p.env } });
  assert.equal(r.error, undefined); return r;
}
function writeManifest(dir: string, skills: unknown[]) { const file = join(dir, '.bowerloom/skills.json'); fs.writeFileSync(file, serializeManifest(validateManifest({ format: 'bowerloom/skills/v1beta1', harnesses: ['claude', 'codex'], skills }, MANIFEST_LIMITS), MANIFEST_LIMITS)); fs.chmodSync(file, 0o644); }
function localSkill(dir: string, id: string) { const root = join(dir, '.bowerloom/skills', id); fs.mkdirSync(root, { recursive: true, mode: 0o755 }); fs.writeFileSync(join(root, 'SKILL.md'), `---\nname: ${id}\ndescription: Authored.\n---\nBe plain.\n`, { mode: 0o644 }); }
const errorOf = (stderr: string) => (JSON.parse(stderr) as { error: { code: string; message: string } }).error;
const revisionIn = (stdout: string): string => { const m = /^Revision: ([a-f0-9]{64})$/m.exec(stdout); assert.ok(m, stdout); return m[1]!; };
function exact(dir: string): string {
  const rows: unknown[] = [];
  const visit = (p: string) => { const s = fs.lstatSync(p, { bigint: true }); rows.push([p.slice(dir.length), String(s.ino), String(s.mtimeNs), s.isFile() ? createHash('sha256').update(fs.readFileSync(p)).digest('hex') : 'dir']); if (s.isDirectory()) for (const n of fs.readdirSync(p).sort()) visit(join(p, n)); };
  visit(dir); return JSON.stringify(rows);
}

test('skills recover --item: plan shows the recovery (exit 3), apply finishes the interrupted skill, then sync goes on', async t => {
  const p = project(t); for (const id of ['alpha', 'bravo', 'charlie']) localSkill(p.dir, id);
  writeManifest(p.dir, ['alpha', 'bravo', 'charlie'].map(id => ({ id, source: { kind: 'local', path: 'skills/' + id } })));
  const input = { project: discoverProject(p.dir, p.home), stateRoot: p.stateRoot, team: null, offline: false, home: p.home };
  const rename = fs.renameSync, target = join(p.dir, '.agents/skills/bravo');
  t.mock.method(fs, 'renameSync', (from: fs.PathLike, to: fs.PathLike) => { if (String(to) === target) throw Object.assign(new Error('injected'), { code: 'EIO' }); return rename(from, to); }); syncBuiltinESMExports();
  await assert.rejects(applySync(input, (await planSync(input)).revision, { acquirer: { npm: async () => { throw new Error('no'); }, git: async () => { throw new Error('no'); } }, signal: new AbortController().signal }),
    (e: { code?: string }) => e.code === 'MANAGED_SKILL_RECOVERY_REQUIRED');
  t.mock.restoreAll(); syncBuiltinESMExports(); assert.ok(fs.existsSync(join(p.dir, MARKER)));

  const blocked = run(p, ['skills', 'sync']); assert.equal(blocked.status, 1); assert.equal(errorOf(blocked.stderr).code, 'MANAGED_SKILL_RECOVERY_REQUIRED'); assert.match(errorOf(blocked.stderr).message, /--item bravo/);
  assert.equal(run(p, ['skills', 'recover', 'plan', '--item', 'bravo', '--approve', 'a'.repeat(64)]).status, 2);
  const other = run(p, ['skills', 'recover', 'plan', '--item', 'alpha']); assert.equal(other.status, 1);
  assert.equal(errorOf(other.stderr).code, 'MANAGED_SKILL_RECOVERY_REQUIRED'); assert.match(errorOf(other.stderr).message, /--item bravo/);
  const shown = run(p, ['skills', 'recover', 'plan', '--item', 'bravo']);
  assert.equal(shown.status, 3, shown.stderr); assert.match(shown.stdout, /^Recover bravo: resume its unfinished operation [a-f0-9]{12}$/m);
  const applied = run(p, ['skills', 'recover', 'apply', '--item', 'bravo', '--approve', revisionIn(shown.stdout)]);
  assert.equal(applied.status, 0, applied.stderr); assert.equal(fs.existsSync(join(p.dir, MARKER)), false);
  assert.ok(fs.existsSync(join(p.dir, '.agents/skills/bravo/SKILL.md')));
  const nothing = run(p, ['skills', 'recover', 'plan', '--item', 'alpha']); assert.equal(nothing.status, 1); assert.equal(errorOf(nothing.stderr).code, 'SKILLS_RECOVER_NOTHING');
  const sync = run(p, ['skills', 'sync']); assert.equal(sync.status, 3, sync.stderr);
  assert.match(sync.stdout, /^ {2}bravo +up to date {2}\[project\]$/m); assert.match(sync.stdout, /^ {2}charlie +install +your skill/m);
  assert.deepEqual(p.calls(), []);
});

test('skills migrate: refuses with the exact skills add command, then plans (exit 3) and moves the v1 install to v2', async t => {
  const p = project(t), pkg = npmPackage('alpha'), v1State = join(p.home, 'v1-state'), v1Cache = join(p.home, 'v1-cache');
  fs.mkdirSync(v1State, { mode: 0o700 }); fs.mkdirSync(v1Cache, { mode: 0o700 });
  const selector = await cachePackage(v1Cache, pkg);
  const v1 = { operation: 'install', projectDir: p.dir, stateDir: v1State, harness: 'codex', cache: selector, expectedPreviousRevision: null, minFreeBytes: 33554432 };
  const v1Plan = await planObservedManagedSkill(v1) as { revision: string }; await applyObservedManagedSkill(v1, v1Plan.revision, null);
  const v1Before = exact(v1State);

  const missing = run(p, ['skills', 'migrate', 'plan', '--state', v1State]); assert.equal(missing.status, 1);
  assert.equal(errorOf(missing.stderr).code, 'SKILLS_MIGRATE_NOT_IN_MANIFEST');
  assert.match(errorOf(missing.stderr).message, /bowerloom skills add npm:@synthetic\/alpha@1\.0\.0:skills\/alpha --id alpha/);
  writeManifest(p.dir, [pkg.entry]);
  const legacy = run(p, ['skills', 'sync']); assert.equal(legacy.status, 1); assert.equal(errorOf(legacy.stderr).code, 'MANAGED_SKILL_LEGACY_PRESENT');
  const status = run(p, ['status', '--json']); assert.equal(status.status, 0, status.stderr); assert.deepEqual(JSON.parse(status.stdout).legacy, { present: true, next: 'bowerloom skills migrate plan --state <earlier-state-folder>' });
  assert.equal(run(p, ['skills', 'migrate', 'plan', '--state', 'relative/dir']).status, 2);
  const shown = run(p, ['skills', 'migrate', 'plan', '--state', v1State]);
  assert.equal(shown.status, 3, shown.stderr); assert.match(shown.stdout, /^Migrate skill alpha from the earlier install/m); assert.match(shown.stdout, /Bytes from: the cache the earlier install read/);
  const applied = run(p, ['skills', 'migrate', 'apply', '--state', v1State, '--approve', revisionIn(shown.stdout)]);
  assert.equal(applied.status, 0, applied.stderr);
  assert.equal(fs.existsSync(join(p.dir, '.bowerloom-skills')), false);
  for (const root of ['.claude/skills', '.agents/skills']) assert.ok(fs.existsSync(join(p.dir, root, 'synthetic-alpha/SKILL.md')), root);
  assert.equal(exact(v1State), v1Before); assert.equal(JSON.parse(run(p, ['status', '--json']).stdout).legacy, undefined);
  const sync = run(p, ['skills', 'sync']); assert.equal(sync.status, 0, sync.stderr); assert.match(sync.stdout, /Nothing to change\./);
  const again = run(p, ['skills', 'migrate', 'plan', '--state', v1State]); assert.equal(again.status, 1); assert.equal(errorOf(again.stderr).code, 'SKILLS_MIGRATE_NOTHING');
  assert.deepEqual(p.calls(), []);
});

// Round 7 of the reviews of PR 101, item 1 (variant A, because bowerloom/skills-migrate-plan/v1beta1 shipped in beta.2):
// a migrate plan binds its cache operation and folders, so a fetch that fails changes the plan. The step names the plan
// command with its --state, and following it applies.
/** A v1 install of alpha whose v1 cache is gone, so skills migrate must fetch; the project pins alpha in skills.json. */
async function legacyInstall(p: ReturnType<typeof project>, stateName: string) {
  const pkg = npmPackage('alpha'), v1State = join(p.home, stateName), v1Cache = join(p.home, 'v1-cache');
  fs.mkdirSync(v1State, { mode: 0o700 }); fs.mkdirSync(v1Cache, { mode: 0o700 });
  const selector = await cachePackage(v1Cache, pkg);
  const v1 = { operation: 'install', projectDir: p.dir, stateDir: v1State, harness: 'codex', cache: selector, expectedPreviousRevision: null, minFreeBytes: 33554432 };
  const v1Plan = await planObservedManagedSkill(v1) as { revision: string }; await applyObservedManagedSkill(v1, v1Plan.revision, null);
  writeManifest(p.dir, [pkg.entry]);
  fs.rmSync(v1Cache, { recursive: true, force: true });
  return { pkg, v1State };
}
/** Points the fake network at the registry files of `pkg`, or at `override` routes on top of them. */
function online(p: ReturnType<typeof project>, pkg: ReturnType<typeof npmPackage>, override: Record<string, unknown> = {}) {
  const files = join(p.home, 'npm'); fs.mkdirSync(files, { recursive: true });
  fs.writeFileSync(join(files, 'meta.json'), pkg.metadata); fs.writeFileSync(join(files, 'alpha.tgz'), pkg.archive);
  const routes = { 'https://registry.npmjs.org/@synthetic/alpha/1.0.0': join(files, 'meta.json'), 'https://registry.npmjs.org/@synthetic/alpha/-/alpha-1.0.0.tgz': join(files, 'alpha.tgz'), ...override };
  fs.writeFileSync(join(p.home, 'network.json'), JSON.stringify({ log: join(p.home, 'network.log'), routes }));
}
const nextIn = (stderr: string): string | undefined => (JSON.parse(stderr) as { error: { next?: string } }).error.next;

test('skills migrate apply with no network: the step names migrate plan, and a new plan then applies', async t => {
  const p = project(t), { pkg, v1State } = await legacyInstall(p, 'v1-state');
  const shown = run(p, ['skills', 'migrate', 'plan', '--state', v1State]);
  assert.equal(shown.status, 3, shown.stderr); assert.match(shown.stdout, /registry\.npmjs\.org/);
  const failed = run(p, ['skills', 'migrate', 'apply', '--state', v1State, '--approve', revisionIn(shown.stdout), '--json']);
  assert.equal(errorOf(failed.stderr).code, 'SKILLS_OFFLINE', failed.stderr);
  assert.equal((JSON.parse(failed.stderr) as { error: { next?: string } }).error.next, `Connect to the network, then run bowerloom skills migrate plan --state ${v1State} to see a new plan.`);
  // Online again: the step's plan command, then its revision.
  online(p, pkg);
  const replanned = run(p, ['skills', 'migrate', 'plan', '--state', v1State]);
  assert.equal(replanned.status, 3, replanned.stderr);
  const applied = run(p, ['skills', 'migrate', 'apply', '--state', v1State, '--approve', revisionIn(replanned.stdout)]);
  assert.equal(applied.status, 0, applied.stderr);
});

// Round 8 of the reviews of PR 101, item 2: a state path with a space is quoted for a shell, so the printed step runs as it is.
test('skills migrate apply: a state path with a space prints a quoted plan command, and that command, pasted, runs', async t => {
  const p = project(t), { pkg, v1State } = await legacyInstall(p, "v1 state's copy");
  const shown = run(p, ['skills', 'migrate', 'plan', '--state', v1State]); assert.equal(shown.status, 3, shown.stderr);
  const failed = run(p, ['skills', 'migrate', 'apply', '--state', v1State, '--approve', revisionIn(shown.stdout), '--json']);
  assert.equal(errorOf(failed.stderr).code, 'SKILLS_OFFLINE', failed.stderr);
  const quoted = `'${v1State.replaceAll("'", "'\\''")}'`;
  assert.equal(nextIn(failed.stderr), `Connect to the network, then run bowerloom skills migrate plan --state ${quoted} to see a new plan.`);
  const command = /run (bowerloom skills migrate plan --state .+) to see a new plan\.$/.exec(nextIn(failed.stderr)!)![1]!;
  // The person pastes the command into a shell that finds bowerloom on PATH.
  const bin = join(p.home, 'bin'); fs.mkdirSync(bin);
  fs.writeFileSync(join(bin, 'bowerloom'), `#!/bin/sh\nexec "${process.execPath}" --import "${preload}" "${cli}" "$@"\n`, { mode: 0o755 });
  online(p, pkg);
  const pasted = spawnSync('/bin/sh', ['-c', command], { cwd: p.dir, encoding: 'utf8', timeout: 120000, env: { ...process.env, ...p.env, PATH: `${bin}:${process.env.PATH ?? ''}` } });
  assert.equal(pasted.status, 3, pasted.stderr);
  const applied = run(p, ['skills', 'migrate', 'apply', '--state', v1State, '--approve', revisionIn(pasted.stdout)]);
  assert.equal(applied.status, 0, applied.stderr);
});

// Round 8, item 1: each failed fetch keeps one of the 8 operation ids of the pin. A migrate plan binds one of them, so
// after the prune the step plans again, and following it lifts the refusal.
test('skills migrate apply after 8 failed fetches: the step prunes, then plans again, and following it applies', async t => {
  const p = project(t), { pkg, v1State } = await legacyInstall(p, 'v1-state');
  online(p, pkg, { 'https://registry.npmjs.org/@synthetic/alpha/1.0.0': { status: 500, file: null } });
  const first = revisionIn(run(p, ['skills', 'migrate', 'plan', '--state', v1State]).stdout);
  for (let i = 0; i < 8; i++) {
    const shown = run(p, ['skills', 'migrate', 'plan', '--state', v1State]); assert.equal(shown.status, 3, `plan ${i + 1}: ${shown.stderr}`);
    const failed = run(p, ['skills', 'migrate', 'apply', '--state', v1State, '--approve', revisionIn(shown.stdout), '--json']);
    assert.equal(errorOf(failed.stderr).code, 'SKILLS_OFFLINE', `failure ${i + 1}`);
  }
  // Round 9: skills migrate plan itself keeps "run the command again", which is that plan command.
  const planFull = run(p, ['skills', 'migrate', 'plan', '--state', v1State, '--json']);
  assert.equal(errorOf(planFull.stderr).code, 'SKILLS_CACHE_RECOVERY_REQUIRED', planFull.stderr);
  assert.equal(nextIn(planFull.stderr), 'Run bowerloom cache prune --partial to delete the unfinished fetches, then run the command again.');
  const full = run(p, ['skills', 'migrate', 'apply', '--state', v1State, '--approve', first, '--json']);
  assert.equal(errorOf(full.stderr).code, 'SKILLS_CACHE_RECOVERY_REQUIRED', full.stderr);
  assert.equal(nextIn(full.stderr), `Run bowerloom cache prune --partial to delete the unfinished fetches, then run bowerloom skills migrate plan --state ${v1State} to see a new plan.`);
  assert.doesNotMatch(full.stderr, /skills sync/);
  const prune = JSON.parse(run(p, ['cache', 'prune', '--partial', '--json']).stdout) as { revision: string };
  assert.equal(run(p, ['cache', 'prune', '--partial', '--approve', prune.revision]).status, 0);
  online(p, pkg);
  const replanned = run(p, ['skills', 'migrate', 'plan', '--state', v1State]); assert.equal(replanned.status, 3, replanned.stderr);
  const applied = run(p, ['skills', 'migrate', 'apply', '--state', v1State, '--approve', revisionIn(replanned.stdout)]);
  assert.equal(applied.status, 0, applied.stderr);
});

// Round 9 of the reviews of PR 101, item 3: a skills migrate plan binds every folder it creates, so a folder failure after
// it made one names the migrate plan command, not "run the command again without --approve".
test('skills migrate apply: a private folder that fails after another was made names migrate plan, and following it applies', async t => {
  const p = project(t), { pkg, v1State } = await legacyInstall(p, 'v1-state');
  const input = { project: discoverProject(p.dir, p.home), stateRoot: p.stateRoot, legacyStateDir: v1State };
  const plan = await planMigrate(input), last = plan.privateState.create.at(-1)!;
  assert.ok(plan.privateState.create.length > 1, 'the plan makes more than one folder');
  const real = fs.mkdirSync, never = async () => { throw new Error('no fetch in this test'); };
  (fs as { mkdirSync: unknown }).mkdirSync = (dir: fs.PathLike, ...rest: unknown[]) => {
    if (dir === last) throw Object.assign(new Error('ENOSPC'), { code: 'ENOSPC', errno: -28, syscall: 'mkdir' });
    return (real as (...a: unknown[]) => unknown)(dir, ...rest);
  };
  try {
    await assert.rejects(applyMigrate(input, plan.revision, { acquirer: { npm: never, git: never } as never, signal: new AbortController().signal }),
      (e: Error & { code?: string; next?: string }) => e.code === 'SKILLS_STATE_UNSAFE' && e.message.includes('(ENOSPC)')
        && e.next === `Check the private state folder: $XDG_STATE_HOME/bowerloom when XDG_STATE_HOME is set, else ~/.local/state/bowerloom. Then run bowerloom skills migrate plan --state ${v1State} to see a new plan.`);
  } finally { (fs as { mkdirSync: unknown }).mkdirSync = real; }
  // The plan changed, so the same --approve is stale; the step's plan command, then its revision, applies.
  online(p, pkg);
  const stale = run(p, ['skills', 'migrate', 'apply', '--state', v1State, '--approve', plan.revision, '--json']);
  assert.equal(errorOf(stale.stderr).code, 'STALE_APPROVAL', stale.stderr);
  const replanned = run(p, ['skills', 'migrate', 'plan', '--state', v1State]); assert.equal(replanned.status, 3, replanned.stderr);
  assert.equal(run(p, ['skills', 'migrate', 'apply', '--state', v1State, '--approve', revisionIn(replanned.stdout)]).status, 0);
});
