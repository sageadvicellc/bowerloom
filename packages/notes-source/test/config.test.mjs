// A notes folder's own git config is not trusted. These tests build hostile repositories with real git and check that
// no command named in that config runs, and that Bowerloom refuses the folder before it runs any command but init.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { GIT_HARDENING, gitEnvironment, riskyConfigKey, runGit } from '../../../dist/packages/notes-source/src/git.js';
import { readNotesSummary } from '../../../dist/packages/notes-source/src/index.js';
import { GIT, needsGit, ownGit, put, refusal, script, tempDir } from './fixture.mjs';

/**
 * A partial clone whose HEAD names a commit that is not in the folder. A plain `git log -1` fetches it lazily from the
 * promisor remote, through `core.sshCommand`, which here writes a marker file.
 */
function promisor(t, extra = []) {
  const dir = tempDir(t), bin = tempDir(t);
  put(dir, 'index.md');
  const marker = path.join(bin, 'ran');
  const ssh = script(bin, 'ssh', `echo "$0" >> "${marker}"; exit 1`);
  ownGit(dir, ['init', '-q']);
  for (const [k, v] of [
    ['core.repositoryformatversion', '1'], ['extensions.partialClone', 'origin'], ['remote.origin.url', 'ssh://example.invalid/notes'],
    ['remote.origin.promisor', 'true'], ['core.sshCommand', ssh], ...extra,
  ]) ownGit(dir, ['config', k, v]);
  const head = fs.readFileSync(path.join(dir, '.git', 'HEAD'), 'utf8').trim().replace(/^ref: /, '');
  fs.mkdirSync(path.dirname(path.join(dir, '.git', head)), { recursive: true });
  fs.writeFileSync(path.join(dir, '.git', head), `${'1234567890'.repeat(4)}\n`);
  return { dir, marker };
}

test('a promisor repository whose config names an ssh command is refused before git log runs, and nothing runs', { skip: needsGit }, async t => {
  const { dir, marker } = promisor(t);
  await assert.rejects(runGit(GIT, dir, { op: 'log-time' }), refusal('NOTES_GIT_CONFIG'));
  await assert.rejects(runGit(GIT, dir, { op: 'status' }), refusal('NOTES_GIT_CONFIG'));
  const s = await readNotesSummary(dir);
  assert.equal(s.history, 'refused');
  assert.equal(s.lastCommitAt, null);
  assert.equal(s.pages, 1, 'the page count does not need git');
  assert.equal(fs.existsSync(marker), false, 'the ssh command named by the repository config did not run');
});

test('each risky key of a repository config is refused on its own', { skip: needsGit }, async t => {
  const cases = [
    ['extensions.partialClone', 'origin'], ['extensions.preciousObjects', 'true'], ['core.sshCommand', '/bin/false'], ['Core.SSHCommand', '/bin/false'],
    ['core.gitProxy', '/bin/false'], ['ssh.variant', 'ssh'], ['remote.origin.promisor', 'true'], ['remote.origin.partialclonefilter', 'blob:none'],
    ['remote.other.vcs', 'hg'], ['remote.other.uploadpack', '/bin/false'], ['remote.other.receivepack', '/bin/false'], ['uploadpack.packObjectsHook', '/bin/false'],
    ['receivepack.shallowUpdate', 'true'], ['protocol.ssh.allow', 'always'], ['protocol.allow', 'always'], ['include.path', '/dev/null'], ['includeIf.gitdir:/.path', '/dev/null'],
  ];
  for (const [key, value] of cases) {
    const dir = tempDir(t); put(dir, 'index.md');
    ownGit(dir, ['init', '-q']);
    // Version 1, so git reads an extension rather than stopping on it.
    ownGit(dir, ['config', 'core.repositoryformatversion', '1']);
    ownGit(dir, ['config', key, value]);
    await assert.rejects(runGit(GIT, dir, { op: 'status' }), refusal('NOTES_GIT_CONFIG'), key);
  }
});

test('the key names alone: a remote address, a fetch rule, worktreeConfig and objectFormat pass; promisor, transport, and program keys do not', () => {
  for (const key of ['remote.origin.url', 'remote.origin.fetch', 'remote.origin.pushurl', 'remote.a.b.url', 'Remote.Origin.URL', 'extensions.worktreeConfig',
    'extensions.worktreeconfig', 'extensions.objectFormat', 'core.bare', 'user.name', 'branch.main.remote', 'remote.origin.tagopt']) {
    assert.equal(riskyConfigKey(key), false, key);
  }
  for (const key of ['extensions.partialClone', 'extensions.partialclone', 'extensions.preciousObjects', 'extensions.refStorage', 'extensions.anything', 'remote.origin.promisor',
    'remote.origin.partialclonefilter', 'remote.origin.partialCloneFilter', 'remote.origin.vcs', 'remote.origin.uploadpack', 'remote.origin.receivepack', 'uploadpack.packobjectshook',
    'receivepack.anything', 'protocol.allow', 'protocol.file.allow', 'include.path', 'includeif.gitdir:/x.path', 'core.sshcommand', 'core.gitproxy', 'ssh.variant']) {
    assert.equal(riskyConfigKey(key), true, key);
  }
});

