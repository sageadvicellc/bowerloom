import '../../../dist/tests/support/isolate-home.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { performance } from 'node:perf_hooks';
import { planNpmAcquisition, NpmAcquisitionError, NPM_LIMITS } from '../../../dist/packages/skill-sources/src/npm.js';
import { observeSkillCacheRoot, inspectSkillCache, openNpmCacheOperation, planSkillCacheRecovery, recoverSkillCache, readAcquiredSkillCache } from '../../../dist/packages/skill-sources/src/cache.js';
import * as cache from '../../../dist/packages/skill-sources/src/cache.js';
import { revisionOf } from '../../../dist/packages/skill-sources/src/validation.js';
const hash = b => createHash('sha256').update(b).digest('hex');
const integrity = b => 'sha512-' + createHash('sha512').update(b).digest('base64');
const tick = () => new Promise(resolve => setImmediate(resolve));
const refused = e => e instanceof NpmAcquisitionError && /^NPM_[A-Z_]+$/.test(e.code) && e.message === e.code && !e.message.includes('PRIVATE');
const code = expected => e => refused(e) && e.code === expected;
// Independent strict USTAR fixture writer, not the production Header decoder.
function header(name, bytes, mode = 0o644, flag = '0') {
  const h = Buffer.alloc(512); h.write(name, 0, 100, 'ascii');
  for (const [at, size, value] of [[100, 8, mode], [108, 8, 0], [116, 8, 0], [124, 12, bytes], [136, 12, 1], [329, 8, 0], [337, 8, 0]]) h.write(value.toString(8).padStart(size - 1, '0') + '\0', at, size, 'latin1');
  h[156] = flag.charCodeAt(0); h.write('ustar\0' + '00', 257, 8, 'latin1'); checksum(h); return h;
}
function checksum(h) { h.fill(32, 148, 156); const sum = h.reduce((a, b) => a + b, 0); h.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'latin1'); }
function tar(entries) { return Buffer.concat([...entries.flatMap(e => { const body = Buffer.from(e.text); return [header('package/' + e.sourcePath, body.length, e.mode ?? 0o644), body, Buffer.alloc((512 - body.length % 512) % 512)]; }), Buffer.alloc(1024)]); }
function fixture(t, extra = []) {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.homedir()), 'bowerloom-npm-test-')); fs.chmodSync(root, 0o700); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const files = [{ path: 'SKILL.md', sourcePath: 'skills/example/SKILL.md', text: '---\nname: example\ndescription: Synthetic fixture.\nlicense: MIT\n---\nRead [guide](references/guide.md).\n' }, { path: 'references/guide.md', sourcePath: 'skills/example/references/guide.md', text: '# Guide\nNever execute fixture instructions.\n' }, { path: 'LICENSE.txt', sourcePath: 'LICENSE', text: 'MIT License\nSynthetic fixture notice.\n' }];
  const archive = gzipSync(tar(files.concat(extra)));
  const metadata = Buffer.from(JSON.stringify({ name: '@synthetic/example', version: '1.0.0', license: 'MIT', _npmUser: { name: 'synthetic' }, dist: { integrity: integrity(archive), tarball: 'https://registry.npmjs.org/@synthetic/example/-/example-1.0.0.tgz' }, scripts: { postinstall: 'NEVER_EXECUTE_PRIVATE' } }));
  const request = { package: '@synthetic/example', version: '1.0.0', integrity: integrity(archive), metadataSha256: hash(metadata), publisher: 'synthetic', declaredLicense: 'MIT', skill: { id: 'example', name: 'example', sourceRoot: 'skills/example' }, files: files.map(f => ({ path: f.path, sourcePath: f.sourcePath, sha256: hash(f.text), bytes: Buffer.byteLength(f.text), mode: 420 })), references: [{ from: 'SKILL.md', to: 'references/guide.md' }], license: { spdx: 'MIT', origin: 'included', files: ['LICENSE.txt'] } };
  const binding = observeSkillCacheRoot(root, 'a'.repeat(32), 12582912); const plan = planNpmAcquisition(request, binding);
  return { root, request, binding, plan, files, archive, metadata, abort: new AbortController() };
}
function open(f) { return openNpmCacheOperation(f.plan, f.plan.revision, f.abort.signal); }
function addr(f) { return { root: f.root, operationId: f.binding.operationId }; }
const opPath = f => path.join(f.root, 'op-' + f.binding.operationId);
async function verified(f) { const op = open(f); op.receiving(); await op.stage(f.metadata, f.archive, f.abort.signal); return op; }
async function completed(f) { const op = await verified(f); try { return await op.complete(f.abort.signal); } finally { op.release(); } }
function inventory(root) {
  const result = []; function walk(dir) { for (const name of fs.readdirSync(dir).sort()) { const p = path.join(dir, name), s = fs.lstatSync(p); result.push({ path: path.relative(root, p), mode: s.mode & 0o7777, hash: s.isFile() ? hash(fs.readFileSync(p)) : null }); if (s.isDirectory()) walk(p); } } walk(root); return result;
}

