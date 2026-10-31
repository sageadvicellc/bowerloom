// A wiki folder inside a larger repository (the owner's decision of 2026-10-30, option A): Bowerloom reads the larger repository's history for the wiki
// folder only, never starts a new repository there, and finds the repository by a walk of plain folders, without git's own discovery.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { GIT_HARDENING, checkGitArgv, gitArgv } from '../../../dist/packages/notes-source/src/git.js';
import { applyGitInit, applyStarter, planGitInit, planStarter, readNotesSummary } from '../../../dist/packages/notes-source/src/index.js';
import { commitAt, needsGit, ownGit, parentRepo, put, refusal, script, template, tempDir } from './fixture.mjs';

const H = [...GIT_HARDENING];
const iso = when => new Date(when).toISOString();

// ---- the summary -------------------------------------------------------------------------------------------------------

test('a wiki at repo/knowledge-base/, in a clone with a remote and worktreeConfig, reads its history from the larger repository', { skip: needsGit }, async t => {
  const { dir } = parentRepo(t);
  const s = await readNotesSummary(dir);
  assert.equal(s.history, 'parent');
  assert.equal(s.pages, 3, 'the page count is a walk of the wiki folder only');
  assert.equal(s.complete, true);
});

test('the last commit time is for the wiki folder only: a newer commit outside it is not counted', { skip: needsGit }, async t => {
  const { root, dir, wikiAt, outsideAt } = parentRepo(t);
  assert.ok(iso(outsideAt) > iso(wikiAt));
  assert.equal(ownGit(root, ['log', '-1', '--format=%s']), 'code outside the wiki', 'the newest commit of the repository is outside the wiki');
  const s = await readNotesSummary(dir);
  assert.equal(s.lastCommitAt, iso(wikiAt));
});

test('a wiki deeper in the larger repository reads the same way, by its own prefix', { skip: needsGit }, async t => {
  const { dir, wikiAt } = parentRepo(t, { wiki: 'docs/team notes/wiki' });
  const s = await readNotesSummary(dir);
  assert.deepEqual([s.history, s.lastCommitAt], ['parent', iso(wikiAt)]);
});

test('a wiki folder the larger repository has never committed reads as parent, with no last commit', { skip: needsGit }, async t => {
  const { root } = parentRepo(t);
  const fresh = path.join(root, 'new-wiki'); put(fresh, 'index.md');
  const s = await readNotesSummary(fresh);
  assert.deepEqual([s.history, s.lastCommitAt, s.pages], ['parent', null, 1]);
});

