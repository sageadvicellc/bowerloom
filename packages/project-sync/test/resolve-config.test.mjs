// Spec 06, 3.2, 3.3 and 4.3: resolveProject. Legacy mode is beta.2. Config mode resolves each bowerloom.json entry to its
// definition: the project, the live store, or the lock.
import test from '../../../dist/tests/support/lock-slot-retry.js';
import assert from 'node:assert/strict';
import { after } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { denyNetwork, npmPackage, writeManifest, localSkill } from './sync-fixture.mjs';
import { configWorld, writeConfig, writeLock, storeItem, storePin, editStore, authoredLockItem, code } from './config-fixture.mjs';
import { resolveProject, storeItemNote } from '../../../dist/packages/project-sync/src/resolve.js';
import { readManifestState } from '../../../dist/packages/skill-manifest/src/add.js';
import { validateEntry } from '../../../dist/packages/skill-manifest/src/schema.js';
import { planCreate, applyCreate } from '../../../dist/packages/project-authoring/src/index.js';
import { withProjectLock } from '../../../dist/packages/project-context/src/index.js';

const network = denyNetwork();
after(() => assert.deepEqual(network, [], 'the resolver reads no network'));
const ids = items => items.map(i => i.id);
const proj = w => ({ projectDir: w.projectDir });
async function projectPrompt(w, id, teams = []) {
  const input = { kind: 'prompt', project: w.projectDir, name: id, teams };
  const plan = await planCreate(input);
  await withProjectLock(w.projectDir, new AbortController().signal, held => applyCreate(input, plan.revision, held));
}

test('1. legacy mode returns the beta.2 sets: every skills.json entry, every registered prompt, every created team and first-team', async t => {
  const w = configWorld(t, { folder: true }), npm = npmPackage('tanstack-db', { teams: ['research'] });
  localSkill(proj(w), 'house-style');
  writeManifest(proj(w), [npm.entry, { id: 'house-style', source: { kind: 'local', path: 'skills/house-style' } }]);
  await projectPrompt(w, 'weekly-update');
  fs.mkdirSync(path.join(w.projectDir, '.bowerloom/teams/first-team'), { recursive: true, mode: 0o755 });
  const r = resolveProject({ project: w.project(), home: w.home, frozen: false });
  assert.equal(r.mode, 'legacy'); assert.equal(r.config, null);
  assert.deepEqual(r.lock, { state: 'not-used', sha256: null, bytes: null, code: null });
  assert.equal(r.store.state, 'not-needed');
  assert.deepEqual(ids(r.skills), ['house-style', 'tanstack-db']);
  assert.ok(r.skills.every(i => i.origin === 'project' && i.resolvedFrom === 'project' && i.hold === null && i.lockPin === null));
  assert.deepEqual(r.skills.find(i => i.id === 'tanstack-db').teams, ['research']);
  assert.deepEqual(ids(r.prompts), ['weekly-update']);
  assert.deepEqual(ids(r.teams), ['first-team']);
  assert.deepEqual(r.manifest.skills.map(s => s.id), ['house-style', 'tanstack-db']);
  assert.deepEqual(r.harnesses, ['claude', 'codex']);
  assert.match(r.projectManifest.sha256, /^[a-f0-9]{64}$/);
  // Legacy mode never reads the store: an unsafe store has no effect.
  fs.mkdirSync(w.store, { mode: 0o777 }); fs.chmodSync(w.store, 0o777);
  assert.equal(resolveProject({ project: w.project(), home: w.home, frozen: false }).mode, 'legacy');
});

