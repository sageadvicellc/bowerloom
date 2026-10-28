// Step 5, lane A of Bowerloom 0.8: the approval drafts that `harness accept` writes and `harness install` reads.
// Synthetic projects only.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  APPROVAL_DRAFTS_FORMAT, addApprovalDraft, dropApprovalDrafts, harnessStateDirs, readApprovalDrafts,
} from '../../../dist/packages/project-sync/src/index.js';
import { entryHash, loadDefinition } from '../../../dist/packages/harness-definition/src/index.js';
import { code, project } from './portable-fixture.mjs';

const mode = p => fs.lstatSync(p).mode & 0o777;

function world(t, options) {
  const p = project(t, options);
  const stateRoot = path.join(p.base, 'state', 'bowerloom'); fs.mkdirSync(stateRoot, { recursive: true, mode: 0o700 });
  const dirs = harnessStateDirs(stateRoot, p.dir);
  const definition = () => { const l = loadDefinition(p.def); assert.ok(l.ok, JSON.stringify(l.problems)); return l.definition; };
  const hashOf = id => entryHash(definition().entries.skills.find(s => s.id === id));
  return { ...p, stateRoot, dirs, definition, hashOf };
}
const draftOf = (w, extra = {}) => ({
  part: 'skills', entry: 'review', engine: 'codex', result: 'weakened', entryHash: w.hashOf('review'),
  who: 'tester', reason: 'Read the line and accept the loss.', ...extra,
});
const NOW = new Date('2026-10-28T12:00:00.500Z');
const LATER = new Date('2026-10-28T13:30:00Z');

test('drafts: none is an empty list, and reading creates nothing', t => {
  const w = world(t);
  assert.deepEqual(readApprovalDrafts(w.dirs, w.dir), []);
  assert.deepEqual(fs.readdirSync(w.stateRoot), []);
});

test('drafts: a draft round-trips, in a 0600 file inside a 0700 folder, with a time to the second', t => {
  const w = world(t);
  const made = addApprovalDraft(w.dirs, w.dir, draftOf(w), { definition: w.definition(), now: NOW });
  assert.deepEqual(made, { ...draftOf(w), when: '2026-10-28T12:00:00Z' });
  assert.deepEqual(readApprovalDrafts(w.dirs, w.dir), [made]);
  assert.equal(mode(w.dirs.approvals), 0o600);
  assert.equal(mode(w.dirs.base), 0o700);
  assert.equal(mode(path.dirname(w.dirs.base)), 0o700);
  const file = JSON.parse(fs.readFileSync(w.dirs.approvals, 'utf8'));
  assert.deepEqual(Object.keys(file).sort(), ['drafts', 'format', 'projectDir']);
  assert.equal(file.format, APPROVAL_DRAFTS_FORMAT);
  assert.equal(file.projectDir, w.dir);
  // No writer temporary is left beside it.
  assert.deepEqual(fs.readdirSync(w.dirs.base), ['approvals.json']);
});

test('drafts: a second accept of the same line keeps the first time, so a plan and its apply see one revision', t => {
  const w = world(t);
  const first = addApprovalDraft(w.dirs, w.dir, draftOf(w), { definition: w.definition(), now: NOW });
  const bytes = fs.readFileSync(w.dirs.approvals);
  const again = addApprovalDraft(w.dirs, w.dir, draftOf(w, { reason: 'Another reason.' }), { definition: w.definition(), now: LATER });
  assert.deepEqual(again, first);
  assert.deepEqual(fs.readFileSync(w.dirs.approvals), bytes);
  assert.deepEqual(readApprovalDrafts(w.dirs, w.dir), readApprovalDrafts(w.dirs, w.dir));
});

test('drafts: several lines are kept in one stable order, whatever the order they were added in', t => {
  const w = world(t);
  const def = w.definition();
  const a = draftOf(w, { engine: 'opencode' }), b = draftOf(w, { engine: 'codex', field: 'license' }), c = draftOf(w, { engine: 'codex' });
  for (const d of [a, b, c]) addApprovalDraft(w.dirs, w.dir, d, { definition: def, now: NOW });
  const one = readApprovalDrafts(w.dirs, w.dir).map(d => `${d.engine}:${d.field ?? ''}`);
  fs.unlinkSync(w.dirs.approvals);
  for (const d of [c, a, b]) addApprovalDraft(w.dirs, w.dir, d, { definition: def, now: NOW });
  assert.deepEqual(readApprovalDrafts(w.dirs, w.dir).map(d => `${d.engine}:${d.field ?? ''}`), one);
  assert.equal(one.length, 3);
});

