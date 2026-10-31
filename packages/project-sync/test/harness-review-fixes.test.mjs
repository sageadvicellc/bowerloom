// Step 5 review fixes, shared state package: item 2 (a read-only command takes no project lock when there is nothing to move)
// and item 9 (the approval drafts are read, changed, and written under the project lock). Synthetic folders only.
import test from '../../../dist/tests/support/lock-slot-retry.js';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  addApprovalDraftLocked, dropApprovalDraftsLocked, harnessStateDirs, readApprovalDrafts, settleLegacyState,
} from '../../../dist/packages/project-sync/src/index.js';
import { withProjectLock } from '../../../dist/packages/project-context/src/index.js';
import { entryHash, loadDefinition } from '../../../dist/packages/harness-definition/src/index.js';
import { chmodTree, project } from './portable-fixture.mjs';

const signal = () => new AbortController().signal;
const holding = (dir, work) => withProjectLock(dir, signal(), work);

function world(t) {
  const p = project(t);
  const stateRoot = path.join(p.base, 'state', 'bowerloom'); fs.mkdirSync(stateRoot, { recursive: true, mode: 0o700 });
  const dirs = harnessStateDirs(stateRoot, p.dir);
  const definition = () => { const l = loadDefinition(p.def); assert.ok(l.ok, JSON.stringify(l.problems)); return l.definition; };
  const draft = () => ({
    part: 'skills', entry: 'review', engine: 'codex', result: 'weakened', entryHash: entryHash(definition().entries.skills.find(s => s.id === 'review')),
    who: 'tester', reason: 'Read the line and accept the loss.',
  });
  return { ...p, stateRoot, dirs, definition, draft };
}

test('item 2: with no old record and no marker, settle answers none while another command holds the project lock', async t => {
  const w = world(t);
  await holding(w.dir, async () => {
    assert.equal(await settleLegacyState(w.dirs, w.dir), 'none');
  });
  // Nothing was created by looking.
  assert.deepEqual(fs.readdirSync(w.stateRoot), []);
});

test('item 2: with a record already in place and no marker, settle still needs no lock', async t => {
  const w = world(t);
  fs.mkdirSync(w.dirs.portable, { recursive: true, mode: 0o700 });
  await holding(w.dir, async () => {
    assert.equal(await settleLegacyState(w.dirs, w.dir), 'none');
  });
});

test('item 2: an old record to move still takes the lock, so another holder gives PROJECT_LOCKED and nothing moves', async t => {
  const w = world(t);
  fs.mkdirSync(path.join(w.dirs.legacy, 'portable'), { recursive: true, mode: 0o700 });
  await holding(w.dir, async () => {
    await assert.rejects(settleLegacyState(w.dirs, w.dir), e => e.code === 'PROJECT_LOCKED');
  });
  assert.ok(fs.existsSync(w.dirs.legacy), 'the old record is where it was');
  assert.equal(await settleLegacyState(w.dirs, w.dir), 'moved');
});

test('item 2: a move marker in the shared record counts as work, so it takes the lock', async t => {
  const w = world(t);
  fs.mkdirSync(w.dirs.base, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(w.dirs.base, 'moving.json'), 'x\n', { mode: 0o600 });
  await holding(w.dir, async () => {
    await assert.rejects(settleLegacyState(w.dirs, w.dir), e => e.code === 'PROJECT_LOCKED');
  });
});

test('item 9: adding a draft takes the project lock: a holder gives PROJECT_LOCKED and nothing is written', async t => {
  const w = world(t);
  await holding(w.dir, async () => {
    await assert.rejects(addApprovalDraftLocked(w.dirs, w.dir, w.draft(), { definition: w.definition() }), e => e.code === 'PROJECT_LOCKED');
  });
  assert.deepEqual(readApprovalDrafts(w.dirs, w.dir), []);
  assert.equal(fs.existsSync(w.dirs.approvals), false);
  const made = await addApprovalDraftLocked(w.dirs, w.dir, w.draft(), { definition: w.definition() });
  assert.deepEqual(readApprovalDrafts(w.dirs, w.dir), [made]);
});

test('item 9: dropping drafts takes the project lock, and keeps the file while a holder is there', async t => {
  const w = world(t);
  const made = await addApprovalDraftLocked(w.dirs, w.dir, w.draft(), { definition: w.definition() });
  await holding(w.dir, async () => {
    await assert.rejects(dropApprovalDraftsLocked(w.dirs, w.dir), e => e.code === 'PROJECT_LOCKED');
    await assert.rejects(dropApprovalDraftsLocked(w.dirs, w.dir, [made]), e => e.code === 'PROJECT_LOCKED');
  });
  assert.deepEqual(readApprovalDrafts(w.dirs, w.dir), [made]);
  assert.equal(await dropApprovalDraftsLocked(w.dirs, w.dir, [made]), 1);
  assert.deepEqual(readApprovalDrafts(w.dirs, w.dir), []);
});

test('item 9: a layout of another project is refused before the lock', async t => {
  const w = world(t);
  const other = harnessStateDirs(w.stateRoot, fs.realpathSync(os.tmpdir()));
  await assert.rejects(addApprovalDraftLocked(other, w.dir, w.draft(), { definition: w.definition() }), e => e.code === 'PORTABLE_USAGE');
  t.after(() => chmodTree(w.stateRoot));
});
