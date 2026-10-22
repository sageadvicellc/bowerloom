// removeCacheEntry (spec 09, 4.4): the one delete path of the skills cache, the store cache, and the per-project caches
// of earlier betas. It renames an entry to `.prune-<name>-<8 hex>` under the cache lock, then removes it without
// following any link. Every folder here is under the private test HOME; nothing reads the real home or the network.
import '../../../dist/tests/support/isolate-home.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { planNpmAcquisition } from '../../../dist/packages/skill-sources/src/npm.js';
import { observeSkillCacheRoot, seedSkillCache, removeCacheEntry, cacheEntryProblem } from '../../../dist/packages/skill-sources/src/cache.js';

const sha = b => createHash('sha256').update(b).digest('hex');
const OP = 'a'.repeat(32), PROJECT = 'c'.repeat(32), HASH = 'd'.repeat(64);
const refused = e => { assert.equal(e?.code, 'CACHE_PRUNE_FAILED', `${e?.code} ${e?.message}`); assert.equal(e.name, 'DefinitionError'); return true; };
const held = () => { const calls = []; return { calls, assertHeld() { calls.push('held'); } }; };

/** A private state root with the three cache places, each mode 0700, as Bowerloom makes them. */
function stateWorld(t) {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(fs.realpathSync(os.homedir()), 'bowerloom-remove-cache-'))); fs.chmodSync(base, 0o700);
  t.after(() => { for (const p of walkFolders(base)) try { fs.chmodSync(p, 0o700); } catch { /* gone */ } fs.rmSync(base, { recursive: true, force: true }); });
  const stateRoot = path.join(base, 'state'), cacheRoot = path.join(stateRoot, 'cache'), storeCacheRoot = path.join(stateRoot, 'store-cache'), legacyRoot = path.join(stateRoot, PROJECT, 'cache');
  for (const p of [stateRoot, cacheRoot, storeCacheRoot, path.join(stateRoot, PROJECT), legacyRoot]) { fs.mkdirSync(p, { mode: 0o700 }); fs.chmodSync(p, 0o700); }
  return { base, stateRoot, cacheRoot, storeCacheRoot, legacyRoot };
}
function walkFolders(dir) { const out = []; const visit = p => { let s; try { s = fs.lstatSync(p); } catch { return; } if (s.isDirectory()) { out.push(p); try { fs.chmodSync(p, 0o700); } catch { /* not ours */ } for (const n of fs.readdirSync(p)) visit(path.join(p, n)); } }; visit(dir); return out; }
/** A folder with one file, mode 0700, as a cache entry is made. */
function entry(root, name, files = { 'note.md': 'hello\n' }) {
  const dir = path.join(root, name); fs.mkdirSync(dir, { mode: 0o700 }); fs.chmodSync(dir, 0o700);
  for (const [rel, text] of Object.entries(files)) { const file = path.join(dir, rel); fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 }); fs.writeFileSync(file, text, { mode: 0o600 }); }
  return dir;
}
const names = root => fs.readdirSync(root).sort();
/** Every entry under a folder with its inode, mode and content: any change shows. */
function tree(dir) { const rows = []; const visit = p => { const s = fs.lstatSync(p); rows.push([path.relative(dir, p), s.ino, s.mode & 0o7777, s.isFile() ? sha(fs.readFileSync(p)) : s.isSymbolicLink() ? 'link' : 'dir']); if (s.isDirectory() && !s.isSymbolicLink()) for (const n of fs.readdirSync(p).sort()) visit(path.join(p, n)); }; visit(dir); return JSON.stringify(rows); }

