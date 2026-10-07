import test from '../../../dist/tests/support/lock-slot-retry.js';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { performance } from 'node:perf_hooks';
import net from 'node:net';
import { syncBuiltinESMExports } from 'node:module';
import { planStartup, applyStartup, inspectStartup, planStartupRevision, applyStartupRevision, recoverStartupRevision } from '../../../dist/packages/startup/src/index.js';
import { applyObservedManagedSkill, planObservedManagedSkillRecovery, recoverObservedManagedSkill } from '../../../dist/packages/managed-skills/src/transaction.js';
import { planNpmAcquisition } from '../../../dist/packages/skill-sources/src/npm.js';
import { observeSkillCacheRoot, openNpmCacheOperation, inspectSkillCache } from '../../../dist/packages/skill-sources/src/cache.js';
import { planObservedManagedSkill, inspectObservedManagedSkill } from '../../../dist/packages/managed-skills/src/observed.js';
import { lockPort, withProjectLock } from '../../../dist/packages/project-context/src/index.js';
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
const opDir = (f, plan) => path.join(f.stateDir, 'op-' + plan.operationKey);
async function install(f) { const p = await planObservedManagedSkill(f.input); const receipt = await applyObservedManagedSkill(f.input, p.revision, null); return { plan: p, receipt }; }
async function recover(f, plan, action) { const p = await planObservedManagedSkillRecovery({ projectDir: f.projectDir, stateDir: f.stateDir, operationKey: plan.operationKey, action }); return recoverObservedManagedSkill(p, p.revision); }
function inventory(dir) { const rows = []; const visit = p => { const s = fs.lstatSync(p); rows.push({ path: path.relative(dir, p), inode: s.ino, mode: s.mode & 0o7777, hash: s.isFile() ? hash(fs.readFileSync(p)) : null }); if (s.isDirectory()) for (const n of fs.readdirSync(p).sort()) visit(path.join(p, n)); }; visit(dir); return rows; }
for (const harness of ['codex', 'claude']) test(`${harness}: actual install and changed-source update preserve governance and unrelated skills`, async t => {
  const f = await fixture(t); f.input.harness = harness;
  const root = path.join(f.projectDir, harness === 'codex' ? '.agents' : '.claude'); fs.mkdirSync(path.join(root, 'skills/unrelated'), { recursive: true, mode: 0o700 }); fs.writeFileSync(path.join(root, 'skills/unrelated/SKILL.md'), 'Unrelated preserved.');
  const unrelated = inventory(path.join(root, 'skills/unrelated')), governance = fs.readFileSync(path.join(f.projectDir, 'AGENTS.md'));
  const first = await install(f); assert.equal(first.receipt.state, 'committed'); assert.equal(first.receipt.executionAuthorized, false);
  for (const file of f.files) assert.equal(fs.readFileSync(path.join(root, 'skills/synthetic-collections', file.path), 'utf8'), file.text);
  assert.equal((await inspectObservedManagedSkill({ projectDir: f.projectDir, stateDir: f.stateDir })).receipt.revision, first.receipt.revision);
  const same = await planObservedManagedSkill({ ...f.input, operation: 'update', expectedPreviousRevision: first.receipt.revision }); assert.equal(same.status, 'up-to-date'); assert.equal(same.revision, undefined);
  const next = await fixture(t, '2.0.0'), update = { ...f.input, operation: 'update', cache: next.input.cache, expectedPreviousRevision: first.receipt.revision };
  const plan = await planObservedManagedSkill(update); const second = await applyObservedManagedSkill(update, plan.revision, first.receipt.revision); assert.notEqual(second.revision, first.receipt.revision);
  assert.match(fs.readFileSync(path.join(root, 'skills/synthetic-collections/references/guide.md'), 'utf8'), /2\.0\.0/);
  assert.deepEqual(inventory(path.join(root, 'skills/unrelated')), unrelated); assert.deepEqual(fs.readFileSync(path.join(f.projectDir, 'AGENTS.md')), governance);
  await assert.rejects(applyObservedManagedSkill(update, plan.revision, first.receipt.revision));
});
test('approval, target replacement and local managed edits refuse before another operation', async t => {
  const f = await fixture(t), p = await planObservedManagedSkill(f.input); await assert.rejects(applyObservedManagedSkill(f.input, '0'.repeat(64), null)); assert.deepEqual(fs.readdirSync(f.stateDir), []);
  const { receipt } = await install(f), next = await fixture(t, '2.0.0'), update = { ...f.input, operation: 'update', cache: next.input.cache, expectedPreviousRevision: receipt.revision };
  const file = path.join(f.projectDir, '.agents/skills/synthetic-collections/SKILL.md'); fs.appendFileSync(file, 'Local authored change.'); const before = inventory(f.projectDir);
  await assert.rejects(planObservedManagedSkill(update)); assert.deepEqual(inventory(f.projectDir), before); assert.equal(fs.readdirSync(f.stateDir).length, 1);
});
for (const checkpoint of ['canonical-backup', 'canonical-publish', 'projection-backup', 'projection-publish', 'catalog-backup', 'catalog-publish']) for (const after of [false, true]) test(`update interruption ${checkpoint} ${after ? 'after' : 'before'} rename supports exact resume`, async t => {
  const f = await fixture(t), first = await install(f), next = await fixture(t, '2.0.0');
  const input = { ...f.input, operation: 'update', cache: next.input.cache, expectedPreviousRevision: first.receipt.revision }, plan = await planObservedManagedSkill(input);
  const rename = fs.renameSync; let hit = false;
  t.mock.method(fs, 'renameSync', (from, to) => {
    const [kind, action] = checkpoint.split('-'), match = action === 'backup' ? String(to) === path.join(opDir(f, plan), 'old-' + kind) : String(from) === path.join(opDir(f, plan), 'new-' + kind);
    if (match && !hit) { hit = true; if (after) rename(from, to); throw Error('PRIVATE_INJECTED_RENAME'); } return rename(from, to);
  });
  await assert.rejects(applyObservedManagedSkill(input, plan.revision, first.receipt.revision), e => e.code === 'MANAGED_SKILL_RECOVERY_REQUIRED' && !e.message.includes('PRIVATE')); t.mock.restoreAll(); assert.equal(hit, true);
  const result = await recover(f, plan, 'resume'); assert.equal(result.state, 'committed'); assert.equal(fs.existsSync(path.join(f.projectDir, '.bowerloom-skills-pending.json')), false);
  assert.match(fs.readFileSync(path.join(f.projectDir, '.agents/skills/synthetic-collections/references/guide.md'), 'utf8'), /2\.0\.0/);
});
for (const initial of [true, false]) test(`${initial ? 'initial' : 'update'} rollback restores exact absence or previous bytes and terminal inspection grants no new effect`, async t => {
  const f = await fixture(t); let previous = null, input = f.input;
  if (!initial) { previous = await install(f); const next = await fixture(t, '2.0.0'); input = { ...f.input, operation: 'update', cache: next.input.cache, expectedPreviousRevision: previous.receipt.revision }; }
  const before = inventory(f.projectDir), plan = await planObservedManagedSkill(input), rename = fs.renameSync; let hit = false;
  t.mock.method(fs, 'renameSync', (from, to) => { rename(from, to); if (!hit && String(from) === path.join(opDir(f, plan), 'new-projection')) { hit = true; throw Error('PRIVATE_AFTER_PROJECTION'); } });
  await assert.rejects(applyObservedManagedSkill(input, plan.revision, input.expectedPreviousRevision)); t.mock.restoreAll(); assert.equal(hit, true);
  const restored = await recover(f, plan, 'rollback'); assert.equal(restored.state, 'rolled-back'); assert.deepEqual(inventory(f.projectDir), before);
  const terminal = await inspectObservedManagedSkill({ projectDir: f.projectDir, stateDir: f.stateDir, operationKey: plan.operationKey }); assert.equal(terminal.status, 'rolled-back'); assert.equal(terminal.writesAuthorized, false);
  await assert.rejects(planObservedManagedSkillRecovery({ projectDir: f.projectDir, stateDir: f.stateDir, operationKey: plan.operationKey, action: 'resume' }));
  assert.equal((await recover(f, plan, 'rollback')).revision, restored.revision); assert.deepEqual(inventory(f.projectDir), before);
});
test('a second interruption during rollback remains recoverable without replaying reversed moves', async t => {
  const f = await fixture(t), first = await install(f), next = await fixture(t, '2.0.0'), input = { ...f.input, operation: 'update', cache: next.input.cache, expectedPreviousRevision: first.receipt.revision }, plan = await planObservedManagedSkill(input);
  const rename = fs.renameSync; t.mock.method(fs, 'renameSync', (from, to) => { rename(from, to); if (String(from) === path.join(opDir(f, plan), 'new-catalog')) throw Error('stop after catalog'); });
  await assert.rejects(applyObservedManagedSkill(input, plan.revision, first.receipt.revision)); t.mock.restoreAll();
  t.mock.method(fs, 'renameSync', (from, to) => { rename(from, to); if (String(to) === path.join(opDir(f, plan), 'returned-catalog')) throw Error('stop after reverse'); });
  await assert.rejects(recover(f, plan, 'rollback')); t.mock.restoreAll(); const result = await recover(f, plan, 'rollback'); assert.equal(result.restoredPrevious.revision, first.receipt.revision);
});
test('lost terminal fsync acknowledgement remains pending until fresh exact recovery', async t => {
  const f = await fixture(t), plan = await planObservedManagedSkill(f.input), open = fs.openSync, fsync = fs.fsyncSync; let receiptFd, hit = false;
  t.mock.method(fs, 'openSync', (file, ...args) => { const fd = open(file, ...args); if (String(file) === path.join(opDir(f, plan), '.receipt.json.tmp') && (args[0] & fs.constants.O_CREAT)) receiptFd = fd; return fd; });
  t.mock.method(fs, 'fsyncSync', fd => { fsync(fd); if (fd === receiptFd && !hit) { hit = true; throw Error('PRIVATE_ACK_LOSS'); } });
  await assert.rejects(applyObservedManagedSkill(f.input, plan.revision, null)); t.mock.restoreAll(); assert.equal(hit, true); assert.equal((await recover(f, plan, 'resume')).state, 'committed');
});
test('stage prestamp gaps and corrupt journals are held rather than adopted or overwritten', async t => {
  const f = await fixture(t), plan = await planObservedManagedSkill(f.input), mkdir = fs.mkdirSync;
  t.mock.method(fs, 'mkdirSync', (dir, ...args) => { const result = mkdir(dir, ...args); if (String(dir) === path.join(opDir(f, plan), 'new-canonical')) throw Error('PRIVATE_PRESTAMP'); return result; });
  await assert.rejects(applyObservedManagedSkill(f.input, plan.revision, null)); t.mock.restoreAll(); const before = inventory(f.projectDir);
  await assert.rejects(planObservedManagedSkillRecovery({ projectDir: f.projectDir, stateDir: f.stateDir, operationKey: plan.operationKey, action: 'resume' })); assert.deepEqual(inventory(f.projectDir), before);
  fs.appendFileSync(path.join(opDir(f, plan), 'record-000.json'), '{}'); await assert.rejects(planObservedManagedSkillRecovery({ projectDir: f.projectDir, stateDir: f.stateDir, operationKey: plan.operationKey, action: 'rollback' }));
});
test('cancellation during the acquired project listener closes ownership without late writes or retained busy state', async t => {
  const f = await fixture(t), plan = await planObservedManagedSkill(f.input), create = net.createServer; const abort = new AbortController(); let late;
  t.mock.method(net, 'createServer', (...args) => { const server = create(...args), listen = server.listen.bind(server); server.listen = (options, cb) => listen(options, () => { late = cb; abort.abort(); }); return server; }); syncBuiltinESMExports();
  try { await assert.rejects(applyObservedManagedSkill(f.input, plan.revision, null, { signal: abort.signal })); if (late) late(); await new Promise(r => setImmediate(r)); assert.deepEqual(fs.readdirSync(f.stateDir), []); }
  finally { t.mock.restoreAll(); syncBuiltinESMExports(); }
  assert.equal((await applyObservedManagedSkill(f.input, plan.revision, null)).state, 'committed');
});
for (const first of ['startup', 'manager']) for (const method of ['apply', 'recover']) test(`real startup revision ${method} and manager exclude one another when ${first} locks first`, async t => {
  const f = await fixture(t), setup = { mode: 'existing', targetDir: f.projectDir, brief: { projectName: 'Managed fixture', goal: 'Keep governance safe', profile: 'engineer' } };
  const setupPlan = await planStartup(setup); await applyStartup(setup, setupPlan.revision);
  const revised = { targetDir: f.projectDir, brief: { ...setup.brief, goal: 'Keep revised governance safe' } }, revision = await planStartupRevision(revised);
  if (method === 'recover') await applyStartupRevision(revised, revision.fromRevision, revision.revision);
  const manager = await planObservedManagedSkill(f.input), create = net.createServer; let unblock, acquired; const gate = new Promise(r => { unblock = r; }), ready = new Promise(r => { acquired = r; }); let number = 0;
  t.mock.method(net, 'createServer', (...args) => { const server = create(...args); if (++number === 1) { const listen = server.listen.bind(server); server.listen = (opts, cb) => listen(opts, () => { acquired(); gate.then(cb); }); } return server; }); syncBuiltinESMExports();
  const startup = () => method === 'apply' ? applyStartupRevision(revised, revision.fromRevision, revision.revision) : recoverStartupRevision(f.projectDir, revision.revision, 'resume');
  const manage = () => applyObservedManagedSkill(f.input, manager.revision, null);
  let owner;
  try { owner = first === 'startup' ? startup() : manage(); const observer = owner.catch(() => {}); await ready; await assert.rejects(first === 'startup' ? manage() : startup()); unblock(); await owner; await observer; }
  finally { unblock(); t.mock.restoreAll(); syncBuiltinESMExports(); }
  assert.equal((await inspectStartup(f.projectDir)).specReady, true);
});

