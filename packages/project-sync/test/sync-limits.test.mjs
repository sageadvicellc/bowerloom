// The sync item limit (Hanna, global skill cache, phase 3): 256 items, room for 128 skills.json entries and as many
// skills that skills.json no longer names.
import test from '../../../dist/tests/support/lock-slot-retry.js';
import { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { planSync, SYNC_ITEM_LIMIT, syncError } from '../../../dist/packages/project-sync/src/index.js';
import { denyNetwork, localEntry, syncProject, writeManifest, localSkill, exactTree, code } from './sync-fixture.mjs';

const network = denyNetwork();
after(() => assert.deepEqual(network, []));

/** `n` authored local skills, all in skills.json. */
function locals(f, n) { const ids = Array.from({ length: n }, (_, i) => `local-${String(i).padStart(3, '0')}`); for (const id of ids) localSkill(f, id); writeManifest(f, ids.map(id => localEntry(id))); return ids; }
/** `n` catalogs of skills that skills.json no longer names: each one is an orphan item of the plan. */
function orphans(f, n) { const dir = path.join(f.projectDir, '.bowerloom/managed/catalog'); fs.mkdirSync(dir, { recursive: true, mode: 0o755 }); for (let i = 0; i < n; i++) fs.writeFileSync(path.join(dir, `gone-${String(i).padStart(3, '0')}.json`), '{}\n', { mode: 0o644 }); }

test('a sync plans 128 skills.json skills and 128 orphans; the 257th item refuses SKILLS_SYNC_LIMIT before any write', async t => {
  assert.equal(SYNC_ITEM_LIMIT, 256);
  assert.match(syncError('SKILLS_SYNC_LIMIT').message, /256 skills at most/);
  const f = syncProject(t); locals(f, 128);
  const plan = await planSync(f.input());
  assert.equal(plan.items.length, 128); assert.ok(plan.items.every(i => i.state === 'local' && i.action === 'install'));
  orphans(f, 128);
  assert.equal((await planSync(f.input())).items.length, 256);
  orphans(f, 129);
  const before = exactTree(f.base);
  await assert.rejects(planSync(f.input()), code('SKILLS_SYNC_LIMIT'));
  assert.equal(exactTree(f.base), before);
});
