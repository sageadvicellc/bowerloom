import test from '../../../dist/tests/support/lock-slot-retry.js';
import { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { planSync, applySync, SYNC_PLAN_FORMAT } from '../../../dist/packages/project-sync/src/index.js';
import { planManagedItem } from '../../../dist/packages/managed-skills/src/v2-observed.js';
import { applyManagedItem } from '../../../dist/packages/managed-skills/src/v2-transaction.js';
import { revisionOf } from '../../../dist/packages/skill-sources/src/validation.js';
import { denyNetwork, npmPackage, localEntry, syncProject, writeManifest, localSkill, fakeAcquirer, noAcquirer, prefill, exactTree, read, exists, deps, code, byId } from './sync-fixture.mjs';

const network = denyNetwork();
after(() => assert.deepEqual(network, []));

async function sync(f, acquirer, extra = {}) { const plan = await planSync(f.input(extra)); return { plan, result: await applySync(f.input(extra), plan.revision, deps(acquirer)) }; }

test('a first plan classifies needs-fetch, cached and local, binds every input and writes nothing', async t => {
  const f = syncProject(t), a = npmPackage('alpha'), b = npmPackage('bravo');
  localSkill(f, 'house-style'); writeManifest(f, [a.entry, b.entry, localEntry('house-style')]); await prefill(f, b);
  const before = exactTree(f.base), plan = await planSync(f.input());
  assert.equal(plan.format, SYNC_PLAN_FORMAT); assert.equal(plan.writesAuthorized, false); assert.equal(plan.executionAuthorized, false);
  assert.match(plan.revision, /^[a-f0-9]{64}$/);
  const { revision, ...body } = plan; assert.equal(revisionOf(body), revision);
  assert.deepEqual(plan.harnesses, ['claude', 'codex']); assert.equal(plan.team, null); assert.equal(plan.offline, false);
  assert.equal(plan.project.dir, f.projectDir); assert.deepEqual(plan.project.identity, f.project().identity);
  assert.equal(plan.manifest.sha256.length, 64); assert.equal(plan.manifest.bytes, fs.statSync(path.join(f.projectDir, '.bowerloom/skills.json')).size);
  assert.equal(plan.privateState.root, f.privateRoot); assert.equal(plan.privateState.cacheRoot, f.cacheRoot); assert.equal(plan.privateState.itemsRoot, f.itemsRoot);
  assert.deepEqual(plan.privateState.create, ['alpha', 'bravo', 'house-style'].map(id => path.join(f.itemsRoot, id)));
  const items = byId(plan);
  assert.deepEqual(plan.items.map(i => [i.id, i.state, i.action]), [['alpha', 'needs-fetch', 'install'], ['bravo', 'cached', 'install'], ['house-style', 'local', 'install']]);
  assert.match(items.alpha.requestDigest, /^[a-f0-9]{64}$/); assert.match(items.alpha.cacheOperationId, /^[a-f0-9]{32}$/);
  assert.equal(items['house-style'].requestDigest, null); assert.equal(items['house-style'].cacheOperationId, null);
  assert.deepEqual(items.alpha.expected.files, a.entry.files.map(x => ({ path: x.path, sha256: x.sha256, bytes: x.bytes })).sort((x, y) => x.path < y.path ? -1 : 1));
  assert.deepEqual(items.alpha.expected.surfaces.map(s => [s.id, s.path]), [
    ['canonical', '.bowerloom/managed/skills/alpha'], ['projection-claude', '.claude/skills/synthetic-alpha'], ['projection-codex', '.agents/skills/synthetic-alpha'], ['catalog', '.bowerloom/managed/catalog/alpha.json']]);
  assert.ok(items.alpha.before.every(s => /^[a-f0-9]{64}$/.test(s.stablePinsDigest)));
  assert.deepEqual(plan.items.map(i => i.previousReceiptRevision), [null, null, null]);
  assert.deepEqual(plan.network, { required: true, hosts: ['registry.npmjs.org'] });
  assert.equal((await planSync(f.input())).revision, plan.revision);
  assert.equal(exactTree(f.base), before);
});

test('after a sync every skill is up to date; then each change gets its own state', async t => {
  const f = syncProject(t), a = npmPackage('alpha'), b = npmPackage('bravo'), d = npmPackage('delta');
  localSkill(f, 'house-style'); writeManifest(f, [a.entry, b.entry, d.entry, localEntry('house-style')]);
  const { result } = await sync(f, fakeAcquirer([a, b, d]));
  assert.deepEqual(result.applied.map(x => [x.id, x.action]), [['alpha', 'install'], ['bravo', 'install'], ['delta', 'install'], ['house-style', 'install']]);
  for (const root of ['.bowerloom/managed/skills/alpha', '.claude/skills/synthetic-alpha', '.agents/skills/synthetic-alpha']) assert.equal(read(f, root + '/references/guide.md'), '# Guide\nVersion 1.0.0\n');
  assert.equal(read(f, '.bowerloom/managed/.gitignore'), '*\n');
  const steady = await planSync(f.input());
  assert.deepEqual(steady.items.map(i => [i.state, i.action]), Array(4).fill(['up-to-date', 'none']));
  assert.deepEqual(steady.network, { required: false, hosts: [] }); assert.deepEqual(steady.privateState.create, []);
  assert.ok(steady.items.every(i => /^[a-f0-9]{64}$/.test(i.previousReceiptRevision)));

  const a2 = npmPackage('alpha', { version: '2.0.0' });
  fs.writeFileSync(path.join(f.projectDir, '.bowerloom/skills/house-style/references/notes.md'), '# Notes\nTwo.\n');
  fs.appendFileSync(path.join(f.projectDir, '.claude/skills/synthetic-bravo/SKILL.md'), 'A local edit.\n');
  writeManifest(f, [a2.entry, b.entry, localEntry('house-style')]);
  const changed = byId(await planSync(f.input()));
  assert.deepEqual([changed.alpha.state, changed.alpha.action, changed.alpha.cache.status], ['pin-changed', 'update', 'needs-fetch']);
  assert.deepEqual([changed.bravo.state, changed.bravo.action, changed.bravo.hold.code], ['drift', 'hold', 'MANAGED_SKILL_LOCAL_DRIFT']);
  assert.match(changed.bravo.hold.next, /\.claude\/skills\/synthetic-bravo/);
  assert.deepEqual([changed['house-style'].state, changed['house-style'].action], ['local', 'update']);
  assert.deepEqual([changed.delta.state, changed.delta.action], ['orphaned', 'none']);
});

test('a harness added in skills.json updates the skill; a harness removed is kept and reported', async t => {
  const f = syncProject(t); localSkill(f, 'house-style'); writeManifest(f, [localEntry('house-style')], ['codex']);
  await sync(f, noAcquirer()); assert.equal(exists(f, '.claude/skills/house-style'), false); assert.equal(exists(f, '.agents/skills/house-style/SKILL.md'), true);
  writeManifest(f, [localEntry('house-style')], ['claude', 'codex']);
  const added = (await planSync(f.input())).items[0];
  assert.deepEqual([added.state, added.action, added.harnesses], ['harnesses-changed', 'update', ['claude', 'codex']]);
  await applySync(f.input(), (await planSync(f.input())).revision, deps(noAcquirer()));
  assert.equal(exists(f, '.claude/skills/house-style/SKILL.md'), true);
  writeManifest(f, [localEntry('house-style')], ['codex']);
  const removed = (await planSync(f.input())).items[0];
  assert.deepEqual([removed.state, removed.action, removed.harnesses], ['harnesses-changed', 'none', ['claude', 'codex']]);
});

test('editing skills.json after the plan gives STALE_APPROVAL and writes nothing anywhere', async t => {
  const f = syncProject(t), a = npmPackage('alpha'); writeManifest(f, [a.entry]);
  const plan = await planSync(f.input()); localSkill(f, 'house-style'); writeManifest(f, [a.entry, localEntry('house-style')]);
  const before = exactTree(f.base), acquirer = fakeAcquirer([a]);
  await assert.rejects(applySync(f.input(), plan.revision, deps(acquirer)), code('STALE_APPROVAL'));
  assert.equal(exactTree(f.base), before); assert.deepEqual(acquirer.calls, []); assert.equal(fs.existsSync(f.stateRoot), false);
});

test('a team selects its own skills and the skills of every team; an unknown team refuses', async t => {
  const f = syncProject(t); fs.mkdirSync(path.join(f.projectDir, '.bowerloom/teams/first-team'), { recursive: true, mode: 0o755 });
  for (const id of ['xray', 'yankee', 'zulu']) localSkill(f, id);
  writeManifest(f, [localEntry('xray', ['first-team']), localEntry('yankee', ['other-team']), localEntry('zulu')]);
  const plan = await planSync(f.input({ team: 'first-team' }));
  assert.equal(plan.team, 'first-team'); assert.deepEqual(plan.items.map(i => i.id), ['xray', 'zulu']);
  await assert.rejects(planSync(f.input({ team: 'nobody' })), code('TEAM_NOT_FOUND'));
});

test('refusals before any item: no skills.json, legacy v1 content, a pending operation', async t => {
  const f = syncProject(t);
  await assert.rejects(planSync(f.input()), code('MANIFEST_NOT_FOUND'));
  localSkill(f, 'house-style'); writeManifest(f, [localEntry('house-style')]);
  fs.mkdirSync(path.join(f.projectDir, '.bowerloom-skills'), { mode: 0o700 });
  await assert.rejects(planSync(f.input()), e => e.code === 'MANAGED_SKILL_LEGACY_PRESENT' && /bowerloom skills migrate plan --state/.test(e.message));
  fs.rmdirSync(path.join(f.projectDir, '.bowerloom-skills'));
  fs.writeFileSync(path.join(f.projectDir, '.bowerloom/managed-pending.json'), '{}\n', { mode: 0o600 });
  await assert.rejects(planSync(f.input()), e => e.code === 'MANAGED_SKILL_RECOVERY_REQUIRED' && /bowerloom skills recover plan/.test(e.message));
});

test('history: a full item is held with a safe manual rule, and nothing is deleted; an up-to-date item is not held', { timeout: 600_000 }, async t => {
  const f = syncProject(t); localSkill(f, 'house-style'); writeManifest(f, [localEntry('house-style')]);
  await sync(f, noAcquirer());
  const stateDir = path.join(f.itemsRoot, 'house-style'); let previous = (await planSync(f.input())).items[0].previousReceiptRevision;
  for (let i = 0; fs.readdirSync(stateDir).length < 64; i++) {
    fs.writeFileSync(path.join(f.projectDir, '.bowerloom/skills/house-style/references/notes.md'), `# Notes\n${i}\n`);
    const req = { operation: 'update', projectDir: f.projectDir, stateDir, item: { kind: 'skill', id: 'house-style' }, harnesses: ['claude', 'codex'], source: { kind: 'local', path: 'skills/house-style' }, expectedPreviousRevision: previous, minFreeBytes: 33554432, legacy: null };
    previous = (await applyManagedItem(null, req, (await planManagedItem(req)).revision)).revision;
  }
  const full = (await planSync(f.input())).items[0]; assert.deepEqual([full.state, full.action], ['up-to-date', 'none']);
  fs.writeFileSync(path.join(f.projectDir, '.bowerloom/skills/house-style/references/notes.md'), '# Notes\nlast\n');
  const ops = fs.readdirSync(stateDir).sort(), held = (await planSync(f.input())).items[0];
  assert.deepEqual([held.state, held.action, held.hold.code], ['local', 'hold', 'MANAGED_SKILL_HISTORY_FULL']);
  // Review M5 finding 7: the rule names the folder relative to the private state folder, never by its absolute path.
  assert.ok(held.hold.next.includes('items/house-style') && /\bmv\b/.test(held.hold.next) && !held.hold.next.includes(stateDir), held.hold.next);
  const result = await applySync(f.input(), (await planSync(f.input())).revision, deps(noAcquirer()));
  assert.deepEqual(result.applied, []); assert.deepEqual(result.held.map(h => [h.id, h.code]), [['house-style', 'MANAGED_SKILL_HISTORY_FULL']]);
  assert.deepEqual(fs.readdirSync(stateDir).sort(), ops);
});
