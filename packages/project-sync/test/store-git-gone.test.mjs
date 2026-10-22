// A frozen fetch whose locked commit is gone from GitHub (a force-push or a deleted branch), told apart from a private
// repository by one extra request for the repository itself. Found by the beta.3 docs review.
import test from '../../../dist/tests/support/lock-slot-retry.js';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import util from 'node:util';
import { testHome } from '../../../dist/tests/support/isolate-home.js';
import { fetchStoreGit, fetchRequests } from '../../../dist/packages/project-sync/src/store-git.js';
import { authoredRows } from '../../../dist/packages/skill-manifest/src/resolve-store-git.js';
import { manifestRefusal } from '../../../dist/packages/skill-manifest/src/refusal.js';
import { GithubToken } from '../../../dist/packages/skill-manifest/src/github-token.js';
import { buildFakeRepo } from '../../../dist/tests/support/fake-github-repo.js';

const COMMIT = '0123456789abcdef0123456789abcdef01234567', REMOTE = 'https://github.com/sageadvicellc/store';
const COMMIT_URL = `https://api.github.com/repos/sageadvicellc/store/git/commits/${COMMIT}`, REPO_URL = 'https://api.github.com/repos/sageadvicellc/store';
const SKILL = '---\nname: house-style\ndescription: A store skill.\n---\nUse it.\n';
const CANARY = 'ghp_' + ('ghijklmnopqrstuvwxyz' + 'zyxwvutsrqponmlkjh').slice(0, 36);
const token = () => GithubToken.fromEnv({ BOWERLOOM_GITHUB_TOKEN: CANARY });
const CREDENTIALS = { variable: 'BOWERLOOM_GITHUB_TOKEN', host: 'api.github.com', repositories: ['sageadvicellc/store'] };
const signal = () => new AbortController().signal;
function state(t) {
  const base = fs.mkdtempSync(path.join(testHome, 'store-gone-')); fs.chmodSync(base, 0o700);
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const stateRoot = path.join(base, 'state'), cacheRoot = path.join(stateRoot, 'cache'), storeCacheRoot = path.join(stateRoot, 'store-cache');
  fs.mkdirSync(cacheRoot, { recursive: true, mode: 0o700 }); fs.chmodSync(stateRoot, 0o700);
  return { roots: { cacheRoot, storeCacheRoot } };
}
function locked(t) {
  const dir = fs.mkdtempSync(path.join(testHome, 'store-gone-repo-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const repo = buildFakeRepo('sageadvicellc', 'store', { 'skills/house-style/SKILL.md': SKILL }, COMMIT, dir), { rows, hash } = authoredRows([{ path: 'SKILL.md', bytes: Buffer.from(SKILL) }]);
  const lockPin = { remote: REMOTE, commit: COMMIT, path: 'skills/house-style', tree: repo.treeAt('skills/house-style'), files: rows, hash };
  return { item: { kind: 'skill', id: 'house-style', requestDigest: hash, lockPin } };
}
/**
 * A transport factory over fixed answers: `commit` and `repository` are what the commit request and the repository
 * request get, a code to throw or 'ok'. Every request is logged with the options of the transport that made it.
 */
function github({ commit, repository }) {
  const log = [];
  const factory = options => ({
    async get(url) {
      log.push({ url, token: options.githubAuth !== undefined });
      const answer = url === COMMIT_URL ? commit : url === REPO_URL ? repository : 'SKILLS_ADD_NOT_FOUND';
      if (answer === 'ok') return Buffer.from('{"full_name":"sageadvicellc/store"}');
      throw manifestRefusal(answer);
    },
    close() {},
  });
  return { factory, log };
}
const fetch = (s, l, net, withToken) => fetchStoreGit(l.item, s.roots, ['api.github.com'], { signal: signal(), storeTransport: net.factory, ...(withToken ? { githubToken: token() } : {}) }, withToken ? CREDENTIALS : null).then(() => null, e => e);
function clean(error) {
  const all = `${error?.code} ${error?.message} ${error?.stack} ${util.inspect(error, { showHidden: true, depth: 8 })} ${JSON.stringify(error)}`;
  for (let i = 0; i + 8 <= CANARY.length; i++) assert.equal(all.includes(CANARY.slice(i, i + 8)), false);
}

test('fix 2. a 404 on the commit of a readable repository is LOCK_COMMIT_GONE, with and without a token', async t => {
  for (const withToken of [false, true]) {
    const s = state(t), l = locked(t), net = github({ commit: 'SKILLS_ADD_NOT_FOUND', repository: 'ok' });
    const error = await fetch(s, l, net, withToken);
    assert.equal(error?.code, 'LOCK_COMMIT_GONE', `token ${withToken}: ${error?.code} ${error?.message}`);
    assert.equal(error.message, 'The locked commit is no longer on GitHub.');
    // One extra request, for the repository, sent with the token exactly when the commit request was.
    assert.deepEqual(net.log, [{ url: COMMIT_URL, token: withToken }, { url: REPO_URL, token: withToken }]);
    assert.ok(net.log.length <= fetchRequests(l.item.lockPin), 'the extra request fits the planned count of the item');
    clean(error);
  }
});

test('fix 2. a repository that is not readable keeps STORE_REMOTE_PRIVATE without a token and STORE_REMOTE_AUTH_FAILED with one', async t => {
  const s = state(t), l = locked(t);
  const plain = github({ commit: 'SKILLS_ADD_NOT_FOUND', repository: 'SKILLS_ADD_NOT_FOUND' });
  assert.equal((await fetch(s, l, plain, false))?.code, 'STORE_REMOTE_PRIVATE');
  assert.deepEqual(plain.log.map(r => r.url), [COMMIT_URL, REPO_URL]);
  const withToken = github({ commit: 'SKILLS_ADD_NOT_FOUND', repository: 'SKILLS_ADD_NOT_FOUND' }), error = await fetch(s, l, withToken, true);
  assert.equal(error?.code, 'STORE_REMOTE_AUTH_FAILED'); clean(error);
  assert.deepEqual(withToken.log, [{ url: COMMIT_URL, token: true }, { url: REPO_URL, token: true }]);
});

test('M2. a refused token (401 or 403) on the commit request makes no repository request and stays STORE_REMOTE_AUTH_FAILED', async t => {
  // A fine-grained token with Metadata read but no Contents read gets 200 on the repository: that is no proof the commit is gone.
  const refused = github({ commit: 'STORE_REMOTE_AUTH_FAILED', repository: 'ok' }), error = await fetch(state(t), locked(t), refused, true);
  assert.equal(error?.code, 'STORE_REMOTE_AUTH_FAILED'); clean(error);
  assert.deepEqual(refused.log.map(r => r.url), [COMMIT_URL]);
});

test('M1. a repository request that cannot tell raises its own code, or keeps the old code and says so', async t => {
  const cases = [
    ['GITHUB_RATE_LIMITED', false, e => e.code === 'GITHUB_RATE_LIMITED'],
    ['SKILLS_ADD_NETWORK', false, e => e.code === 'SKILLS_OFFLINE'],
    ['GITHUB_REQUEST_FAILED', false, e => e.code === 'GITHUB_REQUEST_FAILED'],
    ['GITHUB_TOKEN_SSO_REQUIRED', true, e => e.code === 'GITHUB_TOKEN_SSO_REQUIRED'],
    ['SKILLS_ADD_UNSAFE_CONTENT', false, e => e.code === 'STORE_REMOTE_PRIVATE' && e.message.endsWith('Bowerloom could not check the repository: SKILLS_ADD_UNSAFE_CONTENT.')],
    ['SKILLS_ADD_UNSAFE_CONTENT', true, e => e.code === 'STORE_REMOTE_AUTH_FAILED' && e.message.endsWith('Bowerloom could not check the repository: SKILLS_ADD_UNSAFE_CONTENT.')],
  ];
  for (const [thrown, withToken, ok] of cases) {
    const net = github({ commit: 'SKILLS_ADD_NOT_FOUND', repository: thrown }), error = await fetch(state(t), locked(t), net, withToken);
    assert.ok(error && ok(error), `${thrown} token ${withToken}: ${error?.code} ${error?.message}`);
    assert.deepEqual(net.log.map(r => r.url), [COMMIT_URL, REPO_URL], thrown);
    if (withToken) clean(error);
  }
  // With a token, a refused token on the repository request means it cannot be read: the old code, with no extra words.
  const auth = await fetch(state(t), locked(t), github({ commit: 'SKILLS_ADD_NOT_FOUND', repository: 'STORE_REMOTE_AUTH_FAILED' }), true);
  assert.equal(auth?.code, 'STORE_REMOTE_AUTH_FAILED'); assert.doesNotMatch(auth.message, /could not check/);
  // An error that is no refusal of Bowerloom's passes as it is.
  const odd = { factory: () => ({ async get(url) { if (url === COMMIT_URL) throw manifestRefusal('SKILLS_ADD_NOT_FOUND'); throw new TypeError('a fault'); }, close() {} }) };
  const fault = await fetch(state(t), locked(t), odd, false);
  assert.ok(fault instanceof TypeError, String(fault));
});

test('fix 2. other failures of the commit request make no extra request and keep their codes', async t => {
  for (const [thrown, expected] of [['SKILLS_ADD_NETWORK', 'SKILLS_OFFLINE'], ['GITHUB_RATE_LIMITED', 'GITHUB_RATE_LIMITED']]) {
    const net = github({ commit: thrown, repository: 'ok' });
    assert.equal((await fetch(state(t), locked(t), net, false))?.code, expected, thrown);
    assert.deepEqual(net.log.map(r => r.url), [COMMIT_URL], thrown);
  }
  // A 404 after the commit worked is an item the commit does not hold, as before: no repository request.
  const later = { factory: () => ({ async get(url) { if (url === COMMIT_URL) return Buffer.from(JSON.stringify({ sha: COMMIT, tree: { sha: 'a'.repeat(40) } })); throw manifestRefusal('SKILLS_ADD_NOT_FOUND'); }, close() {} }) };
  const error = await fetch(state(t), locked(t), later, false);
  assert.notEqual(error?.code, 'LOCK_COMMIT_GONE');
});
