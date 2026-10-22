// Spec 06, 3.4, 3.12 and 3.16: apply in a project with bowerloom.json. A config-only project gets .bowerloom; store
// prompts install their command and wrapper; a plain apply never fetches and holds what the lock names but this machine lacks.
import test from '../../../dist/tests/support/lock-slot-retry.js';
import assert from 'node:assert/strict';
import { after } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { denyNetwork, npmPackage, localSkill, writeManifest, prefill } from './sync-fixture.mjs';
import { configWorld, writeConfig, writeLock, storeItem, storePin, pushStore, lockOfRepo, storeTransport, dropStore, code } from './config-fixture.mjs';
import { planProjectApply, applyProjectApply } from '../../../dist/packages/project-sync/src/index.js';

const network = denyNetwork();
after(() => assert.deepEqual(network, [], 'every fetch in this file goes to a fake'));
const input = (w, extra = {}) => ({ project: w.project(), stateRoot: w.stateRoot, home: w.home, harnesses: ['claude', 'codex'], team: null, ...extra });
const signal = () => new AbortController().signal;
const read = (w, rel) => fs.readFileSync(path.join(w.projectDir, rel), 'utf8');
const exists = (w, rel) => fs.existsSync(path.join(w.projectDir, rel));
const apply = async (w, extra = {}, d = {}) => { const plan = await planProjectApply(input(w, extra)); return { plan, result: await applyProjectApply(input(w, extra), plan.revision, signal(), d) }; };

test('5. a config-only project: bowerloomFolder is create; apply creates .bowerloom with mode 0755 and installs', async t => {
  const w = configWorld(t);
  await storeItem(w, 'skill', 'house-style'); writeConfig(w, { skills: [{ id: 'house-style', source: 'store' }] });
  assert.equal(exists(w, '.bowerloom'), false);
  const { plan, result } = await apply(w);
  assert.equal(plan.bowerloomFolder, 'create'); assert.equal(plan.skills.bowerloomFolder, 'create');
  assert.equal(fs.statSync(path.join(w.projectDir, '.bowerloom')).mode & 0o777, 0o755);
  assert.equal(read(w, '.bowerloom/managed/.gitignore'), '*\n');
  assert.deepEqual(result.applied.map(a => [a.kind, a.id, a.origin, a.resolvedFrom]), [['skill', 'house-style', 'store', 'store']]);
  assert.ok(exists(w, '.claude/skills/house-style/SKILL.md'));
  assert.equal((await planProjectApply(input(w))).bowerloomFolder, 'present');
  // A config-only project with nothing to install creates nothing.
  const empty = configWorld(t); writeConfig(empty, {});
  const p = await planProjectApply(input(empty));
  assert.equal(p.actionable, false); assert.equal(exists(empty, '.bowerloom'), false);
});

test('7. a store prompt installs the Claude command and the Codex wrapper', async t => {
  const w = configWorld(t);
  await storeItem(w, 'prompt', 'weekly-update'); writeConfig(w, { prompts: [{ id: 'weekly-update', source: 'store' }] });
  const { plan, result } = await apply(w);
  assert.deepEqual(plan.prompts.map(p => [p.id, p.origin, p.resolvedFrom, p.action]), [['weekly-update', 'store', 'store', 'install']]);
  assert.deepEqual(result.applied.map(a => [a.kind, a.id, a.origin]), [['prompt', 'weekly-update', 'store']]);
  assert.equal(read(w, '.claude/commands/weekly-update.md'), fs.readFileSync(path.join(w.store, 'prompts/weekly-update.md'), 'utf8'));
  assert.match(read(w, '.agents/skills/prompt-weekly-update/SKILL.md'), /It comes from your Bowerloom store\. Edit it there, not this file\./);
});

test('8. checkNames still refuses two items for one place: a store skill and a project skill with one install place', async t => {
  const w = configWorld(t, { folder: true });
  localSkill({ projectDir: w.projectDir }, 'synthetic-db'); writeManifest({ projectDir: w.projectDir }, [{ id: 'synthetic-db', source: { kind: 'local', path: 'skills/synthetic-db' } }]);
  const db = npmPackage('db', { name: 'synthetic-db' }); await storeItem(w, 'skill', 'seed'); storePin(w, db.entry);
  const root = path.join(w.stateRoot, w.project().projectId);
  await prefill({ stateRoot: w.stateRoot, cacheRoot: w.cacheRoot, privateRoot: root, itemsRoot: path.join(root, 'items'), legacyCacheRoot: path.join(root, 'cache') }, db);
  writeConfig(w, { skills: [{ id: 'db', source: 'store' }, { id: 'synthetic-db', source: 'project' }] });
  await assert.rejects(planProjectApply(input(w)), code('APPLY_NAME_COLLISION'));
});

