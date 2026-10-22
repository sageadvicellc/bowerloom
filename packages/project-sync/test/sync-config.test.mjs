// Spec 06, 3.12, 3.16, 3.18 and 4.4: skills sync in a project with bowerloom.json. Store items install from the live
// store or from the lock; the plan binds the config, the lock, the store, and each item's content key.
import test from '../../../dist/tests/support/lock-slot-retry.js';
import assert from 'node:assert/strict';
import { after } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { denyNetwork, npmPackage, fakeAcquirer, noAcquirer, prefill, localSkill, writeManifest, deps, byId } from './sync-fixture.mjs';
import { configWorld, writeConfig, writeLock, storeItem, storePin, editStore, pushStore, lockOfRepo, storeTransport, dropStore, code } from './config-fixture.mjs';
import { planSync, applySync, observeSync } from '../../../dist/packages/project-sync/src/index.js';
import { withProjectLock } from '../../../dist/packages/project-context/src/index.js';
import { planCreate, applyCreate } from '../../../dist/packages/project-authoring/src/index.js';

const network = denyNetwork();
after(() => assert.deepEqual(network, [], 'every fetch in this file goes to a fake'));
const input = (w, extra = {}) => ({ project: w.project(), stateRoot: w.stateRoot, home: w.home, team: null, offline: false, ...extra });
const read = (w, rel) => fs.readFileSync(path.join(w.projectDir, rel), 'utf8');
const exists = (w, rel) => fs.existsSync(path.join(w.projectDir, rel));
const sync = async (w, extra = {}, d = deps(noAcquirer())) => { const plan = await planSync(input(w, extra)); return { plan, result: await applySync(input(w, extra), plan.revision, d) }; };
const f = w => ({ projectDir: w.projectDir, stateRoot: w.stateRoot, cacheRoot: w.cacheRoot, privateRoot: path.join(w.stateRoot, w.project().projectId), itemsRoot: path.join(w.stateRoot, w.project().projectId, 'items'), legacyCacheRoot: path.join(w.stateRoot, w.project().projectId, 'cache') });

test('1. the plan binds config, lock, store, each content key, the lock pin and the hosts; a change to any changes the revision', async t => {
  const w = configWorld(t, { folder: true });
  await storeItem(w, 'skill', 'house-style'); const npm = npmPackage('tanstack-db'); storePin(w, npm.entry);
  writeConfig(w, { skills: [{ id: 'house-style', source: 'store' }, { id: 'tanstack-db', source: 'store' }] });
  const repo = pushStore(w); writeLock(w, { skills: [lockOfRepo(w, repo, 'skill', 'house-style'), { id: 'tanstack-db', from: 'store', pin: npm.entry }] });
  const plan = await planSync(input(w));
  assert.equal(plan.format, 'bowerloom/skills-sync-plan/v1beta2');
  assert.match(plan.config.sha256, /^[a-f0-9]{64}$/); assert.match(plan.lock.sha256, /^[a-f0-9]{64}$/);
  assert.equal(plan.store.dir, fs.realpathSync(w.store)); assert.match(plan.store.skills.sha256, /^[a-f0-9]{64}$/);
  const items = byId(plan);
  assert.equal(items['house-style'].resolvedFrom, 'store'); assert.equal(items['house-style'].origin, 'store'); assert.equal(items['house-style'].kind, 'local');
  assert.match(items['tanstack-db'].requestDigest, /^[a-f0-9]{64}$/);
  assert.deepEqual(plan.network.hosts, ['registry.npmjs.org']);
  assert.equal(plan.bowerloomFolder, 'present'); assert.equal(plan.frozen, false);
  const revisions = new Set([plan.revision]);
  // The config changes.
  writeConfig(w, { skills: [{ id: 'house-style', source: 'store' }, { id: 'tanstack-db', source: 'store' }], harnesses: ['claude'] }); revisions.add((await planSync(input(w))).revision);
  writeConfig(w, { skills: [{ id: 'house-style', source: 'store' }, { id: 'tanstack-db', source: 'store' }] });
  assert.equal((await planSync(input(w))).revision, plan.revision);
  // The lock changes.
  writeLock(w, { skills: [lockOfRepo(w, repo, 'skill', 'house-style'), { id: 'tanstack-db', from: 'store', pin: npm.entry }], prompts: [] });
  fs.appendFileSync(path.join(w.projectDir, 'bowerloom.lock.json'), ' '); revisions.add((await planSync(input(w))).revision);
  writeLock(w, { skills: [lockOfRepo(w, repo, 'skill', 'house-style'), { id: 'tanstack-db', from: 'store', pin: npm.entry }] });
  // The store's skills.json changes (the content key of the pin with it).
  storePin(w, npmPackage('tanstack-db', { version: '1.0.1' }).entry); revisions.add((await planSync(input(w))).revision);
  storePin(w, npm.entry);
  // A store skill's bytes change.
  editStore(w, 'skills/house-style/SKILL.md', '---\nname: house-style\ndescription: Changed.\n---\nx\n'); revisions.add((await planSync(input(w))).revision);
  assert.equal(revisions.size, 5);
  // With no store, the authored item resolves from the lock: its content key is the lock hash and the lock pin is bound.
  dropStore(w);
  const fromLock = byId(await planSync(input(w)));
  assert.equal(fromLock['house-style'].resolvedFrom, 'lock'); assert.equal(fromLock['house-style'].requestDigest, fromLock['house-style'].lockPin.hash);
  assert.deepEqual((await planSync(input(w))).network.hosts, ['api.github.com', 'registry.npmjs.org']);
});

