// Step 0 of Bowerloom 0.8: use and unuse write bowerloom.json back in the form it was read in. An old file keeps
// `harnesses` and `claude`. A plan alone never changes the file.
import test from '../../../dist/tests/support/lock-slot-retry.js';
import assert from 'node:assert/strict';
import { after } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { denyNetwork } from './sync-fixture.mjs';
import { configWorld, writeConfig, storeItem } from './config-fixture.mjs';
import { planConfigChange, applyConfigChange } from '../../../dist/packages/project-sync/src/index.js';
import { withProjectLock, discoverProject } from '../../../dist/packages/project-context/src/index.js';

const network = denyNetwork();
after(() => assert.deepEqual(network, [], 'every network read goes to a fake'));
const ctx = w => discoverProject(w.projectDir, w.home);
const plan = (w, op, kind, id) => planConfigChange({ project: ctx(w), home: w.home, op, kind, id });
async function change(w, op, kind, id) {
  const p = await plan(w, op, kind, id);
  return withProjectLock(w.projectDir, new AbortController().signal, async held => applyConfigChange(p, p.revision, held, ctx(w), w.home, {}));
}
const OLD = `${JSON.stringify({ format: 'bowerloom/project/v1beta1', harnesses: ['claude', 'codex'], skills: [], prompts: [], teams: [] }, null, 2)}\n`;

test('use and unuse keep the old form of an existing bowerloom.json, and planning changes nothing', async t => {
  const w = configWorld(t), file = path.join(w.projectDir, 'bowerloom.json');
  fs.writeFileSync(file, OLD, { mode: 0o644 }); fs.chmodSync(file, 0o644); await storeItem(w, 'skill', 'house-style');
  const stat = fs.statSync(file);
  await plan(w, 'use', 'skill', 'house-style');
  assert.equal(fs.readFileSync(file, 'utf8'), OLD, 'a plan reads only'); assert.equal(fs.statSync(file).mtimeMs, stat.mtimeMs);
  await change(w, 'use', 'skill', 'house-style');
  const used = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.deepEqual(used.harnesses, ['claude', 'codex']); assert.equal(used.engines, undefined);
  assert.deepEqual(used.skills, [{ id: 'house-style', source: 'store' }]);
  await change(w, 'unuse', 'skill', 'house-style');
  assert.equal(fs.readFileSync(file, 'utf8'), OLD, 'the file is back to its first bytes');
});

test('use and unuse keep the current form of a bowerloom.json that Bowerloom wrote', async t => {
  const w = configWorld(t); writeConfig(w, {}); await storeItem(w, 'skill', 'house-style');
  const file = path.join(w.projectDir, 'bowerloom.json'), first = fs.readFileSync(file, 'utf8');
  assert.deepEqual(JSON.parse(first).engines, ['claude-code', 'codex']);
  await change(w, 'use', 'skill', 'house-style');
  const used = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.deepEqual(used.engines, ['claude-code', 'codex']); assert.equal(used.harnesses, undefined);
  await change(w, 'unuse', 'skill', 'house-style');
  assert.equal(fs.readFileSync(file, 'utf8'), first);
});
