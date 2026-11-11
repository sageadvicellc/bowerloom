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

test('a record that is damaged, a link, or too big is moved aside under a dated name by the next pick, and a new list starts; nothing is lost', t => {
  const { base, state, notes } = setup(t);
  fs.mkdirSync(path.join(state, 'linked-notes'), { recursive: true });
  const file = approvalsFileOf(state), dir = path.dirname(file);
  const cases = {
    'not json': () => fs.writeFileSync(file, '{ damaged'), 'wrong version': () => fs.writeFileSync(file, '{"version":9,"keys":[]}'), 'bad keys': () => fs.writeFileSync(file, '{"version":1,"keys":["x"]}'),
    'too big': () => fs.writeFileSync(file, ' '.repeat(APPROVALS_LIMITS.bytes + 1)), 'a link': () => { fs.writeFileSync(path.join(base, 'real.json'), '{"version":1,"keys":[]}'); fs.symlinkSync(path.join(base, 'real.json'), file); },
  };
  for (const [name, make] of Object.entries(cases)) {
    for (const f of fs.readdirSync(dir)) fs.rmSync(path.join(dir, f), { force: true });
    make();
    assert.equal(readApprovals(state).status, 'damaged', name);
    const before = fs.lstatSync(file).isSymbolicLink() ? fs.readlinkSync(file) : fs.readFileSync(file);
    assert.equal(approveFolder(state, notes), 'kept', name);
    const aside = fs.readdirSync(dir).filter(n => n.startsWith('approved.json.damaged-'));
    assert.equal(aside.length, 1, `${name}: the damaged record is kept under a dated name`);
    assert.match(aside[0], /^approved\.json\.damaged-\d{8}T\d{6}-[0-9a-f]{6}$/, name);
    const kept = path.join(dir, aside[0]);
    assert.deepEqual(fs.lstatSync(kept).isSymbolicLink() ? fs.readlinkSync(kept) : fs.readFileSync(kept), before, `${name}: nothing was lost`);
    const r = readApprovals(state);
    assert.equal(r.status, 'ok', name);
    assert.deepEqual([...r.keys], [approvalKey(fs.realpathSync(notes))], `${name}: a new list holds the pick only`);
  }
});

test('the folder of the record is checked on a read as on a write: a link, a folder others can write, and a plain file in its place are blocked', t => {
  const { base, state, notes } = setup(t);
  // A link.
  const linkedState = path.join(base, 'state-linked'), elsewhere = path.join(base, 'elsewhere');
  fs.mkdirSync(linkedState); fs.mkdirSync(elsewhere); fs.symlinkSync(elsewhere, path.join(linkedState, 'linked-notes'));
  fs.writeFileSync(path.join(elsewhere, 'approved.json'), JSON.stringify({ version: 1, keys: [approvalKey(fs.realpathSync(notes))] }));
  assert.equal(readApprovals(linkedState).status, 'blocked', 'a record read through a link is refused');
  assert.equal(approveFolder(linkedState, notes), 'failed');
  assert.deepEqual(fs.readdirSync(elsewhere), ['approved.json'], 'nothing was written through the link');
  // A folder that others can write.
  const open = path.join(base, 'state-open');
  fs.mkdirSync(path.join(open, 'linked-notes'), { recursive: true }); fs.chmodSync(path.join(open, 'linked-notes'), 0o777);
  assert.equal(readApprovals(open).status, 'blocked');
  // A plain file where the folder should be.
  const blocked = path.join(base, 'state-blocked');
  fs.mkdirSync(blocked); fs.writeFileSync(path.join(blocked, 'linked-notes'), 'x');
  assert.equal(readApprovals(blocked).status, 'blocked');
  assert.equal(approveFolder(blocked, notes), 'failed');
});

test('a full record refuses one more folder and still accepts one it holds; a record over the cap is damaged', t => {
  const { base, notes } = setup(t);
  const full = path.join(base, 'state-full');
  fs.mkdirSync(path.join(full, 'linked-notes'), { recursive: true });
  const keys = Array.from({ length: APPROVALS_LIMITS.keys }, (_, i) => approvalKey(`/made/up/${i}`));
  fs.writeFileSync(approvalsFileOf(full), JSON.stringify({ version: 1, keys }));
  assert.equal(readApprovals(full).status, 'ok');
  assert.equal(approveFolder(full, notes), 'full');
  assert.equal(readApprovals(full).keys.size, APPROVALS_LIMITS.keys, 'the record is as it was');
  fs.writeFileSync(approvalsFileOf(full), JSON.stringify({ version: 1, keys: [...keys.slice(1), approvalKey(fs.realpathSync(notes))] }));
  assert.equal(approveFolder(full, notes), 'kept', 'a folder the record holds is accepted again');
  fs.writeFileSync(approvalsFileOf(full), JSON.stringify({ version: 1, keys: [...keys, approvalKey('/one/more')] }));
  assert.equal(readApprovals(full).status, 'damaged');
});

test('the key follows the path as the file system keeps it: another case is another key', () => {
  assert.notEqual(approvalKey('/home/u/Notes'), approvalKey('/home/u/notes'));
});