/** One real completed skills-cache operation, made through the product's seed path. */
async function seeded(root) {
  const text = '---\nname: example\ndescription: Synthetic fixture.\nlicense: MIT\n---\nUse it.\n', lic = 'MIT License\nSynthetic.\n';
  const files = [{ path: 'SKILL.md', sourcePath: 'skills/example/SKILL.md', text }, { path: 'LICENSE.txt', sourcePath: 'LICENSE', text: lic }];
  const header = (name, bytes) => { const h = Buffer.alloc(512); h.write(name, 0, 100, 'ascii'); for (const [at, size, value] of [[100, 8, 0o644], [108, 8, 0], [116, 8, 0], [124, 12, bytes], [136, 12, 1], [329, 8, 0], [337, 8, 0]]) h.write(value.toString(8).padStart(size - 1, '0') + '\0', at, size, 'latin1'); h[156] = 48; h.write('ustar\0' + '00', 257, 8, 'latin1'); h.fill(32, 148, 156); h.write(h.reduce((a, b) => a + b, 0).toString(8).padStart(6, '0') + '\0 ', 148, 8, 'latin1'); return h; };
  const archive = gzipSync(Buffer.concat([...files.flatMap(e => { const body = Buffer.from(e.text); return [header('package/' + e.sourcePath, body.length), body, Buffer.alloc((512 - body.length % 512) % 512)]; }), Buffer.alloc(1024)]));
  const integrity = 'sha512-' + createHash('sha512').update(archive).digest('base64');
  const metadata = Buffer.from(JSON.stringify({ name: '@synthetic/example', version: '1.0.0', license: 'MIT', _npmUser: { name: 'synthetic' }, dist: { integrity, tarball: 'https://registry.npmjs.org/@synthetic/example/-/example-1.0.0.tgz' } }));
  const request = { package: '@synthetic/example', version: '1.0.0', integrity, metadataSha256: sha(metadata), publisher: 'synthetic', declaredLicense: 'MIT', skill: { id: 'example', name: 'example', sourceRoot: 'skills/example' }, files: files.map(f => ({ path: f.path, sourcePath: f.sourcePath, sha256: sha(f.text), bytes: Buffer.byteLength(f.text), mode: 420 })), references: [], license: { spdx: 'MIT', origin: 'included', files: ['LICENSE.txt'] } };
  const plan = planNpmAcquisition(request, observeSkillCacheRoot(root, OP, 33554432));
  await seedSkillCache(plan, plan.revision, metadata, archive, new AbortController().signal);
  return path.join(root, 'op-' + OP);
}

test('1. removeCacheEntry removes a seeded entry; no .prune-* is left, and the rest of the root is unchanged', async t => {
  const w = stateWorld(t), op = await seeded(w.cacheRoot);
  assert.ok(fs.existsSync(path.join(op, 'files', 'SKILL.md')));
  entry(w.cacheRoot, 'op-' + 'b'.repeat(32)); fs.writeFileSync(path.join(w.cacheRoot, 'stray.txt'), 'x\n', { mode: 0o600 });
  const before = tree(path.join(w.cacheRoot, 'op-' + 'b'.repeat(32))), lock = held();
  await removeCacheEntry(w.stateRoot, { scope: 'machine', projectId: null }, 'op-' + OP, lock);
  assert.deepEqual(names(w.cacheRoot), ['op-' + 'b'.repeat(32), 'stray.txt']);
  assert.equal(tree(path.join(w.cacheRoot, 'op-' + 'b'.repeat(32))), before);
  // The store cache and a legacy cache, each from its own root.
  const key = `skill-house-style-${HASH}`; entry(w.storeCacheRoot, key, { 'skills/house-style/SKILL.md': 'x\n' });
  await removeCacheEntry(w.stateRoot, { scope: 'store', projectId: null }, key, lock);
  assert.deepEqual(names(w.storeCacheRoot), []);
  entry(w.legacyRoot, 'op-' + OP);
  await removeCacheEntry(w.stateRoot, { scope: 'project-legacy', projectId: PROJECT }, 'op-' + OP, lock);
  assert.deepEqual(names(w.legacyRoot), []);
  assert.deepEqual(names(path.join(w.stateRoot, PROJECT)), ['cache'], 'the project folder of the legacy cache stays');
});

