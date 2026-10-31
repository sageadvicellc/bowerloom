// Review fixes of PR 94 (spec 06): the security hold of lock-fetched skills (H1), the request budget (L2), the store-item
// lines of a shared project (L3), the error mapping of fetches and proofs (F3), the store cache verification (F5), and
// the binding and lock-creation fixes of the config change (C3, C4).
import test from '../../../dist/tests/support/lock-slot-retry.js';
import assert from 'node:assert/strict';
import { after } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { denyNetwork, npmPackage, fakeAcquirer, noAcquirer, deps, exactTree } from './sync-fixture.mjs';
import { configWorld, writeConfig, writeLock, storeItem, storePin, editStore, pushStore, lockOfRepo, storeTransport, dropStore, authoredLockItem, code, STORE_COMMIT } from './config-fixture.mjs';
import { planProjectApply, applyProjectApply, planSync, applySync, planConfigChange, applyConfigChange, planLockUpdate, writeStoreCache, resolveProject, managedPort } from '../../../dist/packages/project-sync/src/index.js';
import { fetchStoreGit } from '../../../dist/packages/project-sync/src/store-git.js';
import { writeGuardedFile } from '../../../dist/packages/project-config/src/write.js';
import { renderApplyReview } from '../../../dist/apps/cli/src/apply.js';
import { renderSyncReview } from '../../../dist/apps/cli/src/sync.js';
import { promptNotices } from '../../../dist/packages/project-sync/src/notices.js';
import { authoredRows } from '../../../dist/packages/skill-manifest/src/resolve-store-git.js';
import { manifestRefusal, githubRequestFailed } from '../../../dist/packages/skill-manifest/src/refusal.js';
import { withProjectLock, discoverProject } from '../../../dist/packages/project-context/src/index.js';

const network = denyNetwork();
after(() => assert.deepEqual(network, [], 'no network'));
const signal = () => new AbortController().signal;
const ctx = w => discoverProject(w.projectDir, w.home);
const applyInput = (w, extra = {}) => ({ project: ctx(w), stateRoot: w.stateRoot, home: w.home, engines: ['claude-code', 'codex'], team: null, frozen: true, ...extra });
const exists = (w, rel) => fs.existsSync(path.join(w.projectDir, rel));
const HELD = 'Run bowerloom apply --frozen again to review it.';
const skill = body => `---\nname: house-style\ndescription: A store skill.\n${body}`;
/** A clone whose one store skill has `text`, locked against a pushed copy; the store is moved away. */
async function clone(t, text) {
  const w = configWorld(t, { folder: true });
  await storeItem(w, 'skill', 'house-style'); editStore(w, 'skills/house-style/SKILL.md', text);
  writeConfig(w, { skills: [{ id: 'house-style', source: 'store' }] });
  const repo = pushStore(w); writeLock(w, { skills: [lockOfRepo(w, repo, 'skill', 'house-style')] }); dropStore(w);
  return { w, repo };
}
async function heldForReview(w, repo, extraDeps = {}) {
  const plan = await planProjectApply(applyInput(w));
  assert.equal(plan.skills.items[0].notices, null, 'not on this machine yet: no notices to show');
  const result = await applyProjectApply(applyInput(w), plan.revision, signal(), { acquirer: noAcquirer(), storeTransport: storeTransport(repo), ...extraDeps });
  assert.deepEqual(result.held.map(h => [h.kind, h.id, h.code, h.next]), [['skill', 'house-style', 'ITEM_REVIEW_REQUIRED', HELD]]);
  assert.equal(exists(w, '.claude/skills/house-style'), false);
  return result;
}

test('H1. a lock-fetched skill that registers hooks is held for review', async t => {
  const { w, repo } = await clone(t, skill('hooks:\n  PreToolUse: []\n---\nUse it.\n'));
  await heldForReview(w, repo);
  const next = await planProjectApply(applyInput(w));
  assert.deepEqual(next.skills.items[0].notices, ['hooks']);
});

test('H1. a lock-fetched skill with ! shell lines is held for review', async t => {
  const { w, repo } = await clone(t, skill('---\nRun it:\n!`git status`\n'));
  await heldForReview(w, repo);
  assert.deepEqual((await planProjectApply(applyInput(w))).skills.items[0].notices, ['shell-lines']);
});

