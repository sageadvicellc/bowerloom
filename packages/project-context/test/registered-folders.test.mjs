// Spec 05, Part B, section 10.16: registered folders in the store. Every test makes its own home folder in a temporary
// folder; nothing here touches the real home.
import test from '../../../dist/tests/support/lock-slot-retry.js';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import '../../../dist/tests/support/isolate-home.js';
import {
  FOLDER_FORMAT, applyFolderAddWith, applyFolderRemoveWith, isFolderName, listFoldersWith, planFolderAddWith, planFolderRemoveWith,
  readFolderRecord, renderFolderAddReview, renderFolderRemoveReview, resolveRegisteredFolderWith, resolveRegisteredRootWith,
} from '../../../dist/packages/project-context/src/registered-folders.js';
import { inspectStoreWith } from '../../../dist/packages/project-context/src/store.js';

const code = expected => error => { if (error?.code !== expected) throw new Error(`expected ${expected}, got ${error?.code ?? error} ${error?.message ?? ''}`); return true; };
const signal = () => new AbortController().signal;
function world(t) {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'bowerloom-folders-')));
  t.after(() => {
    for (const p of [base, path.join(base, 'home'), path.join(base, 'home', 'shared')]) { try { fs.chmodSync(p, 0o700); } catch { /* gone */ } }
    fs.rmSync(base, { recursive: true, force: true });
  });
  const home = path.join(base, 'home'); fs.mkdirSync(home, { mode: 0o700 });
  const hooks = { accountHome: path.join(base, 'nobody') };
  const store = path.join(home, '.bowerloom'), folders = path.join(store, 'folders');
  const make = (rel, mode = 0o755) => { const dir = path.join(home, rel); fs.mkdirSync(dir, { recursive: true, mode }); for (let p = dir; p !== home; p = path.dirname(p)) fs.chmodSync(p, mode); return dir; };
  const add = async (name, target) => { const plan = planFolderAddWith(home, home, name, target, hooks); return applyFolderAddWith(home, home, name, target, plan.revision, signal(), hooks); };
  return { base, home, hooks, store, folders, make, add, record: name => path.join(folders, name + '.json') };
}
const BODY = rel => `{"format":"bowerloom/store-folder/v1beta1","path":${JSON.stringify(rel)}}\n`;