test('2. a link entry refuses CACHE_PRUNE_FAILED and the link target is untouched', async t => {
  const w = stateWorld(t), target = entry(w.base, 'target-folder'), before = tree(target);
  fs.symlinkSync(target, path.join(w.cacheRoot, 'op-' + OP));
  await assert.rejects(removeCacheEntry(w.stateRoot, { scope: 'machine', projectId: null }, 'op-' + OP, held()), refused);
  assert.equal(tree(target), before);
  assert.ok(fs.lstatSync(path.join(w.cacheRoot, 'op-' + OP)).isSymbolicLink(), 'the link stays where it was');
  // A link to a file, too.
  fs.writeFileSync(path.join(w.base, 'file.txt'), 'keep\n'); fs.symlinkSync(path.join(w.base, 'file.txt'), path.join(w.storeCacheRoot, `team-crew-${HASH}`));
  await assert.rejects(removeCacheEntry(w.stateRoot, { scope: 'store', projectId: null }, `team-crew-${HASH}`, held()), refused);
  assert.equal(fs.readFileSync(path.join(w.base, 'file.txt'), 'utf8'), 'keep\n');
});

test('3. an entry with group write, mode 0755, or another owner refuses CACHE_PRUNE_FAILED', async t => {
  const w = stateWorld(t);
  for (const mode of [0o770, 0o720, 0o755, 0o707]) {
    const dir = entry(w.cacheRoot, 'op-' + OP); fs.chmodSync(dir, mode);
    await assert.rejects(removeCacheEntry(w.stateRoot, { scope: 'machine', projectId: null }, 'op-' + OP, held()), refused, mode.toString(8));
    assert.ok(fs.existsSync(path.join(dir, 'note.md')), `mode ${mode.toString(8)}: nothing is deleted`);
    assert.deepEqual(names(w.cacheRoot), ['op-' + OP], 'nothing is renamed');
    fs.chmodSync(dir, 0o700); fs.rmSync(dir, { recursive: true });
  }
  // Another owner, as lstat reports it for this one folder (the real case needs root; see the next test).
  const dir = entry(w.cacheRoot, 'op-' + OP), original = fs.lstatSync;
  fs.lstatSync = (p, ...rest) => { const s = original(p, ...rest); if (p === dir) { const copy = Object.create(Object.getPrototypeOf(s), Object.getOwnPropertyDescriptors(s)); copy.uid = typeof s.uid === 'bigint' ? s.uid + 1n : s.uid + 1; return copy; } return s; };
  try { await assert.rejects(removeCacheEntry(w.stateRoot, { scope: 'machine', projectId: null }, 'op-' + OP, held()), refused); }
  finally { fs.lstatSync = original; }
  assert.ok(fs.existsSync(path.join(dir, 'note.md')));
});

test('3 (real owner). an entry that another user owns refuses CACHE_PRUNE_FAILED', { skip: process.getuid() !== 0 && 'needs a folder that another user owns, and only root can make one; the lstat case above covers the check' }, async t => {
  const w = stateWorld(t), dir = entry(w.cacheRoot, 'op-' + OP); fs.chownSync(dir, 1, 1);
  await assert.rejects(removeCacheEntry(w.stateRoot, { scope: 'machine', projectId: null }, 'op-' + OP, held()), refused);
});

test('4. a link inside the entry is unlinked and its target survives', async t => {
  const w = stateWorld(t), outside = entry(w.base, 'outside', { 'keep.md': 'keep me\n', 'deep/also.md': 'and me\n' }), before = tree(outside);
  const dir = entry(w.cacheRoot, 'op-' + OP);
  fs.symlinkSync(outside, path.join(dir, 'folder-link')); fs.symlinkSync(path.join(outside, 'keep.md'), path.join(dir, 'file-link'));
  fs.mkdirSync(path.join(dir, 'nested'), { mode: 0o700 }); fs.symlinkSync(outside, path.join(dir, 'nested', 'deeper-link'));
  await removeCacheEntry(w.stateRoot, { scope: 'machine', projectId: null }, 'op-' + OP, held());
  assert.deepEqual(names(w.cacheRoot), []);
  assert.equal(tree(outside), before, 'nothing behind a link is touched');
});

