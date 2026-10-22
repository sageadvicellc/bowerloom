// The machine cache without a project (store writes spec, 3.8): cacheLayout, seedPin with a null project, storeStateNested.
import test from '../../../dist/tests/support/lock-slot-retry.js';
import { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cacheLayout, storeStateNested } from '../../../dist/packages/project-sync/src/index.js';
import { seedPin } from '../../../dist/packages/project-sync/src/seed.js';
import { inspectStore } from '../../../dist/packages/project-context/src/index.js';
import { denyNetwork, npmPackage, syncProject, code } from './sync-fixture.mjs';

const network = denyNetwork();
after(() => assert.deepEqual(network, []));
const verified = pkg => ({ kind: 'npm', metadata: pkg.metadata, data: pkg.archive });
/** A private base folder in HOME with `state/` made, so only the state root and the cache are missing. */
function base(t) {
  const root = fs.realpathSync(os.homedir()), dir = fs.mkdtempSync(path.join(root, '.bowerloom-seed-')); fs.chmodSync(dir, 0o700);
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const home = path.join(dir, 'home'); fs.mkdirSync(home, { mode: 0o700 });
  fs.mkdirSync(path.join(dir, 'state'), { mode: 0o700 });
  return { home, dir, stateRoot: path.join(dir, 'state', 'bowerloom') };
}
function storeIn(home) {
  const dir = path.join(home, '.bowerloom'); fs.mkdirSync(dir, { mode: 0o700 });
  fs.writeFileSync(path.join(dir, 'store.json'), '{"format":"bowerloom/store/v1beta1"}\n', { mode: 0o644 });
  return inspectStore(home).context;
}

test('cacheLayout reports the missing state root and cache for a fresh state root, and its root is null', t => {
  const b = base(t), layout = cacheLayout(b.stateRoot);
  assert.equal(layout.root, null); assert.equal(layout.cacheRoot, path.join(b.stateRoot, 'cache'));
  assert.deepEqual(layout.missing, [b.stateRoot, path.join(b.stateRoot, 'cache')]);
  assert.ok(layout.pins.some(p => p.path === path.join(b.dir, 'state')));
  fs.mkdirSync(b.stateRoot, { mode: 0o700 }); fs.mkdirSync(path.join(b.stateRoot, 'cache'), { mode: 0o700 });
  const again = cacheLayout(b.stateRoot);
  assert.deepEqual(again.missing, []); assert.ok(again.pins.some(p => p.path === path.join(b.stateRoot, 'cache')));
});

test('cacheLayout refuses a cache that is not private', t => {
  const b = base(t); fs.mkdirSync(b.stateRoot, { mode: 0o700 }); fs.mkdirSync(path.join(b.stateRoot, 'cache'), { mode: 0o755 }); fs.chmodSync(path.join(b.stateRoot, 'cache'), 0o755);
  assert.throws(() => cacheLayout(b.stateRoot), code('SKILLS_STATE_UNSAFE'));
});

test('seedPin with no project seeds an empty cache, then finds the pin present', async t => {
  const b = base(t), pkg = npmPackage('alpha'), signal = new AbortController().signal;
  const first = await seedPin({ project: null, stateRoot: b.stateRoot }, pkg.entry, verified(pkg), signal);
  assert.equal(first.status, 'seeded'); assert.equal(first.root, path.join(b.stateRoot, 'cache'));
  assert.equal((fs.statSync(b.stateRoot).mode & 0o777), 0o700);
  const second = await seedPin({ project: null, stateRoot: b.stateRoot }, pkg.entry, verified(pkg), signal);
  assert.equal(second.status, 'present');
});

