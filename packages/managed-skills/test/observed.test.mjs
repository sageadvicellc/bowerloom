import '../../../dist/tests/support/isolate-home.js';
import test from '../../../dist/tests/support/lock-slot-retry.js';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { performance } from 'node:perf_hooks';
import { planNpmAcquisition } from '../../../dist/packages/skill-sources/src/npm.js';
import { observeSkillCacheRoot, openNpmCacheOperation, inspectSkillCache } from '../../../dist/packages/skill-sources/src/cache.js';
import { planObservedManagedSkill, inspectObservedManagedSkill } from '../../../dist/packages/managed-skills/src/observed.js';
import * as observed from '../../../dist/packages/managed-skills/src/observed.js';
import { applyObservedManagedSkill } from '../../../dist/packages/managed-skills/src/transaction.js';
import { NpmAcquisitionError } from '../../../dist/packages/skill-sources/src/npm.js';
const hash = b => createHash('sha256').update(b).digest('hex');
function archive(files) {
  const blocks = [];
  for (const file of files) {
    const bytes = Buffer.from(file.text), h = Buffer.alloc(512); h.write('package/' + file.sourcePath, 0, 100, 'ascii');
    for (const [at, size, n] of [[100, 8, 420], [108, 8, 0], [116, 8, 0], [124, 12, bytes.length], [136, 12, 1], [329, 8, 0], [337, 8, 0]]) h.write(n.toString(8).padStart(size - 1, '0') + '\0', at, size, 'latin1');
    h[156] = 48; h.write('ustar\0' + '00', 257, 8, 'latin1'); h.fill(32, 148, 156); h.write(h.reduce((a, b) => a + b, 0).toString(8).padStart(6, '0') + '\0 ', 148, 8, 'latin1');
    blocks.push(h, bytes, Buffer.alloc((512 - bytes.length % 512) % 512));
  }
  return gzipSync(Buffer.concat([...blocks, Buffer.alloc(1024)]));
}
async function fixture(t, version = '1.0.0') {
  const base = fs.mkdtempSync(path.join(fs.realpathSync(os.homedir()), '.bowerloom-managed-test-')); fs.chmodSync(base, 0o700); t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const projectDir = path.join(base, 'project'), stateDir = path.join(base, 'state'), cacheDir = path.join(base, 'cache');
  for (const p of [projectDir, stateDir, cacheDir]) fs.mkdirSync(p, { mode: 0o700 });
  fs.writeFileSync(path.join(projectDir, 'AGENTS.md'), 'Keep founder governance.\n', { mode: 0o644 });
  const files = [{ path: 'SKILL.md', sourcePath: 'skills/collections/SKILL.md', text: '---\nname: synthetic-collections\ndescription: Synthetic safe fixture.\nlicense: MIT\n---\nRead [guide](references/guide.md).\n' }, { path: 'references/guide.md', sourcePath: 'skills/collections/references/guide.md', text: '# Guide\nVersion ' + version + '\n' }, { path: 'LICENSE.txt', sourcePath: 'LICENSE', text: 'MIT License\nSynthetic notice.\n' }];
  const compressed = archive(files), integrity = 'sha512-' + createHash('sha512').update(compressed).digest('base64');
  const metadata = Buffer.from(JSON.stringify({ name: '@synthetic/managed', version, license: 'MIT', _npmUser: { name: 'synthetic' }, dist: { integrity, tarball: `https://registry.npmjs.org/@synthetic/managed/-/managed-${version}.tgz` } }));
  const req = { package: '@synthetic/managed', version, integrity, metadataSha256: hash(metadata), publisher: 'synthetic', declaredLicense: 'MIT', skill: { id: 'collections', name: 'synthetic-collections', sourceRoot: 'skills/collections' }, files: files.map(f => ({ path: f.path, sourcePath: f.sourcePath, sha256: hash(f.text), bytes: Buffer.byteLength(f.text), mode: 420 })), references: [{ from: 'SKILL.md', to: 'references/guide.md' }], license: { spdx: 'MIT', origin: 'included', files: ['LICENSE.txt'] } };
  const binding = observeSkillCacheRoot(cacheDir, 'b'.repeat(32), 33554432), plan = planNpmAcquisition(req, binding), abort = new AbortController(), op = openNpmCacheOperation(plan, plan.revision, abort.signal);
  op.receiving(); await op.stage(metadata, compressed, abort.signal); await op.complete(abort.signal); op.release(); const inspected = await inspectSkillCache({ root: cacheDir, operationId: binding.operationId });
  const input = { operation: 'install', projectDir, stateDir, harness: 'codex', cache: { root: cacheDir, operationId: binding.operationId, expectedSnapshotRevision: inspected.snapshotRevision, expectedReceiptRevision: inspected.receipt.revision }, expectedPreviousRevision: null, minFreeBytes: 33554432 };
  return { base, projectDir, stateDir, cacheDir, input, files };
}
test('observed planning reads real completed cache and maps sourceRoot to declared harness name without writes', async t => {
  const f = await fixture(t); const before = fs.readdirSync(f.projectDir); const plan = await planObservedManagedSkill(f.input);
  assert.equal(plan.filesystemObserved, true); assert.equal(plan.writesAuthorized, false); assert.equal(plan.core.before[1].path, path.join(f.projectDir, '.agents/skills/synthetic-collections'));
  assert.deepEqual(fs.readdirSync(f.projectDir), before); assert.deepEqual(fs.readdirSync(f.stateDir), []);
  const repeated = await planObservedManagedSkill(f.input); assert.equal(repeated.revision, plan.revision);
  const claude = await planObservedManagedSkill({ ...f.input, harness: 'claude' }); assert.equal(claude.core.before[1].path, path.join(f.projectDir, '.claude/skills/synthetic-collections')); assert.notEqual(claude.revision, plan.revision);
});
test('synthetic receipts, caller inventories, hostile accessors and active cache owners cannot become observed plans', async t => {
  const f = await fixture(t); let invoked = 0;
  await assert.rejects(planObservedManagedSkill({ ...f.input, currentInventory: [] }));
  await assert.rejects(planObservedManagedSkill({ ...f.input, cache: { ...f.input.cache, receipt: { acquisitionObserved: true } } }));
  await assert.rejects(planObservedManagedSkill({ ...f.input, get projectDir() { invoked++; return f.projectDir; } }));
  await assert.rejects(planObservedManagedSkill(new Proxy({}, { ownKeys() { invoked++; return []; } }))); assert.equal(invoked, 0);
  fs.writeFileSync(path.join(f.cacheDir, 'op-' + f.input.cache.operationId, 'owner.lock'), 'foreign owner', { mode: 0o600 });
  await assert.rejects(planObservedManagedSkill(f.input)); assert.deepEqual(fs.readdirSync(f.stateDir), []);
});
test('wrong shared parent, directory links and canonical collisions refuse without target adoption', async t => {
  const f = await fixture(t); fs.mkdirSync(path.join(f.projectDir, '.agents'), { mode: 0o777 }); fs.chmodSync(path.join(f.projectDir, '.agents'), 0o777); await assert.rejects(planObservedManagedSkill(f.input));
  fs.rmdirSync(path.join(f.projectDir, '.agents')); fs.symlinkSync(f.stateDir, path.join(f.projectDir, '.agents')); await assert.rejects(planObservedManagedSkill(f.input)); fs.unlinkSync(path.join(f.projectDir, '.agents'));
  fs.mkdirSync(path.join(f.projectDir, '.bowerloom-skills'), { mode: 0o700 }); await assert.rejects(planObservedManagedSkill(f.input)); assert.deepEqual(fs.readdirSync(f.stateDir), []);
});
test('cancellation during real cache verification gives no late target effects', async t => {
  const f = await fixture(t), abort = new AbortController(); const pending = planObservedManagedSkill(f.input, { signal: abort.signal }); const rejected = assert.rejects(pending); abort.abort(); await rejected;
  await new Promise(r => setImmediate(r)); assert.deepEqual(fs.readdirSync(f.stateDir), []); assert.deepEqual(fs.readdirSync(f.projectDir), ['AGENTS.md']);
});
test('deadline expiry inside cache read shares manager budget, rather than a restarted timeout', async t => {
  const f = await fixture(t), original = performance.now.bind(performance); let offset = 0; t.mock.method(performance, 'now', () => original() + offset);
  const pending = planObservedManagedSkill(f.input); const rejected = assert.rejects(pending); offset = 30001; await rejected; t.mock.restoreAll(); assert.deepEqual(fs.readdirSync(f.stateDir), []);
});
test('ordinary inspection of an absent manager does not infer startup or native readiness', async t => {
  const f = await fixture(t); const result = await inspectObservedManagedSkill({ projectDir: f.projectDir, stateDir: f.stateDir }); assert.equal(result.status, 'absent'); assert.equal(result.executionAuthorized, false); assert.equal(result.writesAuthorized, false);
});

