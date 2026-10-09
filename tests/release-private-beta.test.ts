import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateReleaseIdentity } from '../apps/cli/src/release.js';

// 0.7.0-beta.1 is published on npm under the beta dist-tag. A private colleague beta, installed from an archive and
// never an npm publication, stays a valid record form and is built here as a fixture.
const root = new URL('../../', import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), 'utf8');
const VERSION = '0.7.0-beta.1';
const BETA_INSTALL = 'npm install -g bowerloom@beta';
const ARCHIVE_INSTALL = `npm install -g ./bowerloom-${VERSION}.tgz`;
type Record = { version: string; state: string; audience: string; distribution?: { [k: string]: unknown }; npm: { distTag: string; installCommand: string; published: boolean; availabilityNote: string } };
const release = JSON.parse(read('release/beta.json')) as Record;
const pkg = JSON.parse(read('package.json')) as { name: string; version: string };
const privateArchive: Record = {
  ...release, state: 'unreleased', audience: 'private-colleague-beta',
  distribution: { kind: 'private-archive', archive: `bowerloom-${VERSION}.tgz`, npmPublication: false },
  npm: { ...release.npm, installCommand: ARCHIVE_INSTALL, published: false, availabilityNote: 'A private colleague beta; not published to npm.' },
};
const refuses = (record: unknown, label: string) => assert.throws(() => validateReleaseIdentity(record, pkg), /installed release record/, label);

test('the release record and package.json name 0.7.0-beta.1, published on npm under the beta dist-tag', () => {
  assert.equal(pkg.version, VERSION); assert.equal(release.version, VERSION);
  assert.deepEqual(release.distribution, { kind: 'npm-beta-stream', distTag: 'beta' });
  assert.equal(release.npm.distTag, 'beta'); assert.equal(release.npm.installCommand, BETA_INSTALL);
  assert.equal(release.state, 'published'); assert.equal(release.npm.published, true);
  assert.equal(release.audience, 'public-beta-stream'); assert.match(release.npm.availabilityNote, /under the beta dist-tag/);
  assert.equal(validateReleaseIdentity(release, pkg).version, VERSION);
});

test('every surface that pins the version names 0.7.0-beta.1, and the generated install blocks name the record command', () => {
  for (const path of ['packages/harness-portability/package.json', 'packages/mcp-connections/package.json']) assert.equal((JSON.parse(read(path)) as { version: string }).version, VERSION, path);
  const lock = JSON.parse(read('package-lock.json')) as { version: string; packages: { [k: string]: { version?: string } } };
  assert.equal(lock.version, VERSION); assert.equal(lock.packages['']!.version, VERSION);
  assert.match(read('docs/assets/badge-version.svg'), new RegExp(`aria-label="Version ${VERSION.replace(/\./g, '\\.')}"`));
  for (const path of ['README.md', 'apps/docs/src/content/docs/start.md']) {
    const text = read(path);
    assert.ok(text.includes(`\`\`\`sh\n${release.npm.installCommand}\nbowerloom --version\nbowerloom --help\n\`\`\``), path);
    assert.doesNotMatch(text, /npm install --global bowerloom@/, path);
  }
  for (const path of ['README.md', 'apps/docs/src/content/docs/backend.md', 'apps/docs/src/content/docs/cli.md', 'apps/docs/src/content/docs/mcp.md', 'apps/docs/src/content/docs/revision.md', 'apps/docs/src/content/docs/status.md', 'apps/docs/src/content/docs/stop.md']) {
    assert.ok(read(path).includes(`Open beta · ${VERSION}`), path);
  }
});

