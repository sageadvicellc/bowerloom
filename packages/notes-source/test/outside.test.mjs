// Git may never read a path outside the repository it is given. A mailmap setting, an alternates file, or a commondir file each point git at another path,
// and a FIFO there hangs the summary until the timeout. Bowerloom turns the mailmap off on the command line and refuses the rest before any git runs.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { GIT_HARDENING, runGit } from '../../../dist/packages/notes-source/src/git.js';
import { readNotesSummary } from '../../../dist/packages/notes-source/src/index.js';
import { GIT, commitAt, needsGit, ownGit, parentRepo, put, refusal, script, tempDir } from './fixture.mjs';

const WHEN = '2024-01-01T00:00:00Z';
const ISO = new Date(WHEN).toISOString();
/** A bound well under the summary's own git timeout, so a hang shows as a slow call rather than only as `unreadable`. */
const QUICK_MS = 2500;

/** A repository with one committed page. */
function committed(t) {
  const dir = tempDir(t); put(dir, 'index.md');
  ownGit(dir, ['init', '-q']);
  commitAt(dir, 'one', WHEN);
  return dir;
}
const fifo = p => { execFileSync('/usr/bin/mkfifo', [p]); return p; };

/** Reads the summary and how long it took. */
async function timed(dir, options = {}) {
  const started = Date.now();
  const s = await readNotesSummary(dir, { timeoutMs: 5000, ...options });
  return { s, ms: Date.now() - started };
}

test('every git call turns the mailmap off on the command line', () => {
  const at = GIT_HARDENING.indexOf('log.mailmap=false');
  assert.ok(at > 0 && GIT_HARDENING[at - 1] === '-c', 'log.mailmap=false is in the hardening options');
});

test('mailmap.file pointing at a FIFO is refused at once, and git never opens it', { skip: needsGit }, async t => {
  const dir = committed(t), elsewhere = tempDir(t);
  ownGit(dir, ['config', 'mailmap.file', fifo(path.join(elsewhere, 'mailmap'))]);
  const { s, ms } = await timed(dir);
  assert.deepEqual([s.history, s.lastCommitAt], ['refused', null]);
  assert.ok(ms < QUICK_MS, `the summary did not wait on the FIFO: ${ms} ms`);
  await assert.rejects(runGit(GIT, dir, { op: 'log-time' }), refusal('NOTES_GIT_CONFIG'));
  ownGit(dir, ['config', '--unset', 'mailmap.file']);
  ownGit(dir, ['config', 'mailmap.blob', 'HEAD:.mailmap']);
  assert.equal((await readNotesSummary(dir)).history, 'refused', 'mailmap.blob is refused too');
});

test('a .mailmap FIFO in the work tree does not hang the summary, because the mailmap is off', { skip: needsGit }, async t => {
  const dir = committed(t);
  fifo(path.join(dir, '.mailmap'));
  const { s, ms } = await timed(dir);
  assert.deepEqual([s.history, s.lastCommitAt], ['git', ISO]);
  assert.ok(ms < QUICK_MS, `the summary did not wait on the FIFO: ${ms} ms`);
});

test('a non-empty alternates file is refused before any git runs; an empty one reads fine', { skip: needsGit }, async t => {
  const other = committed(t), dir = committed(t);
  const alternates = path.join(dir, '.git', 'objects', 'info', 'alternates');
  fs.mkdirSync(path.dirname(alternates), { recursive: true });
  fs.writeFileSync(alternates, '');
  assert.deepEqual([(await readNotesSummary(dir)).history, (await readNotesSummary(dir)).lastCommitAt], ['git', ISO], 'an empty alternates file names no other place');
  fs.writeFileSync(alternates, `${path.join(other, '.git', 'objects')}\n`);
  await assert.rejects(runGit(GIT, dir, { op: 'log-time' }), refusal('NOTES_GIT_CONFIG'));
  await assert.rejects(runGit(GIT, dir, { op: 'status' }), refusal('NOTES_GIT_CONFIG'));
  assert.deepEqual([(await readNotesSummary(dir)).history, (await readNotesSummary(dir)).lastCommitAt], ['refused', null]);
  // Nothing runs: a stand-in git that leaves a mark is never started.
  const bin = tempDir(t), rec = script(bin, 'git', 'touch "$0.ran"');
  assert.equal((await readNotesSummary(dir, { gitCandidates: [rec] })).history, 'refused');
  assert.equal(fs.existsSync(rec + '.ran'), false, 'no git ran, not even the config listing');
});

test('an alternates entry that is a FIFO or a link is refused by its type alone, never read', { skip: needsGit }, async t => {
  for (const make of [p => fifo(p), p => fs.symlinkSync('/dev/null', p), p => fs.mkdirSync(p)]) {
    const dir = committed(t);
    const alternates = path.join(dir, '.git', 'objects', 'info', 'alternates');
    fs.mkdirSync(path.dirname(alternates), { recursive: true });
    make(alternates);
    const { s, ms } = await timed(dir);
    assert.equal(s.history, 'refused');
    assert.ok(ms < QUICK_MS, `${ms} ms`);
  }
});

test('a commondir file in .git is refused before any git runs', { skip: needsGit }, async t => {
  const other = committed(t), dir = committed(t);
  fs.writeFileSync(path.join(dir, '.git', 'commondir'), `${path.join(other, '.git')}\n`);
  await assert.rejects(runGit(GIT, dir, { op: 'log-time' }), refusal('NOTES_GIT_CONFIG'));
  assert.equal((await readNotesSummary(dir)).history, 'refused');
  const bin = tempDir(t), rec = script(bin, 'git', 'touch "$0.ran"');
  assert.equal((await readNotesSummary(dir, { gitCandidates: [rec] })).history, 'refused');
  assert.equal(fs.existsSync(rec + '.ran'), false);
  fs.unlinkSync(path.join(dir, '.git', 'commondir'));
  fifo(path.join(dir, '.git', 'commondir'));
  const { s, ms } = await timed(dir);
  assert.equal(s.history, 'refused', 'a commondir FIFO is refused by its name, never opened');
  assert.ok(ms < QUICK_MS, `${ms} ms`);
});

test('a larger repository with an alternates file is refused for the wiki inside it', { skip: needsGit }, async t => {
  const { root, dir } = parentRepo(t);
  const other = committed(t);
  fs.writeFileSync(path.join(root, '.git', 'objects', 'info', 'alternates'), `${path.join(other, '.git', 'objects')}\n`);
  assert.equal((await readNotesSummary(dir)).history, 'refused');
});
