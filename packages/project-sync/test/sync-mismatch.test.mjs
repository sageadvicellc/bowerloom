import test from '../../../dist/tests/support/lock-slot-retry.js';
import { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { planSync, applySync } from '../../../dist/packages/project-sync/src/index.js';
import { entryRequest, cacheOperationId } from '../../../dist/packages/project-sync/src/cache-index.js';
import { planManagedItem } from '../../../dist/packages/managed-skills/src/v2-observed.js';
import { applyManagedItem } from '../../../dist/packages/managed-skills/src/v2-transaction.js';
import { observeSkillCacheRoot } from '../../../dist/packages/skill-sources/src/cache.js';
import { planNpmAcquisition } from '../../../dist/packages/skill-sources/src/npm.js';
import { denyNetwork, npmPackage, localEntry, syncProject, writeManifest, localSkill, fakeAcquirer, noAcquirer, privateFolders, store, exactTree, deps, code } from './sync-fixture.mjs';

const network = denyNetwork();
after(() => assert.deepEqual(network, []));

/** Stores `other`'s bytes at the operation id that skills.json's entry for `pkg` maps to. */
async function plant(f, pkg, other) {
  privateFolders(f); const id = cacheOperationId(entryRequest(pkg.entry).digest, 0);
  const plan = planNpmAcquisition(entryRequest(other.entry).request, observeSkillCacheRoot(f.cacheRoot, id, 33554432));
  await store(plan, plan.revision, new AbortController().signal, other);
}

test('a completed cache operation whose request differs from skills.json gives CONTENT_MISMATCH before any project write', async t => {
  const f = syncProject(t), a = npmPackage('alpha'), tampered = npmPackage('alpha', { guide: 'Tampered guide.' }); localSkill(f, 'house-style');
  writeManifest(f, [a.entry, localEntry('house-style')]);
  const approved = await planSync(f.input());
  await plant(f, a, tampered);
  const before = exactTree(f.projectDir), acquirer = fakeAcquirer([a]);
  await assert.rejects(planSync(f.input()), code('SKILLS_SYNC_CONTENT_MISMATCH'));
  await assert.rejects(applySync(f.input(), approved.revision, deps(acquirer)), code('SKILLS_SYNC_CONTENT_MISMATCH'));
  assert.equal(exactTree(f.projectDir), before); assert.deepEqual(acquirer.calls, []);
});

test('a local skill edited after the plan gives STALE_APPROVAL with no write', async t => {
  const f = syncProject(t); localSkill(f, 'house-style'); writeManifest(f, [localEntry('house-style')]);
  const plan = await planSync(f.input());
  fs.writeFileSync(path.join(f.projectDir, '.bowerloom/skills/house-style/SKILL.md'), '---\nname: house-style\ndescription: Edited.\n---\nNew words.\n');
  const before = exactTree(f.base);
  await assert.rejects(applySync(f.input(), plan.revision, deps(noAcquirer())), code('STALE_APPROVAL'));
  assert.equal(exactTree(f.base), before); assert.equal(fs.existsSync(f.stateRoot), false);
});

test('phase B refuses a child plan whose material differs from skills.json, before any project write', async t => {
  const f = syncProject(t), a = npmPackage('alpha'); localSkill(f, 'house-style'); writeManifest(f, [a.entry, localEntry('house-style')]);
  const plan = await planSync(f.input()), before = exactTree(f.projectDir), applied = [];
  const managed = {
    async plan(req, options) {
      const real = await planManagedItem(req, options); if (real.status === 'up-to-date' || req.item.id !== 'house-style') return real;
      const forged = structuredClone(real); forged.core.closure.inventory[0].sha256 = '0'.repeat(64); return forged;
    },
    async apply(held, req, revision, options) { applied.push(req.item.id); return applyManagedItem(held, req, revision, options); },
  };
  await assert.rejects(applySync(f.input(), plan.revision, deps(fakeAcquirer([a]), { managed })), code('SKILLS_SYNC_CONTENT_MISMATCH'));
  assert.deepEqual(applied, []); assert.equal(exactTree(f.projectDir), before);
});
