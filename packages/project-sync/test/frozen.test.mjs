// Spec 06, 3.16 and decision A on sageadvicellc/bowerloom#80: apply --frozen and skills sync --frozen install only what
// bowerloom.lock.json records, fetch what this machine lacks, and hold a lock-fetched item with a notice for review.
import test from '../../../dist/tests/support/lock-slot-retry.js';
import assert from 'node:assert/strict';
import { after } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { denyNetwork, npmPackage, fakeAcquirer, noAcquirer, exactTree, deps } from './sync-fixture.mjs';
import { configWorld, writeConfig, writeLock, storeItem, storePin, editStore, pushStore, lockOfRepo, storeTransport, dropStore, code } from './config-fixture.mjs';
import { planProjectApply, applyProjectApply, planSync, applySync } from '../../../dist/packages/project-sync/src/index.js';
import { manifestRefusal } from '../../../dist/packages/skill-manifest/src/refusal.js';

const network = denyNetwork();
after(() => assert.deepEqual(network, [], 'every fetch in this file goes to a fake'));
const input = (w, extra = {}) => ({ project: w.project(), stateRoot: w.stateRoot, home: w.home, engines: ['claude-code', 'codex'], team: null, frozen: true, ...extra });
const signal = () => new AbortController().signal;
const exists = (w, rel) => fs.existsSync(path.join(w.projectDir, rel));
const SKILL_WITH_TOOLS = '---\nname: house-style\ndescription: Uses git.\nallowed-tools: Bash(git status:*)\n---\nRun git status.\n';

/** A store with a skill, a prompt, a team and a pin, pushed, locked, then moved away: a teammate's clone. */
async function clone(t, { skillText, promptText } = {}) {
  const w = configWorld(t, { folder: true }), npm = npmPackage('tanstack-db');
  await storeItem(w, 'team', 'research'); await storeItem(w, 'skill', 'house-style'); await storeItem(w, 'prompt', 'weekly-update'); storePin(w, npm.entry);
  if (skillText) editStore(w, 'skills/house-style/SKILL.md', skillText);
  if (promptText) editStore(w, 'prompts/weekly-update.md', promptText);
  writeConfig(w, { skills: [{ id: 'house-style', source: 'store' }, { id: 'tanstack-db', source: 'store' }], prompts: [{ id: 'weekly-update', source: 'store' }], teams: [{ id: 'research', source: 'store' }] });
  const repo = pushStore(w);
  writeLock(w, { skills: [lockOfRepo(w, repo, 'skill', 'house-style'), { id: 'tanstack-db', from: 'store', pin: npm.entry }], prompts: [lockOfRepo(w, repo, 'prompt', 'weekly-update')], teams: [lockOfRepo(w, repo, 'team', 'research')] });
  dropStore(w);
  return { w, npm, repo };
}

test('1. six lock codes refuse at plan time with zero acquirer calls and zero network calls', async t => {
  const w = configWorld(t, { folder: true }), acquirer = noAcquirer(), urls = [];
  writeConfig(w, { skills: [{ id: 'house-style', source: 'store' }] });
  const lock = path.join(w.projectDir, 'bowerloom.lock.json');
  const cases = [
    ['LOCK_MISSING', () => {}],
    ['LOCK_INVALID', () => fs.writeFileSync(lock, '<<<<<<< HEAD\n', { mode: 0o644 })],
    ['LOCK_UNSAFE', () => { fs.rmSync(lock, { force: true }); fs.writeFileSync(lock, '{}', { mode: 0o666 }); fs.chmodSync(lock, 0o666); }],
    ['LOCK_LIMIT', () => { fs.rmSync(lock, { force: true }); fs.writeFileSync(lock, Buffer.alloc(4194305, 0x20), { mode: 0o644 }); }],
    ['LOCK_CONFIG_MISMATCH', () => { fs.rmSync(lock, { force: true }); writeLock(w, {}); }],
  ];
  for (const [expected, setUp] of cases) {
    setUp();
    await assert.rejects(planProjectApply(input(w)), code(expected), expected);
    await assert.rejects(planSync({ ...input(w), offline: false }), code(expected), expected);
    // Apply plans again under the lock and refuses there too, before any fetch: the acquirer and the transport see nothing.
    await assert.rejects(applyProjectApply(input(w), 'a'.repeat(64), signal(), { acquirer, storeTransport: () => ({ get: async u => { urls.push(u); throw new Error('no'); }, close() {} }) }), code(expected), expected);
  }
  fs.rmSync(path.join(w.projectDir, 'bowerloom.json'));
  await assert.rejects(planProjectApply(input(w)), code('LOCK_CONFIG_MISSING'));
  assert.equal(acquirer.calls.length, 0); assert.equal(urls.length, 0);
});

