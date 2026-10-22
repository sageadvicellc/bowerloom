// Decision 1 on sageadvicellc/bowerloom#80 (comment 6351449744), variant A: team adopt also takes a store team that
// bowerloom.json does not list yet. One approved plan copies the team and lists it as a project item.
import test from '../../../dist/tests/support/lock-slot-retry.js';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { configWorld, writeConfig, writeLock, storeItem, pushStore, lockOfRepo, code } from '../../project-sync/test/config-fixture.mjs';
import { planAdopt, applyAdopt } from '../../../dist/packages/project-sync/src/index.js';
import { withProjectLock, discoverProject } from '../../../dist/packages/project-context/src/index.js';
import { canonicalJson } from '../../../dist/packages/contracts/src/index.js';

const readJson = (w, rel) => JSON.parse(fs.readFileSync(path.join(w.projectDir, rel), 'utf8'));
const input = (w, id = 'research') => ({ project: discoverProject(w.projectDir, w.home), home: w.home, stateRoot: w.stateRoot, id });
const applyPlan = (w, plan) => withProjectLock(w.projectDir, new AbortController().signal, held => applyAdopt(input(w), plan, plan.revision, held));
async function world(t, { folder = false, config = true } = {}) {
  const w = configWorld(t, { folder });
  await storeItem(w, 'team', 'research'); await storeItem(w, 'skill', 'notes', { teams: ['research'] }); await storeItem(w, 'prompt', 'brief', { teams: ['research'] });
  await storeItem(w, 'skill', 'shared-notes');
  if (config) writeConfig(w);
  return w;
}

test('fix 1. an unlisted store team: one plan copies it and lists it from the project; tagged store items stay in the store', async t => {
  const w = await world(t);
  const plan = await planAdopt(input(w));
  assert.equal(plan.from, 'store'); assert.equal(plan.finishing, false); assert.notEqual(plan.create, null);
  assert.deepEqual(plan.config.adds, [{ kind: 'team', id: 'research', source: 'project', via: [] }]);
  assert.equal(plan.config.created, false); assert.equal(plan.config.lock, null); assert.deepEqual(plan.config.network.hosts, []);
  // Store skills and prompts tagged to the team are named, not picked. An untagged store skill is not named.
  assert.deepEqual(plan.storeOnly, ['prompt brief', 'skill notes']);
  assert.equal(plan.revision, createHash('sha256').update(canonicalJson({ create: plan.create.revision, config: plan.config.revision, storeOnly: plan.storeOnly })).digest('hex'));
  const result = await applyPlan(w, plan);
  assert.deepEqual(readJson(w, 'bowerloom.json').teams, [{ id: 'research', source: 'project' }]);
  assert.deepEqual([readJson(w, 'bowerloom.json').skills, readJson(w, 'bowerloom.json').prompts], [[], []]);
  assert.ok(fs.existsSync(path.join(w.projectDir, '.bowerloom/teams/research/team.yaml')));
  assert.equal(fs.existsSync(path.join(w.projectDir, 'bowerloom.lock.json')), false);
  assert.deepEqual(result.receipt.items.map(i => [i.kind, i.id, i.teams]), [['team', 'research', []]]);
  // Adopted once, the team is a project item: a second adopt keeps today's refusal.
  await assert.rejects(planAdopt(input(w)), code('CONFIG_ITEM_NOT_SELECTED'));
});

test('fix 1. a legacy project with no bowerloom.json: the plan creates it, lists what the project defines, and adds the team', async t => {
  const w = await world(t, { folder: true, config: false });
  const plan = await planAdopt(input(w));
  assert.equal(plan.config.created, true); assert.equal(plan.config.bowerloomFolder, 'present');
  await applyPlan(w, plan);
  const config = readJson(w, 'bowerloom.json');
  assert.deepEqual(config.teams, [{ id: 'research', source: 'project' }]);
});

test('fix 1. a project with a lock: the lock stays as it is, and the plan reads no network', async t => {
  const w = await world(t), repo = pushStore(w);
  writeConfig(w, { skills: [{ id: 'shared-notes', source: 'store' }] });
  const lock = writeLock(w, { skills: [lockOfRepo(w, repo, 'skill', 'shared-notes')] });
  const plan = await planAdopt(input(w));
  assert.deepEqual(plan.config.lock.adds, []); assert.deepEqual(plan.config.lock.removes, []); assert.deepEqual(plan.config.network.hosts, []);
  await applyPlan(w, plan);
  assert.equal(fs.readFileSync(path.join(w.projectDir, 'bowerloom.lock.json'), 'utf8'), lock);
  assert.deepEqual(readJson(w, 'bowerloom.json').skills, [{ id: 'shared-notes', source: 'store' }]);
});

test('fix 1. an id the store does not define refuses STORE_ITEM_NOT_FOUND; with no store, STORE_NOT_FOUND', async t => {
  const w = await world(t);
  await assert.rejects(planAdopt(input(w, 'ops')), code('STORE_ITEM_NOT_FOUND'));
  fs.renameSync(w.store, path.join(w.base, 'store-moved'));
  await assert.rejects(planAdopt(input(w)), code('STORE_NOT_FOUND'));
  assert.equal(fs.existsSync(path.join(w.projectDir, '.bowerloom')), false);
});

test('fix 1. an unlisted adopt that stopped after the receipt finishes with only the config write', async t => {
  const w = await world(t);
  const plan = await planAdopt(input(w));
  const original = fs.renameSync;
  fs.renameSync = (from, to) => { if (String(to).endsWith('bowerloom.json')) throw new Error('crash'); return original(from, to); };
  try { await assert.rejects(applyPlan(w, plan), /crash/); } finally { fs.renameSync = original; }
  assert.deepEqual(readJson(w, 'bowerloom.json').teams, []);
  const again = await planAdopt(input(w));
  assert.equal(again.finishing, true); assert.equal(again.create, null);
  await applyPlan(w, again);
  assert.deepEqual(readJson(w, 'bowerloom.json').teams, [{ id: 'research', source: 'project' }]);
});

test('fix 1. an unlisted adopt that stopped after the move and before the receipt finishes through the pending record', async t => {
  const w = await world(t);
  const plan = await planAdopt(input(w));
  const link = fs.linkSync, rename = fs.renameSync, crash = to => String(to).endsWith(path.join('authoring', 'receipt.json'));
  fs.linkSync = (from, to) => { if (crash(to)) throw new Error('crash'); return link(from, to); };
  fs.renameSync = (from, to) => { if (crash(to)) throw new Error('crash'); return rename(from, to); };
  try { await assert.rejects(applyPlan(w, plan), /crash/); } finally { fs.linkSync = link; fs.renameSync = rename; }
  assert.ok(fs.existsSync(path.join(w.projectDir, '.bowerloom/authoring/pending.json')));
  assert.ok(fs.existsSync(path.join(w.projectDir, '.bowerloom/teams/research/team.yaml')));
  const again = await planAdopt(input(w));
  await applyPlan(w, again);
  assert.deepEqual(readJson(w, 'bowerloom.json').teams, [{ id: 'research', source: 'project' }]);
  assert.equal(fs.existsSync(path.join(w.projectDir, '.bowerloom/authoring/pending.json')), false);
});
