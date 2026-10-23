// Spec 06, build step 1: the helpers of resolve-git.ts and serializeEntry are exported, and the test helper
// tests/support/fake-github-repo.ts builds a repository the way the GitHub REST API shows it, with real object ids.
import '../../../dist/tests/support/isolate-home.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { denyNetwork, fakeTransport, oid, repository } from './support/fixtures.mjs';
import { GIT_ITEMS, GIT_REPO, GIT_COMMIT } from './fixtures/record.mjs';
import * as resolveGitModule from '../../../dist/packages/skill-manifest/src/resolve-git.js';
import * as schemaModule from '../../../dist/packages/skill-manifest/src/schema.js';
import { parseSkillSpec } from '../../../dist/packages/skill-manifest/src/spec.js';
import { buildFakeRepo } from '../../../dist/tests/support/fake-github-repo.js';

const network = denyNetwork();
test.after(() => assert.deepEqual(network, [], 'no test in this file touches the network'));
const [OWNER, REPO] = GIT_REPO.split('/');
const signal = () => new AbortController().signal;
const filesOf = items => Object.fromEntries(items.map(i => [i.path, i.link !== undefined ? { link: i.link } : i.text]));

test('resolve-git.ts exports its listing helpers, and schema.ts exports serializeEntry, with their bodies unchanged', () => {
  for (const name of ['treeId', 'listing', 'proveRecursive', 'blob', 'unsafeKind']) assert.equal(typeof resolveGitModule[name], 'function', name);
  assert.equal(typeof schemaModule.serializeEntry, 'function');
  // treeId of one blob row is the git object id of that tree.
  const sha = 'a'.repeat(40);
  const want = repository('o/r', 'c'.repeat(40), [{ path: 'x.md', text: 'x' }]);
  const rows = JSON.parse(want.responses.get(`https://api.github.com/repos/o/r/git/trees/${want.root}`)).tree;
  assert.equal(resolveGitModule.treeId(rows.map(r => ({ name: r.path, mode: r.mode, type: r.type, sha: r.sha }))), want.root);
  assert.throws(() => resolveGitModule.unsafeKind({ path: 'l', mode: '120000', type: 'blob', sha }), e => e.code === 'SKILLS_ADD_UNSAFE_CONTENT');
  assert.throws(() => resolveGitModule.unsafeKind({ path: 's', mode: '160000', type: 'commit', sha }), e => e.code === 'SKILLS_ADD_UNSAFE_CONTENT');
  resolveGitModule.unsafeKind({ path: 'f.md', mode: '100644', type: 'blob', sha });
});

test('buildFakeRepo computes the same git object ids as the recorded repository writer', t => {
  const dir = fs.mkdtempSync(`${process.env.HOME}/fake-repo-`); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const fake = buildFakeRepo(OWNER, REPO, filesOf(GIT_ITEMS), GIT_COMMIT, dir);
  const recorded = repository(GIT_REPO, GIT_COMMIT, GIT_ITEMS);
  assert.equal(fake.commit, GIT_COMMIT);
  assert.equal(fake.tree, recorded.root);
  // Every tree and blob URL of the recorded writer is a route, and each route is a fixture file on disk.
  for (const url of recorded.responses.keys()) assert.ok(Object.hasOwn(fake.routes, url), url);
  for (const file of Object.values(fake.routes)) assert.ok(fs.statSync(file).isFile());
  for (const [url, bytes] of recorded.responses) if (url.includes('/trees/') || url.includes('/blobs/')) {
    const ours = JSON.parse(fs.readFileSync(fake.routes[url], 'utf8')), theirs = JSON.parse(bytes);
    assert.equal(ours.sha, theirs.sha, url);
    if (url.includes('/trees/')) assert.deepEqual(ours.tree.map(r => [r.path, r.mode, r.type, r.sha, r.size]), theirs.tree.map(r => [r.path, r.mode, r.type, r.sha, r.size]), url);
    else assert.equal(Buffer.from(ours.content.replace(/\n/g, ''), 'base64').toString('utf8'), Buffer.from(theirs.content.replace(/\n/g, ''), 'base64').toString('utf8'));
  }
});

test('a GitHub skill resolves through a transport that serves buildFakeRepo responses', async t => {
  const dir = fs.mkdtempSync(`${process.env.HOME}/fake-repo-`); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const fake = buildFakeRepo(OWNER, REPO, filesOf(GIT_ITEMS), GIT_COMMIT, dir);
  const resolved = await resolveGitModule.resolveGit(parseSkillSpec(`github:${GIT_REPO}@${GIT_COMMIT}:skills/verification-loop`), fakeTransport(fake.responses), signal());
  assert.equal(resolved.skill.name, 'verification-loop');
  assert.equal(resolved.source.tree, fake.tree);
  assert.deepEqual(resolved.files.map(f => f.path), ['LICENSE', 'SKILL.md', 'references/checklist.md']);
});

test('buildFakeRepo takes file modes, links and submodules, and names the object id of any folder', t => {
  const dir = fs.mkdtempSync(`${process.env.HOME}/fake-repo-`); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const fake = buildFakeRepo('Owner', 'Repo', { 'skills/a/SKILL.md': '# a\n', 'skills/a/run.md': { text: 'x\n', mode: '100755' }, 'skills/a/l': { link: 'SKILL.md' }, 'skills/a/sub': { submodule: true } }, 'd'.repeat(40), dir);
  const listing = JSON.parse(fs.readFileSync(fake.routes[`https://api.github.com/repos/Owner/Repo/git/trees/${fake.treeAt('skills/a')}?recursive=1`], 'utf8')).tree;
  assert.deepEqual(listing.map(r => [r.path, r.mode, r.type]), [['SKILL.md', '100644', 'blob'], ['l', '120000', 'blob'], ['run.md', '100755', 'blob'], ['sub', '160000', 'commit']]);
  assert.equal(fake.blobId('# a\n'), oid('blob', Buffer.from('# a\n')));
  assert.match(fake.treeAt('skills'), /^[a-f0-9]{40}$/);
});