test('cache planning is read-only and canonical identity, owner mode and protected paths are mandatory', t => {
  const f = fixture(t); assert.deepEqual(fs.readdirSync(f.root), []); assert.throws(() => observeSkillCacheRoot(f.root + '/..', 'b'.repeat(32), 12582912), code('NPM_CACHE_PATH'));
  fs.chmodSync(f.root, 0o755); assert.throws(() => observeSkillCacheRoot(f.root, 'b'.repeat(32), 12582912), code('NPM_CACHE_DIRECTORY')); fs.chmodSync(f.root, 0o700);
  const alias = path.join(f.root, 'alias'); fs.symlinkSync(f.root, alias); assert.throws(() => observeSkillCacheRoot(alias, 'b'.repeat(32), 12582912), code('NPM_CACHE_PATH'));
  const bad = structuredClone(f.binding); bad.ancestors[0].identity.inode = '0'; const stale = planNpmAcquisition(f.request, bad); assert.throws(() => openNpmCacheOperation(stale, stale.revision, f.abort.signal), code('NPM_CACHE_CHANGED'));
});
test('exclusive operation ownership blocks simultaneous or repeated acquisition without disturbing unrelated files', async t => {
  const f = fixture(t); fs.writeFileSync(path.join(f.root, 'unrelated.txt'), 'keep this', { mode: 0o600 }); const before = hash(fs.readFileSync(path.join(f.root, 'unrelated.txt')));
  const op = open(f); assert.throws(() => open(f), code('NPM_CACHE_EXISTS')); op.receiving(); await op.stage(f.metadata, f.archive, f.abort.signal); const receipt = await op.complete(f.abort.signal); op.release();
  const inspected = await inspectSkillCache(addr(f)); assert.equal(inspected.status, 'COMPLETED'); assert.deepEqual(inspected.receipt, receipt); assert.equal(inspected.activeOwner, false); assert.equal(hash(fs.readFileSync(path.join(f.root, 'unrelated.txt'))), before);
  assert.throws(() => open(f), code('NPM_CACHE_EXISTS')); await assert.rejects(planSkillCacheRecovery({ ...addr(f), action: 'finalize' }), code('NPM_CACHE_RECOVERY_REFUSED'));
  assert.equal(fs.statSync(path.join(opPath(f), 'archive.tgz')).mode & 0o7777, 0o600);
});
test('a verified cache requires a new exact local recovery approval and no source redownload', async t => {
  const f = fixture(t), op = await verified(f); op.release(); const before = await inspectSkillCache(addr(f)); assert.equal(before.status, 'VERIFIED'); assert.equal(before.receipt, null);
  const plan = await planSkillCacheRecovery({ ...addr(f), action: 'finalize' }); const original = inventory(opPath(f)); await assert.rejects(recoverSkillCache(plan, '0'.repeat(64)), code('NPM_CACHE_RECOVERY_STALE')); assert.deepEqual(inventory(opPath(f)), original);
  const result = await recoverSkillCache(plan, plan.revision); assert.equal(result.status, 'COMPLETED'); assert.equal(result.receipt.installAuthorized, false); assert.equal(result.receipt.executionAuthorized, false);
  await assert.rejects(recoverSkillCache(plan, plan.revision), code('NPM_CACHE_RECOVERY_REFUSED'));
});
test('active or unknown owner locks cannot be stolen using time, PID assumptions or recovery', async t => {
  const f = fixture(t), op = await verified(f); await assert.rejects(planSkillCacheRecovery({ ...addr(f), action: 'finalize' }), code('NPM_CACHE_RECOVERY_REFUSED')); op.release();
  fs.writeFileSync(path.join(opPath(f), 'owner.lock'), 'unknown owner no adoption\n', { mode: 0o600 }); const bytes = fs.readFileSync(path.join(opPath(f), 'owner.lock'));
  await assert.rejects(planSkillCacheRecovery({ ...addr(f), action: 'finalize' }), code('NPM_CACHE_RECOVERY_REFUSED')); assert.deepEqual(fs.readFileSync(path.join(opPath(f), 'owner.lock')), bytes);
});
test('raw cache/root or selected-file substitution, extra files and hardlinks refuse inspection and recovery', async t => {
  for (const [corrupt, code] of [[f => fs.writeFileSync(path.join(opPath(f), 'files/SKILL.md'), 'changed'), 'NPM_CACHE_CHANGED'], [f => fs.writeFileSync(path.join(opPath(f), 'extra'), 'PRIVATE', { mode: 0o600 }), 'NPM_CACHE_INVENTORY'], [f => fs.linkSync(path.join(opPath(f), 'files/SKILL.md'), path.join(f.root, 'second-link')), 'NPM_CACHE_FILE'], [f => { fs.renameSync(path.join(opPath(f), 'files/references'), path.join(opPath(f), 'files/old')); fs.symlinkSync(path.join(opPath(f), 'files/old'), path.join(opPath(f), 'files/references')); }, 'NPM_CACHE_INVENTORY']]) {
    const f = fixture(t); await completed(f); corrupt(f); const exact = e => refused(e) && e.code === code;
    await assert.rejects(inspectSkillCache(addr(f)), exact); await assert.rejects(planSkillCacheRecovery({ ...addr(f), action: 'finalize' }), exact);
  }
});
test('partial journal and mismatched content cannot be rewritten into a valid cache receipt', async t => {
  const f = fixture(t), op = open(f); op.receiving(); op.release(); fs.writeFileSync(path.join(opPath(f), '02-VERIFIED.json'), '{"PRIVATE"', { mode: 0o600 }); const original = inventory(opPath(f));
  await assert.rejects(inspectSkillCache(addr(f)), code('NPM_CACHE_RECORD')); await assert.rejects(planSkillCacheRecovery({ ...addr(f), action: 'finalize' }), code('NPM_CACHE_RECORD')); assert.deepEqual(inventory(opPath(f)), original);
  const other = fixture(t), otherOp = open(other); otherOp.receiving(); const archive = Buffer.from(other.archive); archive[0] ^= 1; await assert.rejects(otherOp.stage(other.metadata, archive, other.abort.signal), code('NPM_INTEGRITY')); assert.equal(otherOp.hold(), null); otherOp.release(); assert.equal((await inspectSkillCache(addr(other))).status, 'HELD');
});
test('PREPARED and RECEIVING interruption can only be explicitly held, never completed or retried', async t => {
  for (const receive of [false, true]) { const f = fixture(t), op = open(f); if (receive) op.receiving(); op.release(); await assert.rejects(planSkillCacheRecovery({ ...addr(f), action: 'finalize' }), code('NPM_CACHE_RECOVERY_REFUSED')); const plan = await planSkillCacheRecovery({ ...addr(f), action: 'hold' }); const result = await recoverSkillCache(plan, plan.revision); assert.equal(result.status, 'HELD'); assert.equal(result.receipt, null); assert.throws(() => open(f), code('NPM_CACHE_EXISTS')); }
});
test('changed recovery snapshot refuses before acquiring an owner or writing a marker', async t => {
  const f = fixture(t), op = await verified(f); op.release(); const plan = await planSkillCacheRecovery({ ...addr(f), action: 'finalize' });
  fs.chmodSync(path.join(opPath(f), 'files/SKILL.md'), 0o400); const original = inventory(opPath(f)); await assert.rejects(recoverSkillCache(plan, plan.revision), code('NPM_CACHE_FILE')); assert.deepEqual(inventory(opPath(f)), original); assert.equal(fs.existsSync(path.join(opPath(f), 'owner.lock')), false);
});
test('cancellation and release during asynchronous validation cannot produce late payload writes', async t => {
  const f = fixture(t), op = open(f); op.receiving(); const pending = op.stage(f.metadata, f.archive, f.abort.signal); const assertion = assert.rejects(pending, code('NPM_ABORTED')); f.abort.abort(); op.release(); await assertion;
  assert.equal(fs.existsSync(path.join(opPath(f), 'metadata.json')), false); assert.equal(fs.existsSync(path.join(opPath(f), '03-COMPLETED.json')), false);
  const other = fixture(t), early = open(other); early.receiving(); const work = early.stage(other.metadata, other.archive, other.abort.signal); const check = assert.rejects(work, code('NPM_CACHE_RELEASED')); early.release(); await check; assert.equal(fs.existsSync(path.join(opPath(other), 'metadata.json')), false);
});
test('lost final fsync acknowledgement remains uncertain while read-only inspection can find a durable complete marker', async t => {
  const f = fixture(t), op = await verified(f); const openSync = fs.openSync, fsyncSync = fs.fsyncSync; let completionFd, lost = false;
  t.mock.method(fs, 'openSync', function (filename, ...args) { const fd = Reflect.apply(openSync, fs, [filename, ...args]); if (String(filename).endsWith('/03-COMPLETED.json')) completionFd = fd; return fd; });
  t.mock.method(fs, 'fsyncSync', fd => { fsyncSync(fd); if (fd === completionFd && !lost) { lost = true; throw Error('PRIVATE_LOST_ACK'); } });
  await assert.rejects(op.complete(f.abort.signal), e => e.code === 'NPM_CACHE_COMPLETE_UNCERTAIN' && e.message === e.code); op.release(); t.mock.restoreAll();
  assert.equal(lost, true); const status = await inspectSkillCache(addr(f)); assert.equal(status.status, 'COMPLETED'); assert.throws(() => open(f), code('NPM_CACHE_EXISTS'));
});
test('root replacement during awaited decompression refuses before any payload file write', async t => {
  const f = fixture(t), op = open(f); op.receiving(); const pending = op.stage(f.metadata, f.archive, f.abort.signal); const assertion = assert.rejects(pending, code('NPM_CACHE_CHANGED'));
  const old = f.root + '-old'; fs.renameSync(f.root, old); fs.mkdirSync(f.root, { mode: 0o700 }); t.after(() => fs.rmSync(old, { recursive: true, force: true })); await assertion; op.release(); assert.deepEqual(fs.readdirSync(f.root), []); assert.equal(fs.existsSync(path.join(old, 'op-' + f.binding.operationId, 'metadata.json')), false);
});
test('free-space admission precedes operation creation and deadline expiry prevents queued cache writes', async t => {
  const f = fixture(t); t.mock.method(fs, 'statfsSync', () => ({ bavail: 1n, bsize: 1n })); assert.throws(() => open(f), code('NPM_CACHE_SPACE')); assert.deepEqual(fs.readdirSync(f.root), []); t.mock.restoreAll();
  const bounded = fixture(t), op = open(bounded); op.receiving(); const original = performance.now.bind(performance); t.mock.method(performance, 'now', () => original() + 30001); await assert.rejects(op.stage(bounded.metadata, bounded.archive, bounded.abort.signal), code('NPM_TIMEOUT')); op.release(); assert.equal(fs.existsSync(path.join(opPath(bounded), 'metadata.json')), false);
});

