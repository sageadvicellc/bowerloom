// Review of e1bbce9 (CR3, L2, M4): skills migrate refuses by name when skills.json lists an engine with no writer, and a
// damaged engine id in the earlier install's catalog is a coded refusal, never a TypeError.
import test from './support/lock-slot-retry.js';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { TestContext } from 'node:test';
import { privateStateRoot } from '../packages/project-context/src/index.js';
import { planObservedManagedSkill } from '../packages/managed-skills/src/observed.js';
import { applyObservedManagedSkill } from '../packages/managed-skills/src/transaction.js';
import { npmPackage, cachePackage } from './support/sync-packages.js';

const cli = fileURLToPath(new URL('../apps/cli/src/main.js', import.meta.url));
const preload = pathToFileURL(fileURLToPath(new URL('./support/fake-network.js', import.meta.url))).href;

function project(t: TestContext) {
  const home = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), 'bowerloom-engine-migrate-'))); t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const dir = join(home, 'studio'); fs.mkdirSync(join(dir, '.bowerloom'), { recursive: true, mode: 0o755 });
  const log = join(home, 'network.log'), planFile = join(home, 'network.json'); fs.writeFileSync(planFile, JSON.stringify({ log })); fs.writeFileSync(log, '');
  const env = { HOME: home, XDG_STATE_HOME: join(home, 'state'), TEST_FAKE_NETWORK_PLAN: planFile };
  return { home, dir, env, stateRoot: privateStateRoot(env, home) };
}
function run(p: ReturnType<typeof project>, args: string[]) {
  const r = spawnSync(process.execPath, ['--import', preload, cli, ...args], { cwd: p.dir, encoding: 'utf8', timeout: 120000, env: { ...process.env, ...p.env } });
  assert.equal(r.error, undefined); return r;
}
const errorOf = (stderr: string) => (JSON.parse(stderr) as { error: { code: string; message: string } }).error;
const manifestText = (engines: unknown, skills: unknown[]) => `${JSON.stringify({ format: 'bowerloom/skills/v1beta1', engines, skills }, null, 2)}\n`;

/** A v1 install of alpha, and a skills.json that pins it. */
async function legacyInstall(p: ReturnType<typeof project>, engines: string[]) {
  const pkg = npmPackage('alpha'), v1State = join(p.home, 'v1-state'), v1Cache = join(p.home, 'v1-cache');
  fs.mkdirSync(v1State, { mode: 0o700 }); fs.mkdirSync(v1Cache, { mode: 0o700 });
  const selector = await cachePackage(v1Cache, pkg);
  const v1 = { operation: 'install', projectDir: p.dir, stateDir: v1State, harness: 'codex', cache: selector, expectedPreviousRevision: null, minFreeBytes: 33554432 };
  const v1Plan = await planObservedManagedSkill(v1) as { revision: string }; await applyObservedManagedSkill(v1, v1Plan.revision, null);
  fs.writeFileSync(join(p.dir, '.bowerloom/skills.json'), manifestText(engines, [pkg.entry]), { mode: 0o644 });
  return { pkg, v1State };
}

test('CR3. skills migrate plan refuses by name when skills.json lists an engine with no writer', async t => {
  const p = project(t), { v1State } = await legacyInstall(p, ['claude-code', 'pi']);
  const before = fs.readFileSync(join(p.dir, '.bowerloom/skills.json'), 'utf8');
  const r = run(p, ['skills', 'migrate', 'plan', '--state', v1State, '--json']);
  assert.notEqual(r.status, 0); assert.deepEqual(errorOf(r.stderr), { code: 'ENGINE_NO_WRITER', message: 'no writer for engine pi yet' });
  assert.equal(fs.readFileSync(join(p.dir, '.bowerloom/skills.json'), 'utf8'), before);
});

test('L2 and M4. an engine id that is not claude or codex in the earlier install is a coded refusal, not a TypeError', async t => {
  const p = project(t), { v1State } = await legacyInstall(p, ['claude-code', 'codex']);
  const catalog = join(p.dir, '.bowerloom-skills', 'catalog.json'), c = JSON.parse(fs.readFileSync(catalog, 'utf8')) as Record<string, unknown>;
  fs.writeFileSync(catalog, JSON.stringify({ ...c, harness: 'hermes' }));
  const r = run(p, ['skills', 'migrate', 'plan', '--state', v1State, '--json']);
  assert.notEqual(r.status, 0, r.stdout);
  const e = errorOf(r.stderr);
  assert.equal(e.code, 'SKILLS_MIGRATE_STATE_INVALID'); assert.doesNotMatch(r.stderr, /TypeError/);
  assert.match(e.message, /\.bowerloom-skills/, 'the fixed words cover a damaged earlier install in the project');
});
