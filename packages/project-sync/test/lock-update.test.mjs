// Spec 06, 3.15: lock update re-resolves the lock items from the live store.
import test from '../../../dist/tests/support/lock-slot-retry.js';
import assert from 'node:assert/strict';
import { after } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { denyNetwork, npmPackage } from './sync-fixture.mjs';
import { configWorld, writeConfig, writeLock, storeItem, storePin, editStore, pushStore, lockOfRepo, storeTransport, code } from './config-fixture.mjs';
import { planLockUpdate, applyLockUpdate, lockUpdateIsNoop } from '../../../dist/packages/project-sync/src/index.js';
import { withProjectLock, discoverProject } from '../../../dist/packages/project-context/src/index.js';
import { readLock } from '../../../dist/packages/project-config/src/index.js';

const network = denyNetwork();
after(() => assert.deepEqual(network, [], 'every network read goes to a fake'));
const ctx = w => discoverProject(w.projectDir, w.home);
const plan = (w, extra = {}) => planLockUpdate({ project: ctx(w), home: w.home, items: null, commit: null, ...extra });
const apply = (w, p) => withProjectLock(w.projectDir, new AbortController().signal, async held => applyLockUpdate(p, p.revision, held, ctx(w), w.home));
function gitStore(w, repo) {
  const git = path.join(w.store, '.git'); fs.rmSync(git, { recursive: true, force: true });
  fs.mkdirSync(path.join(git, 'refs/remotes/origin'), { recursive: true, mode: 0o755 }); fs.mkdirSync(path.join(git, 'refs/heads'), { recursive: true });
  fs.writeFileSync(path.join(git, 'config'), '[remote "origin"]\n\turl = https://github.com/sageadvicellc/store\n'); fs.writeFileSync(path.join(git, 'HEAD'), 'ref: refs/heads/main\n');
  fs.writeFileSync(path.join(git, 'refs/remotes/origin/main'), `${repo.commit}\n`);
}
const changes = p => p.updated.map(u => `${u.kind} ${u.id} ${u.change}`);

test('1, 2, 4 and 6. lock update creates the lock, lists added, unchanged, pin changed and commit changed; pinned items read no network; --commit records that commit', async t => {
  const w = configWorld(t, { folder: true }), npm = npmPackage('tanstack-db');
  await storeItem(w, 'skill', 'house-style'); storePin(w, npm.entry);
  writeConfig(w, { skills: [{ id: 'house-style', source: 'store' }, { id: 'tanstack-db', source: 'store' }] });
  const repo = pushStore(w); gitStore(w, repo);
  const transport = storeTransport(repo), first = await plan(w, { storeTransport: transport });
  assert.equal(first.lock.before, null); assert.deepEqual(changes(first), ['skill house-style added', 'skill tanstack-db added']);
  await apply(w, first);
  assert.equal(readLock(ctx(w)).lock.skills.length, 2);
  storePin(w, npmPackage('tanstack-db', { version: '1.0.1' }).entry);
  const pinOnly = storeTransport(repo), second = await plan(w, { items: [{ kind: 'skill', id: 'tanstack-db' }], storeTransport: pinOnly });
  assert.deepEqual(changes(second), ['skill tanstack-db pin']); assert.equal(pinOnly.urls.length, 0, 'a pinned item reads no network');
  assert.ok(second.updated[0].from.startsWith('npm @synthetic/tanstack-db@1.0.0') && second.updated[0].to.startsWith('npm @synthetic/tanstack-db@1.0.1'));
  await apply(w, second);
  // --commit proves at that commit, and the item changes commit.
  const other = { ...repo, commit: 'c'.repeat(40), responses: new Map([...repo.responses].map(([u, b]) => [u.replace(repo.commit, 'c'.repeat(40)), u.includes('/commits/') ? Buffer.from(b.toString().replace(repo.commit, 'c'.repeat(40))) : b])) };
  const pinned = await plan(w, { commit: 'c'.repeat(40), items: [{ kind: 'skill', id: 'house-style' }], storeTransport: storeTransport(other) });
  assert.deepEqual(changes(pinned), ['skill house-style commit']);
  await apply(w, pinned);
  assert.equal(readLock(ctx(w)).lock.skills.find(i => i.id === 'house-style').authored.commit, 'c'.repeat(40));
});

test('3. an item missing from the store refuses STORE_ITEM_MISSING; the store missing refuses STORE_NOT_FOUND; --item must be listed', async t => {
  const w = configWorld(t, { folder: true });
  writeConfig(w, { skills: [{ id: 'house-style', source: 'store' }] });
  await assert.rejects(plan(w), code('STORE_NOT_FOUND'));
  await storeItem(w, 'skill', 'other');
  await assert.rejects(plan(w), code('STORE_ITEM_MISSING'));
  await assert.rejects(plan(w, { items: [{ kind: 'skill', id: 'nope' }] }), code('CONFIG_ITEM_NOT_SELECTED'));
});

