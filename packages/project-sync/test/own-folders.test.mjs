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
import { planProjectApply, applyProjectApply, planSync, applySync } from '../../../dist/packages/project-sync/src/index.js';
import { fetchedInto } from '../../../dist/packages/project-sync/src/apply.js';

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
// Round 8: the words of a refusal after phase A fetched the pin into the skills cache and the store items into the store cache.
// Round 9: the clone's written skill and its prompt carry notices that the plan binds, and a fetch reads them, so the plan
// changed and the step plans again. A pin alone never changes it (see the round 9 tests below).
const REPLAN = 'Check the private state folder: $XDG_STATE_HOME/bowerloom when XDG_STATE_HOME is set, else ~/.local/state/bowerloom. Then run the command again without --approve, to see a new plan.';
const AFTER_FETCH = "Before this check, this run fetched into this machine's skills cache and the store cache. Nothing in the project changed.";
/** The fake acquirer, with `hook` run inside phase A, before the pin is stored. */
function hooked(npm, hook) { const inner = fakeAcquirer([npm]); return { npm: async (...a) => { hook(); return inner.npm(...a); }, git: inner.git }; }

test('own folders made by someone else during phase A refuse SKILLS_STATE_UNSAFE, and no project file is written', async t => {
  const { w, npm, repo } = await clone(t), plan = await planProjectApply(input(w));
  const own = path.join(w.stateRoot, w.project().projectId);
  assert.equal(fs.existsSync(own), false, 'a first run: the own folders do not exist yet');
  const before = exactTree(w.projectDir);
  await assert.rejects(applyProjectApply(input(w), plan.revision, signal(), { acquirer: hooked(npm, () => fs.mkdirSync(own, { mode: 0o700 })), storeTransport: storeTransport(repo) }),
    e => e.code === 'SKILLS_STATE_UNSAFE' && e.message.endsWith(AFTER_FETCH) && e.cause !== undefined && !Object.keys(e).includes('cause') && e.next === REPLAN);
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
  // Round 8: the refusal is the one after phase A (it names the fetch), so it cannot pass on a refusal at fetch time.
  await assert.rejects(applyProjectApply(input(w), plan.revision, signal(), { acquirer: hooked(npm, swap), storeTransport: storeTransport(repo) }),
    e => e.code === 'SKILLS_STATE_UNSAFE' && e.message.endsWith("Before this check, this run fetched into this machine's skills cache. Nothing in the project changed."));
  assert.equal(fs.existsSync(path.join(items, 'tanstack-db')), false, 'no folder was made in the swapped items');
  assert.equal(exactTree(w.projectDir), before, 'no project file was written');
});

test('a shared folder swapped during phase A refuses SKILLS_STATE_UNSAFE before the own folders and any project write', async t => {
  const { w, npm, repo } = await clone(t), plan = await planProjectApply(input(w)), before = exactTree(w.projectDir);
  const storeCache = path.join(w.stateRoot, 'store-cache');
  const swap = () => { fs.renameSync(storeCache, `${storeCache}.old`); fs.mkdirSync(storeCache, { mode: 0o700 }); };
  await assert.rejects(applyProjectApply(input(w), plan.revision, signal(), { acquirer: hooked(npm, swap), storeTransport: storeTransport(repo) }), e => e.code === 'SKILLS_STATE_UNSAFE' && e.message.endsWith(AFTER_FETCH));
  assert.equal(fs.existsSync(path.join(w.stateRoot, w.project().projectId)), false, 'the own folders were not made');
  assert.equal(exactTree(w.projectDir), before, 'no project file was written');
});

/** Runs `work` with fs.mkdirSync failing ENOSPC for `target` only. */
async function noSpaceFor(target, work) {
  const real = fs.mkdirSync;
  fs.mkdirSync = (p, ...rest) => { if (p === target) throw Object.assign(new Error(`ENOSPC: no space left on device, mkdir '${p}'`), { code: 'ENOSPC', errno: -28, syscall: 'mkdir', path: p }); return real(p, ...rest); };
  try { return await work(); } finally { fs.mkdirSync = real; }
}

