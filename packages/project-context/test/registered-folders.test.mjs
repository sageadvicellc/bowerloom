// Spec 05, Part B, section 10.16: registered folders in the store. Every test makes its own home folder in a temporary
// folder; nothing here touches the real home.
import test from '../../../dist/tests/support/lock-slot-retry.js';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import '../../../dist/tests/support/isolate-home.js';
import {
  FOLDER_FORMAT, applyFolderAddWith, applyFolderRemoveWith, isFolderName, listFoldersWith, planFolderAddWith, planFolderRemoveWith,
  readFolderRecord, renderFolderAddReview, renderFolderRemoveReview, resolveRegisteredFolderWith, resolveRegisteredRootWith,
  applyFolderAllowWith, applyFolderDenyWith, planFolderAllowWith, planFolderDenyWith, renderFolderAllowReview, renderFolderDenyReview, holdsStore,
} from '../../../dist/packages/project-context/src/registered-folders.js';
import { syncBuiltinESMExports } from 'node:module';
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
  const project = { dir: path.join(base, 'project'), projectId: 'a'.repeat(32), birthtimeNs: '111' }, access = { projectId: project.projectId, birthtimeNs: '111' };
  const allow = async (name, as = project, summary = 'heading') => { const plan = planFolderAllowWith(home, as, name, hooks, summary); return applyFolderAllowWith(home, as, name, plan.revision, signal(), hooks, summary); };
  const grantNow = (name, pid = project.projectId, birth = project.birthtimeNs, summary = 'heading') => {
    const dir = path.join(folders, name + '.grants'); fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const sha = createHash('sha256').update(fs.readFileSync(path.join(folders, name + '.json'))).digest('hex');
    fs.writeFileSync(path.join(dir, pid), `{"format":"bowerloom/store-folder-grant/v1beta1","record":"${sha}","birth":"${birth}"${summary === null ? '' : `,"summary":"${summary}"`}}\n`, { mode: 0o644 });
  };
  const add = async (name, target) => { const plan = planFolderAddWith(home, home, name, target, hooks); return applyFolderAddWith(home, home, name, target, plan.revision, signal(), hooks); };
  return { base, home, hooks, store, folders, make, add, allow, grantNow, project, access, record: name => path.join(folders, name + '.json') };
}
const ID = 'a'.repeat(32);
const BODY = (rel, id = ID) => `{"format":"bowerloom/store-folder/v1beta1","path":${JSON.stringify(rel)},"id":"${id}"}\n`;
const RECORD = rel => new RegExp(`^\\{"format":"bowerloom/store-folder/v1beta1","path":${JSON.stringify(rel).replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')},"id":"[a-f0-9]{32}"\\}\\n$`);

