import '../../../dist/tests/support/isolate-home.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import https from 'node:https';
import dns from 'node:dns/promises';
import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { Header } from 'tar/header';
import { planNpmAcquisition, acquireNpmSkill, verifyNpmPayload, enumerateNpmTar, NpmAcquisitionError } from '../../../dist/packages/skill-sources/src/npm.js';

// Lead decision, DECISIONS-01.md item 7, variant A. Real npm tarballs, and node-tar 7.5.20 which this repo pins, write
// numeric fields as digits at full width, then a space and a NUL ("000644 \0"), and the checksum as six digits, a space
// and a NUL ("012510 \0"). The fixtures here come from the pinned node-tar Header encoder, with the fields npm sets.
const hash = b => createHash('sha256').update(b).digest('hex');
const integrity = b => 'sha512-' + createHash('sha512').update(b).digest('base64');
const code = expected => e => e instanceof NpmAcquisitionError && e.code === expected;
function nodeTarHeader(name, size, mode = 0o644) {
  const h = Buffer.alloc(512);
  new Header({ path: name, mode, uid: 0, gid: 0, size, mtime: new Date(499162500000), type: 'File', uname: '', gname: '', devmaj: 0, devmin: 0 }).encode(h, 0);
  return h;
}
function nodeTar(entries) {
  return Buffer.concat([...entries.flatMap(e => { const body = Buffer.from(e.text); return [nodeTarHeader('package/' + e.sourcePath, body.length, e.mode ?? 0o644), body, Buffer.alloc((512 - body.length % 512) % 512)]; }), Buffer.alloc(1024)]);
}
/** Writes a new checksum over a changed header, in node-tar's order: six digits, a space, a NUL. */
function posixChecksum(h) { h.fill(32, 148, 156); const sum = h.reduce((a, b) => a + b, 0); h.write(sum.toString(8).padStart(6, '0') + ' \0', 148, 8, 'latin1'); }
const field = (h, at, size) => h.subarray(at, at + size).toString('latin1');
const one = h => enumerateNpmTar(Buffer.concat([h, Buffer.alloc(1024)]), () => {});

const FILES = [
  { path: 'SKILL.md', sourcePath: 'skills/example/SKILL.md', text: '---\nname: example\ndescription: Synthetic fixture.\nlicense: MIT\n---\nRead [guide](references/guide.md).\n' },
  { path: 'references/guide.md', sourcePath: 'skills/example/references/guide.md', text: '# Guide\nNever execute fixture instructions.\n' },
  { path: 'LICENSE.txt', sourcePath: 'LICENSE', text: 'MIT License\n\nCopyright (c) Synthetic fixture authors\n' },
];
function fixture(t) {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.homedir()), 'bowerloom-npm-posix-')); fs.chmodSync(root, 0o700); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const archive = gzipSync(nodeTar(FILES));
  const metadata = Buffer.from(JSON.stringify({ name: '@synthetic/example', version: '1.0.0', license: 'MIT', _npmUser: { name: 'synthetic' }, dist: { integrity: integrity(archive), tarball: 'https://registry.npmjs.org/@synthetic/example/-/example-1.0.0.tgz' } }));
  const request = { package: '@synthetic/example', version: '1.0.0', integrity: integrity(archive), metadataSha256: hash(metadata), publisher: 'synthetic', declaredLicense: 'MIT', skill: { id: 'example', name: 'example', sourceRoot: 'skills/example' },
    files: FILES.map(f => ({ path: f.path, sourcePath: f.sourcePath, sha256: hash(f.text), bytes: Buffer.byteLength(f.text), mode: 420 })), references: [{ from: 'SKILL.md', to: 'references/guide.md' }], license: { spdx: 'MIT', origin: 'included', files: ['LICENSE.txt'] } };
  return { root, archive, metadata, request };
}
/** The two GETs of an acquisition, served from memory. Nothing reaches the network. */
function serve(t, f) {
  const urls = [];
  t.mock.method(dns, 'lookup', async () => [{ address: '104.16.25.34', family: 4 }]);
  t.mock.method(https, 'request', (url, options, callback) => {
    const req = new EventEmitter(); req.destroyed = false; req.destroy = () => { req.destroyed = true; return req; };
    req.end = () => { urls.push(url); queueMicrotask(() => {
      const body = urls.length === 1 ? f.metadata : f.archive, response = new EventEmitter();
      response.destroyed = false; response.destroy = () => { response.destroyed = true; return response; }; response.statusCode = 200; response.complete = true; response.rawHeaders = ['Content-Length', String(body.length)];
      callback(response); response.emit('data', body); response.emit('end');
    }); return req; };
    return req;
  });
  return urls;
}