test('every command for a parent runs with GIT_DIR and GIT_WORK_TREE at the root, the root as cwd, and the wiki prefix as its pathspec', async t => {
  const base = tempDir(t), root = path.join(base, 'repo'), dir = path.join(root, 'kb', 'inner');
  fs.mkdirSync(path.join(root, '.git'), { recursive: true }); put(dir, 'index.md');
  const bin = tempDir(t);
  const rec = script(bin, 'git', 'printf "%s\\n" "$@" > "$0.argv"; /usr/bin/env > "$0.env"; /bin/pwd -P > "$0.cwd"');
  const s = await readNotesSummary(dir, { gitCandidates: [rec] });
  assert.deepEqual([s.history, s.lastCommitAt], ['parent', null], 'a stand-in that prints nothing is a folder with no commit yet');
  assert.deepEqual(fs.readFileSync(rec + '.argv', 'utf8').trimEnd().split('\n'), [...H, 'log', '-1', '--format=%ct', '--', 'kb/inner']);
  assert.equal(fs.readFileSync(rec + '.cwd', 'utf8').trim(), root);
  const env = fs.readFileSync(rec + '.env', 'utf8');
  assert.match(env, new RegExp(`^GIT_DIR=${path.join(root, '.git').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm'));
  assert.match(env, new RegExp(`^GIT_WORK_TREE=${root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm'));
  assert.match(env, /^GIT_LITERAL_PATHSPECS=1$/m);
});

test('the log form with a prefix is on the allowlist only for a plain relative prefix', () => {
  assert.deepEqual(gitArgv({ op: 'log-time', prefix: 'knowledge-base' }), [...H, 'log', '-1', '--format=%ct', '--', 'knowledge-base']);
  assert.deepEqual(gitArgv({ op: 'log-time', prefix: 'docs/team notes/wiki' }), [...H, 'log', '-1', '--format=%ct', '--', 'docs/team notes/wiki']);
  for (const prefix of ['', '.', '..', '../x', '/abs', '-x', '.hidden', 'a/.git', 'a//b', 'a/', 'a\nb', 7]) {
    assert.throws(() => gitArgv({ op: 'log-time', prefix }), refusal('NOTES_GIT_ARGV'), JSON.stringify(prefix));
    assert.throws(() => checkGitArgv([...H, 'log', '-1', '--format=%ct', '--', prefix]), refusal('NOTES_GIT_ARGV'), JSON.stringify(prefix));
  }
  for (const argv of [[...H, 'log', '-1', '--format=%ct', '--'], [...H, 'log', '-1', '--format=%ct', 'kb'], [...H, 'log', '-1', '--format=%ct', '--', 'a', 'b']]) {
    assert.throws(() => checkGitArgv(argv), refusal('NOTES_GIT_ARGV'), JSON.stringify(argv.slice(H.length)));
  }
  assert.throws(() => gitArgv({ op: 'status', prefix: 'kb' }), refusal('NOTES_GIT_ARGV'), 'only the log takes a prefix');
});

test('a larger repository whose own config could start a program is refused, and nothing runs', { skip: needsGit }, async t => {
  const { root, dir } = parentRepo(t);
  const bin = tempDir(t), marker = path.join(bin, 'ran');
  ownGit(root, ['config', 'extensions.partialClone', 'origin']);
  ownGit(root, ['config', 'remote.origin.promisor', 'true']);
  ownGit(root, ['config', 'core.sshCommand', script(bin, 'ssh', `echo "$0" >> "${marker}"; exit 1`)]);
  const s = await readNotesSummary(dir);
  assert.deepEqual([s.history, s.lastCommitAt, s.pages], ['refused', null, 3]);
  assert.equal(fs.existsSync(marker), false);
});

test('a .git file or link in a folder above is not followed: the history is unreadable', { skip: needsGit }, async t => {
  for (const make of [root => fs.writeFileSync(path.join(root, '.git'), 'gitdir: elsewhere\n'), root => fs.symlinkSync('/nowhere', path.join(root, '.git'))]) {
    const base = tempDir(t), root = path.join(base, 'repo'), dir = path.join(root, 'kb');
    put(dir, 'index.md'); make(root);
    const s = await readNotesSummary(dir);
    assert.deepEqual([s.history, s.lastCommitAt, s.pages], ['unreadable', null, 1]);
  }
});

test('the nearest .git wins: a wiki with its own repository inside a larger one reads its own', { skip: needsGit }, async t => {
  const { root } = parentRepo(t);
  const own = path.join(root, 'own-wiki'); put(own, 'index.md');
  ownGit(own, ['init', '-q']);
  const s = await readNotesSummary(own);
  assert.equal(s.history, 'no-commit', 'its own repository has no commit, and the larger one is not read');
});

test('the walk stops at the home folder: a repository at or above home is not a parent', { skip: needsGit }, async t => {
  const base = tempDir(t), home = path.join(base, 'home'), dir = path.join(home, 'Documents', 'wiki');
  put(dir, 'index.md');
  ownGit(base, ['init', '-q']);
  assert.equal((await readNotesSummary(dir)).history, 'no-commit', 'a larger repository with no commit at all is not ready');
  put(base, 'README.md'); commitAt(base, 'readme', '2024-01-01T00:00:00Z', ['README.md']);
  assert.equal((await readNotesSummary(dir)).history, 'parent', 'with the real home elsewhere, the walk reaches the repository');
  assert.equal((await readNotesSummary(dir, { home })).history, 'none', 'with home in between, the walk stops there');
  ownGit(home, ['init', '-q']);
  assert.equal((await readNotesSummary(dir, { home })).history, 'none', 'a repository at home itself is not used');
  assert.equal(planGitInit(dir, { home }).files.length, 1, 'and the history offer stays');
});

// ---- init and the starter ----------------------------------------------------------------------------------------------

test('planGitInit refuses a folder inside a larger repository with NOTES_PARENT_REPOSITORY, and apply starts nothing', { skip: needsGit }, async t => {
  const { root, dir } = parentRepo(t);
  const head = ownGit(root, ['rev-parse', 'HEAD']);
  assert.throws(() => planGitInit(dir), refusal('NOTES_PARENT_REPOSITORY'));
  await assert.rejects(applyGitInit(dir, 'a'.repeat(64)), refusal('NOTES_PARENT_REPOSITORY'));
  assert.equal(fs.existsSync(path.join(dir, '.git')), false);
  assert.equal(ownGit(root, ['rev-parse', 'HEAD']), head);
  const deep = path.join(root, 'a', 'b', 'c'); put(deep, 'index.md');
  assert.throws(() => planGitInit(deep), refusal('NOTES_PARENT_REPOSITORY'), 'at any depth');
});

test('planGitInit refuses a folder under a .git file or link too, since that is a larger repository', { skip: needsGit }, t => {
  const base = tempDir(t), root = path.join(base, 'repo'), dir = path.join(root, 'kb');
  put(dir, 'index.md'); fs.writeFileSync(path.join(root, '.git'), 'gitdir: elsewhere\n');
  assert.throws(() => planGitInit(dir), refusal('NOTES_PARENT_REPOSITORY'));
});

test('Start fresh inside a larger repository is refused and writes nothing: no nested repository, no file', { skip: needsGit }, async t => {
  const { root } = parentRepo(t);
  const status = ownGit(root, ['status', '--porcelain']);
  const empty = path.join(root, 'empty-wiki'); fs.mkdirSync(empty);
  assert.throws(() => planStarter(empty, template()), refusal('NOTES_PARENT_REPOSITORY'));
  await assert.rejects(applyStarter(empty, 'a'.repeat(64), template()), refusal('NOTES_PARENT_REPOSITORY'));
  assert.deepEqual(fs.readdirSync(empty), []);
  const absent = path.join(root, 'docs', 'new-wiki'); fs.mkdirSync(path.dirname(absent));
  assert.throws(() => planStarter(absent, template()), refusal('NOTES_PARENT_REPOSITORY'), 'a folder that does not exist yet');
  await assert.rejects(applyStarter(absent, 'a'.repeat(64), template()), refusal('NOTES_PARENT_REPOSITORY'));
  assert.equal(fs.existsSync(absent), false);
  assert.equal(ownGit(root, ['status', '--porcelain']), status, 'the larger repository is as it was');
});

test('Start fresh beside a larger repository, outside it, still works', { skip: needsGit }, async t => {
  const { base } = parentRepo(t);
  const dir = path.join(base, 'outside-wiki');
  const plan = planStarter(dir, template());
  const result = await applyStarter(dir, plan.revision, template());
  assert.equal(result.clean, true);
  assert.equal(ownGit(dir, ['rev-list', '--count', 'HEAD']), '1');
});

test('a home folder that is not absolute is refused as a usage error', async t => {
  const dir = tempDir(t); put(dir, 'index.md');
  await assert.rejects(readNotesSummary(dir, { home: 'relative/home' }), refusal('NOTES_USAGE'));
  assert.throws(() => planGitInit(dir, { home: 'relative/home' }), refusal('NOTES_USAGE'));
  assert.throws(() => planStarter(path.join(dir, 'new'), template(), { home: 'relative/home' }), refusal('NOTES_USAGE'));
});