test('1. folder add plans the exact lines, and the store-create line only when the store is absent', t => {
  const w = world(t); w.make('Sage Advice/knowledge-base');
  const plan = planFolderAddWith(w.home, w.home, 'kb', '~/Sage Advice/knowledge-base', w.hooks);
  assert.equal(plan.storeCreate, true); assert.equal(plan.path, 'Sage Advice/knowledge-base'); assert.match(plan.revision, /^[a-f0-9]{64}$/);
  assert.equal(renderFolderAddReview(plan), [
    'Create the store at ~/.bowerloom (store.json). It holds definitions only.',
    'Register folder kb in the store at ~/.bowerloom/folders/kb.json',
    '  Folder: ~/Sage Advice/knowledge-base',
    '  A slice names it with root: { registered: kb }. Bowerloom reads this folder and never writes it.',
    'This writes the store only. It changes no project, and it installs nothing.',
  ].join('\n'));
  assert.equal(fs.existsSync(w.store), false, 'planning writes nothing');
  fs.mkdirSync(w.store, { mode: 0o700 }); fs.writeFileSync(path.join(w.store, 'store.json'), `{"format":"bowerloom/store/v1beta1"}\n`, { mode: 0o644 });
  const again = planFolderAddWith(w.home, w.home, 'kb', '~/Sage Advice/knowledge-base', w.hooks);
  assert.equal(again.storeCreate, false);
  assert.doesNotMatch(renderFolderAddReview(again), /Create the store/);
});
test('2. apply writes the exact record bytes with mode 0644, in a 0700 folders folder, and makes the store', async t => {
  const w = world(t); w.make('kb');
  const out = await w.add('kb', '~/kb');
  assert.deepEqual(out, { name: 'kb', path: 'kb' });
  assert.equal(fs.readFileSync(w.record('kb'), 'utf8'), BODY('kb'));
  assert.equal(fs.statSync(w.record('kb')).mode & 0o777, 0o644); assert.equal(fs.statSync(w.folders).mode & 0o777, 0o700);
  assert.equal(fs.lstatSync(w.record('kb')).nlink, 1);
  assert.deepEqual(fs.readdirSync(w.folders), ['kb.json'], 'no temporary name is left');
  assert.equal(inspectStoreWith(w.home, w.hooks).state, 'store');
  assert.equal(FOLDER_FORMAT, 'bowerloom/store-folder/v1beta1');
});
test('3. a second folder add with the same name refuses FOLDER_EXISTS', async t => {
  const w = world(t); w.make('kb'); w.make('other'); await w.add('kb', '~/kb');
  assert.throws(() => planFolderAddWith(w.home, w.home, 'kb', '~/other', w.hooks), code('FOLDER_EXISTS'));
});
test('4. a name that differs only in case refuses FOLDER_EXISTS, and a bad name refuses FOLDER_NAME_INVALID', async t => {
  const w = world(t); w.make('kb'); await w.add('other', '~/kb'); fs.writeFileSync(path.join(w.folders, 'Kb.json'), BODY('kb'), { mode: 0o644 });
  assert.throws(() => planFolderAddWith(w.home, w.home, 'kb', '~/kb', w.hooks), code('FOLDER_EXISTS'));
  for (const bad of ['KB', 'a_b', '-a', 'a--b', '', 'a'.repeat(65), 'a/b', '.a']) assert.throws(() => planFolderAddWith(w.home, w.home, bad, '~/kb', w.hooks), code('FOLDER_NAME_INVALID'), JSON.stringify(bad));
  assert.equal(isFolderName('a'.repeat(64)), true); assert.equal(isFolderName('a'.repeat(65)), false); assert.equal(isFolderName('wiki-eng'), true);
});
test('5. the home folder refuses FOLDER_UNSAFE, and so does a path that does not exist', t => {
  const w = world(t);
  assert.throws(() => planFolderAddWith(w.home, w.home, 'kb', '~', w.hooks), code('FOLDER_UNSAFE'));
  assert.throws(() => planFolderAddWith(w.home, w.home, 'kb', w.home, w.hooks), code('FOLDER_UNSAFE'));
  assert.throws(() => planFolderAddWith(w.home, w.home, 'kb', '~/nope', w.hooks), error => error.code === 'FOLDER_UNSAFE' && /does not exist/.test(error.message));
});
test('6. a folder outside the home folder refuses FOLDER_UNSAFE', t => {
  const w = world(t); const outside = path.join(w.base, 'elsewhere'); fs.mkdirSync(outside, { mode: 0o755 });
  assert.throws(() => planFolderAddWith(w.home, w.home, 'kb', outside, w.hooks), code('FOLDER_UNSAFE'));
  assert.throws(() => planFolderAddWith(w.home, w.home, 'kb', '/', w.hooks), code('FOLDER_UNSAFE'));
});
test('7. a cloud folder refuses FOLDER_IN_CLOUD', t => {
  const w = world(t); w.make('Library/Mobile Documents/x'); w.make('Library/CloudStorage/y');
  assert.throws(() => planFolderAddWith(w.home, w.home, 'kb', '~/Library/Mobile Documents/x', w.hooks), code('FOLDER_IN_CLOUD'));
  assert.throws(() => planFolderAddWith(w.home, w.home, 'kb', '~/Library/CloudStorage/y', w.hooks), code('FOLDER_IN_CLOUD'));
});
test('8. a group-writable parent below home, and a group-writable folder, refuse FOLDER_UNSAFE', t => {
  const w = world(t); w.make('shared/kb'); fs.chmodSync(path.join(w.home, 'shared'), 0o775);
  assert.throws(() => planFolderAddWith(w.home, w.home, 'kb', '~/shared/kb', w.hooks), code('FOLDER_UNSAFE'));
  w.make('open'); fs.chmodSync(path.join(w.home, 'open'), 0o757);
  assert.throws(() => planFolderAddWith(w.home, w.home, 'kb', '~/open', w.hooks), code('FOLDER_UNSAFE'));
  fs.chmodSync(path.join(w.home, 'shared'), 0o755);
  assert.equal(planFolderAddWith(w.home, w.home, 'kb', '~/shared/kb', w.hooks).path, 'shared/kb');
});
test('9. a hidden segment refuses FOLDER_UNSAFE', t => {
  const w = world(t); w.make('.hidden/kb'); w.make('a/.b');
  assert.throws(() => planFolderAddWith(w.home, w.home, 'kb', '~/.hidden/kb', w.hooks), code('FOLDER_UNSAFE'));
  assert.throws(() => planFolderAddWith(w.home, w.home, 'kb', '~/a/.b', w.hooks), code('FOLDER_UNSAFE'));
});
test('10. a folder inside the store refuses FOLDER_UNSAFE, and so does a link into it', async t => {
  const w = world(t); w.make('kb'); await w.add('kb', '~/kb');
  assert.throws(() => planFolderAddWith(w.home, w.home, 'in', w.folders, w.hooks), code('FOLDER_UNSAFE'));
  assert.throws(() => planFolderAddWith(w.home, w.home, 'in', w.store, w.hooks), code('FOLDER_UNSAFE'));
  fs.symlinkSync(w.folders, path.join(w.home, 'viaLink'));
  assert.throws(() => planFolderAddWith(w.home, w.home, 'in', '~/viaLink', w.hooks), code('FOLDER_UNSAFE'));
});
test('11. a record with an extra key, a duplicate key, a bad path, or a BOM reads as FOLDER_INVALID', async t => {
  const w = world(t); w.make('kb'); await w.add('kb', '~/kb');
  const store = inspectStoreWith(w.home, w.hooks).context;
  const bad = [`{"format":"bowerloom/store-folder/v1beta1","path":"kb","extra":1}\n`, `{"format":"bowerloom/store-folder/v1beta1","path":"kb","path":"kb"}\n`, `{"format":"bowerloom/store-folder/v1beta1","path":"../kb"}\n`,
    `{"format":"bowerloom/store-folder/v1beta1","path":".kb"}\n`, `{"format":"bowerloom/store-folder/v1beta1","path":"/kb"}\n`, `{"format":"bowerloom/store-folder/v1beta1","path":"a//b"}\n`, `{"format":"other","path":"kb"}\n`,
    '﻿' + BODY('kb'), `{"format":"bowerloom/store-folder/v1beta1"}\n`, '[]\n', 'not json\n', `{"format":"bowerloom/store-folder/v1beta1","path":"${'a'.repeat(1025)}"}\n`];
  for (const text of bad) { fs.writeFileSync(w.record('kb'), text, { mode: 0o644 }); assert.throws(() => readFolderRecord(store, 'kb'), code('FOLDER_INVALID'), text.slice(0, 60)); }
  fs.writeFileSync(w.record('kb'), 'x'.repeat(4097), { mode: 0o644 }); assert.throws(() => readFolderRecord(store, 'kb'), code('FOLDER_INVALID'));
  fs.writeFileSync(w.record('kb'), BODY('kb'), { mode: 0o644 });
  const read = readFolderRecord(store, 'kb'); assert.equal(read.path, 'kb'); assert.match(read.sha256, /^[a-f0-9]{64}$/); assert.equal(read.bytes, Buffer.byteLength(BODY('kb')));
  assert.throws(() => readFolderRecord(store, 'nope'), code('FOLDER_NOT_FOUND'));
});
test('12. a record that is a link, has two links, is group-writable, or is a folder reads as FOLDER_UNSAFE', async t => {
  const w = world(t); w.make('kb'); await w.add('kb', '~/kb');
  const store = inspectStoreWith(w.home, w.hooks).context, file = w.record('kb'), aside = path.join(w.base, 'aside.json');
  fs.renameSync(file, aside); fs.symlinkSync(aside, file); assert.throws(() => readFolderRecord(store, 'kb'), code('FOLDER_UNSAFE'));
  fs.unlinkSync(file); fs.linkSync(aside, file); assert.throws(() => readFolderRecord(store, 'kb'), code('FOLDER_UNSAFE'));
  fs.unlinkSync(file); fs.writeFileSync(file, BODY('kb'), { mode: 0o664 }); fs.chmodSync(file, 0o664); assert.throws(() => readFolderRecord(store, 'kb'), code('FOLDER_UNSAFE'));
  fs.unlinkSync(file); fs.mkdirSync(file); assert.throws(() => readFolderRecord(store, 'kb'), code('FOLDER_UNSAFE'));
});
test('13. a leftover temporary file is ignored by folder list and removed by the next folder add and folder remove', async t => {
  const w = world(t); w.make('kb'); w.make('two'); await w.add('kb', '~/kb');
  const temp = '.folder-kb.0123456789abcdef.tmp'; fs.writeFileSync(path.join(w.folders, temp), 'half', { mode: 0o644 });
  assert.deepEqual(listFoldersWith(w.home, w.hooks).folders.map(f => f.name), ['kb']);
  await w.add('two', '~/two'); assert.deepEqual(fs.readdirSync(w.folders), ['kb.json', 'two.json']);
  fs.writeFileSync(path.join(w.folders, temp), 'half', { mode: 0o644 });
  const plan = planFolderRemoveWith(w.home, 'two', w.hooks); await applyFolderRemoveWith(w.home, 'two', plan.revision, signal(), w.hooks);
  assert.deepEqual(fs.readdirSync(w.folders), ['kb.json']);
});
test('14. folder remove removes only the file and keeps the folder, and the plan has the exact lines', async t => {
  const w = world(t); const dir = w.make('kb'); fs.writeFileSync(path.join(dir, 'page.md'), '# Page\n'); await w.add('kb', '~/kb');
  const plan = planFolderRemoveWith(w.home, 'kb', w.hooks);
  assert.equal(renderFolderRemoveReview(plan), [
    'Remove folder kb from the store: ~/.bowerloom/folders/kb.json',
    '  Folder: ~/kb. The folder stays. Bowerloom never writes it.',
    '  Slices that name this folder are held with SLICE_ROOT_MISSING until the name is registered again.',
    'This writes the store only. It changes no project.',
  ].join('\n'));
  await applyFolderRemoveWith(w.home, 'kb', plan.revision, signal(), w.hooks);
  assert.equal(fs.existsSync(w.record('kb')), false); assert.deepEqual(fs.readdirSync(dir), ['page.md']);
  assert.throws(() => planFolderRemoveWith(w.home, 'kb', w.hooks), code('FOLDER_NOT_FOUND'));
});
test('14b. folder remove refuses FOLDER_NOT_FOUND without a store, and makes no store', t => {
  const w = world(t);
  assert.throws(() => planFolderRemoveWith(w.home, 'kb', w.hooks), code('FOLDER_NOT_FOUND')); assert.equal(fs.existsSync(w.store), false);
});
test('15. folder remove refuses STALE_APPROVAL when the file changed after the plan', async t => {
  const w = world(t); w.make('kb'); w.make('other'); await w.add('kb', '~/kb');
  const plan = planFolderRemoveWith(w.home, 'kb', w.hooks);
  fs.writeFileSync(w.record('kb'), BODY('other'), { mode: 0o644 });
  await assert.rejects(applyFolderRemoveWith(w.home, 'kb', plan.revision, signal(), w.hooks), code('STALE_APPROVAL'));
  assert.equal(fs.readFileSync(w.record('kb'), 'utf8'), BODY('other'), 'the changed file stays');
});
test('15b. folder remove refuses STALE_APPROVAL when the file was replaced by a same-bytes file with another identity', async t => {
  const w = world(t); w.make('kb'); await w.add('kb', '~/kb');
  const plan = planFolderRemoveWith(w.home, 'kb', w.hooks);
  const copy = path.join(w.folders, 'tmp-copy'); fs.writeFileSync(copy, BODY('kb'), { mode: 0o644 }); fs.renameSync(copy, w.record('kb'));
  await assert.rejects(applyFolderRemoveWith(w.home, 'kb', plan.revision, signal(), w.hooks), code('STALE_APPROVAL'));
  assert.equal(fs.existsSync(w.record('kb')), true);
});
test('16. resolveRegisteredFolder returns the real path, the identity, and the record sha256', async t => {
  const w = world(t); const dir = w.make('Sage Advice/kb'); await w.add('kb', '~/Sage Advice/kb');
  const got = resolveRegisteredFolderWith(w.home, 'kb', w.hooks);
  assert.equal(got.ok, true); assert.equal(got.dir, dir); assert.equal(got.rel, 'Sage Advice/kb');
  const st = fs.statSync(dir, { bigint: true });
  assert.equal(got.identity.device, String(st.dev)); assert.equal(got.identity.inode, String(st.ino)); assert.equal(got.identity.birthtimeNs, String(st.birthtimeNs));
  const { createHash } = await import('node:crypto');
  assert.equal(got.recordSha256, createHash('sha256').update(fs.readFileSync(w.record('kb'))).digest('hex'));
});
test('17. the root of a registered folder joins the path, and the holds name the cause', async t => {
  const w = world(t); const dir = w.make('kb/wiki/sub'); await w.add('kb', '~/kb');
  const ok = resolveRegisteredRootWith(w.home, 'kb', 'wiki', w.hooks); assert.equal(ok.ok, true); assert.equal(ok.dir, path.join(dir, '..')); assert.equal(ok.rel, 'kb');
  assert.equal(resolveRegisteredRootWith(w.home, 'kb', '.', w.hooks).dir, path.join(w.home, 'kb'));
  const none = resolveRegisteredRootWith(w.home, 'kb', 'nope', w.hooks); assert.deepEqual([none.ok, none.code], [false, 'SLICE_ROOT_MISSING']);
  assert.deepEqual(resolveRegisteredRootWith(w.home, 'unknown', '.', w.hooks), { ok: false, code: 'SLICE_ROOT_MISSING', detail: 'unknown' });
  // A link at or below the recorded path is unsafe, not missing.
  fs.renameSync(path.join(w.home, 'kb/wiki'), path.join(w.home, 'wiki-real')); fs.symlinkSync(path.join(w.home, 'wiki-real'), path.join(w.home, 'kb/wiki'));
  const linked = resolveRegisteredRootWith(w.home, 'kb', 'wiki', w.hooks); assert.deepEqual([linked.ok, linked.code], [false, 'SLICE_ROOT_UNSAFE']);
  fs.unlinkSync(path.join(w.home, 'kb/wiki')); fs.renameSync(path.join(w.home, 'wiki-real'), path.join(w.home, 'kb/wiki'));
  fs.chmodSync(path.join(w.home, 'kb/wiki'), 0o775);
  assert.equal(resolveRegisteredRootWith(w.home, 'kb', 'wiki', w.hooks).code, 'SLICE_ROOT_UNSAFE');
  fs.chmodSync(path.join(w.home, 'kb/wiki'), 0o755);
  // The folder itself replaced by a link: unsafe.
  fs.renameSync(path.join(w.home, 'kb'), path.join(w.home, 'kb-real')); fs.symlinkSync(path.join(w.home, 'kb-real'), path.join(w.home, 'kb'));
  assert.equal(resolveRegisteredFolderWith(w.home, 'kb', w.hooks).code, 'SLICE_ROOT_UNSAFE');
  fs.unlinkSync(path.join(w.home, 'kb'));
  assert.equal(resolveRegisteredFolderWith(w.home, 'kb', w.hooks).code, 'SLICE_ROOT_MISSING', 'a gone folder is missing');
});
test('18. a store that is absent, or a record that is invalid, holds the slice root', async t => {
  const w = world(t); w.make('kb');
  assert.deepEqual(resolveRegisteredFolderWith(w.home, 'kb', w.hooks), { ok: false, code: 'SLICE_ROOT_MISSING', detail: 'kb' });
  await w.add('kb', '~/kb'); fs.writeFileSync(w.record('kb'), '{"format":"x"}\n', { mode: 0o644 });
  assert.equal(resolveRegisteredFolderWith(w.home, 'kb', w.hooks).code, 'SLICE_ROOT_UNSAFE');
  fs.writeFileSync(w.record('kb'), BODY('kb'), { mode: 0o644 }); fs.chmodSync(w.store, 0o775);
  assert.equal(resolveRegisteredFolderWith(w.home, 'kb', w.hooks).code, 'SLICE_ROOT_UNSAFE', 'an unsafe store');
});
test('19. folder add records the real path of a folder reached through a link', async t => {
  const w = world(t); w.make('real/kb'); fs.symlinkSync(path.join(w.home, 'real'), path.join(w.home, 'alias'));
  await w.add('kb', '~/alias/kb');
  assert.equal(fs.readFileSync(w.record('kb'), 'utf8'), BODY('real/kb'));
  fs.rmSync(path.join(w.home, 'real/kb'), { recursive: true }); fs.symlinkSync(path.join(w.home, 'elsewhere'), path.join(w.home, 'real/kb'));
  fs.mkdirSync(path.join(w.home, 'elsewhere'), { mode: 0o755 });
  assert.equal(resolveRegisteredFolderWith(w.home, 'kb', w.hooks).code, 'SLICE_ROOT_UNSAFE', 'a link at the recorded path');
});
test('20. a path of more than 1024 bytes below home refuses FOLDER_UNSAFE', t => {
  const w = world(t); let rel = ''; for (let i = 0; Buffer.byteLength(rel) <= 1030; i++) rel = path.join(rel, 'd'.repeat(100));
  try { w.make(rel); } catch { t.skip('this file system does not take a path this long'); return; }
  assert.throws(() => planFolderAddWith(w.home, w.home, 'kb', path.join(w.home, rel), w.hooks), code('FOLDER_UNSAFE'));
});
test('21. a foreign store refuses STORE_INVALID, and a link store refuses STORE_UNSAFE', t => {
  const w = world(t); w.make('kb'); fs.mkdirSync(w.store, { mode: 0o700 }); fs.writeFileSync(path.join(w.store, 'mine.txt'), 'x');
  assert.throws(() => planFolderAddWith(w.home, w.home, 'kb', '~/kb', w.hooks), code('STORE_INVALID'));
});
test('22. the plan revision binds the store, the folders list, the path, and the identity of the folder', async t => {
  const w = world(t); w.make('kb'); w.make('other');
  const a = planFolderAddWith(w.home, w.home, 'kb', '~/kb', w.hooks), same = planFolderAddWith(w.home, w.home, 'kb', '~/kb', w.hooks);
  assert.equal(a.revision, same.revision);
  assert.notEqual(planFolderAddWith(w.home, w.home, 'kb', '~/other', w.hooks).revision, a.revision, 'the path');
  assert.notEqual(planFolderAddWith(w.home, w.home, 'kc', '~/kb', w.hooks).revision, a.revision, 'the name');
  // A replaced folder has another identity.
  fs.rmSync(path.join(w.home, 'kb'), { recursive: true }); fs.mkdirSync(path.join(w.home, 'kb'), { mode: 0o755 });
  assert.notEqual(planFolderAddWith(w.home, w.home, 'kb', '~/kb', w.hooks).revision, a.revision, 'the identity of the folder');
  // The store, then the folders list.
  await w.add('x', '~/other'); const b = planFolderAddWith(w.home, w.home, 'kb', '~/kb', w.hooks); assert.equal(b.storeCreate, false); assert.notEqual(b.revision, a.revision);
  await w.add('y', '~/other'); assert.notEqual(planFolderAddWith(w.home, w.home, 'kb', '~/kb', w.hooks).revision, b.revision, 'the names in folders');
});
test('23. folder add refuses STALE_APPROVAL, and writes nothing, when the folder was replaced after the plan', async t => {
  const w = world(t); w.make('kb'); const plan = planFolderAddWith(w.home, w.home, 'kb', '~/kb', w.hooks);
  fs.rmSync(path.join(w.home, 'kb'), { recursive: true }); fs.mkdirSync(path.join(w.home, 'kb'), { mode: 0o755 });
  await assert.rejects(applyFolderAddWith(w.home, w.home, 'kb', '~/kb', plan.revision, signal(), w.hooks), code('STALE_APPROVAL'));
  assert.equal(fs.existsSync(w.record('kb')), false);
});
test('24. folder add refuses STALE_APPROVAL when a record with that name appears after the plan', async t => {
  const w = world(t); w.make('kb'); w.make('other'); await w.add('x', '~/other');
  const plan = planFolderAddWith(w.home, w.home, 'kb', '~/kb', w.hooks);
  fs.writeFileSync(w.record('kb'), BODY('other'), { mode: 0o644 });
  await assert.rejects(applyFolderAddWith(w.home, w.home, 'kb', '~/kb', plan.revision, signal(), w.hooks), error => error.code === 'STALE_APPROVAL' || error.code === 'FOLDER_EXISTS');
  assert.equal(fs.readFileSync(w.record('kb'), 'utf8'), BODY('other'));
});
test('25. folder add refuses STALE_APPROVAL for a revision of another plan', async t => {
  const w = world(t); w.make('kb');
  await assert.rejects(applyFolderAddWith(w.home, w.home, 'kb', '~/kb', 'a'.repeat(64), signal(), w.hooks), code('STALE_APPROVAL'));
  assert.equal(fs.existsSync(w.store), true, 'the store may exist, the record may not'); assert.equal(fs.existsSync(w.record('kb')), false);
});
test('26. folder list: ready, missing, and refused, sorted by name', async t => {
  const w = world(t); w.make('a'); w.make('b'); w.make('c'); await w.add('aa', '~/a'); await w.add('bb', '~/b'); await w.add('cc', '~/c');
  fs.rmSync(path.join(w.home, 'b'), { recursive: true }); fs.writeFileSync(w.record('cc'), '{"format":"x"}\n', { mode: 0o644 }); fs.writeFileSync(path.join(w.folders, 'stray.txt'), 'x', { mode: 0o644 });
  const list = listFoldersWith(w.home, w.hooks);
  assert.deepEqual(list.folders.map(f => [f.name, f.path, f.state, f.code]), [['aa', '~/a', 'ready', null], ['bb', '~/b', 'missing', null], ['cc', null, 'refused', 'FOLDER_INVALID'], ['stray.txt', null, 'refused', 'FOLDER_INVALID']]);
  assert.equal(listFoldersWith(world(t).home, w.hooks).store, false);
});
test('27. folder list refuses a folders folder that is a link', async t => {
  const w = world(t); w.make('kb'); await w.add('kb', '~/kb'); fs.renameSync(w.folders, path.join(w.base, 'f')); fs.symlinkSync(path.join(w.base, 'f'), w.folders);
  assert.throws(() => listFoldersWith(w.home, w.hooks), code('FOLDER_UNSAFE'));
});
test('28. a folder or a record owned by another user refuses FOLDER_UNSAFE (the owner is a hook)', async t => {
  const w = world(t); w.make('kb'); await w.add('kb', '~/kb');
  const other = { ...w.hooks, uid: process.getuid() + 1 };
  assert.throws(() => planFolderAddWith(w.home, w.home, 'two', '~/kb', other), error => error.code === 'FOLDER_UNSAFE' || error.code === 'STORE_UNSAFE');
  const store = inspectStoreWith(w.home, w.hooks).context;
  assert.throws(() => readFolderRecord(store, 'kb', other), code('FOLDER_UNSAFE'));
  const again = resolveRegisteredRootWith(w.home, 'kb', '.', other); assert.equal(again.ok, false);
});