test('concurrent exact recoveries have one completion and one refusal under the same operation lock', async t => {
  const f = fixture(t), op = await verified(f); op.release(); const plan = await planSkillCacheRecovery({ ...addr(f), action: 'finalize' });
  const results = await Promise.allSettled([recoverSkillCache(plan, plan.revision), recoverSkillCache(plan, plan.revision)]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1); assert.equal(results.filter(r => r.status === 'rejected').length, 1);
  // The loser either sees the winner's owner lock (stale) or a changed snapshot during its own fresh planning. Both are certain.
  const loser = results.find(r => r.status === 'rejected').reason; assert.ok(refused(loser) && ['NPM_CACHE_RECOVERY_STALE', 'NPM_CACHE_CHANGED'].includes(loser.code), loser.code); assert.equal((await inspectSkillCache(addr(f))).status, 'COMPLETED');
});

test('unsafe ancestors refuse capture, supplied bindings and acquisition before creating an operation', t => {
  const f = fixture(t), parent = path.join(f.root, 'parent'), leaf = path.join(parent, 'cache');
  fs.mkdirSync(parent, { mode: 0o700 }); fs.mkdirSync(leaf, { mode: 0o700 });
  const safe = observeSkillCacheRoot(leaf, 'b'.repeat(32), NPM_LIMITS.storageBytes);
  const plan = planNpmAcquisition(f.request, safe);
  fs.chmodSync(parent, 0o777);
  assert.throws(() => observeSkillCacheRoot(leaf, 'b'.repeat(32), NPM_LIMITS.storageBytes), code('NPM_CACHE_DIRECTORY'));
  assert.throws(() => openNpmCacheOperation(plan, plan.revision, f.abort.signal), e => e.code === 'NPM_CACHE_CHANGED');
  assert.deepEqual(fs.readdirSync(leaf), []);
  fs.chmodSync(parent, 0o1777);
  assert.throws(() => observeSkillCacheRoot(leaf, 'b'.repeat(32), NPM_LIMITS.storageBytes), code('NPM_CACHE_DIRECTORY'));
  fs.chmodSync(parent, 0o700);
  for (const change of [pin => { pin.uid = process.getuid() + 12345; }, pin => { pin.mode = 0o777; }]) {
    const supplied = structuredClone(safe); change(supplied.ancestors[1].identity);
    assert.throws(() => planNpmAcquisition(f.request, supplied), code('NPM_CACHE_INPUT'));
  }
  const original = fs.lstatSync;
  t.mock.method(fs, 'lstatSync', (name, options) => {
    const result = original(name, options);
    if (String(name) === parent) result.uid = typeof result.uid === 'bigint' ? BigInt(process.getuid() + 12345) : process.getuid() + 12345;
    return result;
  });
  assert.throws(() => observeSkillCacheRoot(leaf, 'b'.repeat(32), NPM_LIMITS.storageBytes), code('NPM_CACHE_DIRECTORY'));
  assert.throws(() => openNpmCacheOperation(plan, plan.revision, f.abort.signal), e => e.code === 'NPM_CACHE_CHANGED');
  assert.deepEqual(fs.readdirSync(leaf), []); t.mock.restoreAll();
  const control = openNpmCacheOperation(plan, plan.revision, f.abort.signal); assert.equal(control.release(), true);
});