test('a repository cloned from a remote, with worktreeConfig and objectFormat set, reads fine', { skip: needsGit }, async t => {
  const dir = tempDir(t); put(dir, 'index.md');
  ownGit(dir, ['init', '-q']);
  for (const [k, v] of [
    ['core.repositoryformatversion', '1'], ['extensions.worktreeConfig', 'true'], ['extensions.objectFormat', 'sha1'], ['remote.origin.url', 'ssh://example.invalid/notes'],
    ['remote.origin.fetch', '+refs/heads/*:refs/remotes/origin/*'], ['remote.origin.pushurl', 'ssh://example.invalid/notes'], ['branch.main.remote', 'origin'],
  ]) ownGit(dir, ['config', k, v]);
  assert.equal(await runGit(GIT, dir, { op: 'status' }), '?? index.md\n');
  ownGit(dir, ['add', '--', 'index.md']);
  ownGit(dir, ['-c', 'user.name=Test', '-c', 'user.email=test@localhost', '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'one']);
  const s = await readNotesSummary(dir);
  assert.equal(s.history, 'git');
  assert.match(s.lastCommitAt ?? '', /^\d{4}-\d{2}-\d{2}T/);
});

test('with worktreeConfig on, a risky key in the worktree config is refused too', { skip: needsGit }, async t => {
  for (const [key, value] of [['core.sshCommand', '/bin/false'], ['include.path', '/dev/null'], ['remote.origin.promisor', 'true']]) {
    const dir = tempDir(t); put(dir, 'index.md');
    ownGit(dir, ['init', '-q']);
    ownGit(dir, ['config', 'core.repositoryformatversion', '1']);
    ownGit(dir, ['config', 'extensions.worktreeConfig', 'true']);
    ownGit(dir, ['config', '--worktree', key, value]);
    await assert.rejects(runGit(GIT, dir, { op: 'status' }), refusal('NOTES_GIT_CONFIG'), key);
    assert.equal((await readNotesSummary(dir)).history, 'refused', key);
  }
});

test('a plain repository config passes the check', { skip: needsGit }, async t => {
  const dir = tempDir(t); put(dir, 'index.md');
  ownGit(dir, ['init', '-q']);
  ownGit(dir, ['config', 'user.name', 'Someone']);
  ownGit(dir, ['config', 'remote.origin.fetch', '+refs/heads/*:refs/remotes/origin/*']);
  assert.equal(await runGit(GIT, dir, { op: 'status' }), '?? index.md\n');
});

test('every git call forbids every transport and lazy fetches', () => {
  const at = GIT_HARDENING.indexOf('protocol.allow=never');
  assert.ok(at > 0 && GIT_HARDENING[at - 1] === '-c', 'protocol.allow=never is in the hardening options');
  const ssh = GIT_HARDENING.indexOf('core.sshCommand=false');
  assert.ok(ssh > 0 && GIT_HARDENING[ssh - 1] === '-c', 'the command line overrides any ssh command of the repository');
  for (const op of ['init', 'status', 'log-time']) {
    const env = gitEnvironment('/notes', op);
    assert.equal(env.GIT_NO_LAZY_FETCH, '1', op);
    assert.equal(env.GIT_PROTOCOL_FROM_USER, '0', op);
  }
});

test('the config check runs under the same hardening and with no include followed', { skip: needsGit }, async t => {
  // A config file that an include would pull in names an ssh command. The include itself is refused, so its file is never read for git log.
  const { dir, marker } = promisor(t);
  const bin = tempDir(t);
  const other = path.join(bin, 'other.config');
  fs.writeFileSync(other, '[core]\n\tsshCommand = /bin/false\n');
  ownGit(dir, ['config', '--unset', 'core.sshCommand']);
  ownGit(dir, ['config', 'include.path', other]);
  await assert.rejects(runGit(GIT, dir, { op: 'log-time' }), refusal('NOTES_GIT_CONFIG'));
  assert.equal(fs.existsSync(marker), false);
});
