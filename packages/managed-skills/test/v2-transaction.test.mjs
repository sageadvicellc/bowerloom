import test from '../../../dist/tests/support/lock-slot-retry.js';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { syncBuiltinESMExports } from 'node:module';
import { planManagedItem, inspectManagedProject } from '../../../dist/packages/managed-skills/src/v2-observed.js';
import { applyManagedItem, planManagedItemRecovery, recoverManagedItem } from '../../../dist/packages/managed-skills/src/v2-transaction.js';
import { withProjectLock, lockPort } from '../../../dist/packages/project-context/src/index.js';
import { revisionOf } from '../../../dist/packages/skill-sources/src/validation.js';
import { project, cacheSkill, localSkill, request, local, cached, inventory, code } from './v2-fixture.mjs';

const MARKER = '.bowerloom/managed-pending.json';
async function install(req) { const plan = await planManagedItem(req); return { plan, receipt: await applyManagedItem(null, req, plan.revision) }; }
const recoveryInput = (req, plan, action) => ({ projectDir: req.projectDir, stateDir: req.stateDir, operationKey: plan.operationKey, action });
async function recover(req, plan, action) { const p = await planManagedItemRecovery(recoveryInput(req, plan, action)); return recoverManagedItem(p, p.revision); }
const read = (f, rel) => fs.readFileSync(path.join(f.projectDir, rel), 'utf8');

test('cache skill: install, up-to-date, update and local drift refusal on both harnesses', async t => {
  const f = project(t), v1 = await cacheSkill(f), req = request(f, { id: 'collections', source: cached(v1.selector) });
  const { receipt } = await install(req);
  assert.equal(receipt.format, 'bowerloom/managed-item-receipt/v1beta2'); assert.equal(receipt.state, 'committed'); assert.equal(receipt.executionAuthorized, false); assert.equal(receipt.migratedFrom, null);
  assert.deepEqual(receipt.harnesses, ['claude', 'codex']); assert.deepEqual(receipt.item, { kind: 'skill', id: 'collections' });
  for (const root of ['.bowerloom/managed/skills/collections', '.claude/skills/synthetic-collections', '.agents/skills/synthetic-collections']) for (const file of v1.files) assert.equal(read(f, path.join(root, file.path)), file.text);
  assert.equal(fs.existsSync(path.join(f.projectDir, MARKER)), false);
  const same = await planManagedItem({ ...req, operation: 'update', expectedPreviousRevision: receipt.revision });
  assert.equal(same.status, 'up-to-date'); assert.equal(same.previousRevision, receipt.revision); assert.equal(same.revision, undefined);
  await assert.rejects(planManagedItem({ ...req, operation: 'update', expectedPreviousRevision: null }), code('MANAGED_SKILL_STALE_APPROVAL'));
  await assert.rejects(planManagedItem(req), code('MANAGED_SKILL_STALE_APPROVAL'));
  const v2 = await cacheSkill(f, { version: '2.0.0', operationId: 'c'.repeat(32) }), update = { ...req, operation: 'update', source: cached(v2.selector), expectedPreviousRevision: receipt.revision };
  const plan = await planManagedItem(update); await assert.rejects(applyManagedItem(null, update, '0'.repeat(64)), code('MANAGED_SKILL_STALE_APPROVAL'));
  const second = await applyManagedItem(null, update, plan.revision); assert.equal(second.state, 'committed'); assert.equal(second.previousRevision, receipt.revision);
  for (const root of ['.bowerloom/managed/skills/collections', '.claude/skills/synthetic-collections', '.agents/skills/synthetic-collections']) assert.match(read(f, path.join(root, 'references/guide.md')), /2\.0\.0/);
  await assert.rejects(applyManagedItem(null, update, plan.revision));
  assert.equal(inspectManagedProject(f.projectDir, f.itemsRoot).items[0].receiptRevision, second.revision);
  fs.appendFileSync(path.join(f.projectDir, '.agents/skills/synthetic-collections/SKILL.md'), 'Local authored change.'); const before = inventory(f.projectDir);
  await assert.rejects(planManagedItem({ ...update, expectedPreviousRevision: second.revision }), code('MANAGED_SKILL_LOCAL_DRIFT'));
  assert.deepEqual(inventory(f.projectDir), before); assert.equal(fs.readdirSync(req.stateDir).length, 2);
});