test('recovery refuses a replacement owner lock after validation without publishing either terminal phase', async t => {
  for (const action of ['finalize', 'hold']) {
    const f = fixture(t), op = action === 'finalize' ? await verified(f) : open(f); op.release();
    const plan = await planSkillCacheRecovery({ ...addr(f), action });
    const lock = path.join(opPath(f), 'owner.lock'), replacement = 'replacement owner stays private\n';
    const statfs = fs.statfsSync; let ownedSpaceChecks = 0, replaced = false;
    t.mock.method(fs, 'statfsSync', (name, options) => {
      const result = statfs(name, options);
      // The first owned allocation observation belongs to load(owned). The next
      // starts terminal-record budgeting, after awaited verifyStored has returned.
      if (String(name) === f.root && fs.existsSync(lock) && ++ownedSpaceChecks === 2) {
        fs.renameSync(lock, path.join(f.root, 'prior-owned-lock'));
        fs.writeFileSync(lock, replacement, { mode: 0o600 }); replaced = true;
      }
      return result;
    });
    await assert.rejects(recoverSkillCache(plan, plan.revision), e => code('NPM_CACHE_RECOVERY_UNCERTAIN')(e) && Array.isArray(e.secondary) && e.secondary.length === 1 && e.secondary[0] === 'NPM_CACHE_RELEASE_UNCERTAIN');
    t.mock.restoreAll(); assert.equal(replaced, true);
    assert.equal(fs.readFileSync(lock, 'utf8'), replacement);
    assert.equal(fs.readdirSync(opPath(f)).some(name => /-(?:COMPLETED|HELD)\.json$/.test(name)), false);
  }
});

test('cache stage checks input types and both byte limits before copying or writing supplied buffers', async t => {
  const f = fixture(t), op = open(f); op.receiving(); const before = inventory(opPath(f));
  const oversizedMetadata = Buffer.alloc(NPM_LIMITS.metadataBytes + 1), oversizedArchive = Buffer.alloc(NPM_LIMITS.compressedBytes + 1), empty = Buffer.alloc(0);
  const invalid = [[oversizedMetadata, f.archive, 'NPM_METADATA'], [f.metadata, oversizedArchive, 'NPM_ARCHIVE_BOUND'], [empty, f.archive, 'NPM_METADATA'], [f.metadata, empty, 'NPM_ARCHIVE_BOUND'], [{ type: 'Buffer', data: [1] }, f.archive, 'NPM_METADATA'], [f.metadata, new Uint8Array(1), 'NPM_ARCHIVE_BOUND']];
  const supplied = new Set(invalid.flatMap(([metadata, archive]) => [metadata, archive])); const original = Buffer.from; let conversions = 0;
  t.mock.method(Buffer, 'from', function (value, ...args) { if (supplied.has(value)) conversions++; return Reflect.apply(original, Buffer, [value, ...args]); });
  for (const [metadata, archive, expected] of invalid) await assert.rejects(op.stage(metadata, archive, f.abort.signal), code(expected));
  t.mock.restoreAll(); assert.equal(conversions, 0); assert.deepEqual(inventory(opPath(f)), before); assert.equal(op.release(), true);
});

