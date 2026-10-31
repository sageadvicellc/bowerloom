import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { COMMIT_MESSAGES, NOTES_REFUSAL_CODES, applyStarter, planStarter } from '../../../dist/packages/notes-source/src/index.js';
import { needsGit, ownGit, put, refusal, template, tempDir } from './fixture.mjs';

const PATHS = ['AGENTS.md', 'index.md', 'log.md', 'pages/README.md', 'reports/README.md', 'sources/README.md'];

test('every refusal code is a NOTES_ code', () => {
  assert.ok(NOTES_REFUSAL_CODES.length >= 10);
  for (const c of NOTES_REFUSAL_CODES) assert.match(c, /^NOTES_[A-Z_]+$/);
});

test('the plan for an absent folder lists every folder and file, and writes nothing', { skip: needsGit }, t => {
  const dir = path.join(tempDir(t), 'notes');
  const plan = planStarter(dir, template());
  assert.equal(plan.format, 'bowerloom/notes-starter-plan/v1beta1');
  assert.equal(plan.dir, dir);
  assert.equal(plan.createsFolder, true);
  assert.deepEqual(plan.folders, ['pages', 'reports', 'sources']);
  assert.deepEqual(plan.files.map(f => f.path), PATHS);
  for (const f of plan.files) { assert.match(f.sha256, /^[0-9a-f]{64}$/); assert.ok(f.bytes > 0); }
  assert.equal(plan.message, COMMIT_MESSAGES.starter);
  assert.match(plan.revision, /^[0-9a-f]{64}$/);
  assert.equal(fs.existsSync(dir), false);
  assert.equal(planStarter(dir, template()).revision, plan.revision, 'the same input plans the same revision');
});

test('apply creates the folder and files, then git init gives exactly one commit and a clean tree', { skip: needsGit }, async t => {
  const dir = path.join(tempDir(t), 'notes');
  const plan = planStarter(dir, template());
  const result = await applyStarter(dir, plan.revision, template());
  assert.deepEqual(result.files, PATHS);
  assert.equal(result.clean, true);
  assert.match(result.committedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.000Z$/);
  for (const f of template()) {
    const abs = path.join(dir, f.path);
    assert.deepEqual(new Uint8Array(fs.readFileSync(abs)), f.bytes);
    assert.equal(fs.statSync(abs).mode & 0o777, 0o644);
  }
  for (const d of ['', 'pages', 'reports', 'sources']) assert.equal(fs.statSync(path.join(dir, d)).mode & 0o777, 0o755);
  assert.equal(ownGit(dir, ['rev-list', '--count', 'HEAD']), '1');
  assert.equal(ownGit(dir, ['status', '--porcelain', '--untracked-files=all']), '');
  assert.deepEqual(ownGit(dir, ['ls-files']).split('\n'), PATHS);
  assert.equal(ownGit(dir, ['log', '-1', '--format=%s']), COMMIT_MESSAGES.starter);
  fs.writeFileSync(path.join(dir, '.DS_Store'), 'x');
  fs.mkdirSync(path.join(dir, '.obsidian')); fs.writeFileSync(path.join(dir, '.obsidian', 'workspace.json'), '{}');
  assert.equal(ownGit(dir, ['status', '--porcelain', '--untracked-files=all']), '', 'hidden files never dirty the tree');
});

test('apply into an existing empty folder works the same', { skip: needsGit }, async t => {
  const dir = tempDir(t);
  const plan = planStarter(dir, template());
  assert.equal(plan.createsFolder, false);
  const result = await applyStarter(dir, plan.revision, template());
  assert.equal(result.clean, true);
  assert.equal(ownGit(dir, ['rev-list', '--count', 'HEAD']), '1');
});

test('create-only: a folder that holds anything, even one hidden file, refuses NOTES_NOT_EMPTY and nothing is written', { skip: needsGit }, async t => {
  for (const fill of [d => put(d, 'page.md'), d => fs.writeFileSync(path.join(d, '.DS_Store'), ''), d => fs.mkdirSync(path.join(d, 'pages')), d => fs.mkdirSync(path.join(d, '.git'))]) {
    const dir = tempDir(t);
    fill(dir);
    const before = fs.readdirSync(dir).sort();
    assert.throws(() => planStarter(dir, template()), refusal('NOTES_NOT_EMPTY'));
    await assert.rejects(applyStarter(dir, 'a'.repeat(64), template()), refusal('NOTES_NOT_EMPTY'));
    assert.deepEqual(fs.readdirSync(dir).sort(), before);
  }
});