test('drafts: a draft whose entry hash no longer matches the definition is refused, and nothing is written', t => {
  const w = world(t);
  const stale = draftOf(w, { entryHash: `sha256:${'0'.repeat(64)}` });
  assert.throws(() => addApprovalDraft(w.dirs, w.dir, stale, { definition: w.definition(), now: NOW }), code('HARNESS_APPROVAL_STALE'));
  assert.throws(() => addApprovalDraft(w.dirs, w.dir, draftOf(w, { entry: 'absent' }), { definition: w.definition(), now: NOW }), code('HARNESS_APPROVAL_STALE'));
  assert.equal(fs.existsSync(w.dirs.approvals), false);
});

test('drafts: after the entry changes, the old draft is left out of a read against the definition, and a new accept replaces it', t => {
  const w = world(t);
  const old = addApprovalDraft(w.dirs, w.dir, draftOf(w), { definition: w.definition(), now: NOW });
  fs.appendFileSync(path.join(w.def, 'skills', 'review', 'SKILL.md'), '\nOne more line.\n');
  const def = w.definition();
  assert.notEqual(w.hashOf('review'), old.entryHash);
  assert.deepEqual(readApprovalDrafts(w.dirs, w.dir), [old]);
  assert.deepEqual(readApprovalDrafts(w.dirs, w.dir, { definition: def }), []);
  // The old hash is refused now.
  assert.throws(() => addApprovalDraft(w.dirs, w.dir, draftOf(w, { entryHash: old.entryHash }), { definition: def, now: LATER }), code('HARNESS_APPROVAL_STALE'));
  const fresh = addApprovalDraft(w.dirs, w.dir, draftOf(w), { definition: def, now: LATER });
  assert.equal(fresh.when, '2026-10-28T13:30:00Z');
  assert.deepEqual(readApprovalDrafts(w.dirs, w.dir), [fresh]);
});

test('drafts: an invalid draft is refused by the approval shape check', t => {
  const w = world(t);
  const def = w.definition();
  for (const bad of [draftOf(w, { result: 'exact' }), draftOf(w, { who: '' }), draftOf(w, { extra: 1 }), draftOf(w, { engine: 'nope' }), null]) {
    assert.throws(() => addApprovalDraft(w.dirs, w.dir, bad, { definition: def, now: NOW }), code('PORTABLE_USAGE'));
  }
  assert.throws(() => addApprovalDraft(w.dirs, w.dir, { ...draftOf(w), when: '2026-10-28T12:00:00Z' }, { definition: def, now: NOW }), code('PORTABLE_USAGE'));
  assert.throws(() => addApprovalDraft(w.dirs, w.dir, draftOf(w), { now: NOW }), code('PORTABLE_USAGE'));
  assert.equal(fs.existsSync(w.dirs.approvals), false);
});

test('drafts: drop removes the drafts a receipt recorded, and with no list removes the file', t => {
  const w = world(t);
  const def = w.definition();
  const a = addApprovalDraft(w.dirs, w.dir, draftOf(w, { engine: 'opencode' }), { definition: def, now: NOW });
  const b = addApprovalDraft(w.dirs, w.dir, draftOf(w, { engine: 'codex' }), { definition: def, now: NOW });
  // A recorded approval of the same line drops the draft even when its time or reason differ.
  assert.equal(dropApprovalDrafts(w.dirs, w.dir, [{ ...a, when: '2026-10-28T11:00:00Z', reason: 'x' }]), 1);
  assert.deepEqual(readApprovalDrafts(w.dirs, w.dir), [b]);
  // A recorded approval of another hash drops nothing.
  assert.equal(dropApprovalDrafts(w.dirs, w.dir, [{ ...b, entryHash: `sha256:${'1'.repeat(64)}` }]), 0);
  assert.deepEqual(readApprovalDrafts(w.dirs, w.dir), [b]);
  assert.equal(dropApprovalDrafts(w.dirs, w.dir, [b]), 1);
  assert.equal(fs.existsSync(w.dirs.approvals), false);
  addApprovalDraft(w.dirs, w.dir, draftOf(w), { definition: def, now: NOW });
  assert.equal(dropApprovalDrafts(w.dirs, w.dir), 1);
  assert.equal(fs.existsSync(w.dirs.approvals), false);
  assert.equal(dropApprovalDrafts(w.dirs, w.dir), 0);
});

