import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { syncBuiltinESMExports } from 'node:module';
import { planObservedManagedSkill, inspectObservedManagedSkill } from '../../../dist/packages/managed-skills/src/observed.js';
import { applyObservedManagedSkill, planObservedManagedSkillRecovery, recoverObservedManagedSkill } from '../../../dist/packages/managed-skills/src/transaction.js';
import { planManagedItem, inspectManagedProject } from '../../../dist/packages/managed-skills/src/v2-observed.js';
import { applyManagedItem, planManagedItemRecovery, recoverManagedItem } from '../../../dist/packages/managed-skills/src/v2-transaction.js';
import { project, cacheSkill, localSkill, request, local, cached, inventory, exactInventory, code } from './v2-fixture.mjs';

function restore(t) { t.mock.restoreAll(); syncBuiltinESMExports(); }
async function legacy(t, harness = 'codex') {
  const f = project(t), cache = await cacheSkill(f), v1State = path.join(f.base, 'v1-state'); fs.mkdirSync(v1State, { mode: 0o700 });
  const v1 = { operation: 'install', projectDir: f.projectDir, stateDir: v1State, harness, cache: cache.selector, expectedPreviousRevision: null, minFreeBytes: 33554432 };
  const v1Plan = await planObservedManagedSkill(v1), v1Receipt = await applyObservedManagedSkill(v1, v1Plan.revision, null);
  const migrate = request(f, { id: 'collections', source: cached(cache.selector), operation: 'migrate', legacy: { stateDir: v1State, operationKey: v1Plan.operationKey } });
  return { f, cache, v1State, v1, v1Plan, v1Receipt, migrate };
}
const v1Inspect = l => inspectObservedManagedSkill({ projectDir: l.f.projectDir, stateDir: l.v1State });

test('after a v1 install, v1 inspect still works and every v2 plan except migrate refuses with LEGACY_PRESENT', async t => {
  const l = await legacy(t); localSkill(l.f, 'house-style');
  const seen = await v1Inspect(l); assert.equal(seen.status, 'committed'); assert.equal(seen.receipt.revision, l.v1Receipt.revision);
  const before = inventory(l.f.projectDir);
  await assert.rejects(planManagedItem(request(l.f, { id: 'collections', source: cached(l.cache.selector) })), code('MANAGED_SKILL_LEGACY_PRESENT'));
  await assert.rejects(planManagedItem(request(l.f, { id: 'house-style', source: local('house-style') })), code('MANAGED_SKILL_LEGACY_PRESENT'));
  assert.equal(inspectManagedProject(l.f.projectDir, l.f.itemsRoot).legacy, true);
  assert.deepEqual(inventory(l.f.projectDir), before);
});

for (const harness of ['codex', 'claude']) test(`${harness}: migrate apply reaches v2 and leaves the v1 state folder byte-identical`, async t => {
  const l = await legacy(t, harness), v1StateBefore = exactInventory(l.v1State), projection = path.join(l.f.projectDir, harness === 'codex' ? '.agents' : '.claude', 'skills/synthetic-collections');
  const projectionBytes = inventory(projection, { inodes: false });
  const plan = await planManagedItem(l.migrate);
  assert.deepEqual(plan.core.before.map(s => [s.id, path.relative(l.f.projectDir, s.path), s.pins === null]), [
    ['ignore', '.bowerloom/managed/.gitignore', true],
    ['canonical', '.bowerloom/managed/skills/collections', true],
    ['projection-claude', '.claude/skills/synthetic-collections', harness !== 'claude'],
    ['projection-codex', '.agents/skills/synthetic-collections', harness !== 'codex'],
    ['catalog', '.bowerloom/managed/catalog/collections.json', true],
    ['legacy', '.bowerloom-skills', false],
  ]);
  const receipt = await applyManagedItem(null, l.migrate, plan.revision);
  assert.equal(receipt.state, 'committed');
  assert.deepEqual(receipt.migratedFrom, { format: 'bowerloom/observed-managed-skill-receipt/v1beta1', stateDir: l.v1State, operationKey: l.v1Plan.operationKey, revision: l.v1Receipt.revision });
  assert.equal(fs.existsSync(path.join(l.f.projectDir, '.bowerloom-skills')), false);
  assert.deepEqual(inventory(projection, { inodes: false }), projectionBytes);
  assert.deepEqual(exactInventory(l.v1State), v1StateBefore);
  assert.equal((await v1Inspect(l)).status, 'absent'); assert.deepEqual(exactInventory(l.v1State), v1StateBefore);
  const inspection = inspectManagedProject(l.f.projectDir, l.f.itemsRoot); assert.equal(inspection.legacy, false); assert.deepEqual(inspection.items.map(i => i.status), ['committed']);
  const again = await planManagedItem({ ...l.migrate, operation: 'update', legacy: null, expectedPreviousRevision: receipt.revision }); assert.equal(again.status, 'up-to-date');
});

