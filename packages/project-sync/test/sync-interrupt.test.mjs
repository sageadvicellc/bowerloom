import test from '../../../dist/tests/support/lock-slot-retry.js';
import { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { syncBuiltinESMExports } from 'node:module';
import { planSync, applySync } from '../../../dist/packages/project-sync/src/index.js';
import { planManagedItem } from '../../../dist/packages/managed-skills/src/v2-observed.js';
import { applyManagedItem } from '../../../dist/packages/managed-skills/src/v2-transaction.js';
import { denyNetwork, localEntry, syncProject, writeManifest, localSkill, noAcquirer, exists, code, byId } from './sync-fixture.mjs';

const network = denyNetwork();
after(() => assert.deepEqual(network, []));

const MARKER = '.bowerloom/managed-pending.json';
function three(t) {
  const f = syncProject(t); for (const id of ['alpha', 'bravo', 'charlie']) localSkill(f, id);
  writeManifest(f, ['alpha', 'bravo', 'charlie'].map(id => localEntry(id))); return f;
}
const markers = f => [MARKER, '.bowerloom/.managed-pending.json.tmp'].filter(rel => exists(f, rel));

test('an abort after the first child gives SKILLS_SYNC_INTERRUPTED with no marker, and the next plan shows the first skill up to date', async t => {
  const f = three(t), controller = new AbortController(), applied = [];
  const managed = { plan: planManagedItem, async apply(held, req, revision, options) { const r = await applyManagedItem(held, req, revision, options); applied.push(req.item.id); controller.abort(); return r; } };
  const plan = await planSync(f.input());
  await assert.rejects(applySync(f.input(), plan.revision, { acquirer: noAcquirer(), signal: controller.signal, managed }),
    e => e.code === 'SKILLS_SYNC_INTERRUPTED' && /alpha/.test(e.message) && /bowerloom skills sync/.test(e.message) && /bowerloom skills recover plan/.test(e.message));
  assert.deepEqual(applied, ['alpha']); assert.deepEqual(markers(f), []);
  const next = byId(await planSync(f.input()));
  assert.deepEqual([next.alpha.state, next.bravo.action, next.charlie.action], ['up-to-date', 'install', 'install']);
});

test('an abort while a child applies is deferred to the item boundary: that child finishes whole', async t => {
  const f = three(t), controller = new AbortController(), seen = [];
  const managed = { plan: planManagedItem, async apply(held, req, revision, options) { controller.abort(); const r = await applyManagedItem(held, req, revision, options); seen.push([req.item.id, r.state]); return r; } };
  const plan = await planSync(f.input());
  await assert.rejects(applySync(f.input(), plan.revision, { acquirer: noAcquirer(), signal: controller.signal, managed }), code('SKILLS_SYNC_INTERRUPTED'));
  assert.deepEqual(seen, [['alpha', 'committed']]); assert.deepEqual(markers(f), []);
  assert.equal(exists(f, '.agents/skills/alpha/SKILL.md'), true); assert.equal(exists(f, '.claude/skills/bravo'), false);
});

test('an abort before the lock run writes nothing', async t => {
  const f = three(t), controller = new AbortController(), plan = await planSync(f.input()); controller.abort();
  await assert.rejects(applySync(f.input(), plan.revision, { acquirer: noAcquirer(), signal: controller.signal }), code('SKILLS_SYNC_INTERRUPTED'));
  assert.equal(fs.existsSync(f.stateRoot), false); assert.equal(exists(f, '.bowerloom/managed'), false);
});

test('a child that fails inside its transaction leaves exactly one recoverable operation, names it, and stops the run', async t => {
  const f = three(t), rename = fs.renameSync, target = path.join(f.projectDir, '.agents/skills/bravo');
  t.mock.method(fs, 'renameSync', (from, to) => { if (String(to) === target) throw Object.assign(new Error('injected'), { code: 'EIO' }); return rename(from, to); }); syncBuiltinESMExports();
  const plan = await planSync(f.input());
  await assert.rejects(applySync(f.input(), plan.revision, { acquirer: noAcquirer(), signal: new AbortController().signal }),
    e => e.code === 'MANAGED_SKILL_RECOVERY_REQUIRED' && /bowerloom skills recover plan --item bravo/.test(e.message));
  t.mock.restoreAll(); syncBuiltinESMExports();
  assert.deepEqual(markers(f), [MARKER]);
  assert.equal(exists(f, '.agents/skills/alpha/SKILL.md'), true); assert.equal(exists(f, '.claude/skills/charlie'), false);
  await assert.rejects(planSync(f.input()), e => e.code === 'MANAGED_SKILL_RECOVERY_REQUIRED' && /--item bravo/.test(e.message));
});