test('14. in config mode a plain apply holds an uncached item from the lock with SKILLS_OFFLINE; an uncached project pin keeps the refusal', async t => {
  const w = configWorld(t, { folder: true }), npm = npmPackage('tanstack-db');
  await storeItem(w, 'skill', 'house-style'); await storeItem(w, 'prompt', 'weekly-update');
  writeConfig(w, { skills: [{ id: 'house-style', source: 'store' }, { id: 'tanstack-db', source: 'store' }], prompts: [{ id: 'weekly-update', source: 'store' }] });
  const repo = pushStore(w);
  writeLock(w, { skills: [lockOfRepo(w, repo, 'skill', 'house-style'), { id: 'tanstack-db', from: 'store', pin: npm.entry }], prompts: [lockOfRepo(w, repo, 'prompt', 'weekly-update')] }); dropStore(w);
  const plan = await planProjectApply(input(w));
  const next = 'Run bowerloom apply --frozen, or bowerloom skills sync.';
  assert.deepEqual(plan.skills.items.map(i => [i.id, i.action, i.hold?.code, i.hold?.next]), [['house-style', 'hold', 'SKILLS_OFFLINE', next], ['tanstack-db', 'hold', 'SKILLS_OFFLINE', next]]);
  assert.deepEqual(plan.prompts.map(p => [p.id, p.action, p.hold?.code]), [['weekly-update', 'hold', 'SKILLS_OFFLINE']]);
  assert.deepEqual(plan.network.hosts, []);
  // A project pin that is not cached still refuses, as in beta.2.
  const p = configWorld(t, { folder: true }), other = npmPackage('other-db');
  writeManifest({ projectDir: p.projectDir }, [other.entry]); writeConfig(p, { skills: [{ id: 'other-db', source: 'project' }] });
  await assert.rejects(planProjectApply(input(p)), code('SKILLS_OFFLINE'));
});

test('15. a locked authored prompt that installs puts api.github.com in the hosts of a frozen apply, cached or not; the store cache folders are made', async t => {
  const w = configWorld(t, { folder: true });
  await storeItem(w, 'prompt', 'weekly-update'); writeConfig(w, { prompts: [{ id: 'weekly-update', source: 'store' }] });
  const repo = pushStore(w); writeLock(w, { prompts: [lockOfRepo(w, repo, 'prompt', 'weekly-update')] }); dropStore(w);
  const plan = await planProjectApply(input(w, { frozen: true }));
  assert.deepEqual(plan.network.hosts, ['api.github.com']);
  assert.deepEqual(plan.prompts.map(p => [p.id, p.action, p.notices, p.storeCache]), [['weekly-update', 'install', null, 'missing']]);
  assert.ok(plan.privateState.create.includes(plan.privateState.cacheRoot) && plan.privateState.create.includes(plan.privateState.storeCacheRoot));
  const transport = storeTransport(repo);
  const result = await applyProjectApply(input(w, { frozen: true }), plan.revision, signal(), { storeTransport: transport });
  assert.deepEqual(result.applied.map(a => [a.kind, a.id, a.resolvedFrom]), [['prompt', 'weekly-update', 'lock']]);
  assert.ok(exists(w, '.claude/commands/weekly-update.md'));
  // Cached now: the hosts still name api.github.com, and the revision does not depend on the cache.
  fs.rmSync(path.join(w.projectDir, '.claude/commands/weekly-update.md')); fs.rmSync(path.join(w.projectDir, '.agents/skills/prompt-weekly-update'), { recursive: true });
  fs.rmSync(path.join(w.projectDir, '.bowerloom/managed/catalog/prompt-weekly-update.json'));
  fs.rmSync(path.join(w.stateRoot, w.project().projectId, 'items', 'prompt-weekly-update'), { recursive: true });
  const cached = await planProjectApply(input(w, { frozen: true }));
  assert.deepEqual(cached.network.hosts, ['api.github.com']); assert.equal(cached.prompts[0].storeCache, 'held'); assert.deepEqual(cached.prompts[0].notices, []);
});
