// Spec 06, 3.11: the store cache, <stateRoot>/store-cache/<kind>-<id>-<hash>/, and fetchStoreGit, which fills it with an
// authored store item from github.com, checked against bowerloom.lock.json.
import test from '../../../dist/tests/support/lock-slot-retry.js';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { syncBuiltinESMExports } from 'node:module';
import { testHome } from '../../../dist/tests/support/isolate-home.js';
import { writeStoreCache, readStoreCache, fetchStoreGit, storeCacheKey, fetchRequests } from '../../../dist/packages/project-sync/src/store-git.js';
import { cacheLockSlot, lockHolder, withCacheLock } from '../../../dist/packages/project-context/src/index.js';
import { authoredRows } from '../../../dist/packages/skill-manifest/src/resolve-store-git.js';
import { manifestRefusal } from '../../../dist/packages/skill-manifest/src/refusal.js';
import { buildFakeRepo } from '../../../dist/tests/support/fake-github-repo.js';
import { fakeTransport } from '../../skill-manifest/test/support/fixtures.mjs';

const code = expected => error => { if (error?.code !== expected) throw new Error(`expected ${expected}, got ${error?.code ?? error?.message ?? error}`); return true; };
const COMMIT = '0123456789abcdef0123456789abcdef01234567', REMOTE = 'https://github.com/sageadvicellc/store';
const SKILL = '---\nname: house-style\ndescription: A store skill.\n---\nUse it.\n';
const FILES = [{ path: 'SKILL.md', bytes: Buffer.from(SKILL) }, { path: 'references/notes.md', bytes: Buffer.from('# Notes\n') }];
function state(t) {
  const base = fs.mkdtempSync(path.join(testHome, 'store-cache-')); fs.chmodSync(base, 0o700);
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const stateRoot = path.join(base, 'state'), cacheRoot = path.join(stateRoot, 'cache'), storeCacheRoot = path.join(stateRoot, 'store-cache');
  fs.mkdirSync(cacheRoot, { recursive: true, mode: 0o700 }); fs.chmodSync(stateRoot, 0o700);
  return { base, stateRoot, roots: { cacheRoot, storeCacheRoot } };
}
const signal = () => new AbortController().signal;
const mode = p => fs.lstatSync(p).mode & 0o777;

test('1. writeStoreCache writes <store-cache>/<kind>-<id>-<hash>/skills/<id>/... with private modes and returns written; a second call returns present', async t => {
  const s = state(t), { hash } = authoredRows(FILES), key = storeCacheKey('skill', 'house-style', hash);
  assert.equal(key, `skill-house-style-${hash}`);
  const first = await writeStoreCache(s.roots, 'skill', 'house-style', hash, FILES, signal());
  assert.deepEqual(first, { status: 'written', dir: path.join(s.roots.storeCacheRoot, key) });
  const dir = path.join(s.roots.storeCacheRoot, key);
  assert.equal(fs.readFileSync(path.join(dir, 'skills/house-style/SKILL.md'), 'utf8'), SKILL);
  for (const p of [s.roots.storeCacheRoot, dir, path.join(dir, 'skills'), path.join(dir, 'skills/house-style'), path.join(dir, 'skills/house-style/references')]) assert.equal(mode(p), 0o700, p);
  for (const p of ['skills/house-style/SKILL.md', 'skills/house-style/references/notes.md']) assert.equal(mode(path.join(dir, p)), 0o600, p);
  assert.deepEqual(await writeStoreCache(s.roots, 'skill', 'house-style', hash, FILES, signal()), { status: 'present', dir });
  assert.deepEqual(fs.readdirSync(s.roots.storeCacheRoot), [key]);
  // A prompt sits at prompts/<id>.md, a team at teams/<id>/.
  const prompt = [{ path: 'weekly-update.md', bytes: Buffer.from('Summarize.\n') }], ph = authoredRows(prompt).hash;
  await writeStoreCache(s.roots, 'prompt', 'weekly-update', ph, prompt, signal());
  assert.equal(fs.readFileSync(path.join(s.roots.storeCacheRoot, `prompt-weekly-update-${ph}`, 'prompts/weekly-update.md'), 'utf8'), 'Summarize.\n');
  // Bytes that do not give the hash are never written.
  await assert.rejects(writeStoreCache(s.roots, 'skill', 'other', hash, FILES, signal()).then(() => writeStoreCache(s.roots, 'skill', 'other', 'f'.repeat(64), FILES, signal())), code('LOCK_HASH_MISMATCH'));
});