test('a lock slot held by another program refuses LOCK_SLOT_COLLISION naming the port, with no write', async t => {
  const f = await fixture(t), p = await planObservedManagedSkill(f.input), port = lockPort(f.projectDir), before = inventory(f.projectDir);
  const blocker = net.createServer(socket => socket.destroy()); await new Promise((resolve, reject) => { blocker.once('error', reject); blocker.listen({ host: '127.0.0.1', port, exclusive: true }, resolve); });
  try { await assert.rejects(applyObservedManagedSkill(f.input, p.revision, null), e => e.code === 'MANAGED_SKILL_LOCK_SLOT_COLLISION' && e.message.includes(String(port))); }
  finally { await new Promise(resolve => blocker.close(resolve)); }
  assert.deepEqual(fs.readdirSync(f.stateDir), []); assert.deepEqual(inventory(f.projectDir), before);
  // This project's own lock holder is LOCKED, as before.
  await withProjectLock(f.projectDir, new AbortController().signal, async () => { await assert.rejects(applyObservedManagedSkill(f.input, p.revision, null), e => e.code === 'MANAGED_SKILL_LOCKED'); });
  assert.equal((await applyObservedManagedSkill(f.input, p.revision, null)).state, 'committed');
});
test('concurrent real apply calls create one operation and one committed receipt', async t => {
  const f = await fixture(t), p = await planObservedManagedSkill(f.input);
  const results = await Promise.allSettled([applyObservedManagedSkill(f.input, p.revision, null), applyObservedManagedSkill(f.input, p.revision, null)]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1); assert.equal(results.filter(r => r.status === 'rejected').length, 1); assert.equal(fs.readdirSync(f.stateDir).length, 1);
});
test('changed recovery approval, foreign marker and substituted stages refuse without repair', async t => {
  const f = await fixture(t), p = await planObservedManagedSkill(f.input), rename = fs.renameSync; let hit = false;
  t.mock.method(fs, 'renameSync', (from, to) => { if (!hit && !String(from).endsWith('.tmp')) { hit = true; throw Error('before first rename'); } return rename(from, to); });
  await assert.rejects(applyObservedManagedSkill(f.input, p.revision, null)); t.mock.restoreAll();
  const recovery = await planObservedManagedSkillRecovery({ projectDir: f.projectDir, stateDir: f.stateDir, operationKey: p.operationKey, action: 'resume' });
  await assert.rejects(recoverObservedManagedSkill(recovery, '0'.repeat(64)));
  const stage = path.join(opDir(f, p), 'new-canonical/SKILL.md'); fs.appendFileSync(stage, 'Local stage drift.'); const before = inventory(f.projectDir);
  await assert.rejects(recoverObservedManagedSkill(recovery, recovery.revision)); assert.deepEqual(inventory(f.projectDir), before);
  fs.writeFileSync(path.join(f.projectDir, '.bowerloom-skills-pending.json'), '{}'); await assert.rejects(planObservedManagedSkillRecovery({ projectDir: f.projectDir, stateDir: f.stateDir, operationKey: p.operationKey, action: 'rollback' }));
});
test('parent created without acknowledged identity remains held', async t => {
  const f = await fixture(t), p = await planObservedManagedSkill(f.input), mkdir = fs.mkdirSync;
  t.mock.method(fs, 'mkdirSync', (dir, ...args) => { const result = mkdir(dir, ...args); if (String(dir) === path.join(f.projectDir, '.agents')) throw Error('parent stamp loss'); return result; });
  await assert.rejects(applyObservedManagedSkill(f.input, p.revision, null)); t.mock.restoreAll();
  await assert.rejects(recover(f, p, 'resume')); assert.equal(fs.existsSync(path.join(f.projectDir, '.agents')), true);
});
test('expiry during delayed listen settles without stage creation and permits a fresh later owner', async t => {
  const f = await fixture(t), p = await planObservedManagedSkill(f.input), create = net.createServer, now = performance.now.bind(performance); let offset = 0;
  t.mock.method(performance, 'now', () => now() + offset);
  t.mock.method(net, 'createServer', (...args) => { const server = create(...args), listen = server.listen.bind(server); server.listen = (options, cb) => listen(options, () => { offset = 30001; cb(); }); return server; }); syncBuiltinESMExports();
  try { await assert.rejects(applyObservedManagedSkill(f.input, p.revision, null)); assert.deepEqual(fs.readdirSync(f.stateDir), []); }
  finally { t.mock.restoreAll(); syncBuiltinESMExports(); }
  assert.equal((await applyObservedManagedSkill(f.input, p.revision, null)).state, 'committed');
});
test('original startup revision remains usable after an independent managed install', async t => {
  const f = await fixture(t), setup = { mode: 'existing', targetDir: f.projectDir, brief: { projectName: 'Preservation fixture', goal: 'Keep the project stable', profile: 'engineer' } };
  const initial = await planStartup(setup); await applyStartup(setup, initial.revision); const bytes = fs.readFileSync(path.join(f.projectDir, '.bowerloom/installation-receipt.json'));
  await install(f); assert.deepEqual(fs.readFileSync(path.join(f.projectDir, '.bowerloom/installation-receipt.json')), bytes);
  const input = { targetDir: f.projectDir, brief: { ...setup.brief, goal: 'Keep the revised project stable' } }, revision = await planStartupRevision(input); await applyStartupRevision(input, revision.fromRevision, revision.revision);
  assert.equal((await inspectStartup(f.projectDir)).specReady, true); assert.equal((await inspectObservedManagedSkill({ projectDir: f.projectDir, stateDir: f.stateDir })).status, 'committed');
});