test('migrate rollback restores the v1 bytes and identities', async t => {
  const l = await legacy(t), before = inventory(l.f.projectDir), v1StateBefore = exactInventory(l.v1State), plan = await planManagedItem(l.migrate), rename = fs.renameSync; let hit = false;
  t.mock.method(fs, 'renameSync', (from, to) => { rename(from, to); if (!hit && String(from) === path.join(l.f.projectDir, '.bowerloom-skills')) { hit = true; throw Error('PRIVATE_AFTER_LEGACY'); } }); syncBuiltinESMExports();
  await assert.rejects(applyManagedItem(null, l.migrate, plan.revision), code('MANAGED_SKILL_RECOVERY_REQUIRED')); restore(t); assert.equal(hit, true);
  assert.equal(fs.existsSync(path.join(l.f.projectDir, '.bowerloom-skills')), false);
  const recovery = await planManagedItemRecovery({ projectDir: l.f.projectDir, stateDir: l.migrate.stateDir, operationKey: plan.operationKey, action: 'rollback' });
  const result = await recoverManagedItem(recovery, recovery.revision); assert.equal(result.state, 'rolled-back');
  assert.deepEqual(inventory(l.f.projectDir), before); assert.deepEqual(exactInventory(l.v1State), v1StateBefore);
  const seen = await v1Inspect(l); assert.equal(seen.status, 'committed'); assert.equal(seen.receipt.revision, l.v1Receipt.revision);
  // The next migrate plan starts from the same v1 install.
  assert.equal((await planManagedItem(l.migrate)).core.before.at(-1).id, 'legacy');
});

test('a pending v1 operation still recovers through v1 recovery, then migrates', async t => {
  const f = project(t), cache = await cacheSkill(f), v1State = path.join(f.base, 'v1-state'); fs.mkdirSync(v1State, { mode: 0o700 });
  const v1 = { operation: 'install', projectDir: f.projectDir, stateDir: v1State, harness: 'codex', cache: cache.selector, expectedPreviousRevision: null, minFreeBytes: 33554432 };
  const v1Plan = await planObservedManagedSkill(v1), rename = fs.renameSync; let hit = false;
  t.mock.method(fs, 'renameSync', (from, to) => { if (!hit) { hit = true; throw Error('interrupted'); } return rename(from, to); });
  await assert.rejects(applyObservedManagedSkill(v1, v1Plan.revision, null)); restore(t);
  const migrate = request(f, { id: 'collections', source: cached(cache.selector), operation: 'migrate', legacy: { stateDir: v1State, operationKey: v1Plan.operationKey } });
  await assert.rejects(planManagedItem(request(f, { id: 'collections', source: cached(cache.selector) })), code('MANAGED_SKILL_LEGACY_PRESENT'));
  await assert.rejects(planManagedItem(migrate)); assert.deepEqual(fs.readdirSync(migrate.stateDir), []);
  const recovery = await planObservedManagedSkillRecovery({ projectDir: f.projectDir, stateDir: v1State, operationKey: v1Plan.operationKey, action: 'resume' });
  assert.equal((await recoverObservedManagedSkill(recovery, recovery.revision)).state, 'committed');
  const plan = await planManagedItem(migrate); assert.equal((await applyManagedItem(null, migrate, plan.revision)).state, 'committed');
});

test('migrate refuses a drifted v1 install, a different pin, a different item and a missing v1 harness', async t => {
  const l = await legacy(t), v2 = await cacheSkill(l.f, { version: '2.0.0', operationId: 'c'.repeat(32) });
  const before = inventory(l.f.projectDir);
  await assert.rejects(planManagedItem({ ...l.migrate, source: cached(v2.selector) }));
  await assert.rejects(planManagedItem({ ...l.migrate, harnesses: ['claude'] }));
  await assert.rejects(planManagedItem({ ...l.migrate, legacy: { ...l.migrate.legacy, operationKey: 'f'.repeat(64) } }));
  const other = await cacheSkill(l.f, { operationId: 'd'.repeat(32), id: 'other', name: 'other' });
  await assert.rejects(planManagedItem(request(l.f, { id: 'other', source: cached(other.selector), operation: 'migrate', legacy: l.migrate.legacy })));
  assert.deepEqual(inventory(l.f.projectDir), before);
  fs.appendFileSync(path.join(l.f.projectDir, '.agents/skills/synthetic-collections/SKILL.md'), 'Local change.\n');
  await assert.rejects(planManagedItem(l.migrate));
  for (const n of fs.readdirSync(l.f.itemsRoot)) assert.deepEqual(fs.readdirSync(path.join(l.f.itemsRoot, n)), []);
});