test('H1. a skill another run put in the store cache between the plan and phase A is held for review', async t => {
  const { w, repo } = await clone(t, skill('allowed-tools: Bash\n---\nUse it.\n'));
  const files = [{ path: 'SKILL.md', bytes: Buffer.from(skill('allowed-tools: Bash\n---\nUse it.\n')) }];
  let filled = false;
  const beforeStoreRead = async () => { if (filled) return; filled = true; await writeStoreCache({ cacheRoot: w.cacheRoot, storeCacheRoot: w.storeCacheRoot }, 'skill', 'house-style', authoredRows(files).hash, files, signal()); };
  fs.mkdirSync(w.cacheRoot, { recursive: true, mode: 0o700 }); fs.chmodSync(path.dirname(w.cacheRoot), 0o700);
  const transport = storeTransport(repo);
  await heldForReview(w, repo, { storeTransport: transport, beforeStoreRead });
  assert.equal(filled, true); assert.equal(transport.urls.length, 0, 'the cache another run filled is read, not fetched');
});

test('H1. a store skill that the cache holds shows its notices in the plan, and they are bound', async t => {
  const { w, repo } = await clone(t, skill('hooks:\n  Stop: []\n---\nUse it.\n'));
  await heldForReview(w, repo);
  const plan = await planProjectApply(applyInput(w));
  assert.deepEqual(plan.skills.items[0].notices, ['hooks']);
  // The plan words name what the skill can do, as they do for a prompt.
  const words = renderApplyReview(plan);
  assert.match(words, /^ {2}Note: skill house-style registers hooks that keep running for the rest of the session\. Review github\.com\/sageadvicellc\/store\.$/m, words);
  const result = await applyProjectApply(applyInput(w), plan.revision, signal(), { acquirer: noAcquirer(), storeTransport: storeTransport(repo) });
  assert.deepEqual(result.held, []); assert.ok(exists(w, '.claude/skills/house-style/SKILL.md'));
});

test('L2. a run that would make more than 1,000 GitHub requests refuses GITHUB_REQUEST_BUDGET before any fetch', async t => {
  const w = configWorld(t, { folder: true });
  const ids = Array.from({ length: 8 }, (_, i) => `big-${i}`);
  const rows = i => Array.from({ length: 126 }, (_, j) => ({ path: `f${String(j).padStart(3, '0')}.md`, bytes: Buffer.from(`${i}-${j}\n`) }));
  writeConfig(w, { skills: ids.map(id => ({ id, source: 'store' })) });
  writeLock(w, { skills: ids.map((id, i) => authoredLockItem(w, 'skill', id, { files: [{ path: 'SKILL.md', bytes: Buffer.from('x') }, ...rows(i).slice(1)] })) });
  const plan = await planProjectApply(applyInput(w));
  assert.equal(plan.skills.network.requests, 8 * (4 + 126));
  const transport = storeTransport({ responses: new Map() });
  await assert.rejects(applyProjectApply(applyInput(w), plan.revision, signal(), { acquirer: noAcquirer(), storeTransport: transport }), e => e.code === 'GITHUB_REQUEST_BUDGET' && e.message === 'This run would make more GitHub requests than Bowerloom allows in one run.');
  assert.equal(transport.urls.length, 0);
});

test('L3. in a shared project the plan names each store item the config asks for', async t => {
  const w = configWorld(t, { folder: true });
  await storeItem(w, 'skill', 'house-style'); await storeItem(w, 'prompt', 'weekly-update');
  writeConfig(w, { skills: [{ id: 'house-style', source: 'store' }], prompts: [{ id: 'weekly-update', source: 'store' }] });
  fs.mkdirSync(path.join(w.projectDir, '.git')); fs.writeFileSync(path.join(w.projectDir, '.git', 'config'), '[remote "origin"]\n\turl = https://github.com/o/app.git\n');
  const notes = (await planSync({ project: ctx(w), stateRoot: w.stateRoot, home: w.home, team: null, offline: false })).notes;
  assert.ok(notes.includes('  skill house-style comes from your store; this project asks for it'), notes.join('\n'));
  assert.ok(notes.includes('  prompt weekly-update comes from your store; this project asks for it'));
  fs.rmSync(path.join(w.projectDir, '.git'), { recursive: true });
  assert.equal((await planSync({ project: ctx(w), stateRoot: w.stateRoot, home: w.home, team: null, offline: false })).notes.some(n => n.includes('comes from your store')), false);
});

/** A sync item and roots for one locked skill, for fetchStoreGit. */
async function lockedItem(t) {
  const { w, repo } = await clone(t, skill('---\nUse it.\n'));
  const plan = await planSync({ project: ctx(w), stateRoot: w.stateRoot, home: w.home, team: null, offline: false });
  const i = plan.items[0]; fs.mkdirSync(w.cacheRoot, { recursive: true, mode: 0o700 }); fs.chmodSync(path.dirname(w.cacheRoot), 0o700);
  return { w, repo, item: { kind: 'skill', id: i.id, requestDigest: i.requestDigest, lockPin: i.lockPin }, roots: { cacheRoot: w.cacheRoot, storeCacheRoot: w.storeCacheRoot } };
}
const failing = error => ({ signal: signal(), storeTransport: () => ({ get: async () => { throw error; }, close() {} }) });