test('seedPin with a project keeps its old result: seeded, then present, and it never makes the project folders', async t => {
  const f = syncProject(t), pkg = npmPackage('beta'), signal = new AbortController().signal;
  const first = await seedPin({ project: f.project(), stateRoot: f.stateRoot }, pkg.entry, verified(pkg), signal);
  assert.equal(first.status, 'seeded'); assert.equal(first.root, f.cacheRoot);
  assert.equal(fs.existsSync(f.privateRoot), false, 'the project private folder is not made');
  assert.equal((await seedPin({ project: f.project(), stateRoot: f.stateRoot }, pkg.entry, verified(pkg), signal)).status, 'present');
  const bad = await seedPin({ project: f.project(), stateRoot: f.stateRoot }, pkg.entry, { kind: 'git', metadata: pkg.metadata, data: pkg.archive }, signal);
  assert.equal(bad.status, 'failed'); assert.deepEqual(bad.codes, ['SKILLS_SYNC_CONTENT_MISMATCH']);
});

test('seedPin with no project reports a failure in the result, never a throw', async t => {
  const b = base(t), pkg = npmPackage('gamma');
  fs.mkdirSync(b.stateRoot, { mode: 0o755 }); fs.chmodSync(b.stateRoot, 0o777); // an unsafe state folder
  const result = await seedPin({ project: null, stateRoot: b.stateRoot }, pkg.entry, verified(pkg), new AbortController().signal);
  assert.equal(result.status, 'failed'); assert.deepEqual(result.codes, ['SKILLS_STATE_UNSAFE']);
});

test('storeStateNested is true for a state root inside the store, the store inside the state root, and an alias by identity', t => {
  const b = base(t), store = storeIn(b.home);
  const inside = path.join(store.dir, 'state'); fs.mkdirSync(inside, { mode: 0o700 });
  assert.equal(storeStateNested(store, store.dir, inside, []), true, 'state inside the store');
  assert.equal(storeStateNested(store, store.dir, b.home, []), true, 'store inside the state root');
  // An alias: a symlink to the store folder, so the paths differ and the inode is the same.
  const alias = path.join(b.dir, 'alias'); fs.symlinkSync(store.dir, alias);
  const real = fs.realpathSync(alias);
  assert.equal(storeStateNested(store, store.dir, path.join(b.dir, 'unrelated'), [{ path: path.join(b.dir, 'unrelated'), identity: store.identity }]), true, 'a state folder that is the store by device and inode');
  assert.equal(real, store.dir);
  // The store sits below a folder the state root lists by identity.
  const above = store.ancestry.at(-1);
  assert.equal(storeStateNested(store, store.dir, path.join(b.dir, 'state', 'bowerloom'), [{ path: path.join(b.dir, 'state', 'bowerloom', 'x'), identity: above.identity }]), true, 'the store below a state folder');
  assert.equal(storeStateNested(null, store.dir, inside, []), true, 'paths alone, no store context');
});

test('storeStateNested is false for two siblings', t => {
  const b = base(t), store = storeIn(b.home);
  fs.mkdirSync(b.stateRoot, { mode: 0o700 }); fs.mkdirSync(path.join(b.stateRoot, 'cache'), { mode: 0o700 });
  const layout = cacheLayout(b.stateRoot);
  assert.equal(layout.missing.length, 0);
  assert.equal(storeStateNested(store, store.dir, b.stateRoot, layout.pins), false);
  assert.equal(storeStateNested(null, store.dir, b.stateRoot, []), false);
});

test('S2: a seed with no project re-checks that the state folder and the store are apart', async t => {
  const b = base(t), store = storeIn(b.home), pkg = npmPackage('delta'), signal = new AbortController().signal;
  const inside = path.join(store.dir, 'state', 'bowerloom');
  const result = await seedPin({ project: null, stateRoot: inside, store }, pkg.entry, verified(pkg), signal);
  assert.equal(result.status, 'failed'); assert.deepEqual(result.codes, ['STORE_STATE_NESTED']);
  assert.equal(fs.existsSync(path.join(store.dir, 'state')), false, 'nothing is made inside the store');
  const apart = await seedPin({ project: null, stateRoot: b.stateRoot, store }, pkg.entry, verified(pkg), signal);
  assert.equal(apart.status, 'seeded');
});
