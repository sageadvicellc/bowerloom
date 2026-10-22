// Spec 06, section 3.10: Bowerloom reads a few files of ~/.bowerloom/.git and never runs git. normalizeRemote accepts
// seven forms of a github.com remote, and readStoreRepo finds the remote, the branch, HEAD and the pushed commit.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import '../../../dist/tests/support/isolate-home.js';
import { normalizeRemote, readStoreRepo } from '../../../dist/packages/project-config/src/git.js';

const A = 'a'.repeat(40), B = 'b'.repeat(40), C = 'c'.repeat(40);
const REMOTE = 'https://github.com/sageadvicellc/store';
function store(t, { config = '[core]\n\tbare = false\n[remote "origin"]\n\turl = git@github.com:SageAdviceLLC/Store.git\n\tfetch = +refs/heads/*:refs/remotes/origin/*\n', head = 'ref: refs/heads/main\n', refs = { 'refs/heads/main': A, 'refs/remotes/origin/main': B }, packed = null } = {}) {
  const dir = fs.mkdtempSync(path.join(process.env.HOME, 'store-git-')); fs.chmodSync(dir, 0o700);
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const git = path.join(dir, '.git'); fs.mkdirSync(git, { mode: 0o755 });
  if (config !== null) fs.writeFileSync(path.join(git, 'config'), config, { mode: 0o644 });
  if (head !== null) fs.writeFileSync(path.join(git, 'HEAD'), head, { mode: 0o644 });
  for (const [ref, sha] of Object.entries(refs)) { fs.mkdirSync(path.dirname(path.join(git, ref)), { recursive: true, mode: 0o755 }); fs.writeFileSync(path.join(git, ref), `${sha}\n`, { mode: 0o644 }); }
  if (packed !== null) fs.writeFileSync(path.join(git, 'packed-refs'), packed, { mode: 0o644 });
  return dir;
}

test('1. normalizeRemote accepts the seven forms and returns https://github.com/<o>/<r> in lower case', () => {
  for (const url of [
    'https://github.com/SageAdviceLLC/Store', 'https://github.com/SageAdviceLLC/Store.git', 'https://github.com/SageAdviceLLC/Store/',
    'git@github.com:SageAdviceLLC/Store', 'git@github.com:SageAdviceLLC/Store.git',
    'ssh://git@github.com/SageAdviceLLC/Store', 'ssh://git@github.com/SageAdviceLLC/Store.git',
    'https://GitHub.COM/sageadvicellc/store',
  ]) assert.equal(normalizeRemote(url), REMOTE, url);
  assert.equal(normalizeRemote('https://github.com/a-b/x.y_z-1'), 'https://github.com/a-b/x.y_z-1');
});

test('2. normalizeRemote rejects other hosts, http, credentials, a port, a query, a fragment, .. and a long owner', () => {
  for (const url of [
    'https://gitlab.com/o/r', 'http://github.com/o/r', 'https://user:pass@github.com/o/r', 'https://user@github.com/o/r', 'https://github.com:443/o/r',
    'ssh://git@github.com:22/o/r', 'https://github.com/o/r?x=1', 'https://github.com/o/r#main', 'https://github.com/o/..', 'https://github.com/o/.',
    `https://github.com/${'o'.repeat(40)}/r`, 'https://github.com/-o/r', 'https://github.com/o/r/x', 'https://github.com/o', 'git@gitlab.com:o/r.git',
    'file:///tmp/store', '/tmp/store', '', 'https://github.com/o/r.git/', `https://github.com/o/${'r'.repeat(101)}`, 'https://github.com/o/r r',
  ]) assert.equal(normalizeRemote(url), null, url);
});

test('3. readStoreRepo returns none with no .git, unreadable for a .git file, a link or a reftable folder, no-origin and unsupported-remote', t => {
  const plain = fs.mkdtempSync(path.join(process.env.HOME, 'store-plain-')); t.after(() => fs.rmSync(plain, { recursive: true, force: true }));
  assert.deepEqual(readStoreRepo(plain, null), { problem: 'none', remote: null, branch: null, head: null, pushed: null });
  fs.writeFileSync(path.join(plain, '.git'), 'gitdir: /elsewhere\n');
  assert.equal(readStoreRepo(plain, null).problem, 'unreadable');
  fs.rmSync(path.join(plain, '.git'));
  const real = store(t); fs.symlinkSync(path.join(real, '.git'), path.join(plain, '.git'));
  assert.equal(readStoreRepo(plain, null).problem, 'unreadable');
  const reftable = store(t); fs.mkdirSync(path.join(reftable, '.git', 'reftable'));
  assert.equal(readStoreRepo(reftable, null).problem, 'unreadable');
  assert.equal(readStoreRepo(store(t, { config: '[remote "upstream"]\n\turl = https://github.com/o/r\n' }), null).problem, 'no-origin');
  assert.equal(readStoreRepo(store(t, { config: null }), null).problem, 'unreadable');
  assert.equal(readStoreRepo(store(t, { config: '[remote "origin"]\n\turl = https://gitlab.com/o/r\n' }), null).problem, 'unsupported-remote');
});

