import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { COMMIT_MESSAGES, applyGitInit, planGitInit } from '../../../dist/packages/notes-source/src/index.js';
import { GIT, needsGit, ownGit, put, refusal, tempDir } from './fixture.mjs';

/** A linked wiki: pages, a sub-folder, a link, and hidden things a note app leaves behind. */
function linkedWiki(t) {
  const dir = tempDir(t);
  put(dir, 'index.md'); put(dir, 'pages/one.md'); put(dir, 'pages/deep/two.md'); put(dir, 'sources/paper.pdf', 'pdf');
  fs.symlinkSync('pages/one.md', path.join(dir, 'shortcut.md'));
  put(dir, '.obsidian/workspace.json', '{}'); put(dir, '.DS_Store', ''); put(dir, 'pages/.draft.md');
  return dir;
}

test('the plan lists the files the first commit adds, keeps hidden names out, and writes nothing', { skip: needsGit }, t => {
  const dir = linkedWiki(t);
  const plan = planGitInit(dir);
  assert.equal(plan.format, 'bowerloom/notes-git-init-plan/v1beta1');
  assert.equal(plan.dir, dir);
  assert.deepEqual(plan.files, [
    { path: 'index.md', kind: 'file' }, { path: 'pages/deep/two.md', kind: 'file' }, { path: 'pages/one.md', kind: 'file' },
    { path: 'shortcut.md', kind: 'link' }, { path: 'sources/paper.pdf', kind: 'file' },
  ]);
  assert.equal(plan.hidden, 3);
  assert.equal(plan.message, COMMIT_MESSAGES.history);
  assert.match(plan.revision, /^[0-9a-f]{64}$/);
  assert.equal(fs.existsSync(path.join(dir, '.git')), false);
});