test('2 and 14. config mode: project entries resolve to their definitions; a missing one, and personal-assistant, are held CONFIG_ITEM_MISSING', async t => {
  const w = configWorld(t, { folder: true });
  localSkill(proj(w), 'house-style'); writeManifest(proj(w), [{ id: 'house-style', source: { kind: 'local', path: 'skills/house-style' } }]);
  await projectPrompt(w, 'weekly-update');
  fs.mkdirSync(path.join(w.projectDir, '.bowerloom/teams/first-team'), { recursive: true, mode: 0o755 });
  writeConfig(w, {
    skills: [{ id: 'gone-skill', source: 'project' }, { id: 'house-style', source: 'project' }, { id: 'personal-assistant', source: 'project' }],
    prompts: [{ id: 'gone-prompt', source: 'project' }, { id: 'weekly-update', source: 'project' }],
    teams: [{ id: 'first-team', source: 'project' }, { id: 'research', source: 'project' }],
  });
  const r = resolveProject({ project: w.project(), home: w.home, frozen: false });
  assert.equal(r.mode, 'config');
  const skill = Object.fromEntries(r.skills.map(i => [i.id, i]));
  assert.equal(skill['house-style'].hold, null); assert.equal(skill['house-style'].entry.source.kind, 'local'); assert.equal(skill['house-style'].origin, 'project');
  for (const id of ['gone-skill', 'personal-assistant']) {
    assert.equal(skill[id].entry, null);
    assert.deepEqual(skill[id].hold, { code: 'CONFIG_ITEM_MISSING', next: `Define it with bowerloom skill create ${id}, or run bowerloom unuse skill ${id}.` });
  }
  assert.equal(r.prompts.find(i => i.id === 'weekly-update').hold, null);
  assert.equal(r.prompts.find(i => i.id === 'gone-prompt').hold.code, 'CONFIG_ITEM_MISSING');
  assert.equal(r.teams.find(i => i.id === 'first-team').hold, null);
  assert.equal(r.teams.find(i => i.id === 'research').hold.code, 'CONFIG_ITEM_MISSING');
  assert.equal(r.store.state, 'not-needed');
});