// Round 8, item 3: with every pin already cached, the refusal says nothing about a fetch, and it names the system error.
test('pins already cached: a system error at the own folders names its code and no fetch, and the same --approve then applies', async t => {
  const { w, npm, repo } = await clone(t), plan = await planProjectApply(input(w)), own = path.join(w.stateRoot, w.project().projectId);
  const deps = () => ({ acquirer: fakeAcquirer([npm]), storeTransport: storeTransport(repo) });
  // The first run fetches every pin and item, then cannot make the own folders. The written skill and the prompt are in
  // the store cache now, and the plan binds their notices, so the plan changed.
  await noSpaceFor(own, () => assert.rejects(applyProjectApply(input(w), plan.revision, signal(), deps()),
    e => e.code === 'SKILLS_STATE_UNSAFE' && e.message.endsWith(`A folder step failed with a system error (ENOSPC). ${AFTER_FETCH}`) && e.next === REPLAN));
  await assert.rejects(applyProjectApply(input(w), plan.revision, signal(), deps()), e => e.code === 'STALE_APPROVAL', 'the same --approve no longer matches');
  // Every pin is cached: the refusal names no fetch, and its step is the default one.
  const cached = await planProjectApply(input(w)), before = exactTree(w.projectDir);
  assert.notEqual(cached.revision, plan.revision);
  await noSpaceFor(own, () => assert.rejects(applyProjectApply(input(w), cached.revision, signal(), deps()),
    e => e.code === 'SKILLS_STATE_UNSAFE' && e.message.endsWith(' A folder step failed with a system error (ENOSPC). Nothing in the project changed.') && !/fetched/.test(e.message) && e.next === undefined && e.cause?.code === 'ENOSPC'));
  assert.equal(exactTree(w.projectDir), before, 'no project file was written');
  assert.equal(fs.existsSync(own), false, 'no own folder was left');
  // Nothing changed what the plan binds, so the same --approve applies.
  assert.equal((await planProjectApply(input(w))).revision, cached.revision);
  await applyProjectApply(input(w), cached.revision, signal(), deps());
});

// Round 8, item 3: a run that made the state root and then failed changed the plan, so the step says to plan again.
test('an own folder left by a failed run: the step runs the command again without --approve, and that lifts it', async t => {
  const { w, npm, repo } = await clone(t), own = path.join(w.stateRoot, w.project().projectId);
  const deps = () => ({ acquirer: fakeAcquirer([npm]), storeTransport: storeTransport(repo) });
  // Every pin is cached first, so only the folder the run left changes the plan.
  const fetching = await planProjectApply(input(w));
  await noSpaceFor(own, () => assert.rejects(applyProjectApply(input(w), fetching.revision, signal(), deps()), e => e.code === 'SKILLS_STATE_UNSAFE'));
  const plan = await planProjectApply(input(w));
  await noSpaceFor(path.join(own, 'items'), () => assert.rejects(applyProjectApply(input(w), plan.revision, signal(), deps()),
    e => e.code === 'SKILLS_STATE_UNSAFE' && e.message.includes('(ENOSPC)') && e.next === REPLAN));
  assert.equal(fs.existsSync(own), true, 'the state root of the project was left');
  // The same --approve no longer matches; a new plan applies.
  await assert.rejects(applyProjectApply(input(w), plan.revision, signal(), deps()), e => e.code === 'STALE_APPROVAL');
  const again = await planProjectApply(input(w));
  assert.notEqual(again.revision, plan.revision);
  await applyProjectApply(input(w), again.revision, signal(), deps());
});

// Round 9 of the reviews of PR 101, item 1 (variant A): the step plans again only when the run changed what the plan
// binds. The revision drops whether a pin is cached, and whether a store-only prompt or team is in the store cache. It
// keeps the notices of a written skill, and of a prompt that bowerloom apply installs, which a fetch reads.
async function oneKind(t, kind) {
  const w = configWorld(t, { folder: true }), npm = npmPackage('tanstack-db');
  await storeItem(w, 'prompt', 'unused');
  const config = { skills: [], prompts: [], teams: [] }, lock = { skills: [], prompts: [], teams: [] };
  if (kind === 'pin') { storePin(w, npm.entry); config.skills.push({ id: 'tanstack-db', source: 'store' }); }
  if (kind === 'written') { await storeItem(w, 'skill', 'house-style'); config.skills.push({ id: 'house-style', source: 'store' }); }
  if (kind === 'prompt') { await storeItem(w, 'prompt', 'weekly-update'); config.prompts.push({ id: 'weekly-update', source: 'store' }); }
  if (kind === 'team') { await storeItem(w, 'team', 'research'); config.teams.push({ id: 'research', source: 'store' }); }
  writeConfig(w, config);
  const repo = pushStore(w);
  if (kind === 'pin') lock.skills.push({ id: 'tanstack-db', from: 'store', pin: npm.entry });
  if (kind === 'written') lock.skills.push(lockOfRepo(w, repo, 'skill', 'house-style'));
  if (kind === 'prompt') lock.prompts.push(lockOfRepo(w, repo, 'prompt', 'weekly-update'));
  if (kind === 'team') lock.teams.push(lockOfRepo(w, repo, 'team', 'research'));
  writeLock(w, lock); dropStore(w);
  return { w, deps: () => ({ acquirer: fakeAcquirer([npm]), storeTransport: storeTransport(repo) }) };
}
const FLOWS = {
  'apply --frozen': { plan: w => planProjectApply(input(w)), apply: (w, rev, d) => applyProjectApply(input(w), rev, signal(), d) },
  'skills sync --frozen': { plan: w => planSync(syncInput(w, true)), apply: (w, rev, d) => applySync(syncInput(w, true), rev, { ...d, signal: signal() }) },
  'skills sync': { plan: w => planSync(syncInput(w, false)), apply: (w, rev, d) => applySync(syncInput(w, false), rev, { ...d, signal: signal() }) },
};
function syncInput(w, frozen) { return { project: w.project(), stateRoot: w.stateRoot, home: w.home, team: null, offline: false, frozen }; }
// [flow, kind, the fetch words, whether the plan changed]. skills sync of a team fetches nothing, so it has no row.
// No plain apply row: plain apply never fetches, because its plan names no host. No up --team row: up's apply step is a
// plain apply, and its sync step is skills sync with a team filter, the same applySync path as the skills sync rows.
// No up end-to-end test: the up fixture has no hook that fails a folder between phase A and the own folders.
const KINDS = [
  ['apply --frozen', 'pin', "this machine's skills cache", false], ['apply --frozen', 'written', 'the store cache', true],
  ['apply --frozen', 'prompt', 'the store cache', true], ['apply --frozen', 'team', 'the store cache', false],
  ['skills sync --frozen', 'pin', "this machine's skills cache", false], ['skills sync --frozen', 'written', 'the store cache', true],
  ['skills sync --frozen', 'prompt', 'the store cache', false], ['skills sync --frozen', 'team', 'the store cache', false],
  ['skills sync', 'pin', "this machine's skills cache", false], ['skills sync', 'written', 'the store cache', true],
  ['skills sync', 'prompt', 'the store cache', false],
];
for (const [flow, kind, into, changed] of KINDS) {
  test(`${flow}, a ${kind === 'written' ? 'written skill' : kind} fetched and then the own folders fail: ${changed ? 'the step plans again, and the same --approve is stale' : 'no added step, and the same --approve applies'}`, async t => {
    const { w, deps } = await oneKind(t, kind), f = FLOWS[flow], own = path.join(w.stateRoot, w.project().projectId);
    const plan = await f.plan(w);
    await noSpaceFor(own, () => assert.rejects(f.apply(w, plan.revision, deps()),
      e => e.code === 'SKILLS_STATE_UNSAFE' && e.message.endsWith(`A folder step failed with a system error (ENOSPC). Before this check, this run fetched into ${into}. Nothing in the project changed.`) && e.next === (changed ? REPLAN : undefined)));
    assert.equal((await f.plan(w)).revision === plan.revision, !changed, 'the revision changed exactly when the step says so');
    if (changed) await assert.rejects(f.apply(w, plan.revision, deps()), e => e.code === 'STALE_APPROVAL');
    else await f.apply(w, plan.revision, deps());
  });
}