test('5. a name with / or .., or an empty name, refuses', async t => {
  const w = stateWorld(t); entry(w.cacheRoot, 'op-' + OP); entry(w.base, 'victim');
  for (const name of [`op-${OP}/files`, `../op-${OP}`, '..', '.', '', `.prune-x/../../victim`, `.prune-..`.replace('..', '../..'), `op-${OP}\0`, `.tmp-a/b`]) {
    await assert.rejects(removeCacheEntry(w.stateRoot, { scope: 'machine', projectId: null }, name, held()), refused, JSON.stringify(name));
  }
  assert.deepEqual(names(w.cacheRoot), ['op-' + OP]); assert.ok(fs.existsSync(path.join(w.base, 'victim', 'note.md')));
});

test('6. a crash between rename and remove leaves a .prune-* folder; a second call on that name removes it', async t => {
  const w = stateWorld(t); entry(w.cacheRoot, 'op-' + OP, { 'a.md': 'a\n', 'b/c.md': 'c\n' });
  let calls = 0; const crashing = { assertHeld() { if (++calls === 2) throw new Error('TEST_CRASH_AFTER_RENAME'); } };
  await assert.rejects(removeCacheEntry(w.stateRoot, { scope: 'machine', projectId: null }, 'op-' + OP, crashing), /TEST_CRASH_AFTER_RENAME/);
  const left = names(w.cacheRoot);
  assert.equal(left.length, 1); assert.match(left[0], new RegExp(`^\\.prune-op-${OP}-[a-f0-9]{8}$`));
  assert.equal(fs.readFileSync(path.join(w.cacheRoot, left[0], 'b', 'c.md'), 'utf8'), 'c\n', 'the crash deleted nothing');
  await removeCacheEntry(w.stateRoot, { scope: 'machine', projectId: null }, left[0], held());
  assert.deepEqual(names(w.cacheRoot), []);
});

test('7. held.assertHeld runs before the rename and before the delete; a lost lock deletes nothing', async t => {
  const w = stateWorld(t), dir = entry(w.cacheRoot, 'op-' + OP), seen = [];
  const watching = { assertHeld() { seen.push(names(w.cacheRoot).map(n => n.startsWith('.prune-') ? 'renamed' : n === 'op-' + OP ? 'original' : n)); } };
  await removeCacheEntry(w.stateRoot, { scope: 'machine', projectId: null }, 'op-' + OP, watching);
  assert.deepEqual(seen, [['original'], ['renamed']]);
  entry(w.cacheRoot, 'op-' + OP);
  const lost = { assertHeld() { const e = new Error('lost'); e.code = 'PROJECT_LOCK_UNAVAILABLE'; throw e; } };
  await assert.rejects(removeCacheEntry(w.stateRoot, { scope: 'machine', projectId: null }, 'op-' + OP, lost), e => e.code === 'PROJECT_LOCK_UNAVAILABLE' && e.message === 'lost', 'a lost lock passes through as itself');
  assert.deepEqual(names(w.cacheRoot), ['op-' + OP]); assert.ok(fs.existsSync(path.join(dir, 'note.md')));
});