test('observed promotion reopens a completed unowned cache and exact selector, never a supplied receipt', async t => {
  const f = fixture(t), op = await verified(f); await op.complete(f.abort.signal);
  const active = await inspectSkillCache(addr(f));
  const select = status => ({ ...addr(f), expectedSnapshotRevision: status.snapshotRevision, expectedReceiptRevision: status.receipt.revision });
  await assert.rejects(readAcquiredSkillCache(select(active), { signal: f.abort.signal, deadlineMs: performance.now() + 1000 }), e => refused(e) && e.code === 'NPM_CACHE_CHANGED');
  op.release(); const status = await inspectSkillCache(addr(f)); const closure = await readAcquiredSkillCache(select(status), { signal: f.abort.signal, deadlineMs: performance.now() + 1000 });
  assert.equal(closure.acquisitionObserved, true); assert.equal(closure.installAuthorized, false);
  assert.deepEqual(closure.files.map(file => file.path), f.plan.request.files.map(file => file.path));
  for (const file of f.files) assert.equal(closure.files.find(entry => entry.path === file.path).text, file.text); assert.ok(Object.isFrozen(closure.files));
  await assert.rejects(readAcquiredSkillCache({ ...select(status), receipt: status.receipt }, { signal: f.abort.signal, deadlineMs: performance.now() + 1000 }), code('NPM_CACHE_INPUT'));
  await assert.rejects(readAcquiredSkillCache(select(active), { signal: f.abort.signal, deadlineMs: performance.now() + 1000 }), code('NPM_CACHE_CHANGED'));
  fs.writeFileSync(path.join(opPath(f), 'files/SKILL.md'), 'changed');
  await assert.rejects(readAcquiredSkillCache(select(status), { signal: f.abort.signal, deadlineMs: performance.now() + 1000 }), code('NPM_CACHE_CHANGED'));
});
test('observed promotion shares caller cancellation and deadline and refuses option getters without invoking them', async t => {
  const f = fixture(t); await completed(f); const status = await inspectSkillCache(addr(f));
  const select = { ...addr(f), expectedSnapshotRevision: status.snapshotRevision, expectedReceiptRevision: status.receipt.revision };
  let calls = 0; await assert.rejects(readAcquiredSkillCache(select, { get signal() { calls++; return f.abort.signal; }, deadlineMs: performance.now() + 1000 }), code('NPM_CACHE_INPUT'));
  await assert.rejects(readAcquiredSkillCache(select, new Proxy({}, { ownKeys() { calls++; return []; } })), code('NPM_CACHE_INPUT')); assert.equal(calls, 0);
  await assert.rejects(readAcquiredSkillCache(select, { signal: f.abort.signal, deadlineMs: performance.now() - 1 }), code('NPM_CACHE_INPUT'));
  // The abort is issued while the read is still pending, after its synchronous part, so the outcome is fixed.
  let settled = false; const pending = readAcquiredSkillCache(select, { signal: f.abort.signal, deadlineMs: performance.now() + 1000 }); pending.then(() => { settled = true; }, () => { settled = true; });
  const assertion = assert.rejects(pending, code('NPM_ABORTED')); assert.equal(settled, false); f.abort.abort(); await assertion; assert.equal(settled, true);
  assert.equal((await inspectSkillCache(addr(f))).status, 'COMPLETED');
});
test('completion refusal before the marker write keeps its fixed inner code and leaves the operation VERIFIED', async t => {
  const f = fixture(t), op = await verified(f); const extra = path.join(opPath(f), 'extra');
  fs.writeFileSync(extra, 'PRIVATE', { mode: 0o600 });
  await assert.rejects(op.complete(f.abort.signal), e => e.code === 'NPM_CACHE_INVENTORY' && e.message === e.code);
  assert.equal(fs.existsSync(path.join(opPath(f), '03-COMPLETED.json')), false);
  fs.unlinkSync(extra); assert.equal(op.release(), true); assert.equal((await inspectSkillCache(addr(f))).status, 'VERIFIED');
});
test('a raw fault before the completion marker write reports NPM_CACHE_COMPLETE_REFUSED and writes no marker', async t => {
  const f = fixture(t), op = await verified(f); const readdirSync = fs.readdirSync; let raised = false;
  t.mock.method(fs, 'readdirSync', function (name, ...args) { if (String(name) === opPath(f)) { raised = true; throw Error('PRIVATE_RAW_FAULT'); } return Reflect.apply(readdirSync, fs, [name, ...args]); });
  await assert.rejects(op.complete(f.abort.signal), e => e.code === 'NPM_CACHE_COMPLETE_REFUSED' && e.message === e.code && !e.message.includes('PRIVATE'));
  t.mock.restoreAll(); assert.equal(raised, true);
  assert.equal(fs.existsSync(path.join(opPath(f), '03-COMPLETED.json')), false); assert.equal(op.release(), true); assert.equal((await inspectSkillCache(addr(f))).status, 'VERIFIED');
});
test('a fault after the completion marker write still reports NPM_CACHE_COMPLETE_UNCERTAIN', async t => {
  const f = fixture(t), op = await verified(f); const readdirSync = fs.readdirSync, marker = path.join(opPath(f), '03-COMPLETED.json'); let raised = false;
  t.mock.method(fs, 'readdirSync', function (name, ...args) { if (String(name) === opPath(f) && fs.existsSync(marker)) { raised = true; throw Error('PRIVATE_LATE_FAULT'); } return Reflect.apply(readdirSync, fs, [name, ...args]); });
  await assert.rejects(op.complete(f.abort.signal), e => e.code === 'NPM_CACHE_COMPLETE_UNCERTAIN' && e.message === e.code);
  t.mock.restoreAll(); assert.equal(raised, true); assert.equal(op.release(), true);
  assert.equal((await inspectSkillCache(addr(f))).status, 'COMPLETED'); assert.throws(() => open(f), code('NPM_CACHE_EXISTS'));
});
test('read-only cache refusals never pass through an unlisted code, and raw faults use each fixed fallback', async t => {
  const f = fixture(t); await completed(f); const status = await inspectSkillCache(addr(f));
  const select = { ...addr(f), expectedSnapshotRevision: status.snapshotRevision, expectedReceiptRevision: status.receipt.revision }, options = () => ({ signal: f.abort.signal, deadlineMs: performance.now() + 1000 });
  const readdirSync = fs.readdirSync; let raised = 0;
  t.mock.method(fs, 'readdirSync', function (name, ...args) { if (String(name) === opPath(f)) { raised++; throw Error('PRIVATE_RAW_FAULT'); } return Reflect.apply(readdirSync, fs, [name, ...args]); });
  await assert.rejects(inspectSkillCache(addr(f)), e => refused(e) && e.code === 'NPM_CACHE_INSPECTION_REFUSED');
  await assert.rejects(planSkillCacheRecovery({ ...addr(f), action: 'finalize' }), e => refused(e) && e.code === 'NPM_CACHE_RECOVERY_REFUSED');
  await assert.rejects(readAcquiredSkillCache(select, options()), e => refused(e) && e.code === 'NPM_CACHE_PROMOTION_REFUSED');
  t.mock.restoreAll(); assert.equal(raised, 3);
  // A payload verification code is not a listed cache guard code, so each boundary keeps its fallback.
  const archive = path.join(opPath(f), 'archive.tgz'), bytes = fs.readFileSync(archive); bytes[bytes.length - 1] ^= 1; fs.writeFileSync(archive, bytes);
  await assert.rejects(inspectSkillCache(addr(f)), e => refused(e) && e.code === 'NPM_CACHE_INSPECTION_REFUSED');
  await assert.rejects(planSkillCacheRecovery({ ...addr(f), action: 'finalize' }), e => refused(e) && e.code === 'NPM_CACHE_RECOVERY_REFUSED');
  // Promotion compares the selected snapshot before it verifies the payload, so the rewritten archive refuses there first.
  await assert.rejects(readAcquiredSkillCache(select, options()), e => refused(e) && e.code === 'NPM_CACHE_CHANGED');
});
test('observed promotion surfaces the fixed inner code of a certain read-only refusal', async t => {
  const f = fixture(t); await completed(f); const status = await inspectSkillCache(addr(f));
  fs.writeFileSync(path.join(opPath(f), 'extra'), 'PRIVATE', { mode: 0o600 });
  await assert.rejects(readAcquiredSkillCache({ ...addr(f), expectedSnapshotRevision: status.snapshotRevision, expectedReceiptRevision: status.receipt.revision }, { signal: f.abort.signal, deadlineMs: performance.now() + 1000 }), e => refused(e) && e.code === 'NPM_CACHE_INVENTORY');
});