test('local skill: an authored edit is an update, a harness can be added and never silently dropped', async t => {
  const f = project(t); localSkill(f, 'house-style'); const req = request(f, { id: 'house-style', source: local('house-style'), harnesses: ['codex'] });
  const { receipt } = await install(req); assert.equal(fs.existsSync(path.join(f.projectDir, '.claude')), false);
  fs.writeFileSync(path.join(f.projectDir, '.bowerloom/skills/house-style/references/notes.md'), '# Notes\nTwo.\n');
  const both = { ...req, operation: 'update', harnesses: ['claude', 'codex'], expectedPreviousRevision: receipt.revision }, plan = await planManagedItem(both);
  const next = await applyManagedItem(null, both, plan.revision);
  for (const root of ['.bowerloom/managed/skills/house-style', '.claude/skills/house-style', '.agents/skills/house-style']) assert.equal(read(f, path.join(root, 'references/notes.md')), '# Notes\nTwo.\n');
  assert.equal((await planManagedItem({ ...both, expectedPreviousRevision: next.revision })).status, 'up-to-date');
  await assert.rejects(planManagedItem({ ...both, harnesses: ['codex'], expectedPreviousRevision: next.revision }));
});

const hold = (dir, work, signal = new AbortController().signal) => withProjectLock(dir, signal, work);
test('a caller-held project lock is required to be real and for this project', async t => {
  const f = project(t); localSkill(f, 'house-style'); const req = request(f, { id: 'house-style', source: local('house-style') }), plan = await planManagedItem(req);
  // A token kept past its lock cannot be real: the lock is released and nobody holds the port.
  let stale; await hold(f.projectDir, async held => { stale = held; });
  await assert.rejects(applyManagedItem(stale, req, plan.revision), code('MANAGED_SKILL_ABORTED'));
  await hold(f.projectDir, async () => {
    // A real token for another project is refused.
    await hold(f.base, async other => { await assert.rejects(applyManagedItem(other, req, plan.revision), code('MANAGED_SKILL_LOCK_NOT_HELD')); });
    await assert.rejects(applyManagedItem(null, req, plan.revision), code('MANAGED_SKILL_LOCKED'));
  });
  const aborted = new AbortController();
  await hold(f.projectDir, async held => { aborted.abort(); await assert.rejects(applyManagedItem(held, req, plan.revision), code('MANAGED_SKILL_ABORTED')); }, aborted.signal);
  assert.deepEqual(fs.readdirSync(req.stateDir), []);
  await hold(f.projectDir, async held => { assert.equal((await applyManagedItem(held, req, plan.revision)).state, 'committed'); });
});

test('a forged token with the right shape is refused even while the lock is held and the port is taken', async t => {
  const f = project(t); localSkill(f, 'house-style'); const req = request(f, { id: 'house-style', source: local('house-style') }), plan = await planManagedItem(req), before = inventory(f.projectDir);
  await hold(f.projectDir, async real => {
    const forged = [
      { dir: real.dir, signal: real.signal, assertHeld() {} },
      { dir: real.dir, signal: real.signal, assertHeld: real.assertHeld },
      { ...real },
      Object.create(real),
      Object.assign(Object.create(null), { dir: real.dir, signal: real.signal, assertHeld: real.assertHeld }),
      new Proxy(real, {}),
      structuredClone({ dir: real.dir }),
    ];
    for (const [i, token] of forged.entries()) {
      await assert.rejects(applyManagedItem(token, req, plan.revision), code('MANAGED_SKILL_LOCK_NOT_HELD'), 'forged ' + i);
      assert.deepEqual(fs.readdirSync(req.stateDir), [], 'forged ' + i); assert.deepEqual(inventory(f.projectDir), before, 'forged ' + i);
    }
    // The real token, in the same place, is accepted.
    assert.equal((await applyManagedItem(real, req, plan.revision)).state, 'committed');
  });
});

