import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, lstatSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, chmodSync, mkdirSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { doctorBackend, planBackend, installBackend, statusBackend } from '../../../dist/packages/local-backend/src/index.js';
import { IMAGES } from '../../../dist/packages/local-backend/src/profile.js';
import { runBackendCommand } from '../../../dist/apps/cli/src/backend.js';
const GB = 1024 ** 3;
const code = expected => error => error?.code === expected;
const readiness = { postgresAuthenticated: true, studioAuthenticated: true, metadataAuthenticated: true, studioRejectsUnauthenticated: true, restReady: true, postgresVersion: '170006' };
function fixture(t) {
  const parent = realpathSync(mkdtempSync(join(tmpdir(), 'bowerloom-backend-'))); chmodSync(parent, 0o700);
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const input = { rootDir: join(parent, 'backend') };
  const calls = [], cached = new Set(Object.values(IMAGES));
  const controls = { endpoint: 'unix:///Users/test/.docker/run/docker.sock', id: 'desktop-engine-1', resources: false, portBusy: false, free: 32 * GB, failUp: false, failPull: false, failHealth: false, afterPull: () => {}, beforeUp: () => {}, missingDocker: false, created: false, foreignLabels: false, nameCollision: false };
  const deps = { platform: 'darwin', freeBytes: () => controls.free, portsAvailable: async () => !controls.portBusy,
    readiness: async () => { if (controls.failHealth) throw new Error('private-health-detail'); return readiness; },
    runner: async args => {
      calls.push([...args]);
      if (controls.missingDocker) throw new Error('missing');
      if (args[0] === 'context') return { code: 0, stdout: JSON.stringify(controls.endpoint) };
      assert.equal(args[0], '--host'); assert.equal(args[1], controls.endpoint);
      if (args[2] === 'info') return { code: 0, stdout: JSON.stringify({ OSType: 'linux', Architecture: 'aarch64', ID: controls.id }) };
      if (args.includes('version')) return { code: 0, stdout: '2.40.3\n' };
      if (args[2] === 'image') return cached.has(args[4]) ? { code: 0, stdout: JSON.stringify([args[4]]) } : { code: 1, stdout: '' };
      if (args.includes('--filter')) return { code: 0, stdout: controls.resources ? 'existing-owned-resource\n' : '' };
      if (args[2] === 'pull') { if (controls.failPull) return { code: 1, stdout: 'ignored private detail' }; cached.add(args[3]); controls.afterPull(); return { code: 0, stdout: '' }; }
      if (['container', 'volume', 'network'].includes(args[2]) && args[3] === 'inspect') {
        if (controls.nameCollision) return { code: 0, stdout: '{}' };
        if (!controls.created) return { code: 1, stdout: '' };
        const record = JSON.parse(readFileSync(join(input.rootDir, 'installation.json')));
        const service = Object.keys(IMAGES).find(name => args[4] === `${record.plan.project}-${name}-1`);
        return { code: 0, stdout: JSON.stringify({ 'com.docker.compose.project': record.plan.project, 'io.bowerloom.local-backend': record.plan.project, 'io.bowerloom.plan-revision': controls.foreignLabels ? 'wrong' : record.plan.revision, ...(service ? { 'com.docker.compose.service': service } : {}) }) };
      }
      if (args.includes('up')) { controls.created = true; controls.beforeUp(); return { code: controls.failUp ? 1 : 0, stdout: '' }; }
      if (args.includes('ps')) return { code: 0, stdout: '[]' };
      throw new Error(`Unexpected command: ${args.join(' ')}`);
    } };
  return { parent, input, calls, cached, controls, deps };
}
const mutations = calls => calls.filter(args => args.includes('pull') || args.includes('up') || args.includes('down') || args.includes('prune'));