test('shared code lists are frozen, name only thrown codes and map every Git cache code explicitly', () => {
  const lists = cache.REFUSAL_CODES; assert.ok(lists && Object.isFrozen(lists));
  for (const [name, list] of Object.entries(lists)) { assert.ok(Array.isArray(list) && Object.isFrozen(list), name); for (const value of list) assert.match(value, /^NPM_[A-Z0-9_]+$/, name); assert.equal(list.includes('NPM_CACHE_IO'), false, name); }
  assert.ok(Object.isFrozen(cache.GIT_CODES) && cache.GIT_CODES.includes('GIT_BASE64'));
  assert.ok(Object.isFrozen(cache.GIT_CACHE_CODES) && cache.GIT_CACHE_CODES.length > 0);
  const npmCodes = new Set(Object.values(lists).flat().concat(cache.SECONDARY_CODES));
  for (const pair of cache.GIT_CACHE_CODES) { assert.ok(Object.isFrozen(pair)); const [from, to] = pair; assert.ok(npmCodes.has(from), from); assert.ok(cache.GIT_CODES.includes(to), to); }
  for (const value of ['NPM_CACHE_COMPLETE_UNCERTAIN', 'NPM_CACHE_RECEIVING_REFUSED', 'NPM_CACHE_RELEASED', 'NPM_TIMEOUT', 'NPM_CACHE_HOLD_UNCERTAIN']) assert.ok(cache.GIT_CACHE_CODES.some(([from]) => from === value), value);
});
test('fixedCode reads a domain code once and gives a TypeError or an unlisted code the fallback', () => {
  const listed = Object.freeze(['NPM_CACHE_CHANGED']);
  assert.equal(cache.fixedCode(new TypeError('NPM_CACHE_CHANGED'), listed, 'NPM_FALLBACK'), 'NPM_FALLBACK');
  assert.equal(cache.fixedCode(new NpmAcquisitionError('NPM_CACHE_CHANGED'), listed, 'NPM_FALLBACK'), 'NPM_CACHE_CHANGED');
  assert.equal(cache.fixedCode(new NpmAcquisitionError('PRIVATE_SENTINEL'), listed, 'NPM_FALLBACK'), 'NPM_FALLBACK');
  let reads = 0; const forged = Object.create(NpmAcquisitionError.prototype, { code: { get() { reads++; return reads === 1 ? 'NPM_CACHE_CHANGED' : 'PRIVATE_SENTINEL'; } } });
  assert.equal(cache.fixedCode(forged, listed, 'NPM_FALLBACK'), 'NPM_CACHE_CHANGED'); assert.equal(reads, 1);
});
test('read and completion boundaries read a forged code once and never return its second value', async t => {
  const forged = () => { let reads = 0; const error = Object.create(NpmAcquisitionError.prototype, { code: { get() { reads++; return reads === 1 ? 'NPM_CACHE_CHANGED' : 'PRIVATE_SENTINEL'; } }, message: { value: 'PRIVATE_SENTINEL' } }); return { error, reads: () => reads }; };
  const f = fixture(t); await completed(f); const readdirSync = fs.readdirSync; let current;
  t.mock.method(fs, 'readdirSync', function (name, ...args) { if (current && String(name) === opPath(current.dir)) throw current.fault.error; return Reflect.apply(readdirSync, fs, [name, ...args]); });
  current = { dir: f, fault: forged() }; await assert.rejects(inspectSkillCache(addr(f)), code('NPM_CACHE_CHANGED')); assert.equal(current.fault.reads(), 1);
  const g = fixture(t); current = undefined; const op = await verified(g);
  current = { dir: g, fault: forged() }; await assert.rejects(op.complete(g.abort.signal), code('NPM_CACHE_CHANGED')); assert.equal(current.fault.reads(), 1);
  current = undefined; t.mock.restoreAll(); assert.equal(op.release(), true);
});
test('a TypeError inside a cache guard reaches the boundary fallback and never a listed guard code', async t => {
  const typed = () => { throw new TypeError('PRIVATE_TYPE'); };
  const f = fixture(t); t.mock.method(fs, 'statfsSync', typed);
  assert.throws(() => open(f), code('NPM_CACHE_OPEN_REFUSED')); assert.deepEqual(fs.readdirSync(f.root), []); t.mock.restoreAll();
  const lstat = fs.lstatSync; t.mock.method(fs, 'lstatSync', function (name, ...args) { if (String(name) === f.root) typed(); return Reflect.apply(lstat, fs, [name, ...args]); });
  assert.throws(() => open(f), code('NPM_CACHE_OPEN_REFUSED')); assert.deepEqual(fs.readdirSync(f.root), []); t.mock.restoreAll();
  const g = fixture(t); await completed(g); const status = await inspectSkillCache(addr(g));
  const select = { ...addr(g), expectedSnapshotRevision: status.snapshotRevision, expectedReceiptRevision: status.receipt.revision };
  t.mock.method(fs, 'statfsSync', typed);
  await assert.rejects(inspectSkillCache(addr(g)), code('NPM_CACHE_INSPECTION_REFUSED'));
  await assert.rejects(planSkillCacheRecovery({ ...addr(g), action: 'finalize' }), code('NPM_CACHE_RECOVERY_REFUSED')); t.mock.restoreAll();
  t.mock.method(fs, 'lstatSync', function (name, ...args) { if (String(name) === opPath(g)) typed(); return Reflect.apply(lstat, fs, [name, ...args]); });
  await assert.rejects(inspectSkillCache(addr(g)), code('NPM_CACHE_INSPECTION_REFUSED'));
  await assert.rejects(readAcquiredSkillCache(select, { signal: g.abort.signal, deadlineMs: performance.now() + 1000 }), code('NPM_CACHE_PROMOTION_REFUSED'));
  t.mock.restoreAll(); assert.equal((await inspectSkillCache(addr(g))).status, 'COMPLETED');
});
test('use after release, an elapsed deadline and a cancelled signal each have their own code', async t => {
  const f = fixture(t), op = open(f); assert.equal(op.release(), true);
  assert.throws(() => op.check(), code('NPM_CACHE_RELEASED')); assert.throws(() => op.receiving(), code('NPM_CACHE_RELEASED'));
  const g = fixture(t), late = open(g); const original = performance.now.bind(performance); t.mock.method(performance, 'now', () => original() + 30001);
  assert.throws(() => late.check(), code('NPM_TIMEOUT')); assert.throws(() => late.receiving(), code('NPM_TIMEOUT')); t.mock.restoreAll(); assert.equal(late.release(), true);
  const h = fixture(t); h.abort.abort(); assert.throws(() => open(h), code('NPM_ABORTED')); assert.deepEqual(fs.readdirSync(h.root), []);
});
test('receiving refuses a raw write fault with a fixed code and keeps phase refusals exact', async t => {
  const f = fixture(t), op = open(f); const openSync = fs.openSync;
  t.mock.method(fs, 'openSync', function (name, ...args) { if (String(name).endsWith('/01-RECEIVING.json')) throw Error('PRIVATE_RAW_FAULT'); return Reflect.apply(openSync, fs, [name, ...args]); });
  assert.throws(() => op.receiving(), code('NPM_CACHE_RECEIVING_REFUSED')); t.mock.restoreAll(); assert.equal(op.release(), true);
  const g = fixture(t), phased = open(g);
  await assert.rejects(phased.stage(g.metadata, g.archive, g.abort.signal), code('NPM_CACHE_PHASE'));
  await assert.rejects(phased.complete(g.abort.signal), code('NPM_CACHE_PHASE'));
  phased.receiving(); assert.throws(() => phased.receiving(), code('NPM_CACHE_PHASE')); assert.equal(phased.release(), true);
});
test('a corrupt first record payload reports NPM_CACHE_RECORD, not caller input', async t => {
  const f = fixture(t), op = open(f); assert.equal(op.release(), true);
  const name = path.join(opPath(f), '00-PREPARED.json'); const record = JSON.parse(fs.readFileSync(name)); const { revision, ...body } = record;
  body.payload = { plan: body.payload.plan }; fs.writeFileSync(name, JSON.stringify({ ...body, revision: revisionOf(body) }) + '\n');
  await assert.rejects(inspectSkillCache(addr(f)), code('NPM_CACHE_RECORD'));
  await assert.rejects(planSkillCacheRecovery({ ...addr(f), action: 'hold' }), code('NPM_CACHE_RECORD'));
});
test('inspection reaches the directory and path guards with exact codes', async t => {
  const f = fixture(t), op = open(f); assert.equal(op.release(), true);
  await assert.rejects(inspectSkillCache({ root: f.root, operationId: 'c'.repeat(32) }), code('NPM_CACHE_DIRECTORY'));
  await assert.rejects(inspectSkillCache({ root: 'relative/cache', operationId: f.binding.operationId }), code('NPM_CACHE_PATH'));
  fs.chmodSync(opPath(f), 0o755); await assert.rejects(inspectSkillCache(addr(f)), code('NPM_CACHE_DIRECTORY')); fs.chmodSync(opPath(f), 0o700);
  assert.equal((await inspectSkillCache(addr(f))).status, 'PREPARED');
});
test('a stale journal found under the recovery lock reports NPM_CACHE_RECOVERY_STALE and releases the lock', async t => {
  const f = fixture(t), op = await verified(f); assert.equal(op.release(), true); const plan = await planSkillCacheRecovery({ ...addr(f), action: 'finalize' });
  const status = await inspectSkillCache(addr(f)); assert.equal(status.status, 'VERIFIED');
  const names = fs.readdirSync(opPath(f)).filter(name => /^\d\d-/.test(name)).sort(); const last = JSON.parse(fs.readFileSync(path.join(opPath(f), names.at(-1))));
  const held = { format: last.format, phase: 'HELD', previous: last.revision, planRevision: last.planRevision, payload: null };
  const lock = path.join(opPath(f), 'owner.lock'), openSync = fs.openSync; let planted = false;
  t.mock.method(fs, 'openSync', function (name, ...args) { const fd = Reflect.apply(openSync, fs, [name, ...args]); if (!planted && String(name) === lock) { planted = true; fs.writeFileSync(path.join(opPath(f), '03-HELD.json'), JSON.stringify({ ...held, revision: revisionOf(held) }) + '\n', { mode: 0o600 }); } return fd; });
  await assert.rejects(recoverSkillCache(plan, plan.revision), code('NPM_CACHE_RECOVERY_STALE')); t.mock.restoreAll();
  assert.equal(planted, true); assert.equal(fs.existsSync(lock), false); assert.equal(fs.existsSync(path.join(opPath(f), '03-COMPLETED.json')), false);
  assert.equal((await inspectSkillCache(addr(f))).status, 'HELD');
});
test('an elapsed promotion deadline reports NPM_TIMEOUT, not NPM_ABORTED', async t => {
  const f = fixture(t); await completed(f); const status = await inspectSkillCache(addr(f));
  const select = { ...addr(f), expectedSnapshotRevision: status.snapshotRevision, expectedReceiptRevision: status.receipt.revision };
  const original = performance.now.bind(performance); let offset = 0; t.mock.method(performance, 'now', () => original() + offset);
  const readdirSync = fs.readdirSync; t.mock.method(fs, 'readdirSync', function (name, ...args) { if (String(name) === opPath(f)) offset = 2000; return Reflect.apply(readdirSync, fs, [name, ...args]); });
  await assert.rejects(readAcquiredSkillCache(select, { signal: f.abort.signal, deadlineMs: original() + 1000 }), code('NPM_TIMEOUT'));
  t.mock.restoreAll(); assert.equal(f.abort.signal.aborted, false);
});