for (const cause of ['abort', 'expiry']) test(`final apply capacity ${cause} refuses before operation or marker creation`, async t => {
  const f = await fixture(t), plan = await planObservedManagedSkill(f.input), statfs = fs.statfsSync, now = performance.now.bind(performance), controller = new AbortController();
  let stateReads = 0, offset = 0, hit = false;
  t.mock.method(performance, 'now', () => now() + offset);
  t.mock.method(fs, 'statfsSync', (dir, ...args) => {
    const result = statfs(dir, ...args);
    // Each capacity observation reads the block size, then free space. The
    // second capacity call is after the awaited final cache re-verification.
    if (String(dir) === f.stateDir && ++stateReads === 4) { hit = true; if (cause === 'abort') controller.abort(); else offset = 30001; }
    return result;
  });
  await assert.rejects(applyObservedManagedSkill(f.input, plan.revision, null, { signal: controller.signal }), e => e.code === (cause === 'abort' ? 'MANAGED_SKILL_ABORTED' : 'MANAGED_SKILL_TIMEOUT'));
  t.mock.restoreAll(); assert.equal(hit, true); assert.deepEqual(fs.readdirSync(f.stateDir), []);
  assert.deepEqual(fs.readdirSync(f.projectDir), ['AGENTS.md']);
});

