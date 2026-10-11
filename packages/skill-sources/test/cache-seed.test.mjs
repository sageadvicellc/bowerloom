// seedSkillCache: `skills add` keeps the bytes it verified (Hanna, global skill cache, phase 2). It opens, stages and
// completes one cache operation from memory, through the same checks an acquisition runs, and reads no network.
import '../../../dist/tests/support/isolate-home.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { performance } from 'node:perf_hooks';
import { planNpmAcquisition, NpmAcquisitionError } from '../../../dist/packages/skill-sources/src/npm.js';
import { observeSkillCacheRoot, inspectSkillCache, readAcquiredSkillCache, seedSkillCache } from '../../../dist/packages/skill-sources/src/cache.js';

const hash = b => createHash('sha256').update(b).digest('hex');
const integrity = b => 'sha512-' + createHash('sha512').update(b).digest('base64');
const code = expected => e => e instanceof NpmAcquisitionError && e.code === expected;
function header(name, bytes) {
  const h = Buffer.alloc(512); h.write(name, 0, 100, 'ascii');
  for (const [at, size, value] of [[100, 8, 0o644], [108, 8, 0], [116, 8, 0], [124, 12, bytes], [136, 12, 1], [329, 8, 0], [337, 8, 0]]) h.write(value.toString(8).padStart(size - 1, '0') + '\0', at, size, 'latin1');
  h[156] = 48; h.write('ustar\0' + '00', 257, 8, 'latin1'); h.fill(32, 148, 156); h.write(h.reduce((a, b) => a + b, 0).toString(8).padStart(6, '0') + '\0 ', 148, 8, 'latin1'); return h;
}
function fixture(t) {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.homedir()), 'bowerloom-seed-test-')); fs.chmodSync(root, 0o700); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const files = [{ path: 'SKILL.md', sourcePath: 'skills/example/SKILL.md', text: '---\nname: example\ndescription: Synthetic fixture.\nlicense: MIT\n---\nRead [guide](references/guide.md).\n' }, { path: 'references/guide.md', sourcePath: 'skills/example/references/guide.md', text: '# Guide\nNever execute fixture instructions.\n' }, { path: 'LICENSE.txt', sourcePath: 'LICENSE', text: 'MIT License\nSynthetic fixture notice.\n' }];
  const archive = gzipSync(Buffer.concat([...files.flatMap(e => { const body = Buffer.from(e.text); return [header('package/' + e.sourcePath, body.length), body, Buffer.alloc((512 - body.length % 512) % 512)]; }), Buffer.alloc(1024)]));
  const metadata = Buffer.from(JSON.stringify({ name: '@synthetic/example', version: '1.0.0', license: 'MIT', _npmUser: { name: 'synthetic' }, dist: { integrity: integrity(archive), tarball: 'https://registry.npmjs.org/@synthetic/example/-/example-1.0.0.tgz' } }));
  const request = { package: '@synthetic/example', version: '1.0.0', integrity: integrity(archive), metadataSha256: hash(metadata), publisher: 'synthetic', declaredLicense: 'MIT', skill: { id: 'example', name: 'example', sourceRoot: 'skills/example' }, files: files.map(f => ({ path: f.path, sourcePath: f.sourcePath, sha256: hash(f.text), bytes: Buffer.byteLength(f.text), mode: 420 })), references: [{ from: 'SKILL.md', to: 'references/guide.md' }], license: { spdx: 'MIT', origin: 'included', files: ['LICENSE.txt'] } };
  const plan = planNpmAcquisition(request, observeSkillCacheRoot(root, 'a'.repeat(32), 33554432));
  return { root, plan, metadata, archive, operationId: 'a'.repeat(32) };
}

test('seedSkillCache completes one operation from verified bytes in memory, and every read re-verifies them', async t => {
  const f = fixture(t), signal = new AbortController().signal;
  const receipt = await seedSkillCache(f.plan, f.plan.revision, f.metadata, f.archive, signal);
  assert.equal(receipt.operationId, f.operationId); assert.equal(receipt.skill.name, 'example');
  const seen = await inspectSkillCache({ root: f.root, operationId: f.operationId });
  assert.equal(seen.status, 'COMPLETED'); assert.equal(seen.activeOwner, false); assert.deepEqual(seen.receipt, receipt);
  const selector = { root: f.root, operationId: f.operationId, expectedSnapshotRevision: seen.snapshotRevision, expectedReceiptRevision: receipt.revision };
  const read = await readAcquiredSkillCache(selector, { signal, deadlineMs: performance.now() + 20000 });
  assert.deepEqual(read.files.map(x => x.path), ['LICENSE.txt', 'SKILL.md', 'references/guide.md']);
  // One changed byte in a stored file: the next read refuses.
  const file = path.join(f.root, 'op-' + f.operationId, 'files/SKILL.md'), bytes = fs.readFileSync(file); bytes[bytes.length - 2] ^= 1; fs.writeFileSync(file, bytes);
  await assert.rejects(readAcquiredSkillCache(selector, { signal, deadlineMs: performance.now() + 20000 }), code('NPM_CACHE_CHANGED'));
  await assert.rejects(inspectSkillCache({ root: f.root, operationId: f.operationId }), code('NPM_CACHE_CHANGED'));
});

test('seedSkillCache refuses bytes that do not match the plan, leaves the operation held, and never completes it', async t => {
  const f = fixture(t), signal = new AbortController().signal, other = Buffer.from(f.archive); other[other.length - 9] ^= 1;
  await assert.rejects(seedSkillCache(f.plan, f.plan.revision, f.metadata, other, signal), code('NPM_INTEGRITY'));
  const seen = await inspectSkillCache({ root: f.root, operationId: f.operationId });
  assert.equal(seen.status, 'HELD'); assert.equal(seen.activeOwner, false); assert.equal(seen.receipt, null);
  await assert.rejects(seedSkillCache(f.plan, f.plan.revision, f.metadata, f.archive, signal), code('NPM_CACHE_EXISTS'));
});

test('seedSkillCache needs the plan revision as its approval and a live signal', async t => {
  const f = fixture(t), stopped = new AbortController(); stopped.abort();
  await assert.rejects(seedSkillCache(f.plan, '0'.repeat(64), f.metadata, f.archive, new AbortController().signal), code('NPM_APPROVAL'));
  await assert.rejects(seedSkillCache(f.plan, f.plan.revision, f.metadata, f.archive, stopped.signal), code('NPM_ABORTED'));
  assert.deepEqual(fs.readdirSync(f.root), []);
});