test('F3. a 5xx from GitHub gives GITHUB_REQUEST_FAILED with the status', async t => {
  const { item, roots } = await lockedItem(t);
  await assert.rejects(fetchStoreGit(item, roots, ['api.github.com'], failing(githubRequestFailed(503))), e => e.code === 'GITHUB_REQUEST_FAILED' && /503/.test(e.message));
});
test('F3. a 401 from GitHub gives GITHUB_REQUEST_FAILED with the status', async t => {
  const { item, roots } = await lockedItem(t);
  await assert.rejects(fetchStoreGit(item, roots, ['api.github.com'], failing(githubRequestFailed(401))), e => e.code === 'GITHUB_REQUEST_FAILED' && /401/.test(e.message));
});
test('F3. an item missing at the locked commit gives STORE_ITEM_GONE_AT_COMMIT', async t => {
  const { item, roots, w } = await lockedItem(t);
  const other = configWorld(t); await storeItem(other, 'skill', 'not-this'); const gone = pushStore(other);
  await assert.rejects(fetchStoreGit(item, roots, ['api.github.com'], { signal: signal(), storeTransport: storeTransport(gone) }), e => e.code === 'STORE_ITEM_GONE_AT_COMMIT' && e.message === 'The locked commit does not hold this item.');
  void w;
});
// fetchBytes (spec 03) still names any failure inside transport.get SKILLS_ADD_NETWORK; an Error from anywhere else in the
// fetch, such as the transport factory or a cache write, is not a network failure and keeps its own identity.
test('F3. an arbitrary Error in the fetch is not reported as offline: it is rethrown', async t => {
  const { item, roots } = await lockedItem(t);
  const boom = new Error('boom');
  await assert.rejects(fetchStoreGit(item, roots, ['api.github.com'], { signal: signal(), storeTransport: () => { throw boom; } }), e => e === boom);
});
test('F3. only a transport-level network failure gives SKILLS_OFFLINE', async t => {
  const { item, roots } = await lockedItem(t);
  await assert.rejects(fetchStoreGit(item, roots, ['api.github.com'], failing(manifestRefusal('SKILLS_ADD_NETWORK'))), code('SKILLS_OFFLINE'));
});

test('F3 and T9. the proof of use maps a 5xx, a rate limit, and an arbitrary Error the same way', async t => {
  const w = configWorld(t, { folder: true }); await storeItem(w, 'skill', 'house-style');
  fs.mkdirSync(path.join(w.projectDir, '.git')); fs.writeFileSync(path.join(w.projectDir, '.git', 'config'), '[remote "origin"]\n\turl = https://github.com/o/app.git\n');
  pushStore(w); const git = path.join(w.store, '.git'); fs.mkdirSync(path.join(git, 'refs/remotes/origin'), { recursive: true });
  fs.writeFileSync(path.join(git, 'config'), '[remote "origin"]\n\turl = https://github.com/sageadvicellc/store\n'); fs.writeFileSync(path.join(git, 'HEAD'), 'ref: refs/heads/main\n'); fs.writeFileSync(path.join(git, 'refs/remotes/origin/main'), `${STORE_COMMIT}\n`);
  const use = error => planConfigChange({ project: ctx(w), home: w.home, op: 'use', kind: 'skill', id: 'house-style', storeTransport: () => ({ get: async () => { throw error; }, close() {} }) });
  await assert.rejects(use(githubRequestFailed(502)), e => e.code === 'GITHUB_REQUEST_FAILED' && /502/.test(e.message));
  await assert.rejects(use(manifestRefusal('GITHUB_RATE_LIMITED')), code('GITHUB_RATE_LIMITED'));
  const boom = new Error('boom');
  await assert.rejects(planConfigChange({ project: ctx(w), home: w.home, op: 'use', kind: 'skill', id: 'house-style', storeTransport: () => { throw boom; } }), e => e === boom);
  await assert.rejects(use(manifestRefusal('SKILLS_ADD_NETWORK')), code('SKILLS_OFFLINE'));
  writeConfig(w, { skills: [{ id: 'house-style', source: 'store' }] });
  await assert.rejects(planLockUpdate({ project: ctx(w), home: w.home, items: null, commit: null, storeTransport: () => ({ get: async () => { throw manifestRefusal('GITHUB_RATE_LIMITED'); }, close() {} }) }), code('GITHUB_RATE_LIMITED'));
});