test('2. a cache folder with a changed file is moved to .prune-<key>-* and rewritten', async t => {
  const s = state(t), { hash } = authoredRows(FILES), key = storeCacheKey('skill', 'house-style', hash), dir = path.join(s.roots.storeCacheRoot, key);
  await writeStoreCache(s.roots, 'skill', 'house-style', hash, FILES, signal());
  fs.writeFileSync(path.join(dir, 'skills/house-style/references/notes.md'), '# Changed\n');
  assert.deepEqual(await writeStoreCache(s.roots, 'skill', 'house-style', hash, FILES, signal()), { status: 'written', dir });
  assert.equal(fs.readFileSync(path.join(dir, 'skills/house-style/references/notes.md'), 'utf8'), '# Notes\n');
  const names = fs.readdirSync(s.roots.storeCacheRoot).sort();
  assert.equal(names.length, 2); assert.match(names[0], new RegExp(`^\\.prune-${key}-[a-f0-9]{8}$`)); assert.equal(names[1], key);
});

test('3. a leftover .tmp-<key>-* folder is removed on the next write', async t => {
  const s = state(t), { hash } = authoredRows(FILES), key = storeCacheKey('skill', 'house-style', hash);
  fs.mkdirSync(path.join(s.roots.storeCacheRoot, `.tmp-${key}-0123abcd`, 'skills'), { recursive: true, mode: 0o700 });
  fs.chmodSync(s.roots.storeCacheRoot, 0o700);
  await writeStoreCache(s.roots, 'skill', 'house-style', hash, FILES, signal());
  assert.deepEqual(fs.readdirSync(s.roots.storeCacheRoot), [key]);
});

test('4. readStoreCache returns the rows; it refuses a link, a foreign owner, and group write', async t => {
  const s = state(t), { hash, rows } = authoredRows(FILES), key = storeCacheKey('skill', 'house-style', hash), dir = path.join(s.roots.storeCacheRoot, key);
  assert.equal(readStoreCache(s.roots.storeCacheRoot, 'skill', 'house-style', hash), null);
  await writeStoreCache(s.roots, 'skill', 'house-style', hash, FILES, signal());
  assert.deepEqual(readStoreCache(s.roots.storeCacheRoot, 'skill', 'house-style', hash), { dir, rows });
  const notes = path.join(dir, 'skills/house-style/references/notes.md');
  fs.chmodSync(notes, 0o620);
  assert.throws(() => readStoreCache(s.roots.storeCacheRoot, 'skill', 'house-style', hash), code('SKILLS_STATE_UNSAFE'));
  fs.chmodSync(notes, 0o600);
  fs.renameSync(notes, path.join(s.base, 'notes.md')); fs.symlinkSync(path.join(s.base, 'notes.md'), notes);
  assert.throws(() => readStoreCache(s.roots.storeCacheRoot, 'skill', 'house-style', hash), code('SKILLS_STATE_UNSAFE'));
  fs.unlinkSync(notes); fs.renameSync(path.join(s.base, 'notes.md'), notes);
  assert.deepEqual(readStoreCache(s.roots.storeCacheRoot, 'skill', 'house-style', hash).rows, rows);
  const lstat = fs.lstatSync;
  t.mock.method(fs, 'lstatSync', (p, ...args) => { const st = lstat(p, ...args); if (String(p) !== notes) return st; const copy = Object.create(Object.getPrototypeOf(st)); Object.assign(copy, st, { uid: typeof st.uid === 'bigint' ? st.uid + 1n : st.uid + 1 }); return copy; });
  syncBuiltinESMExports();
  try { assert.throws(() => readStoreCache(s.roots.storeCacheRoot, 'skill', 'house-style', hash), code('SKILLS_STATE_UNSAFE')); } finally { t.mock.restoreAll(); syncBuiltinESMExports(); }
  // A folder whose files give another hash is not served.
  fs.writeFileSync(notes, '# Changed\n');
  assert.throws(() => readStoreCache(s.roots.storeCacheRoot, 'skill', 'house-style', hash), code('LOCK_HASH_MISMATCH'));
});