test('init on a linked folder gives exactly one commit of the listed files and a clean tree', { skip: needsGit }, async t => {
  const dir = linkedWiki(t);
  const before = fs.readFileSync(path.join(dir, 'pages/one.md'), 'utf8');
  const plan = planGitInit(dir);
  const result = await applyGitInit(dir, plan.revision);
  assert.equal(result.clean, true);
  assert.deepEqual(result.files, plan.files.map(f => f.path));
  assert.match(result.committedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(ownGit(dir, ['rev-list', '--count', 'HEAD']), '1');
  assert.equal(ownGit(dir, ['rev-list', '--all', '--count']), '1');
  assert.equal(ownGit(dir, ['status', '--porcelain', '--untracked-files=all']), '');
  assert.deepEqual(ownGit(dir, ['ls-files']).split('\n'), plan.files.map(f => f.path));
  assert.match(ownGit(dir, ['ls-files', '-s', 'shortcut.md']), /^120000 /, 'the link is stored as a link, never followed');
  assert.equal(ownGit(dir, ['log', '-1', '--format=%s']), COMMIT_MESSAGES.history);
  assert.equal(fs.readFileSync(path.join(dir, 'pages/one.md'), 'utf8'), before);
});

test('a folder inside another repository gets its own repository, and the outer one is untouched', { skip: needsGit }, async t => {
  const outer = tempDir(t);
  execFileSync(GIT.path, ['init', '-q'], { cwd: outer, env: { PATH: '/usr/bin:/bin', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' } });
  const dir = path.join(outer, 'wiki'); put(dir, 'index.md');
  const plan = planGitInit(dir);
  await applyGitInit(dir, plan.revision);
  assert.equal(ownGit(dir, ['rev-list', '--count', 'HEAD']), '1');
  assert.throws(() => ownGit(outer, ['rev-parse', 'HEAD']), 'the outer repository still has no commit');
});

test('more files than one add takes are added in batches, still as one commit', { skip: needsGit }, async t => {
  const dir = tempDir(t);
  for (let i = 0; i < 1500; i++) put(dir, `pages/p${String(i).padStart(4, '0')}.md`, 'x');
  const plan = planGitInit(dir);
  assert.equal(plan.files.length, 1500);
  const result = await applyGitInit(dir, plan.revision);
  assert.equal(result.clean, true);
  assert.equal(ownGit(dir, ['rev-list', '--count', 'HEAD']), '1');
  assert.equal(ownGit(dir, ['ls-files']).split('\n').length, 1500);
});

test('a folder that is already a repository refuses NOTES_ALREADY_REPOSITORY, whatever .git is', { skip: needsGit }, t => {
  for (const make of [d => fs.mkdirSync(path.join(d, '.git')), d => fs.writeFileSync(path.join(d, '.git'), 'gitdir: elsewhere\n'), d => fs.symlinkSync('/nowhere', path.join(d, '.git'))]) {
    const dir = tempDir(t); put(dir, 'index.md'); make(dir);
    assert.throws(() => planGitInit(dir), refusal('NOTES_ALREADY_REPOSITORY'));
  }
});

test('a nested repository, a git settings file, or no file to commit is refused', { skip: needsGit }, t => {
  const nested = tempDir(t); put(nested, 'index.md'); fs.mkdirSync(path.join(nested, 'pages', 'sub', '.git'), { recursive: true });
  assert.throws(() => planGitInit(nested), refusal('NOTES_NESTED_REPOSITORY'));
  for (const name of ['.gitignore', 'pages/.gitattributes', '.gitmodules']) {
    const dir = tempDir(t); put(dir, 'index.md'); put(dir, name, 'x\n');
    assert.throws(() => planGitInit(dir), refusal('NOTES_GIT_FILES'), name);
  }
  const empty = tempDir(t); put(empty, '.DS_Store', '');
  assert.throws(() => planGitInit(empty), refusal('NOTES_NOTHING_TO_COMMIT'));
});

test('a name git cannot take safely, or too many entries, is refused', { skip: needsGit }, t => {
  const odd = tempDir(t); put(odd, 'index.md'); put(odd, 'bad\nname.md');
  assert.throws(() => planGitInit(odd), refusal('NOTES_PATH_UNSAFE'));
  const back = tempDir(t); put(back, 'a\\b.md');
  assert.throws(() => planGitInit(back), refusal('NOTES_PATH_UNSAFE'));
  const big = tempDir(t); for (let i = 0; i < 5; i++) put(big, `p${i}.md`);
  assert.throws(() => planGitInit(big, { maxEntries: 3 }), refusal('NOTES_TOO_LARGE'));
});

test('the folder must be a real folder of yours at its real path', { skip: needsGit }, t => {
  const base = tempDir(t), dir = path.join(base, 'wiki'); put(dir, 'index.md');
  fs.symlinkSync(dir, path.join(base, 'link'));
  assert.throws(() => planGitInit(path.join(base, 'link')), refusal('NOTES_PATH_UNSAFE'));
  assert.throws(() => planGitInit(path.join(base, 'absent')), refusal('NOTES_FOLDER_MISSING'));
  assert.throws(() => planGitInit(path.join(dir, 'index.md')), refusal('NOTES_PATH_UNSAFE'));
});

test('apply refuses NOTES_STALE when the folder changed after the plan, and starts no repository', { skip: needsGit }, async t => {
  const dir = linkedWiki(t);
  const plan = planGitInit(dir);
  put(dir, 'pages/new.md');
  await assert.rejects(applyGitInit(dir, plan.revision), refusal('NOTES_STALE'));
  const again = planGitInit(dir);
  fs.appendFileSync(path.join(dir, 'index.md'), 'more text\n');
  await assert.rejects(applyGitInit(dir, again.revision), refusal('NOTES_STALE'));
  await assert.rejects(applyGitInit(dir, 'a'.repeat(64)), refusal('NOTES_STALE'));
  assert.equal(fs.existsSync(path.join(dir, '.git')), false);
});

test('a missing git refuses NOTES_GIT_MISSING at the plan and at apply, and starts no repository', async t => {
  const dir = tempDir(t); put(dir, 'index.md');
  assert.throws(() => planGitInit(dir, { gitCandidates: [] }), refusal('NOTES_GIT_MISSING'));
  await assert.rejects(applyGitInit(dir, 'a'.repeat(64), { gitCandidates: [] }), refusal('NOTES_GIT_MISSING'));
  assert.equal(fs.existsSync(path.join(dir, '.git')), false);
});