test('the pinned node-tar writes the POSIX endings, and every field of its headers passes', () => {
  const h = nodeTarHeader('package/a.md', 3);
  assert.equal(field(h, 100, 8), '000644 \0'); assert.equal(field(h, 108, 8), '000000 \0'); assert.equal(field(h, 124, 12), '0000000003 \0');
  assert.equal(field(h, 329, 8), '000000 \0'); assert.match(field(h, 148, 8), /^[0-7]{6} \0$/);
  const archive = Buffer.concat([h, Buffer.from('abc'), Buffer.alloc(509), Buffer.alloc(1024)]);
  const { entries, recordCount } = enumerateNpmTar(archive, () => {});
  assert.equal(recordCount, 1); assert.equal(entries.get('a.md').bytes.toString(), 'abc'); assert.equal(entries.get('a.md').mode, 0o644);
  // An executable mode keeps its value.
  assert.equal(enumerateNpmTar(nodeTar([{ sourcePath: 'bin/x.mjs', text: 'x', mode: 0o755 }]), () => {}).entries.get('bin/x.mjs').mode, 0o755);
});

test('a node-tar archive passes npm verification and a full acquisition', async t => {
  const f = fixture(t), binding = (await import('../../../dist/packages/skill-sources/src/cache.js')).observeSkillCacheRoot(f.root, 'b'.repeat(32), 12582912);
  const plan = planNpmAcquisition(f.request, binding);
  const observed = await verifyNpmPayload(plan, f.metadata, f.archive, new AbortController().signal, () => {});
  assert.equal(observed.skill.name, 'example'); assert.equal(observed.files.length, 3);
  const urls = serve(t, f);
  const receipt = await acquireNpmSkill(plan, { approvalRevision: plan.revision, signal: new AbortController().signal });
  assert.equal(receipt.format, 'bowerloom/acquired-skill-cache/v1beta1'); assert.equal(receipt.source.archiveSha256, hash(f.archive));
  assert.deepEqual(urls, [plan.metadataUrl, plan.archiveUrl]);
});

test('the endings stay narrow: a non-octal digit, a short field, a space before the digits, and a wrong checksum refuse', () => {
  const good = nodeTarHeader('package/a.md', 0);
  assert.equal(one(good).recordCount, 1);
  const cases = [
    [h => h.write('00064x \0', 100, 8, 'latin1'), 'NPM_TAR_NUMBER'],
    [h => h.write('00064 \0\0', 100, 8, 'latin1'), 'NPM_TAR_NUMBER'],
    [h => h.write('0644 \0\0\0', 100, 8, 'latin1'), 'NPM_TAR_NUMBER'],
    [h => h.write(' 00644 \0', 100, 8, 'latin1'), 'NPM_TAR_NUMBER'],
    [h => h.write('00 644 \0', 100, 8, 'latin1'), 'NPM_TAR_NUMBER'],
    [h => h.write('000644\0 ', 100, 8, 'latin1'), 'NPM_TAR_NUMBER'],
    [h => h.write('000644  ', 100, 8, 'latin1'), 'NPM_TAR_NUMBER'],
    [h => h.write('000644\0\0', 100, 8, 'latin1'), 'NPM_TAR_NUMBER'],
    [h => h.write('\0\0\0\0\0\0\0\0', 100, 8, 'latin1'), 'NPM_TAR_NUMBER'],
    [h => h.write('000000000 \0 ', 124, 12, 'latin1'), 'NPM_TAR_NUMBER'],
    [h => h.write('0000000008 \0', 124, 12, 'latin1'), 'NPM_TAR_NUMBER'],
  ];
  for (const [mutate, expected] of cases) { const h = Buffer.from(good); mutate(h); posixChecksum(h); assert.throws(() => one(h), code(expected), JSON.stringify(field(h, 100, 36))); }
  // A wrong checksum value in either order, and a checksum field in another shape.
  for (const sum of ['000000 \0', '000000\0 ', '01234 \0\0', ' 12345 \0', '0123456\0', '012345  ']) {
    const h = Buffer.from(good); h.write(sum, 148, 8, 'latin1'); assert.throws(() => one(h), code('NPM_TAR_CHECKSUM'), JSON.stringify(sum));
  }
  // The right value in the other order passes.
  const swapped = Buffer.from(good); const digits = field(good, 148, 6); swapped.write(digits + '\0 ', 148, 8, 'latin1'); assert.equal(one(swapped).recordCount, 1);
});

