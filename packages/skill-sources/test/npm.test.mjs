import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import https from 'node:https';
import dns from 'node:dns/promises';
import childProcess from 'node:child_process';
import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { performance } from 'node:perf_hooks';
import { Header } from 'tar/header';
import { planNpmAcquisition, acquireNpmSkill, verifyNpmPayload, enumerateNpmTar, NpmAcquisitionError, NPM_LIMITS } from '../../../dist/packages/skill-sources/src/npm.js';
import { observeSkillCacheRoot, inspectSkillCache } from '../../../dist/packages/skill-sources/src/cache.js';
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
function network(t, f, select = () => ({})) {
  const calls = [], responses = [], dnsCalls = []; let nativeStarts = 0;
  t.mock.method(childProcess, 'spawn', () => { nativeStarts++; throw Error('PRIVATE_NATIVE'); });
  t.mock.method(dns, 'lookup', async (host, options) => { dnsCalls.push({ host, options }); return [{ address: '104.16.25.34', family: 4 }]; });
  t.mock.method(https, 'request', (url, options, callback) => {
    const req = new EventEmitter(); req.destroyed = false; req.destroy = () => { req.destroyed = true; return req; };
    req.end = () => { calls.push({ url, options, req }); const chosen = select(calls.length, req) ?? {}; queueMicrotask(() => {
      if (req.destroyed && !chosen.late) return;
      if (chosen.error) { req.emit('error', chosen.error); return; }
      if (chosen.stall) return;
      const body = chosen.body ?? (calls.length === 1 ? f.metadata : f.archive);
      const response = new EventEmitter(); response.destroyed = false; response.destroy = () => { response.destroyed = true; return response; }; response.statusCode = chosen.status ?? 200; response.complete = chosen.complete ?? true; response.rawHeaders = chosen.headers ?? ['Content-Length', String(body.length)]; responses.push(response); callback(response);
      if (!response.destroyed) { for (const chunk of chosen.chunks ?? [body]) response.emit('data', chunk); if (!chosen.noEnd) response.emit('end'); }
    }); return req; }; return req;
  });
  return { calls, responses, dnsCalls, nativeStarts: () => nativeStarts };
}
const run = f => acquireNpmSkill(f.plan, { approvalRevision: f.plan.revision, signal: f.abort.signal });