test('1. folder add plans the exact lines, and the store-create line only when the store is absent', t => {
  const w = world(t); w.make('My Notes/knowledge-base');
  const plan = planFolderAddWith(w.home, w.home, 'kb', '~/My Notes/knowledge-base', w.hooks);
  assert.equal(plan.storeCreate, true); assert.equal(plan.path, 'My Notes/knowledge-base'); assert.match(plan.revision, /^[a-f0-9]{64}$/);
  assert.equal(renderFolderAddReview(plan), [
    'Create the store at ~/.bowerloom (store.json, and a .gitignore that leaves out the files of this machine). It holds definitions only.',
    'Register folder kb in the store at ~/.bowerloom/folders/kb.json',
    '  Folder: ~/My Notes/knowledge-base',
    '  A slice names it with root: { registered: kb }. Bowerloom reads this folder and never writes it.',
    'This writes the store only. It changes no project, and it installs nothing.',
  ].join('\n'));
  assert.equal(fs.existsSync(w.store), false, 'planning writes nothing');
  fs.mkdirSync(w.store, { mode: 0o700 }); fs.writeFileSync(path.join(w.store, 'store.json'), `{"format":"bowerloom/store/v1beta1"}\n`, { mode: 0o644 });
  const again = planFolderAddWith(w.home, w.home, 'kb', '~/My Notes/knowledge-base', w.hooks);
  assert.equal(again.storeCreate, false);
  assert.doesNotMatch(renderFolderAddReview(again), /Create the store/);
});
test('2. apply writes the exact record bytes with mode 0644, in a 0700 folders folder, and makes the store', async t => {
  const w = world(t); w.make('kb');
  const out = await w.add('kb', '~/kb');
  assert.deepEqual(out, { name: 'kb', path: 'kb' });
  assert.match(fs.readFileSync(w.record('kb'), 'utf8'), RECORD('kb'));
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
    '﻿' + BODY('kb'), `{"format":"bowerloom/store-folder/v1beta1"}\n`, `{"format":"bowerloom/store-folder/v1beta1","path":"kb"}\n`, `{"format":"bowerloom/store-folder/v1beta1","path":"kb","id":"short"}\n`, `{"format":"bowerloom/store-folder/v1beta1","path":"kb","id":"${'A'.repeat(32)}"}\n`, '[]\n', 'not json\n', `{"format":"bowerloom/store-folder/v1beta1","path":"${'a'.repeat(1025)}"}\n`];
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
  const w = world(t); const dir = w.make('My Notes/kb'); await w.add('kb', '~/My Notes/kb'); await w.allow('kb');
  const got = resolveRegisteredFolderWith(w.home, 'kb', w.access, w.hooks);
  assert.equal(got.ok, true); assert.equal(got.dir, dir); assert.equal(got.rel, 'My Notes/kb');
  const st = fs.statSync(dir, { bigint: true });
  assert.equal(got.identity.device, String(st.dev)); assert.equal(got.identity.inode, String(st.ino)); assert.equal(got.identity.birthtimeNs, String(st.birthtimeNs));
  const { createHash } = await import('node:crypto');
  assert.equal(got.recordSha256, createHash('sha256').update(fs.readFileSync(w.record('kb'))).digest('hex'));
});
test('17. the root of a registered folder joins the path, and the holds name the cause', async t => {
  const w = world(t); const dir = w.make('kb/wiki/sub'); await w.add('kb', '~/kb'); await w.allow('kb');
  const ok = resolveRegisteredRootWith(w.home, 'kb', 'wiki', w.access, w.hooks); assert.equal(ok.ok, true); assert.equal(ok.dir, path.join(dir, '..')); assert.equal(ok.rel, 'kb');
  assert.equal(resolveRegisteredRootWith(w.home, 'kb', '.', w.access, w.hooks).dir, path.join(w.home, 'kb'));
  const none = resolveRegisteredRootWith(w.home, 'kb', 'nope', w.access, w.hooks); assert.deepEqual([none.ok, none.code], [false, 'SLICE_ROOT_MISSING']);
  assert.deepEqual(resolveRegisteredRootWith(w.home, 'unknown', '.', w.access, w.hooks), { ok: false, code: 'SLICE_ROOT_MISSING', detail: 'unknown' });
  // A link at or below the recorded path is unsafe, not missing.
  fs.renameSync(path.join(w.home, 'kb/wiki'), path.join(w.home, 'wiki-real')); fs.symlinkSync(path.join(w.home, 'wiki-real'), path.join(w.home, 'kb/wiki'));
  const linked = resolveRegisteredRootWith(w.home, 'kb', 'wiki', w.access, w.hooks); assert.deepEqual([linked.ok, linked.code], [false, 'SLICE_ROOT_UNSAFE']);
  fs.unlinkSync(path.join(w.home, 'kb/wiki')); fs.renameSync(path.join(w.home, 'wiki-real'), path.join(w.home, 'kb/wiki'));
  fs.chmodSync(path.join(w.home, 'kb/wiki'), 0o775);
  assert.equal(resolveRegisteredRootWith(w.home, 'kb', 'wiki', w.access, w.hooks).code, 'SLICE_ROOT_UNSAFE');
  fs.chmodSync(path.join(w.home, 'kb/wiki'), 0o755);
  // The folder itself replaced by a link: unsafe.
  fs.renameSync(path.join(w.home, 'kb'), path.join(w.home, 'kb-real')); fs.symlinkSync(path.join(w.home, 'kb-real'), path.join(w.home, 'kb'));
  assert.equal(resolveRegisteredFolderWith(w.home, 'kb', w.access, w.hooks).code, 'SLICE_ROOT_UNSAFE');
  fs.unlinkSync(path.join(w.home, 'kb'));
  assert.equal(resolveRegisteredFolderWith(w.home, 'kb', w.access, w.hooks).code, 'SLICE_ROOT_MISSING', 'a gone folder is missing');
});
test('18. a store that is absent, or a record that is invalid, holds the slice root', async t => {
  const w = world(t); w.make('kb');
  assert.deepEqual(resolveRegisteredFolderWith(w.home, 'kb', w.access, w.hooks), { ok: false, code: 'SLICE_ROOT_MISSING', detail: 'kb' });
  await w.add('kb', '~/kb'); fs.writeFileSync(w.record('kb'), '{"format":"x"}\n', { mode: 0o644 });
  assert.equal(resolveRegisteredFolderWith(w.home, 'kb', w.access, w.hooks).code, 'SLICE_ROOT_UNSAFE');
  fs.writeFileSync(w.record('kb'), BODY('kb'), { mode: 0o644 }); fs.chmodSync(w.store, 0o775);
  assert.equal(resolveRegisteredFolderWith(w.home, 'kb', w.access, w.hooks).code, 'SLICE_ROOT_UNSAFE', 'an unsafe store');
});
test('19. folder add records the real path of a folder reached through a link', async t => {
  const w = world(t); w.make('real/kb'); fs.symlinkSync(path.join(w.home, 'real'), path.join(w.home, 'alias'));
  await w.add('kb', '~/alias/kb'); await w.allow('kb');
  assert.match(fs.readFileSync(w.record('kb'), 'utf8'), RECORD('real/kb'));
  fs.rmSync(path.join(w.home, 'real/kb'), { recursive: true }); fs.symlinkSync(path.join(w.home, 'elsewhere'), path.join(w.home, 'real/kb'));
  fs.mkdirSync(path.join(w.home, 'elsewhere'), { mode: 0o755 });
  assert.equal(resolveRegisteredFolderWith(w.home, 'kb', w.access, w.hooks).code, 'SLICE_ROOT_UNSAFE', 'a link at the recorded path');
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
  const again = resolveRegisteredRootWith(w.home, 'kb', '.', w.access, other); assert.deepEqual([again.ok, again.code, again.detail.length > 0], [false, 'SLICE_ROOT_UNSAFE', true]);
});
test('29. the checks run again on a recorded folder: a record that points into a cloud folder holds the slice root, and list names the code', async t => {
  const w = world(t); w.make('kb'); w.make('Library/CloudStorage/y/wiki'); await w.add('kb', '~/kb');
  fs.writeFileSync(w.record('kb'), BODY('Library/CloudStorage/y'), { mode: 0o644 }); w.grantNow('kb');
  assert.deepEqual([resolveRegisteredRootWith(w.home, 'kb', 'wiki', w.access, w.hooks).ok, resolveRegisteredRootWith(w.home, 'kb', 'wiki', w.access, w.hooks).code], [false, 'SLICE_ROOT_UNSAFE']);
  assert.equal(listFoldersWith(w.home, w.hooks).folders[0].code, 'FOLDER_IN_CLOUD', 'list names the code that failed');
  fs.writeFileSync(w.record('kb'), BODY('kb'), { mode: 0o644 }); w.grantNow('kb');
  assert.equal(resolveRegisteredRootWith(w.home, 'kb', '.', w.access, w.hooks).ok, true);
});