/** Count forward filesystem calls after the injected interruption, excluding
 * read-only opens and the unconditional close of already-held descriptors. */
function trackEffects(t, interrupted) {
  const seen = [];
  for (const name of ['mkdirSync', 'fchmodSync', 'writeFileSync', 'fsyncSync', 'renameSync', 'unlinkSync', 'rmdirSync']) {
    const original = fs[name]; t.mock.method(fs, name, (...args) => { if (interrupted()) seen.push(name); return original(...args); });
  }
  const open = fs.openSync; t.mock.method(fs, 'openSync', (...args) => { if (interrupted() && (args[1] & fs.constants.O_CREAT)) seen.push('open-create'); return open(...args); });
  return seen;
}
test('cancellation in the closing operation-space observation permits no following journal effect', async t => {
  const f = await fixture(t), plan = await planObservedManagedSkill(f.input), statfs = fs.statfsSync, controller = new AbortController(); let hit = false;
  const effects = trackEffects(t, () => hit);
  t.mock.method(fs, 'statfsSync', (dir, ...args) => { const result = statfs(dir, ...args); if (!hit && String(dir) === opDir(f, plan)) { hit = true; controller.abort(); } return result; });
  await assert.rejects(applyObservedManagedSkill(f.input, plan.revision, null, { signal: controller.signal }), e => e.code === 'MANAGED_SKILL_RECOVERY_REQUIRED');
  // The first observation of the published operation folder: it holds its intent and nothing else.
  t.mock.restoreAll(); assert.equal(hit, true); assert.deepEqual(effects, []); assert.deepEqual(fs.readdirSync(opDir(f, plan)), ['intent.json']);
});
test('cancellation during final destination-name inspection permits no rename or journal effect', async t => {
  const f = await fixture(t), plan = await planObservedManagedSkill(f.input), controller = new AbortController(), readdir = fs.readdirSync;
  let armed = false, hit = false; const effects = trackEffects(t, () => hit), write = fs.writeFileSync;
  t.mock.method(fs, 'writeFileSync', (fd, data, ...args) => { const result = write(fd, data, ...args); if (typeof data === 'string' && data.includes('"kind":"MOVE_INTENT"')) armed = true; return result; });
  t.mock.method(fs, 'readdirSync', (dir, ...args) => { const result = readdir(dir, ...args); if (armed && !hit && String(dir) === path.join(f.projectDir, '.bowerloom-skills/skills')) { hit = true; controller.abort(); } return result; });
  await assert.rejects(applyObservedManagedSkill(f.input, plan.revision, null, { signal: controller.signal }), e => e.code === 'MANAGED_SKILL_RECOVERY_REQUIRED');
  t.mock.restoreAll(); assert.equal(hit, true); assert.deepEqual(effects, []); assert.equal(fs.existsSync(path.join(f.projectDir, '.bowerloom-skills/skills/collections')), false);
});

