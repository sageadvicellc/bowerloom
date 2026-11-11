// The approval of a linked notes folder: the pick is recorded by the real path of the folder, never written over a damaged record, and never written through a link.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { APPROVALS_LIMITS, approvalKey, approvalsFileOf, approveFolder, readApprovals } from '../../../dist/packages/notes-source/src/index.js';
import { put, tempDir } from './fixture.mjs';

const setup = t => { const base = tempDir(t); const state = path.join(base, 'state'); fs.mkdirSync(path.join(base, 'notes')); fs.mkdirSync(path.join(base, 'other')); return { base, state, notes: path.join(base, 'notes'), other: path.join(base, 'other') }; };

test('a pick is recorded by the real path of the folder, 32 hex characters, and read back', t => {
  const { state, notes, other } = setup(t);
  assert.deepEqual(readApprovals(state), { status: 'none' });
  assert.equal(approveFolder(state, notes), 'kept');
  const r = readApprovals(state);
  assert.equal(r.status, 'ok');
  assert.equal(r.keys.has(approvalKey(fs.realpathSync(notes))), true);
  assert.equal(r.keys.has(approvalKey(fs.realpathSync(other))), false);
  assert.match(approvalKey(notes), /^[0-9a-f]{32}$/);
  assert.equal(approveFolder(state, other), 'kept');
  assert.equal(readApprovals(state).keys.size, 2);
  assert.equal(fs.statSync(approvalsFileOf(state)).mode & 0o777, 0o600);
});

test('a shortcut is approved as the folder it leads to, so a swapped shortcut is not approved', t => {
  const { base, state, notes, other } = setup(t);
  const link = path.join(base, 'link');
  fs.symlinkSync(notes, link);
  assert.equal(approveFolder(state, link), 'kept');
  const keys = readApprovals(state).keys;
  assert.equal(keys.has(approvalKey(fs.realpathSync(notes))), true);
  fs.rmSync(link); fs.symlinkSync(other, link);
  assert.equal(keys.has(approvalKey(fs.realpathSync(link))), false);
});

test('a path that is not a folder is refused and approves nothing', t => {
  const { base, state } = setup(t);
  put(base, 'file.md');
  assert.equal(approveFolder(state, path.join(base, 'file.md')), 'failed');
  assert.equal(approveFolder(state, path.join(base, 'missing')), 'failed');
  assert.deepEqual(readApprovals(state), { status: 'none' });
});

test('a record that is damaged, a link, or too big is never written over', t => {
  const { base, state, notes } = setup(t);
  fs.mkdirSync(path.join(state, 'linked-notes'), { recursive: true });
  const file = approvalsFileOf(state);
  const cases = {
    'not json': () => fs.writeFileSync(file, '{ damaged'), 'wrong version': () => fs.writeFileSync(file, '{"version":9,"keys":[]}'), 'bad keys': () => fs.writeFileSync(file, '{"version":1,"keys":["x"]}'),
    'too big': () => fs.writeFileSync(file, ' '.repeat(APPROVALS_LIMITS.bytes + 1)), 'a link': () => { fs.writeFileSync(path.join(base, 'real.json'), '{"version":1,"keys":[]}'); fs.symlinkSync(path.join(base, 'real.json'), file); },
  };
  for (const [name, make] of Object.entries(cases)) {
    fs.rmSync(file, { force: true }); make();
    const before = fs.readFileSync(file);
    assert.equal(readApprovals(state).status, 'damaged', name);
    assert.equal(approveFolder(state, notes), 'damaged', name);
    assert.deepEqual(fs.readFileSync(file), before, `${name}: untouched`);
  }
});

test('a folder of the record that is a link, a plain file in its place, and more approvals than the record holds are each refused', t => {
  const { base, state, notes } = setup(t);
  // A link.
  const linkedState = path.join(base, 'state-linked'), elsewhere = path.join(base, 'elsewhere');
  fs.mkdirSync(linkedState); fs.mkdirSync(elsewhere); fs.symlinkSync(elsewhere, path.join(linkedState, 'linked-notes'));
  assert.equal(approveFolder(linkedState, notes), 'failed');
  assert.deepEqual(fs.readdirSync(elsewhere), [], 'nothing was written through the link');
  // A plain file where the folder should be.
  const blocked = path.join(base, 'state-blocked');
  fs.mkdirSync(blocked); fs.writeFileSync(path.join(blocked, 'linked-notes'), 'x');
  assert.equal(approveFolder(blocked, notes), 'failed');
  // The record is full: it holds the most keys, and one more is refused.
  const full = path.join(base, 'state-full');
  fs.mkdirSync(path.join(full, 'linked-notes'), { recursive: true });
  const keys = Array.from({ length: APPROVALS_LIMITS.keys }, (_, i) => approvalKey(`/made/up/${i}`));
  fs.writeFileSync(approvalsFileOf(full), JSON.stringify({ version: 1, keys }));
  assert.equal(readApprovals(full).status, 'ok');
  assert.equal(approveFolder(full, notes), 'failed');
  assert.equal(readApprovals(full).keys.size, APPROVALS_LIMITS.keys, 'the record is as it was');
  // A record with more keys than the cap is damaged.
  fs.writeFileSync(approvalsFileOf(full), JSON.stringify({ version: 1, keys: [...keys, approvalKey('/one/more')] }));
  assert.equal(readApprovals(full).status, 'damaged');
});
