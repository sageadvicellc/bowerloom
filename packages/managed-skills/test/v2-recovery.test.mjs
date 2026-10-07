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
  // 'after' a record is a kill once its temporary is renamed into place (or, for the marker, linked into place, which
  // leaves the marker and its temporary as one file); a staged file has no rename.
  t.mock.method(fs, 'renameSync', (from, to) => { const result = rename(from, to); if (String(from).endsWith('.tmp') && kill && kill.when === 'after' && placing === kill.index) throw Error('PRIVATE_KILL_AFTER'); return result; });
  const link = fs.linkSync; t.mock.method(fs, 'linkSync', (from, to) => { const result = link(from, to); if (String(from).endsWith('.tmp') && kill && kill.when === 'after' && placing === kill.index) throw Error('PRIVATE_KILL_AFTER'); return result; });
  syncBuiltinESMExports(); return seen;
}

for (const update of [false, true]) test(`${update ? 'update' : 'install'}: abandon converges from a kill at every staging boundary`, async t => {
  const reference = await scenario(t, update), seen = writes(t); await applyManagedItem(null, reference.req, reference.plan.revision); restore(t);
  const last = seen.lastIndexOf('STAGE_READY'); assert.equal(seen[0], 'bowerloom/managed-item-intent/v1beta2'); assert.equal(seen[1], 'bowerloom/managed-item-pending/v1beta2');
  assert.ok(seen.slice(0, last + 1).filter(k => k === 'stage-file').length >= (update ? 7 : 8));
  const tally = { abandoned: 0, unpublished: 0 };
  for (let index = 0; index <= last; index++) for (const when of ['before', 'written', 'after']) {
    // A staged file has no rename, and its 'written' state equals the next boundary's 'before'.
    if (when !== 'before' && seen[index] === 'stage-file') continue;
    // The update run (each scenario first installs) takes every boundary's 'before' point; install takes all three.
    if (update && when !== 'before') continue;
    const label = `${when} ${index} ${seen[index]}`, run = await scenario(t, update); writes(t, { index, when });
    if (index === 0) {
      // The operation folder is published whole with its intent, or not at all: a failure while the intent is written
      // leaves no operation, removes its private temporary folder, and the same approval applies on a retry.
      await assert.rejects(applyManagedItem(null, run.req, run.plan.revision), e => e.code === 'MANAGED_SKILL_REFUSED' && !e.message.includes('PRIVATE'), label); restore(t);
      tally.unpublished++; assert.deepEqual(fs.readdirSync(run.req.stateDir), run.previous ? ['op-' + run.previous.operationKey] : [], label); assert.deepEqual(inventory(run.f.projectDir), run.before, label);
      for (const a of ['resume', 'rollback', 'abandon']) await assert.rejects(planManagedItemRecovery(recoveryInput(run.req, run.plan, a)), label);
      assert.equal((await applyManagedItem(null, run.req, run.plan.revision)).state, 'committed', label); continue;
    }
    await assert.rejects(applyManagedItem(null, run.req, run.plan.revision), e => e.code === 'MANAGED_SKILL_RECOVERY_REQUIRED' && !e.message.includes('PRIVATE'), label); restore(t);
    // Staging is incomplete or unconfirmed: resume and rollback stay held, abandon is the way out. Once the last
    // STAGE_READY is in place, staging is complete and all three are open; abandon is still exact.
    if (!(index === last && when === 'after')) for (const a of ['resume', 'rollback']) await assert.rejects(planManagedItemRecovery(recoveryInput(run.req, run.plan, a)), label);
    const result = await recover(run.req, run.plan, 'abandon'); tally.abandoned++;
    assert.equal(result.state, 'rolled-back', label); assert.equal(result.restoredPrevious?.revision ?? null, run.previous?.revision ?? null, label);
    assert.deepEqual(inventory(run.f.projectDir), run.before, label); assert.equal(fs.existsSync(path.join(run.f.projectDir, MARKER)), false, label);
    // A whole or part-written marker temporary is this operation's marker bytes, so abandon removes it.
    assert.equal(fs.existsSync(path.join(run.f.projectDir, '.bowerloom/.managed-pending.json.tmp')), false, label);
    assert.equal(inspectManagedProject(run.f.projectDir, run.f.itemsRoot).pending, null, label);
    // Terminal: the same receipt again, and no other action. Sampled, since each recovery takes the project lock.
    if (index % 4 === 0) assert.equal((await recover(run.req, run.plan, 'abandon')).revision, result.revision, label);
    await assert.rejects(planManagedItemRecovery(recoveryInput(run.req, run.plan, 'resume')), label);
  }
  t.diagnostic(`abandoned ${tally.abandoned}, unpublished ${tally.unpublished}`); assert.equal(tally.unpublished, update ? 1 : 3); assert.ok(tally.abandoned >= (update ? 16 : 33));
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
  t.mock.method(fs, 'renameSync', (from, to) => { const r = rename(from, to); if (!hit && String(from).endsWith('.tmp') && fs.lstatSync(to).isFile() && fs.readFileSync(to, 'utf8').includes('"kind":"PARENT_CREATED"')) { hit = true; throw Error('PRIVATE_AFTER_PARENT'); } return r; }); syncBuiltinESMExports();
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

const intentWrite = (t, also = () => {}) => {
  const write = fs.writeFileSync; t.mock.method(fs, 'writeFileSync', (fd, data, ...rest) => { if (typeof data === 'string' && data.includes('"bowerloom/managed-item-intent/v1beta2"')) throw Error('PRIVATE_KILL'); return write(fd, data, ...rest); });
  also(); syncBuiltinESMExports();
};
test('a kill before the operation folder is published leaves only a private temporary, which plan ignores and apply removes', async t => {
  const run = await scenario(t, false);
  // The cleanup fails too, as a kill would leave it.
  intentWrite(t, () => t.mock.method(fs, 'rmdirSync', () => { throw Error('PRIVATE_KILLED'); }));
  await assert.rejects(applyManagedItem(null, run.req, run.plan.revision), e => e.code === 'MANAGED_SKILL_REFUSED' && !e.message.includes('PRIVATE')); restore(t);
  const temp = '.op-' + run.plan.operationKey + '.tmp';
  assert.deepEqual(fs.readdirSync(run.req.stateDir), [temp]); assert.deepEqual(inventory(run.f.projectDir), run.before);
  // Plan reads past it (it is no operation) and gives the same approval; apply removes it under the lock, then commits.
  assert.equal((await planManagedItem(run.req)).revision, run.plan.revision);
  assert.equal((await applyManagedItem(null, run.req, run.plan.revision)).state, 'committed');
  assert.deepEqual(fs.readdirSync(run.req.stateDir), ['op-' + run.plan.operationKey]);
});
test('a leftover operation temporary that holds anything but its intent is never removed', async t => {
  for (const [extra, form] of [['notes.txt', 'file'], ['sub', 'folder'], ['intent.json', 'link']]) {
    const run = await scenario(t, false), temp = path.join(run.req.stateDir, '.op-' + 'c'.repeat(64) + '.tmp'); fs.mkdirSync(temp, { mode: 0o700 });
    if (form === 'file') fs.writeFileSync(path.join(temp, extra), 'user data', { mode: 0o600 }); else if (form === 'folder') fs.mkdirSync(path.join(temp, extra), { mode: 0o700 }); else fs.symlinkSync(path.join(run.f.projectDir, 'AGENTS.md'), path.join(temp, extra));
    await assert.rejects(applyManagedItem(null, run.req, run.plan.revision), code('MANAGED_SKILL_RECOVERY_REQUIRED'), form);
    assert.deepEqual(fs.readdirSync(temp), [extra], form); assert.deepEqual(inventory(run.f.projectDir), run.before, form);
  }
});

test('an operation folder may hold at most one record temporary, with exactly the next name', async t => {
  const killFirstMove = () => { const rename = fs.renameSync; let hit = false; t.mock.method(fs, 'renameSync', (from, to) => { if (!hit && !String(from).endsWith('.tmp')) { hit = true; throw Error('PRIVATE_KILL'); } return rename(from, to); }); syncBuiltinESMExports(); };
  const killed = async () => { const run = await scenario(t, false); killFirstMove(); await assert.rejects(applyManagedItem(null, run.req, run.plan.revision)); restore(t); return { run, op: path.join(run.req.stateDir, 'op-' + run.plan.operationKey) }; };
  const records = op => fs.readdirSync(op).filter(n => /^record-\d{3}\.json$/.test(n)).length, next = op => '.record-' + String(records(op)).padStart(3, '0') + '.json.tmp';
  for (const names of [['.record-200.json.tmp'], ['.intent.json.tmp'], ['.receipt.json.tmp'], ['NEXT', '.record-999.json.tmp']]) {
    const { run, op } = await killed();
    for (const n of names) fs.writeFileSync(path.join(op, n === 'NEXT' ? next(op) : n), 'junk', { mode: 0o600 });
    await assert.rejects(planManagedItemRecovery(recoveryInput(run.req, run.plan, 'rollback')), names.join());
  }
  // The one temporary an interrupted write leaves, the next record's, is allowed, and the next write removes it.
  const { run, op } = await killed(); fs.writeFileSync(path.join(op, next(op)), '{"sequence', { mode: 0o600 });
  assert.equal((await recover(run.req, run.plan, 'rollback')).state, 'rolled-back');
  assert.deepEqual(fs.readdirSync(op).filter(n => n.endsWith('.tmp')), []);
});

const markerTemp = run => path.join(run.f.projectDir, '.bowerloom/.managed-pending.json.tmp');
test('the marker is published by a link that never replaces a file that appeared after the check', async t => {
  const run = await scenario(t, false), marker = path.join(run.f.projectDir, MARKER), foreign = '{"foreign":true}\n';
  const link = fs.linkSync, rename = fs.renameSync, plant = to => { if (String(to) === marker && !fs.existsSync(marker)) fs.writeFileSync(marker, foreign, { mode: 0o600 }); };
  t.mock.method(fs, 'linkSync', (from, to) => { plant(to); return link(from, to); });
  t.mock.method(fs, 'renameSync', (from, to) => { plant(to); return rename(from, to); }); syncBuiltinESMExports();
  await assert.rejects(applyManagedItem(null, run.req, run.plan.revision), code('MANAGED_SKILL_RECOVERY_REQUIRED')); restore(t);
  assert.equal(fs.readFileSync(marker, 'utf8'), foreign);
});
test('a kill between the marker link and its temporary unlink is read as pending and settled by recovery', async t => {
  // Killed right at publish, so nothing is staged and abandon is the way out; or killed later, with the twin made by hand.
  for (const action of ['abandon', 'rollback']) {
    const run = await scenario(t, false), marker = path.join(run.f.projectDir, MARKER), temp = markerTemp(run), unlink = fs.unlinkSync, rename = fs.renameSync; let hit = false;
    if (action === 'abandon') t.mock.method(fs, 'unlinkSync', p => { if (!hit && String(p) === temp) { hit = true; throw Error('PRIVATE_KILL'); } return unlink(p); });
    else t.mock.method(fs, 'renameSync', (from, to) => { if (!hit && !String(from).endsWith('.tmp')) { hit = true; throw Error('PRIVATE_KILL'); } return rename(from, to); });
    syncBuiltinESMExports(); await assert.rejects(applyManagedItem(null, run.req, run.plan.revision), action); restore(t); assert.equal(hit, true, action);
    if (action === 'rollback') fs.linkSync(marker, temp);
    assert.equal(fs.lstatSync(marker).nlink, 2, action); assert.equal(fs.lstatSync(temp).ino, fs.lstatSync(marker).ino, action);
    assert.equal(inspectManagedProject(run.f.projectDir, run.f.itemsRoot).pending?.operationKey, run.plan.operationKey, action);
    const result = await recover(run.req, run.plan, action); assert.equal(result.state, 'rolled-back', action);
    assert.equal(fs.existsSync(temp), false, action); assert.equal(fs.existsSync(marker), false, action); assert.deepEqual(inventory(run.f.projectDir), run.before, action);
  }
  // A second link that is not the marker's own temporary is never accepted.
  const run = await scenario(t, false), rename = fs.renameSync; let hit = false;
  t.mock.method(fs, 'renameSync', (from, to) => { if (!hit && !String(from).endsWith('.tmp')) { hit = true; throw Error('PRIVATE_KILL'); } return rename(from, to); }); syncBuiltinESMExports();
  await assert.rejects(applyManagedItem(null, run.req, run.plan.revision)); restore(t);
  fs.linkSync(path.join(run.f.projectDir, MARKER), path.join(run.f.projectDir, 'elsewhere.json'));
  await assert.rejects(planManagedItemRecovery(recoveryInput(run.req, run.plan, 'rollback')));
});
test('abandon removes a leftover marker temporary only when its bytes begin this operation marker', async t => {
  // A kill while the marker temporary is written: half of its bytes land.
  const killed = async () => {
    const run = await scenario(t, false), write = fs.writeFileSync; let marker = null;
    t.mock.method(fs, 'writeFileSync', (fd, data, ...rest) => { if (marker === null && typeof data === 'string' && data.includes('"bowerloom/managed-item-pending/v1beta2"')) { marker = data; write(fd, data.slice(0, 40), ...rest); throw Error('PRIVATE_KILL'); } return write(fd, data, ...rest); }); syncBuiltinESMExports();
    await assert.rejects(applyManagedItem(null, run.req, run.plan.revision)); restore(t); assert.equal(fs.readFileSync(markerTemp(run), 'utf8'), marker.slice(0, 40)); return { run, marker };
  };
  // The removal after the receipt is killed too: the next abandon returns the same receipt and removes it.
  let { run } = await killed(); const unlink = fs.unlinkSync; let hit = false;
  t.mock.method(fs, 'unlinkSync', p => { if (!hit && String(p) === markerTemp(run)) { hit = true; throw Error('PRIVATE_KILL'); } return unlink(p); }); syncBuiltinESMExports();
  await assert.rejects(recover(run.req, run.plan, 'abandon')); restore(t); assert.equal(hit, true); assert.equal(fs.existsSync(markerTemp(run)), true);
  assert.equal((await recover(run.req, run.plan, 'abandon')).state, 'rolled-back'); assert.equal(fs.existsSync(markerTemp(run)), false);
  // Other bytes under the same name are never removed, on the first abandon or a repeated one.
  ({ run } = await killed()); fs.writeFileSync(markerTemp(run), '{"format":"someone else"}', { mode: 0o600 });
  const receipt = await recover(run.req, run.plan, 'abandon'); assert.equal(receipt.state, 'rolled-back'); assert.equal(fs.readFileSync(markerTemp(run), 'utf8'), '{"format":"someone else"}');
  assert.equal((await recover(run.req, run.plan, 'abandon')).revision, receipt.revision); assert.equal(fs.readFileSync(markerTemp(run), 'utf8'), '{"format":"someone else"}');
});