test('T9. GITHUB_RATE_LIMITED from a frozen fetch keeps its code and changes nothing', async t => {
  const { w } = await clone(t, skill('---\nUse it.\n'));
  const plan = await planProjectApply(applyInput(w)), before = exactTree(w.projectDir);
  await assert.rejects(applyProjectApply(applyInput(w), plan.revision, signal(), { acquirer: noAcquirer(), storeTransport: () => ({ get: async () => { throw manifestRefusal('GITHUB_RATE_LIMITED'); }, close() {} }) }), code('GITHUB_RATE_LIMITED'));
  assert.equal(exactTree(w.projectDir), before);
});

test('F5. a store cache entry that fails verification is named in the plan, and an offline run holds it with that code', async t => {
  const { w, repo } = await clone(t, skill('---\nUse it.\n'));
  await applyProjectApply(applyInput(w), (await planProjectApply(applyInput(w))).revision, signal(), { acquirer: noAcquirer(), storeTransport: storeTransport(repo) });
  for (const rel of ['.claude/skills/house-style', '.agents/skills/house-style', '.bowerloom/managed/catalog/house-style.json', '.bowerloom/managed/skills/house-style']) fs.rmSync(path.join(w.projectDir, rel), { recursive: true });
  fs.rmSync(path.join(w.stateRoot, ctx(w).projectId, 'items', 'house-style'), { recursive: true });
  const key = fs.readdirSync(w.storeCacheRoot).find(n => n.startsWith('skill-house-style-'));
  fs.appendFileSync(path.join(w.storeCacheRoot, key, 'skills/house-style/SKILL.md'), 'tampered\n');
  const plan = await planProjectApply(applyInput(w, { frozen: false }));
  assert.ok(plan.notes.includes(`store cache entry ${key} failed verification; it will be replaced`), plan.notes.join('\n'));
  assert.deepEqual([plan.skills.items[0].action, plan.skills.items[0].hold?.code], ['hold', 'LOCK_HASH_MISMATCH']);
});

test('F7. with a refused store, a store item is held STORE_ITEM_MISSING with the next step bowerloom store status', async t => {
  const w = configWorld(t, { folder: true }); writeConfig(w, { skills: [{ id: 'house-style', source: 'store' }] });
  fs.mkdirSync(w.store, { mode: 0o777 }); fs.chmodSync(w.store, 0o777);
  const r = resolveProject({ project: ctx(w), home: w.home, frozen: false, tolerateStore: true });
  assert.deepEqual(r.skills[0].hold, { code: 'STORE_ITEM_MISSING', next: 'Run bowerloom store status.' });
});

test('F8. the stale check rethrows a store item it cannot read', async t => {
  const w = configWorld(t, { folder: true }); await storeItem(w, 'skill', 'house-style');
  writeConfig(w, { skills: [{ id: 'house-style', source: 'store' }] }); writeLock(w, { skills: [authoredLockItem(w, 'skill', 'house-style')] });
  fs.chmodSync(path.join(w.store, 'skills/house-style'), 0o000);
  try { assert.throws(() => resolveProject({ project: ctx(w), home: w.home, frozen: false })); } finally { fs.chmodSync(path.join(w.store, 'skills/house-style'), 0o700); }
});

test('C3. a plan made with no lock is stale when a lock appears before apply', async t => {
  const w = configWorld(t, { folder: true }); await storeItem(w, 'skill', 'house-style');
  const p = await planConfigChange({ project: ctx(w), home: w.home, op: 'use', kind: 'skill', id: 'house-style' });
  assert.equal(p.lock, null); assert.equal(p.lockBefore, null);
  writeLock(w, {});
  await assert.rejects(withProjectLock(w.projectDir, signal(), async held => applyConfigChange(p, p.revision, held, ctx(w), w.home)), code('STALE_APPROVAL'));
});

test('C4. use --project in a shared project with no store entry creates no lock', async t => {
  const w = configWorld(t, { folder: true });
  fs.mkdirSync(path.join(w.projectDir, '.git')); fs.writeFileSync(path.join(w.projectDir, '.git', 'config'), '[remote "origin"]\n\turl = https://github.com/o/app.git\n');
  fs.mkdirSync(path.join(w.projectDir, '.bowerloom/teams/first-team'), { recursive: true });
  writeConfig(w, {});
  const p = await planConfigChange({ project: ctx(w), home: w.home, op: 'use', kind: 'team', id: 'first-team', source: 'project' });
  assert.equal(p.lock, null);
});

