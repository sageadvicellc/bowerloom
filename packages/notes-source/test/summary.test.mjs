import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { applyGitInit, planGitInit, readNotesSummary } from '../../../dist/packages/notes-source/src/index.js';
import { GIT, needsGit, ownGit, put, refusal, script, tempDir, walkPages } from './fixture.mjs';

/** A wiki with every case the count must get right. */
function wiki(t) {
  const dir = tempDir(t), outside = tempDir(t);
  for (const rel of ['index.md', 'log.md', 'pages/a.md', 'pages/b.md', 'pages/deep/deeper/c.md', 'pages/UPPER.MD', 'sources/README.md', 'reports/README.md']) put(dir, rel);
  put(dir, 'pages/notes.txt'); put(dir, 'pages/md'); put(dir, 'pages/a.md.bak');
  put(dir, '.obsidian/hidden.md'); put(dir, 'pages/.draft.md'); put(dir, '.trash/old.md');
  for (let i = 0; i < 5; i++) put(outside, `far${i}.md`);
  fs.symlinkSync(path.join(dir, 'pages', 'a.md'), path.join(dir, 'link.md'));
  fs.symlinkSync(outside, path.join(dir, 'pages', 'outside'));
  fs.mkdirSync(path.join(dir, 'pages', 'folder.md'));
  return dir;
}

test('the page count is every *.md name outside hidden folders, checked against the test\'s own walk', async t => {
  const dir = wiki(t);
  const s = await readNotesSummary(dir);
  assert.equal(s.format, 'bowerloom/notes-summary/v1beta1');
  assert.equal(s.pages, walkPages(dir));
  assert.equal(s.pages, 8);
  assert.equal(s.complete, true);
});

test('a link in the wiki is skipped: a linked page is not counted and a linked folder is not entered', async t => {
  const dir = wiki(t);
  const without = (await readNotesSummary(dir)).pages;
  fs.symlinkSync(path.join(dir, 'pages', 'b.md'), path.join(dir, 'pages', 'second-link.md'));
  fs.symlinkSync(path.join(dir, 'pages'), path.join(dir, 'pages-again'));
  assert.equal((await readNotesSummary(dir)).pages, without);
});

test('the summary never opens a page: a page nobody can read still counts', async t => {
  const dir = wiki(t);
  fs.chmodSync(path.join(dir, 'pages', 'a.md'), 0o000);
  assert.equal((await readNotesSummary(dir)).pages, 8);
});

test('a folder that cannot be listed leaves the count incomplete, not wrong', async t => {
  const dir = wiki(t);
  fs.chmodSync(path.join(dir, 'pages', 'deep'), 0o000);
  const s = await readNotesSummary(dir);
  assert.equal(s.complete, false);
  assert.equal(s.pages, 7);
});

test('the count is bounded by entries and by time', async t => {
  const dir = wiki(t);
  const few = await readNotesSummary(dir, { maxEntries: 3 });
  assert.equal(few.complete, false);
  assert.ok(few.pages <= 3);
  let now = 0;
  const slow = await readNotesSummary(dir, { timeBudgetMs: 5, clock: () => (now += 10) });
  assert.equal(slow.complete, false);
  assert.ok(slow.pages < 8);
});

test('the latest report comes from reports/YYYY-MM-DD-*.md names only', async t => {
  const dir = wiki(t);
  put(dir, 'reports/2026-10-01-refine.md'); put(dir, 'reports/2026-10-15-refine.md'); put(dir, 'reports/2026-10-15-another.md');
  put(dir, 'reports/2026-13-01-refine.md'); put(dir, 'reports/2026-02-30-refine.md'); put(dir, 'reports/2026-12-01-refine.txt'); put(dir, 'reports/2026-12-01.md');
  fs.symlinkSync(path.join(dir, 'index.md'), path.join(dir, 'reports', '2026-11-20-refine.md'));
  fs.mkdirSync(path.join(dir, 'reports', '2026-11-25-refine.md'));
  put(dir, 'reports/old/2026-12-24-refine.md');
  const s = await readNotesSummary(dir);
  assert.deepEqual(s.latestReport, { date: '2026-10-15', path: 'reports/2026-10-15-refine.md' });
});

test('the latest report says when its listing stopped early', async t => {
  const dir = wiki(t);
  for (let i = 1; i <= 9; i++) put(dir, `reports/2026-10-0${i}-refine.md`);
  const whole = await readNotesSummary(dir);
  assert.equal(whole.reportsComplete, true);
  const cut = await readNotesSummary(dir, { maxEntries: 3 });
  assert.equal(cut.reportsComplete, false, 'the reports folder holds more names than the bound');
  const none = tempDir(t); put(none, 'index.md');
  assert.equal((await readNotesSummary(none)).reportsComplete, true, 'no reports folder is a whole listing of nothing');
});

test('a missing report folder, or one that is a link, gives no latest report', async t => {
  const dir = tempDir(t); put(dir, 'index.md');
  assert.equal((await readNotesSummary(dir)).latestReport, null);
  const other = tempDir(t); put(other, '2026-10-01-refine.md');
  fs.symlinkSync(other, path.join(dir, 'reports'));
  assert.equal((await readNotesSummary(dir)).latestReport, null);
  const file = tempDir(t); put(file, 'reports', 'not a folder');
  assert.equal((await readNotesSummary(file)).latestReport, null);
});

