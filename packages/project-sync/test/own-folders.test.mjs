// Round 7 of the reviews of PR 101, item 3: a run makes the shared state folders before phase A and this project's own
// folders after it. A folder that changes between the two parts refuses SKILLS_STATE_UNSAFE before any project write, and
// the refusal keeps the system error as a cause that no output prints.
import test from '../../../dist/tests/support/lock-slot-retry.js';
import assert from 'node:assert/strict';
import { after } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { denyNetwork, npmPackage, fakeAcquirer, exactTree } from './sync-fixture.mjs';
import { configWorld, writeConfig, writeLock, storeItem, storePin, pushStore, lockOfRepo, storeTransport, dropStore } from './config-fixture.mjs';
import { planProjectApply, applyProjectApply } from '../../../dist/packages/project-sync/src/index.js';

const network = denyNetwork();
after(() => assert.deepEqual(network, [], 'every fetch in this file goes to a fake'));
const input = w => ({ project: w.project(), stateRoot: w.stateRoot, home: w.home, harnesses: ['claude', 'codex'], team: null, frozen: true });
const signal = () => new AbortController().signal;

/** A teammate's clone whose lock holds a written skill and a pin; the store is gone. */
async function clone(t) {
  const w = configWorld(t, { folder: true }), npm = npmPackage('tanstack-db');
  await storeItem(w, 'skill', 'house-style'); await storeItem(w, 'prompt', 'weekly-update'); storePin(w, npm.entry);
  writeConfig(w, { skills: [{ id: 'house-style', source: 'store' }, { id: 'tanstack-db', source: 'store' }], prompts: [{ id: 'weekly-update', source: 'store' }] });
  const repo = pushStore(w);
  writeLock(w, { skills: [lockOfRepo(w, repo, 'skill', 'house-style'), { id: 'tanstack-db', from: 'store', pin: npm.entry }], prompts: [lockOfRepo(w, repo, 'prompt', 'weekly-update')] });
  dropStore(w);
  return { w, npm, repo };
}
/** The fake acquirer, with `hook` run inside phase A, before the pin is stored. */
function hooked(npm, hook) { const inner = fakeAcquirer([npm]); return { npm: async (...a) => { hook(); return inner.npm(...a); }, git: inner.git }; }

test('own folders made by someone else during phase A refuse SKILLS_STATE_UNSAFE, and no project file is written', async t => {
  const { w, npm, repo } = await clone(t), plan = await planProjectApply(input(w));
  const own = path.join(w.stateRoot, w.project().projectId);
  assert.equal(fs.existsSync(own), false, 'a first run: the own folders do not exist yet');
  const before = exactTree(w.projectDir);
  await assert.rejects(applyProjectApply(input(w), plan.revision, signal(), { acquirer: hooked(npm, () => fs.mkdirSync(own, { mode: 0o700 })), storeTransport: storeTransport(repo) }),
    e => e.code === 'SKILLS_STATE_UNSAFE' && e.message.endsWith('Bowerloom fetched the pins into the shared cache before this check, and nothing in the project changed.') && e.cause !== undefined && !Object.keys(e).includes('cause'));
  assert.equal(exactTree(w.projectDir), before, 'no project file was written');
});

test('own folders swapped during phase A, on a run where they exist, refuse SKILLS_STATE_UNSAFE before any project write', async t => {
  const { w, npm, repo } = await clone(t);
  // A first run with the written skill only makes the own folders.
  const lock = JSON.parse(fs.readFileSync(path.join(w.projectDir, 'bowerloom.lock.json'), 'utf8')), config = JSON.parse(fs.readFileSync(path.join(w.projectDir, 'bowerloom.json'), 'utf8'));
  writeConfig(w, { skills: [{ id: 'house-style', source: 'store' }], prompts: config.prompts });
  writeLock(w, { skills: lock.skills.filter(i => i.id === 'house-style'), prompts: lock.prompts });
  const first = await planProjectApply(input(w));
  await applyProjectApply(input(w), first.revision, signal(), { acquirer: fakeAcquirer([npm]), storeTransport: storeTransport(repo) });
  // The pin joins: phase A fetches it on a run where the own folders exist.
  writeConfig(w, { skills: config.skills, prompts: config.prompts }); writeLock(w, { skills: lock.skills, prompts: lock.prompts });
  const items = path.join(w.stateRoot, w.project().projectId, 'items');
  const plan = await planProjectApply(input(w)), before = exactTree(w.projectDir);
  const swap = () => { fs.renameSync(items, `${items}.old`); fs.mkdirSync(items, { mode: 0o700 }); };
  await assert.rejects(applyProjectApply(input(w), plan.revision, signal(), { acquirer: hooked(npm, swap), storeTransport: storeTransport(repo) }), e => e.code === 'SKILLS_STATE_UNSAFE');
  assert.equal(exactTree(w.projectDir), before, 'no project file was written');
});

test('a shared folder swapped during phase A refuses SKILLS_STATE_UNSAFE before the own folders and any project write', async t => {
  const { w, npm, repo } = await clone(t), plan = await planProjectApply(input(w)), before = exactTree(w.projectDir);
  const storeCache = path.join(w.stateRoot, 'store-cache');
  const swap = () => { fs.renameSync(storeCache, `${storeCache}.old`); fs.mkdirSync(storeCache, { mode: 0o700 }); };
  await assert.rejects(applyProjectApply(input(w), plan.revision, signal(), { acquirer: hooked(npm, swap), storeTransport: storeTransport(repo) }), e => e.code === 'SKILLS_STATE_UNSAFE');
  assert.equal(fs.existsSync(path.join(w.stateRoot, w.project().projectId)), false, 'the own folders were not made');
  assert.equal(exactTree(w.projectDir), before, 'no project file was written');
});