test('4. it reads the branch from HEAD and the pushed commit from a loose ref or from packed-refs, ignoring comments and peeled lines', t => {
  assert.deepEqual(readStoreRepo(store(t), null), { problem: null, remote: REMOTE, branch: 'main', head: A, pushed: B });
  // A real `git pack-refs` output: a header comment, then lines `<sha> <ref>`, a peeled line after an annotated tag.
  const packed = `# pack-refs with: peeled fully-peeled sorted \n${A} refs/heads/main\n${C} refs/remotes/origin/main\n${B} refs/tags/v1\n^${A}\n`;
  assert.deepEqual(readStoreRepo(store(t, { refs: {}, packed }), null), { problem: null, remote: REMOTE, branch: 'main', head: A, pushed: C });
  // A loose ref wins over packed-refs, as git reads it.
  assert.equal(readStoreRepo(store(t, { refs: { 'refs/remotes/origin/main': B }, packed }), null).pushed, B);
  // A branch with a slash.
  assert.deepEqual(readStoreRepo(store(t, { head: 'ref: refs/heads/feature/x\n', refs: { 'refs/heads/feature/x': A, 'refs/remotes/origin/feature/x': A } }), null), { problem: null, remote: REMOTE, branch: 'feature/x', head: A, pushed: A });
});

test('5. with commit null a detached HEAD is unpushed; with a commit, pushed is that commit and a detached HEAD or a missing ref is no problem', t => {
  const detached = store(t, { head: `${A}\n`, refs: {} });
  assert.equal(readStoreRepo(detached, null).problem, 'unpushed');
  assert.deepEqual(readStoreRepo(detached, C), { problem: null, remote: REMOTE, branch: null, head: null, pushed: C });
  const noRemoteRef = store(t, { refs: { 'refs/heads/main': A } });
  assert.deepEqual(readStoreRepo(noRemoteRef, C), { problem: null, remote: REMOTE, branch: 'main', head: A, pushed: C });
});

test('6 and 7. a missing remote ref gives unpushed; head comes from refs/heads or packed-refs, and a missing value is null', t => {
  assert.equal(readStoreRepo(store(t, { refs: { 'refs/heads/main': A } }), null).problem, 'unpushed');
  assert.deepEqual(readStoreRepo(store(t, { refs: { 'refs/remotes/origin/main': B } }), null), { problem: null, remote: REMOTE, branch: 'main', head: null, pushed: B });
  assert.equal(readStoreRepo(store(t, { refs: { 'refs/remotes/origin/main': B }, packed: `${C} refs/heads/main\n` }), null).head, C);
});

test('8. a branch name with .. is unreadable, and so is a HEAD that is not one of the two forms', t => {
  for (const head of ['ref: refs/heads/a..b\n', 'ref: refs/heads/main', 'ref: refs/heads//x\n', 'ref: refs/tags/v1\n', 'ref: refs/heads/x/\n', `${A.toUpperCase()}\n`, 'hello\n']) {
    assert.equal(readStoreRepo(store(t, { head }), null).problem, 'unreadable', head);
  }
});

test('9. files over their limits are unreadable', t => {
  assert.equal(readStoreRepo(store(t, { config: `[remote "origin"]\n\turl = https://github.com/o/r\n#${'x'.repeat(65536)}\n` }), null).problem, 'unreadable');
  assert.equal(readStoreRepo(store(t, { head: `ref: refs/heads/main\n${' '.repeat(256)}` }), null).problem, 'unreadable');
  assert.equal(readStoreRepo(store(t, { refs: { 'refs/heads/main': A }, packed: `${C} refs/remotes/origin/main\n# ${'x'.repeat(1048576)}\n` }), null).problem, 'unreadable');
  assert.equal(readStoreRepo(store(t, { refs: { 'refs/heads/main': A, 'refs/remotes/origin/main': `${B}\n${B}` } }), null).problem, 'unreadable');
});

test('10. a .git/config with objectformat = sha256 gives unreadable', t => {
  assert.equal(readStoreRepo(store(t, { config: '[core]\n\trepositoryformatversion = 1\n[extensions]\n\tobjectformat = sha256\n[remote "origin"]\n\turl = https://github.com/o/r\n' }), null).problem, 'unreadable');
  assert.equal(readStoreRepo(store(t, { config: '[extensions]\n\tObjectFormat = SHA256\n[remote "origin"]\n\turl = https://github.com/o/r\n' }), null).problem, 'unreadable');
});

test('11. a file that is a link, a FIFO, another owner\'s, or group-writable gives unreadable', t => {
  const linked = store(t); fs.renameSync(path.join(linked, '.git', 'config'), path.join(linked, 'config-elsewhere')); fs.symlinkSync(path.join(linked, 'config-elsewhere'), path.join(linked, '.git', 'config'));
  assert.equal(readStoreRepo(linked, null).problem, 'unreadable');
  const fifo = store(t, { head: null }); execFileSync('mkfifo', [path.join(fifo, '.git', 'HEAD')]);
  assert.equal(readStoreRepo(fifo, null).problem, 'unreadable');
  const foreign = store(t), uid = process.getuid();
  assert.equal(readStoreRepo(foreign, null, { uid: uid + 1 }).problem, 'unreadable');
  const writable = store(t); fs.chmodSync(path.join(writable, '.git', 'refs', 'remotes', 'origin', 'main'), 0o664);
  assert.equal(readStoreRepo(writable, null).problem, 'unreadable');
});