test('drafts: a damaged file is refused on read, add, and drop, and is never overwritten', t => {
  const w = world(t);
  const def = w.definition();
  const good = addApprovalDraft(w.dirs, w.dir, draftOf(w), { definition: def, now: NOW });
  const valid = { format: APPROVAL_DRAFTS_FORMAT, projectDir: w.dir, drafts: [good] };
  const damaged = [
    'not json',
    JSON.stringify([]),
    JSON.stringify({ ...valid, format: 'other' }),
    JSON.stringify({ ...valid, extra: true }),
    JSON.stringify({ format: valid.format, projectDir: w.dir }),
    JSON.stringify({ ...valid, drafts: {} }),
    JSON.stringify({ ...valid, drafts: [{ ...good, result: 'exact' }] }),
    JSON.stringify({ ...valid, drafts: [{ ...good, extra: 1 }] }),
    JSON.stringify({ ...valid, drafts: [{ ...good, when: '2999-01-01T00:00:00Z' }] }),
    JSON.stringify({ ...valid, drafts: [good, { ...good, reason: 'twice' }] }),
  ];
  for (const text of damaged) {
    fs.writeFileSync(w.dirs.approvals, text, { mode: 0o600 });
    assert.throws(() => readApprovalDrafts(w.dirs, w.dir), code('PORTABLE_STATE_INVALID'), text);
    assert.throws(() => addApprovalDraft(w.dirs, w.dir, draftOf(w, { engine: 'pi' }), { definition: def, now: NOW }), code('PORTABLE_STATE_INVALID'), text);
    assert.throws(() => dropApprovalDrafts(w.dirs, w.dir), code('PORTABLE_STATE_INVALID'), text);
    assert.equal(fs.readFileSync(w.dirs.approvals, 'utf8'), text);
  }
});

test('drafts: a file of another project is refused', t => {
  const w = world(t);
  addApprovalDraft(w.dirs, w.dir, draftOf(w), { definition: w.definition(), now: NOW });
  const file = JSON.parse(fs.readFileSync(w.dirs.approvals, 'utf8'));
  fs.writeFileSync(w.dirs.approvals, JSON.stringify({ ...file, projectDir: '/elsewhere' }), { mode: 0o600 });
  assert.throws(() => readApprovalDrafts(w.dirs, w.dir), code('PORTABLE_STATE_FOREIGN'));
});

test('drafts: a linked, shared, or open file or folder is refused', t => {
  const w = world(t);
  const def = w.definition();
  addApprovalDraft(w.dirs, w.dir, draftOf(w), { definition: def, now: NOW });
  fs.chmodSync(w.dirs.approvals, 0o644);
  assert.throws(() => readApprovalDrafts(w.dirs, w.dir), code('PORTABLE_STATE_UNSAFE'));
  fs.chmodSync(w.dirs.approvals, 0o600);
  // A hard link to the file.
  const twin = path.join(w.base, 'twin'); fs.linkSync(w.dirs.approvals, twin);
  assert.throws(() => readApprovalDrafts(w.dirs, w.dir), code('PORTABLE_STATE_UNSAFE'));
  fs.unlinkSync(twin);
  // A symbolic link in place of the file.
  const real = path.join(w.base, 'real.json'); fs.renameSync(w.dirs.approvals, real); fs.symlinkSync(real, w.dirs.approvals);
  assert.throws(() => readApprovalDrafts(w.dirs, w.dir), code('PORTABLE_STATE_UNSAFE'));
  assert.throws(() => addApprovalDraft(w.dirs, w.dir, draftOf(w, { engine: 'pi' }), { definition: def, now: NOW }), code('PORTABLE_STATE_UNSAFE'));
  fs.unlinkSync(w.dirs.approvals);
  // The folder is open to others.
  fs.chmodSync(w.dirs.base, 0o755);
  assert.throws(() => readApprovalDrafts(w.dirs, w.dir), code('PORTABLE_STATE_UNSAFE'));
  assert.throws(() => addApprovalDraft(w.dirs, w.dir, draftOf(w), { definition: def, now: NOW }), code('PORTABLE_STATE_UNSAFE'));
  fs.chmodSync(w.dirs.base, 0o700);
  // The folder is a link.
  const away = path.join(w.base, 'away'); fs.mkdirSync(away, { mode: 0o700 });
  fs.rmSync(w.dirs.base, { recursive: true }); fs.symlinkSync(away, w.dirs.base);
  assert.throws(() => readApprovalDrafts(w.dirs, w.dir), code('PORTABLE_STATE_UNSAFE'));
  assert.throws(() => addApprovalDraft(w.dirs, w.dir, draftOf(w), { definition: def, now: NOW }), code('PORTABLE_STATE_UNSAFE'));
  assert.deepEqual(fs.readdirSync(away), []);
});

test('drafts: layout folders of another project are refused', t => {
  const w = world(t);
  const other = path.join(w.base, 'other'); fs.mkdirSync(other, { mode: 0o755 });
  assert.throws(() => readApprovalDrafts(harnessStateDirs(w.stateRoot, other), w.dir), code('PORTABLE_USAGE'));
});
