// Round 9 of the reviews of PR 101, item 2: a run that stops names the command that ran, with each flag that changes its
// plan, so the step makes the same plan again. Every fetch here goes to a fake.
import test from '../../../dist/tests/support/lock-slot-retry.js';
import assert from 'node:assert/strict';
import { after } from 'node:test';
import { denyNetwork, npmPackage, fakeAcquirer } from './sync-fixture.mjs';
import { configWorld, writeConfig, writeLock, storeItem, pushStore, lockOfRepo, storeTransport, dropStore } from './config-fixture.mjs';
import { planProjectApply, applyProjectApply, planSync, applySync } from '../../../dist/packages/project-sync/src/index.js';
import { applyRerun } from '../../../dist/packages/project-sync/src/apply-project.js';
import { syncRerun, interrupted } from '../../../dist/packages/project-sync/src/apply.js';

const network = denyNetwork();
after(() => assert.deepEqual(network, [], 'every fetch in this file goes to a fake'));

/** A teammate's clone whose lock holds a written skill; the store is gone, so a run fetches it from the store remote. */
async function written(t) {
  const w = configWorld(t, { folder: true });
  await storeItem(w, 'skill', 'house-style'); writeConfig(w, { skills: [{ id: 'house-style', source: 'store' }] });
  const repo = pushStore(w); writeLock(w, { skills: [lockOfRepo(w, repo, 'skill', 'house-style')] }); dropStore(w);
  return { w, repo };
}
const applyInput = (w, extra = {}) => ({ project: w.project(), stateRoot: w.stateRoot, home: w.home, engines: ['claude-code', 'codex'], team: null, frozen: true, ...extra });
const syncInput = (w, extra = {}) => ({ project: w.project(), stateRoot: w.stateRoot, home: w.home, team: null, offline: false, ...extra });

test('a stop during a store fetch under apply --frozen names bowerloom apply --frozen, with its flags', async t => {
  const { w, repo } = await written(t), controller = new AbortController();
  const input = applyInput(w, { engines: ['claude-code'], maxGithubRequests: 50 }), plan = await planProjectApply(input);
  await assert.rejects(applyProjectApply(input, plan.revision, controller.signal, { acquirer: fakeAcquirer([]), storeTransport: storeTransport(repo), beforeStoreRead: () => controller.abort() }),
    e => e.code === 'SKILLS_SYNC_INTERRUPTED' && e.next === 'Run bowerloom apply --harness claude-code --frozen --max-github-requests 50 again.' && e.fix === 'bowerloom apply --harness claude-code --frozen --max-github-requests 50' && e.message.endsWith('It stopped while fetching house-style, before any change to the project. Run bowerloom apply --harness claude-code --frozen --max-github-requests 50 again.'));
});

test('a stop during a store fetch under skills sync --frozen names bowerloom skills sync --frozen', async t => {
  const { w, repo } = await written(t), controller = new AbortController();
  const input = syncInput(w, { frozen: true }), plan = await planSync(input);
  await assert.rejects(applySync(input, plan.revision, { acquirer: fakeAcquirer([]), signal: controller.signal, storeTransport: storeTransport(repo), beforeStoreRead: () => controller.abort() }),
    e => e.code === 'SKILLS_SYNC_INTERRUPTED' && e.next === 'Run bowerloom skills sync --frozen again.' && e.fix === 'bowerloom skills sync --frozen');
});

test('a stop before the first item under bowerloom apply names bowerloom apply to finish', async t => {
  const { w } = await written(t), input = applyInput(w, { frozen: false });
  const plan = await planProjectApply(input), stopped = AbortSignal.abort();
  await assert.rejects(applyProjectApply(input, plan.revision, stopped, {}),
    e => e.code === 'SKILLS_SYNC_INTERRUPTED' && e.next === 'Run bowerloom apply to finish.' && e.fix === 'bowerloom apply' && /Run bowerloom apply to finish\./.test(e.message));
});

test('the rerun of a run holds each flag that changes its plan', () => {
  assert.equal(applyRerun({ engines: ['claude-code', 'codex'] }), 'bowerloom apply');
  assert.equal(applyRerun({ engines: ['codex'], frozen: true, allow: [`reviewer:${'a'.repeat(64)}`], maxGithubRequests: 9 }), `bowerloom apply --harness codex --allow-agent reviewer:${'a'.repeat(64)} --frozen --max-github-requests 9`);
  assert.equal(applyRerun({ engines: ['claude-code', 'codex'], team: 'research' }), 'bowerloom up --team research');
  assert.equal(syncRerun({ offline: false, team: null }), 'bowerloom skills sync');
  assert.equal(syncRerun({ offline: true, team: 'research', frozen: true, maxGithubRequests: 3 }), 'bowerloom skills sync --offline --team research --frozen --max-github-requests 3');
  const e = interrupted(['a'], ['b'], 'bowerloom skills sync --frozen');
  assert.equal(e.next, 'Run bowerloom skills sync --frozen to finish.');
  assert.ok(e.message.includes('Finished: a. Not started: b. Run bowerloom skills sync --frozen to finish.'));
});
