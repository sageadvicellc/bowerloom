import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateReleaseIdentity } from '../apps/cli/src/release.js';

// Freeze prep for 0.7.0-beta.1: a private colleague beta installed from an archive, never an npm publication.
const root = new URL('../../', import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), 'utf8');
const VERSION = '0.7.0-beta.1';
const ARCHIVE_INSTALL = `npm install -g ./bowerloom-${VERSION}.tgz`;
type Record = { version: string; state: string; audience: string; distribution: { kind: string; archive: string; npmPublication: boolean }; npm: { installCommand: string; published: boolean; availabilityNote: string } };
const release = JSON.parse(read('release/beta.json')) as Record;
const pkg = JSON.parse(read('package.json')) as { name: string; version: string };

test('the release record and package.json name 0.7.0-beta.1, a private colleague beta from an archive, unpublished', () => {
  assert.equal(pkg.version, VERSION); assert.equal(release.version, VERSION);
  assert.equal(release.npm.installCommand, ARCHIVE_INSTALL);
  assert.deepEqual(release.distribution, { kind: 'private-archive', archive: `bowerloom-${VERSION}.tgz`, npmPublication: false });
  assert.equal(release.audience, 'private-colleague-beta');
  assert.equal(release.state, 'unreleased'); assert.equal(release.npm.published, false);
  assert.match(release.npm.availabilityNote, /not published to npm/);
  assert.equal(validateReleaseIdentity(release, pkg).version, VERSION);
});

test('every surface that pins the version names 0.7.0-beta.1, and the generated install blocks name the archive', () => {
  for (const path of ['packages/harness-portability/package.json', 'packages/mcp-connections/package.json']) assert.equal((JSON.parse(read(path)) as { version: string }).version, VERSION, path);
  const lock = JSON.parse(read('package-lock.json')) as { version: string; packages: { [k: string]: { version?: string } } };
  assert.equal(lock.version, VERSION); assert.equal(lock.packages['']!.version, VERSION);
  assert.match(read('docs/assets/badge-version.svg'), new RegExp(`aria-label="Version ${VERSION.replace(/\./g, '\\.')}"`));
  for (const path of ['README.md', 'apps/docs/src/content/docs/start.md']) {
    const text = read(path);
    assert.ok(text.includes(`\`\`\`sh\n${ARCHIVE_INSTALL}\nbowerloom --version\nbowerloom --help\n\`\`\``), path);
    assert.doesNotMatch(text, /npm install --global bowerloom@/, path);
  }
  for (const path of ['README.md', 'apps/docs/src/content/docs/backend.md', 'apps/docs/src/content/docs/cli.md', 'apps/docs/src/content/docs/mcp.md', 'apps/docs/src/content/docs/revision.md', 'apps/docs/src/content/docs/status.md', 'apps/docs/src/content/docs/stop.md']) {
    assert.ok(read(path).includes(`Open beta · ${VERSION}`), path);
  }
});

test('the release identity binds the install command to the distribution: an archive is never published, npm keeps its form', () => {
  const npmForm = { ...release, distribution: undefined, npm: { ...release.npm, installCommand: `npm install --global bowerloom@${VERSION}` } };
  assert.equal(validateReleaseIdentity(npmForm, pkg).version, VERSION, 'a record without a private archive keeps the npm form');
  for (const record of [
    { ...release, npm: { ...release.npm, installCommand: `npm install --global bowerloom@${VERSION}` } },
    { ...release, npm: { ...release.npm, installCommand: 'npm install -g ./bowerloom-0.7.0-beta.0.tgz' } },
    { ...release, npm: { ...release.npm, published: true }, state: 'published' },
    { ...release, distribution: { ...release.distribution, npmPublication: true } },
    { ...release, distribution: { ...release.distribution, archive: 'other.tgz' } },
    { ...release, distribution: { ...release.distribution, kind: 'public-archive' } },
    { ...npmForm, npm: { ...npmForm.npm, installCommand: ARCHIVE_INSTALL } },
  ]) assert.throws(() => validateReleaseIdentity(record, pkg), /installed release record/, JSON.stringify(record.npm.installCommand));
});
