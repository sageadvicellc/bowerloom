import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { syncBuiltinESMExports } from 'node:module';
import { planManagedItem, inspectManagedProject } from '../../../dist/packages/managed-skills/src/v2-observed.js';
import { applyManagedItem, planManagedItemRecovery, recoverManagedItem } from '../../../dist/packages/managed-skills/src/v2-transaction.js';
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

function lockPort(dir) { return 20000 + Number.parseInt(createHash('sha256').update(dir).digest('hex').slice(0, 8), 16) % 30000; }
async function holdPort(t, dir) { const server = net.createServer(s => s.destroy()); await new Promise((r, j) => { server.once('error', j); server.listen({ host: '127.0.0.1', port: lockPort(dir), exclusive: true }, r); }); t.after(() => new Promise(r => server.close(r))); return server; }
test('a caller-held project lock is required to be real and for this project', async t => {
  const f = project(t); localSkill(f, 'house-style'); const req = request(f, { id: 'house-style', source: local('house-style') }), plan = await planManagedItem(req);
  const token = (dir, ok = true) => ({ dir, signal: new AbortController().signal, assertHeld(d) { if (!ok || d !== dir) throw Object.assign(new Error('PROJECT_LOCKED'), { code: 'PROJECT_LOCKED' }); } });
  // Nobody holds the port, so the token cannot be real.
  await assert.rejects(applyManagedItem(token(f.projectDir), req, plan.revision), code('MANAGED_SKILL_LOCK_NOT_HELD'));
  const server = await holdPort(t, f.projectDir);
  await assert.rejects(applyManagedItem(token(f.projectDir, false), req, plan.revision), code('MANAGED_SKILL_LOCK_NOT_HELD'));
  await assert.rejects(applyManagedItem(token(f.base), req, plan.revision), code('MANAGED_SKILL_LOCK_NOT_HELD'));
  await assert.rejects(applyManagedItem(null, req, plan.revision), code('MANAGED_SKILL_LOCKED'));
  const aborted = new AbortController(); aborted.abort();
  await assert.rejects(applyManagedItem({ ...token(f.projectDir), signal: aborted.signal }, req, plan.revision), code('MANAGED_SKILL_ABORTED'));
  assert.deepEqual(fs.readdirSync(req.stateDir), []);
  assert.equal((await applyManagedItem(token(f.projectDir), req, plan.revision)).state, 'committed'); assert.ok(server.listening);
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

/** Throws at one numbered journal-record or rename boundary, and records every boundary in order. */
function boundaries(t, crash = null) {
  const events = [], write = fs.writeFileSync, rename = fs.renameSync; let n = 0;
  const step = (event, run) => {
    const i = n++; events.push(event);
    if (crash && crash.index === i && crash.when === 'before') throw Error('PRIVATE_CRASH_BEFORE');
    const result = run();
    if (crash && crash.index === i && crash.when === 'after') throw Error('PRIVATE_CRASH_AFTER');
    return result;
  };
  t.mock.method(fs, 'writeFileSync', (fd, data, ...rest) => typeof data === 'string' && data.startsWith('{"sequence":') ? step({ type: 'record', ...JSON.parse(data) }, () => write(fd, data, ...rest)) : write(fd, data, ...rest));
  t.mock.method(fs, 'renameSync', (from, to) => step({ type: 'rename', from: String(from), to: String(to) }, () => rename(from, to)));
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
  for (const i of selected) { points.push({ index: i, when: 'after' }); if (events[i].type === 'rename') points.push({ index: i, when: 'before' }); }
  const tally = { held: 0, resume: 0, rollback: 0 }, labels = [];
  for (const point of points) {
    const event = events[point.index], label = `${point.when} ${event.type === 'rename' ? 'rename ' + path.basename(event.from) + ' -> ' + path.basename(event.to) : event.kind + ' ' + JSON.stringify(event.data).slice(0, 80)}`;
    // A crash before every stage is ready, or between a parent intent and its stamp, is held as in v1.
    const held = point.index < lastStage || event.kind === 'PARENT_INTENT';
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
  assert.ok(tally.resume >= (update ? 7 : 6) && tally.resume === tally.rollback);
});

test('a substituted stage and a changed recovery approval are refused without repair', async t => {
  const run = await scenario(t, false), rename = fs.renameSync; let hit = false;
  t.mock.method(fs, 'renameSync', (from, to) => { if (!hit) { hit = true; throw Error('before first rename'); } return rename(from, to); }); syncBuiltinESMExports();
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
  const run = await scenario(t, false), open = fs.openSync, fsync = fs.fsyncSync, receipt = path.join(run.req.stateDir, 'op-' + run.plan.operationKey, 'receipt.json'); let fd, hit = false;
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