test('3 and 12 and 13. a live store that holds the item supplies it: a store local skill is a local entry at skills/<id>, with its own teams tag', async t => {
  const w = configWorld(t);
  await storeItem(w, 'team', 'research'); await storeItem(w, 'skill', 'house-style', { teams: ['research'] }); await storeItem(w, 'prompt', 'weekly-update');
  const npm = npmPackage('tanstack-db', { teams: ['research'] }); storePin(w, npm.entry);
  writeConfig(w, { skills: [{ id: 'house-style', source: 'store' }, { id: 'tanstack-db', source: 'store' }], prompts: [{ id: 'weekly-update', source: 'store' }], teams: [{ id: 'research', source: 'store' }] });
  const r = resolveProject({ project: w.project(), home: w.home, frozen: false });
  assert.equal(r.store.state, 'present'); assert.equal(r.store.context.dir, fs.realpathSync(w.store));
  const skill = Object.fromEntries(r.skills.map(i => [i.id, i]));
  assert.deepEqual(skill['house-style'].entry, { id: 'house-style', teams: ['research'], source: { kind: 'local', path: 'skills/house-style' } });
  assert.deepEqual(skill['house-style'].teams, ['research']);
  assert.equal(skill['house-style'].resolvedFrom, 'store'); assert.equal(skill['house-style'].origin, 'store');
  assert.deepEqual(skill['tanstack-db'].entry, validateEntry(npm.entry));
  assert.equal(r.prompts[0].resolvedFrom, 'store'); assert.equal(r.teams[0].resolvedFrom, 'store');
  assert.match(r.store.skills.sha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(r.notes, []);
});

test('4 and 5. with no store, store entries resolve from the lock (a pinned item is an ordinary entry); with neither, STORE_ITEM_MISSING', t => {
  const w = configWorld(t), npm = npmPackage('tanstack-db');
  const files = [{ path: 'SKILL.md', bytes: Buffer.from('---\nname: house-style\ndescription: x\n---\nx\n') }];
  writeConfig(w, { skills: [{ id: 'house-style', source: 'store' }, { id: 'missing-one', source: 'store' }, { id: 'tanstack-db', source: 'store' }] });
  writeLock(w, { skills: [authoredLockItem(w, 'skill', 'house-style', { files, teams: ['ops'] }), { id: 'tanstack-db', from: 'store', pin: npm.entry }] });
  const r = resolveProject({ project: w.project(), home: w.home, frozen: false });
  assert.equal(r.store.state, 'absent');
  const skill = Object.fromEntries(r.skills.map(i => [i.id, i]));
  assert.equal(skill['tanstack-db'].resolvedFrom, 'lock'); assert.deepEqual(skill['tanstack-db'].entry, validateEntry(npm.entry)); assert.equal(skill['tanstack-db'].lockPin, null);
  assert.equal(skill['house-style'].resolvedFrom, 'lock'); assert.deepEqual(skill['house-style'].entry, { id: 'house-style', teams: ['ops'], source: { kind: 'local', path: 'skills/house-style' } });
  assert.equal(skill['house-style'].lockPin.hash.length, 64); assert.deepEqual(skill['house-style'].teams, ['ops']);
  assert.deepEqual(skill['missing-one'].hold, { code: 'STORE_ITEM_MISSING', next: 'Create it with bowerloom skill create missing-one --global, or run bowerloom unuse skill missing-one.' });
  assert.equal(r.lock.state, 'mismatch'); assert.equal(r.lock.code, 'LOCK_CONFIG_MISMATCH');
  assert.ok(r.notes.includes('bowerloom.lock.json and bowerloom.json list different store items: skill missing-one. Run bowerloom lock update.'), r.notes.join('\n'));
});

test('track 11, item 3: with no store, each store item note names the lock and where its bytes come from, never your store', t => {
  const w = configWorld(t), npm = npmPackage('tanstack-db');
  const files = [{ path: 'SKILL.md', bytes: Buffer.from('---\nname: house-style\ndescription: x\n---\nx\n') }];
  writeConfig(w, { skills: [{ id: 'house-style', source: 'store' }, { id: 'missing-one', source: 'store' }, { id: 'tanstack-db', source: 'store' }] });
  writeLock(w, { skills: [authoredLockItem(w, 'skill', 'house-style', { files }), { id: 'tanstack-db', from: 'store', pin: npm.entry }] });
  const r = resolveProject({ project: w.project(), home: w.home, frozen: false });
  assert.equal(r.store.state, 'absent');
  const named = r.notes.filter(n => n.includes('this project asks for it'));
  assert.deepEqual(named, [
    '  skill house-style comes from the lock and the store repository; this project asks for it',
    '  skill missing-one comes from a store, and neither your store nor the lock holds it; this project asks for it',
    '  skill tanstack-db comes from the lock and npm; this project asks for it',
  ]);
  // A GitHub pin in the lock, and a prompt or team the person wrote, which carry no skill entry.
  const git = { source: { kind: 'git' } };
  assert.equal(storeItemNote({ kind: 'skill', id: 'gh', resolvedFrom: 'lock', entry: git, lockPin: null, hold: null }), '  skill gh comes from the lock and its GitHub repository; this project asks for it');
  assert.equal(storeItemNote({ kind: 'team', id: 'research', resolvedFrom: 'lock', entry: null, lockPin: { hash: 'a' }, hold: null }), '  team research comes from the lock and the store repository; this project asks for it');
  assert.equal(storeItemNote({ kind: 'prompt', id: 'brief', resolvedFrom: 'store', entry: null, lockPin: null, hold: null }), '  prompt brief comes from your store; this project asks for it');
});

test('6. a frozen run never reads the store: a store that refuses has no effect, and a live store that differs does not win', async t => {
  const w = configWorld(t);
  await storeItem(w, 'skill', 'house-style');
  const item = authoredLockItem(w, 'skill', 'house-style');
  writeConfig(w, { skills: [{ id: 'house-style', source: 'store' }] }); writeLock(w, { skills: [item] });
  editStore(w, 'skills/house-style/SKILL.md', '---\nname: house-style\ndescription: changed\n---\nchanged\n');
  fs.chmodSync(w.store, 0o777);
  const r = resolveProject({ project: w.project(), home: w.home, frozen: true });
  assert.equal(r.frozen, true); assert.equal(r.store.state, 'not-needed'); assert.equal(r.store.context, null);
  assert.equal(r.skills[0].resolvedFrom, 'lock'); assert.deepEqual(r.skills[0].lockPin, item.authored);
  // The same store refuses a normal run (7).
  assert.throws(() => resolveProject({ project: w.project(), home: w.home, frozen: false }), code('STORE_UNSAFE'));
});

test('6. a frozen run refuses before any read of the store: no lock, an invalid lock, a mismatch, and no config', async t => {
  const w = configWorld(t);
  writeConfig(w, { skills: [{ id: 'house-style', source: 'store' }] });
  assert.throws(() => resolveProject({ project: w.project(), home: w.home, frozen: true }), code('LOCK_MISSING'));
  fs.writeFileSync(path.join(w.projectDir, 'bowerloom.lock.json'), '<<<<<<< HEAD\n', { mode: 0o644 });
  assert.throws(() => resolveProject({ project: w.project(), home: w.home, frozen: true }), code('LOCK_INVALID'));
  writeLock(w, {});
  assert.throws(() => resolveProject({ project: w.project(), home: w.home, frozen: true }), code('LOCK_CONFIG_MISMATCH'));
  // A config with no store item needs no lock.
  writeConfig(w, { skills: [] }); fs.rmSync(path.join(w.projectDir, 'bowerloom.lock.json'));
  assert.equal(resolveProject({ project: w.project(), home: w.home, frozen: true }).lock.state, 'not-used');
  // A legacy project (no config) cannot run frozen.
  const legacy = configWorld(t, { folder: true });
  assert.throws(() => resolveProject({ project: legacy.project(), home: legacy.home, frozen: true }), code('LOCK_CONFIG_MISSING'));
});

test('7 and 8. a refused store throws its STORE_* code in a normal run; a config with no store entry never reads the store', async t => {
  const w = configWorld(t, { folder: true });
  fs.mkdirSync(w.store, { mode: 0o700 }); fs.writeFileSync(path.join(w.store, 'notes.txt'), 'not a store');
  writeConfig(w, { skills: [{ id: 'house-style', source: 'store' }] });
  assert.throws(() => resolveProject({ project: w.project(), home: w.home, frozen: false }), code('STORE_INVALID'));
  writeConfig(w, { skills: [] });
  const r = resolveProject({ project: w.project(), home: w.home, frozen: false });
  assert.equal(r.store.state, 'not-needed');
});

test('9 and 10. unselected lists the project definitions the config lacks; the effective manifest holds only the selected skills, sorted, with the config harnesses', async t => {
  const w = configWorld(t, { folder: true }), npm = npmPackage('zeta-skill');
  localSkill(proj(w), 'house-style'); localSkill(proj(w), 'unused-skill');
  writeManifest(proj(w), [npm.entry, { id: 'house-style', source: { kind: 'local', path: 'skills/house-style' } }, { id: 'unused-skill', source: { kind: 'local', path: 'skills/unused-skill' } }]);
  await projectPrompt(w, 'weekly-update');
  fs.mkdirSync(path.join(w.projectDir, '.bowerloom/teams/first-team'), { recursive: true, mode: 0o755 });
  writeConfig(w, { harnesses: ['codex'], skills: [{ id: 'house-style', source: 'project' }, { id: 'zeta-skill', source: 'project' }] });
  const r = resolveProject({ project: w.project(), home: w.home, frozen: false });
  assert.deepEqual(r.unselected, { skills: ['unused-skill'], prompts: ['weekly-update'], teams: ['first-team'] });
  assert.deepEqual(r.manifest.harnesses, ['codex']); assert.deepEqual(r.harnesses, ['codex']);
  assert.deepEqual(r.manifest.skills.map(s => s.id), ['house-style', 'zeta-skill']);
});

test('11. a live item that differs from its lock item gives the stale-lock note, and the lock state is stale', async t => {
  const w = configWorld(t);
  await storeItem(w, 'skill', 'house-style'); await storeItem(w, 'prompt', 'weekly-update');
  writeConfig(w, { skills: [{ id: 'house-style', source: 'store' }], prompts: [{ id: 'weekly-update', source: 'store' }] });
  writeLock(w, { skills: [authoredLockItem(w, 'skill', 'house-style')], prompts: [authoredLockItem(w, 'prompt', 'weekly-update')] });
  const fresh = resolveProject({ project: w.project(), home: w.home, frozen: false });
  // Review L3: a shared project names each store item its config asks for.
  const named = ['  skill house-style comes from your store; this project asks for it', '  prompt weekly-update comes from your store; this project asks for it'];
  assert.deepEqual(fresh.notes, named); assert.equal(fresh.lock.state, 'valid');
  editStore(w, 'skills/house-style/SKILL.md', '---\nname: house-style\ndescription: changed\n---\nchanged\n');
  const r = resolveProject({ project: w.project(), home: w.home, frozen: false });
  assert.deepEqual(r.notes, ['The lock is out of date for skill house-style. Run bowerloom lock update.', ...named]);
  assert.equal(r.lock.state, 'stale');
  assert.equal(r.skills[0].resolvedFrom, 'store', 'the live store item installs');
});

test('15. readManifestState(dir, { allowAbsent: true }) serves a project with no .bowerloom', t => {
  const w = configWorld(t);
  writeConfig(w, { skills: [{ id: 'house-style', source: 'project' }] });
  assert.deepEqual(readManifestState(w.projectDir, { allowAbsent: true }), { bowerloom: null, file: null });
  const r = resolveProject({ project: w.project(), home: w.home, frozen: false });
  assert.equal(r.projectManifest, null); assert.equal(r.skills[0].hold.code, 'CONFIG_ITEM_MISSING');
  assert.deepEqual(r.manifest.skills, []);
});