test('2. a pinned store skill already in the cache needs no fetch; the plan names registry.npmjs.org only as a possible host', async t => {
  const w = configWorld(t, { folder: true }), npm = npmPackage('tanstack-db');
  await storeItem(w, 'skill', 'seed'); storePin(w, npm.entry);
  writeConfig(w, { skills: [{ id: 'tanstack-db', source: 'store' }] });
  await prefill(f(w), npm);
  const acquirer = noAcquirer(), { plan, result } = await sync(w, {}, deps(acquirer));
  assert.equal(byId(plan)['tanstack-db'].state, 'cached'); assert.equal(plan.network.required, false); assert.deepEqual(plan.network.hosts, ['registry.npmjs.org']);
  assert.deepEqual(result.applied.map(a => [a.id, a.origin, a.resolvedFrom]), [['tanstack-db', 'store', 'store']]);
  assert.equal(acquirer.calls.length, 0);
  assert.ok(exists(w, '.claude/skills/synthetic-tanstack-db/SKILL.md'));
});

test('3. a fake transport fetches an authored lock item the store cache lacks, in phase A, from api.github.com', async t => {
  const w = configWorld(t, { folder: true });
  await storeItem(w, 'skill', 'house-style');
  writeConfig(w, { skills: [{ id: 'house-style', source: 'store' }] });
  const repo = pushStore(w); writeLock(w, { skills: [lockOfRepo(w, repo, 'skill', 'house-style')] }); dropStore(w);
  const transport = storeTransport(repo);
  const { plan, result } = await sync(w, {}, deps(noAcquirer(), { storeTransport: transport }));
  assert.equal(byId(plan)['house-style'].state, 'needs-fetch'); assert.equal(byId(plan)['house-style'].storeCache, 'missing'); assert.equal(plan.network.required, true);
  assert.deepEqual(result.fetched, ['house-style']);
  assert.ok(transport.urls.length > 0 && transport.urls.every(u => u.startsWith('https://api.github.com/repos/sageadvicellc/store/git/')));
  assert.deepEqual(result.applied.map(a => [a.id, a.origin, a.resolvedFrom]), [['house-style', 'store', 'lock']]);
  assert.match(read(w, '.claude/skills/house-style/SKILL.md'), /name: house-style/);
  assert.deepEqual(JSON.parse(read(w, '.bowerloom/managed/catalog/house-style.json')).source, { kind: 'store', path: 'skills/house-style' });
  // The second plan reads the store cache and fetches nothing.
  const again = await planSync(input(w)); assert.equal(byId(again)['house-style'].state, 'up-to-date'); assert.equal(again.network.required, false);
});

