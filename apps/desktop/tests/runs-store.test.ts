// The file of recorded runs (main/run-store.ts), in the private state folder of the app. It holds what the person recorded and what main knows about the folder, and never any text of a chat.
// Writes are whole-file and atomic, stay inside the state folder, and never write over a file that could not be read.
import test from 'node:test';
import assert from 'node:assert/strict';
import { lstatSync, mkdirSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { RUN_RECORD_LIMIT } from '../shared/api/runs.js';
import { RunStoreError, createRunStore, runsDir, runsFile } from '../main/run-store.js';
import type { NewRun } from '../main/run-store.js';
import { tempDir } from './support.js';

const folder = (extra: Partial<NewRun> = {}): NewRun => ({ engine: 'claude-code', instruction: 'Write a weekly report.', projectPath: '/work/team', projectName: 'team', projectLabel: '~/Projects/team', startedAt: '2026-11-11T10:30:00.000Z', ...extra });
const kind = (fn: () => unknown): string => { try { fn(); return 'none'; } catch (e) { return e instanceof RunStoreError ? e.reason : `other:${String(e)}`; } };

test('a new run is saved with an id, a group, the status "recorded", no rating and empty notes, and it reads back from a new store', t => {
  const state = tempDir(t);
  const a = createRunStore({ stateRoot: state }).add(folder());
  assert.deepEqual(a, { id: 'run-1', engine: 'claude-code', instruction: 'Write a weekly report.', projectPath: '/work/team', projectName: 'team', projectLabel: '~/Projects/team', startedAt: '2026-11-11T10:30:00.000Z', status: 'recorded', groupId: 'group-1', rating: null, notes: '' });
  assert.deepEqual(createRunStore({ stateRoot: state }).list(), [a]);
});

test('the list is newest first by start time, and ids keep counting up after a restart', t => {
  const state = tempDir(t); const s = createRunStore({ stateRoot: state });
  s.add(folder({ startedAt: '2026-11-11T09:00:00.000Z' })); s.add(folder({ engine: 'codex', startedAt: '2026-11-11T11:00:00.000Z' }));
  assert.deepEqual(createRunStore({ stateRoot: state }).list().map(r => r.id), ['run-2', 'run-1']);
  assert.equal(createRunStore({ stateRoot: state }).add(folder()).id, 'run-3');
});

test('runs of one instruction in one project share a group, across engines; another instruction or another project does not', t => {
  const s = createRunStore({ stateRoot: tempDir(t) });
  const a = s.add(folder()), b = s.add(folder({ engine: 'codex' })), c = s.add(folder({ instruction: 'Something else.' })), d = s.add(folder({ projectPath: '/work/other', projectName: 'other' }));
  assert.equal(a.groupId, b.groupId);
  assert.equal(new Set([a.groupId, c.groupId, d.groupId]).size, 3);
});

test('a change saves status, rating and notes; a rating needs the run to be done, and going back to recorded clears it', t => {
  const s = createRunStore({ stateRoot: tempDir(t) }); const run = s.add(folder());
  assert.equal(kind(() => s.update(run.id, { rating: 'better' })), 'rating-needs-done');
  assert.equal(s.update(run.id, { notes: 'slow start' }).notes, 'slow start');
  const done = s.update(run.id, { status: 'done', rating: 'better' });
  assert.deepEqual([done.status, done.rating, done.notes], ['done', 'better', 'slow start']);
  assert.equal(s.update(run.id, { rating: null }).rating, null);
  assert.equal(s.update(run.id, { rating: 'worse' }).rating, 'worse');
  const back = s.update(run.id, { status: 'recorded' });
  assert.deepEqual([back.status, back.rating], ['recorded', null]);
  assert.equal(kind(() => s.update('run-99', { notes: 'x' })), 'unknown-run');
});

test('the file is in the state folder, private to its owner, holds only the record fields, and no temporary file is left', t => {
  const state = tempDir(t); const s = createRunStore({ stateRoot: state });
  s.add(folder()); s.update('run-1', { notes: 'a note' });
  assert.equal(runsFile(state), join(state, 'runs', 'runs.json'));
  assert.deepEqual(readdirSync(runsDir(state)), ['runs.json']);
  if (process.platform !== 'win32') { assert.equal(lstatSync(runsDir(state)).mode & 0o777, 0o700); assert.equal(lstatSync(runsFile(state)).mode & 0o777, 0o600); }
  const saved = JSON.parse(readFileSync(runsFile(state), 'utf8')) as { format: string; runs: Record<string, unknown>[] };
  assert.equal(saved.format, 'bowerloom/runs/v1');
  assert.deepEqual(Object.keys(saved.runs[0]!).sort(), ['engine', 'groupId', 'id', 'instruction', 'notes', 'projectLabel', 'projectName', 'projectPath', 'rating', 'startedAt', 'status']);
  assert.deepEqual(readdirSync(state), ['runs'], 'nothing else is made in the state folder');
});

test('a write that fails half way leaves the old file whole and no temporary file behind', t => {
  const state = tempDir(t); const ok = createRunStore({ stateRoot: state }); ok.add(folder());
  const before = readFileSync(runsFile(state), 'utf8');
  const failing = createRunStore({ stateRoot: state, rename: () => { throw Object.assign(new Error('disk full'), { code: 'ENOSPC' }); } });
  assert.equal(kind(() => failing.add(folder({ engine: 'codex' }))), 'write-failed');
  assert.equal(readFileSync(runsFile(state), 'utf8'), before);
  assert.deepEqual(readdirSync(runsDir(state)), ['runs.json']);
  assert.equal(createRunStore({ stateRoot: state }).list().length, 1, 'a failed add is not in memory either');
});

test('no more than the record limit is kept, and one past it is refused, never a silent drop of an older run', t => {
  const s = createRunStore({ stateRoot: tempDir(t), limit: 3 });
  for (let i = 0; i < 3; i += 1) s.add(folder({ instruction: `i${i}` }));
  assert.equal(kind(() => s.add(folder({ instruction: 'one more' }))), 'full');
  assert.equal(s.list().length, 3);
  assert.equal(RUN_RECORD_LIMIT, 500);
});

test('a file that cannot be read as runs is "damaged": it is not listed, not written over by a change, and a new record moves it aside', t => {
  const state = tempDir(t); mkdirSync(runsDir(state), { recursive: true, mode: 0o700 });
  for (const text of ['not json', '[]', '{"format":"other","runs":[]}', '{"format":"bowerloom/runs/v1","runs":[{"id":"run-1","rating":"great"}]}', '{"format":"bowerloom/runs/v1","runs":"x"}', '']) {
    writeFileSync(runsFile(state), text);
    const s = createRunStore({ stateRoot: state });
    assert.equal(kind(() => s.list()), 'damaged', text);
    assert.equal(kind(() => s.update('run-1', { notes: 'x' })), 'damaged', text);
    assert.equal(readFileSync(runsFile(state), 'utf8'), text, 'the damaged file is untouched by a read or a change');
    const added = s.add(folder());
    assert.equal(added.id, 'run-1');
    assert.equal(readFileSync(join(runsDir(state), 'runs.damaged.json'), 'utf8'), text, 'the damaged file was kept beside it');
    assert.equal(s.list().length, 1);
  }
});

test('a file over the size cap, a file that is a link, and a folder that is a link are refused, and nothing is followed', t => {
  const state = tempDir(t); const other = tempDir(t);
  mkdirSync(runsDir(state), { recursive: true, mode: 0o700 });
  writeFileSync(runsFile(state), 'x'.repeat(9_000_000));
  assert.equal(kind(() => createRunStore({ stateRoot: state }).list()), 'damaged');
  const s2 = tempDir(t); mkdirSync(runsDir(s2), { recursive: true, mode: 0o700 });
  writeFileSync(join(other, 'real.json'), '{"format":"bowerloom/runs/v1","next":1,"groups":1,"runs":[]}'); symlinkSync(join(other, 'real.json'), runsFile(s2));
  assert.equal(kind(() => createRunStore({ stateRoot: s2 }).list()), 'unsafe');
  assert.equal(kind(() => createRunStore({ stateRoot: s2 }).add(folder())), 'unsafe');
  const s3 = tempDir(t); symlinkSync(other, runsDir(s3));
  assert.equal(kind(() => createRunStore({ stateRoot: s3 }).list()), 'unsafe');
  assert.equal(kind(() => createRunStore({ stateRoot: s3 }).add(folder())), 'unsafe');
  assert.deepEqual(readdirSync(other), ['real.json'], 'nothing was written through a link');
});

test('no file yet is an empty list, and listing makes no folder and no file', t => {
  const state = tempDir(t);
  assert.deepEqual(createRunStore({ stateRoot: state }).list(), []);
  assert.deepEqual(readdirSync(state), []);
});

test('a hostile value in the file (a prototype key, a long text, a bad time) makes the file damaged and is never used', t => {
  const state = tempDir(t); mkdirSync(runsDir(state), { recursive: true, mode: 0o700 });
  const run = { id: 'run-1', engine: 'claude-code', instruction: 'x', projectPath: '/a', projectName: 'a', projectLabel: '~/a', startedAt: '2026-11-11T10:30:00.000Z', status: 'recorded', groupId: 'group-1', rating: null, notes: '' };
  const make = (r: unknown): string => JSON.stringify({ format: 'bowerloom/runs/v1', next: 2, groups: 2, runs: [r] });
  for (const bad of [{ ...run, startedAt: 'now' }, { ...run, id: '__proto__' }, { ...run, engine: 'vim' }, { ...run, notes: 'x'.repeat(3000) }, { ...run, projectPath: 'relative' }, { ...run, status: 'running' }, { ...run, extra: 1 }, { ...run, groupId: '../x' }]) {
    writeFileSync(runsFile(state), make(bad));
    assert.equal(kind(() => createRunStore({ stateRoot: state }).list()), 'damaged', JSON.stringify(bad).slice(0, 80));
  }
  writeFileSync(runsFile(state), make(run));
  assert.equal(createRunStore({ stateRoot: state }).list().length, 1);
});
