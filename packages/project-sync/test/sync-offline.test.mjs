import test from '../../../dist/tests/support/lock-slot-retry.js';
import { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { planSync, applySync } from '../../../dist/packages/project-sync/src/index.js';
import { entryRequest, cacheOperationId } from '../../../dist/packages/project-sync/src/cache-index.js';
import { denyNetwork, npmPackage, localEntry, syncProject, writeManifest, localSkill, fakeAcquirer, noAcquirer, prefill, exactTree, read, deps, code, byId } from './sync-fixture.mjs';

const network = denyNetwork();
after(() => assert.deepEqual(network, []));

test('--offline with a pin that needs fetching refuses at plan time and writes nothing anywhere', async t => {
  const f = syncProject(t), a = npmPackage('alpha'); localSkill(f, 'house-style'); writeManifest(f, [a.entry, localEntry('house-style')]);
  const before = exactTree(f.base), acquirer = noAcquirer();
  await assert.rejects(planSync(f.input({ offline: true })), code('SKILLS_OFFLINE'));
  const online = await planSync(f.input());
  await assert.rejects(applySync(f.input({ offline: true }), online.revision, deps(acquirer)), code('SKILLS_OFFLINE'));
  assert.equal(exactTree(f.base), before); assert.equal(fs.existsSync(f.stateRoot), false); assert.deepEqual(acquirer.calls, []);
});

test('a network fault on the second skill refuses SKILLS_OFFLINE and the project tree is unchanged', async t => {
  const f = syncProject(t), a = npmPackage('alpha'), b = npmPackage('bravo'); localSkill(f, 'house-style');
  writeManifest(f, [a.entry, b.entry, localEntry('house-style')]);
  const plan = await planSync(f.input()), before = exactTree(f.projectDir), acquirer = fakeAcquirer([a, b], { fail: new Set(['bravo']) });
  await assert.rejects(applySync(f.input(), plan.revision, deps(acquirer)), code('SKILLS_OFFLINE'));
  assert.equal(exactTree(f.projectDir), before);
  assert.deepEqual(acquirer.calls.map(c => c.id), ['alpha', 'bravo']);
  // The fetched pin stays in the private cache. The held attempt is left untouched and reported; the next one is new.
  const next = byId(await planSync(f.input())), first = cacheOperationId(entryRequest(b.entry).digest, 0);
  assert.equal(next.alpha.state, 'cached'); assert.equal(next.bravo.state, 'needs-fetch');
  assert.deepEqual(next.bravo.cache.partial, [first]); assert.equal(next.bravo.cacheOperationId, cacheOperationId(entryRequest(b.entry).digest, 1));
  const retry = fakeAcquirer([a, b]);
  const result = await applySync(f.input(), (await planSync(f.input())).revision, deps(retry));
  assert.deepEqual(retry.calls.map(c => c.id), ['bravo']);
  assert.deepEqual(result.applied.map(x => x.id), ['alpha', 'bravo', 'house-style']);
});

test('pins that are already cached sync offline, with no acquisition', async t => {
  const f = syncProject(t), a = npmPackage('alpha'), b = npmPackage('bravo'); localSkill(f, 'house-style');
  writeManifest(f, [a.entry, b.entry, localEntry('house-style')]); await prefill(f, a); await prefill(f, b);
  const plan = await planSync(f.input({ offline: true }));
  assert.equal(plan.offline, true); assert.deepEqual(plan.network, { required: false, hosts: [] });
  assert.deepEqual(plan.items.map(i => i.state), ['cached', 'cached', 'local']);
  const acquirer = noAcquirer(), result = await applySync(f.input({ offline: true }), plan.revision, deps(acquirer));
  assert.deepEqual(acquirer.calls, []); assert.deepEqual(result.applied.map(x => x.id), ['alpha', 'bravo', 'house-style']);
  assert.equal(read(f, '.agents/skills/synthetic-bravo/references/guide.md'), '# Guide\nVersion 1.0.0\n');
});