test('T5. sync and apply refuse an invalid or unsafe lock', async t => {
  const w = configWorld(t, { folder: true }); await storeItem(w, 'skill', 'house-style'); writeConfig(w, { skills: [{ id: 'house-style', source: 'store' }] });
  const lock = path.join(w.projectDir, 'bowerloom.lock.json'), sync = () => planSync({ project: ctx(w), stateRoot: w.stateRoot, home: w.home, team: null, offline: false });
  fs.writeFileSync(lock, '<<<<<<<\n', { mode: 0o644 });
  await assert.rejects(sync(), code('LOCK_INVALID')); await assert.rejects(planProjectApply(applyInput(w, { frozen: false })), code('LOCK_INVALID'));
  fs.chmodSync(lock, 0o666);
  await assert.rejects(sync(), code('LOCK_UNSAFE')); await assert.rejects(planProjectApply(applyInput(w, { frozen: false })), code('LOCK_UNSAFE'));
});

test('T7. applyConfigChange re-checks the localItemRows hash of an added authored item', async t => {
  const w = configWorld(t, { folder: true }); await storeItem(w, 'skill', 'house-style');
  fs.mkdirSync(path.join(w.projectDir, '.git')); fs.writeFileSync(path.join(w.projectDir, '.git', 'config'), '[remote "origin"]\n\turl = https://github.com/o/app.git\n');
  const repo = pushStore(w), git = path.join(w.store, '.git'); fs.mkdirSync(path.join(git, 'refs/remotes/origin'), { recursive: true });
  fs.writeFileSync(path.join(git, 'config'), '[remote "origin"]\n\turl = https://github.com/sageadvicellc/store\n'); fs.writeFileSync(path.join(git, 'HEAD'), 'ref: refs/heads/main\n'); fs.writeFileSync(path.join(git, 'refs/remotes/origin/main'), `${STORE_COMMIT}\n`);
  const p = await planConfigChange({ project: ctx(w), home: w.home, op: 'use', kind: 'skill', id: 'house-style', storeTransport: storeTransport(repo) });
  assert.equal(p.authored.length, 1);
  editStore(w, 'skills/house-style/SKILL.md', skill('---\nChanged after the plan.\n'));
  await assert.rejects(withProjectLock(w.projectDir, signal(), async held => applyConfigChange(p, p.revision, held, ctx(w), w.home)), code('STALE_APPROVAL'));
  assert.equal(fs.existsSync(path.join(w.projectDir, 'bowerloom.lock.json')), false);
});

test('T7. fetchStoreGit makes a new transport for each group of 40 blobs in production wiring', async t => {
  const w = configWorld(t, { folder: true });
  const files = { 'skills/big/SKILL.md': 'x\n', ...Object.fromEntries(Array.from({ length: 99 }, (_, i) => [`skills/big/r/${String(i).padStart(3, '0')}.md`, `${i}\n`])) };
  const { buildFakeRepo } = await import('../../../dist/tests/support/fake-github-repo.js');
  const repo = buildFakeRepo('sageadvicellc', 'store', files, STORE_COMMIT, fs.mkdtempSync(path.join(w.base, 'repo-')));
  const rows = authoredRows(Object.entries(files).map(([p, text]) => ({ path: p.slice('skills/big/'.length), bytes: Buffer.from(text) })));
  const lockPin = { remote: 'https://github.com/sageadvicellc/store', commit: STORE_COMMIT, path: 'skills/big', tree: repo.treeAt('skills/big'), files: rows.rows, hash: rows.hash };
  fs.mkdirSync(w.cacheRoot, { recursive: true, mode: 0o700 }); fs.chmodSync(path.dirname(w.cacheRoot), 0o700);
  const made = [];
  const factory = () => { const urls = []; made.push(urls); return storeTransport(repo, urls)(); };
  await fetchStoreGit({ kind: 'skill', id: 'big', requestDigest: rows.hash, lockPin }, { cacheRoot: w.cacheRoot, storeCacheRoot: w.storeCacheRoot }, ['api.github.com'], { signal: signal(), storeTransport: factory });
  assert.deepEqual(made.map(u => u.length), [44, 40, 20]);
});
void npmPackage; void storePin; void fakeAcquirer; void deps; void applySync;

test('C2. a .bowerloom folder replaced during phase B stops apply before phase C writes', async t => {
  const w = configWorld(t);
  await storeItem(w, 'skill', 'house-style'); writeConfig(w, { skills: [{ id: 'house-style', source: 'store' }] });
  const input = applyInput(w, { frozen: false });
  const plan = await planProjectApply(input);
  assert.equal(plan.bowerloomFolder, 'create');
  let swapped = false;
  const managed = { ...managedPort, plan: async (req, o) => {
    if (!swapped) { swapped = true; fs.renameSync(path.join(w.projectDir, '.bowerloom'), path.join(w.projectDir, 'moved')); fs.mkdirSync(path.join(w.projectDir, '.bowerloom'), { mode: 0o755 }); }
    return managedPort.plan(req, o);
  } };
  await assert.rejects(applyProjectApply(input, plan.revision, signal(), { managed }), code('PROJECT_UNSAFE'));
  assert.equal(swapped, true);
  assert.equal(exists(w, '.claude/skills/house-style'), false);
});