test('4. a fetch the plan did not approve never starts: --offline with an authored lock item the cache lacks refuses SKILLS_OFFLINE at plan time', async t => {
  const w = configWorld(t, { folder: true });
  await storeItem(w, 'skill', 'house-style'); writeConfig(w, { skills: [{ id: 'house-style', source: 'store' }] });
  const repo = pushStore(w); writeLock(w, { skills: [lockOfRepo(w, repo, 'skill', 'house-style')] }); dropStore(w);
  await assert.rejects(planSync(input(w, { offline: true })), code('SKILLS_OFFLINE'));
  await assert.rejects(planSync(input(w, { offline: true, frozen: true })), code('SKILLS_OFFLINE'));
  const plan = await planSync(input(w));
  // A run whose approved hosts do not name api.github.com cannot fetch: the store fetch refuses before any request.
  const transport = storeTransport(repo), { fetchStoreGit } = await import('../../../dist/packages/project-sync/src/store-git.js');
  const item = byId(plan)['house-style'];
  await assert.rejects(fetchStoreGit({ kind: 'skill', id: item.id, requestDigest: item.requestDigest, lockPin: item.lockPin }, plan.privateState, ['registry.npmjs.org'], { signal: new AbortController().signal, storeTransport: transport }), code('SKILLS_OFFLINE'));
  assert.equal(transport.urls.length, 0);
});

test('6. a store local skill installs from the live store; a store file changed after the plan gives STALE_APPROVAL', async t => {
  const w = configWorld(t, { folder: true });
  await storeItem(w, 'skill', 'house-style'); writeConfig(w, { skills: [{ id: 'house-style', source: 'store' }] });
  const plan = await planSync(input(w));
  assert.deepEqual([byId(plan)['house-style'].state, byId(plan)['house-style'].action], ['local', 'install']);
  editStore(w, 'skills/house-style/SKILL.md', '---\nname: house-style\ndescription: Changed.\n---\nx\n');
  await assert.rejects(applySync(input(w), plan.revision, deps(noAcquirer())), code('STALE_APPROVAL'));
  assert.equal(exists(w, '.claude/skills/house-style'), false);
  const { result } = await sync(w);
  assert.deepEqual(result.applied.map(a => a.id), ['house-style']);
  assert.match(read(w, '.agents/skills/house-style/SKILL.md'), /description: Changed\./);
});

test('9. holds for CONFIG_ITEM_MISSING and STORE_ITEM_MISSING do not stop other items', async t => {
  const w = configWorld(t, { folder: true });
  localSkill({ projectDir: w.projectDir }, 'local-tool'); writeManifest({ projectDir: w.projectDir }, [{ id: 'local-tool', source: { kind: 'local', path: 'skills/local-tool' } }]);
  await storeItem(w, 'skill', 'house-style');
  writeConfig(w, { skills: [{ id: 'gone-skill', source: 'project' }, { id: 'house-style', source: 'store' }, { id: 'local-tool', source: 'project' }, { id: 'missing-store', source: 'store' }] });
  const { plan, result } = await sync(w);
  assert.deepEqual(Object.fromEntries(plan.items.map(i => [i.id, i.hold?.code ?? i.action])), { 'gone-skill': 'CONFIG_ITEM_MISSING', 'house-style': 'install', 'local-tool': 'install', 'missing-store': 'STORE_ITEM_MISSING' });
  assert.deepEqual(result.applied.map(a => a.id).sort(), ['house-style', 'local-tool']);
  assert.deepEqual(result.held.map(h => [h.id, h.code, h.origin]), [['gone-skill', 'CONFIG_ITEM_MISSING', 'project'], ['missing-store', 'STORE_ITEM_MISSING', 'store']]);
});

test('10. an item that bowerloom.json no longer lists shows as orphaned and is not removed', async t => {
  const w = configWorld(t, { folder: true });
  await storeItem(w, 'skill', 'house-style'); writeConfig(w, { skills: [{ id: 'house-style', source: 'store' }] });
  await sync(w);
  writeConfig(w, { skills: [] });
  const plan = await planSync(input(w));
  assert.deepEqual(plan.items.map(i => [i.id, i.state, i.action, i.origin]), [['house-style', 'orphaned', 'none', null]]);
  assert.ok(exists(w, '.claude/skills/house-style/SKILL.md'));
});