test('concurrent apply calls create one operation and one committed receipt', async t => {
  const f = project(t); localSkill(f, 'house-style'); const req = request(f, { id: 'house-style', source: local('house-style') }), plan = await planManagedItem(req);
  const results = await Promise.allSettled([applyManagedItem(null, req, plan.revision), applyManagedItem(null, req, plan.revision)]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1); assert.equal(fs.readdirSync(req.stateDir).length, 1);
});

test('a full item history refuses with HISTORY_FULL before any write', async t => {
  const f = project(t); localSkill(f, 'house-style'); const req = request(f, { id: 'house-style', source: local('house-style') });
  for (let i = 0; i < 64; i++) {
    const key = createHash('sha256').update('history-' + i).digest('hex'), op = path.join(req.stateDir, 'op-' + key); fs.mkdirSync(op, { mode: 0o700 });
    const body = { format: 'bowerloom/managed-item-receipt/v1beta2', state: 'rolled-back', item: req.item, operationKey: key, planRevision: key, previousRevision: null, projectDir: f.projectDir, stateDir: req.stateDir, harnesses: req.harnesses, installed: [], restoredPrevious: null, migratedFrom: null, executionAuthorized: false };
    fs.writeFileSync(path.join(op, 'receipt.json'), JSON.stringify({ ...body, revision: revisionOf(body) }) + '\n', { mode: 0o600 });
  }
  const plan = await planManagedItem(req), before = inventory(f.projectDir);
  await assert.rejects(applyManagedItem(null, req, plan.revision), code('MANAGED_SKILL_HISTORY_FULL'));
  assert.deepEqual(inventory(f.projectDir), before); assert.equal(fs.readdirSync(req.stateDir).length, 64);
});

/**
 * Throws at one numbered journal-record or rename boundary, and records every boundary in order. A record is one
 * boundary that spans its temporary write and its rename into place: 'before' is a kill after the temporary is
 * opened and before its bytes land, 'written' a kill with the whole temporary not yet renamed, and 'after' a kill
 * once the record is in place. The rename of a record temporary is part of its record, not a boundary of its own.
 */