test('8. a .prune- name skips the rename; a name that fails step 0 refuses; an unsafe root refuses (step 0a)', async t => {
  const w = stateWorld(t), leftover = `.prune-op-${OP}-0badc0de`, seen = [];
  entry(w.cacheRoot, leftover);
  await removeCacheEntry(w.stateRoot, { scope: 'machine', projectId: null }, leftover, { assertHeld() { seen.push(names(w.cacheRoot)); } });
  assert.deepEqual(seen, [[leftover], [leftover]], 'the leftover keeps its name until it is removed');
  assert.deepEqual(names(w.cacheRoot), []);
  // A .tmp- leftover of the store cache is removed the same way.
  entry(w.storeCacheRoot, `.tmp-prompt-weekly-${HASH}-12345678`);
  await removeCacheEntry(w.stateRoot, { scope: 'store', projectId: null }, `.tmp-prompt-weekly-${HASH}-12345678`, held());
  assert.deepEqual(names(w.storeCacheRoot), []);
  // Names that are not cache entries.
  for (const name of ['op-' + OP.slice(1), 'op-' + 'A'.repeat(32), `skill-${HASH}`, `widget-x-${HASH}`, `skill-Bad-${HASH}`, 'stray', '.prune-', '.tmp-', `.prune-${'x'.repeat(201)}`]) {
    entry(w.cacheRoot, name.replace(/\0/g, '') || 'empty');
    await assert.rejects(removeCacheEntry(w.stateRoot, { scope: 'machine', projectId: null }, name, held()), refused, name);
    fs.rmSync(path.join(w.cacheRoot, name.replace(/\0/g, '') || 'empty'), { recursive: true });
  }
  // A place that is not one of the three, or a legacy place with a bad project id.
  entry(w.cacheRoot, 'op-' + OP);
  for (const place of [{ scope: 'other', projectId: null }, { scope: 'project-legacy', projectId: null }, { scope: 'project-legacy', projectId: '../x' }, { scope: 'project-legacy', projectId: 'C'.repeat(32) }, { scope: 'machine', projectId: PROJECT }]) {
    await assert.rejects(removeCacheEntry(w.stateRoot, place, 'op-' + OP, held()), refused, JSON.stringify(place));
  }
  // The root: a link, the wrong mode, the legacy project folder with the wrong mode, or a state root that is not its real path.
  for (const mode of [0o755, 0o750, 0o711]) {
    fs.chmodSync(w.cacheRoot, mode);
    await assert.rejects(removeCacheEntry(w.stateRoot, { scope: 'machine', projectId: null }, 'op-' + OP, held()), refused, mode.toString(8));
    fs.chmodSync(w.cacheRoot, 0o700);
  }
  entry(w.legacyRoot, 'op-' + OP);
  fs.chmodSync(path.join(w.stateRoot, PROJECT), 0o755);
  await assert.rejects(removeCacheEntry(w.stateRoot, { scope: 'project-legacy', projectId: PROJECT }, 'op-' + OP, held()), refused);
  fs.chmodSync(path.join(w.stateRoot, PROJECT), 0o700);
  const realStore = path.join(w.base, 'real-store-cache'); fs.renameSync(w.storeCacheRoot, realStore); fs.symlinkSync(realStore, w.storeCacheRoot);
  entry(realStore, `skill-a-${HASH}`);
  await assert.rejects(removeCacheEntry(w.stateRoot, { scope: 'store', projectId: null }, `skill-a-${HASH}`, held()), refused);
  assert.ok(fs.existsSync(path.join(realStore, `skill-a-${HASH}`, 'note.md')));
  const linkedState = path.join(w.base, 'state-link'); fs.symlinkSync(w.stateRoot, linkedState);
  await assert.rejects(removeCacheEntry(linkedState, { scope: 'machine', projectId: null }, 'op-' + OP, held()), refused);
  await assert.rejects(removeCacheEntry('relative/state', { scope: 'machine', projectId: null }, 'op-' + OP, held()), refused);
  assert.deepEqual(names(w.cacheRoot), ['op-' + OP], 'no refusal deleted or renamed anything');
});

test('a missing entry refuses CACHE_PRUNE_FAILED', async t => {
  const w = stateWorld(t);
  await assert.rejects(removeCacheEntry(w.stateRoot, { scope: 'machine', projectId: null }, 'op-' + OP, held()), refused);
});