function replaceProjectionParent(f, form, originals) {
  const parent = path.join(f.projectDir, '.agents/skills'), saved = path.join(f.base, 'original-projection-parent'), target = path.join(f.base, 'replacement-target');
  originals.rename(parent, saved); originals.mkdir(target, { mode: 0o700 }); originals.write(path.join(target, 'unrelated.txt'), 'Replacement owner content.\n', { mode: 0o600 });
  if (form === 'symlink') fs.symlinkSync(target, parent, 'dir'); else originals.mkdir(parent, { mode: 0o700 });
  return { parent, saved, target, savedBefore: inventory(saved), replacementBefore: inventory(form === 'symlink' ? target : parent), targetBefore: inventory(target) };
}
function unchangedReplacement(swapped, form) {
  assert.deepEqual(inventory(swapped.saved), swapped.savedBefore);
  assert.deepEqual(inventory(form === 'symlink' ? swapped.target : swapped.parent), swapped.replacementBefore);
  assert.deepEqual(inventory(swapped.target), swapped.targetBefore);
  assert.equal(fs.existsSync(path.join(swapped.parent, 'synthetic-collections')), false);
}
for (const existing of [true, false]) for (const form of ['directory', 'symlink']) test(`${existing ? 'approved' : 'acknowledged new'} projection parent ${form} substitution between publications is held`, async t => {
  const f = await fixture(t);
  if (existing) fs.mkdirSync(path.join(f.projectDir, '.agents/skills'), { recursive: true, mode: 0o700 });
  const plan = await planObservedManagedSkill(f.input), originals = { rename: fs.renameSync, mkdir: fs.mkdirSync, write: fs.writeFileSync }; let swapped;
  t.mock.method(fs, 'renameSync', (from, to) => {
    const result = originals.rename(from, to);
    if (!swapped && String(from) === path.join(opDir(f, plan), 'new-canonical')) swapped = replaceProjectionParent(f, form, originals);
    return result;
  });
  await assert.rejects(applyObservedManagedSkill(f.input, plan.revision, null), e => e.code === 'MANAGED_SKILL_RECOVERY_REQUIRED');
  t.mock.restoreAll(); assert.ok(swapped); unchangedReplacement(swapped, form);
  await assert.rejects(planObservedManagedSkillRecovery({ projectDir: f.projectDir, stateDir: f.stateDir, operationKey: plan.operationKey, action: 'resume' }));
  unchangedReplacement(swapped, form); assert.equal(fs.readFileSync(path.join(f.projectDir, 'AGENTS.md'), 'utf8'), 'Keep founder governance.\n');
});
for (const action of ['resume', 'rollback']) test(`parent substitution after fresh ${action} approval refuses the next destination move`, async t => {
  const f = await fixture(t), first = await install(f), next = await fixture(t, '2.0.0'), input = { ...f.input, operation: 'update', cache: next.input.cache, expectedPreviousRevision: first.receipt.revision }, plan = await planObservedManagedSkill(input);
  const originals = { rename: fs.renameSync, mkdir: fs.mkdirSync, write: fs.writeFileSync };
  // Leave projection absent with its exact old bytes in a recorded backup.
  t.mock.method(fs, 'renameSync', (from, to) => { const result = originals.rename(from, to); if (String(to) === path.join(opDir(f, plan), 'old-projection')) throw Error('synthetic interruption'); return result; });
  await assert.rejects(applyObservedManagedSkill(input, plan.revision, first.receipt.revision)); t.mock.restoreAll();
  const recovery = await planObservedManagedSkillRecovery({ projectDir: f.projectDir, stateDir: f.stateDir, operationKey: plan.operationKey, action }), backup = inventory(path.join(opDir(f, plan), 'old-projection'));
  let swapped, entered = 0;
  t.mock.method(fs, 'writeFileSync', (fd, data, ...args) => {
    const result = originals.write(fd, data, ...args);
    const kind = action === 'resume' ? 'MOVE_INTENT' : 'ROLLBACK_INTENT';
    if (!swapped && typeof data === 'string' && data.includes(`"kind":"${kind}"`) && data.includes('"kind":"projection"')) swapped = replaceProjectionParent(f, 'symlink', originals);
    return result;
  });
  t.mock.method(fs, 'renameSync', (from, to) => { if (swapped) entered++; return originals.rename(from, to); });
  await assert.rejects(recoverObservedManagedSkill(recovery, recovery.revision)); t.mock.restoreAll();
  assert.ok(swapped); assert.equal(entered, 0); unchangedReplacement(swapped, 'symlink'); assert.deepEqual(inventory(path.join(opDir(f, plan), 'old-projection')), backup);
});
test('terminal marker cleanup refuses a replaced approved parent without removing the marker', async t => {
  const f = await fixture(t), plan = await planObservedManagedSkill(f.input), originals = { rename: fs.renameSync, mkdir: fs.mkdirSync, write: fs.writeFileSync };
  let swapped;
  t.mock.method(fs, 'writeFileSync', (fd, data, ...args) => { const result = originals.write(fd, data, ...args); if (!swapped && typeof data === 'string' && data.includes('"kind":"MARKER_REMOVE_INTENT"')) swapped = replaceProjectionParent(f, 'directory', originals); return result; });
  await assert.rejects(applyObservedManagedSkill(f.input, plan.revision, null)); t.mock.restoreAll();
  assert.ok(swapped); unchangedReplacement(swapped, 'directory'); assert.equal(fs.existsSync(path.join(f.projectDir, '.bowerloom-skills-pending.json')), true);
  await assert.rejects(planObservedManagedSkillRecovery({ projectDir: f.projectDir, stateDir: f.stateDir, operationKey: plan.operationKey, action: 'resume' }));
  assert.equal(fs.existsSync(path.join(f.projectDir, '.bowerloom-skills-pending.json')), true);
});
for (const [kind, id] of [['MOVE_INTENT', 'projection-publish'], ['MOVE_DONE', 'projection-publish'], ['RECEIPT_INTENT', null]]) for (const action of ['resume', 'rollback']) test(`a kill between the open and the write of ${kind}${id ? ' ' + id : ''} leaves no empty record and ${action} converges`, async t => {
  const f = await fixture(t), before = inventory(f.projectDir), plan = await planObservedManagedSkill(f.input), write = fs.writeFileSync; let hit = false;
  t.mock.method(fs, 'writeFileSync', (fd, data, ...rest) => { if (!hit && typeof data === 'string' && data.startsWith('{"sequence":') && data.includes(`"kind":"${kind}"`) && (!id || data.includes(`"id":"${id}"`))) { hit = true; throw Error('PRIVATE_KILL'); } return write(fd, data, ...rest); });
  await assert.rejects(applyObservedManagedSkill(f.input, plan.revision, null), e => e.code === 'MANAGED_SKILL_RECOVERY_REQUIRED'); t.mock.restoreAll(); assert.equal(hit, true);
  for (const n of fs.readdirSync(opDir(f, plan))) if (/^record-\d{3}\.json$/.test(n)) assert.ok(fs.statSync(path.join(opDir(f, plan), n)).size > 0, n);
  const result = await recover(f, plan, action); assert.equal(result.state, action === 'resume' ? 'committed' : 'rolled-back'); assert.equal(fs.existsSync(path.join(f.projectDir, '.bowerloom-skills-pending.json')), false);
  if (action === 'rollback') assert.deepEqual(inventory(f.projectDir), before);
});