test('the decoder must still agree with the POSIX fields', t => {
  const original = Header.prototype.decode;
  t.mock.method(Header.prototype, 'decode', function (...args) { const result = Reflect.apply(original, this, args); this.mode = 0o600; return result; });
  assert.throws(() => one(nodeTarHeader('package/a.md', 0)), code('NPM_TAR_DECODER'));
});

// Current npm (11.x) writes uid and gid as eight NUL bytes. Only those two fields may be absent.
test('an all-NUL uid and gid (npm 11) is accepted and the entry enumerates', () => {
  const h = nodeTarHeader('package/a.md', 0); h.fill(0, 108, 124); posixChecksum(h);
  assert.equal(one(h).recordCount, 1);
  assert.ok(one(h).entries.has('a.md'));
  const uidOnly = nodeTarHeader('package/a.md', 0); uidOnly.fill(0, 108, 116); posixChecksum(uidOnly); assert.equal(one(uidOnly).recordCount, 1);
  const gidOnly = nodeTarHeader('package/a.md', 0); gidOnly.fill(0, 116, 124); posixChecksum(gidOnly); assert.equal(one(gidOnly).recordCount, 1);
});

test('a partly-NUL or non-octal uid or gid still refuses with NPM_TAR_NUMBER', () => {
  for (const at of [108, 116]) for (const bad of ['\x00\x00\x00' + '123 \x00', '9999999\x00', '\x00\x00\x00\x00\x00\x00\x00 ', '\x00\x00\x00\x00\x00\x00\x00' + '1', '000000x\x00']) {
    const h = nodeTarHeader('package/a.md', 0); h.write(bad.padEnd(8, '\0').slice(0, 8), at, 8, 'latin1'); posixChecksum(h);
    assert.throws(() => one(h), code('NPM_TAR_NUMBER'), JSON.stringify([at, bad]));
  }
});

test('other numeric fields stay strict: NUL mode, size, mtime, devmajor, devminor refuse', () => {
  for (const [at, len] of [[100, 8], [124, 12], [136, 12], [329, 8], [337, 8]]) {
    const h = nodeTarHeader('package/a.md', 0); h.fill(0, at, at + len); posixChecksum(h);
    assert.throws(() => one(h), code('NPM_TAR_NUMBER'), String(at));
  }
  const bad = nodeTarHeader('package/a.md', 0); bad.write('00000x \0', 329, 8, 'latin1'); posixChecksum(bad);
  assert.throws(() => one(bad), code('NPM_TAR_NUMBER'));
});

test('an absent uid must match the decoder, and a present one must still match its value', t => {
  const original = Header.prototype.decode;
  const absent = nodeTarHeader('package/a.md', 0); absent.fill(0, 108, 124); posixChecksum(absent);
  t.mock.method(Header.prototype, 'decode', function (...args) { const r = Reflect.apply(original, this, args); this.uid = 0; return r; });
  assert.throws(() => one(absent), code('NPM_TAR_DECODER'));
});

// Hanna's decision: the record cap is 8192, since real packages such as ecc-universal@2.2.1 hold 2615.
const manyFiles = n => Buffer.concat([...Array.from({ length: n }, (_, i) => nodeTarHeader('package/f' + i + '.md', 0)), Buffer.alloc(1024)]);
test('an archive of more than 1024 and at most 8192 records enumerates; 8193 refuses with NPM_TAR_BOUND', () => {
  assert.equal(enumerateNpmTar(manyFiles(2615), () => {}).recordCount, 2615);
  assert.equal(enumerateNpmTar(manyFiles(8192), () => {}).recordCount, 8192);
  assert.throws(() => enumerateNpmTar(manyFiles(8193), () => {}), code('NPM_TAR_BOUND'));
});