test('2 and 7 and 9. frozen installs a lock pin and a lock authored item on a machine with no store; a second run fetches nothing', async t => {
  const { w, npm, repo } = await clone(t), acquirer = fakeAcquirer([npm]), transport = storeTransport(repo);
  const plan = await planProjectApply(input(w));
  assert.equal(plan.frozen, true); assert.equal(plan.skills.offline, false); assert.equal(plan.skills.frozen, true); assert.equal(plan.store, null);
  assert.deepEqual(plan.network.hosts, ['api.github.com', 'registry.npmjs.org']);
  assert.ok(plan.notes.includes('Frozen: installing only what bowerloom.lock.json records.'));
  const result = await applyProjectApply(input(w), plan.revision, signal(), { acquirer, storeTransport: transport });
  assert.deepEqual(result.applied.map(a => [a.kind, a.id, a.resolvedFrom]).sort(), [['prompt', 'weekly-update', 'lock'], ['skill', 'house-style', 'lock'], ['skill', 'tanstack-db', 'lock']]);
  assert.equal(acquirer.calls.length, 1);
  assert.ok(exists(w, '.claude/skills/house-style/SKILL.md') && exists(w, '.claude/skills/synthetic-tanstack-db/SKILL.md') && exists(w, '.claude/commands/weekly-update.md'));
  // 7: everything is on this machine now.
  const before = transport.urls.length, again = await planProjectApply(input(w));
  assert.equal(again.actionable, false);
  await applyProjectApply(input(w), again.revision, signal(), { acquirer, storeTransport: transport });
  assert.equal(transport.urls.length, before); assert.equal(acquirer.calls.length, 1);
});

test('3. frozen ignores a live store that differs', async t => {
  const w = configWorld(t, { folder: true });
  await storeItem(w, 'skill', 'house-style'); writeConfig(w, { skills: [{ id: 'house-style', source: 'store' }] });
  const repo = pushStore(w); writeLock(w, { skills: [lockOfRepo(w, repo, 'skill', 'house-style')] });
  editStore(w, 'skills/house-style/SKILL.md', '---\nname: house-style\ndescription: Live and different.\n---\nx\n');
  const plan = await planProjectApply(input(w));
  assert.equal(plan.skills.items[0].resolvedFrom, 'lock'); assert.equal(plan.store, null);
  await applyProjectApply(input(w), plan.revision, signal(), { acquirer: noAcquirer(), storeTransport: storeTransport(repo) });
  assert.doesNotMatch(fs.readFileSync(path.join(w.projectDir, '.claude/skills/house-style/SKILL.md'), 'utf8'), /Live and different/);
});

async function failedRun(t, d) {
  const { w, npm } = await clone(t), before = exactTree(w.projectDir);
  await d(w, npm, async extra => applyProjectApply(input(w), (await planProjectApply(input(w))).revision, extra.signal ?? signal(), { acquirer: fakeAcquirer([npm]), ...extra }));
  assert.equal(exactTree(w.projectDir), before, 'nothing in the project changed');
}
test('4. a fetched authored item with another hash gives LOCK_HASH_MISMATCH and changes nothing', async t => {
  await failedRun(t, async (w, npm, run) => {
    const other = configWorld(t); await storeItem(other, 'skill', 'house-style'); editStore(other, 'skills/house-style/SKILL.md', '---\nname: house-style\ndescription: Other bytes.\n---\nx\n');
    await assert.rejects(run({ storeTransport: storeTransport(pushStore(other)) }), code('LOCK_HASH_MISMATCH'));
  });
});
test('6. a failed network read gives SKILLS_OFFLINE and changes nothing', async t => {
  await failedRun(t, async (w, npm, run) => assert.rejects(run({ storeTransport: () => ({ get: async () => { throw manifestRefusal('SKILLS_ADD_NETWORK'); }, close() {} }) }), code('SKILLS_OFFLINE')));
});
test('14. a rate limit from the transport keeps GITHUB_RATE_LIMITED and changes nothing', async t => {
  await failedRun(t, async (w, npm, run) => assert.rejects(run({ storeTransport: () => ({ get: async () => { throw manifestRefusal('GITHUB_RATE_LIMITED'); }, close() {} }) }), code('GITHUB_RATE_LIMITED')));
});
test('14. an abort gives SKILLS_SYNC_INTERRUPTED and changes nothing', async t => {
  await failedRun(t, async (w, npm, run) => { const c = new AbortController(); c.abort(); await assert.rejects(run({ signal: c.signal, storeTransport: () => ({ get: async () => { throw new Error('never'); }, close() {} }) }), code('SKILLS_SYNC_INTERRUPTED')); });
});

test('5. a fetched pin that differs gives SKILLS_SYNC_CONTENT_MISMATCH', async t => {
  const { w, repo } = await clone(t), forged = npmPackage('tanstack-db', { guide: 'Other bytes' });
  const plan = await planProjectApply(input(w));
  await assert.rejects(applyProjectApply(input(w), plan.revision, signal(), { acquirer: fakeAcquirer([forged]), storeTransport: storeTransport(repo) }), code('SKILLS_SYNC_CONTENT_MISMATCH'));
  assert.equal(exists(w, '.claude/skills/synthetic-tanstack-db'), false);
});