test('F5. a locked prompt whose store cache entry fails verification is named in the plan and held with that code', async t => {
  const w = configWorld(t, { folder: true });
  await storeItem(w, 'prompt', 'weekly-update'); writeConfig(w, { prompts: [{ id: 'weekly-update', source: 'store' }] });
  const text = fs.readFileSync(path.join(w.store, 'prompts/weekly-update.md'));
  const repo = pushStore(w), item = lockOfRepo(w, repo, 'prompt', 'weekly-update'); writeLock(w, { prompts: [item] }); dropStore(w);
  const files = [{ path: 'weekly-update.md', bytes: text }];
  fs.mkdirSync(w.cacheRoot, { recursive: true, mode: 0o700 }); fs.chmodSync(path.dirname(w.cacheRoot), 0o700);
  await writeStoreCache({ cacheRoot: w.cacheRoot, storeCacheRoot: w.storeCacheRoot }, 'prompt', 'weekly-update', authoredRows(files).hash, files, signal());
  const key = fs.readdirSync(w.storeCacheRoot).find(n => n.startsWith('prompt-weekly-update-'));
  fs.appendFileSync(path.join(w.storeCacheRoot, key, 'prompts/weekly-update.md'), 'tampered\n');
  const plan = await planProjectApply(applyInput(w, { frozen: false }));
  assert.ok(plan.notes.includes(`store cache entry ${key} failed verification; it will be replaced`), plan.notes.join('\n'));
  assert.deepEqual([plan.prompts[0].action, plan.prompts[0].hold?.code], ['hold', 'LOCK_HASH_MISMATCH']);
});

test('T7. the guarded writer refuses STALE_APPROVAL when a new file appears after its hash check', async t => {
  const w = configWorld(t);
  const target = path.join(w.projectDir, 'bowerloom.json'), real = fs.lstatSync;
  let calls = 0;
  t.mock.method(fs, 'lstatSync', (p, ...rest) => {
    if (p === target && ++calls === 2) fs.writeFileSync(target, '{}\n', { mode: 0o644 });
    return real.call(fs, p, ...rest);
  });
  await withProjectLock(w.projectDir, signal(), async held => {
    assert.throws(() => writeGuardedFile(w.projectDir, 'bowerloom.json', '{"a":1}\n', null, held, '.bowerloom.json'), code('STALE_APPROVAL'));
  });
  t.mock.restoreAll();
  assert.equal(calls, 2); assert.equal(fs.readFileSync(target, 'utf8'), '{}\n', 'the file that appeared is kept');
  assert.deepEqual(fs.readdirSync(w.projectDir).filter(n => n.endsWith('.tmp')), []);
});

// Second security review of PR 94.
const ALL = ['allowed-tools', 'hooks', 'shell-lines'];
const NOTICE_CASES = {
  hooksBlock: [skill('hooks:\n  PreToolUse: []\n---\nx\n'), ['hooks']],
  bang: [skill('---\n!`id`\n'), ['shell-lines']],
  bangInFence: [skill('---\n```\n!`id`\n```\n'), ['shell-lines']],
  flowHooks: ['---\n{name: house-style, description: d, hooks: {Stop: []}}\n---\nx\n', ['hooks']],
  escapedKey: [skill('"hoo\\x6bs": {Stop: []}\n---\nx\n'), ['hooks']],
  dashesInValue: ['---\nname: house-style\ndescription: a---\nhooks:\n  Stop: []\n---\nx\n', ['hooks']],
  mergeHooks: [skill('<<: {hooks: {Stop: []}}\n---\nx\n'), ALL],
  mergeNested: [skill('metadata:\n  <<: {a: 1}\n---\nx\n'), ALL],
  alias: [skill('metadata: &m {a: 1}\nother: *m\n---\nx\n'), ALL],
  noCloser: ['---\nname: house-style\nhooks:\n  Stop: []\n', ALL],
  noCloserPlain: ['---\nname: house-style\ndescription: d\n', ALL],
  midlineFence: [skill('---\ntext ```!\nid\n```\n'), ['shell-lines']],
  midlineTilde: [skill('---\ntext ~~~!\nid\n~~~\n'), ['shell-lines']],
  indentedBang: [skill('---\n  !id\n'), ['shell-lines']],
  tabBang: [skill('---\n\t!id\n'), ['shell-lines']],
  allowedUnderscore: [skill('allowed_tools: Bash\n---\nx\n'), ['allowed-tools']],
  allowedCamel: [skill('allowedTools: Bash\n---\nx\n'), ['allowed-tools']],
  allowedUpper: [skill('ALLOWED-TOOLS: Bash\n---\nx\n'), ['allowed-tools']],
  hooksUpper: [skill('Hooks: {Stop: []}\n---\nx\n'), ['hooks']],
  plain: [skill('---\nUse it. Wow!\n'), []],
};
for (const [name, [text, expected]] of Object.entries(NOTICE_CASES)) {
  test(`M1. promptNotices names every notice of the form ${name}`, () => assert.deepEqual(promptNotices(text), expected));
}