test('pure plan detaches data, binds every limit/path and refuses getters or stale approval before contact', async t => {
  const f = fixture(t), n = network(t, f); const bad = structuredClone(f.plan); bad.request.version = 'latest'; await assert.rejects(acquireNpmSkill(bad, { approvalRevision: bad.revision, signal: f.abort.signal }), code('NPM_INPUT'));
  await assert.rejects(acquireNpmSkill(f.plan, { approvalRevision: '0'.repeat(64), signal: f.abort.signal }), code('NPM_APPROVAL'));
  let invoked = 0; const getter = { ...f.request }; Object.defineProperty(getter, 'package', { get() { invoked++; return '@synthetic/example'; }, enumerable: true }); assert.throws(() => planNpmAcquisition(getter, f.binding), code('NPM_INPUT'));
  assert.throws(() => planNpmAcquisition(new Proxy({}, { ownKeys() { invoked++; return []; } }), f.binding), code('NPM_INPUT'));
  assert.equal(invoked, 0); assert.equal(n.calls.length, 0); assert.deepEqual(fs.readdirSync(f.root), []); assert.ok(Object.isFrozen(f.plan.request.files[0]));
});
test('two exact GETs create observed cache evidence, without running package scripts or claiming install authority', async t => {
  const f = fixture(t, [{ sourcePath: 'bin/checks.mjs', text: 'throw Error("NEVER_EXECUTE_PRIVATE")', mode: 0o755 }]); const n = network(t, f);
  const receipt = await run(f); assert.equal(receipt.format, 'bowerloom/acquired-skill-cache/v1beta1'); assert.equal(receipt.source.archiveSha256, hash(f.archive));
  for (const field of ['publisherAuthenticated', 'installAuthorized', 'executionAuthorized']) assert.equal(receipt[field], false);
  assert.equal(n.calls.length, 2); assert.equal(n.dnsCalls.length, 1); assert.equal(n.nativeStarts(), 0); assert.deepEqual(n.calls.map(c => c.url), [f.plan.metadataUrl, f.plan.archiveUrl]);
  for (const { options } of n.calls) { assert.equal(options.rejectUnauthorized, true); assert.equal(options.minVersion, 'TLSv1.2'); assert.deepEqual(Object.keys(options.headers).sort(), ['Accept', 'Accept-Encoding', 'User-Agent']); assert.equal(options.agent.options.keepAlive, false); }
  const status = await inspectSkillCache({ root: f.root, operationId: f.binding.operationId }); assert.equal(status.status, 'COMPLETED'); assert.equal(status.activeOwner, false); assert.deepEqual(status.receipt, receipt);
  await assert.rejects(run(f), code('NPM_CACHE_EXISTS')); assert.equal(n.calls.length, 2);
});
test('registry metadata and integrity are exact pins, with no redirect/auth/header retries', async t => {
  for (const [response, expected] of [[{ status: 302, headers: ['Location', 'https://evil.example/a'] }, 'NPM_RESPONSE'], [{ status: 401 }, 'NPM_RESPONSE'], [{ headers: ['Content-Encoding', 'gzip'] }, 'NPM_RESPONSE'], [{ headers: ['Content-Length', '1', 'Content-Length', '1'] }, 'NPM_RESPONSE'], [{ body: Buffer.from('PRIVATE_METADATA') }, 'NPM_METADATA'], [{ complete: false }, 'NPM_RESPONSE']]) {
    const f = fixture(t), n = network(t, f, () => response); await assert.rejects(run(f), code(expected)); assert.equal(n.calls.length, 1); t.mock.restoreAll();
  }
  const f = fixture(t), n = network(t, f, count => count === 2 ? { body: Buffer.from('WRONG_ARCHIVE') } : {}); await assert.rejects(run(f), e => e.code === 'NPM_INTEGRITY'); assert.equal(n.calls.length, 2);
});
test('forged transport errors cannot leak typed messages and special-use DNS never contacts HTTP', async t => {
  // A private IPv4 answer is a rebinding signal with its own code. An answer outside IPv4 stays a DNS refusal.
  for (const [address, expected] of [['127.0.0.1', 'NPM_NONPUBLIC_ADDRESS'], ['10.0.0.1', 'NPM_NONPUBLIC_ADDRESS'], ['169.254.1.1', 'NPM_NONPUBLIC_ADDRESS'], ['192.0.0.8', 'NPM_NONPUBLIC_ADDRESS'], ['::ffff:127.0.0.1', 'NPM_DNS'], ['2606:4700::1', 'NPM_DNS']]) {
    const f = fixture(t), n = network(t, f); t.mock.method(dns, 'lookup', async () => [{ address, family: address.includes(':') ? 6 : 4 }]); await assert.rejects(run(f), code(expected)); assert.equal(n.calls.length, 0); t.mock.restoreAll();
  }
  const f = fixture(t); network(t, f); t.mock.method(dns, 'lookup', async () => { throw new NpmAcquisitionError('PRIVATE_SENTINEL'); }); await assert.rejects(run(f), e => e.code === 'NPM_DNS' && !e.message.includes('PRIVATE'));
});
test('cancellation before work and during late DNS prevents every late request and cache completion', async t => {
  const pre = fixture(t); const initial = network(t, pre); pre.abort.abort(); await assert.rejects(run(pre), code('NPM_ABORTED')); assert.equal(initial.dnsCalls.length, 0); assert.deepEqual(fs.readdirSync(pre.root), []); t.mock.restoreAll();
  const f = fixture(t), n = network(t, f); let resolveDns; t.mock.method(dns, 'lookup', () => new Promise(resolve => { resolveDns = resolve; })); const pending = run(f); const assertion = assert.rejects(pending, code('NPM_ABORTED')); await tick(); f.abort.abort(); await assertion; resolveDns([{ address: '104.16.25.34', family: 4 }]); await tick(); assert.equal(n.calls.length, 0);
  assert.equal(fs.existsSync(path.join(f.root, 'op-' + f.binding.operationId, '03-COMPLETED.json')), false);
});
test('late DNS rejection is observed and stalled response cancellation destroys owned requests', async t => {
  const f = fixture(t), n = network(t, f, () => ({ stall: true })); const pending = run(f); const assertion = assert.rejects(pending, code('NPM_ABORTED')); await tick(); f.abort.abort(); await assertion; assert.equal(n.calls.length, 1); assert.ok(n.calls[0].req.destroyed); t.mock.restoreAll();
  const late = fixture(t), rejected = []; const unhandled = e => rejected.push(e); process.on('unhandledRejection', unhandled); t.after(() => process.off('unhandledRejection', unhandled)); network(t, late); let rejectDns; t.mock.method(dns, 'lookup', () => new Promise((_, reject) => { rejectDns = reject; })); const work = run(late); const checked = assert.rejects(work, code('NPM_ABORTED')); await tick(); late.abort.abort(); await checked; rejectDns(Error('PRIVATE_LATE')); await tick(); await tick(); assert.deepEqual(rejected, []);
});
test('elapsed deadline is checked after DNS even if its timeout callback has not run', async t => {
  const f = fixture(t), n = network(t, f); const original = performance.now.bind(performance); let advance = 0; t.mock.method(performance, 'now', () => original() + advance);
  t.mock.method(dns, 'lookup', async () => { advance = 30001; return [{ address: '104.16.25.34', family: 4 }]; }); await assert.rejects(run(f), code('NPM_TIMEOUT')); assert.equal(n.calls.length, 0);
});
test('N1 original header fields refuse aliasing, nonzero directory bodies and ambiguous numeric/string forms', () => {
  const good = header('package/a.md', 0); assert.equal(enumerateNpmTar(Buffer.concat([good, Buffer.alloc(1024)]), () => {}).recordCount, 1);
  const mutations = [[h => { h[156] = 53; h.write('package/a/', 0); h.fill(0, 10, 100); h.write('00000000001\0', 124, 12, 'latin1'); }, 'NPM_TAR_ALIAS'], [h => { h.fill(0, 0, 100); h.write('package/a/'); }, 'NPM_TAR_ALIAS'], [h => h.write('0000000000x\0', 124, 12, 'latin1'), 'NPM_TAR_NUMBER'], [h => h.write('-0000000001\0', 124, 12, 'latin1'), 'NPM_TAR_NUMBER'], [h => h[124] = 128, 'NPM_TAR_NUMBER'], [h => { h[10] = 0; h[11] = 65; }, 'NPM_TAR_FIELD'], [h => h[156] = 0, 'NPM_TAR_TYPE'], [h => h[156] = 120, 'NPM_TAR_TYPE'], [h => h[156] = 103, 'NPM_TAR_TYPE'], [h => h[156] = 50, 'NPM_TAR_TYPE'], [h => h[257] = 32, 'NPM_TAR_SIGNATURE']];
  for (const [mutate, expected] of mutations) { const h = Buffer.from(good); mutate(h); checksum(h); assert.throws(() => enumerateNpmTar(Buffer.concat([h, Buffer.alloc(1024)]), () => {}), { code: expected }); }
});
test('Header agreement is required, independent of raw preflight acceptance', t => {
  const original = Header.prototype.decode; t.mock.method(Header.prototype, 'decode', function (...args) { const result = Reflect.apply(original, this, args); this.size = (this.size ?? 0) + 512; return result; });
  assert.throws(() => enumerateNpmTar(Buffer.concat([header('package/a.md', 0), Buffer.alloc(1024)]), () => {}), e => e.code === 'NPM_TAR_DECODER');
});
test('archive records, endings, checksums, paths and padding have finite strict bounds', () => {
  // The bad checksum changes one octal digit of the mtime field, so every earlier field check still passes.
  const empty = header('package/a.md', 0); const badChecksum = Buffer.from(empty); badChecksum[136] = 0x32;
  const cases = [[Buffer.concat([empty, Buffer.alloc(512)]), 'NPM_TAR_END'], [Buffer.concat([empty, Buffer.alloc(1024), empty]), 'NPM_TAR_END'], [Buffer.concat([badChecksum, Buffer.alloc(1024)]), 'NPM_TAR_CHECKSUM'], [Buffer.concat([empty, empty, Buffer.alloc(1024)]), 'NPM_TAR_COLLISION'], [Buffer.concat([header('package/../a', 0), Buffer.alloc(1024)]), 'NPM_TAR_PATH'], [Buffer.concat([header('package/A.md', 0), empty, Buffer.alloc(1024)]), 'NPM_TAR_COLLISION'], [Buffer.concat([header('package/a', 0), header('package/a/child.md', 0), Buffer.alloc(1024)]), 'NPM_TAR_COLLISION']];
  for (const [data, expected] of cases) assert.throws(() => enumerateNpmTar(data, () => {}), { code: expected });
  const many = Array.from({ length: 1025 }, (_, i) => header(`package/${i}.md`, 0)); assert.throws(() => enumerateNpmTar(Buffer.concat([...many, Buffer.alloc(1024)]), () => {}), e => e.code === 'NPM_TAR_BOUND');
  const padded = tar([{ sourcePath: 'a.md', text: 'a' }]); padded[513] = 1; assert.throws(() => enumerateNpmTar(padded, () => {}), code('NPM_TAR_BOUND'));
});
test('extra selected files and altered selected modes cannot be hidden by the expected inventory', async t => {
  const f = fixture(t, [{ sourcePath: 'skills/example/hidden.md', text: '# Hidden\n' }]); await assert.rejects(verifyNpmPayload(f.plan, f.metadata, f.archive, f.abort.signal, () => {}), e => e.code === 'NPM_SELECTED_INVENTORY');
});
test('strict metadata refuses duplicate keys and large response production stops without retry', async t => {
  const f = fixture(t), body = Buffer.from('{"name":"a","name":"b"}'); const request = { ...f.request, metadataSha256: hash(body) }; f.plan = planNpmAcquisition(request, f.binding); f.metadata = body; const n = network(t, f); await assert.rejects(run(f), e => e.code === 'NPM_METADATA'); assert.equal(n.calls.length, 1); t.mock.restoreAll();
  const large = fixture(t), m = network(t, large, () => ({ headers: [], chunks: [Buffer.alloc(NPM_LIMITS.metadataBytes + 1)] })); await assert.rejects(run(large), code('NPM_RESPONSE_BOUND')); assert.equal(m.calls.length, 1); assert.ok(m.responses[0].destroyed);
});
test('buffer input mutation during decompression cannot change the selected observed bytes', async t => {
  const f = fixture(t); const archiveHash = hash(f.archive); const work = verifyNpmPayload(f.plan, f.metadata, f.archive, f.abort.signal, () => {}); f.archive.fill(0); f.metadata.fill(0); const result = await work; assert.equal(result.source.archiveSha256, archiveHash); assert.equal(result.files.length, 3);
});