test('11. a legacy plan equals a beta.2 plan except for the new fields', async t => {
  const w = configWorld(t, { folder: true });
  localSkill({ projectDir: w.projectDir }, 'local-tool'); writeManifest({ projectDir: w.projectDir }, [{ id: 'local-tool', source: { kind: 'local', path: 'skills/local-tool' } }]);
  const plan = await planSync(input(w));
  assert.deepEqual({ bowerloomFolder: plan.bowerloomFolder, frozen: plan.frozen, config: plan.config, lock: plan.lock, store: plan.store, storeFetch: plan.storeFetch, notes: plan.notes }, { bowerloomFolder: 'present', frozen: false, config: null, lock: null, store: null, storeFetch: [], notes: [] });
  assert.match(plan.manifest.sha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(plan.items.map(i => [i.id, i.kind, i.state, i.action, i.origin, i.via, i.resolvedFrom, i.lockPin, i.storeCache]), [['local-tool', 'local', 'local', 'install', 'project', [], 'project', null, null]]);
  assert.equal(path.basename(plan.privateState.storeCacheRoot), 'store-cache');
  // The store is never read in legacy mode: an unsafe store changes nothing.
  fs.mkdirSync(w.store, { mode: 0o777 }); fs.chmodSync(w.store, 0o777);
  assert.equal((await planSync(input(w))).revision, plan.revision);
});

test('12. a plan with a stale lock carries the note; a shared project with store items and no lock carries the other note', async t => {
  const w = configWorld(t, { folder: true });
  await storeItem(w, 'skill', 'house-style'); writeConfig(w, { skills: [{ id: 'house-style', source: 'store' }] });
  const repo = pushStore(w); writeLock(w, { skills: [lockOfRepo(w, repo, 'skill', 'house-style')] });
  const named = '  skill house-style comes from your store; this project asks for it';
  assert.deepEqual((await planSync(input(w))).notes, [named]);
  editStore(w, 'skills/house-style/SKILL.md', '---\nname: house-style\ndescription: Changed.\n---\nx\n');
  assert.deepEqual((await planSync(input(w))).notes, ['The lock is out of date for skill house-style. Run bowerloom lock update.', named]);
  fs.rmSync(path.join(w.projectDir, 'bowerloom.lock.json'));
  fs.mkdirSync(path.join(w.projectDir, '.git'), { mode: 0o755 }); fs.writeFileSync(path.join(w.projectDir, '.git', 'config'), '[remote "origin"]\n\turl = https://github.com/o/app.git\n');
  assert.deepEqual((await planSync(input(w))).notes, ['This project is shared but has no bowerloom.lock.json. Run bowerloom lock update.', named]);
});

test('13. a local skill moved from the project to the store with equal bytes is up to date, and the catalog keeps local', async t => {
  const w = configWorld(t, { folder: true });
  const text = { 'SKILL.md': '---\nname: house-style\ndescription: Moved.\n---\nUse it.\n' };
  localSkill({ projectDir: w.projectDir }, 'house-style', text); writeManifest({ projectDir: w.projectDir }, [{ id: 'house-style', source: { kind: 'local', path: 'skills/house-style' } }]);
  await sync(w);
  await storeItem(w, 'skill', 'house-style'); editStore(w, 'skills/house-style/SKILL.md', text['SKILL.md']);
  writeConfig(w, { skills: [{ id: 'house-style', source: 'store' }] });
  const plan = await planSync(input(w)), item = byId(plan)['house-style'];
  assert.deepEqual([item.state, item.action, item.origin], ['up-to-date', 'none', 'store']);
  assert.deepEqual(JSON.parse(read(w, '.bowerloom/managed/catalog/house-style.json')).source, { kind: 'local', path: 'skills/house-style' });
});

test('a team filter in config mode needs a listed team, and the store items of other teams stay out', async t => {
  const w = configWorld(t, { folder: true });
  await storeItem(w, 'team', 'research'); await storeItem(w, 'skill', 'notes', { teams: ['research'] }); await storeItem(w, 'skill', 'other');
  writeConfig(w, { skills: [{ id: 'notes', source: 'store' }, { id: 'other', source: 'store' }], teams: [{ id: 'research', source: 'store' }] });
  assert.deepEqual((await planSync(input(w, { team: 'research' }))).items.map(i => i.id), ['notes', 'other']);
  await assert.rejects(planSync(input(w, { team: 'ops' })), code('TEAM_NOT_FOUND'));
});
