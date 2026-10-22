// Spec 06, 3.8: the create commands in a project with bowerloom.json add the item to it; a config-only project gets
// .bowerloom first; a project team create with no brief.json uses the store brief.
import test from '../../../dist/tests/support/lock-slot-retry.js';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { configWorld, writeConfig, code } from '../../project-sync/test/config-fixture.mjs';
import { planCreate, applyCreate } from '../../../dist/packages/project-authoring/src/index.js';
import { withProjectLock, discoverProject } from '../../../dist/packages/project-context/src/index.js';

const readJson = (w, rel) => JSON.parse(fs.readFileSync(path.join(w.projectDir, rel), 'utf8'));
async function create(w, input) {
  const plan = await planCreate(input);
  await withProjectLock(w.projectDir, new AbortController().signal, held => applyCreate(input, plan.revision, held, undefined, discoverProject(w.projectDir, w.home)));
  return plan;
}

test('1 and 3. a create in a config-only project creates .bowerloom first, then the item, its skills.json entry and the config entry', async t => {
  const w = configWorld(t); writeConfig(w, {});
  const plan = await create(w, { kind: 'skill', project: w.projectDir, name: 'house-style', teams: [] });
  assert.equal(plan.bowerloomFolder, 'create'); assert.equal(plan.bowerloom, null);
  assert.ok(plan.config.text.includes('"house-style"'));
  assert.equal(fs.statSync(path.join(w.projectDir, '.bowerloom')).mode & 0o777, 0o755);
  assert.deepEqual(readJson(w, 'bowerloom.json').skills, [{ id: 'house-style', source: 'project' }]);
  assert.deepEqual(readJson(w, '.bowerloom/skills.json').skills.map(s => s.id), ['house-style']);
  assert.ok(fs.existsSync(path.join(w.projectDir, '.bowerloom/skills/house-style/SKILL.md')));
  const prompt = await create(w, { kind: 'prompt', project: w.projectDir, name: 'weekly-update', teams: [] });
  assert.equal(prompt.bowerloomFolder, 'present');
  assert.deepEqual(readJson(w, 'bowerloom.json').prompts, [{ id: 'weekly-update', source: 'project' }]);
});

test('2. a create whose id the config lists from the store refuses CONFIG_DUPLICATE_ID at plan time', async t => {
  const w = configWorld(t); writeConfig(w, { skills: [{ id: 'house-style', source: 'store' }] });
  await assert.rejects(planCreate({ kind: 'skill', project: w.projectDir, name: 'house-style', teams: [] }), code('CONFIG_DUPLICATE_ID'));
  // A project with no config is unchanged: create never makes bowerloom.json.
  const legacy = configWorld(t, { folder: true });
  const plan = await create(legacy, { kind: 'prompt', project: legacy.projectDir, name: 'weekly-update', teams: [] });
  assert.equal(plan.config, null); assert.equal(fs.existsSync(path.join(legacy.projectDir, 'bowerloom.json')), false);
});

test('4 and 5. a project team create with a config and no brief.json uses the store brief; an invalid brief.json still refuses', async t => {
  const w = configWorld(t); writeConfig(w, {});
  await create(w, { kind: 'team', project: w.projectDir, name: 'research' });
  assert.ok(fs.existsSync(path.join(w.projectDir, '.bowerloom/teams/research/team.yaml')));
  assert.deepEqual(readJson(w, 'bowerloom.json').teams, [{ id: 'research', source: 'project' }]);
  assert.equal(readJson(w, '.bowerloom/teams/research/assets/brief.json').projectName, 'Store team');
  fs.writeFileSync(path.join(w.projectDir, '.bowerloom/brief.json'), '{', { mode: 0o644 });
  await assert.rejects(planCreate({ kind: 'team', project: w.projectDir, name: 'ops' }), code('PROJECT_BRIEF_INVALID'));
});

test('6. the finish path repeats the config step for a missing entry', async t => {
  const w = configWorld(t); writeConfig(w, {});
  const input = { kind: 'prompt', project: w.projectDir, name: 'weekly-update', teams: [] }, plan = await planCreate(input);
  // An interrupted create: the item landed with its pending record, and neither the receipt nor the config was written.
  await assert.rejects(withProjectLock(w.projectDir, new AbortController().signal, async held => {
    const fsMod = await import('node:fs'); const original = fsMod.default.renameSync;
    fsMod.default.renameSync = (from, to) => { if (String(to).endsWith('bowerloom.json')) throw new Error('crash'); return original(from, to); };
    try { await applyCreate(input, plan.revision, held, undefined, discoverProject(w.projectDir, w.home)); } finally { fsMod.default.renameSync = original; }
  }), /crash/);
  assert.deepEqual(readJson(w, 'bowerloom.json').prompts, []);
  const finish = await planCreate({ kind: 'prompt', project: w.projectDir, name: 'other', teams: [] });
  assert.equal(finish.finish.id, 'weekly-update');
  await withProjectLock(w.projectDir, new AbortController().signal, held => applyCreate({ kind: 'prompt', project: w.projectDir, name: 'other', teams: [] }, finish.revision, held, undefined, discoverProject(w.projectDir, w.home)));
  assert.deepEqual(readJson(w, 'bowerloom.json').prompts, [{ id: 'other', source: 'project' }, { id: 'weekly-update', source: 'project' }]);
});