function replaceArchive(f, bytes, updateExpected = false) {
  f.archive = gzipSync(bytes); const metadata = JSON.parse(f.metadata); metadata.dist.integrity = integrity(f.archive); f.metadata = Buffer.from(JSON.stringify(metadata));
  f.request.integrity = integrity(f.archive); f.request.metadataSha256 = hash(f.metadata);
  if (updateExpected) f.request.files = f.files.map(file => ({ path: file.path, sourcePath: file.sourcePath, sha256: hash(file.text), bytes: Buffer.byteLength(file.text), mode: 420 }));
  f.plan = planNpmAcquisition(f.request, f.binding);
}
test('source controls, explicit license conflict, missing references and executable selected modes refuse after valid integrity', async t => {
  for (const mutate of [f => f.files[0].text += '\u001b[31m', f => f.files[0].text = f.files[0].text.replace('license: MIT', 'license: Apache-2.0'), f => f.files[1].text += '[missing](absent.md)', f => f.files[2].text = 'Not a license']) {
    const f = fixture(t); mutate(f); replaceArchive(f, tar(f.files), true); await assert.rejects(verifyNpmPayload(f.plan, f.metadata, f.archive, f.abort.signal, () => {}), e => e.code === 'NPM_CONTENT');
  }
  const mode = fixture(t); mode.files[1].mode = 0o755; replaceArchive(mode, tar(mode.files)); await assert.rejects(verifyNpmPayload(mode.plan, mode.metadata, mode.archive, mode.abort.signal, () => {}), e => e.code === 'NPM_SELECTED_INVENTORY');
});
test('decompression production and compressed input are bounded before archive enumeration', async t => {
  const f = fixture(t); replaceArchive(f, Buffer.alloc(NPM_LIMITS.tarBytes + 512)); await assert.rejects(verifyNpmPayload(f.plan, f.metadata, f.archive, f.abort.signal, () => {}), e => e.code === 'NPM_TAR_BOUND');
  await assert.rejects(verifyNpmPayload(f.plan, f.metadata, Buffer.alloc(NPM_LIMITS.compressedBytes + 1), f.abort.signal, () => {}), e => e.code === 'NPM_ARCHIVE_BOUND');
});
test('a response delivered after cancellation is destroyed and never retained for later completion', async t => {
  const f = fixture(t); const n = network(t, f, () => { f.abort.abort(); return { late: true }; }); await assert.rejects(run(f), code('NPM_ABORTED')); await tick(); assert.equal(n.calls.length, 1); assert.ok(n.calls[0].req.destroyed); assert.ok(n.responses.every(r => r.destroyed)); assert.equal(fs.existsSync(path.join(f.root, 'op-' + f.binding.operationId, '03-COMPLETED.json')), false);
});

