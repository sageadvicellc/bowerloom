import test from '../../../dist/tests/support/lock-slot-retry.js';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { syncBuiltinESMExports } from 'node:module';
import { planManagedItem, inspectManagedProject } from '../../../dist/packages/managed-skills/src/v2-observed.js';
import { applyManagedItem, planManagedItemRecovery, recoverManagedItem, recoverManagedItemHeld } from '../../../dist/packages/managed-skills/src/v2-transaction.js';
import { withProjectLock } from '../../../dist/packages/project-context/src/index.js';
import { project, localSkill, request, local, inventory, code } from './v2-fixture.mjs';

const MARKER = '.bowerloom/managed-pending.json';
const recoveryInput = (req, plan, action) => ({ projectDir: req.projectDir, stateDir: req.stateDir, operationKey: plan.operationKey, action });
async function recover(req, plan, action) { const p = await planManagedItemRecovery(recoveryInput(req, plan, action)); return recoverManagedItem(p, p.revision); }
function restore(t) { t.mock.restoreAll(); syncBuiltinESMExports(); }
async function scenario(t, update) {
  const f = project(t); localSkill(f, 'house-style'); let req = request(f, { id: 'house-style', source: local('house-style') }), previous = null;
  if (update) { const first = await planManagedItem(req); previous = await applyManagedItem(null, req, first.revision); fs.writeFileSync(path.join(f.projectDir, '.bowerloom/skills/house-style/references/notes.md'), '# Notes\nTwo.\n'); req = { ...req, operation: 'update', expectedPreviousRevision: previous.revision }; }
  return { f, req, previous, before: inventory(f.projectDir), plan: await planManagedItem(req) };
}
/** Counts every whole-buffer write (intent, marker, journal records, staged files) and kills at one of them. */
function writes(t, kill = null) {
  const seen = [], write = fs.writeFileSync, rename = fs.renameSync; let n = 0, placing = null;
  t.mock.method(fs, 'writeFileSync', (fd, data, ...rest) => {
    if (typeof fd !== 'number') return write(fd, data, ...rest);
    const i = n++, text = String(data); seen.push(text.startsWith('{"sequence":') ? JSON.parse(text).kind : /^\{"format":"bowerloom\/managed-item-(?:intent|pending)\/v1beta2"/.test(text) ? JSON.parse(text).format : 'stage-file');
    if (kill && kill.index === i && kill.when === 'before') throw Error('PRIVATE_KILL_BEFORE');
    const result = write(fd, data, ...rest); if (kill && kill.index === i && kill.when === 'written') throw Error('PRIVATE_KILL_WRITTEN'); placing = i; return result;
  });
  // 'after' a record is a kill once its temporary is renamed into place; a staged file has no rename.
  t.mock.method(fs, 'renameSync', (from, to) => { const result = rename(from, to); if (String(from).endsWith('.tmp') && kill && kill.when === 'after' && placing === kill.index) throw Error('PRIVATE_KILL_AFTER'); return result; });
  syncBuiltinESMExports(); return seen;
}

for (const update of [false, true]) test(`${update ? 'update' : 'install'}: abandon converges from a kill at every staging boundary`, async t => {
  const reference = await scenario(t, update), seen = writes(t); await applyManagedItem(null, reference.req, reference.plan.revision); restore(t);
  const last = seen.lastIndexOf('STAGE_READY'); assert.equal(seen[0], 'bowerloom/managed-item-intent/v1beta2'); assert.equal(seen[1], 'bowerloom/managed-item-pending/v1beta2');
  assert.ok(seen.slice(0, last + 1).filter(k => k === 'stage-file').length >= (update ? 7 : 8));
  const tally = { abandoned: 0, unreadable: 0 };
  for (let index = 0; index <= last; index++) for (const when of ['before', 'written', 'after']) {
    // A staged file has no rename, and its 'written' state equals the next boundary's 'before'.
    if (when !== 'before' && seen[index] === 'stage-file') continue;
    // The update run (each scenario first installs) takes every boundary's 'before' point; install takes all three.
    if (update && when !== 'before') continue;
    const label = `${when} ${index} ${seen[index]}`, run = await scenario(t, update); writes(t, { index, when });
    await assert.rejects(applyManagedItem(null, run.req, run.plan.revision), e => e.code === 'MANAGED_SKILL_RECOVERY_REQUIRED' && !e.message.includes('PRIVATE'), label); restore(t);
    if (index === 0 && when !== 'after') {
      // No intent.json landed: the operation folder cannot be read, so no recovery runs. Nothing in the project changed.
      tally.unreadable++; for (const a of ['resume', 'rollback', 'abandon']) await assert.rejects(planManagedItemRecovery(recoveryInput(run.req, run.plan, a)), label);
      assert.deepEqual(inventory(run.f.projectDir), run.before, label); continue;
    }
    // Staging is incomplete or unconfirmed: resume and rollback stay held, abandon is the way out. Once the last
    // STAGE_READY is in place, staging is complete and all three are open; abandon is still exact.
    if (!(index === last && when === 'after')) for (const a of ['resume', 'rollback']) await assert.rejects(planManagedItemRecovery(recoveryInput(run.req, run.plan, a)), label);
    const result = await recover(run.req, run.plan, 'abandon'); tally.abandoned++;
    assert.equal(result.state, 'rolled-back', label); assert.equal(result.restoredPrevious?.revision ?? null, run.previous?.revision ?? null, label);
    assert.deepEqual(inventory(run.f.projectDir), run.before, label); assert.equal(fs.existsSync(path.join(run.f.projectDir, MARKER)), false, label);
    assert.equal(inspectManagedProject(run.f.projectDir, run.f.itemsRoot).pending, null, label);
    // Terminal: the same receipt again, and no other action. Sampled, since each recovery takes the project lock.
    if (index % 4 === 0) assert.equal((await recover(run.req, run.plan, 'abandon')).revision, result.revision, label);
    await assert.rejects(planManagedItemRecovery(recoveryInput(run.req, run.plan, 'resume')), label);
  }
  t.diagnostic(`abandoned ${tally.abandoned}, unreadable ${tally.unreadable}`); assert.equal(tally.unreadable, update ? 1 : 2); assert.ok(tally.abandoned >= (update ? 16 : 33));
});

test('abandon refuses once a move or a parent is recorded, or when a before-surface drifted, and writes nothing', async t => {
  const rename = fs.renameSync;
  // A completed move.
  let run = await scenario(t, false), hit = false;
  t.mock.method(fs, 'renameSync', (from, to) => { const r = rename(from, to); if (!hit && !String(from).endsWith('.tmp')) { hit = true; throw Error('PRIVATE_AFTER_MOVE'); } return r; }); syncBuiltinESMExports();
  await assert.rejects(applyManagedItem(null, run.req, run.plan.revision)); restore(t); assert.equal(hit, true);
  let pending = inventory(run.f.projectDir); await assert.rejects(planManagedItemRecovery(recoveryInput(run.req, run.plan, 'abandon')), code('MANAGED_SKILL_RECOVERY_REQUIRED'));
  assert.deepEqual(inventory(run.f.projectDir), pending); assert.equal((await recover(run.req, run.plan, 'rollback')).state, 'rolled-back');
  // A created and stamped parent, before any move.
  run = await scenario(t, false); hit = false; const write = fs.writeFileSync;
  t.mock.method(fs, 'writeFileSync', (fd, data, ...rest) => { const r = write(fd, data, ...rest); if (!hit && typeof data === 'string' && data.includes('"kind":"PARENT_CREATED"')) { hit = true; throw Error('PRIVATE_AFTER_PARENT'); } return r; }); syncBuiltinESMExports();
  await assert.rejects(applyManagedItem(null, run.req, run.plan.revision)); restore(t); assert.equal(hit, true);
  // The record was written but not renamed into place, so it is a prestamp gap: held, abandon included.
  for (const a of ['resume', 'rollback', 'abandon']) await assert.rejects(planManagedItemRecovery(recoveryInput(run.req, run.plan, a)));
  run = await scenario(t, false); hit = false;
  t.mock.method(fs, 'renameSync', (from, to) => { const r = rename(from, to); if (!hit && String(from).endsWith('.tmp') && fs.readFileSync(to, 'utf8').includes('"kind":"PARENT_CREATED"')) { hit = true; throw Error('PRIVATE_AFTER_PARENT'); } return r; }); syncBuiltinESMExports();
  await assert.rejects(applyManagedItem(null, run.req, run.plan.revision)); restore(t); assert.equal(hit, true);
  pending = inventory(run.f.projectDir); await assert.rejects(planManagedItemRecovery(recoveryInput(run.req, run.plan, 'abandon')), code('MANAGED_SKILL_RECOVERY_REQUIRED'));
  assert.deepEqual(inventory(run.f.projectDir), pending); assert.equal((await recover(run.req, run.plan, 'rollback')).state, 'rolled-back'); assert.deepEqual(inventory(run.f.projectDir), run.before);
  // Drift of a before-surface during staging: a local edit of the installed Codex projection.
  run = await scenario(t, true); hit = false;
  t.mock.method(fs, 'writeFileSync', (fd, data, ...rest) => { if (!hit && typeof data === 'string' && data.includes('"kind":"STAGE_READY"')) { hit = true; throw Error('PRIVATE_KILL'); } return write(fd, data, ...rest); }); syncBuiltinESMExports();
  await assert.rejects(applyManagedItem(null, run.req, run.plan.revision)); restore(t); assert.equal(hit, true);
  // An approval taken before the drift is refused at recovery, and a fresh plan names the drift.
  const approved = await planManagedItemRecovery(recoveryInput(run.req, run.plan, 'abandon'));
  fs.appendFileSync(path.join(run.f.projectDir, '.agents/skills/house-style/SKILL.md'), 'Local edit.\n'); pending = inventory(run.f.projectDir);
  await assert.rejects(recoverManagedItem(approved, approved.revision)); assert.deepEqual(inventory(run.f.projectDir), pending);
  await assert.rejects(planManagedItemRecovery(recoveryInput(run.req, run.plan, 'abandon')), code('MANAGED_SKILL_LOCAL_DRIFT'));
  assert.deepEqual(inventory(run.f.projectDir), pending); assert.equal(fs.existsSync(path.join(run.f.projectDir, MARKER)), true);
});

test('an abandon interrupted after its ROLLBACK_START or its receipt finishes on the next abandon', async t => {
  for (const stop of ['ROLLBACK_START', 'RECEIPT_DONE', 'MARKER_REMOVE_INTENT']) {
    const run = await scenario(t, true), write = fs.writeFileSync; let hit = false;
    t.mock.method(fs, 'writeFileSync', (fd, data, ...rest) => { if (!hit && typeof data === 'string' && data.includes('"kind":"STAGE_READY"')) { hit = true; throw Error('PRIVATE_KILL'); } return write(fd, data, ...rest); }); syncBuiltinESMExports();
    await assert.rejects(applyManagedItem(null, run.req, run.plan.revision)); restore(t);
    let stopped = false, rename = fs.renameSync;
    t.mock.method(fs, 'renameSync', (from, to) => { const r = rename(from, to); if (!stopped && String(from).endsWith('.tmp') && String(to).includes('record-') && fs.readFileSync(to, 'utf8').includes(`"kind":"${stop}"`)) { stopped = true; throw Error('PRIVATE_STOP'); } return r; }); syncBuiltinESMExports();
    await assert.rejects(recover(run.req, run.plan, 'abandon'), stop); restore(t); assert.equal(stopped, true, stop);
    const result = await recover(run.req, run.plan, 'abandon'); assert.equal(result.state, 'rolled-back', stop); assert.deepEqual(inventory(run.f.projectDir), run.before, stop);
  }
});

const hold = (dir, work, signal = new AbortController().signal) => withProjectLock(dir, signal, work);
test('recovery under a caller-held lock makes the same held-lock checks as apply', async t => {
  for (const action of ['resume', 'rollback', 'abandon']) {
    const run = await scenario(t, false), write = fs.writeFileSync, rename = fs.renameSync; let hit = false;
    if (action === 'abandon') t.mock.method(fs, 'writeFileSync', (fd, data, ...rest) => { if (!hit && typeof data === 'string' && data.includes('"kind":"STAGE_READY"')) { hit = true; throw Error('PRIVATE_KILL'); } return write(fd, data, ...rest); });
    else t.mock.method(fs, 'renameSync', (from, to) => { const r = rename(from, to); if (!hit && !String(from).endsWith('.tmp')) { hit = true; throw Error('PRIVATE_AFTER_MOVE'); } return r; });
    syncBuiltinESMExports(); await assert.rejects(applyManagedItem(null, run.req, run.plan.revision)); restore(t); assert.equal(hit, true);
    const recovery = await planManagedItemRecovery(recoveryInput(run.req, run.plan, action)), pending = inventory(run.f.projectDir);
    // A token kept past its lock cannot be real: the lock is released and nobody holds the port.
    let stale; await hold(run.f.projectDir, async held => { stale = held; });
    await assert.rejects(recoverManagedItemHeld(stale, recovery, recovery.revision), code('MANAGED_SKILL_ABORTED'));
    // A literal with the right shape is refused while the lock is really held.
    await hold(run.f.projectDir, async real => {
      await assert.rejects(recoverManagedItemHeld({ dir: real.dir, signal: real.signal, assertHeld() {} }, recovery, recovery.revision), code('MANAGED_SKILL_LOCK_NOT_HELD'));
      await assert.rejects(recoverManagedItemHeld({ ...real }, recovery, recovery.revision), code('MANAGED_SKILL_LOCK_NOT_HELD'));
      await hold(run.f.base, async other => { await assert.rejects(recoverManagedItemHeld(other, recovery, recovery.revision), code('MANAGED_SKILL_LOCK_NOT_HELD')); });
      await assert.rejects(recoverManagedItemHeld(null, recovery, recovery.revision), code('MANAGED_SKILL_LOCK_NOT_HELD'));
      // The self-locking entry cannot take the lock the caller holds.
      await assert.rejects(recoverManagedItem(recovery, recovery.revision), code('MANAGED_SKILL_LOCKED'));
      await assert.rejects(recoverManagedItemHeld(real, recovery, '0'.repeat(64)), code('MANAGED_SKILL_STALE_APPROVAL'));
    });
    const aborted = new AbortController();
    await hold(run.f.projectDir, async held => { aborted.abort(); await assert.rejects(recoverManagedItemHeld(held, recovery, recovery.revision), code('MANAGED_SKILL_ABORTED')); }, aborted.signal);
    assert.deepEqual(inventory(run.f.projectDir), pending, action);
    const result = await hold(run.f.projectDir, held => recoverManagedItemHeld(held, recovery, recovery.revision)); assert.equal(result.state, action === 'resume' ? 'committed' : 'rolled-back', action);
    assert.equal(fs.existsSync(path.join(run.f.projectDir, MARKER)), false, action);
  }
});

test('after a rollback or an abandon, the same request plans a new operation and applies', async t => {
  for (const action of ['rollback', 'abandon']) for (const update of [false, true]) {
    const label = `${action} ${update ? 'update' : 'install'}`, run = await scenario(t, update), write = fs.writeFileSync, rename = fs.renameSync; let hit = false;
    if (action === 'abandon') t.mock.method(fs, 'writeFileSync', (fd, data, ...rest) => { if (!hit && typeof data === 'string' && data.includes('"kind":"STAGE_READY"')) { hit = true; throw Error('PRIVATE_KILL'); } return write(fd, data, ...rest); });
    else t.mock.method(fs, 'renameSync', (from, to) => { const r = rename(from, to); if (!hit && !String(from).endsWith('.tmp')) { hit = true; throw Error('PRIVATE_AFTER_MOVE'); } return r; });
    syncBuiltinESMExports(); await assert.rejects(applyManagedItem(null, run.req, run.plan.revision)); restore(t); assert.equal(hit, true, label);
    assert.equal((await recover(run.req, run.plan, action)).state, 'rolled-back', label); assert.deepEqual(inventory(run.f.projectDir), run.before, label);
    const again = await planManagedItem(run.req); assert.notEqual(again.operationKey, run.plan.operationKey, label);
    const receipt = await applyManagedItem(null, run.req, again.revision); assert.equal(receipt.state, 'committed', label); assert.equal(receipt.previousRevision, run.previous?.revision ?? null, label);
  }
});