test('M1. a live store skill whose frontmatter has no closing fence is held, not installed', async t => {
  const w = configWorld(t, { folder: true });
  await storeItem(w, 'skill', 'house-style'); editStore(w, 'skills/house-style/SKILL.md', '---\nname: house-style\ndescription: d\nhooks:\n  Stop: []\n');
  writeConfig(w, { skills: [{ id: 'house-style', source: 'store' }] });
  const plan = await planProjectApply(applyInput(w, { frozen: false }));
  assert.deepEqual([plan.skills.items[0].action, plan.skills.items[0].hold?.code], ['hold', 'SKILLS_ADD_FRONTMATTER']);
});

test('M2. an unknown shared state that causes a refusal says so honestly', async t => {
  const w = configWorld(t, { folder: true });
  await storeItem(w, 'skill', 'house-style');
  const config = path.join(w.projectDir, '.git', 'config');
  fs.mkdirSync(path.join(w.projectDir, '.git')); fs.writeFileSync(config, '[core]\n'); fs.chmodSync(config, 0o000);
  try {
    await assert.rejects(planConfigChange({ project: ctx(w), home: w.home, op: 'use', kind: 'skill', id: 'house-style' }),
      e => e.code === 'STORE_ITEM_NOT_SHAREABLE' && e.message.startsWith('Bowerloom could not read .git/config and treats this project as shared') && !e.message.includes('This project is shared'));
  } finally { fs.chmodSync(config, 0o644); }
});

test('M2. a group-writable .git and config (umask 002) are read as git reads them, so the project is not shared', async t => {
  const w = configWorld(t, { folder: true });
  await storeItem(w, 'skill', 'house-style');
  fs.mkdirSync(path.join(w.projectDir, '.git')); fs.writeFileSync(path.join(w.projectDir, '.git', 'config'), '[core]\n\tbare = false\n');
  fs.chmodSync(path.join(w.projectDir, '.git'), 0o775); fs.chmodSync(path.join(w.projectDir, '.git', 'config'), 0o664);
  const p = await planConfigChange({ project: ctx(w), home: w.home, op: 'use', kind: 'skill', id: 'house-style' });
  assert.equal(p.lock, null); assert.deepEqual(p.notes.filter(n => /shared/.test(n)), []);
});