test('lost owner-release acknowledgement cannot return a successful acquisition receipt', async t => {
  const f = fixture(t), n = network(t, f); const unlink = fs.unlinkSync, sync = fs.fsyncSync; let releasing = false;
  t.mock.method(fs, 'unlinkSync', filename => { unlink(filename); if (String(filename).endsWith('/owner.lock')) releasing = true; });
  t.mock.method(fs, 'fsyncSync', fd => { sync(fd); if (releasing) { releasing = false; throw Error('PRIVATE_RELEASE_ACK'); } });
  await assert.rejects(run(f), e => e.code === 'NPM_CACHE_RELEASE_UNCERTAIN'); assert.equal(n.calls.length, 2); t.mock.restoreAll();
  const result = await inspectSkillCache({ root: f.root, operationId: f.binding.operationId }); assert.equal(result.status, 'COMPLETED'); assert.equal(result.activeOwner, false);
});

test('payload verifier refuses oversized, empty and non-Buffer inputs before detachment', async t => {
  const f = fixture(t);
  const oversizedMetadata = Buffer.alloc(NPM_LIMITS.metadataBytes + 1), oversizedArchive = Buffer.alloc(NPM_LIMITS.compressedBytes + 1), empty = Buffer.alloc(0);
  const invalid = [[oversizedMetadata, f.archive, 'NPM_METADATA'], [f.metadata, oversizedArchive, 'NPM_ARCHIVE_BOUND'], [empty, f.archive, 'NPM_METADATA'], [f.metadata, empty, 'NPM_ARCHIVE_BOUND'], [{ type: 'Buffer', data: [1] }, f.archive, 'NPM_METADATA'], [f.metadata, new Uint8Array(1), 'NPM_ARCHIVE_BOUND']];
  const supplied = new Set(invalid.flatMap(([metadata, archive]) => [metadata, archive])); const original = Buffer.from; let conversions = 0;
  t.mock.method(Buffer, 'from', function (value, ...args) { if (supplied.has(value)) conversions++; return Reflect.apply(original, Buffer, [value, ...args]); });
  for (const [metadata, archive, code] of invalid) await assert.rejects(verifyNpmPayload(f.plan, metadata, archive, f.abort.signal, () => {}), error => error.code === code);
  t.mock.restoreAll(); assert.equal(conversions, 0); assert.deepEqual(fs.readdirSync(f.root), []);
});
test('npm acquisition keeps uncertain completion, certain completion refusal and stage refusal codes visible', async t => {
  const lost = fixture(t), n = network(t, lost), openSync = fs.openSync, fsyncSync = fs.fsyncSync; let completionFd, dropped = false;
  t.mock.method(fs, 'openSync', function (filename, ...args) { const fd = Reflect.apply(openSync, fs, [filename, ...args]); if (String(filename).endsWith('/03-COMPLETED.json')) completionFd = fd; return fd; });
  t.mock.method(fs, 'fsyncSync', fd => { fsyncSync(fd); if (fd === completionFd && !dropped) { dropped = true; throw Error('PRIVATE_LOST_ACK'); } });
  await assert.rejects(run(lost), e => refused(e) && e.code === 'NPM_CACHE_COMPLETE_UNCERTAIN'); t.mock.restoreAll(); assert.equal(dropped, true); assert.equal(n.calls.length, 2);
  assert.equal((await inspectSkillCache({ root: lost.root, operationId: lost.binding.operationId })).status, 'COMPLETED');
  const early = fixture(t); network(t, early); const op = path.join(early.root, 'op-' + early.binding.operationId), readdirSync = fs.readdirSync;
  t.mock.method(fs, 'readdirSync', function (name, ...args) { if (String(name) === op) throw Error('PRIVATE_RAW_FAULT'); return Reflect.apply(readdirSync, fs, [name, ...args]); });
  await assert.rejects(run(early), e => refused(e) && e.code === 'NPM_CACHE_COMPLETE_REFUSED'); t.mock.restoreAll();
  assert.equal(fs.existsSync(path.join(op, '03-COMPLETED.json')), false); assert.equal((await inspectSkillCache({ root: early.root, operationId: early.binding.operationId })).status, 'VERIFIED');
  const staged = fixture(t); network(t, staged); const mkdirSync = fs.mkdirSync;
  t.mock.method(fs, 'mkdirSync', function (name, ...args) { if (String(name).includes('/files')) throw Error('PRIVATE_RAW_FAULT'); return Reflect.apply(mkdirSync, fs, [name, ...args]); });
  await assert.rejects(run(staged), e => refused(e) && e.code === 'NPM_CACHE_STAGE_REFUSED'); t.mock.restoreAll();
  assert.equal((await inspectSkillCache({ root: staged.root, operationId: staged.binding.operationId })).status, 'HELD');
});