test('a folder that is a link, a file, not its real path, or under a missing parent is refused', { skip: needsGit }, t => {
  const base = tempDir(t), real = path.join(base, 'real'); fs.mkdirSync(real);
  fs.symlinkSync(real, path.join(base, 'link'));
  fs.writeFileSync(path.join(base, 'file'), '');
  assert.throws(() => planStarter(path.join(base, 'link'), template()), refusal('NOTES_PATH_UNSAFE'));
  assert.throws(() => planStarter(path.join(base, 'file'), template()), refusal('NOTES_PATH_UNSAFE'));
  assert.throws(() => planStarter(path.join(base, 'link', 'notes'), template()), refusal('NOTES_PATH_UNSAFE'));
  assert.throws(() => planStarter(path.join(base, 'absent', 'notes'), template()), refusal('NOTES_FOLDER_MISSING'));
  assert.throws(() => planStarter('notes', template()), refusal('NOTES_PATH_UNSAFE'));
  assert.throws(() => planStarter(`${base}/x/../real`, template()), refusal('NOTES_PATH_UNSAFE'));
  assert.throws(() => planStarter(path.join(base, '.hidden'), template()), refusal('NOTES_PATH_UNSAFE'));
  assert.equal(fs.existsSync(path.join(real, 'notes')), false);
});

test('apply refuses NOTES_STALE when the revision is not the plan now, and writes nothing', { skip: needsGit }, async t => {
  const dir = path.join(tempDir(t), 'notes');
  const plan = planStarter(dir, template());
  const changed = template(); changed[1] = { path: 'index.md', bytes: new TextEncoder().encode('# Other\n') };
  await assert.rejects(applyStarter(dir, plan.revision, changed), refusal('NOTES_STALE'));
  await assert.rejects(applyStarter(dir, 'not-a-revision', template()), refusal('NOTES_STALE'));
  assert.equal(fs.existsSync(dir), false);
  fs.mkdirSync(dir);
  await assert.rejects(applyStarter(dir, plan.revision, template()), refusal('NOTES_STALE'), 'a folder that appeared after the plan is a change');
  assert.deepEqual(fs.readdirSync(dir), []);
});

test('a template that is not a clean list of relative files refuses NOTES_TEMPLATE_INVALID', { skip: needsGit }, t => {
  const dir = path.join(tempDir(t), 'notes');
  const f = (p, text = 'x') => ({ path: p, bytes: new TextEncoder().encode(text) });
  const bad = [
    null, 'AGENTS.md', [], [f('a.md'), f('a.md')], [f('a.md'), f('A.md')], [f('../a.md')], [f('/abs.md')], [f('.hidden.md')], [f('pages/.x.md')],
    [f('.git/config')], [f('a'), f('a/b.md')], [f('a/b.md'), f('a')], [f('a//b.md')], [f('a\\b.md')], [f('a\nb.md')], [f('')], [{ path: 'a.md', bytes: 'text' }],
    [{ path: 'a.md' }], [{ path: 1, bytes: new Uint8Array(1) }], Array.from({ length: 257 }, (_, i) => f(`p${i}.md`)),
    [{ path: 'big.md', bytes: new Uint8Array(1024 * 1024 + 1) }], [f('café.md')],
  ];
  for (const files of bad) assert.throws(() => planStarter(dir, files), refusal('NOTES_TEMPLATE_INVALID'), JSON.stringify(files)?.slice(0, 80));
  assert.equal(fs.existsSync(dir), false);
});

test('a missing git refuses NOTES_GIT_MISSING at the plan and at apply, before anything is written', async t => {
  const dir = path.join(tempDir(t), 'notes');
  assert.throws(() => planStarter(dir, template(), { gitCandidates: [] }), refusal('NOTES_GIT_MISSING'));
  await assert.rejects(applyStarter(dir, 'a'.repeat(64), template(), { gitCandidates: [path.join(dir, 'absent-git')] }), refusal('NOTES_GIT_MISSING'));
  assert.equal(fs.existsSync(dir), false);
});
