// Spec 06, 3.4 and test 15 of config-change: every path that creates .bowerloom or bowerloom.json calls
// adoptCreatedMarker with the identity of the item it created. The project layer publishes each call on a diagnostics
// channel; this file subscribes, so each path is checked directly, not only by its effect.
import test from '../../../dist/tests/support/lock-slot-retry.js';
import assert from 'node:assert/strict';
import { after } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { subscribe, unsubscribe } from 'node:diagnostics_channel';
import { denyNetwork, deps, noAcquirer, npmPackage, prefill } from './sync-fixture.mjs';
import { configWorld, writeConfig, storeItem, code } from './config-fixture.mjs';
import { ADOPT_MARKER_CHANNEL, withProjectLock, discoverProject } from '../../../dist/packages/project-context/src/index.js';
import { planSync, applySync, planProjectApply, applyProjectApply, planConfigChange, applyConfigChange, planAdopt, applyAdopt } from '../../../dist/packages/project-sync/src/index.js';
import { planCreate, applyCreate } from '../../../dist/packages/project-authoring/src/index.js';
import { planProjectAdd, writeProjectAdd } from '../../../dist/apps/cli/src/manifest.js';

const network = denyNetwork();
after(() => assert.deepEqual(network, [], 'no network'));
/** The marker calls made while `work` runs: [marker, device, inode] of each. */
async function calls(work) {
  const seen = [], listen = message => seen.push(message);
  subscribe(ADOPT_MARKER_CHANNEL, listen);
  try { await work(); } finally { unsubscribe(ADOPT_MARKER_CHANNEL, listen); }
  return seen;
}
const ctx = w => discoverProject(w.projectDir, w.home);
const lock = (w, work) => withProjectLock(w.projectDir, new AbortController().signal, work);
/** The device and inode of what is at `p` now. */
const id = p => { const s = fs.lstatSync(p, { bigint: true }); return [s.dev.toString(), s.ino.toString()]; };
function expectFolder(w, seen) {
  assert.equal(seen.length, 1, JSON.stringify(seen));
  assert.equal(seen[0].marker, 'folder'); assert.equal(seen[0].dir, w.projectDir);
  assert.deepEqual([seen[0].device, seen[0].inode], id(path.join(w.projectDir, '.bowerloom')));
}

test('skills sync in a config-only project calls adoptCreatedMarker(folder) with the new folder', async t => {
  const w = configWorld(t); await storeItem(w, 'skill', 'house-style'); writeConfig(w, { skills: [{ id: 'house-style', source: 'store' }] });
  const input = { project: ctx(w), stateRoot: w.stateRoot, home: w.home, team: null, offline: false };
  const plan = await planSync(input);
  expectFolder(w, await calls(() => applySync(input, plan.revision, deps(noAcquirer()))));
});

test('apply in a config-only project calls adoptCreatedMarker(folder) with the new folder', async t => {
  const w = configWorld(t); await storeItem(w, 'prompt', 'weekly-update'); writeConfig(w, { prompts: [{ id: 'weekly-update', source: 'store' }] });
  const input = { project: ctx(w), stateRoot: w.stateRoot, home: w.home, harnesses: ['claude', 'codex'], team: null };
  const plan = await planProjectApply(input);
  expectFolder(w, await calls(() => applyProjectApply(input, plan.revision, new AbortController().signal)));
});

for (const kind of ['skill', 'prompt', 'team']) test(`${kind} create in a config-only project calls adoptCreatedMarker(folder) with the new folder`, async t => {
  const w = configWorld(t); writeConfig(w, {});
  const input = kind === 'team' ? { kind, project: w.projectDir, name: 'research' } : { kind, project: w.projectDir, name: 'house-style', teams: [] };
  const plan = await planCreate(input);
  expectFolder(w, await calls(() => lock(w, held => applyCreate(input, plan.revision, held, undefined, ctx(w)))));
});

test('team adopt in a config-only project calls adoptCreatedMarker(folder) with the new folder', async t => {
  const w = configWorld(t); await storeItem(w, 'team', 'research'); writeConfig(w, { teams: [{ id: 'research', source: 'store' }] });
  const input = { project: ctx(w), home: w.home, stateRoot: w.stateRoot, id: 'research' }, plan = await planAdopt(input);
  expectFolder(w, await calls(() => lock(w, held => applyAdopt(input, plan, plan.revision, held))));
});

test('skills add in a config-only project calls adoptCreatedMarker(folder) with the new folder', async t => {
  const w = configWorld(t); writeConfig(w, {});
  const npm = npmPackage('db'), root = path.join(w.stateRoot, ctx(w).projectId);
  await prefill({ stateRoot: w.stateRoot, cacheRoot: w.cacheRoot, privateRoot: root, itemsRoot: path.join(root, 'items'), legacyCacheRoot: path.join(root, 'cache') }, npm);
  const plan = planProjectAdd(ctx(w), { add: npm.entry }, w.cacheRoot);
  assert.equal(plan.bowerloomFolder, 'create');
  expectFolder(w, await calls(() => lock(w, async held => writeProjectAdd(ctx(w), { add: npm.entry }, w.cacheRoot, plan.revision, held))));
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(w.projectDir, 'bowerloom.json'), 'utf8')).skills, [{ id: 'db', source: 'project' }]);
});

test('use that creates bowerloom.json calls adoptCreatedMarker(config) with the new file; use with a config calls none', async t => {
  const w = configWorld(t, { folder: true }); await storeItem(w, 'skill', 'house-style'); await storeItem(w, 'skill', 'other');
  const first = await planConfigChange({ project: ctx(w), home: w.home, op: 'use', kind: 'skill', id: 'house-style' });
  const seen = await calls(() => lock(w, async held => applyConfigChange(first, first.revision, held, ctx(w), w.home)));
  assert.equal(seen.length, 1); assert.equal(seen[0].marker, 'config');
  assert.deepEqual([seen[0].device, seen[0].inode], id(path.join(w.projectDir, 'bowerloom.json')));
  const second = await planConfigChange({ project: ctx(w), home: w.home, op: 'use', kind: 'skill', id: 'other' });
  assert.deepEqual(await calls(() => lock(w, async held => applyConfigChange(second, second.revision, held, ctx(w), w.home))), []);
  void code;
});