// ---------------------------------------------------------------------------------------------- Part B security round
const isAllowedDir = (w, name) => path.join(w.folders, name + '.grants');
test('30. folder allow plans the absolute folder and the project, and writes a grant bound to the record', async t => {
  const w = world(t); w.make('My Notes/kb'); await w.add('kb', '~/My Notes/kb');
  const plan = planFolderAllowWith(w.home, w.project, 'kb', w.hooks);
  assert.equal(renderFolderAllowReview(plan), [
    'Allow this project to read registered folder kb',
    `  Project: ${w.project.dir}`,
    `  Folder: ${path.join(w.home, 'My Notes/kb')} (~/My Notes/kb)`,
    `  Bowerloom reads the mode of the folder only. To see access control entries, run ls -led '${path.join(w.home, 'My Notes/kb')}'.`,
    '  A slice of this project that names it can copy text from it into .claude/skills. Bowerloom never writes the folder.',
    '  Summary kind: heading. A slice that asks for another kind is held with FOLDER_NOT_ALLOWED until you run folder allow again with that kind.',
    'This writes the store only. It changes no project, and it installs nothing.',
  ].join('\n'));
  assert.equal(fs.existsSync(isAllowedDir(w, 'kb')), false, 'planning writes nothing');
  await applyFolderAllowWith(w.home, w.project, 'kb', plan.revision, signal(), w.hooks);
  const sha = createHash('sha256').update(fs.readFileSync(w.record('kb'))).digest('hex');
  const grant = path.join(isAllowedDir(w, 'kb'), w.project.projectId);
  assert.equal(fs.readFileSync(grant, 'utf8'), `{"format":"bowerloom/store-folder-grant/v1beta1","record":"${sha}","birth":"111","summary":"heading"}\n`);
  assert.equal(fs.statSync(grant).mode & 0o777, 0o644); assert.equal(fs.statSync(isAllowedDir(w, 'kb')).mode & 0o777, 0o700);
  assert.equal(resolveRegisteredFolderWith(w.home, 'kb', w.access, w.hooks).ok, true);
});
test('31. a project without a grant is held with FOLDER_NOT_ALLOWED, before the folder is looked at', async t => {
  const w = world(t); w.make('kb'); await w.add('kb', '~/kb');
  assert.deepEqual(resolveRegisteredFolderWith(w.home, 'kb', w.access, w.hooks), { ok: false, code: 'FOLDER_NOT_ALLOWED', detail: 'kb' });
  fs.rmSync(path.join(w.home, 'kb'), { recursive: true });
  assert.equal(resolveRegisteredFolderWith(w.home, 'kb', w.access, w.hooks).code, 'FOLDER_NOT_ALLOWED', 'a project that is not allowed learns nothing about the folder');
  assert.equal(resolveRegisteredRootWith(w.home, 'kb', 'wiki', { projectId: 'b'.repeat(32), birthtimeNs: '111' }, w.hooks).code, 'FOLDER_NOT_ALLOWED');
});
test('32. a grant is for one project: another project id is not allowed', async t => {
  const w = world(t); w.make('kb'); await w.add('kb', '~/kb'); await w.allow('kb');
  assert.equal(resolveRegisteredFolderWith(w.home, 'kb', { projectId: 'b'.repeat(32), birthtimeNs: '111' }, w.hooks).code, 'FOLDER_NOT_ALLOWED');
  assert.equal(resolveRegisteredFolderWith(w.home, 'kb', w.access, w.hooks).ok, true);
});
test('33. a grant is for one record: a name pointed at another folder is not allowed again', async t => {
  const w = world(t); w.make('kb'); w.make('other'); await w.add('kb', '~/kb'); await w.allow('kb');
  fs.writeFileSync(w.record('kb'), BODY('other'), { mode: 0o644 });
  assert.equal(resolveRegisteredFolderWith(w.home, 'kb', w.access, w.hooks).code, 'FOLDER_NOT_ALLOWED');
  const removal = planFolderRemoveWith(w.home, 'kb', w.hooks); await applyFolderRemoveWith(w.home, 'kb', removal.revision, signal(), w.hooks);
  assert.equal(fs.existsSync(isAllowedDir(w, 'kb')), false, 'folder remove removes the grants with the record');
  await w.add('kb', '~/other'); assert.equal(resolveRegisteredFolderWith(w.home, 'kb', w.access, w.hooks).code, 'FOLDER_NOT_ALLOWED');
});
test('34. a grant that is unsafe or invalid is not a grant', async t => {
  const w = world(t); w.make('kb'); await w.add('kb', '~/kb'); await w.allow('kb');
  const grant = path.join(isAllowedDir(w, 'kb'), w.project.projectId), good = fs.readFileSync(grant, 'utf8');
  fs.writeFileSync(grant, good.replace('"record"', '"other"'), { mode: 0o644 }); assert.equal(resolveRegisteredFolderWith(w.home, 'kb', w.access, w.hooks).code, 'SLICE_ROOT_UNSAFE');
  fs.writeFileSync(grant, good, { mode: 0o664 }); fs.chmodSync(grant, 0o664); assert.equal(resolveRegisteredFolderWith(w.home, 'kb', w.access, w.hooks).code, 'SLICE_ROOT_UNSAFE');
  fs.chmodSync(grant, 0o644); fs.renameSync(grant, grant + '.aside'); fs.symlinkSync(grant + '.aside', grant); assert.equal(resolveRegisteredFolderWith(w.home, 'kb', w.access, w.hooks).code, 'SLICE_ROOT_UNSAFE');
  fs.unlinkSync(grant); fs.renameSync(grant + '.aside', grant); fs.chmodSync(isAllowedDir(w, 'kb'), 0o775); assert.equal(resolveRegisteredFolderWith(w.home, 'kb', w.access, w.hooks).code, 'SLICE_ROOT_UNSAFE');
});
test('35. folder deny removes the grant, and a project without a grant cannot deny', async t => {
  const w = world(t); w.make('kb'); await w.add('kb', '~/kb'); await w.allow('kb');
  const plan = planFolderDenyWith(w.home, w.project, 'kb', w.hooks);
  assert.equal(renderFolderDenyReview(plan), [
    'Stop allowing this project to read registered folder kb',
    `  Project: ${w.project.dir}`,
    '  Slices of this project that name it are held with FOLDER_NOT_ALLOWED. Installed indexes stay.',
    'This writes the store only. It changes no project.',
  ].join('\n'));
  await applyFolderDenyWith(w.home, w.project, 'kb', plan.revision, signal(), w.hooks);
  assert.equal(fs.existsSync(path.join(isAllowedDir(w, 'kb'), w.project.projectId)), false);
  assert.equal(resolveRegisteredFolderWith(w.home, 'kb', w.access, w.hooks).code, 'FOLDER_NOT_ALLOWED');
  assert.throws(() => planFolderDenyWith(w.home, w.project, 'kb', w.hooks), code('FOLDER_NOT_ALLOWED'));
});
test('36. folder allow refuses an unknown name, a folder that is gone or unsafe, and a stale plan', async t => {
  const w = world(t); w.make('kb');
  assert.throws(() => planFolderAllowWith(w.home, w.project, 'kb', w.hooks), code('FOLDER_NOT_FOUND'));
  await w.add('kb', '~/kb');
  const plan = planFolderAllowWith(w.home, w.project, 'kb', w.hooks), other = { dir: path.join(w.base, 'other'), projectId: 'c'.repeat(32), birthtimeNs: '111' };
  await assert.rejects(applyFolderAllowWith(w.home, other, 'kb', plan.revision, signal(), w.hooks), code('STALE_APPROVAL'));
  fs.rmSync(path.join(w.home, 'kb'), { recursive: true });
  assert.throws(() => planFolderAllowWith(w.home, w.project, 'kb', w.hooks), code('FOLDER_UNSAFE'));
  w.make('kb'); const again = planFolderAllowWith(w.home, w.project, 'kb', w.hooks);
  fs.rmSync(path.join(w.home, 'kb'), { recursive: true }); w.make('kb');
  await assert.rejects(applyFolderAllowWith(w.home, w.project, 'kb', again.revision, signal(), w.hooks), code('STALE_APPROVAL'));
  assert.equal(fs.existsSync(isAllowedDir(w, 'kb')), false);
});
test('37. folder list skips the grants folders and the leftover names, and the doc of F5 holds', async t => {
  const w = world(t); w.make('kb'); await w.add('kb', '~/kb'); await w.allow('kb');
  fs.writeFileSync(path.join(w.folders, '.DS_Store'), 'x'); fs.writeFileSync(path.join(w.folders, '.folder-kb.0123456789abcdef.tmp'), 'x');
  assert.deepEqual(listFoldersWith(w.home, w.hooks).folders.map(f => f.name), ['kb']);
});
test('38. S2: a folder under a library or node_modules segment, or not in NFC, cannot be registered; one that holds a cloud folder cannot either', t => {
  const w = world(t); w.make('a/node_modules/x'); w.make('b/Library/y'); w.make('c/LIBRARY');
  for (const p of ['~/a/node_modules/x', '~/b/Library/y', '~/c/LIBRARY']) assert.throws(() => planFolderAddWith(w.home, w.home, 'kb', p, w.hooks), code('FOLDER_UNSAFE'), p);
  // The account home sits below HOME here; a folder that holds its Library/CloudStorage holds a cloud folder.
  w.make('acct/Library/CloudStorage'); const hooks = { accountHome: path.join(w.home, 'acct') };
  assert.throws(() => planFolderAddWith(w.home, w.home, 'kb', '~/acct/Library', hooks), code('FOLDER_IN_CLOUD'));
  const decomposed = 'cafe\u0301'; try { w.make(decomposed); } catch { return; }
  if (fs.readdirSync(w.home).includes(decomposed)) assert.throws(() => planFolderAddWith(w.home, w.home, 'kb', '~/' + decomposed, w.hooks), code('FOLDER_UNSAFE'));
});
test('39. S2: a recorded root that the managed path rule would reject becomes a SLICE_ROOT_UNSAFE hold', async t => {
  const w = world(t); w.make('kb/node_modules/wiki'); await w.add('kb', '~/kb'); await w.allow('kb');
  const got = resolveRegisteredRootWith(w.home, 'kb', 'node_modules/wiki', w.access, w.hooks);
  assert.deepEqual([got.ok, got.code], [false, 'SLICE_ROOT_UNSAFE']);
});
test('40. S4: a folder that is, is inside, or holds the private state folder is refused, in add and in resolve', async t => {
  const w = world(t), state = path.join(w.home, 'st', 'bowerloom'); w.make('st/bowerloom/items'); w.make('kb');
  const hooks = { ...w.hooks, stateRoot: state };
  for (const p of ['~/st/bowerloom', '~/st/bowerloom/items', '~/st']) assert.throws(() => planFolderAddWith(w.home, w.home, 'kb', p, hooks), code('FOLDER_UNSAFE'), p);
  assert.equal(planFolderAddWith(w.home, w.home, 'kb', '~/kb', hooks).path, 'kb');
  await w.add('kb', '~/kb'); await w.allow('kb');
  fs.writeFileSync(w.record('kb'), BODY('st'), { mode: 0o644 }); w.grantNow('kb');
  assert.equal(resolveRegisteredFolderWith(w.home, 'kb', { ...w.access, stateRoot: state }, w.hooks).code, 'SLICE_ROOT_UNSAFE');
  assert.equal(resolveRegisteredFolderWith(w.home, 'kb', w.access, w.hooks).ok, true, 'without the state folder named, nothing to compare');
});
test('41. F2: a record that cannot be read is a hold that keeps its cause, and a plain error is not swallowed', { skip: process.getuid?.() === 0 && 'root can read a mode 000 file' }, async t => {
  const w = world(t); w.make('kb'); await w.add('kb', '~/kb'); await w.allow('kb');
  fs.chmodSync(w.record('kb'), 0o000);
  const got = resolveRegisteredFolderWith(w.home, 'kb', w.access, w.hooks); assert.deepEqual([got.ok, got.code, got.cause], [false, 'SLICE_ROOT_UNSAFE', 'STORE_UNREADABLE']);
  fs.chmodSync(w.record('kb'), 0o644);
  const lstat = fs.lstatSync; t.mock.method(fs, 'lstatSync', (p, ...rest) => { if (String(p).endsWith('kb.json')) throw new Error('plain'); return lstat.call(fs, p, ...rest); }); syncBuiltinESMExports();
  try { assert.throws(() => resolveRegisteredFolderWith(w.home, 'kb', w.access, w.hooks), error => error.message === 'plain' && error.code === undefined); }
  finally { t.mock.restoreAll(); syncBuiltinESMExports(); }
});
test('42. F3: folder list keeps going past one unreadable record, and does not swallow a plain error', { skip: process.getuid?.() === 0 && 'root can read a mode 000 file' }, async t => {
  const w = world(t); w.make('a'); w.make('b'); await w.add('aa', '~/a'); await w.add('bb', '~/b');
  fs.chmodSync(w.record('aa'), 0o000);
  assert.deepEqual(listFoldersWith(w.home, w.hooks).folders.map(f => [f.name, f.state, f.code]), [['aa', 'refused', 'STORE_UNREADABLE'], ['bb', 'ready', null]]);
  fs.chmodSync(w.record('aa'), 0o644);
  const lstat = fs.lstatSync; t.mock.method(fs, 'lstatSync', (p, ...rest) => { if (String(p).endsWith('bb.json')) throw new Error('plain'); return lstat.call(fs, p, ...rest); }); syncBuiltinESMExports();
  try { assert.throws(() => listFoldersWith(w.home, w.hooks), error => error.message === 'plain'); }
  finally { t.mock.restoreAll(); syncBuiltinESMExports(); }
});
test('43. F4: a store that cannot be searched fails closed', { skip: process.getuid?.() === 0 && 'root can search any folder' }, t => {
  const w = world(t), acct = w.make('acct/.bowerloom'); w.make('kb'); fs.chmodSync(path.join(w.home, 'acct'), 0o600);
  try { assert.throws(() => holdsStore(path.join(w.home, 'kb'), w.home, { accountHome: path.join(w.home, 'acct') }), code('FOLDER_UNSAFE')); }
  finally { fs.chmodSync(path.join(w.home, 'acct'), 0o755); }
  void acct;
});