test('a per-request deadline seen in a data or end handler reports NPM_TIMEOUT, not a response code', async t => {
  for (const event of ['data', 'end']) {
    const f = fixture(t), n = network(t, f, () => ({ noEnd: true, chunks: [] })); const original = performance.now.bind(performance); let offset = 0; t.mock.method(performance, 'now', () => original() + offset);
    const pending = run(f), assertion = assert.rejects(pending, code('NPM_TIMEOUT'));
    while (n.responses.length === 0) await tick();
    offset = 10001; n.responses[0].emit(event, Buffer.from('x')); await assertion; t.mock.restoreAll();
  }
});
test('a cache guard refusal inside the pinned DNS lookup keeps its fixed code', async t => {
  const f = fixture(t), n = network(t, f, () => ({ stall: true })); const pending = run(f), assertion = assert.rejects(pending, code('NPM_CACHE_CHANGED'));
  while (n.calls.length === 0) await tick();
  fs.chmodSync(f.root, 0o755); const req = n.calls[0].req; n.calls[0].options.lookup('registry.npmjs.org', { all: true }, error => { if (error) req.emit('error', error); });
  await assertion; await assert.rejects(pending, e => Array.isArray(e.secondary) && e.secondary.join() === 'NPM_CACHE_NOT_HELD,NPM_CACHE_RELEASE_UNCERTAIN'); fs.chmodSync(f.root, 0o700);
});
test('a TypeError from the transport becomes NPM_ACQUISITION_FAILED, never a listed network refusal', async t => {
  const f = fixture(t); network(t, f); t.mock.method(https, 'request', () => { throw new TypeError('PRIVATE_TYPE'); });
  await assert.rejects(run(f), code('NPM_ACQUISITION_FAILED'));
});
test('a stop after the completion marker write begins reports NPM_CACHE_COMPLETE_UNCERTAIN', async t => {
  const f = fixture(t); network(t, f); const openSync = fs.openSync, marker = path.join(f.root, 'op-' + f.binding.operationId, '03-COMPLETED.json'); let stopped = false;
  t.mock.method(fs, 'openSync', function (name, ...args) { const fd = Reflect.apply(openSync, fs, [name, ...args]); if (!stopped && String(name) === marker) { stopped = true; f.abort.abort(); } return fd; });
  await assert.rejects(run(f), code('NPM_CACHE_COMPLETE_UNCERTAIN')); t.mock.restoreAll(); assert.equal(stopped, true); assert.equal(fs.existsSync(marker), true);
});
test('a failed HELD write and a lock left behind are reported as fixed secondary codes', async t => {
  const f = fixture(t), n = network(t, f, count => count === 2 ? { body: Buffer.from('WRONG_ARCHIVE') } : {}); const unlink = fs.unlinkSync, lock = path.join(f.root, 'op-' + f.binding.operationId, 'owner.lock');
  t.mock.method(fs, 'unlinkSync', function (name, ...args) { if (String(name) === lock) throw Error('PRIVATE_UNLINK'); return Reflect.apply(unlink, fs, [name, ...args]); });
  await assert.rejects(run(f), e => code('NPM_INTEGRITY')(e) && Array.isArray(e.secondary) && e.secondary.join() === 'NPM_CACHE_RELEASE_UNCERTAIN'); t.mock.restoreAll(); assert.equal(n.calls.length, 2); assert.equal(fs.existsSync(lock), true);
  const g = fixture(t); network(t, g, count => count === 2 ? { body: Buffer.from('WRONG_ARCHIVE') } : {}); const openSync = fs.openSync;
  t.mock.method(fs, 'openSync', function (name, ...args) { if (String(name).endsWith('-HELD.json')) throw Error('PRIVATE_HOLD'); return Reflect.apply(openSync, fs, [name, ...args]); });
  await assert.rejects(run(g), e => code('NPM_INTEGRITY')(e) && Array.isArray(e.secondary) && e.secondary.join() === 'NPM_CACHE_HOLD_UNCERTAIN'); t.mock.restoreAll();
  const h = fixture(t); network(t, h, count => count === 2 ? { body: Buffer.from('WRONG_ARCHIVE') } : {});
  await assert.rejects(run(h), e => code('NPM_INTEGRITY')(e) && Array.isArray(e.secondary) && e.secondary.length === 0);
  assert.equal((await inspectSkillCache({ root: h.root, operationId: h.binding.operationId })).status, 'HELD');
});
test('a cache guard refusal during decompression keeps its inner code', async t => {
  const f = fixture(t);
  for (const from of [3, 4, 5]) {
    let calls = 0; const check = () => { if (++calls >= from) throw new NpmAcquisitionError('NPM_CACHE_CHANGED'); };
    await assert.rejects(verifyNpmPayload(f.plan, f.metadata, f.archive, f.abort.signal, check), code('NPM_CACHE_CHANGED'));
  }
});
test('a raw write fault while receiving reports NPM_CACHE_RECEIVING_REFUSED', async t => {
  const f = fixture(t), n = network(t, f); const openSync = fs.openSync;
  t.mock.method(fs, 'openSync', function (name, ...args) { if (String(name).endsWith('/01-RECEIVING.json')) throw Error('PRIVATE_RAW_FAULT'); return Reflect.apply(openSync, fs, [name, ...args]); });
  await assert.rejects(run(f), code('NPM_CACHE_RECEIVING_REFUSED')); t.mock.restoreAll(); assert.equal(n.calls.length, 0);
});

