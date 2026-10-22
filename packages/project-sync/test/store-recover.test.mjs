// Spec 06, section 10 (existing tests that change): skills recover finishes an interrupted install of a store-sourced
// skill, read again from the store folder the operation recorded.
import test from '../../../dist/tests/support/lock-slot-retry.js';
import assert from 'node:assert/strict';
import { after } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { syncBuiltinESMExports } from 'node:module';
import { denyNetwork, deps, noAcquirer } from './sync-fixture.mjs';
import { configWorld, writeConfig, storeItem, pushStore, lockOfRepo, writeLock, storeTransport, dropStore, code } from './config-fixture.mjs';
import { planSync, applySync, planItemRecovery, applyItemRecovery } from '../../../dist/packages/project-sync/src/index.js';
import { discoverProject } from '../../../dist/packages/project-context/src/index.js';

const network = denyNetwork();
after(() => assert.deepEqual(network, [], 'no network'));
const MARKER = '.bowerloom/managed-pending.json';
/** Runs one sync whose rename into `.agents/skills/<id>` fails, which leaves the operation for recovery. */
async function interrupted(t, w, d) {
  const input = { project: discoverProject(w.projectDir, w.home), stateRoot: w.stateRoot, home: w.home, team: null, offline: false };
  const rename = fs.renameSync, target = path.join(w.projectDir, '.agents/skills/house-style');
  t.mock.method(fs, 'renameSync', (from, to) => { if (String(to) === target) throw Object.assign(new Error('injected'), { code: 'EIO' }); return rename(from, to); }); syncBuiltinESMExports();
  try { await assert.rejects(applySync(input, (await planSync(input)).revision, d), code('MANAGED_SKILL_RECOVERY_REQUIRED')); }
  finally { t.mock.restoreAll(); syncBuiltinESMExports(); }
  assert.ok(fs.existsSync(path.join(w.projectDir, MARKER)));
  return input;
}
async function recover(w, input) {
  const r = { project: input.project, stateRoot: w.stateRoot, item: 'house-style', action: null };
  const plan = await planItemRecovery(r);
  const receipt = await applyItemRecovery(r, plan.revision);
  assert.equal(receipt.state, 'committed'); assert.equal(fs.existsSync(path.join(w.projectDir, MARKER)), false);
  return plan;
}

test('skills recover finishes an interrupted install from the live store', async t => {
  const w = configWorld(t, { folder: true }); await storeItem(w, 'skill', 'house-style'); writeConfig(w, { skills: [{ id: 'house-style', source: 'store' }] });
  const input = await interrupted(t, w, deps(noAcquirer()));
  const plan = await recover(w, input);
  assert.equal(plan.action, 'resume');
  assert.match(fs.readFileSync(path.join(w.projectDir, '.agents/skills/house-style/SKILL.md'), 'utf8'), /name: house-style/);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(w.projectDir, '.bowerloom/managed/catalog/house-style.json'), 'utf8')).source, { kind: 'store', path: 'skills/house-style' });
  const again = await planSync(input); assert.equal(again.items[0].state, 'up-to-date');
});

test('skills recover finishes an interrupted install of a skill fetched from the lock into the store cache', async t => {
  const w = configWorld(t, { folder: true }); await storeItem(w, 'skill', 'house-style'); writeConfig(w, { skills: [{ id: 'house-style', source: 'store' }] });
  const repo = pushStore(w); writeLock(w, { skills: [lockOfRepo(w, repo, 'skill', 'house-style')] }); dropStore(w);
  const input = await interrupted(t, w, deps(noAcquirer(), { storeTransport: storeTransport(repo) }));
  await recover(w, input);
  assert.ok(fs.existsSync(path.join(w.projectDir, '.agents/skills/house-style/SKILL.md')));
  assert.equal((await planSync(input)).items[0].state, 'up-to-date');
});