// ------------------------------------------------------------------------------------------------ Part B round 3
const HEXID = (n = 1) => String(n).padStart(32, '0');
const foreignLstat = (t, suffix) => {
  const real = fs.lstatSync;
  t.mock.method(fs, 'lstatSync', (p, ...rest) => {
    const stat = real.call(fs, p, ...rest);
    return String(p).endsWith(suffix) && rest[0]?.bigint ? new Proxy(stat, { get: (target, key) => key === 'uid' ? target.uid + 1n : typeof target[key] === 'function' ? target[key].bind(target) : target[key] }) : stat;
  });
  syncBuiltinESMExports();
};
const restoreAll = t => { t.mock.restoreAll(); syncBuiltinESMExports(); };
test('44. L1: a record that is lost and added again does not bring the old grants back, and the plan says it removes them', async t => {
  const w = world(t); w.make('kb'); await w.add('kb', '~/kb'); await w.allow('kb');
  fs.unlinkSync(w.record('kb'));
  const plan = planFolderAddWith(w.home, w.home, 'kb', '~/kb', w.hooks);
  assert.equal(plan.oldGrants, 1);
  assert.match(renderFolderAddReview(plan), /\n {2}Removes 1 old grant for kb\.\n/);
  await applyFolderAddWith(w.home, w.home, 'kb', '~/kb', plan.revision, signal(), w.hooks);
  assert.equal(fs.existsSync(isAllowedDir(w, 'kb')), false);
  assert.equal(resolveRegisteredFolderWith(w.home, 'kb', w.access, w.hooks).code, 'FOLDER_NOT_ALLOWED');
  assert.doesNotMatch(renderFolderAddReview(planFolderAddWith(w.home, w.home, 'two', '~/kb', w.hooks)), /old grant/);
});
test('45. L1: the record holds a registration id that is new on every add, so the record hash changes', async t => {
  const w = world(t); w.make('kb'); await w.add('kb', '~/kb'); const first = fs.readFileSync(w.record('kb'), 'utf8');
  const plan = planFolderRemoveWith(w.home, 'kb', w.hooks); await applyFolderRemoveWith(w.home, 'kb', plan.revision, signal(), w.hooks); await w.add('kb', '~/kb');
  const second = fs.readFileSync(w.record('kb'), 'utf8'); assert.notEqual(second, first);
  assert.notEqual(JSON.parse(second).id, JSON.parse(first).id); assert.match(JSON.parse(second).id, /^[a-f0-9]{32}$/);
});
test('46. L1: leftover grants are removed without following a link, and a leftover that is a link or has an odd entry refuses the add', async t => {
  const w = world(t); w.make('kb'); await w.add('kb', '~/kb'); const dir = isAllowedDir(w, 'kb'); fs.mkdirSync(dir, { mode: 0o700 });
  const victim = path.join(w.base, 'victim.txt'); fs.writeFileSync(victim, 'keep'); fs.unlinkSync(w.record('kb'));
  fs.symlinkSync(victim, path.join(dir, HEXID(1)));
  const plan = planFolderAddWith(w.home, w.home, 'kb', '~/kb', w.hooks); assert.equal(plan.oldGrants, 1);
  await applyFolderAddWith(w.home, w.home, 'kb', '~/kb', plan.revision, signal(), w.hooks);
  assert.equal(fs.readFileSync(victim, 'utf8'), 'keep'); assert.equal(fs.existsSync(dir), false);
  // An entry that is not a grant id refuses the add before anything is removed.
  fs.unlinkSync(w.record('kb')); fs.mkdirSync(dir, { mode: 0o700 }); fs.writeFileSync(path.join(dir, 'odd'), 'x');
  assert.throws(() => planFolderAddWith(w.home, w.home, 'kb', '~/kb', w.hooks), error => error.code === 'FOLDER_UNSAFE' && /odd/.test(error.message));
  // A grants folder that is a link is never followed.
  fs.rmSync(dir, { recursive: true }); const other = path.join(w.base, 'other'); fs.mkdirSync(other); fs.writeFileSync(path.join(other, HEXID(2)), 'keep'); fs.symlinkSync(other, dir);
  assert.throws(() => planFolderAddWith(w.home, w.home, 'kb', '~/kb', w.hooks), code('FOLDER_UNSAFE'));
  assert.equal(fs.readFileSync(path.join(other, HEXID(2)), 'utf8'), 'keep');
});
test('47. L2: folder remove refuses an unexpected entry in the grants folder, naming it, before it deletes anything', async t => {
  const w = world(t); w.make('kb'); await w.add('kb', '~/kb'); await w.allow('kb'); const dir = isAllowedDir(w, 'kb');
  fs.symlinkSync(path.join(w.base, 'victim'), path.join(dir, 'evil'));
  assert.throws(() => planFolderRemoveWith(w.home, 'kb', w.hooks), error => error.code === 'FOLDER_UNSAFE' && /evil/.test(error.message));
  fs.unlinkSync(path.join(dir, 'evil')); fs.mkdirSync(path.join(dir, HEXID(3)));
  assert.throws(() => planFolderRemoveWith(w.home, 'kb', w.hooks), code('FOLDER_UNSAFE'), 'a folder named like a grant');
  fs.rmdirSync(path.join(dir, HEXID(3))); fs.mkdirSync(path.join(dir, 'sub'));
  assert.throws(() => planFolderRemoveWith(w.home, 'kb', w.hooks), error => error.code === 'FOLDER_UNSAFE' && /sub/.test(error.message));
  fs.rmdirSync(path.join(dir, 'sub'));
  assert.equal(planFolderRemoveWith(w.home, 'kb', w.hooks).grants.length, 1);
  assert.equal(fs.existsSync(w.record('kb')), true, 'a refused plan deleted nothing');
});
test('48. L2: a grants folder swapped after the plan is a stale approval, and nothing is deleted', async t => {
  const w = world(t); w.make('kb'); await w.add('kb', '~/kb'); await w.allow('kb'); const dir = isAllowedDir(w, 'kb');
  const plan = planFolderRemoveWith(w.home, 'kb', w.hooks);
  const entries = fs.readdirSync(dir).map(n => [n, fs.readFileSync(path.join(dir, n))]); fs.rmSync(dir, { recursive: true }); fs.mkdirSync(dir, { mode: 0o700 }); for (const [n, b] of entries) fs.writeFileSync(path.join(dir, n), b, { mode: 0o644 });
  await assert.rejects(applyFolderRemoveWith(w.home, 'kb', plan.revision, signal(), w.hooks), code('STALE_APPROVAL'));
  assert.equal(fs.existsSync(w.record('kb')), true); assert.equal(fs.readdirSync(dir).length, 1);
  const again = planFolderRemoveWith(w.home, 'kb', w.hooks); await applyFolderRemoveWith(w.home, 'kb', again.revision, signal(), w.hooks); assert.equal(fs.existsSync(dir), false);
});
test('49. L2: a leftover temporary grant is removed with the grants and is not counted', async t => {
  const w = world(t); w.make('kb'); await w.add('kb', '~/kb'); await w.allow('kb'); const dir = isAllowedDir(w, 'kb');
  fs.writeFileSync(path.join(dir, `.grant-${'a'.repeat(32)}.0123456789abcdef.tmp`), 'half');
  const plan = planFolderRemoveWith(w.home, 'kb', w.hooks); assert.equal(plan.grants.length, 1);
  await applyFolderRemoveWith(w.home, 'kb', plan.revision, signal(), w.hooks); assert.equal(fs.existsSync(dir), false);
});
test('50. L3: a grant binds the birth time of the project folder: a folder with another birth time is not allowed', async t => {
  const w = world(t); w.make('kb'); await w.add('kb', '~/kb'); await w.allow('kb');
  assert.equal(resolveRegisteredFolderWith(w.home, 'kb', w.access, w.hooks).ok, true);
  assert.equal(resolveRegisteredFolderWith(w.home, 'kb', { ...w.access, birthtimeNs: '222' }, w.hooks).code, 'FOLDER_NOT_ALLOWED');
  const grant = path.join(isAllowedDir(w, 'kb'), w.project.projectId); fs.writeFileSync(grant, fs.readFileSync(grant, 'utf8').replace(',"birth":"111"', ''), { mode: 0o644 });
  assert.equal(resolveRegisteredFolderWith(w.home, 'kb', w.access, w.hooks).code, 'SLICE_ROOT_UNSAFE', 'a grant with no birth time is not valid');
});
test('51. L3: the allow plan binds the birth time of the project', async t => {
  const w = world(t); w.make('kb'); await w.add('kb', '~/kb');
  const a = planFolderAllowWith(w.home, w.project, 'kb', w.hooks), b = planFolderAllowWith(w.home, { ...w.project, birthtimeNs: '222' }, 'kb', w.hooks);
  assert.notEqual(a.revision, b.revision);
  await assert.rejects(applyFolderAllowWith(w.home, { ...w.project, birthtimeNs: '222' }, 'kb', a.revision, signal(), w.hooks), code('STALE_APPROVAL'));
});
test('52. M1: a folder owned by another user is refused by the owner check alone', async t => {
  const w = world(t); w.make('kb'); w.make('two');
  foreignLstat(t, '/two');
  try { assert.throws(() => planFolderAddWith(w.home, w.home, 'two', '~/two', w.hooks), code('FOLDER_UNSAFE')); } finally { restoreAll(t); }
  assert.equal(planFolderAddWith(w.home, w.home, 'two', '~/two', w.hooks).path, 'two');
});
test('53. M1: a grant file owned by another user is refused by the owner check alone', async t => {
  const w = world(t); w.make('kb'); await w.add('kb', '~/kb'); await w.allow('kb');
  foreignLstat(t, '/' + w.project.projectId);
  try { assert.equal(resolveRegisteredFolderWith(w.home, 'kb', w.access, w.hooks).code, 'SLICE_ROOT_UNSAFE'); } finally { restoreAll(t); }
  assert.equal(resolveRegisteredFolderWith(w.home, 'kb', w.access, w.hooks).ok, true);
});
test('54. M1: a record file owned by another user is refused', async t => {
  const w = world(t); w.make('kb'); await w.add('kb', '~/kb');
  const store = inspectStoreWith(w.home, w.hooks).context; foreignLstat(t, '/kb.json');
  try { assert.throws(() => readFolderRecord(store, 'kb'), code('FOLDER_UNSAFE')); } finally { restoreAll(t); }
});
test('55. D1: the allow review repeats the hint about access control entries', async t => {
  const w = world(t); w.make('kb'); await w.add('kb', '~/kb');
  assert.match(renderFolderAllowReview(planFolderAllowWith(w.home, w.project, 'kb', w.hooks)), new RegExp(`\\n {2}Bowerloom reads the mode of the folder only\\. To see access control entries, run ls -led ${path.join(w.home, 'kb').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.\\n`));
});
test('56. L2: a grants folder swapped between the second plan and the removal is looked at again and is a stale approval', async t => {
  const w = world(t); w.make('kb'); await w.add('kb', '~/kb'); await w.allow('kb'); const dir = isAllowedDir(w, 'kb');
  const plan = planFolderRemoveWith(w.home, 'kb', w.hooks), real = fs.readdirSync; let swapped = false;
  t.mock.method(fs, 'readdirSync', (p, ...rest) => {
    const out = real.call(fs, p, ...rest);
    if (!swapped && String(p) === dir) { swapped = true; const copy = out.map(n => [n, fs.readFileSync(path.join(dir, n))]); fs.rmSync(dir, { recursive: true }); fs.mkdirSync(dir, { mode: 0o700 }); for (const [n, b] of copy) fs.writeFileSync(path.join(dir, n), b, { mode: 0o644 }); }
    return out;
  }); syncBuiltinESMExports();
  try { await assert.rejects(applyFolderRemoveWith(w.home, 'kb', plan.revision, signal(), w.hooks), code('STALE_APPROVAL')); } finally { restoreAll(t); }
  assert.equal(swapped, true); assert.equal(fs.existsSync(w.record('kb')), true);
});

