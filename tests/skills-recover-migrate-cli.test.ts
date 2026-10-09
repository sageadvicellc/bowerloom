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
import { planSync, applySync } from '../packages/project-sync/src/index.js';
import { planObservedManagedSkill } from '../packages/managed-skills/src/observed.js';
import { applyObservedManagedSkill } from '../packages/managed-skills/src/transaction.js';
import { serializeManifest, validateManifest } from '../packages/skill-manifest/src/schema.js';
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
function writeManifest(dir: string, skills: unknown[]) { const file = join(dir, '.bowerloom/skills.json'); fs.writeFileSync(file, serializeManifest(validateManifest({ format: 'bowerloom/skills/v1beta1', harnesses: ['claude', 'codex'], skills }))); fs.chmodSync(file, 0o644); }
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
  const input = { project: discoverProject(p.dir, p.home), stateRoot: p.stateRoot, team: null, offline: false };
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
  assert.match(sync.stdout, /^ {2}bravo +up to date$/m); assert.match(sync.stdout, /^ {2}charlie +install +your skill/m);
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
