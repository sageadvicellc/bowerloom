// Step 0 of Bowerloom 0.8: the engine rename in the planners. An engine without a writer is refused, never skipped.
// An old skills.json plans like a current one and is never changed. Managed copies keep the stored form of their catalogs.
import test from '../../../dist/tests/support/lock-slot-retry.js';
import { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { planSync, applySync, planProjectApply, applyProjectApply } from '../../../dist/packages/project-sync/src/index.js';
import { denyNetwork, localEntry, syncProject, writeManifest, localSkill, noAcquirer, deps, exactTree, read } from './sync-fixture.mjs';

const network = denyNetwork();
after(() => assert.deepEqual(network, []));
const signal = () => new AbortController().signal;
const refused = (engine) => error => error?.code === 'ENGINE_NO_WRITER' && error.message === `no writer for engine ${engine} yet`;
function manifestFile(f, value) { const file = path.join(f.projectDir, '.bowerloom/skills.json'); fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n', { mode: 0o644 }); fs.chmodSync(file, 0o644); return file; }
const SKILLS = [localEntry('house-style')];

test('skills sync refuses a skills.json that names an engine with no writer, and writes nothing', async t => {
  for (const engine of ['opencode', 'pi', 'deepseek-harness']) {
    const f = syncProject(t); localSkill(f, 'house-style');
    manifestFile(f, { format: 'bowerloom/skills/v1beta1', engines: ['claude-code', engine].sort(), skills: SKILLS });
    const before = exactTree(f.base);
    await assert.rejects(planSync(f.input()), refused(engine), engine);
    assert.deepEqual(exactTree(f.base), before, 'nothing changed');
  }
});

test('apply refuses an engine with no writer, whether it comes from the command or from the input', async t => {
  const f = syncProject(t); localSkill(f, 'house-style'); writeManifest(f, SKILLS);
  const before = exactTree(f.base);
  for (const engine of ['opencode', 'pi', 'deepseek-harness']) {
    await assert.rejects(planProjectApply({ project: f.project(), stateRoot: f.stateRoot, engines: ['claude-code', engine], team: null }), refused(engine), engine);
  }
  assert.deepEqual(exactTree(f.base), before);
});

test('skills sync and apply of an old skills.json plan for claude-code and codex, and leave skills.json byte for byte unchanged', async t => {
  const f = syncProject(t); localSkill(f, 'house-style'); writeManifest(f, SKILLS);
  const file = path.join(f.projectDir, '.bowerloom/skills.json'), bytes = fs.readFileSync(file);
  assert.match(bytes.toString('utf8'), /"harnesses": \[\s+"claude",\s+"codex"\s+\]/, 'the fixture is in the old form');
  const plan = await planSync(f.input());
  assert.deepEqual(plan.engines, ['claude-code', 'codex']); assert.equal(plan.harnesses, undefined);
  assert.deepEqual(plan.items.map(i => i.engines), [['claude-code', 'codex']]);
  const result = await applySync(f.input(), plan.revision, deps(noAcquirer()));
  assert.ok(result);
  assert.deepEqual(fs.readFileSync(file), bytes, 'sync does not rewrite skills.json');
  assert.equal(read(f, '.claude/skills/house-style/SKILL.md').includes('house style'), true);
  assert.equal(fs.existsSync(path.join(f.projectDir, '.agents/skills/house-style/SKILL.md')), true);
  const applyPlan = await planProjectApply({ project: f.project(), stateRoot: f.stateRoot, engines: ['claude-code'], team: null });
  assert.deepEqual(applyPlan.engines, ['claude-code']);
  assert.deepEqual(fs.readFileSync(file), bytes, 'apply does not rewrite skills.json');
});

test('a current skills.json plans the same way', async t => {
  const f = syncProject(t); localSkill(f, 'house-style');
  manifestFile(f, { format: 'bowerloom/skills/v1beta1', engines: ['claude-code', 'codex'], skills: SKILLS });
  const plan = await planSync(f.input());
  assert.deepEqual(plan.engines, ['claude-code', 'codex']);
});

test('managed copies keep the stored spelling in their catalog: the catalog is a hashed record and does not change in this step', async t => {
  const f = syncProject(t); localSkill(f, 'house-style'); writeManifest(f, SKILLS);
  const plan = await planProjectApply({ project: f.project(), stateRoot: f.stateRoot, engines: ['claude-code', 'codex'], team: null });
  await applyProjectApply({ project: f.project(), stateRoot: f.stateRoot, engines: ['claude-code', 'codex'], team: null }, plan.revision, signal());
  const catalog = JSON.parse(read(f, '.bowerloom/managed/catalog/house-style.json'));
  assert.deepEqual(catalog.harnesses, ['claude', 'codex']); assert.equal(catalog.engines, undefined);
});