// Review H2 of PR 99: a refusal names the folder, the step, and the check or the system code, and keeps the cause.
const FIXED = 'Bowerloom failed to delete a cache entry. Entries it deleted before that stay deleted.';
const says = text => e => { refused(e); assert.equal(e.message, `${FIXED} ${text}`); return true; };
test('9. each refusal says which folder failed which check, and the system code is the cause', async t => {
  const w = stateWorld(t), dir = entry(w.cacheRoot, 'op-' + OP), machine = { scope: 'machine', projectId: null };
  fs.chmodSync(dir, 0o755);
  await assert.rejects(removeCacheEntry(w.stateRoot, machine, 'op-' + OP, held()), says(`Could not delete cache/op-${OP}: its mode is 0755, not 0700.`));
  fs.chmodSync(dir, 0o770);
  await assert.rejects(removeCacheEntry(w.stateRoot, machine, 'op-' + OP, held()), says(`Could not delete cache/op-${OP}: its mode is 0770, not 0700.`));
  fs.chmodSync(dir, 0o700); fs.rmSync(dir, { recursive: true });
  fs.symlinkSync(w.base, path.join(w.cacheRoot, 'op-' + OP));
  await assert.rejects(removeCacheEntry(w.stateRoot, machine, 'op-' + OP, held()), says(`Could not delete cache/op-${OP}: it is a link.`));
  fs.unlinkSync(path.join(w.cacheRoot, 'op-' + OP));
  await assert.rejects(removeCacheEntry(w.stateRoot, machine, 'op-' + OP, held()), e => says(`Could not delete cache/op-${OP}: it is not there (ENOENT).`)(e) && e.cause === 'ENOENT');
  fs.writeFileSync(path.join(w.cacheRoot, 'op-' + OP), 'x\n', { mode: 0o600 });
  await assert.rejects(removeCacheEntry(w.stateRoot, machine, 'op-' + OP, held()), says(`Could not delete cache/op-${OP}: it is not a folder.`));
  await assert.rejects(removeCacheEntry(w.stateRoot, machine, 'stray', held()), says('Could not delete cache/stray: the name is not a cache entry name.'));
  entry(w.legacyRoot, 'op-' + OP); fs.chmodSync(w.legacyRoot, 0o750);
  await assert.rejects(removeCacheEntry(w.stateRoot, { scope: 'project-legacy', projectId: PROJECT }, 'op-' + OP, held()), says(`Could not delete ${PROJECT}/cache/op-${OP}: the folder ${PROJECT}/cache has mode 0750, not 0700.`));
  fs.chmodSync(w.legacyRoot, 0o700);
  // A failed rename names its step and keeps the system code as the cause.
  const rename = fs.renameSync; fs.renameSync = () => { throw Object.assign(new Error('injected'), { code: 'EXDEV' }); };
  try { await assert.rejects(removeCacheEntry(w.stateRoot, { scope: 'project-legacy', projectId: PROJECT }, 'op-' + OP, held()), e => says(`Could not delete ${PROJECT}/cache/op-${OP} at the rename step (EXDEV).`)(e) && e.cause === 'EXDEV'); }
  finally { fs.renameSync = rename; }
});

test('10. cacheEntryProblem runs the checks of steps 0, 0a and 2 without the lock, and agrees with removeCacheEntry', async t => {
  const w = stateWorld(t), machine = { scope: 'machine', projectId: null };
  entry(w.cacheRoot, 'op-' + OP); assert.equal(cacheEntryProblem(w.stateRoot, machine, 'op-' + OP), null);
  const bad = entry(w.cacheRoot, 'op-' + 'b'.repeat(32)); fs.chmodSync(bad, 0o755);
  assert.equal(cacheEntryProblem(w.stateRoot, machine, 'op-' + 'b'.repeat(32)), 'its mode is 0755, not 0700');
  fs.symlinkSync(w.base, path.join(w.storeCacheRoot, `skill-a-${HASH}`));
  assert.equal(cacheEntryProblem(w.stateRoot, { scope: 'store', projectId: null }, `skill-a-${HASH}`), 'it is a link');
  assert.equal(cacheEntryProblem(w.stateRoot, machine, 'junk'), 'the name is not a cache entry name');
  fs.chmodSync(w.cacheRoot, 0o755);
  assert.equal(cacheEntryProblem(w.stateRoot, machine, 'op-' + OP), 'the folder cache has mode 0755, not 0700');
  fs.chmodSync(w.cacheRoot, 0o700);
  assert.deepEqual(names(w.cacheRoot), ['op-' + OP, 'op-' + 'b'.repeat(32)], 'it reads only');
});

