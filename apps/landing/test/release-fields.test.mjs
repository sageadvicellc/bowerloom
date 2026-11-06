import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { pageRecord } from '../build/release-fields.ts';
import * as releaseModule from '../src/release.ts';

const record = JSON.parse(await readFile(new URL('../../../release/beta.json', import.meta.url), 'utf8'));

test('the page record keeps four facts and drops the rest', () => {
  const kept = pageRecord(record);
  assert.deepEqual(kept, {
    state: record.state,
    npm: { installCommand: record.npm.installCommand, published: record.npm.published },
    urls: { docs: record.urls.docs, repository: record.urls.repository },
  });
  for (const field of ['version', 'release', 'authenticatedIdentity', 'identityEvidence', 'ownershipEvidence']) {
    assert.equal(Object.hasOwn(kept, field) || Object.hasOwn(kept.npm, field), false, field);
  }
});

test('release.ts exports the page fields, and the one presentation function the documentation build imports', () => {
  assert.deepEqual(Object.keys(releaseModule).sort(), ['docsPath', 'installAvailable', 'installCommand', 'readerRelease', 'releasePresentation', 'releasesUrl', 'repositoryUrl']);
});

test('the built bundle holds no identity, evidence text, or version from the release record', async () => {
  const result = await build({
    root: fileURLToPath(new URL('..', import.meta.url)), logLevel: 'silent',
    build: { write: false, emptyOutDir: false, chunkSizeWarningLimit: 5000 },
  });
  const output = (Array.isArray(result) ? result : [result]).flatMap(item => item.output);
  const code = output.filter(chunk => chunk.type === 'chunk').map(chunk => chunk.code).join('\n');
  assert.ok(code.length > 10000, 'the build produced the page script');
  assert.ok(code.includes(record.npm.installCommand), 'the page still carries the install command');
  for (const text of [record.version, record.npm.authenticatedIdentity, record.npm.identityEvidence, record.npm.ownershipEvidence, record.npm.availabilityNote, record.statusLabel]) {
    assert.ok(text && !code.includes(text), `the bundle must not hold: ${text.slice(0, 40)}`);
  }
});