const bigRows = i => [{ path: 'SKILL.md', bytes: Buffer.from(`---\nname: big-${i}\ndescription: d\n---\nx\n`) }, ...Array.from({ length: 125 }, (_, j) => ({ path: `f${String(j).padStart(3, '0')}.md`, bytes: Buffer.from(`${i}-${j}\n`) }))];
function bigWorld(t) {
  const w = configWorld(t, { folder: true }), ids = Array.from({ length: 8 }, (_, i) => `big-${i}`);
  writeConfig(w, { skills: ids.map(id => ({ id, source: 'store' })) });
  writeLock(w, { skills: ids.map((id, i) => authoredLockItem(w, 'skill', id, { files: bigRows(i) })) });
  return { w, ids };
}
test('L2. the budget counts only items the store cache lacks: 8 maximum-size cached skills install', async t => {
  const { w, ids } = bigWorld(t);
  fs.mkdirSync(w.cacheRoot, { recursive: true, mode: 0o700 }); fs.chmodSync(path.dirname(w.cacheRoot), 0o700);
  for (const [i, id] of ids.entries()) await writeStoreCache({ cacheRoot: w.cacheRoot, storeCacheRoot: w.storeCacheRoot }, 'skill', id, authoredRows(bigRows(i)).hash, bigRows(i), signal());
  const plan = await planProjectApply(applyInput(w));
  assert.equal(plan.network.requests, 0); assert.equal(plan.network.maxRequests, 1000);
  // The run passes the budget and phase A with no fetch. Phase B stops at its first child, so the test does not copy 2,016 files.
  const transport = storeTransport({ responses: new Map() }), past = new Error('past phase A');
  await assert.rejects(applyProjectApply(applyInput(w), plan.revision, signal(), { acquirer: noAcquirer(), storeTransport: transport, managed: { ...managedPort, plan: async () => { throw past; } } }), e => e === past || e?.cause === past || e?.code === 'MANAGED_SKILL_REFUSED');
  assert.equal(transport.urls.length, 0);
});
test('L2. --max-github-requests raises the limit; it is bound and shown, and at most 5000', async t => {
  const { w } = bigWorld(t);
  const low = await planProjectApply(applyInput(w)), high = await planProjectApply(applyInput(w, { maxGithubRequests: 2000 }));
  assert.equal(high.network.maxRequests, 2000); assert.notEqual(high.revision, low.revision);
  assert.match(renderApplyReview(high), /^GitHub requests: at most 1040, of the 2000 this run allows\.$/m);
  assert.match(renderApplyReview(low), /^GitHub requests: at most 1040, of the 1000 this run allows\. Run it with --max-github-requests 1040 or more\.$/m);
  const transport = storeTransport({ responses: new Map() });
  // Past the budget check, the fetch itself fails: the repository the transport serves is empty.
  await assert.rejects(applyProjectApply(applyInput(w, { maxGithubRequests: 2000 }), high.revision, signal(), { acquirer: noAcquirer(), storeTransport: transport }), e => e.code !== 'GITHUB_REQUEST_BUDGET');
  assert.ok(transport.urls.length > 0);
  for (const bad of [0, 5001, 1.5, '100']) await assert.rejects(planProjectApply(applyInput(w, { maxGithubRequests: bad })), code('USAGE'));
  for (const bad of [0, 5001]) await assert.rejects(planSync({ project: ctx(w), stateRoot: w.stateRoot, home: w.home, team: null, offline: false, maxGithubRequests: bad }), code('USAGE'));
});
// The cached skills' notices are bound, so a cache entry removed after the review makes the plan stale before any fetch.
test('L2. a cache entry removed after the plan stops apply before any fetch', async t => {
  const { w, ids } = bigWorld(t);
  fs.mkdirSync(w.cacheRoot, { recursive: true, mode: 0o700 }); fs.chmodSync(path.dirname(w.cacheRoot), 0o700);
  for (const [i, id] of ids.entries()) await writeStoreCache({ cacheRoot: w.cacheRoot, storeCacheRoot: w.storeCacheRoot }, 'skill', id, authoredRows(bigRows(i)).hash, bigRows(i), signal());
  const plan = await planProjectApply(applyInput(w));
  for (const n of fs.readdirSync(w.storeCacheRoot)) fs.rmSync(path.join(w.storeCacheRoot, n), { recursive: true });
  const transport = storeTransport({ responses: new Map() });
  await assert.rejects(applyProjectApply(applyInput(w), plan.revision, signal(), { acquirer: noAcquirer(), storeTransport: transport }), code('STALE_APPROVAL'));
  assert.equal(transport.urls.length, 0);
  // Planned again, the run is over the limit and refuses before any fetch.
  await assert.rejects(applyProjectApply(applyInput(w), (await planProjectApply(applyInput(w))).revision, signal(), { acquirer: noAcquirer(), storeTransport: transport }), code('GITHUB_REQUEST_BUDGET'));
  assert.equal(transport.urls.length, 0);
});

test('INFO. the plan names the extra files of a store skill', async t => {
  const w = configWorld(t, { folder: true });
  await storeItem(w, 'skill', 'house-style');
  fs.mkdirSync(path.join(w.store, 'skills/house-style/references'), { recursive: true }); fs.writeFileSync(path.join(w.store, 'skills/house-style/references/setup.md'), 'Run the setup.\n');
  writeConfig(w, { skills: [{ id: 'house-style', source: 'store' }] });
  const repo = pushStore(w); writeLock(w, { skills: [lockOfRepo(w, repo, 'skill', 'house-style')] }); dropStore(w);
  const plan = await planProjectApply(applyInput(w));
  assert.match(renderApplyReview(plan), /^ {2}skill house-style also holds: references\/setup\.md$/m);
  assert.match(renderSyncReview(await planSync({ project: ctx(w), stateRoot: w.stateRoot, home: w.home, team: null, offline: false })), /^ {2}skill house-style also holds: references\/setup\.md$/m);
});
test('INFO. a skill held during skills sync names skills sync as the next step', async t => {
  const { w, repo } = await clone(t, skill('hooks:\n  Stop: []\n---\nx\n'));
  const input = { project: ctx(w), stateRoot: w.stateRoot, home: w.home, team: null, offline: false };
  const plan = await planSync(input);
  const result = await applySync(input, plan.revision, { acquirer: noAcquirer(), signal: signal(), storeTransport: storeTransport(repo) });
  assert.deepEqual(result.held.map(h => [h.id, h.code, h.next]), [['house-style', 'ITEM_REVIEW_REQUIRED', 'Run bowerloom skills sync again to review it.']]);
  assert.equal(exists(w, '.claude/skills/house-style'), false);
});