// Round 3 of the reviews of PR 99, M-A and L-a: the delete step walks the renamed folder without following a link, awaits
// each file, names the path that failed, and stops between two files when the signal aborts.
test('11. a folder that cannot be deleted refuses at the delete step, names the leftover and the inner path, and says how to fix it', async t => {
  const w = stateWorld(t), dir = entry(w.cacheRoot, 'op-' + OP), sub = path.join(dir, 'locked');
  fs.mkdirSync(sub, { mode: 0o700 }); fs.writeFileSync(path.join(sub, 'inside.md'), 'x\n'); fs.chmodSync(sub, 0o500);
  t.after(() => { for (const n of fs.existsSync(w.cacheRoot) ? fs.readdirSync(w.cacheRoot) : []) { try { fs.chmodSync(path.join(w.cacheRoot, n, 'locked'), 0o700); } catch { /* gone */ } } });
  let leftover = '';
  await assert.rejects(removeCacheEntry(w.stateRoot, { scope: 'machine', projectId: null }, 'op-' + OP, held()), e => {
    leftover = path.join(w.cacheRoot, fs.readdirSync(w.cacheRoot).find(n => n.startsWith('.prune-')));
    refused(e); assert.equal(e.message, `${FIXED} Could not delete ${leftover} at the delete step (EACCES at ${path.join(leftover, 'locked', 'inside.md')}).`);
    assert.equal(e.cause, 'EACCES'); assert.equal(e.next, `chmod -R u+rwx ${leftover}, then run the command again without --approve`); return true;
  });
  fs.chmodSync(path.join(leftover, 'locked'), 0o700);
  await removeCacheEntry(w.stateRoot, { scope: 'machine', projectId: null }, path.basename(leftover), held());
  assert.deepEqual(names(w.cacheRoot), []);
});

test('12. an abort during the delete step stops between two files and leaves the renamed leftover', async t => {
  const w = stateWorld(t), files = Object.fromEntries(Array.from({ length: 200 }, (_, i) => [`f${i}.md`, 'x\n'])); entry(w.cacheRoot, 'op-' + OP, files);
  const controller = new AbortController(); let calls = 0;
  const aborting = { assertHeld() { if (++calls === 2) setImmediate(() => controller.abort()); } };
  await assert.rejects(removeCacheEntry(w.stateRoot, { scope: 'machine', projectId: null }, 'op-' + OP, aborting, { signal: controller.signal }), e => {
    const left = names(w.cacheRoot); assert.equal(left.length, 1); assert.match(left[0], /^\.prune-op-a{32}-[a-f0-9]{8}$/);
    assert.equal(e.name, 'AbortError'); assert.equal(e.leftover, path.join(w.cacheRoot, left[0]));
    const remaining = fs.readdirSync(e.leftover).length; assert.ok(remaining > 0, `stopped before the end (${remaining} left)`); return true;
  });
});

test('13. a cache folder removed before the check counts as a lost lock, not a refusal of the entry', async t => {
  const w = stateWorld(t); entry(w.cacheRoot, 'op-' + OP); fs.renameSync(w.cacheRoot, path.join(w.base, 'moved'));
  const lost = { assertHeld() { throw Object.assign(new Error('Bowerloom lost the skills cache lock. Try again.'), { code: 'PROJECT_LOCK_UNAVAILABLE' }); } };
  await assert.rejects(removeCacheEntry(w.stateRoot, { scope: 'machine', projectId: null }, 'op-' + OP, lost), e => e.code === 'PROJECT_LOCK_UNAVAILABLE');
});