test('doctor reports prerequisite installation and rejects remote engines without writes', async t => {
  const { input, deps, controls, calls } = fixture(t);
  controls.missingDocker = true;
  const missing = await doctorBackend(deps);
  assert.equal(missing.ready, false); assert.match(missing.dockerInstallUrl, /^https:\/\/docs.docker.com\//);
  controls.missingDocker = false; controls.endpoint = 'tcp://remote.example:2375';
  assert.equal((await doctorBackend(deps)).reason, 'REMOTE_DOCKER_FORBIDDEN');
  assert.equal((await doctorBackend({ ...deps, platform: 'linux' })).reason, 'UNSUPPORTED_PLATFORM');
  assert.equal(existsSync(input.rootDir), false); assert.deepEqual(mutations(calls), []);
});

test('plan binds local identity, unique project, pinned image downloads and disk estimate', async t => {
  const { input, deps, cached, parent, calls } = fixture(t);
  cached.delete(IMAGES.studio);
  const plan = await planBackend(input, deps);
  assert.deepEqual(plan.downloads, [IMAGES.studio]);
  assert.equal(plan.reserveBytes, 12 * GB); assert.equal(plan.growthBudgetBytes, 4 * GB); assert.equal(plan.minimumFreeBytes, 16 * GB);
  assert.equal(plan.runtimeProvisioned, false); assert.equal(plan.modelsStarted, false); assert.equal(plan.cloudSupported, false);
  assert.match(plan.project, /^bowerloom-[a-f0-9]{20}$/);
  assert.notEqual(plan.project, (await planBackend({ rootDir: join(parent, 'second') }, deps)).project);
  assert.notEqual(plan.revision, (await planBackend({ ...input, databasePort: 58082 }, deps)).revision);
  assert.equal(plan.studioUrl, 'http://127.0.0.1:57581/project/default');
  assert.equal(existsSync(input.rootDir), false); assert.deepEqual(mutations(calls), []);
});

test('no approval or stale approval permits Docker mutations or a private root', async t => {
  const { input, deps, controls, calls } = fixture(t);
  const plan = await planBackend(input, deps);
  await assert.rejects(installBackend(input, 'yes', deps), code('EXACT_APPROVAL_REQUIRED'));
  await assert.rejects(installBackend({ ...input, studioPort: 58081 }, plan.revision, deps), code('STALE_APPROVAL'));
  controls.id = 'replacement-engine';
  await assert.rejects(installBackend(input, plan.revision, deps), code('STALE_APPROVAL'));
  assert.equal(existsSync(input.rootDir), false); assert.deepEqual(mutations(calls), []);
});

test('an approved install uses a separate five-service profile and redacts credentials', async t => {
  const { input, deps, cached, calls } = fixture(t);
  cached.delete(IMAGES.studio);
  const plan = await planBackend(input, deps);
  const result = await installBackend(input, plan.revision, deps);
  assert.equal(result.status, 'ready'); assert.deepEqual(result.readiness, readiness);
  assert.equal(lstatSync(input.rootDir).mode & 0o077, 0);
  for (const file of readdirSync(input.rootDir)) assert.equal(lstatSync(join(input.rootDir, file)).mode & 0o077, 0);
  const compose = JSON.parse(readFileSync(join(input.rootDir, 'compose.json')));
  assert.deepEqual(Object.keys(compose.services).sort(), ['db', 'gateway', 'meta', 'rest', 'studio']);
  assert.deepEqual(Object.values(compose.services).flatMap(service => service.ports ?? []), ['127.0.0.1:57582:5432', '127.0.0.1:57581:8000']);
  for (const [name, service] of Object.entries(compose.services)) { assert.equal(service.image, IMAGES[name]); assert.equal(service.pull_policy, 'never'); assert.equal(service.labels['io.bowerloom.plan-revision'], plan.revision); }
  const secret = JSON.parse(readFileSync(join(input.rootDir, 'credentials.json')));
  assert.ok(!JSON.stringify(result).includes(secret.POSTGRES_PASSWORD));
  assert.ok(!JSON.stringify(calls).includes(secret.POSTGRES_PASSWORD));
  const starts = calls.filter(args => args.includes('up')); assert.equal(starts.length, 1);
  assert.ok(starts[0].includes(plan.project)); assert.ok(starts[0].includes(join(input.rootDir, 'compose.json')));
  assert.deepEqual(mutations(calls).filter(args => args.includes('pull')).map(args => args[3]), [IMAGES.studio]);
  assert.equal((await statusBackend(input.rootDir, deps)).ready, true);
  await assert.rejects(installBackend(input, plan.revision, deps), code('INSTALL_ROOT_EXISTS'));
});

test('ports, resources and disk reserve failures stop before creating an installation', async t => {
  const { input, deps, controls, calls } = fixture(t);
  controls.free = 15 * GB; await assert.rejects(planBackend(input, deps), code('DISK_RESERVE_REQUIRED'));
  controls.free = 32 * GB; controls.resources = true; await assert.rejects(planBackend(input, deps), code('PROJECT_ALREADY_EXISTS'));
  controls.resources = false; controls.portBusy = true; await assert.rejects(planBackend(input, deps), code('PORT_IN_USE'));
  assert.deepEqual(mutations(calls), []); assert.equal(existsSync(input.rootDir), false);
});

test('existing roots, symlinks, public parents and reserved paths fail closed', async t => {
  const { input, deps, parent } = fixture(t);
  mkdirSync(input.rootDir); await assert.rejects(planBackend(input, deps), code('INSTALL_ROOT_EXISTS'));
  rmSync(input.rootDir, { recursive: true }); symlinkSync(join(parent, 'missing'), input.rootDir);
  await assert.rejects(planBackend(input, deps), code('UNSAFE_ROOT_PATH')); unlinkSync(input.rootDir);
  chmodSync(parent, 0o777); await assert.rejects(planBackend(input, deps), code('PRIVATE_PARENT_REQUIRED')); chmodSync(parent, 0o700);
  mkdirSync(join(parent, '.agents')); await assert.rejects(planBackend({ rootDir: join(parent, '.agents', 'backend') }, deps), code('UNSAFE_INSTALL_ROOT'));
});

test('failed startup preserves only its own private record and never prunes or destroys data', async t => {
  const { input, deps, controls, calls, parent } = fixture(t);
  const other = join(parent, 'unrelated.txt'); writeFileSync(other, 'preserve');
  const plan = await planBackend(input, deps); controls.failUp = true;
  await assert.rejects(installBackend(input, plan.revision, deps), code('BACKEND_START_FAILED'));
  const record = JSON.parse(readFileSync(join(input.rootDir, 'installation.json')));
  assert.equal(record.state, 'failed'); assert.equal(record.failure, 'BACKEND_START_FAILED');
  assert.equal(readFileSync(other, 'utf8'), 'preserve');
  assert.ok(!calls.some(args => args.includes('down') || args.includes('prune') || args.includes('rm')));
});

test('changed installation files after a pull prevent startup', async t => {
  const { input, deps, controls, cached, calls } = fixture(t);
  cached.delete(IMAGES.studio); const plan = await planBackend(input, deps);
  controls.afterPull = () => writeFileSync(join(input.rootDir, 'compose.json'), '{}');
  await assert.rejects(installBackend(input, plan.revision, deps), code('INSTALLATION_CHANGED'));
  assert.equal(calls.filter(args => args.includes('up')).length, 0);
});

test('a pull failure or declining disk space records failure without starting services', async t => {
  const a = fixture(t); a.cached.delete(IMAGES.studio); const plan = await planBackend(a.input, a.deps); a.controls.failPull = true;
  await assert.rejects(installBackend(a.input, plan.revision, a.deps), code('IMAGE_PULL_FAILED'));
  assert.equal(a.calls.filter(args => args.includes('up')).length, 0);
  const b = fixture(t); b.cached.delete(IMAGES.studio); const planB = await planBackend(b.input, b.deps); b.controls.afterPull = () => { b.controls.free = 15 * GB; };
  await assert.rejects(installBackend(b.input, planB.revision, b.deps), code('DISK_RESERVE_REQUIRED'));
  assert.equal(b.calls.filter(args => args.includes('up')).length, 0);
});

test('status distinguishes stored readiness from a fresh failure and refuses tampering', async t => {
  const { input, deps, controls } = fixture(t);
  await installBackend(input, (await planBackend(input, deps)).revision, deps);
  controls.failHealth = true;
  const status = await statusBackend(input.rootDir, deps);
  assert.equal(status.recordedState, 'ready'); assert.equal(status.ready, false); assert.equal(status.readiness, null);
  writeFileSync(join(input.rootDir, 'compose.json'), '{}');
  await assert.rejects(statusBackend(input.rootDir, deps), code('INSTALLATION_CHANGED'));
});

test('CLI permits exact documented flags and keeps planning separate from install', async t => {
  const { input, deps, calls } = fixture(t);
  assert.equal((await runBackendCommand(['backend', 'doctor'], deps)).ready, true);
  const planned = await runBackendCommand(['backend', 'plan', '--root', input.rootDir], deps);
  assert.match(planned.revision, /^[a-f0-9]{64}$/);
  await assert.rejects(runBackendCommand(['backend', 'install', '--root', input.rootDir], deps), code('EXACT_APPROVAL_REQUIRED'));
  for (const args of [['backend', 'doctor', '--approve', 'yes'], ['backend', 'plan', '--root', input.rootDir, '--approve', planned.revision], ['backend', 'plan', '--root', input.rootDir, '--studio-port', '56581;curl'], ['backend', 'status', '--root', input.rootDir, '--database-port', '57582'], ['backend', 'plan', '--root', input.rootDir, '--root', input.rootDir]]) await assert.rejects(runBackendCommand(args, deps), code('BACKEND_USAGE'));
  assert.deepEqual(mutations(calls), []);
});

test('case aliases and noncanonical root spellings cannot bypass protected paths', async t => {
  const { input, deps, parent } = fixture(t);
  for (const segment of ['.Git', '.AGENTS', '.CODEX', '.CONFIG', 'Library', 'NODE_MODULES']) {
    const folder = join(parent, segment); mkdirSync(folder);
    await assert.rejects(planBackend({ rootDir: join(folder, 'backend') }, deps), code('UNSAFE_INSTALL_ROOT'));
  }
  await assert.rejects(planBackend({ rootDir: input.rootDir + '/' }, deps), code('CANONICAL_ROOT_REQUIRED'));
  await assert.rejects(planBackend({ rootDir: join(parent, 'x') + '/../backend' }, deps), code('CANONICAL_ROOT_REQUIRED'));
});

test('unlabelled resource names block new installations and foreign labels block readiness', async t => {
  const { input, deps, controls } = fixture(t);
  controls.nameCollision = true;
  await assert.rejects(planBackend(input, deps), code('PROJECT_NAME_COLLISION'));
  controls.nameCollision = false;
  const plan = await planBackend(input, deps); controls.beforeUp = () => { controls.foreignLabels = true; };
  await assert.rejects(installBackend(input, plan.revision, deps), code('RESOURCE_OWNERSHIP_MISMATCH'));
  await assert.rejects(statusBackend(input.rootDir, deps), code('RESOURCE_OWNERSHIP_MISMATCH'));
});

test('post-start disk depletion records a failure while preserving owned resources', async t => {
  const { input, deps, controls, calls } = fixture(t);
  const plan = await planBackend(input, deps); controls.beforeUp = () => { controls.free = 11 * GB; };
  await assert.rejects(installBackend(input, plan.revision, deps), code('DISK_RESERVE_REQUIRED'));
  assert.equal(JSON.parse(readFileSync(join(input.rootDir, 'installation.json'))).state, 'failed');
  assert.ok(!calls.some(args => args.includes('down') || args.includes('prune')));
});
