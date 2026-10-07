// The entries the tests expect, written out from the recorded fixtures by hand. Not a test file.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { hash, integrity, readFixture, repository } from './fixtures.mjs';
import { NPM_FILES, GIT_REPO, GIT_COMMIT, GIT_ITEMS } from '../fixtures/record.mjs';

export const NPM = Object.freeze({
  package: '@synthetic/db-skills', version: '0.0.1',
  metadataUrl: 'https://registry.npmjs.org/@synthetic/db-skills/0.0.1',
  archiveUrl: 'https://registry.npmjs.org/@synthetic/db-skills/-/db-skills-0.0.1.tgz',
});
export const npmMetadataBytes = () => readFixture('npm-db-skills/metadata.json');
export const npmArchiveBytes = () => readFixture('npm-db-skills/archive.tgz');
export const npmResponses = () => new Map([[NPM.metadataUrl, npmMetadataBytes()], [NPM.archiveUrl, npmArchiveBytes()]]);

const text = p => NPM_FILES.find(f => f.path === p).text;
const pin = (p, sourcePath, body) => ({ path: p, sourcePath, sha256: hash(body), bytes: Buffer.byteLength(body) });

/** The resolved npm entry for the collections skill, with LICENSE taken from the package root. */
export function npmCollections() {
  const root = 'skills/synthetic-db/collections';
  return {
    source: { kind: 'npm', registry: 'https://registry.npmjs.org', package: NPM.package, version: NPM.version, integrity: integrity(npmArchiveBytes()), metadataSha256: hash(npmMetadataBytes()), publisher: 'synthetic-publisher' },
    skill: { name: 'synthetic-db-collections', sourceRoot: root },
    license: { spdx: 'MIT', files: ['LICENSE'] },
    files: [pin('LICENSE', 'LICENSE', text('LICENSE')), pin('SKILL.md', `${root}/SKILL.md`, text(`${root}/SKILL.md`)), pin('references/local-collections.md', `${root}/references/local-collections.md`, text(`${root}/references/local-collections.md`)), pin('references/sync-modes.md', `${root}/references/sync-modes.md`, text(`${root}/references/sync-modes.md`))],
    references: [{ from: 'SKILL.md', to: 'references/local-collections.md' }, { from: 'SKILL.md', to: 'references/sync-modes.md' }, { from: 'references/sync-modes.md', to: 'references/local-collections.md' }],
  };
}

export const GIT = Object.freeze({ repository: GIT_REPO, commit: GIT_COMMIT });
const recorded = () => JSON.parse(readFixture('github-skills-repo.json').toString('utf8'));
export const gitResponses = () => new Map(Object.entries(recorded().responses).map(([url, b64]) => [url, Buffer.from(b64, 'base64')]));
/** The same repository rebuilt from its items; its object ids equal the recorded ones. */
export const gitRepo = (items = GIT_ITEMS) => repository(GIT_REPO, GIT_COMMIT, items);
const gitText = p => GIT_ITEMS.find(f => f.path === p).text;

/** The resolved Git entry for skills/verification-loop, with LICENSE taken from the repository root. */
export function gitVerificationLoop() {
  const repo = gitRepo(), root = 'skills/verification-loop', api = `https://api.github.com/repos/${GIT_REPO}/git`;
  return {
    source: { kind: 'git', host: 'github.com', repository: GIT_REPO, commit: GIT_COMMIT, tree: repo.root, pathTrees: [repo.tree('skills'), repo.tree(root)], metadataSha256: hash(gitResponses().get(`${api}/commits/${GIT_COMMIT}`)) },
    skill: { name: 'verification-loop', sourceRoot: root },
    license: { spdx: 'MIT', files: ['LICENSE'] },
    files: [pin('LICENSE', 'LICENSE', gitText('LICENSE')), pin('SKILL.md', `${root}/SKILL.md`, gitText(`${root}/SKILL.md`)), pin('references/checklist.md', `${root}/references/checklist.md`, gitText(`${root}/references/checklist.md`))],
    references: [{ from: 'SKILL.md', to: 'references/checklist.md' }],
  };
}
/** The URLs a Git resolve of skills/verification-loop requests, in order: the same reads acquisition makes. */
export function gitVerificationLoopUrls() {
  const repo = gitRepo(), api = `https://api.github.com/repos/${GIT_REPO}/git`, root = 'skills/verification-loop';
  const blobs = [gitText('LICENSE'), gitText(`${root}/SKILL.md`), gitText(`${root}/references/checklist.md`)].map(t => repo.blob(t)).sort();
  return [`${api}/commits/${GIT_COMMIT}`, `${api}/trees/${repo.root}`, `${api}/trees/${repo.tree('skills')}`, `${api}/trees/${repo.tree(root)}?recursive=1`, ...blobs.map(sha => `${api}/blobs/${sha}`)];
}

/** A private 0700 folder for a cache binding, under the isolated HOME. */
export function privateFolder(t, prefix = 'bowerloom-manifest-test-') {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.homedir()), prefix)); fs.chmodSync(root, 0o700);
  t.after(() => fs.rmSync(root, { recursive: true, force: true })); return root;
}