// Round 9, item 1: the shared part runs before phase A and makes no own folder. A failure there leaves the plan as it was.
test('a failure in the shared part, at the skills cache: no added step, and the same --approve applies', async t => {
  const { w, deps } = await oneKind(t, 'pin'), f = FLOWS['skills sync'], cache = path.join(w.stateRoot, 'cache');
  const plan = await f.plan(w);
  assert.equal(fs.existsSync(cache), false, 'the skills cache is made by this run');
  await noSpaceFor(cache, () => assert.rejects(f.apply(w, plan.revision, deps()),
    e => e.code === 'SKILLS_STATE_UNSAFE' && e.message.endsWith('A folder step failed with a system error (ENOSPC). Nothing in the project changed.') && e.next === undefined));
  assert.equal((await f.plan(w)).revision, plan.revision);
  await f.apply(w, plan.revision, deps());
});

// Round 9, items 1 and 5: which caches a fetch went to, and whether it changed the plan, from the fetched ids.
test('fetchedInto: a pin goes to the skills cache, a written skill and store items to the store cache; only bound notices change the plan', () => {
  const entries = new Map([['pin', { source: { kind: 'npm' } }], ['written', { source: { kind: 'local' } }]]);
  assert.deepEqual({ ...fetchedInto(entries, ['pin'], 0) }, { skills: true, store: false, planChanged: false });
  assert.deepEqual({ ...fetchedInto(entries, ['written'], 0) }, { skills: false, store: true, planChanged: true });
  assert.deepEqual({ ...fetchedInto(entries, [], 2) }, { skills: false, store: true, planChanged: false });
  assert.deepEqual({ ...fetchedInto(entries, [], 0, 1) }, { skills: false, store: true, planChanged: true });
  assert.deepEqual({ ...fetchedInto(entries, ['pin', 'written'], 1) }, { skills: true, store: true, planChanged: true });
  assert.deepEqual({ ...fetchedInto(entries, [], 0) }, { skills: false, store: false, planChanged: false });
});

// Round 9, item 5: an error that carries only a code, with no errno and no syscall, is not named as a system error.
test('an error with only a code, such as ABORT_ERR, is not named as a system error', async t => {
  const { w, deps } = await oneKind(t, 'pin'), f = FLOWS['skills sync'], own = path.join(w.stateRoot, w.project().projectId);
  const plan = await f.plan(w), real = fs.mkdirSync;
  fs.mkdirSync = (p, ...rest) => { if (p === own) throw Object.assign(new Error('The operation was aborted'), { code: 'ABORT_ERR' }); return real(p, ...rest); };
  try {
    await assert.rejects(f.apply(w, plan.revision, deps()), e => e.code === 'SKILLS_STATE_UNSAFE' && !/system error|ABORT_ERR/.test(e.message) && e.cause?.code === 'ABORT_ERR');
  } finally { fs.mkdirSync = real; }
});