test('5 and 7. nothing to change keeps the bytes; an authored item with its lock hash keeps its lock item and reads no network', async t => {
  const w = configWorld(t, { folder: true });
  await storeItem(w, 'skill', 'house-style'); writeConfig(w, { skills: [{ id: 'house-style', source: 'store' }] });
  const repo = pushStore(w); writeLock(w, { skills: [lockOfRepo(w, repo, 'skill', 'house-style')] });
  const transport = storeTransport(repo), p = await plan(w, { storeTransport: transport });
  assert.ok(lockUpdateIsNoop(p)); assert.equal(transport.urls.length, 0); assert.deepEqual(changes(p), ['skill house-style unchanged']);
});

test('8 and 9. a lock item with no store entry is removed and the others stay; an invalid lock is rebuilt without --item and refuses with it', async t => {
  const w = configWorld(t, { folder: true }), npm = npmPackage('tanstack-db');
  await storeItem(w, 'skill', 'seed'); storePin(w, npm.entry);
  writeConfig(w, { skills: [{ id: 'tanstack-db', source: 'store' }] });
  writeLock(w, { skills: [{ id: 'gone', from: 'store', pin: { ...npm.entry, id: 'gone' } }, { id: 'tanstack-db', from: 'store', pin: npm.entry }] });
  const p = await plan(w, { items: [] });
  assert.deepEqual(changes(p), ['skill gone removed']);
  fs.writeFileSync(path.join(w.projectDir, 'bowerloom.lock.json'), '<<<<<<< HEAD\n');
  await assert.rejects(plan(w, { items: [{ kind: 'skill', id: 'tanstack-db' }] }), code('LOCK_INVALID'));
  const rebuilt = await plan(w); assert.equal(rebuilt.lock.rebuilt, true);
  await apply(w, rebuilt);
  assert.equal(readLock(ctx(w)).lock.skills[0].id, 'tanstack-db');
  fs.chmodSync(path.join(w.projectDir, 'bowerloom.lock.json'), 0o666);
  await assert.rejects(plan(w), code('LOCK_UNSAFE'));
});

test('10. no store entry and no lock is nothing to lock; no store entry and a lock writes empty lists', async t => {
  const w = configWorld(t, { folder: true }); writeConfig(w, {});
  assert.equal((await plan(w)).nothing, true);
  writeLock(w, {});
  const p = await plan(w); assert.equal(p.nothing, false);
  await apply(w, p); assert.deepEqual(readLock(ctx(w)).lock, { format: 'bowerloom/lock/v1beta1', skills: [], prompts: [], teams: [] });
});

test('11. a changed teams tag shows a teams change and counts as stale', async t => {
  const w = configWorld(t, { folder: true });
  await storeItem(w, 'team', 'research'); await storeItem(w, 'skill', 'house-style');
  writeConfig(w, { skills: [{ id: 'house-style', source: 'store' }] });
  const repo = pushStore(w); writeLock(w, { skills: [lockOfRepo(w, repo, 'skill', 'house-style', ['research'])] });
  const { resolveProject } = await import('../../../dist/packages/project-sync/src/index.js');
  assert.equal(resolveProject({ project: ctx(w), home: w.home, frozen: false }).lock.state, 'stale');
  const p = await plan(w, { storeTransport: storeTransport(repo) });
  assert.deepEqual(changes(p), ['skill house-style teams']); assert.equal(p.updated[0].from, 'research'); assert.equal(p.updated[0].to, 'every team');
});

test('F2. a lock that cannot be read is rebuilt, and the plan says the old pins are dropped', async t => {
  const w = configWorld(t, { folder: true }), npm = npmPackage('tanstack-db');
  await storeItem(w, 'skill', 'seed'); storePin(w, npm.entry); writeConfig(w, { skills: [{ id: 'tanstack-db', source: 'store' }] });
  fs.writeFileSync(path.join(w.projectDir, 'bowerloom.lock.json'), '<<<<<<< HEAD\n');
  const p = await plan(w);
  assert.ok(p.notes.includes('bowerloom.lock.json could not be read (LOCK_INVALID); it is rebuilt from your store. The old pins are dropped.'), p.notes.join('\n'));
  const { renderLockUpdate } = await import('../../../dist/apps/cli/src/lock.js');
  assert.match(renderLockUpdate(p), /could not be read \(LOCK_INVALID\); it is rebuilt from your store\. The old pins are dropped\./);
});

// Round 9 of the reviews of PR 101, item 2: a stop while checking the pushed copy names lock update, not skills sync.
test('a stop while checking the pushed copy names the lock update command that ran, with its items', async t => {
  const w = configWorld(t, { folder: true });
  await storeItem(w, 'skill', 'house-style'); writeConfig(w, { skills: [{ id: 'house-style', source: 'store' }] });
  const repo = pushStore(w); gitStore(w, repo);
  const controller = new AbortController(), stopping = () => { controller.abort(); throw new Error('stopped'); };
  await assert.rejects(plan(w, { items: [{ kind: 'skill', id: 'house-style' }], storeTransport: stopping, signal: controller.signal }),
    e => e.code === 'SKILLS_SYNC_INTERRUPTED' && e.next === 'Run bowerloom lock update --item skill:house-style again.' && e.fix === 'bowerloom lock update --item skill:house-style');
});