test('the last commit time comes from git log', { skip: needsGit }, async t => {
  const dir = wiki(t);
  fs.unlinkSync(path.join(dir, 'link.md')); fs.unlinkSync(path.join(dir, 'pages', 'outside'));
  const plan = planGitInit(dir);
  await applyGitInit(dir, plan.revision);
  const s = await readNotesSummary(dir);
  assert.equal(s.history, 'git');
  assert.equal(s.lastCommitAt, new Date(Number(ownGit(dir, ['log', '-1', '--format=%ct'])) * 1000).toISOString());
});

test('history is none with no .git, no-commit with no commit yet, and unreadable when .git is not a plain folder', { skip: needsGit }, async t => {
  const dir = tempDir(t); put(dir, 'index.md');
  assert.deepEqual([(await readNotesSummary(dir)).history, (await readNotesSummary(dir)).lastCommitAt], ['none', null]);
  ownGit(dir, ['init', '-q']);
  const empty = await readNotesSummary(dir);
  assert.deepEqual([empty.history, empty.lastCommitAt], ['no-commit', null], 'a .git with no commit is not ready');
  const linked = tempDir(t); put(linked, 'index.md'); fs.symlinkSync(path.join(dir, '.git'), path.join(linked, '.git'));
  assert.deepEqual([(await readNotesSummary(linked)).history, (await readNotesSummary(linked)).lastCommitAt], ['unreadable', null]);
});

test('a missing git still gives the page count, with history git-missing', async t => {
  const dir = wiki(t); fs.mkdirSync(path.join(dir, '.git'));
  const s = await readNotesSummary(dir, { gitCandidates: [] });
  assert.equal(s.history, 'git-missing');
  assert.equal(s.lastCommitAt, null);
  assert.equal(s.pages, 8);
});

test('a git that hangs leaves the history unreadable, within the timeout', async t => {
  const dir = wiki(t), bin = tempDir(t); fs.mkdirSync(path.join(dir, '.git'));
  const s = await readNotesSummary(dir, { gitCandidates: [script(bin, 'git', 'exec /bin/sleep 30')], timeoutMs: 300 });
  assert.deepEqual([s.history, s.lastCommitAt, s.pages], ['unreadable', null, 8]);
});

test('a missing folder refuses NOTES_FOLDER_MISSING and a linked folder NOTES_PATH_UNSAFE', async t => {
  const base = tempDir(t); put(base, 'wiki/index.md');
  await assert.rejects(readNotesSummary(path.join(base, 'absent')), refusal('NOTES_FOLDER_MISSING'));
  fs.symlinkSync(path.join(base, 'wiki'), path.join(base, 'link'));
  await assert.rejects(readNotesSummary(path.join(base, 'link')), refusal('NOTES_PATH_UNSAFE'));
  await assert.rejects(readNotesSummary('wiki'), refusal('NOTES_PATH_UNSAFE'));
});

test('a linked repository\'s own config cannot make the summary run a program, even for a signed commit: each key is refused', { skip: needsGit }, async t => {
  const dir = tempDir(t), bin = tempDir(t); put(dir, 'index.md');
  const marker = path.join(bin, 'ran');
  const hostile = script(bin, 'hostile', `echo "$0" >> "${marker}"; exit 1`);
  ownGit(dir, ['init', '-q']);
  const env = { PATH: '/usr/bin:/bin', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_DIR: path.join(dir, '.git'), GIT_WORK_TREE: dir };
  const tree = execFileSync(GIT.path, ['hash-object', '-t', 'tree', '-w', '--stdin'], { cwd: dir, env, input: '' }).toString().trim();
  const body = `tree ${tree}\nauthor A <a@example.invalid> 1767225600 +0000\ncommitter A <a@example.invalid> 1767225600 +0000\n`
    + 'gpgsig -----BEGIN PGP SIGNATURE-----\n \n abc\n -----END PGP SIGNATURE-----\n\nSigned\n';
  const commit = execFileSync(GIT.path, ['hash-object', '-t', 'commit', '-w', '--stdin'], { cwd: dir, env, input: body }).toString().trim();
  ownGit(dir, ['update-ref', 'HEAD', commit]);
  assert.equal((await readNotesSummary(dir)).lastCommitAt, '2026-01-01T00:00:00.000Z', 'the signed commit reads with a plain config');
  const keys = [['log.showSignature', 'true'], ['gpg.program', hostile], ['gpg.openpgp.program', hostile], ['core.fsmonitor', hostile], ['core.pager', hostile]];
  for (const [k, v] of keys) {
    ownGit(dir, ['config', k, v]);
    const s = await readNotesSummary(dir);
    assert.deepEqual([s.history, s.lastCommitAt], ['refused', null], k);
    ownGit(dir, ['config', '--unset', k]);
  }
  for (const [k, v] of keys) ownGit(dir, ['config', k, v]);
  assert.equal((await readNotesSummary(dir)).history, 'refused');
  assert.equal(fs.existsSync(marker), false, 'no program named by the repository config ran');
});

test('a .git that git cannot read as a repository is no-commit, not git', { skip: needsGit }, async t => {
  const dir = tempDir(t); put(dir, 'index.md');
  fs.mkdirSync(path.join(dir, '.git'));
  const s = await readNotesSummary(dir);
  assert.deepEqual([s.history, s.lastCommitAt], ['no-commit', null]);
});

test('an init stopped before its first commit reads as no-commit', { skip: needsGit }, async t => {
  const dir = tempDir(t); put(dir, 'index.md'); put(dir, 'pages/a.md');
  ownGit(dir, ['init', '-q']);
  ownGit(dir, ['add', '--', 'index.md']);
  const s = await readNotesSummary(dir);
  assert.equal(s.history, 'no-commit');
});
