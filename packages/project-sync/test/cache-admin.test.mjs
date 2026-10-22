// Spec 09: `cache list` and `cache prune` in the library (packages/project-sync/src/cache-admin.ts). Every world is a
// private folder under the test HOME, with its own store, project and private state root. Cache entries are made
// through the product's own paths: skills-cache operations through the cache operation an acquisition uses, store-cache
// entries through writeStoreCache. Nothing here reads the network or the real home folder.
import test from '../../../dist/tests/support/lock-slot-retry.js';
import { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { canonicalJson } from '../../../dist/packages/contracts/src/index.js';
import { listCache, planCachePrune, applyCachePrune, referenceSets, planSync, applySync, writeStoreCache } from '../../../dist/packages/project-sync/src/index.js';
import { selectorFor } from '../../../dist/packages/project-sync/src/apply.js';
import { entryRequest, cacheOperationId } from '../../../dist/packages/project-sync/src/cache-index.js';
import { observeSkillCacheRoot, openNpmCacheOperation, inspectSkillCache } from '../../../dist/packages/skill-sources/src/cache.js';
import { planNpmAcquisition } from '../../../dist/packages/skill-sources/src/npm.js';
import { withCacheLock } from '../../../dist/packages/project-context/src/index.js';
import { serializeManifest, validateManifest, MANIFEST_LIMITS, STORE_MANIFEST_LIMITS } from '../../../dist/packages/skill-manifest/src/schema.js';
import { configWorld, writeLock, storeItem, storePin, storeFiles, authoredLockItem } from './config-fixture.mjs';
import { denyNetwork, npmPackage, store as storeOperation, exactTree, fakeAcquirer } from './sync-fixture.mjs';

const network = denyNetwork();
after(() => assert.deepEqual(network, []));

const sha = b => createHash('sha256').update(b).digest('hex');
const code = expected => e => { if (e?.code !== expected) throw new Error(`expected ${expected}, got ${e?.code ?? e} ${e?.message ?? ''}`); return true; };
const NONE = { unreferenced: false, partial: false, legacy: false, all: false, entries: [] };
const sel = extra => ({ ...NONE, ...extra });
const signal = () => new AbortController().signal;
const folder = p => { if (!fs.existsSync(p)) { fs.mkdirSync(p, { mode: 0o700 }); fs.chmodSync(p, 0o700); } return p; };

/** A world with a project (`.bowerloom`), a home for the store, and a private state root that is not made yet. */
function world(t, { project = true } = {}) {
  const w = configWorld(t, { folder: project, prefix: '.bowerloom-cache-admin-' });
  return { ...w, input: (extra = {}) => ({ stateRoot: w.stateRoot, project: project ? w.project() : null, home: w.home, env: {}, ...extra }) };
}
/** The private state folders as Bowerloom makes them: mode 0700. */
function stateFolders(w) { folder(path.dirname(w.stateRoot)); folder(w.stateRoot); folder(w.cacheRoot); }
/** Fills the machine cache for one package at an attempt, through the product's cache operation. Returns the operation id. */
async function seed(w, pkg, attempt = 0) {
  stateFolders(w);
  const { cacheRequest, digest } = entryRequest(pkg.entry), operationId = cacheOperationId(digest, attempt);
  const plan = planNpmAcquisition(cacheRequest, observeSkillCacheRoot(w.cacheRoot, operationId, 33554432));
  await storeOperation(plan, plan.revision, signal(), pkg);
  return operationId;
}
/** A per-project cache of an earlier beta, keyed on the request with the entry id in it. Returns its operation id. */
async function seedLegacy(w, pkg, projectId = 'e'.repeat(32), attempt = 0) {
  stateFolders(w); const root = folder(path.join(folder(path.join(w.stateRoot, projectId)), 'cache'));
  const { request, legacyDigest } = entryRequest(pkg.entry), operationId = cacheOperationId(legacyDigest, attempt);
  const plan = planNpmAcquisition(request, observeSkillCacheRoot(root, operationId, 33554432));
  await storeOperation(plan, plan.revision, signal(), pkg);
  return operationId;
}
/** An operation that stopped before completion: opened, receiving, held, released (a fetch that failed). */
function seedPartial(w, pkg, attempt = 0, { release = true } = {}) {
  stateFolders(w);
  const { cacheRequest, digest } = entryRequest(pkg.entry), operationId = cacheOperationId(digest, attempt);
  const plan = planNpmAcquisition(cacheRequest, observeSkillCacheRoot(w.cacheRoot, operationId, 33554432));
  const op = openNpmCacheOperation(plan, plan.revision, signal()); op.receiving();
  if (release) { op.hold(); op.release(); }
  return { operationId, op };
}
/** Writes one store-cache entry through writeStoreCache. Returns its folder name. */
async function seedStore(w, kind, id, files) {
  stateFolders(w);
  const rows = files.map(f => ({ path: f.path, bytes: Buffer.from(f.text) }));
  const { hash } = (await import('../../../dist/packages/skill-manifest/src/resolve-store-git.js')).authoredRows(rows);
  await writeStoreCache({ cacheRoot: w.cacheRoot, storeCacheRoot: w.storeCacheRoot }, kind, id, hash, rows, signal());
  return { name: `${kind}-${id}-${hash}`, hash };
}
const SKILL_FILES = [{ path: 'SKILL.md', text: '---\nname: house-style\ndescription: Store fixture.\n---\nUse it.\n' }, { path: 'references/notes.md', text: '# Notes\n' }];
/** Writes the project's .bowerloom/skills.json. */
function projectPins(w, entries) {
  const file = path.join(w.projectDir, '.bowerloom', 'skills.json');
  fs.writeFileSync(file, serializeManifest(validateManifest({ format: 'bowerloom/skills/v1beta1', harnesses: ['claude', 'codex'], skills: entries }, MANIFEST_LIMITS), MANIFEST_LIMITS), { mode: 0o644 });
}
/** The store skills.json with no entries. */
function emptyStorePins(w) { fs.writeFileSync(path.join(w.store, 'skills.json'), serializeManifest(validateManifest({ format: 'bowerloom/skills/v1beta1', harnesses: ['claude', 'codex'], skills: [] }, STORE_MANIFEST_LIMITS), STORE_MANIFEST_LIMITS), { mode: 0o600 }); }
const byName = list => Object.fromEntries(list.entries.map(e => [e.name, e]));
const sumBytes = entry => entry.files.reduce((n, f) => n + f.bytes, 0);
/** Everything under the state root, the store and the project, with inodes, modes, times and hashes. */
const snapshot = w => ({ state: exactTree(w.stateRoot), store: exactTree(w.store), project: exactTree(w.projectDir) });

test('1. an empty or missing state folder lists nothing', async t => {
  const w = world(t);
  const missing = await listCache(w.input());
  assert.deepEqual({ ...missing, stateRoot: null }, { format: 'bowerloom/cache-list/v1beta1', stateRoot: null, entries: [], totals: { entries: 0, bytes: 0 }, unlisted: 0, truncated: false, unreadableSources: [], unlistedNames: [], unreadable: [] });
  assert.equal(missing.stateRoot, w.stateRoot);
  assert.equal(fs.existsSync(w.stateRoot), false, 'listing creates nothing');
  stateFolders(w); folder(w.storeCacheRoot);
  assert.deepEqual((await listCache(w.input())).entries, []);
});

test('2. three seeded skills-cache entries list with labels, file counts and byte sums from their receipts', async t => {
  const w = world(t), pkgs = ['alpha', 'beta', 'gamma'].map(id => npmPackage(id));
  const ids = []; for (const p of pkgs) ids.push(await seed(w, p));
  const list = await listCache(w.input()), names = byName(list);
  assert.equal(list.entries.length, 3);
  for (const [i, p] of pkgs.entries()) {
    const e = names['op-' + ids[i]], seen = await inspectSkillCache({ root: w.cacheRoot, operationId: ids[i] });
    assert.deepEqual(Object.keys(e), ['scope', 'id', 'projectId', 'status', 'name', 'active', 'stale', 'kind', 'label', 'skillName', 'files', 'bytes', 'key', 'references', 'partialReason']);
    assert.equal(e.partialReason, null);
    assert.equal(e.scope, 'machine'); assert.equal(e.id, ids[i]); assert.equal(e.projectId, null); assert.equal(e.status, 'completed');
    assert.equal(e.active, false); assert.equal(e.stale, false); assert.equal(e.kind, 'npm');
    assert.equal(e.label, `@synthetic/${p.id}@1.0.0:skills/${p.id}`); assert.equal(e.skillName, `synthetic-${p.id}`);
    assert.equal(e.files, seen.receipt.inventory.length); assert.equal(e.bytes, seen.receipt.inventory.reduce((n, f) => n + f.bytes, 0));
    assert.equal(e.bytes, sumBytes(p.entry));
  }
  assert.deepEqual(list.entries.map(e => e.id), [...ids].sort(), 'sorted by id');
  assert.deepEqual(list.totals, { entries: 3, bytes: pkgs.reduce((n, p) => n + sumBytes(p.entry), 0) });
});

test('3. the store and the project skills.json reference their pins with a key; an entry nobody lists has key null', async t => {
  const w = world(t), a = npmPackage('alpha'), b = npmPackage('beta'), c = npmPackage('gamma');
  await storeItem(w, 'team', 'studio'); storePin(w, a.entry); projectPins(w, [b.entry]);
  const ia = await seed(w, a), ib = await seed(w, b), ic = await seed(w, c), ia2 = await seed(w, a, 3);
  const n = byName(await listCache(w.input()));
  assert.deepEqual(n['op-' + ia].references, { store: true, project: false }); assert.equal(n['op-' + ia].key, entryRequest(a.entry).digest);
  assert.deepEqual(n['op-' + ia2].references, { store: true, project: false }, 'every one of the eight attempts of a pin is referenced');
  assert.deepEqual(n['op-' + ib].references, { store: false, project: true }); assert.equal(n['op-' + ib].key, entryRequest(b.entry).digest);
  assert.deepEqual(n['op-' + ic].references, { store: false, project: false }); assert.equal(n['op-' + ic].key, null);
  // Spec edge case: the eight operation ids of a project pin are all referenced and kept by --unreferenced.
  const plan = await planCachePrune({ ...w.input(), selectors: sel({ unreferenced: true }) });
  assert.deepEqual(plan.picked.map(p => p.id), [ic]);
  const sets = await referenceSets(w.input());
  for (let i = 0; i < 8; i++) assert.ok(sets.project.operations.has(cacheOperationId(entryRequest(b.entry).digest, i)));
});

test('4. outside a project references.project is null and the plan says the project was not checked', async t => {
  const w = world(t, { project: false }), a = npmPackage('alpha'), c = npmPackage('gamma');
  await storeItem(w, 'team', 'studio'); storePin(w, a.entry);
  const ia = await seed(w, a), ic = await seed(w, c);
  const n = byName(await listCache(w.input()));
  assert.deepEqual(n['op-' + ia].references, { store: true, project: null }); assert.deepEqual(n['op-' + ic].references, { store: false, project: null });
  const plan = await planCachePrune({ ...w.input(), selectors: sel({ unreferenced: true }) });
  assert.equal(plan.projectChecked, false); assert.deepEqual(plan.picked.map(p => p.id), [ic], 'decision A: outside a project the store alone decides');
});

test('5. a refused store gives references.store null and unreadableSources ["store"]', async t => {
  const w = world(t), a = npmPackage('alpha');
  await storeItem(w, 'team', 'studio'); fs.writeFileSync(path.join(w.store, 'skills.json'), '{ not json', { mode: 0o600 });
  const ia = await seed(w, a), list = await listCache(w.input());
  assert.deepEqual(list.unreadableSources, ['store']); assert.deepEqual(byName(list)['op-' + ia].references, { store: null, project: false });
  const plan = await planCachePrune({ ...w.input(), selectors: sel({ unreferenced: true }) });
  assert.deepEqual(plan.picked, [], 'an unknown source makes --unreferenced pick nothing'); assert.deepEqual(plan.unreadableSources, ['store']);
});

test('6. a lock pin and a lock authored.hash are project references, in the skills cache and the store cache', async t => {
  const w = world(t), d = npmPackage('delta'), other = npmPackage('omega');
  const lockedPrompt = authoredLockItem(w, 'prompt', 'weekly', { files: [{ path: 'weekly.md', bytes: Buffer.from('# Weekly\nPlan the week.\n') }] });
  writeLock(w, { skills: [{ id: 'delta', from: 'store', pin: d.entry }], prompts: [lockedPrompt] });
  const id = await seed(w, d), spare = await seed(w, other);
  const kept = await seedStore(w, 'prompt', 'weekly', [{ path: 'weekly.md', text: '# Weekly\nPlan the week.\n' }]);
  const loose = await seedStore(w, 'prompt', 'weekly', [{ path: 'weekly.md', text: '# Weekly\nAn older week.\n' }]);
  assert.equal(kept.hash, lockedPrompt.authored.hash);
  const n = byName(await listCache(w.input()));
  assert.deepEqual(n['op-' + id].references, { store: false, project: true }); assert.equal(n['op-' + id].key, entryRequest(d.entry).digest);
  assert.deepEqual(n[kept.name].references, { store: false, project: true }); assert.equal(n[kept.name].key, kept.hash);
  assert.deepEqual(n[loose.name].references, { store: false, project: false }); assert.equal(n[loose.name].key, null);
  const plan = await planCachePrune({ ...w.input(), selectors: sel({ unreferenced: true }) });
  assert.deepEqual(plan.picked.map(p => p.name).sort(), ['op-' + spare, loose.name].sort());
});

test('7. a fetch that stopped before completion lists partial; an entry with an owner lists active', async t => {
  const w = world(t), a = npmPackage('alpha'), b = npmPackage('beta');
  const held = seedPartial(w, a), live = seedPartial(w, b, 0, { release: false });
  t.after(() => live.op.release());
  const n = byName(await listCache(w.input()));
  const h = n['op-' + held.operationId], l = n['op-' + live.operationId];
  assert.equal(h.status, 'partial'); assert.equal(h.active, false); assert.equal(h.label, null); assert.equal(h.files, null); assert.equal(h.bytes, null); assert.equal(h.partialReason, 'unfinished-fetch');
  assert.equal(l.status, 'partial'); assert.equal(l.active, true); assert.equal(l.stale, false);
  const plan = await planCachePrune({ ...w.input(), selectors: sel({ partial: true }) });
  assert.deepEqual(plan.picked.map(p => p.id), [held.operationId]);
  assert.deepEqual(plan.skipped, [{ scope: 'machine', id: live.operationId, projectId: null, reason: 'active', label: null }]);
});

test('8. a store-cache entry lists as completed; a changed file makes it partial', async t => {
  const w = world(t), s = await seedStore(w, 'skill', 'house-style', SKILL_FILES);
  let e = byName(await listCache(w.input()))[s.name];
  assert.deepEqual({ ...e, references: null }, { scope: 'store', id: s.hash, projectId: null, status: 'completed', name: s.name, active: false, stale: false, kind: 'store-git', label: 'skill house-style', skillName: null, files: 2, bytes: SKILL_FILES.reduce((n, f) => n + Buffer.byteLength(f.text), 0), key: null, references: null, partialReason: null });
  fs.writeFileSync(path.join(w.storeCacheRoot, s.name, 'skills', 'house-style', 'references', 'notes.md'), '# Changed\n');
  e = byName(await listCache(w.input()))[s.name];
  assert.equal(e.status, 'partial'); assert.equal(e.label, 'skill house-style'); assert.equal(e.files, null); assert.equal(e.bytes, null); assert.equal(e.partialReason, 'changed');
  const plan = await planCachePrune({ ...w.input(), selectors: sel({ partial: true }) });
  assert.deepEqual(plan.picked.map(p => p.name), [s.name]);
});

test('9. per-project caches of earlier betas list with their projectId', async t => {
  const w = world(t), a = npmPackage('alpha'), pid = 'e'.repeat(32), other = '1'.repeat(32);
  const id = await seedLegacy(w, a, pid), id2 = await seedLegacy(w, a, other);
  folder(path.join(w.stateRoot, '2'.repeat(32))); // a project folder with no cache: not a legacy cache
  const list = await listCache(w.input()), legacy = list.entries.filter(e => e.scope === 'project-legacy');
  assert.deepEqual(legacy.map(e => [e.projectId, e.id]), [[other, id2], [pid, id]], 'sorted by projectId');
  for (const e of legacy) { assert.equal(e.status, 'completed'); assert.equal(e.key, null); assert.deepEqual(e.references, { store: null, project: null }); assert.equal(e.label, '@synthetic/alpha@1.0.0:skills/alpha'); }
  assert.equal(list.unlisted, 0);
});

test('10. 4097 entries give truncated: true and 4096 listed', async t => {
  const w = world(t); stateFolders(w);
  for (let i = 0; i < 4097; i++) fs.mkdirSync(path.join(w.cacheRoot, 'op-' + i.toString(16).padStart(32, '0')), { mode: 0o700 });
  let inspected = 0;
  const hooks = { inspect: async () => { inspected++; throw Object.assign(new Error('skipped'), { code: 'NPM_CACHE_RECORD' }); } };
  const list = await listCache(w.input({ hooks }));
  assert.equal(list.truncated, true); assert.equal(list.entries.length, 4096); assert.equal(inspected, 4096);
  assert.equal(list.entries.at(-1).id, (4095).toString(16).padStart(32, '0'), 'the first 4096 names in byte order');
  assert.ok(list.entries.every(e => e.partialReason === 'unreadable'), 'an inspection that throws is an unreadable entry');
  const plan = await planCachePrune({ ...w.input({ hooks }), selectors: sel({ all: true }) });
  assert.equal(plan.picked.length, 4096); assert.equal(plan.truncated, true);
});

test('11. stray names, links, and folders that removeCacheEntry would refuse count under unlisted with a reason, and no plan picks them', async t => {
  const w = world(t), a = npmPackage('alpha'), ia = await seed(w, a); folder(w.storeCacheRoot);
  fs.writeFileSync(path.join(w.cacheRoot, 'notes.txt'), 'x\n', { mode: 0o600 });
  folder(path.join(w.cacheRoot, 'junk')); folder(path.join(w.storeCacheRoot, 'junk'));
  const outside = folder(path.join(w.base, 'outside')); fs.writeFileSync(path.join(outside, 'keep.md'), 'keep\n');
  fs.symlinkSync(outside, path.join(w.cacheRoot, 'op-' + 'f'.repeat(32)));
  fs.symlinkSync(outside, path.join(w.storeCacheRoot, `skill-x-${'f'.repeat(64)}`));
  const other = path.join(w.cacheRoot, 'op-' + '9'.repeat(32)); fs.mkdirSync(other, { mode: 0o755 }); fs.chmodSync(other, 0o755);
  const leftover = path.join(w.cacheRoot, '.prune-op-' + '8'.repeat(32) + '-01234567'); fs.mkdirSync(leftover, { mode: 0o750 }); fs.chmodSync(leftover, 0o750);
  const list = await listCache(w.input());
  assert.equal(list.unlisted, 7); assert.deepEqual(list.entries.map(e => e.id), [ia]);
  assert.deepEqual(list.unlistedNames, [
    { place: 'cache', name: '.prune-op-' + '8'.repeat(32) + '-01234567', reason: 'its mode is 0750, not 0700' },
    { place: 'cache', name: 'junk', reason: 'the name is not a cache entry name' },
    { place: 'cache', name: 'notes.txt', reason: 'the name is not a cache entry name' },
    { place: 'cache', name: 'op-' + '9'.repeat(32), reason: 'its mode is 0755, not 0700' },
    { place: 'cache', name: 'op-' + 'f'.repeat(32), reason: 'it is a link' },
    { place: 'store-cache', name: 'junk', reason: 'the name is not a cache entry name' },
    { place: 'store-cache', name: `skill-x-${'f'.repeat(64)}`, reason: 'it is a link' },
  ]);
  const before = { notes: fs.readFileSync(path.join(w.cacheRoot, 'notes.txt'), 'utf8'), keep: exactTree(outside), other: exactTree(other) };
  const input = { ...w.input(), selectors: sel({ all: true }) }, plan = await planCachePrune(input);
  assert.deepEqual(plan.picked.map(p => p.id), [ia], 'the list agrees with the delete: no plan picks a folder it cannot delete');
  await applyCachePrune(input, plan.revision, signal());
  assert.equal(fs.readFileSync(path.join(w.cacheRoot, 'notes.txt'), 'utf8'), before.notes); assert.equal(exactTree(outside), before.keep); assert.equal(exactTree(other), before.other);
  assert.ok(fs.lstatSync(path.join(w.cacheRoot, 'op-' + 'f'.repeat(32))).isSymbolicLink()); assert.ok(fs.existsSync(path.join(w.cacheRoot, 'junk'))); assert.ok(fs.existsSync(leftover));
});

test('12. each selector picks the entries of 3.4; an unknown source makes --unreferenced pick nothing', async t => {
  const w = world(t), a = npmPackage('alpha'), b = npmPackage('beta'), c = npmPackage('gamma');
  await storeItem(w, 'team', 'studio'); storePin(w, a.entry);
  const ia = await seed(w, a), ic = await seed(w, c), partial = seedPartial(w, b), legacy = await seedLegacy(w, c);
  const s = await seedStore(w, 'skill', 'house-style', SKILL_FILES);
  const pick = async extra => (await planCachePrune({ ...w.input(), selectors: sel(extra) })).picked.map(p => p.name);
  assert.deepEqual(await pick({ unreferenced: true }), ['op-' + ic, s.name], 'machine entries first, then the store cache');
  assert.deepEqual(await pick({ partial: true }), ['op-' + partial.operationId]);
  assert.deepEqual(await pick({ legacy: true }), ['op-' + legacy]);
  assert.deepEqual((await pick({ all: true })).length, 5);
  assert.ok(!(await pick({ unreferenced: true })).includes('op-' + ia), 'the store pin is kept');
  // An unknown project source: an invalid bowerloom.json.
  fs.writeFileSync(path.join(w.projectDir, 'bowerloom.json'), '{"format":"nope"}\n', { mode: 0o644 });
  const plan = await planCachePrune({ ...w.input(), selectors: sel({ unreferenced: true }) });
  assert.deepEqual(plan.picked, []); assert.deepEqual(plan.unreadableSources, ['project']);
});

test('13. --entry rules: length, hex, repeat, no match, two matches, an active entry', async t => {
  const w = world(t), a = npmPackage('alpha'), b = npmPackage('beta');
  const ia = await seed(w, a), live = seedPartial(w, b, 0, { release: false }); t.after(() => live.op.release());
  const one = await seedStore(w, 'skill', 'one', SKILL_FILES), two = await seedStore(w, 'skill', 'two', SKILL_FILES);
  assert.equal(one.hash, two.hash, 'the same files under two ids have one hash');
  const plan = entries => planCachePrune({ ...w.input(), selectors: sel({ entries }) });
  for (const bad of [[ia.slice(0, 7)], ['ZZZZZZZZ'], ['ABCDEF12'], [ia.slice(0, 8), ia.slice(0, 8)], ['g'.repeat(8)], ['a'.repeat(65)]]) await assert.rejects(plan(bad), code('USAGE'), JSON.stringify(bad));
  await assert.rejects(plan(['0123abcd'.repeat(2)]), code('CACHE_ENTRY_NOT_FOUND'));
  await assert.rejects(plan([one.hash.slice(0, 8)]), e => code('USAGE')(e) && e.message === `The prefix matches more than one entry. Use more characters. It matches store-cache ${one.name}, store-cache ${two.name}.` && e.next === 'bowerloom help cache');
  await assert.rejects(plan(['ZZZZZZZZ']), e => code('USAGE')(e) && e.next === 'bowerloom help cache');
  await assert.rejects(plan([live.operationId.slice(0, 10)]), code('CACHE_ENTRY_BUSY'));
  assert.deepEqual((await plan([ia.slice(0, 8)])).picked.map(p => p.id), [ia]);
  assert.deepEqual((await plan([two.name])).picked.map(p => p.name), [two.name], 'a full store folder name picks one');
  assert.deepEqual((await plan([ia])).picked.map(p => p.id), [ia], 'the full id');
  await assert.rejects(planCachePrune({ ...w.input(), selectors: sel({ all: true, entries: [ia] }) }), code('USAGE'));
  await assert.rejects(planCachePrune({ ...w.input(), selectors: sel({ all: true, partial: true }) }), code('USAGE'));
  await assert.rejects(planCachePrune({ ...w.input(), selectors: sel({}) }), code('USAGE'));
});

test('14. the plan JSON matches 4.2, and a changed bound value changes the revision', async t => {
  const w = world(t), a = npmPackage('alpha'), ia = await seed(w, a), s = await seedStore(w, 'skill', 'house-style', SKILL_FILES);
  const plan = await planCachePrune({ ...w.input(), selectors: sel({ all: true }) });
  const { revision, ...body } = plan;
  assert.equal(revision, sha(canonicalJson(body)));
  assert.equal(plan.format, 'bowerloom/cache-prune-plan/v1beta1'); assert.equal(plan.stateRoot, w.stateRoot);
  assert.deepEqual(plan.selectors, sel({ all: true })); assert.equal(plan.writesAuthorized, false); assert.equal(plan.executionAuthorized, false);
  assert.equal(plan.projectChecked, true); assert.equal(plan.freed, plan.picked.reduce((n, p) => n + p.bytes, 0));
  const seen = await inspectSkillCache({ root: w.cacheRoot, operationId: ia });
  assert.deepEqual(plan.picked[0], { scope: 'machine', id: ia, name: 'op-' + ia, projectId: null, status: 'completed', label: '@synthetic/alpha@1.0.0:skills/alpha', files: 3, bytes: sumBytes(a.entry), references: { store: false, project: false }, stale: false, partialReason: null, bound: { snapshotRevision: seen.snapshotRevision, receiptRevision: seen.receipt.revision, contentHash: null } });
  assert.deepEqual(plan.picked[1].bound, { snapshotRevision: null, receiptRevision: null, contentHash: s.hash });
  // A retry that replaced the operation changes its snapshot: the revision changes.
  fs.rmSync(path.join(w.cacheRoot, 'op-' + ia), { recursive: true }); await seed(w, a);
  assert.notEqual((await planCachePrune({ ...w.input(), selectors: sel({ all: true }) })).revision, plan.revision);
});

test('15. applyCachePrune deletes the picked entries and nothing else', async t => {
  const w = world(t), a = npmPackage('alpha'), b = npmPackage('beta');
  await storeItem(w, 'team', 'studio'); storePin(w, a.entry);
  const ia = await seed(w, a), ib = await seed(w, b), s = await seedStore(w, 'skill', 'house-style', SKILL_FILES);
  const before = exactTree(path.join(w.cacheRoot, 'op-' + ia)), input = { ...w.input(), selectors: sel({ unreferenced: true }) };
  const plan = await planCachePrune(input);
  assert.deepEqual(plan.picked.map(p => p.name), ['op-' + ib, s.name]);
  const result = await applyCachePrune(input, plan.revision, signal());
  assert.deepEqual(result, { format: 'bowerloom/cache-prune-result/v1beta1', planRevision: plan.revision, deleted: [{ scope: 'machine', id: ib, projectId: null }, { scope: 'store', id: s.hash, projectId: null }], skipped: [], freed: plan.freed, executionAuthorized: false });
  assert.deepEqual(fs.readdirSync(w.cacheRoot), ['op-' + ia]); assert.deepEqual(fs.readdirSync(w.storeCacheRoot), []);
  assert.equal(exactTree(path.join(w.cacheRoot, 'op-' + ia)), before, 'the kept entry is byte-identical');
});

test('16. an entry that changes between plan and apply refuses STALE_APPROVAL and deletes nothing', async t => {
  const w = world(t), a = npmPackage('alpha'), b = npmPackage('beta');
  const ia = await seed(w, a); await seed(w, b);
  const input = { ...w.input(), selectors: sel({ all: true }) }, plan = await planCachePrune(input);
  fs.rmSync(path.join(w.cacheRoot, 'op-' + ia), { recursive: true }); await seed(w, a); // a retry replaced it
  const before = exactTree(w.stateRoot);
  await assert.rejects(applyCachePrune(input, plan.revision, signal()), code('STALE_APPROVAL'));
  assert.equal(exactTree(w.stateRoot), before);
  // The same change made under the cache lock, after the approval matched: still stale, still nothing deleted.
  const fresh = await planCachePrune(input);
  const hooks = { underLock: () => { const file = path.join(w.cacheRoot, 'op-' + ia, 'files', 'references', 'guide.md'); fs.chmodSync(file, 0o600); fs.appendFileSync(file, 'x'); } };
  await assert.rejects(applyCachePrune({ ...input, hooks }, fresh.revision, signal()), e => code('STALE_APPROVAL')(e) && e.message.endsWith(` Entry cache ${ia.slice(0, 8)} changed after the plan: its status is now partial.`));
  assert.equal(fs.readdirSync(w.cacheRoot).length, 2);
  // A new entry that lands after the plan is not in it, and stays.
  const c = npmPackage('gamma'), again = await planCachePrune(input);
  const landing = { underLock: async () => { await seedInsideLock(w, c); } };
  await applyCachePrune({ ...input, hooks: landing }, again.revision, signal());
  assert.deepEqual(fs.readdirSync(w.cacheRoot), ['op-' + cacheOperationId(entryRequest(c.entry).digest, 0)]);
});
/** A fetch that lands while prune holds the lock: written straight through the cache operation, which takes no lock. */
async function seedInsideLock(w, pkg) {
  const { cacheRequest, digest } = entryRequest(pkg.entry), operationId = cacheOperationId(digest, 0);
  const plan = planNpmAcquisition(cacheRequest, observeSkillCacheRoot(w.cacheRoot, operationId, 33554432));
  await storeOperation(plan, plan.revision, signal(), pkg);
}

test('17. a failure on the third of five entries refuses CACHE_PRUNE_FAILED, Deleted 2 of 5, and leaves a .prune-* that --partial removes', async t => {
  const w = world(t), pkgs = ['a1', 'a2', 'a3', 'a4', 'a5'].map(id => npmPackage(id));
  for (const p of pkgs) await seed(w, p);
  const input = { ...w.input(), selectors: sel({ all: true }) }, plan = await planCachePrune(input);
  const hooks = { heldCheck: (index, step) => { if (index === 2 && step === 1) throw new Error('TEST_CRASH_AFTER_RENAME'); } };
  const third = plan.picked[2].name;
  await assert.rejects(applyCachePrune({ ...input, hooks }, plan.revision, signal()), e => code('CACHE_PRUNE_FAILED')(e) && e.message === `Bowerloom failed to delete a cache entry. Entries it deleted before that stay deleted. Could not delete cache/${third} at the delete step (Error). Deleted 2 of 5 entries. It stopped at cache ${plan.picked[2].id.slice(0, 8)}.`);
  const left = fs.readdirSync(w.cacheRoot).sort();
  assert.equal(left.length, 3); assert.equal(left.filter(n => n.startsWith('.prune-op-')).length, 1);
  assert.ok(left.some(n => n.startsWith(`.prune-${third}-`)), 'the third is the leftover');
  const list = byName(await listCache(w.input())), leftover = left.find(n => n.startsWith('.prune-'));
  assert.deepEqual({ status: list[leftover].status, active: list[leftover].active, id: list[leftover].id, partialReason: list[leftover].partialReason }, { status: 'partial', active: false, id: leftover, partialReason: 'prune-leftover' });
  const partial = { ...w.input(), selectors: sel({ partial: true }) }, rerun = await planCachePrune(partial);
  assert.deepEqual(rerun.picked.map(p => p.name), [leftover]); assert.deepEqual(rerun.picked[0].bound, { snapshotRevision: null, receiptRevision: null, contentHash: null });
  await applyCachePrune(partial, rerun.revision, signal());
  assert.equal(fs.readdirSync(w.cacheRoot).length, 2);
});

test('18. the cache lock is held while apply deletes', async t => {
  const w = world(t), a = npmPackage('alpha'), b = npmPackage('beta'); await seed(w, a); await seed(w, b);
  const input = { ...w.input(), selectors: sel({ all: true }) }, plan = await planCachePrune(input), probes = [];
  const hooks = { afterRemove: async index => { probes.push(index); await assert.rejects(withCacheLock(w.cacheRoot, signal(), async () => 'got it', { waitMs: 0 }), code('PROJECT_LOCK_UNAVAILABLE')); } };
  await applyCachePrune({ ...input, hooks }, plan.revision, signal());
  assert.deepEqual(probes, [0, 1]);
  assert.equal(await withCacheLock(w.cacheRoot, signal(), async () => 'free', { waitMs: 0 }), 'free', 'and released after');
});

test('19. project files, .bowerloom/managed, the items folder and the store are byte-identical after a prune', async t => {
  const w = world(t), a = npmPackage('alpha'), b = npmPackage('beta');
  await storeItem(w, 'team', 'studio'); await storeItem(w, 'skill', 'house-style', { teams: ['studio'] }); storePin(w, a.entry);
  projectPins(w, [b.entry]); fs.writeFileSync(path.join(w.projectDir, 'AGENTS.md'), 'Keep.\n');
  folder(path.join(w.projectDir, '.bowerloom', 'managed')); fs.writeFileSync(path.join(w.projectDir, '.bowerloom', 'managed', 'x.json'), '{}\n');
  await seed(w, a); await seed(w, b); await seedLegacy(w, a, w.project().projectId);
  const items = folder(path.join(w.stateRoot, w.project().projectId, 'items')); fs.writeFileSync(path.join(items, 'record.json'), '{}\n', { mode: 0o600 });
  const before = { store: exactTree(w.store), project: exactTree(w.projectDir), items: exactTree(items) };
  const input = { ...w.input(), selectors: sel({ all: true }) }, plan = await planCachePrune(input);
  assert.equal(plan.picked.length, 3);
  await applyCachePrune(input, plan.revision, signal());
  assert.deepEqual({ store: exactTree(w.store), project: exactTree(w.projectDir), items: exactTree(items) }, before);
  assert.deepEqual(fs.readdirSync(path.join(w.stateRoot, w.project().projectId)).sort(), ['cache', 'items'], 'the legacy cache folder itself stays');
});

test('20. after a pin is pruned, the sync planner shows it as needs-fetch again', async t => {
  const w = world(t), a = npmPackage('alpha'); projectPins(w, [a.entry]); await seed(w, a);
  const syncInput = () => ({ project: w.project(), stateRoot: w.stateRoot, team: null, offline: false, home: w.home });
  assert.equal((await planSync(syncInput())).items[0].cache.status, 'cached');
  const input = { ...w.input(), selectors: sel({ all: true }) }; await applyCachePrune(input, (await planCachePrune(input)).revision, signal());
  assert.equal((await planSync(syncInput())).items[0].cache.status, 'needs-fetch');
});

test('21. selectors combine as a union, and each entry appears once', async t => {
  const w = world(t), a = npmPackage('alpha'), b = npmPackage('beta');
  const partial = seedPartial(w, a), legacy = await seedLegacy(w, b), ib = await seed(w, b);
  const leftover = folder(path.join(w.stateRoot, 'e'.repeat(32), 'cache', '.prune-op-' + '3'.repeat(32) + '-01234567'));
  const plan = await planCachePrune({ ...w.input(), selectors: sel({ partial: true, legacy: true, unreferenced: true, entries: [ib.slice(0, 8)] }) });
  const machine = [partial.operationId, ib].sort().map(id => 'op-' + id);
  assert.deepEqual(plan.picked.map(p => p.name), [...machine, path.basename(leftover), 'op-' + legacy], 'a leftover id is its name, and . sorts before hex');
  assert.equal(new Set(plan.picked.map(p => `${p.scope}/${p.projectId}/${p.name}`)).size, plan.picked.length);
});

test('22. --unreferenced: a source that lists a picked entry between plan and apply refuses STALE_APPROVAL', async t => {
  const w = world(t), a = npmPackage('alpha'); await storeItem(w, 'team', 'studio');
  const ia = await seed(w, a), input = { ...w.input(), selectors: sel({ unreferenced: true }) }, plan = await planCachePrune(input);
  assert.deepEqual(plan.picked.map(p => p.id), [ia]);
  storePin(w, a.entry);
  await assert.rejects(applyCachePrune(input, plan.revision, signal()), code('STALE_APPROVAL'));
  // The same, when the store lists it only after apply holds the cache lock.
  emptyStorePins(w);
  const fresh = await planCachePrune(input);
  await assert.rejects(applyCachePrune({ ...input, hooks: { underLock: () => storePin(w, a.entry) } }, fresh.revision, signal()), code('STALE_APPROVAL'));
  // A project that starts to pin it under the lock, too.
  emptyStorePins(w);
  const third = await planCachePrune(input);
  await assert.rejects(applyCachePrune({ ...input, hooks: { underLock: () => projectPins(w, [a.entry]) } }, third.revision, signal()), code('STALE_APPROVAL'));
  assert.deepEqual(fs.readdirSync(w.cacheRoot), ['op-' + ia]);
});

test('23. a project folder or cache in the state folder that fails the folder checks counts under unlisted', async t => {
  const w = world(t), a = npmPackage('alpha');
  await seedLegacy(w, a, '1'.repeat(32)); fs.chmodSync(path.join(w.stateRoot, '1'.repeat(32)), 0o755);
  await seedLegacy(w, a, '2'.repeat(32)); fs.chmodSync(path.join(w.stateRoot, '2'.repeat(32), 'cache'), 0o750);
  const real = folder(path.join(w.base, 'elsewhere')); folder(path.join(real, 'cache'));
  fs.symlinkSync(real, path.join(w.stateRoot, '3'.repeat(32)));
  folder(path.join(w.stateRoot, '4'.repeat(32))); fs.symlinkSync(path.join(real, 'cache'), path.join(w.stateRoot, '4'.repeat(32), 'cache'));
  const ok = await seedLegacy(w, a, '5'.repeat(32));
  const list = await listCache(w.input());
  assert.equal(list.unlisted, 4); assert.deepEqual(list.entries.map(e => [e.projectId, e.id]), [['5'.repeat(32), ok]]);
  const id = n => n.repeat(32);
  assert.deepEqual(list.unlistedNames, [
    { place: 'legacy', name: id('1'), reason: `the folder ${id('1')} has mode 0755, not 0700` },
    { place: 'legacy', name: id('2'), reason: `the folder ${id('2')}/cache has mode 0750, not 0700` },
    { place: 'legacy', name: id('3'), reason: `the folder ${id('3')} is a link` },
    { place: 'legacy', name: id('4'), reason: `the folder ${id('4')}/cache is a link` },
  ]);
  t.after(() => { for (const n of ['1', '2']) try { fs.chmodSync(path.join(w.stateRoot, n.repeat(32)), 0o700); fs.chmodSync(path.join(w.stateRoot, n.repeat(32), 'cache'), 0o700); } catch { /* gone */ } });
});

test('24. an owner lock older than 24 hours lists stale: true and --partial picks the entry', async t => {
  const w = world(t), a = npmPackage('alpha'), b = npmPackage('beta');
  const crashed = seedPartial(w, a, 0, { release: false }), fresh = seedPartial(w, b, 0, { release: false });
  t.after(() => { crashed.op.release(); fresh.op.release(); });
  const lock = path.join(w.cacheRoot, 'op-' + crashed.operationId, 'owner.lock'), old = new Date(Date.now() - 25 * 3600 * 1000);
  fs.lutimesSync(lock, old, old);
  const n = byName(await listCache(w.input()));
  assert.deepEqual([n['op-' + crashed.operationId].active, n['op-' + crashed.operationId].stale], [true, true]);
  assert.deepEqual([n['op-' + fresh.operationId].active, n['op-' + fresh.operationId].stale], [true, false]);
  const plan = await planCachePrune({ ...w.input(), selectors: sel({ partial: true }) });
  assert.deepEqual(plan.picked.map(p => [p.id, p.stale]), [[crashed.operationId, true]]);
  assert.deepEqual(plan.skipped.map(s => s.id), [fresh.operationId]);
  assert.deepEqual((await planCachePrune({ ...w.input(), selectors: sel({ entries: [crashed.operationId.slice(0, 8)] }) })).picked.map(p => p.id), [crashed.operationId]);
  // Decision D (tech lead): --legacy takes the stale-owner rule too.
  const pid = 'e'.repeat(32), legacy = folder(path.join(folder(path.join(folder(path.join(w.stateRoot, pid)), 'cache')), 'op-' + '6'.repeat(32)));
  fs.writeFileSync(path.join(legacy, 'owner.lock'), 'x\n', { mode: 0o600 }); fs.lutimesSync(path.join(legacy, 'owner.lock'), old, old);
  const busyLegacy = folder(path.join(w.stateRoot, pid, 'cache', 'op-' + '5'.repeat(32))); fs.writeFileSync(path.join(busyLegacy, 'owner.lock'), 'x\n', { mode: 0o600 });
  const lp = await planCachePrune({ ...w.input(), selectors: sel({ legacy: true }) });
  assert.deepEqual(lp.picked.map(p => p.id), ['6'.repeat(32)]); assert.deepEqual(lp.skipped.map(x => x.id), ['5'.repeat(32)]);
});

test('25. each unknown-source rule of 3.2 puts the source in unreadableSources', async t => {
  const cases = [
    ['a discovery refusal other than PROJECT_NOT_FOUND', 'project', async w => ({ project: null, projectError: 'PROJECT_UNSAFE' }), 'PROJECT_UNSAFE', null],
    ['a refusing .bowerloom/skills.json', 'project', async w => { fs.writeFileSync(path.join(w.projectDir, '.bowerloom', 'skills.json'), '{', { mode: 0o644 }); return {}; }, 'MANIFEST_INVALID', '.bowerloom/skills.json'],
    ['an invalid bowerloom.json', 'project', async w => { fs.writeFileSync(path.join(w.projectDir, 'bowerloom.json'), '[]\n', { mode: 0o644 }); return {}; }, 'CONFIG_INVALID', 'bowerloom.json'],
    ['a refusing lock', 'project', async w => { fs.writeFileSync(path.join(w.projectDir, 'bowerloom.lock.json'), '{}\n', { mode: 0o644 }); return {}; }, 'LOCK_INVALID', 'bowerloom.lock.json'],
    ['a throwing inspectStore', 'store', async w => { await storeItem(w, 'team', 'studio'); fs.chmodSync(w.store, 0o777); return {}; }, 'STORE_UNSAFE', null],
    ['a refusing store skills.json', 'store', async w => { await storeItem(w, 'team', 'studio'); fs.writeFileSync(path.join(w.store, 'skills.json'), 'null', { mode: 0o600 }); return {}; }, 'MANIFEST_INVALID', 'skills.json'],
    ['a localItemRows refusal for a live store item', 'store', async w => { await storeItem(w, 'team', 'studio'); await storeItem(w, 'skill', 'house-style'); fs.writeFileSync(path.join(w.store, 'skills', 'house-style', 'run.sh'), 'echo\n', { mode: 0o755 }); return {}; }, 'STORE_ITEM_NOT_SHAREABLE', 'skill house-style'],
    ...['skills', 'prompts', 'teams'].map(area => [`a linked store area ~/.bowerloom/${area}`, 'store', async w => {
      await storeItem(w, 'team', 'studio'); const real = path.join(w.base, `real-${area}`);
      if (fs.existsSync(path.join(w.store, area))) fs.renameSync(path.join(w.store, area), real); else fs.mkdirSync(real, { mode: 0o700 });
      fs.symlinkSync(real, path.join(w.store, area)); return {};
    }, 'AUTHORING_UNSAFE_PATH', area]),
    ['a folder at ~/.bowerloom that is not a store', 'store', async w => { fs.mkdirSync(w.store, { mode: 0o700 }); fs.writeFileSync(path.join(w.store, 'notes.md'), 'x\n'); return {}; }, 'STORE_INVALID', null],
  ];
  for (const [name, source, make, why, item] of cases) {
    await t.test(name, async t2 => {
      const w = world(t2), extra = await make(w), a = npmPackage('alpha'); await seed(w, a);
      t2.after(() => { try { fs.chmodSync(w.store, 0o700); } catch { /* gone */ } });
      const list = await listCache(w.input(extra));
      assert.deepEqual(list.unreadableSources, [source]); assert.equal(list.entries[0].references[source], null);
      assert.deepEqual(list.unreadable, [{ source, code: why, item }], 'review M1: the cause of an unknown source');
      assert.deepEqual((await planCachePrune({ ...w.input(extra), selectors: sel({ unreferenced: true }) })).picked, []);
    });
  }
});

test('26. readStoreCache throwing makes the entry partial with label null', async t => {
  const w = world(t), s = await seedStore(w, 'prompt', 'weekly', [{ path: 'weekly.md', text: '# Weekly\n' }]);
  fs.writeFileSync(path.join(w.storeCacheRoot, s.name, 'extra.md'), 'not part of the item\n', { mode: 0o600 });
  const e = byName(await listCache(w.input()))[s.name];
  assert.deepEqual([e.status, e.label, e.kind, e.files, e.bytes, e.partialReason], ['partial', null, 'store-git', null, null, 'unreadable']);
  const leftover = folder(path.join(w.storeCacheRoot, `.tmp-${s.name}-0badc0de`));
  const plan = await planCachePrune({ ...w.input(), selectors: sel({ partial: true }) });
  assert.deepEqual(plan.picked.map(p => p.name), [path.basename(leftover), s.name], 'a leftover id is its name, and . sorts before hex');
  assert.equal(byName(await listCache(w.input()))[path.basename(leftover)].partialReason, 'write-leftover');
});

test('12.7. a pin pruned between phase A and phase B of a sync refuses STALE_APPROVAL, names the cause, and changes nothing in the project', async t => {
  const w = world(t), a = npmPackage('alpha'); projectPins(w, [a.entry]);
  const syncInput = () => ({ project: w.project(), stateRoot: w.stateRoot, team: null, offline: false, home: w.home });
  const plan = await planSync(syncInput()), before = exactTree(w.projectDir);
  const { managedPort } = await import('../../../dist/packages/project-sync/src/deps.js');
  const managed = { async plan(req, options) { const input = { ...w.input(), selectors: sel({ all: true }) }; await applyCachePrune(input, (await planCachePrune(input)).revision, signal()); return managedPort.plan(req, options); }, apply: managedPort.apply };
  // Review M2 of PR 99 (tech lead): the cause and the next step, in place of MANAGED_SKILL_REFUSED.
  await assert.rejects(applySync(syncInput(), plan.revision, { acquirer: fakeAcquirer([a]), signal: signal(), managed }), e => code('STALE_APPROVAL')(e)
    && e.message.endsWith(' The cached pin of alpha was deleted after the fetch, for example by bowerloom cache prune. Run bowerloom skills sync again.') && e.next === 'bowerloom skills sync');
  assert.equal(exactTree(w.projectDir), before, 'nothing in the project changed');
  assert.equal(fs.existsSync(path.join(w.projectDir, '.bowerloom', 'managed-pending.json')), false, 'no pending record');
  // A rerun fetches again.
  const again = await planSync(syncInput()); assert.equal(again.items[0].cache.status, 'needs-fetch');
  const done = await applySync(syncInput(), again.revision, { acquirer: fakeAcquirer([a]), signal: signal() });
  assert.deepEqual(done.fetched, ['alpha']);
});

test('6b. a store-cache entry of a live store item is a store reference, and --unreferenced keeps it', async t => {
  const w = world(t); await storeItem(w, 'team', 'studio'); await storeItem(w, 'skill', 'house-style', { teams: ['studio'] });
  const live = storeFiles(w, 'skill', 'house-style').map(f => ({ path: f.path, text: f.bytes.toString('utf8') }));
  const kept = await seedStore(w, 'skill', 'house-style', live), old = await seedStore(w, 'skill', 'house-style', [{ path: 'SKILL.md', text: '---\nname: house-style\ndescription: Old.\n---\nOld.\n' }]);
  const n = byName(await listCache(w.input()));
  assert.deepEqual(n[kept.name].references, { store: true, project: false }); assert.equal(n[kept.name].key, kept.hash);
  assert.deepEqual(n[old.name].references, { store: false, project: false });
  assert.deepEqual((await planCachePrune({ ...w.input(), selectors: sel({ unreferenced: true }) })).picked.map(p => p.name), [old.name]);
});

test('7b. an operation folder with an owner lock is active even when its inspection fails', async t => {
  const w = world(t); stateFolders(w);
  const id = '7'.repeat(32), op = folder(path.join(w.cacheRoot, 'op-' + id)); fs.writeFileSync(path.join(op, 'owner.lock'), 'x\n', { mode: 0o600 });
  const e = byName(await listCache(w.input()))['op-' + id];
  assert.deepEqual([e.status, e.active, e.stale, e.label], ['partial', true, false, null]);
  const plan = await planCachePrune({ ...w.input(), selectors: sel({ partial: true }) });
  assert.deepEqual(plan.picked, []); assert.deepEqual(plan.skipped.map(s => s.id), [id]);
  await assert.rejects(planCachePrune({ ...w.input(), selectors: sel({ entries: [id.slice(0, 8)] }) }), code('CACHE_ENTRY_BUSY'));
});

test('16b. an approval that names another revision refuses STALE_APPROVAL and deletes nothing', async t => {
  const w = world(t), a = npmPackage('alpha'); await seed(w, a);
  const input = { ...w.input(), selectors: sel({ all: true }) };
  await assert.rejects(applyCachePrune(input, 'f'.repeat(64), signal()), code('STALE_APPROVAL'));
  assert.equal(fs.readdirSync(w.cacheRoot).length, 1);
});

test('12.7b. a cached pin pruned before phase A reads it back gives the same cause and next step', async t => {
  const w = world(t), a = npmPackage('alpha'); projectPins(w, [a.entry]); await seed(w, a);
  const item = (await planSync({ project: w.project(), stateRoot: w.stateRoot, team: null, offline: false, home: w.home })).items[0];
  const input = { ...w.input(), selectors: sel({ all: true }) }; await applyCachePrune(input, (await planCachePrune(input)).revision, signal());
  await assert.rejects(selectorFor(item, entryRequest(a.entry), item.cache), e => code('STALE_APPROVAL')(e)
    && e.message.endsWith(' The cached pin of alpha was deleted after the fetch, for example by bowerloom cache prune. Run bowerloom skills sync again.') && e.next === 'bowerloom skills sync');
  // An operation that is there but unreadable keeps its own refusal.
  await seed(w, a); fs.appendFileSync(path.join(w.cacheRoot, 'op-' + item.cache.operationId, 'files', 'SKILL.md'), 'x');
  await assert.rejects(selectorFor(item, entryRequest(a.entry), item.cache), code('SKILLS_CACHE_RECOVERY_REQUIRED'));
});

test('H1. apply yields between deletes, so an interrupt stops it between two entries', async t => {
  const w = world(t); for (const id of ['p1', 'p2', 'p3']) await seed(w, npmPackage(id));
  const input = { ...w.input(), selectors: sel({ all: true }) }, plan = await planCachePrune(input), controller = new AbortController();
  // The abort runs as a macrotask, as a SIGINT handler does. Without a yield the loop deletes all three first.
  const hooks = { afterRemove: index => { if (index === 0) setImmediate(() => controller.abort()); } };
  await assert.rejects(applyCachePrune({ ...input, hooks }, plan.revision, controller.signal), e => e.name === 'AbortError' && e.deleted === 1 && e.of === 3 && e.stoppedAt === `cache ${plan.picked[1].id.slice(0, 8)}`);
  assert.equal(fs.readdirSync(w.cacheRoot).length, 2);
});

test('H2. a lost cache lock stops the prune as PROJECT_LOCK_UNAVAILABLE and says how far it got', async t => {
  const w = world(t); for (const id of ['p1', 'p2']) await seed(w, npmPackage(id));
  const input = { ...w.input(), selectors: sel({ all: true }) }, plan = await planCachePrune(input);
  const hooks = { heldCheck: (index, step) => { if (index === 1 && step === 0) throw Object.assign(new Error('The lock was lost.'), { code: 'PROJECT_LOCK_UNAVAILABLE', name: 'DefinitionError' }); } };
  await assert.rejects(applyCachePrune({ ...input, hooks }, plan.revision, signal()), e => code('PROJECT_LOCK_UNAVAILABLE')(e) && e.message === `The lock was lost. Deleted 1 of 2 entries. It stopped at cache ${plan.picked[1].id.slice(0, 8)}.`);
  assert.equal(fs.readdirSync(w.cacheRoot).length, 1);
});

test('A13. --unreferenced: the project becomes unreadable under the lock, so the prune is stale and deletes nothing', async t => {
  const w = world(t), ia = await seed(w, npmPackage('alpha')), input = { ...w.input(), selectors: sel({ unreferenced: true }) };
  const plan = await planCachePrune(input); assert.deepEqual(plan.picked.map(p => p.id), [ia]);
  const hooks = { underLock: () => fs.writeFileSync(path.join(w.projectDir, 'bowerloom.lock.json'), '{}\n', { mode: 0o644 }) };
  await assert.rejects(applyCachePrune({ ...input, hooks }, plan.revision, signal()), e => code('STALE_APPROVAL')(e) && e.message.endsWith(` Entry cache ${ia.slice(0, 8)} changed after the plan: project can no longer be read (LOCK_INVALID).`));
  assert.deepEqual(fs.readdirSync(w.cacheRoot), ['op-' + ia]);
});

test('A14. an unreadable partial entry that gains an owner lock under the lock is stale', async t => {
  const w = world(t); stateFolders(w); const id = '7'.repeat(32), op = folder(path.join(w.cacheRoot, 'op-' + id));
  const input = { ...w.input(), selectors: sel({ partial: true }) }, plan = await planCachePrune(input);
  assert.deepEqual(plan.picked.map(p => p.id), [id]);
  const hooks = { underLock: () => fs.writeFileSync(path.join(op, 'owner.lock'), 'x\n', { mode: 0o600 }) };
  await assert.rejects(applyCachePrune({ ...input, hooks }, plan.revision, signal()), e => code('STALE_APPROVAL')(e) && e.message.endsWith(` Entry cache ${id.slice(0, 8)} changed after the plan: another command is using it now.`));
  assert.ok(fs.existsSync(op));
});

test('A15. a picked entry that is gone under the lock is stale, and nothing else is deleted', async t => {
  const w = world(t), ia = await seed(w, npmPackage('alpha')), ib = await seed(w, npmPackage('beta'));
  const input = { ...w.input(), selectors: sel({ all: true }) }, plan = await planCachePrune(input), gone = plan.picked[1].id;
  const hooks = { underLock: () => fs.rmSync(path.join(w.cacheRoot, 'op-' + gone), { recursive: true }) };
  await assert.rejects(applyCachePrune({ ...input, hooks }, plan.revision, signal()), e => code('STALE_APPROVAL')(e) && e.message.endsWith(` Entry cache ${gone.slice(0, 8)} changed after the plan: it is gone.`));
  assert.deepEqual(fs.readdirSync(w.cacheRoot), ['op-' + [ia, ib].find(x => x !== gone)]);
});

test('L5. an owner lock that cannot be read makes the entry active', async t => {
  const w = world(t), a = npmPackage('alpha'), ia = await seed(w, a), lock = path.join(w.cacheRoot, 'op-' + ia, 'owner.lock');
  const original = fs.lstatSync;
  fs.lstatSync = (p, ...rest) => { if (p === lock) throw Object.assign(new Error('denied'), { code: 'EACCES' }); return original(p, ...rest); };
  try { const e = byName(await listCache(w.input()))['op-' + ia]; assert.deepEqual([e.active, e.status], [true, 'partial']); }
  finally { fs.lstatSync = original; }
});

test('L2. an id shared by two per-project caches is picked by <projectId>/<id-prefix>', async t => {
  const w = world(t), a = npmPackage('alpha'), p1 = '1'.repeat(32), p2 = '2'.repeat(32);
  const id = await seedLegacy(w, a, p1); assert.equal(await seedLegacy(w, a, p2), id);
  const plan = entries => planCachePrune({ ...w.input(), selectors: sel({ entries }) });
  await assert.rejects(plan([id]), e => code('USAGE')(e) && e.message === `The prefix matches more than one entry. Use more characters. It matches legacy ${p1}/${id}, legacy ${p2}/${id}.`);
  assert.deepEqual((await plan([`${p2.slice(0, 8)}/${id.slice(0, 8)}`])).picked.map(p => [p.projectId, p.id]), [[p2, id]]);
  for (const bad of [`${p2.slice(0, 7)}/${id.slice(0, 8)}`, `${p2.slice(0, 8)}/${id.slice(0, 7)}`, `${p2}/`, `/${id}`]) await assert.rejects(plan([bad]), code('USAGE'), bad);
});

test('M1. an error that is not a refusal still stops the list', async t => {
  const w = world(t); await storeItem(w, 'team', 'studio'); await seed(w, npmPackage('alpha'));
  const original = fs.lstatSync, area = path.join(w.store, 'teams');
  fs.lstatSync = (p, ...rest) => { if (p === area) throw new TypeError('a fault of the code'); return original(p, ...rest); };
  try { await assert.rejects(listCache(w.input()), TypeError); } finally { fs.lstatSync = original; }
});

test('L10. writeStoreCache removes a .tmp- leftover through removeCacheEntry, so a leftover it cannot delete safely refuses', async t => {
  const w = world(t), rows = SKILL_FILES.map(f => ({ path: f.path, bytes: Buffer.from(f.text) }));
  const { hash } = (await import('../../../dist/packages/skill-manifest/src/resolve-store-git.js')).authoredRows(rows), key = `skill-house-style-${hash}`;
  stateFolders(w); folder(w.storeCacheRoot);
  const ok = folder(path.join(w.storeCacheRoot, `.tmp-${key}-0123abcd`)), bad = path.join(w.storeCacheRoot, `.tmp-${key}-89abcdef`);
  fs.mkdirSync(bad, { mode: 0o755 }); fs.chmodSync(bad, 0o755);
  await assert.rejects(writeStoreCache({ cacheRoot: w.cacheRoot, storeCacheRoot: w.storeCacheRoot }, 'skill', 'house-style', hash, rows, signal()), code('SKILLS_STATE_UNSAFE'));
  assert.ok(fs.existsSync(bad), 'a leftover that removeCacheEntry refuses stays');
  fs.chmodSync(bad, 0o700);
  await writeStoreCache({ cacheRoot: w.cacheRoot, storeCacheRoot: w.storeCacheRoot }, 'skill', 'house-style', hash, rows, signal());
  assert.deepEqual(fs.readdirSync(w.storeCacheRoot), [key]); void ok;
});

test('16c. a completed entry replaced under the lock, with the same status, is stale: its bytes changed', async t => {
  const w = world(t), a = npmPackage('alpha'), ia = await seed(w, a);
  const input = { ...w.input(), selectors: sel({ all: true }) }, plan = await planCachePrune(input);
  const hooks = { underLock: async () => { fs.rmSync(path.join(w.cacheRoot, 'op-' + ia), { recursive: true }); await seedInsideLock(w, a); } };
  await assert.rejects(applyCachePrune({ ...input, hooks }, plan.revision, signal()), e => code('STALE_APPROVAL')(e) && e.message.endsWith(` Entry cache ${ia.slice(0, 8)} changed after the plan: its bytes changed.`));
  assert.deepEqual(fs.readdirSync(w.cacheRoot), ['op-' + ia]);
});