const intentWriteV1 = (t, also = () => {}) => {
  const write = fs.writeFileSync; t.mock.method(fs, 'writeFileSync', (fd, data, ...rest) => { if (typeof data === 'string' && data.includes('"bowerloom/managed-skill-intent/v1beta1"')) throw Error('PRIVATE_KILL'); return write(fd, data, ...rest); });
  also(); syncBuiltinESMExports();
};
test('v1: a failure before the operation folder is published leaves no operation, and the same approval applies', async t => {
  const f = await fixture(t), p = await planObservedManagedSkill(f.input), before = inventory(f.projectDir);
  intentWriteV1(t); await assert.rejects(applyObservedManagedSkill(f.input, p.revision, null), e => e.code === 'MANAGED_SKILL_REFUSED' && !e.message.includes('PRIVATE')); t.mock.restoreAll(); syncBuiltinESMExports();
  assert.deepEqual(fs.readdirSync(f.stateDir), []); assert.deepEqual(inventory(f.projectDir), before);
  assert.equal((await applyObservedManagedSkill(f.input, p.revision, null)).state, 'committed');
});
test('v1: a leftover private operation temporary is ignored by plan and removed under the lock', async t => {
  const f = await fixture(t), p = await planObservedManagedSkill(f.input);
  intentWriteV1(t, () => t.mock.method(fs, 'rmdirSync', () => { throw Error('PRIVATE_KILLED'); }));
  await assert.rejects(applyObservedManagedSkill(f.input, p.revision, null)); t.mock.restoreAll(); syncBuiltinESMExports();
  assert.deepEqual(fs.readdirSync(f.stateDir), ['.op-' + p.operationKey + '.tmp']);
  assert.equal((await planObservedManagedSkill(f.input)).revision, p.revision);
  assert.equal((await applyObservedManagedSkill(f.input, p.revision, null)).state, 'committed');
  assert.deepEqual(fs.readdirSync(f.stateDir), ['op-' + p.operationKey]);
  // A temporary with other content is never removed.
  const g = await fixture(t), q = await planObservedManagedSkill(g.input), temp = path.join(g.stateDir, '.op-' + 'c'.repeat(64) + '.tmp');
  fs.mkdirSync(temp, { mode: 0o700 }); fs.writeFileSync(path.join(temp, 'notes.txt'), 'user data', { mode: 0o600 });
  await assert.rejects(applyObservedManagedSkill(g.input, q.revision, null), e => e.code === 'MANAGED_SKILL_RECOVERY_REQUIRED'); assert.deepEqual(fs.readdirSync(temp), ['notes.txt']);
});