function boundaries(t, crash = null) {
  const events = [], write = fs.writeFileSync, rename = fs.renameSync; let n = 0, placing = null;
  const hit = (i, when) => crash && crash.index === i && crash.when === when;
  const step = (event, run) => {
    const i = n++; events.push(event);
    if (hit(i, 'before')) throw Error('PRIVATE_CRASH_BEFORE');
    const result = run();
    if (event.type === 'record') { if (hit(i, 'written')) throw Error('PRIVATE_CRASH_WRITTEN'); placing = i; return result; }
    if (hit(i, 'after')) throw Error('PRIVATE_CRASH_AFTER');
    return result;
  };
  t.mock.method(fs, 'writeFileSync', (fd, data, ...rest) => typeof data === 'string' && data.startsWith('{"sequence":') ? step({ type: 'record', ...JSON.parse(data) }, () => write(fd, data, ...rest)) : write(fd, data, ...rest));
  t.mock.method(fs, 'renameSync', (from, to) => {
    if (!String(from).endsWith('.tmp')) return step({ type: 'rename', from: String(from), to: String(to) }, () => rename(from, to));
    const i = placing; placing = null; const result = rename(from, to); if (i !== null && hit(i, 'after')) throw Error('PRIVATE_CRASH_AFTER'); return result;
  });
  syncBuiltinESMExports();
  return events;
}
function restore(t) { t.mock.restoreAll(); syncBuiltinESMExports(); }
/** Boundaries of the second harness projection (projection-codex): its stage records, its parents, its moves and renames. */
function secondProjection(event) {
  if (event.type === 'rename') return /projection-codex|\/\.agents\/skills\//.test(event.from + ' ' + event.to);
  const d = event.data ?? {};
  if (['STAGE_INTENT', 'STAGE_READY'].includes(event.kind)) return d.id === 'projection-codex';
  if (event.kind.startsWith('PARENT_')) return /\/\.agents(?:\/skills)?$/.test(d.path);
  if (['MOVE_INTENT', 'MOVE_DONE'].includes(event.kind)) return d.surface === 'projection-codex';
  return false;
}
async function scenario(t, update) {
  const f = project(t); localSkill(f, 'house-style'); let req = request(f, { id: 'house-style', source: local('house-style') });
  if (update) { const { receipt } = await install(req); fs.writeFileSync(path.join(f.projectDir, '.bowerloom/skills/house-style/references/notes.md'), '# Notes\nTwo.\n'); req = { ...req, operation: 'update', expectedPreviousRevision: receipt.revision }; }
  return { f, req, before: inventory(f.projectDir), plan: await planManagedItem(req) };
}
for (const update of [false, true]) test(`${update ? 'update' : 'install'}: a crash at every boundary of the second harness projection converges both ways`, async t => {
  const reference = await scenario(t, update), events = boundaries(t); await applyManagedItem(null, reference.req, reference.plan.revision); restore(t);
  const after = inventory(reference.f.projectDir, { inodes: false }), selected = events.map((e, i) => secondProjection(e) ? i : -1).filter(i => i >= 0);
  const lastStage = events.findLastIndex(e => e.kind === 'STAGE_READY');
  assert.ok(selected.length >= (update ? 8 : 6)); assert.ok(events.filter(e => e.type === 'rename' && selected.includes(events.indexOf(e))).length >= (update ? 2 : 1));
  const points = [{ index: selected[0] - 1, when: 'after' }];
  // A 'before' point at a record is a kill after the record file is opened and before its bytes land.
  for (const i of selected) { points.push({ index: i, when: 'after' }, { index: i, when: 'before' }); if (events[i].type === 'record') points.push({ index: i, when: 'written' }); }
  const tally = { held: 0, resume: 0, rollback: 0 }, labels = [];
  for (const point of points) {
    const event = events[point.index], label = `${point.when} ${event.type === 'rename' ? 'rename ' + path.basename(event.from) + ' -> ' + path.basename(event.to) : event.kind + ' ' + JSON.stringify(event.data).slice(0, 80)}`;
    // A crash before every stage is ready, or between a parent intent and its stamp, is held as in v1.
    // A crash before a record lands leaves the state of the boundary before it.
    const held = point.when !== 'after' ? point.index <= lastStage || event.kind === 'PARENT_CREATED' : point.index < lastStage || event.kind === 'PARENT_INTENT';
    labels.push((held ? 'held ' : 'converge ') + label);
    for (const action of held ? ['held'] : ['resume', 'rollback']) {
      tally[action]++; const run = await scenario(t, update); boundaries(t, point);
      await assert.rejects(applyManagedItem(null, run.req, run.plan.revision), e => e.code === 'MANAGED_SKILL_RECOVERY_REQUIRED' && !e.message.includes('PRIVATE'), label); restore(t);
      assert.equal(fs.existsSync(path.join(run.f.projectDir, MARKER)), true, label);
      if (action === 'held') {
        const pending = inventory(run.f.projectDir);
        for (const a of ['resume', 'rollback']) await assert.rejects(planManagedItemRecovery(recoveryInput(run.req, run.plan, a)), label);
        assert.deepEqual(inventory(run.f.projectDir), pending, label);
        assert.equal(inspectManagedProject(run.f.projectDir, run.f.itemsRoot).pending.operationKey, run.plan.operationKey);
        continue;
      }
      const result = await recover(run.req, run.plan, action);
      if (action === 'resume') { assert.equal(result.state, 'committed', label); assert.deepEqual(inventory(run.f.projectDir, { inodes: false }), after, label); }
      else { assert.equal(result.state, 'rolled-back', label); assert.deepEqual(inventory(run.f.projectDir), run.before, label); }
      assert.equal(fs.existsSync(path.join(run.f.projectDir, MARKER)), false, label);
      // A terminal operation recovers again to the same receipt and grants nothing new.
      assert.equal((await recover(run.req, run.plan, action)).revision, result.revision, label);
      await assert.rejects(planManagedItemRecovery(recoveryInput(run.req, run.plan, action === 'resume' ? 'rollback' : 'resume')), label);
    }
  }
  t.diagnostic(`boundaries ${points.length}: held ${tally.held}, resumed ${tally.resume}, rolled back ${tally.rollback}`); for (const l of labels) t.diagnostic(l);
  assert.ok(tally.resume >= (update ? 16 : 13) && tally.resume === tally.rollback);
});