test('the exported managed code list is frozen and boundary output is unchanged from the old local list', () => {
  const six = ['MANAGED_SKILL_ABORTED', 'MANAGED_SKILL_TIMEOUT', 'MANAGED_SKILL_LOCKED', 'MANAGED_SKILL_LOCAL_DRIFT', 'MANAGED_SKILL_STALE_APPROVAL', 'MANAGED_SKILL_RECOVERY_REQUIRED'];
  assert.ok(Array.isArray(observed.MANAGED_SKILL_CODES) && Object.isFrozen(observed.MANAGED_SKILL_CODES));
  assert.deepEqual([...observed.MANAGED_SKILL_CODES].sort(), [...six, 'MANAGED_SKILL_LOCK_SLOT_COLLISION', 'MANAGED_SKILL_REFUSED'].sort());
  // The reference is the boundary as it was before the refactor: the six codes pass, and everything else takes the fallback.
  const before = (error, fallback = 'MANAGED_SKILL_REFUSED') => error instanceof observed.ManagedSkillError && six.includes(error.code) ? error.code : fallback;
  const codes = [...six, 'MANAGED_SKILL_REFUSED', 'MANAGED_SKILL_OTHER', 'NPM_CACHE_CHANGED', 'SKILL_SCHEMA'];
  const errors = codes.flatMap(code => [new observed.ManagedSkillError(code), new NpmAcquisitionError(code), new Error(code), new TypeError(code)]).concat([null, 'MANAGED_SKILL_LOCKED']);
  for (const error of errors) for (const fallback of [undefined, 'MANAGED_SKILL_RECOVERY_REQUIRED']) {
    assert.throws(() => observed.boundary(error, fallback), e => e instanceof observed.ManagedSkillError && e.code === before(error, fallback));
  }
});
test('stale approval, local edit, snapshot drift and receipt drift refuse with their real fixed codes', async t => {
  const f = await fixture(t); const code = expected => e => e instanceof observed.ManagedSkillError && e.code === expected;
  await assert.rejects(applyObservedManagedSkill(f.input, '0'.repeat(64), null), code('MANAGED_SKILL_STALE_APPROVAL'));
  await assert.rejects(planObservedManagedSkill({ ...f.input, cache: { ...f.input.cache, expectedSnapshotRevision: '0'.repeat(64) } }), code('MANAGED_SKILL_REFUSED'));
  await assert.rejects(planObservedManagedSkill({ ...f.input, cache: { ...f.input.cache, expectedReceiptRevision: '0'.repeat(64) } }), code('MANAGED_SKILL_REFUSED'));
  const plan = await planObservedManagedSkill(f.input); const receipt = await applyObservedManagedSkill(f.input, plan.revision, null); assert.equal(receipt.state, 'committed');
  const installed = path.join(f.projectDir, '.agents/skills/synthetic-collections/SKILL.md'); fs.appendFileSync(installed, 'local edit\n');
  await assert.rejects(planObservedManagedSkill({ ...f.input, operation: 'update', expectedPreviousRevision: receipt.revision }), code('MANAGED_SKILL_LOCAL_DRIFT'));
});
