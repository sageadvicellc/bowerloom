// One skills cache for every project on the machine (Hanna, global skill cache, phase 1). The cache sits in the private
// state root, is keyed on content and not on the skills.json entry id, and is filled under one cache lock. Old
// per-project caches are read, never moved or changed.
import test from '../../../dist/tests/support/lock-slot-retry.js';
import { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { planSync, applySync } from '../../../dist/packages/project-sync/src/index.js';
import { entryRequest, cacheOperationId } from '../../../dist/packages/project-sync/src/cache-index.js';
import { readAcquiredSkillCache, inspectSkillCache } from '../../../dist/packages/skill-sources/src/cache.js';
import { planManagedItem } from '../../../dist/packages/managed-skills/src/v2-observed.js';
import { denyNetwork, npmPackage, syncProject, writeManifest, fakeAcquirer, noAcquirer, prefillLegacy, privateFolders, cacheOps, exactTree, read, deps, code, byId } from './sync-fixture.mjs';

const network = denyNetwork();
after(() => assert.deepEqual(network, []));

/** A second project on the same machine: its own folder, the first project's private state root. */
const neighbour = (t, f) => syncProject(t, '.bowerloom-sync-b-', { stateRoot: f.stateRoot });
async function sync(f, acquirer, extra = {}) { const plan = await planSync(f.input(extra)); return { plan, result: await applySync(f.input(extra), plan.revision, deps(acquirer)) }; }
/** An Acquirer that waits `ms` before it stores, so a second sync can reach the cache lock meanwhile. */
function slowAcquirer(packages, ms) {
  const inner = fakeAcquirer(packages);
  return { calls: inner.calls, async npm(plan, approval, signal) { await new Promise(r => setTimeout(r, ms)); return inner.npm(plan, approval, signal); }, git: inner.git };
}

test('two projects share one fetch: the second installs from the machine cache, even on a plan made before the fetch', async t => {
  const a = npmPackage('alpha'), f1 = syncProject(t), f2 = neighbour(t, f1);
  writeManifest(f1, [a.entry]); writeManifest(f2, [a.entry]);
  // The second project approves its plan while the pin still needs fetching.
  const early = await planSync(f2.input());
  assert.equal(byId(early).alpha.cache.status, 'needs-fetch'); assert.deepEqual(early.network.hosts, ['registry.npmjs.org']);
  const acquirer = fakeAcquirer([a]);
  const first = await sync(f1, acquirer);
  assert.deepEqual(first.result.fetched, ['alpha']); assert.equal(acquirer.calls.length, 1);
  assert.equal(first.plan.privateState.cacheRoot, path.join(f1.stateRoot, 'cache'));
  // The pin is now in the machine cache. The early approval still holds, and apply skips the approved fetch.
  const late = await planSync(f2.input());
  assert.equal(byId(late).alpha.cache.status, 'cached'); assert.equal(late.revision, early.revision);
  const second = await applySync(f2.input(), early.revision, deps(noAcquirer()));
  assert.deepEqual(second.applied.map(x => x.id), ['alpha']); assert.deepEqual(second.fetched, []);
  assert.equal(read(f2, '.claude/skills/synthetic-alpha/references/guide.md'), '# Guide\nVersion 1.0.0\n');
  assert.equal(acquirer.calls.length, 1); assert.equal(cacheOps(f1.cacheRoot).length, 1);
  assert.equal((fs.statSync(f1.cacheRoot).mode & 0o7777), 0o700);
  // Neither project has a cache folder of its own.
  assert.equal(fs.existsSync(f1.legacyCacheRoot), false); assert.equal(fs.existsSync(f2.legacyCacheRoot), false);
});

test('one pin under two entry ids maps to one content key and shares one cache operation', async t => {
  const a = npmPackage('alpha'), f1 = syncProject(t), f2 = neighbour(t, f1), beta = { ...a.entry, id: 'beta', teams: ['first-team'] };
  fs.mkdirSync(path.join(f2.projectDir, '.bowerloom/teams/first-team'), { recursive: true, mode: 0o755 });
  writeManifest(f1, [a.entry]); writeManifest(f2, [beta]);
  assert.equal(entryRequest(a.entry).digest, entryRequest(beta).digest);
  assert.notEqual(entryRequest(a.entry).legacyDigest, entryRequest(beta).legacyDigest);
  assert.equal(cacheOperationId(entryRequest(a.entry).digest, 0), cacheOperationId(entryRequest(beta).digest, 0));
  const acquirer = fakeAcquirer([a]);
  await sync(f1, acquirer);
  const plan = byId(await planSync(f2.input()));
  assert.equal(plan.beta.cache.status, 'cached'); assert.equal(plan.beta.requestDigest, byId(await planSync(f1.input())).alpha.requestDigest);
  const { result } = await sync(f2, noAcquirer());
  assert.deepEqual(result.applied.map(x => x.id), ['beta']); assert.equal(acquirer.calls.length, 1); assert.equal(cacheOps(f1.cacheRoot).length, 1);
  // The project records its own entry id. The cache records none.
  const catalog = JSON.parse(read(f2, '.bowerloom/managed/catalog/beta.json'));
  assert.equal(catalog.item.id, 'beta'); assert.equal(catalog.skill.id, 'beta'); assert.equal(catalog.skill.name, 'synthetic-alpha');
  assert.equal(read(f2, '.bowerloom/managed/skills/beta/SKILL.md'), a.files[0].text);
  const stored = await inspectSkillCache({ root: f1.cacheRoot, operationId: cacheOps(f1.cacheRoot)[0].slice(3) });
  assert.equal(stored.receipt.skill.id, 'synthetic-alpha'); assert.equal(stored.receipt.skill.name, 'synthetic-alpha');
});

test('two syncs at once in two projects make one fetch and both succeed', async t => {
  const a = npmPackage('alpha'), f1 = syncProject(t), f2 = neighbour(t, f1);
  writeManifest(f1, [a.entry]); writeManifest(f2, [a.entry]);
  const [p1, p2] = [await planSync(f1.input()), await planSync(f2.input())];
  const acquirer = slowAcquirer([a], 400);
  const [r1, r2] = await Promise.all([applySync(f1.input(), p1.revision, deps(acquirer)), applySync(f2.input(), p2.revision, deps(acquirer))]);
  assert.deepEqual(r1.applied.map(x => x.id), ['alpha']); assert.deepEqual(r2.applied.map(x => x.id), ['alpha']);
  assert.equal(acquirer.calls.length, 1); assert.deepEqual([...r1.fetched, ...r2.fetched], ['alpha']);
  assert.equal(cacheOps(f1.cacheRoot).length, 1);
  for (const f of [f1, f2]) assert.equal(read(f, '.agents/skills/synthetic-alpha/references/guide.md'), '# Guide\nVersion 1.0.0\n');
});

test('a changed byte in the machine cache refuses: the reader re-verifies every file, and no project changes', async t => {
  const a = npmPackage('alpha'), f1 = syncProject(t), f2 = neighbour(t, f1);
  writeManifest(f1, [a.entry]); writeManifest(f2, [a.entry]);
  await sync(f1, fakeAcquirer([a]));
  const operationId = cacheOps(f1.cacheRoot)[0].slice(3), seen = await inspectSkillCache({ root: f1.cacheRoot, operationId });
  const selector = { root: f1.cacheRoot, operationId, expectedSnapshotRevision: seen.snapshotRevision, expectedReceiptRevision: seen.receipt.revision };
  privateFolders(f2); const stateDir = path.join(f2.itemsRoot, 'alpha'); fs.mkdirSync(stateDir, { mode: 0o700 });
  const child = { operation: 'install', projectDir: f2.projectDir, stateDir, item: { kind: 'skill', id: 'alpha' }, harnesses: ['codex'], source: { kind: 'cache', selector }, expectedPreviousRevision: null, minFreeBytes: 33554432, legacy: null };
  assert.equal((await planManagedItem(child)).format, 'bowerloom/managed-item-plan/v1beta2');
  const file = path.join(f1.cacheRoot, 'op-' + operationId, 'files/references/guide.md'), bytes = fs.readFileSync(file);
  bytes[bytes.length - 2] ^= 1; fs.writeFileSync(file, bytes);
  const signal = new AbortController().signal;
  await assert.rejects(readAcquiredSkillCache(selector, { signal, deadlineMs: performance.now() + 20000 }), code('NPM_CACHE_CHANGED'));
  const before = exactTree(f2.projectDir);
  await assert.rejects(planManagedItem(child));
  await assert.rejects(planSync(f2.input({ offline: true })), code('SKILLS_OFFLINE'));
  assert.equal(exactTree(f2.projectDir), before);
});

test('an old per-project cache entry is still found and read, and is never moved or changed', async t => {
  const a = npmPackage('alpha'), f = syncProject(t); writeManifest(f, [a.entry]);
  await prefillLegacy(f, a);
  const legacy = exactTree(f.legacyCacheRoot), plan = await planSync(f.input({ offline: true }));
  assert.equal(byId(plan).alpha.cache.status, 'cached'); assert.equal(byId(plan).alpha.cache.root, f.legacyCacheRoot);
  const result = await applySync(f.input({ offline: true }), plan.revision, deps(noAcquirer()));
  assert.deepEqual(result.applied.map(x => x.id), ['alpha']); assert.deepEqual(result.fetched, []);
  assert.equal(read(f, '.claude/skills/synthetic-alpha/SKILL.md'), a.files[0].text);
  assert.equal(exactTree(f.legacyCacheRoot), legacy); assert.deepEqual(cacheOps(f.cacheRoot), []);
});

test('the machine cache lives in the private state root, which still may not sit inside a project', async t => {
  const a = npmPackage('alpha'), f = syncProject(t); writeManifest(f, [a.entry]);
  const plan = await planSync(f.input());
  assert.equal(plan.privateState.cacheRoot, path.join(f.stateRoot, 'cache'));
  assert.ok(plan.privateState.create.includes(path.join(f.stateRoot, 'cache')));
  fs.mkdirSync(path.join(f.projectDir, 'xdg'), { mode: 0o700 });
  const before = exactTree(f.base);
  for (const stateRoot of [path.join(f.projectDir, 'xdg', 'bowerloom'), f.projectDir]) {
    await assert.rejects(planSync({ ...f.input(), stateRoot }), code('SKILLS_STATE_UNSAFE'), stateRoot);
    await assert.rejects(applySync({ ...f.input(), stateRoot }, plan.revision, deps(fakeAcquirer([a]))), code('SKILLS_STATE_UNSAFE'), stateRoot);
  }
  assert.equal(exactTree(f.base), before);
});