/** The fake store repository, its lock pin for house-style, and a sync item that locks it. */
function locked(t, files = { 'skills/house-style/SKILL.md': SKILL, 'skills/house-style/references/notes.md': '# Notes\n' }) {
  const dir = fs.mkdtempSync(path.join(testHome, 'store-repo-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const repo = buildFakeRepo('sageadvicellc', 'store', files, COMMIT, dir), { rows, hash } = authoredRows(FILES);
  // A repository without the item keeps a fixed tree id in the lock: the fixture names that case, nothing is caught.
  const tree = files['skills/house-style/SKILL.md'] === undefined ? 'f'.repeat(40) : repo.treeAt('skills/house-style');
  const lockPin = { remote: REMOTE, commit: COMMIT, path: 'skills/house-style', tree, files: rows, hash };
  return { repo, lockPin, item: { kind: 'skill', id: 'house-style', requestDigest: hash, lockPin } };
}

test('5 and 6. fetchStoreGit fills the store cache under the cache lock of the one item, and releases it', async t => {
  const s = state(t), l = locked(t);
  let held = null;
  const transport = fakeTransport(l.repo.responses);
  const watched = { get: async (url, max, sig) => { held ??= await lockHolder(cacheLockSlot(s.roots.cacheRoot)); return transport.get(url, max, sig); } };
  let made = 0, closed = 0;
  const deps = { signal: signal(), storeTransport: () => { made++; return { ...watched, close: () => { closed++; } }; } };
  const result = await fetchStoreGit(l.item, s.roots, ['api.github.com'], deps);
  assert.deepEqual(result, { dir: path.join(s.roots.storeCacheRoot, storeCacheKey('skill', 'house-style', l.lockPin.hash)), fetched: true });
  assert.equal(held, 'this', 'the cache lock is held during the fetch');
  assert.equal(made, 1); assert.equal(closed, 1);
  assert.equal(transport.urls.length, 6);
  // Released: another writer takes the lock at once. A second fetch reads nothing.
  await withCacheLock(s.roots.cacheRoot, signal(), async () => {}, { waitMs: 1000 });
  assert.deepEqual(await fetchStoreGit(l.item, s.roots, ['api.github.com'], deps), { dir: result.dir, fetched: false });
  assert.equal(transport.urls.length, 6); assert.equal(made, 1);
});

test('5. fetchStoreGit refuses a host outside the approved list, a changed hash, and rows that differ from the lock', async t => {
  const s = state(t), l = locked(t);
  let made = 0;
  const deps = transport => ({ signal: signal(), storeTransport: () => { made++; return { ...fakeTransport(transport ?? l.repo.responses), close() {} }; } });
  await assert.rejects(fetchStoreGit(l.item, s.roots, ['registry.npmjs.org'], deps()), code('SKILLS_OFFLINE'));
  assert.equal(made, 0, 'a fetch the approval did not name never starts');
  // The bound content key must be the lock hash.
  await assert.rejects(fetchStoreGit({ ...l.item, requestDigest: 'f'.repeat(64) }, s.roots, ['api.github.com'], deps()), code('STALE_APPROVAL'));
  // The pushed copy has other bytes: another hash.
  const other = locked(t, { 'skills/house-style/SKILL.md': SKILL, 'skills/house-style/references/notes.md': '# Other\n' });
  await assert.rejects(fetchStoreGit(l.item, s.roots, ['api.github.com'], deps(other.repo.responses)), code('LOCK_HASH_MISMATCH'));
  // The same hash claimed with other rows in the lock.
  const forged = { ...l.item, lockPin: { ...l.lockPin, files: [...l.lockPin.files].reverse() } };
  await assert.rejects(fetchStoreGit(forged, s.roots, ['api.github.com'], deps()), code('LOCK_HASH_MISMATCH'));
  assert.deepEqual(fs.existsSync(s.roots.storeCacheRoot) ? fs.readdirSync(s.roots.storeCacheRoot).filter(n => !n.startsWith('.')) : [], []);
});

const failing = fn => ({ signal: signal(), storeTransport: () => ({ get: fn, close() {} }) });
const cacheEntries = s => fs.existsSync(s.roots.storeCacheRoot) ? fs.readdirSync(s.roots.storeCacheRoot) : [];
test('fetch errors: a network failure gives SKILLS_OFFLINE', async t => {
  const s = state(t), l = locked(t);
  await assert.rejects(fetchStoreGit(l.item, s.roots, ['api.github.com'], failing(async () => { throw manifestRefusal('SKILLS_ADD_NETWORK'); })), code('SKILLS_OFFLINE'));
});
test('fetch errors: a 404 on the commit request gives STORE_REMOTE_PRIVATE', async t => {
  const s = state(t), l = locked(t);
  await assert.rejects(fetchStoreGit(l.item, s.roots, ['api.github.com'], failing(async () => { throw manifestRefusal('SKILLS_ADD_NOT_FOUND'); })), code('STORE_REMOTE_PRIVATE'));
});
test('fetch errors: a rate limit keeps GITHUB_RATE_LIMITED', async t => {
  const s = state(t), l = locked(t);
  await assert.rejects(fetchStoreGit(l.item, s.roots, ['api.github.com'], failing(async () => { throw manifestRefusal('GITHUB_RATE_LIMITED'); })), code('GITHUB_RATE_LIMITED'));
});
test('fetch errors: a refused host keeps SKILLS_ADD_HOST_REFUSED', async t => {
  const s = state(t), l = locked(t);
  await assert.rejects(fetchStoreGit(l.item, s.roots, ['api.github.com'], failing(async () => { throw manifestRefusal('SKILLS_ADD_HOST_REFUSED'); })), code('SKILLS_ADD_HOST_REFUSED'));
});
test('fetch errors: an item the locked commit does not hold gives STORE_ITEM_GONE_AT_COMMIT', async t => {
  const s = state(t), l = locked(t), gone = locked(t, { 'skills/other/SKILL.md': SKILL });
  await assert.rejects(fetchStoreGit(l.item, s.roots, ['api.github.com'], { signal: signal(), storeTransport: () => ({ ...fakeTransport(gone.repo.responses), close() {} }) }), code('STORE_ITEM_GONE_AT_COMMIT'));
});
test('fetch errors: unsafe content is refused by the content check, before any blob is read', async t => {
  // The pin names the tree the repository holds, so the tree check passes and the content check refuses.
  const s = state(t), unsafe = locked(t, { 'skills/house-style/SKILL.md': SKILL, 'skills/house-style/references/notes.md': '# Notes\n', 'skills/house-style/x.png': 'x' });
  const urls = [], transport = fakeTransport(unsafe.repo.responses);
  await assert.rejects(fetchStoreGit(unsafe.item, s.roots, ['api.github.com'], { signal: signal(), storeTransport: () => ({ get: (u, m, g) => { urls.push(u); return transport.get(u, m, g); }, close() {} }) }), code('LOCK_HASH_MISMATCH'));
  assert.equal(urls.some(u => u.includes('/blobs/')), false, 'the content check refused it, not the hash');
});
test('fetch errors: a pin whose rows do not match its own tree is refused by the hash, after the blobs are read', async t => {
  // The pin names the repository's tree but the rows of other bytes: the tree check passes, and the hash refuses.
  const s = state(t), other = locked(t, { 'skills/house-style/SKILL.md': SKILL, 'skills/house-style/references/notes.md': '# Other\n' });
  const urls = [], transport = fakeTransport(other.repo.responses);
  await assert.rejects(fetchStoreGit(other.item, s.roots, ['api.github.com'], { signal: signal(), storeTransport: () => ({ get: (u, m, g) => { urls.push(u); return transport.get(u, m, g); }, close() {} }) }), code('LOCK_HASH_MISMATCH'));
  assert.equal(urls.some(u => u.includes('/blobs/')), true);
});
test('fetch errors: an abort gives SKILLS_SYNC_INTERRUPTED', async t => {
  const s = state(t), l = locked(t), controller = new AbortController(); controller.abort();
  await assert.rejects(fetchStoreGit(l.item, s.roots, ['api.github.com'], { signal: controller.signal, storeTransport: () => ({ ...fakeTransport(l.repo.responses), close() {} }) }), code('SKILLS_SYNC_INTERRUPTED'));
});
test('T2. a failure in the middle of the blobs leaves no store cache entry and no .tmp folder', async t => {
  const s = state(t), l = locked(t), transport = fakeTransport(l.repo.responses); let blobs = 0;
  await assert.rejects(fetchStoreGit(l.item, s.roots, ['api.github.com'], failing(async (u, m, g) => { if (u.includes('/blobs/') && ++blobs === 2) throw manifestRefusal('SKILLS_ADD_NETWORK'); return transport.get(u, m, g); })), code('SKILLS_OFFLINE'));
  assert.deepEqual(cacheEntries(s), []);
});
test('T2. a failing rename into the store cache leaves no entry and no .tmp folder', async t => {
  const s = state(t), l = locked(t), rename = fs.renameSync;
  t.mock.method(fs, 'renameSync', (from, to) => { if (String(from).includes('/.tmp-skill-house-style-')) throw Object.assign(new Error('injected'), { code: 'EIO' }); return rename(from, to); });
  syncBuiltinESMExports();
  try { await assert.rejects(fetchStoreGit(l.item, s.roots, ['api.github.com'], { signal: signal(), storeTransport: () => ({ ...fakeTransport(l.repo.responses), close() {} }) })); }
  finally { t.mock.restoreAll(); syncBuiltinESMExports(); }
  assert.deepEqual(cacheEntries(s), []);
});
test('F10. readStoreCache refuses a prompt entry with an extra file or another top-level entry', async t => {
  const s = state(t), files = [{ path: 'weekly-update.md', bytes: Buffer.from('Summarize.\n') }], { hash } = authoredRows(files);
  const { dir } = await writeStoreCache(s.roots, 'prompt', 'weekly-update', hash, files, signal());
  fs.writeFileSync(path.join(dir, 'prompts', 'other.md'), 'x\n', { mode: 0o600 });
  assert.throws(() => readStoreCache(s.roots.storeCacheRoot, 'prompt', 'weekly-update', hash), code('SKILLS_STATE_UNSAFE'));
  fs.rmSync(path.join(dir, 'prompts', 'other.md')); fs.mkdirSync(path.join(dir, 'skills'), { mode: 0o700 });
  assert.throws(() => readStoreCache(s.roots.storeCacheRoot, 'prompt', 'weekly-update', hash), code('SKILLS_STATE_UNSAFE'));
  fs.rmdirSync(path.join(dir, 'skills'));
  assert.deepEqual(readStoreCache(s.roots.storeCacheRoot, 'prompt', 'weekly-update', hash).rows, authoredRows(files).rows);
});

test('L1. a pin listing 1 file at a 126-file tree is refused by the tree id before any blob is read, within its request estimate', async t => {
  const s = state(t), files = { 'skills/house-style/SKILL.md': SKILL };
  for (let j = 0; j < 125; j++) files[`skills/house-style/f${String(j).padStart(3, '0')}.md`] = `${j}\n`;
  const big = locked(t, files), one = locked(t, { 'skills/house-style/SKILL.md': SKILL });
  const { rows, hash } = authoredRows([{ path: 'SKILL.md', bytes: Buffer.from(SKILL) }]), lockPin = { ...one.lockPin, files: rows, hash };
  const urls = [], transport = fakeTransport(big.repo.responses);
  await assert.rejects(fetchStoreGit({ kind: 'skill', id: 'house-style', requestDigest: hash, lockPin }, s.roots, ['api.github.com'], { signal: signal(), storeTransport: () => ({ get: (u, m, g) => { urls.push(u); return transport.get(u, m, g); }, close() {} }) }), code('LOCK_HASH_MISMATCH'));
  assert.equal(urls.some(u => u.includes('/blobs/')), false);
  assert.ok(urls.length <= fetchRequests(lockPin), `${urls.length} requests, estimate ${fetchRequests(lockPin)}`);
  assert.deepEqual(cacheEntries(s), []);
});