test('a failed record write is never held beside, and hold reports it', async t => {
  const f = fixture(t), op = open(f); const openSync = fs.openSync, fsyncSync = fs.fsyncSync; let fd;
  t.mock.method(fs, 'openSync', function (name, ...args) { const result = Reflect.apply(openSync, fs, [name, ...args]); if (String(name).endsWith('/01-RECEIVING.json')) fd = result; return result; });
  t.mock.method(fs, 'fsyncSync', descriptor => { fsyncSync(descriptor); if (descriptor === fd) throw Error('PRIVATE_FSYNC'); });
  assert.throws(() => op.receiving(), code('NPM_CACHE_RECEIVING_REFUSED')); t.mock.restoreAll();
  assert.equal(op.hold(), 'NPM_CACHE_HOLD_UNCERTAIN'); assert.equal(fs.existsSync(path.join(opPath(f), '01-HELD.json')), false); assert.equal(op.release(), true);
});
test('hold ignores the signal and the deadline, and reports a guard refusal as not held', async t => {
  const f = fixture(t), op = open(f); op.receiving(); f.abort.abort(); assert.equal(op.hold(), null); assert.equal(op.release(), true);
  assert.equal((await inspectSkillCache(addr(f))).status, 'HELD');
  const g = fixture(t), late = open(g); late.receiving(); const original = performance.now.bind(performance); t.mock.method(performance, 'now', () => original() + 30001);
  assert.equal(late.hold(), null); t.mock.restoreAll(); assert.equal(late.release(), true); assert.equal((await inspectSkillCache(addr(g))).status, 'HELD');
  const h = fixture(t), guarded = open(h); guarded.receiving(); fs.chmodSync(h.root, 0o755);
  assert.equal(guarded.hold(), 'NPM_CACHE_NOT_HELD'); fs.chmodSync(h.root, 0o700); assert.equal(fs.existsSync(path.join(opPath(h), '02-HELD.json')), false); assert.equal(guarded.release(), true);
  const r = fixture(t), released = open(r); released.receiving(); assert.equal(released.release(), true); assert.equal(released.hold(), 'NPM_CACHE_NOT_HELD');
});
test('a planning TypeError inside a stored plan keeps the inspection fallback, never NPM_CACHE_RECORD', async t => {
  const f = fixture(t), op = open(f); assert.equal(op.release(), true); const from = Buffer.from, integrity = f.request.integrity.slice(7);
  t.mock.method(Buffer, 'from', function (value, ...args) { if (args[0] === 'base64' && value === integrity) throw new TypeError('PRIVATE_TYPE'); return Reflect.apply(from, Buffer, [value, ...args]); });
  await assert.rejects(inspectSkillCache(addr(f)), code('NPM_CACHE_INSPECTION_REFUSED'));
  await assert.rejects(planSkillCacheRecovery({ ...addr(f), action: 'hold' }), code('NPM_CACHE_RECOVERY_REFUSED')); t.mock.restoreAll();
});
test('a refusal after the operation folder exists reports NPM_CACHE_OPEN_PARTIAL', t => {
  const f = fixture(t), openSync = fs.openSync;
  t.mock.method(fs, 'openSync', function (name, ...args) { if (String(name).endsWith('/00-PREPARED.json')) throw Error('PRIVATE_OPEN'); return Reflect.apply(openSync, fs, [name, ...args]); });
  assert.throws(() => open(f), e => code('NPM_CACHE_OPEN_REFUSED')(e) && e.secondary.join() === 'NPM_CACHE_OPEN_PARTIAL'); t.mock.restoreAll();
  assert.throws(() => open(f), e => code('NPM_CACHE_EXISTS')(e) && e.secondary.length === 0);
  const g = fixture(t); t.mock.method(fs, 'statfsSync', () => ({ bavail: 1n, bsize: 1n }));
  assert.throws(() => open(g), e => code('NPM_CACHE_SPACE')(e) && e.secondary.length === 0); t.mock.restoreAll();
});
test('fixedCode gives the fallback when a forged error throws from its prototype or its code getter', () => {
  const listed = Object.freeze(['NPM_CACHE_CHANGED']);
  const getter = Object.create(NpmAcquisitionError.prototype, { code: { get() { throw Error('PRIVATE_GETTER'); } } });
  assert.equal(cache.fixedCode(getter, listed, 'NPM_FALLBACK'), 'NPM_FALLBACK');
  const proxy = new Proxy({}, { getPrototypeOf() { throw Error('PRIVATE_PROTO'); } });
  assert.equal(cache.fixedCode(proxy, listed, 'NPM_FALLBACK'), 'NPM_FALLBACK');
});
test('refusalSummary names only listed codes and marks uncertain or secondary-bearing refusals', () => {
  const summary = cache.refusalSummary; assert.equal(typeof summary, 'function');
  assert.deepEqual(summary(new NpmAcquisitionError('NPM_CACHE_EXISTS')), { uncertain: false, codes: ['NPM_CACHE_EXISTS'] });
  assert.deepEqual(summary(new NpmAcquisitionError('NPM_CACHE_COMPLETE_UNCERTAIN')), { uncertain: true, codes: ['NPM_CACHE_COMPLETE_UNCERTAIN'] });
  assert.deepEqual(summary(new NpmAcquisitionError('NPM_INTEGRITY', ['NPM_CACHE_RELEASE_UNCERTAIN', 'PRIVATE_SECONDARY'])), { uncertain: true, codes: ['NPM_INTEGRITY', 'NPM_CACHE_RELEASE_UNCERTAIN'] });
  assert.deepEqual(summary(new NpmAcquisitionError('NPM_ACQUISITION_FAILED', ['NPM_CACHE_NOT_HELD'])), { uncertain: true, codes: ['NPM_ACQUISITION_FAILED', 'NPM_CACHE_NOT_HELD'] });
  for (const value of [new NpmAcquisitionError('PRIVATE_SENTINEL_UNCERTAIN'), new TypeError('NPM_CACHE_COMPLETE_UNCERTAIN'), null, 'NPM_CACHE_COMPLETE_UNCERTAIN', new Proxy({}, { getPrototypeOf() { throw Error('PRIVATE'); } })]) assert.deepEqual(summary(value), { uncertain: false, codes: [] });
});