test('a substituted stage and a changed recovery approval are refused without repair', async t => {
  const run = await scenario(t, false), rename = fs.renameSync; let hit = false;
  t.mock.method(fs, 'renameSync', (from, to) => { if (!hit && !String(from).endsWith('.tmp')) { hit = true; throw Error('before first rename'); } return rename(from, to); }); syncBuiltinESMExports();
  await assert.rejects(applyManagedItem(null, run.req, run.plan.revision)); restore(t);
  const recovery = await planManagedItemRecovery(recoveryInput(run.req, run.plan, 'resume'));
  await assert.rejects(recoverManagedItem(recovery, '0'.repeat(64)));
  fs.appendFileSync(path.join(run.req.stateDir, 'op-' + run.plan.operationKey, 'new-projection-codex/SKILL.md'), 'Stage drift.'); const before = inventory(run.f.projectDir);
  await assert.rejects(recoverManagedItem(recovery, recovery.revision)); assert.deepEqual(inventory(run.f.projectDir), before);
});

test('a parent created without its acknowledged identity stays held', async t => {
  const run = await scenario(t, false), mkdir = fs.mkdirSync;
  t.mock.method(fs, 'mkdirSync', (dir, ...args) => { const result = mkdir(dir, ...args); if (String(dir) === path.join(run.f.projectDir, '.agents')) throw Error('parent stamp loss'); return result; }); syncBuiltinESMExports();
  await assert.rejects(applyManagedItem(null, run.req, run.plan.revision)); restore(t);
  await assert.rejects(recover(run.req, run.plan, 'resume')); await assert.rejects(recover(run.req, run.plan, 'rollback'));
  assert.equal(fs.existsSync(path.join(run.f.projectDir, '.agents')), true);
});

test('a second interruption during rollback stays recoverable without replaying reversed moves', async t => {
  const run = await scenario(t, true), rename = fs.renameSync, op = path.join(run.req.stateDir, 'op-' + run.plan.operationKey);
  t.mock.method(fs, 'renameSync', (from, to) => { rename(from, to); if (String(from) === path.join(op, 'new-catalog')) throw Error('stop after catalog'); }); syncBuiltinESMExports();
  await assert.rejects(applyManagedItem(null, run.req, run.plan.revision)); restore(t);
  t.mock.method(fs, 'renameSync', (from, to) => { rename(from, to); if (String(to) === path.join(op, 'returned-projection-codex')) throw Error('stop after reverse'); }); syncBuiltinESMExports();
  await assert.rejects(recover(run.req, run.plan, 'rollback')); restore(t);
  const result = await recover(run.req, run.plan, 'rollback'); assert.equal(result.restoredPrevious.revision, run.req.expectedPreviousRevision);
  assert.deepEqual(inventory(run.f.projectDir), run.before);
});

test('a lost terminal fsync acknowledgement stays pending until an exact recovery', async t => {
  const run = await scenario(t, false), open = fs.openSync, fsync = fs.fsyncSync, receipt = path.join(run.req.stateDir, 'op-' + run.plan.operationKey, '.receipt.json.tmp'); let fd, hit = false;
  t.mock.method(fs, 'openSync', (file, ...args) => { const r = open(file, ...args); if (String(file) === receipt && (args[0] & fs.constants.O_CREAT)) fd = r; return r; });
  t.mock.method(fs, 'fsyncSync', d => { fsync(d); if (d === fd && !hit) { hit = true; throw Error('PRIVATE_ACK_LOSS'); } }); syncBuiltinESMExports();
  await assert.rejects(applyManagedItem(null, run.req, run.plan.revision), code('MANAGED_SKILL_RECOVERY_REQUIRED')); restore(t); assert.equal(hit, true);
  assert.equal((await recover(run.req, run.plan, 'resume')).state, 'committed'); assert.equal(fs.existsSync(path.join(run.f.projectDir, MARKER)), false);
});