test('the release identity binds the install command to the distribution: an archive is never published, npm keeps its form', () => {
  assert.equal(validateReleaseIdentity(privateArchive, pkg).version, VERSION, 'a private-archive record stays valid');
  const npmForm = { ...privateArchive, distribution: undefined, npm: { ...privateArchive.npm, installCommand: `npm install --global bowerloom@${VERSION}` } };
  assert.equal(validateReleaseIdentity(npmForm, pkg).version, VERSION, 'a record without a distribution keeps the npm form');
  for (const record of [
    { ...privateArchive, npm: { ...privateArchive.npm, installCommand: `npm install --global bowerloom@${VERSION}` } },
    { ...privateArchive, npm: { ...privateArchive.npm, installCommand: 'npm install -g ./bowerloom-0.7.0-beta.0.tgz' } },
    { ...privateArchive, npm: { ...privateArchive.npm, published: true }, state: 'published' },
    { ...privateArchive, distribution: { ...privateArchive.distribution, npmPublication: true } },
    { ...privateArchive, distribution: { ...privateArchive.distribution, archive: 'other.tgz' } },
    { ...privateArchive, distribution: { ...privateArchive.distribution, kind: 'public-archive' } },
    { ...npmForm, npm: { ...npmForm.npm, installCommand: ARCHIVE_INSTALL } },
  ]) refuses(record, JSON.stringify(record.npm.installCommand));
});

test('an npm-beta-stream record installs by its dist-tag only, in one canonical form', () => {
  const unpublished = { ...release, state: 'unreleased', npm: { ...release.npm, published: false } };
  assert.equal(validateReleaseIdentity(unpublished, pkg).state, 'unreleased', 'an unpublished beta stream is governed by the state rule');
  refuses({ ...release, state: 'unreleased' }, 'published on npm but unreleased');
  refuses({ ...unpublished, npm: { ...unpublished.npm, published: true } }, 'unreleased but published on npm');
  for (const installCommand of ['npm install --global bowerloom@beta', `npm install -g bowerloom@${VERSION}`, 'npm install -g bowerloom@next', 'npm install -g bowerloom@latest', 'npm install -g bowerloom', `npm install -g ./bowerloom-${VERSION}.tgz`, 'npm install -g bowerloom@beta ']) {
    refuses({ ...release, npm: { ...release.npm, installCommand } }, installCommand);
  }
});

test('an npm-beta-stream distribution has exactly kind and distTag, matches npm.distTag, and never names latest', () => {
  const tagged = (tag: string) => ({ ...release, distribution: { kind: 'npm-beta-stream', distTag: tag }, npm: { ...release.npm, distTag: tag, installCommand: `npm install -g bowerloom@${tag}` } });
  assert.equal(validateReleaseIdentity(tagged('next-beta'), pkg).version, VERSION, 'another lowercase dist-tag passes');
  for (const tag of ['latest', 'Beta', '1beta', 'be ta', '-beta', '']) refuses(tagged(tag), `dist-tag ${JSON.stringify(tag)}`);
  refuses({ ...release, distribution: { kind: 'npm-beta-stream', distTag: 'beta', archive: `bowerloom-${VERSION}.tgz` } }, 'a third distribution key');
  refuses({ ...release, distribution: { kind: 'npm-beta-stream', distTag: 'beta', npmPublication: true } }, 'a third distribution key');
  refuses({ ...release, distribution: { kind: 'npm-beta-stream' } }, 'no distTag');
  refuses({ ...release, distribution: { kind: 'npm-beta-stream', tag: 'beta' } }, 'a renamed distTag key');
  refuses({ ...release, distribution: { kind: 'npm-beta-stream', distTag: 'next' } }, 'distribution distTag differs from npm.distTag');
  refuses({ ...release, npm: { ...release.npm, distTag: 'next' } }, 'npm.distTag differs from the distribution');
  refuses({ ...release, distribution: { kind: 'npm-beta-stream', distTag: 'next' }, npm: { ...release.npm, distTag: 'next' } }, 'the command names a different tag');
  refuses({ ...release, distribution: { kind: 'npm-stable', distTag: 'beta' } }, 'an unknown distribution kind');
  refuses({ ...release, distribution: null }, 'a null distribution');
  refuses({ ...release, distribution: { kind: 'npm-beta-stream', distTag: 7 }, npm: { ...release.npm, distTag: 7 } }, 'a non-string distTag');
});