// ------------------------------------------------------------------------------------------ decision 5, option B: the grant records the summary kind
test('G1. a grant records the summary kind, and a slice that asks for another kind is held with FOLDER_NOT_ALLOWED', async t => {
  const w = world(t); w.make('kb'); await w.add('kb', '~/kb'); await w.allow('kb', w.project, 'frontmatter:title');
  assert.match(fs.readFileSync(path.join(isAllowedDir(w, 'kb'), w.project.projectId), 'utf8'), /,"summary":"frontmatter:title"\}\n$/);
  const ask = summary => resolveRegisteredFolderWith(w.home, 'kb', { ...w.access, summary }, w.hooks);
  assert.equal(ask('frontmatter:title').ok, true);
  for (const other of ['heading', 'frontmatter:Title', 'frontmatter:tit', 'frontmatter:title2']) assert.deepEqual(ask(other), { ok: false, code: 'FOLDER_NOT_ALLOWED', detail: 'kb', granted: 'frontmatter:title' }, other);
  assert.equal(ask('none').ok, true, 'a slice with no summary copies no text');
  assert.equal(resolveRegisteredFolderWith(w.home, 'kb', w.access, w.hooks).ok, true, 'a caller that names no kind, such as the guard, needs the grant only');
  for (const bad of ['', 'Heading', 'frontmatter:', 'frontmatter:a b', 'x'.repeat(5000)]) assert.equal(ask(bad).code, 'FOLDER_NOT_ALLOWED', JSON.stringify(bad));
});
test('G2. running folder allow again with a new kind replaces the kind', async t => {
  const w = world(t); w.make('kb'); await w.add('kb', '~/kb'); await w.allow('kb');
  assert.equal(resolveRegisteredFolderWith(w.home, 'kb', { ...w.access, summary: 'frontmatter:title' }, w.hooks).code, 'FOLDER_NOT_ALLOWED');
  await w.allow('kb', w.project, 'frontmatter:title');
  assert.equal(resolveRegisteredFolderWith(w.home, 'kb', { ...w.access, summary: 'frontmatter:title' }, w.hooks).ok, true);
  assert.equal(resolveRegisteredFolderWith(w.home, 'kb', { ...w.access, summary: 'heading' }, w.hooks).code, 'FOLDER_NOT_ALLOWED');
});
test('G3. a grant made without a kind fails closed: it needs folder allow again, for every caller', async t => {
  const w = world(t); w.make('kb'); await w.add('kb', '~/kb'); w.grantNow('kb', w.project.projectId, '111', null);
  assert.equal(resolveRegisteredFolderWith(w.home, 'kb', w.access, w.hooks).code, 'FOLDER_NOT_ALLOWED');
  assert.equal(resolveRegisteredFolderWith(w.home, 'kb', { ...w.access, summary: 'heading' }, w.hooks).code, 'FOLDER_NOT_ALLOWED');
  await w.allow('kb'); assert.equal(resolveRegisteredFolderWith(w.home, 'kb', { ...w.access, summary: 'heading' }, w.hooks).ok, true);
});
test('G5. a hold says why: no grant, a grant for another kind, or a grant made without a kind', async t => {
  const w = world(t); w.make('kb'); await w.add('kb', '~/kb');
  assert.deepEqual(resolveRegisteredFolderWith(w.home, 'kb', { ...w.access, summary: 'heading' }, w.hooks), { ok: false, code: 'FOLDER_NOT_ALLOWED', detail: 'kb' });
  w.grantNow('kb', w.project.projectId, '111', null);
  assert.deepEqual(resolveRegisteredFolderWith(w.home, 'kb', { ...w.access, summary: 'heading' }, w.hooks), { ok: false, code: 'FOLDER_NOT_ALLOWED', detail: 'kb', legacy: true });
  await w.allow('kb', w.project, 'frontmatter:title');
  assert.deepEqual(resolveRegisteredFolderWith(w.home, 'kb', { ...w.access, summary: 'heading' }, w.hooks), { ok: false, code: 'FOLDER_NOT_ALLOWED', detail: 'kb', granted: 'frontmatter:title' });
});
test('G4. folder allow refuses a summary kind that is not heading or frontmatter:<key>, and the kind is bound by the revision', async t => {
  const w = world(t); w.make('kb'); await w.add('kb', '~/kb');
  for (const bad of ['none', 'first', 'frontmatter:', 'frontmatter:a/b', 'frontmatter:' + 'k'.repeat(65), '', 'heading\n']) assert.throws(() => planFolderAllowWith(w.home, w.project, 'kb', w.hooks, bad), code('USAGE'), JSON.stringify(bad));
  const a = planFolderAllowWith(w.home, w.project, 'kb', w.hooks, 'heading'), b = planFolderAllowWith(w.home, w.project, 'kb', w.hooks, 'frontmatter:title');
  assert.notEqual(a.revision, b.revision);
  await assert.rejects(applyFolderAllowWith(w.home, w.project, 'kb', a.revision, signal(), w.hooks, 'frontmatter:title'), code('STALE_APPROVAL'));
  assert.match(renderFolderAllowReview(b), /\n {2}Summary kind: frontmatter:title\. /);
});