test('an authored edit after the plan makes the approval stale, with no write', async t => {
  const run = await scenario(t, false); fs.appendFileSync(path.join(run.f.projectDir, '.bowerloom/skills/house-style/SKILL.md'), 'Edited after review.\n');
  const before = inventory(run.f.projectDir);
  await assert.rejects(applyManagedItem(null, run.req, run.plan.revision), code('MANAGED_SKILL_STALE_APPROVAL'));
  assert.deepEqual(inventory(run.f.projectDir), before); assert.deepEqual(fs.readdirSync(run.req.stateDir), []);
});

test('a kill before the receipt bytes land leaves no part-written receipt, and resume commits', async t => {
  const run = await scenario(t, false), write = fs.writeFileSync, op = path.join(run.req.stateDir, 'op-' + run.plan.operationKey); let hit = false;
  t.mock.method(fs, 'writeFileSync', (fd, data, ...rest) => { if (!hit && typeof data === 'string' && data.startsWith('{"format":"bowerloom/managed-item-receipt/v1beta2"')) { hit = true; throw Error('PRIVATE_KILL'); } return write(fd, data, ...rest); }); syncBuiltinESMExports();
  await assert.rejects(applyManagedItem(null, run.req, run.plan.revision), code('MANAGED_SKILL_RECOVERY_REQUIRED')); restore(t); assert.equal(hit, true);
  assert.equal(fs.existsSync(path.join(op, 'receipt.json')), false); assert.equal(fs.statSync(path.join(op, '.receipt.json.tmp')).size, 0);
  assert.equal((await recover(run.req, run.plan, 'resume')).state, 'committed');
  assert.equal(fs.existsSync(path.join(op, '.receipt.json.tmp')), false); assert.equal(fs.existsSync(path.join(run.f.projectDir, MARKER)), false);
});

test('a lock probe that fails with anything but EADDRINUSE refuses, and never proceeds as held', async t => {
  const f = project(t); localSkill(f, 'house-style'); const req = request(f, { id: 'house-style', source: local('house-style') }), plan = await planManagedItem(req), before = inventory(f.projectDir);
  await hold(f.projectDir, async token => { for (const errno of ['EACCES', 'EADDRNOTAVAIL', 'EMFILE']) {
    t.mock.method(net.Server.prototype, 'listen', function () { process.nextTick(() => this.emit('error', Object.assign(new Error('PRIVATE_' + errno), { code: errno }))); return this; });
    await assert.rejects(applyManagedItem(token, req, plan.revision), e => e.code === 'MANAGED_SKILL_LOCK_NOT_HELD' && !e.message.includes('PRIVATE'), errno); restore(t);
    assert.deepEqual(fs.readdirSync(req.stateDir), [], errno); assert.deepEqual(inventory(f.projectDir), before, errno);
  } });
});

test('held lock: a real token whose probe binds the slot is LOCK_NOT_HELD, with no write', async t => {
  const f = project(t); localSkill(f, 'house-style'); const req = request(f, { id: 'house-style', source: local('house-style') }), plan = await planManagedItem(req), before = inventory(f.projectDir);
  await hold(f.projectDir, async held => {
    // The probe binds: nobody would hold the lock. The mock calls back without binding, so the real holder stays.
    t.mock.method(net.Server.prototype, 'listen', function (_options, callback) { process.nextTick(callback); return this; });
    await assert.rejects(applyManagedItem(held, req, plan.revision), code('MANAGED_SKILL_LOCK_NOT_HELD')); restore(t);
  });
  assert.deepEqual(fs.readdirSync(req.stateDir), []); assert.deepEqual(inventory(f.projectDir), before);
});

