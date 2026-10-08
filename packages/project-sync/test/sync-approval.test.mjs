import test from '../../../dist/tests/support/lock-slot-retry.js';
import { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { planSync, applySync } from '../../../dist/packages/project-sync/src/index.js';
import { planManagedItem } from '../../../dist/packages/managed-skills/src/v2-observed.js';
import { applyManagedItem } from '../../../dist/packages/managed-skills/src/v2-transaction.js';
import { withProjectLock, isHeldProjectLock } from '../../../dist/packages/project-context/src/index.js';
import { revisionOf } from '../../../dist/packages/skill-sources/src/validation.js';
import { denyNetwork, npmPackage, localEntry, syncProject, writeManifest, localSkill, fakeAcquirer, noAcquirer, exactTree, read, deps, code, byId } from './sync-fixture.mjs';

const network = denyNetwork();
after(() => assert.deepEqual(network, []));

/** True when the project lock is held by someone else at this moment: taking it refuses PROJECT_LOCKED. */
async function lockedNow(dir) { try { await withProjectLock(dir, new AbortController().signal, async () => {}); return false; } catch (e) { if (e.code === 'PROJECT_LOCKED') return true; throw e; } }

test('each child apply receives only a revision computed inside the same locked run', async t => {
  const f = syncProject(t), a = npmPackage('alpha'); localSkill(f, 'bravo'); writeManifest(f, [a.entry, localEntry('bravo')]);
  const plans = [], applies = [], acquirer = fakeAcquirer([a]);
  const managed = {
    async plan(req, options) { const r = await planManagedItem(req, options); plans.push({ id: req.item.id, revision: r.revision, locked: await lockedNow(f.projectDir) }); return r; },
    async apply(held, req, revision, options) { applies.push({ id: req.item.id, revision, held: isHeldProjectLock(held) && await lockedNow(f.projectDir) }); return applyManagedItem(held, req, revision, options); },
  };
  const parent = await planSync(f.input()), result = await applySync(f.input(), parent.revision, deps(acquirer, { managed }));
  assert.deepEqual(result.applied.map(x => x.id), ['alpha', 'bravo']);
  assert.ok(plans.every(p => p.locked), JSON.stringify(plans));
  for (const id of ['alpha', 'bravo']) {
    const mine = plans.filter(p => p.id === id), apply = applies.find(x => x.id === id);
    assert.equal(mine.length, 2, id); assert.ok(apply.held, id);
    // The revision applied is the one computed last, right before the apply, in this run.
    assert.equal(apply.revision, mine[1].revision); assert.notEqual(apply.revision, parent.revision);
  }
  // bravo's phase B plan still saw the shared ignore file absent; alpha created it, so phase C planned again.
  const bravo = plans.filter(p => p.id === 'bravo'); assert.notEqual(bravo[0].revision, bravo[1].revision);
  // The acquisition ran on a plan of this run, approved with its own revision, at the bound cache operation id.
  assert.equal(acquirer.calls.length, 1); assert.equal(acquirer.calls[0].approval, acquirer.calls[0].planRevision);
  assert.equal(acquirer.calls[0].operationId, byId(parent).alpha.cacheOperationId);
});

test('a forged plan with changed expected hashes is refused, and nothing is written', async t => {
  const f = syncProject(t); localSkill(f, 'bravo'); writeManifest(f, [localEntry('bravo')]);
  const plan = await planSync(f.input()), forged = structuredClone(plan); delete forged.revision;
  forged.items[0].expected.files[0].sha256 = '0'.repeat(64);
  const before = exactTree(f.base);
  await assert.rejects(applySync(f.input(), revisionOf(forged), deps(noAcquirer())), code('STALE_APPROVAL'));
  assert.equal(exactTree(f.base), before);
  await assert.rejects(applySync(f.input(), 'not a revision', deps(noAcquirer())), code('STALE_APPROVAL'));
});

test('a drifted skill is held and shown with its next step; the other skills apply', async t => {
  const f = syncProject(t); for (const id of ['alpha', 'bravo', 'charlie']) localSkill(f, id);
  writeManifest(f, [localEntry('alpha'), localEntry('bravo')]);
  await applySync(f.input(), (await planSync(f.input())).revision, deps(noAcquirer()));
  const edited = path.join(f.projectDir, '.claude/skills/alpha/SKILL.md'); fs.appendFileSync(edited, 'My own line.\n'); const mine = fs.readFileSync(edited, 'utf8');
  writeManifest(f, ['alpha', 'bravo', 'charlie'].map(id => localEntry(id)));
  const plan = await planSync(f.input()), items = byId(plan);
  assert.deepEqual(plan.items.map(i => [i.id, i.state, i.action]), [['alpha', 'drift', 'hold'], ['bravo', 'up-to-date', 'none'], ['charlie', 'local', 'install']]);
  assert.equal(items.alpha.hold.code, 'MANAGED_SKILL_LOCAL_DRIFT');
  const result = await applySync(f.input(), plan.revision, deps(noAcquirer()));
  assert.deepEqual(result.applied.map(x => x.id), ['charlie']); assert.deepEqual(result.held.map(h => [h.id, h.code]), [['alpha', 'MANAGED_SKILL_LOCAL_DRIFT']]);
  assert.match(result.held[0].next, /\.claude\/skills\/alpha/);
  assert.equal(fs.readFileSync(edited, 'utf8'), mine); assert.equal(read(f, '.agents/skills/charlie/SKILL.md'), read(f, '.bowerloom/skills/charlie/SKILL.md'));
});
