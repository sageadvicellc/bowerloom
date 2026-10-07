import '../../../dist/tests/support/isolate-home.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { Header } from 'tar/header';
import { denyNetwork, fakeTransport, npmMetadata, hash } from './support/fixtures.mjs';
import { NPM, npmCollections, privateFolder } from './support/expected.mjs';
import { NPM_FILES } from './fixtures/record.mjs';
import { resolveNpm } from '../../../dist/packages/skill-manifest/src/resolve-npm.js';
import { parseSkillSpec } from '../../../dist/packages/skill-manifest/src/spec.js';
import { toNpmRequest } from '../../../dist/packages/skill-manifest/src/requests.js';
import { planNpmAcquisition, verifyNpmPayload } from '../../../dist/packages/skill-sources/src/npm.js';
import { observeSkillCacheRoot } from '../../../dist/packages/skill-sources/src/cache.js';

// Lead decision, DECISIONS-01.md item 7, variant A: `skills add` resolves a package whose tarball the pinned node-tar
// wrote, with its POSIX number endings ("000644 \0") and checksum order ("012510 \0"), as real npm tarballs are.
const network = denyNetwork();
test.after(() => assert.deepEqual(network, [], 'no test in this file touches the network'));
const signal = () => new AbortController().signal;
function nodeTarball(files) {
  const blocks = [];
  for (const f of files) {
    const body = Buffer.from(f.text ?? ''), h = Buffer.alloc(512);
    new Header({ path: 'package/' + f.path, mode: f.mode ?? 0o644, uid: 0, gid: 0, size: body.length, mtime: new Date(499162500000), type: 'File', uname: '', gname: '', devmaj: 0, devmin: 0 }).encode(h, 0);
    blocks.push(h, body, Buffer.alloc((512 - body.length % 512) % 512));
  }
  return gzipSync(Buffer.concat([...blocks, Buffer.alloc(1024)]), { level: 9 });
}

test('skills add resolution accepts a node-tar package, and the npm verifier accepts the proposed entry', async t => {
  const archive = nodeTarball(NPM_FILES), metadata = npmMetadata({ name: '@synthetic/db-skills', version: '0.0.1', license: 'MIT', archive });
  const transport = fakeTransport(new Map([[NPM.metadataUrl, metadata], [NPM.archiveUrl, archive]]));
  const resolved = await resolveNpm(parseSkillSpec('npm:@synthetic/db-skills@0.0.1:skills/synthetic-db/collections'), transport, signal());
  assert.deepEqual(transport.urls, [NPM.metadataUrl, NPM.archiveUrl]);
  const expected = npmCollections();
  assert.deepEqual({ ...resolved, source: { ...resolved.source, integrity: '', metadataSha256: '' } }, { ...expected, source: { ...expected.source, integrity: '', metadataSha256: '' } });
  assert.equal(resolved.source.metadataSha256, hash(metadata));
  const plan = planNpmAcquisition(toNpmRequest({ id: 'collections', ...resolved }), observeSkillCacheRoot(privateFolder(t), 'd'.repeat(32), 12582912));
  const observed = await verifyNpmPayload(plan, metadata, archive, signal(), () => {});
  assert.equal(observed.files.length, 4);
});