test('held lock: a slot that answers with another project banner is LOCK_SLOT_COLLISION, with no write', async t => {
  const f = project(t); localSkill(f, 'house-style'); const req = request(f, { id: 'house-style', source: local('house-style') }), plan = await planManagedItem(req), before = inventory(f.projectDir);
  const foreign = net.createServer(socket => { socket.on('error', () => {}); socket.end('bowerloom-project-lock/v1 ' + '0'.repeat(64) + '\n'); });
  await new Promise(resolve => foreign.listen({ host: '127.0.0.1', port: 0 }, resolve)); t.after(() => new Promise(resolve => foreign.close(resolve)));
  await hold(f.projectDir, async held => {
    // The slot is really taken (by this hold); the banner read is sent to the foreign server instead.
    const connect = net.connect; t.mock.method(net, 'connect', options => connect({ ...options, port: foreign.address().port }));
    await assert.rejects(applyManagedItem(held, req, plan.revision), e => e.code === 'MANAGED_SKILL_LOCK_SLOT_COLLISION' && e.message.includes(String(lockPort(f.projectDir)))); restore(t);
  });
  assert.deepEqual(fs.readdirSync(req.stateDir), []); assert.deepEqual(inventory(f.projectDir), before);
});

test('held lock: assertHeld that throws is LOCK_NOT_HELD, with no write', async t => {
  const f = project(t); localSkill(f, 'house-style'); const req = request(f, { id: 'house-style', source: local('house-style') }), plan = await planManagedItem(req), before = inventory(f.projectDir);
  let stale; await hold(f.projectDir, async held => { stale = held; });
  // A released token whose signal reads as live: only assertHeld can catch it, and the slot is re-held so the probe passes.
  await hold(f.projectDir, async () => {
    t.mock.getter(AbortSignal.prototype, 'aborted', () => false);
    let error; try { await applyManagedItem(stale, req, plan.revision); } catch (e) { error = e; } restore(t);
    assert.equal(error?.code, 'MANAGED_SKILL_LOCK_NOT_HELD');
  });
  assert.deepEqual(fs.readdirSync(req.stateDir), []); assert.deepEqual(inventory(f.projectDir), before);
});

test('a self-locking apply on a slot held by another program is LOCK_SLOT_COLLISION, with no write', async t => {
  const f = project(t); localSkill(f, 'house-style'); const req = request(f, { id: 'house-style', source: local('house-style') }), plan = await planManagedItem(req), before = inventory(f.projectDir);
  const port = lockPort(f.projectDir), blocker = net.createServer(socket => socket.destroy());
  await new Promise((resolve, reject) => { blocker.once('error', reject); blocker.listen({ host: '127.0.0.1', port, exclusive: true }, resolve); });
  try { await assert.rejects(applyManagedItem(null, req, plan.revision), e => e.code === 'MANAGED_SKILL_LOCK_SLOT_COLLISION' && e.message.includes(String(port))); }
  finally { await new Promise(resolve => blocker.close(resolve)); }
  assert.deepEqual(fs.readdirSync(req.stateDir), []); assert.deepEqual(inventory(f.projectDir), before);
});

test('held lock: a token whose project folder was replaced at the same path is LOCK_NOT_HELD, with no write (review F1)', async t => {
  const f = project(t); localSkill(f, 'house-style'); const req = request(f, { id: 'house-style', source: local('house-style') }), plan = await planManagedItem(req);
  const moved = f.projectDir + '-old'; t.after(() => fs.rmSync(moved, { recursive: true, force: true }));
  await hold(f.projectDir, async heldA => {
    const before = inventory(f.projectDir);
    fs.renameSync(f.projectDir, moved); fs.mkdirSync(f.projectDir, { mode: 0o700 });
    // Another writer holds the new folder's slot, so the port probe and banner both pass: only the key check can refuse.
    await hold(f.projectDir, async () => { await assert.rejects(applyManagedItem(heldA, req, plan.revision), code('MANAGED_SKILL_LOCK_NOT_HELD')); });
    assert.deepEqual(fs.readdirSync(f.projectDir), []); assert.deepEqual(inventory(moved), before); assert.deepEqual(fs.readdirSync(req.stateDir), []);
  });
});