test('a partial receiving record is never held beside, and the refusal says so', async t => {
  const f = fixture(t); network(t, f); const openSync = fs.openSync, fsyncSync = fs.fsyncSync, op = path.join(f.root, 'op-' + f.binding.operationId); let fd;
  t.mock.method(fs, 'openSync', function (name, ...args) { const result = Reflect.apply(openSync, fs, [name, ...args]); if (String(name).endsWith('/01-RECEIVING.json')) fd = result; return result; });
  let fired = false; t.mock.method(fs, 'fsyncSync', descriptor => { fsyncSync(descriptor); if (descriptor === fd && !fired) { fired = true; throw Error('PRIVATE_FSYNC'); } });
  await assert.rejects(run(f), e => code('NPM_CACHE_RECEIVING_REFUSED')(e) && e.secondary.join() === 'NPM_CACHE_HOLD_UNCERTAIN'); t.mock.restoreAll();
  assert.equal(fs.existsSync(path.join(op, '01-RECEIVING.json')), true); assert.equal(fs.existsSync(path.join(op, '01-HELD.json')), false);
});
test('a cancelled acquisition is still held, because HELD ignores the signal and the deadline', async t => {
  const f = fixture(t), n = network(t, f, () => ({ stall: true })); const pending = run(f), assertion = assert.rejects(pending, e => code('NPM_ABORTED')(e) && e.secondary.length === 0);
  while (n.calls.length === 0) await tick(); f.abort.abort(); await assertion;
  assert.equal((await inspectSkillCache({ root: f.root, operationId: f.binding.operationId })).status, 'HELD');
});
test('a refusal after the operation folder exists carries NPM_CACHE_OPEN_PARTIAL', async t => {
  const f = fixture(t), n = network(t, f); const openSync = fs.openSync;
  t.mock.method(fs, 'openSync', function (name, ...args) { if (String(name).endsWith('/00-PREPARED.json')) throw Error('PRIVATE_OPEN'); return Reflect.apply(openSync, fs, [name, ...args]); });
  await assert.rejects(run(f), e => code('NPM_CACHE_OPEN_REFUSED')(e) && e.secondary.join() === 'NPM_CACHE_OPEN_PARTIAL'); t.mock.restoreAll(); assert.equal(n.calls.length, 0);
  await assert.rejects(run(f), e => code('NPM_CACHE_EXISTS')(e) && e.secondary.length === 0);
});
test('a TypeError inside planning is NPM_PLAN_REFUSED, never NPM_INPUT', async t => {
  const f = fixture(t), from = Buffer.from;
  t.mock.method(Buffer, 'from', function (value, ...args) { if (args[0] === 'base64' && value === f.request.integrity.slice(7)) throw new TypeError('PRIVATE_TYPE'); return Reflect.apply(from, Buffer, [value, ...args]); });
  assert.throws(() => planNpmAcquisition(f.request, f.binding), code('NPM_PLAN_REFUSED'));
});
test('a declared length over the limit is NPM_RESPONSE_BOUND, while a redirect stays NPM_RESPONSE', async t => {
  const f = fixture(t), n = network(t, f, () => ({ headers: ['Content-Length', String(NPM_LIMITS.metadataBytes + 1)], chunks: [] }));
  await assert.rejects(run(f), code('NPM_RESPONSE_BOUND')); assert.equal(n.calls.length, 1); t.mock.restoreAll();
  const g = fixture(t), m = network(t, g, () => ({ status: 302, headers: ['Location', 'https://evil.example/a'] }));
  await assert.rejects(run(g), code('NPM_RESPONSE')); assert.equal(m.calls.length, 1);
});