test('8. plain apply never calls the acquirer: it holds what the lock names and this machine lacks', async t => {
  const { w } = await clone(t), acquirer = noAcquirer();
  const plan = await planProjectApply(input(w, { frozen: false }));
  await applyProjectApply(input(w, { frozen: false }), plan.revision, signal(), { acquirer });
  assert.equal(acquirer.calls.length, 0); assert.equal(plan.skills.offline, true);
});

test('10 and 11. a locked prompt with a notice and a locked skill with allowed-tools are fetched and held for review; the next plan shows them', async t => {
  const { w, npm, repo } = await clone(t, { skillText: SKILL_WITH_TOOLS, promptText: '---\nallowed-tools: Bash\n---\nRun it.\n' });
  const plan = await planProjectApply(input(w));
  const prompt = plan.prompts[0], skill = plan.skills.items.find(i => i.id === 'house-style');
  assert.equal(prompt.notices, null); assert.equal(skill.allowedTools, undefined);
  const result = await applyProjectApply(input(w), plan.revision, signal(), { acquirer: fakeAcquirer([npm]), storeTransport: storeTransport(repo) });
  assert.deepEqual(result.held.map(h => [h.kind, h.id, h.code, h.next]).sort(), [['prompt', 'weekly-update', 'ITEM_REVIEW_REQUIRED', 'Run bowerloom apply --frozen again to review it.'], ['skill', 'house-style', 'ITEM_REVIEW_REQUIRED', 'Run bowerloom apply --frozen again to review it.']]);
  assert.equal(exists(w, '.claude/commands/weekly-update.md'), false); assert.equal(exists(w, '.claude/skills/house-style'), false);
  assert.ok(exists(w, '.claude/skills/synthetic-tanstack-db/SKILL.md'), 'the other items install');
  const next = await planProjectApply(input(w));
  assert.deepEqual(next.prompts[0].notices, ['allowed-tools']);
  assert.equal(next.skills.items.find(i => i.id === 'house-style').allowedTools, 'Bash(git status:*)');
  await applyProjectApply(input(w), next.revision, signal(), { acquirer: fakeAcquirer([npm]), storeTransport: storeTransport(repo) });
  assert.ok(exists(w, '.claude/commands/weekly-update.md') && exists(w, '.claude/skills/house-style/SKILL.md'));
});

test('12. a fetched prompt with no notice, and a fetched skill without allowed-tools, install in the same run', async t => {
  const { w, npm, repo } = await clone(t);
  const plan = await planProjectApply(input(w));
  const result = await applyProjectApply(input(w), plan.revision, signal(), { acquirer: fakeAcquirer([npm]), storeTransport: storeTransport(repo) });
  assert.deepEqual(result.held, []);
  assert.ok(exists(w, '.claude/commands/weekly-update.md') && exists(w, '.claude/skills/house-style/SKILL.md'));
});

test('13. a frozen run fetches each locked team the store cache lacks into the store cache', async t => {
  const { w, npm, repo } = await clone(t);
  const plan = await planProjectApply(input(w));
  assert.deepEqual(plan.storeFetch.map(f => [f.kind, f.id, f.storeCache]), [['team', 'research', 'missing']]);
  await applyProjectApply(input(w), plan.revision, signal(), { acquirer: fakeAcquirer([npm]), storeTransport: storeTransport(repo) });
  const key = `team-research-${plan.storeFetch[0].lockPin.hash}`;
  assert.ok(fs.existsSync(path.join(w.storeCacheRoot, key, 'teams/research/team.yaml')));
  assert.equal(exists(w, '.bowerloom/teams/research'), false, 'a store team installs nothing');
});

test('15. skills sync (not --offline) fetches every locked prompt the store cache lacks, binds api.github.com, and installs no prompt', async t => {
  const { w, npm, repo } = await clone(t);
  const sync = { project: w.project(), stateRoot: w.stateRoot, home: w.home, team: null, offline: false };
  const plan = await planSync(sync);
  assert.deepEqual(plan.storeFetch.map(f => [f.kind, f.id]), [['prompt', 'weekly-update']]);
  assert.ok(plan.network.hosts.includes('api.github.com'));
  const result = await applySync(sync, plan.revision, deps(fakeAcquirer([npm]), { storeTransport: storeTransport(repo) }));
  assert.ok(result.fetched.includes('prompt weekly-update'));
  assert.equal(exists(w, '.claude/commands/weekly-update.md'), false);
  // Now a plain apply installs the prompt from the store cache, with no fetch.
  const applyPlan = await planProjectApply(input(w, { frozen: false }));
  assert.equal(applyPlan.prompts[0].action, 'install');
  await applyProjectApply(input(w, { frozen: false }), applyPlan.revision, signal(), { acquirer: noAcquirer() });
  assert.ok(exists(w, '.claude/commands/weekly-update.md'));
});