test('a partial open folder refuses inspect, recovery planning and recovery with NPM_CACHE_RECORD and keeps its bytes', async t => {
  const f = fixture(t), openSync = fs.openSync;
  t.mock.method(fs, 'openSync', function (name, ...args) { if (String(name).endsWith('/00-PREPARED.json')) throw Error('PRIVATE_OPEN'); return Reflect.apply(openSync, fs, [name, ...args]); });
  assert.throws(() => open(f), e => code('NPM_CACHE_OPEN_REFUSED')(e) && e.secondary.join() === 'NPM_CACHE_OPEN_PARTIAL'); t.mock.restoreAll();
  const before = inventory(f.root);
  await assert.rejects(inspectSkillCache(addr(f)), code('NPM_CACHE_RECORD'));
  await assert.rejects(planSkillCacheRecovery({ ...addr(f), action: 'hold' }), code('NPM_CACHE_RECORD'));
  const supplied = { format: 'bowerloom/npm-cache-recovery-plan/v1beta1', action: 'hold', ...addr(f), snapshotRevision: '0'.repeat(64), originalPlanRevision: '0'.repeat(64), revision: '0'.repeat(64) };
  await assert.rejects(recoverSkillCache(supplied, '0'.repeat(64)), code('NPM_CACHE_RECORD'));
  assert.deepEqual(inventory(f.root), before);
});