// Decision D11: a repeated header name refuses only when the transport reads it or it frames the body.
const recordedHeaders = JSON.parse(fs.readFileSync(new URL('./fixtures/npm-registry-headers-2026-10-07.json', import.meta.url), 'utf8'));
const HEADER_CANARY = 'PRIVATE_HEADER_VALUE';
// The recorded names in their recorded order. Values are synthetic: none was recorded.
function recordedResponse(body, type) {
  let cookie = 0; const value = { date: 'Wed, 07 Oct 2026 00:00:00 GMT', 'content-type': type, 'content-length': String(body.length), connection: 'keep-alive', 'cf-ray': 'synthetic-ray', 'cf-cache-status': 'HIT', 'access-control-allow-origin': '*', server: 'cloudflare' };
  return recordedHeaders.headerNames.flatMap(name => [name, name === 'set-cookie' ? `${HEADER_CANARY}_${++cookie}=1; Path=/` : value[name]]);
}
function quietConsole(t) { const lines = []; for (const method of ['log', 'info', 'warn', 'error', 'debug', 'trace']) t.mock.method(console, method, (...args) => { lines.push(args.map(String).join(' ')); }); return lines; }
function treeText(root) { let text = ''; for (const entry of fs.readdirSync(root, { recursive: true, withFileTypes: true })) if (entry.isFile()) text += fs.readFileSync(path.join(entry.parentPath, entry.name), 'latin1'); return text; }
test('D11: the recorded registry header list, with two set-cookie headers, completes and logs no header value', async t => {
  assert.equal(recordedHeaders.headerNames.filter(name => name === 'set-cookie').length, 2);
  const f = fixture(t), lines = quietConsole(t);
  const n = network(t, f, count => ({ headers: recordedResponse(count === 1 ? f.metadata : f.archive, count === 1 ? 'application/json' : 'application/octet-stream') }));
  const receipt = await run(f);
  assert.equal(receipt.format, 'bowerloom/acquired-skill-cache/v1beta1'); assert.equal(n.calls.length, 2);
  assert.equal(lines.some(line => line.includes(HEADER_CANARY)), false); assert.equal(JSON.stringify(receipt).includes(HEADER_CANARY), false); assert.equal(treeText(f.root).includes(HEADER_CANARY), false);
  assert.equal((await inspectSkillCache({ root: f.root, operationId: f.binding.operationId })).status, 'COMPLETED');
});
test('D11: two set-cookie headers alone pass on both requests', async t => {
  const f = fixture(t);
  const n = network(t, f, count => ({ headers: ['Set-Cookie', HEADER_CANARY + '_A=1', 'Content-Length', String((count === 1 ? f.metadata : f.archive).length), 'set-cookie', HEADER_CANARY + '_B=2'] }));
  const receipt = await run(f); assert.equal(receipt.source.archiveSha256, hash(f.archive)); assert.equal(n.calls.length, 2);
});
test('D11: a repeated guarded header still refuses with NPM_RESPONSE before any body is kept', async t => {
  const cases = [
    count => ['Content-Length', String(count), 'Content-Length', String(count)],
    () => ['Content-Type', 'application/json', 'Content-Type', 'application/json'],
    () => ['content-type', 'application/json', 'Content-Type', HEADER_CANARY],
    () => ['Content-Encoding', 'identity', 'Content-Encoding', 'identity'],
    () => ['Location', 'https://registry.npmjs.org/a', 'Location', 'https://registry.npmjs.org/a'],
    () => ['Transfer-Encoding', 'chunked', 'Transfer-Encoding', 'chunked'],
    () => ['Content-Range', 'bytes 0-1/2', 'Content-Range', 'bytes 0-1/2'],
  ];
  for (const headers of cases) {
    const f = fixture(t), lines = quietConsole(t);
    const n = network(t, f, () => ({ headers: ['set-cookie', HEADER_CANARY, ...headers(f.metadata.length), 'set-cookie', HEADER_CANARY] }));
    await assert.rejects(run(f), e => code('NPM_RESPONSE')(e) && !String(e.stack).includes(HEADER_CANARY) && !JSON.stringify(e).includes(HEADER_CANARY));
    assert.equal(n.calls.length, 1); assert.ok(n.responses[0].destroyed); assert.equal(lines.some(line => line.includes(HEADER_CANARY)), false);
    assert.equal((await inspectSkillCache({ root: f.root, operationId: f.binding.operationId })).status === 'COMPLETED', false);
    t.mock.restoreAll();
  }
});
// Header flood (security review of 48257d5, finding 1): Node drops raw headers past about 2000 entries without an error.
const padHeaders = count => Array.from({ length: count }, (_, i) => ['x-pad-' + i, 'a']).flat();
test('header flood: a list Node truncated after 1000 padding headers refuses with NPM_RESPONSE, and 128 pairs pass', async t => {
  // Node kept the first Content-Length and the padding, and dropped the repeat that followed.
  const f = fixture(t), n = network(t, f, () => ({ headers: ['Content-Length', String(f.metadata.length), ...padHeaders(1000)] }));
  await assert.rejects(run(f), code('NPM_RESPONSE')); assert.equal(n.calls.length, 1); assert.ok(n.responses[0].destroyed); t.mock.restoreAll();
  const g = fixture(t), m = network(t, g, count => ({ headers: ['Content-Length', String((count === 1 ? g.metadata : g.archive).length), ...padHeaders(127)] }));
  assert.equal((await run(g)).format, 'bowerloom/acquired-skill-cache/v1beta1'); assert.equal(m.calls.length, 2);
});
// Transfer-Encoding (lead decision, 2026-10-07): absent, or exactly `chunked` after trimming.
test('Transfer-Encoding: absent and chunked pass, and every other value refuses with NPM_RESPONSE', async t => {
  for (const name of ['Transfer-Encoding', 'transfer-encoding']) {
    const f = fixture(t), n = network(t, f, () => ({ headers: [name, 'chunked'] }));
    assert.equal((await run(f)).format, 'bowerloom/acquired-skill-cache/v1beta1'); assert.equal(n.calls.length, 2); t.mock.restoreAll();
  }
  for (const value of ['gzip, chunked', 'identity', 'Chunked']) {
    const f = fixture(t), n = network(t, f, () => ({ headers: ['Transfer-Encoding', value] }));
    await assert.rejects(run(f), code('NPM_RESPONSE')); assert.equal(n.calls.length, 1); assert.ok(n.responses[0].destroyed); t.mock.restoreAll();
  }
});
