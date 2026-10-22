// Beta.3 docs review, fix 3: the store keeps a .gitignore that leaves out the files of this machine, folders/ first, so
// `git add -A` in a store pushed to GitHub never publishes registered-folder records or grants. Every test makes its own
// home folder in a temporary folder; nothing here touches the real home.
import test from '../../../dist/tests/support/lock-slot-retry.js';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import '../../../dist/tests/support/isolate-home.js';
import {
  applyFolderAddWith, applyFolderAllowWith, planFolderAddWith, planFolderAllowWith, renderFolderAddReview, renderFolderAllowReview,
} from '../../../dist/packages/project-context/src/registered-folders.js';
import { withStoreForWriteWith } from '../../../dist/packages/project-context/src/store.js';

const code = expected => error => { if (error?.code !== expected) throw new Error(`expected ${expected}, got ${error?.code ?? error} ${error?.message ?? ''}`); return true; };
const signal = () => new AbortController().signal;
const OURS = [
  '# Bowerloom: files of this machine. Git leaves them out, so a pushed store does not publish them.',
  '/folders/',
  '*.tmp',
  '/authoring/pending.json',
  '/authoring/.stage-*/',
  '/authoring/.tmp-*',
  '.DS_Store',
].join('\n') + '\n';
const CREATE_LINE = 'Create the store at ~/.bowerloom (store.json, and a .gitignore that leaves out the files of this machine). It holds definitions only.';
const UPDATE_LINE = 'Add lines to ~/.bowerloom/.gitignore, so git leaves out folders/ and the other files of this machine.';
const WRITE_LINE = 'Write ~/.bowerloom/.gitignore, so git leaves out folders/ and the other files of this machine.';

function world(t) {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'bowerloom-gitignore-')));
  t.after(() => { try { fs.chmodSync(path.join(base, 'home'), 0o700); } catch { /* gone */ } fs.rmSync(base, { recursive: true, force: true }); });
  const home = path.join(base, 'home'); fs.mkdirSync(home, { mode: 0o700 });
  const hooks = { accountHome: path.join(base, 'nobody') }, store = path.join(home, '.bowerloom'), ignore = path.join(home, '.bowerloom', '.gitignore');
  const make = rel => { const dir = path.join(home, rel); fs.mkdirSync(dir, { recursive: true, mode: 0o755 }); return dir; };
  const add = async (name, target) => { const plan = planFolderAddWith(home, home, name, target, hooks); await applyFolderAddWith(home, home, name, target, plan.revision, signal(), hooks); return plan; };
  const project = { dir: path.join(base, 'project'), projectId: 'a'.repeat(32), birthtimeNs: '111' };
  const allow = async name => { const plan = planFolderAllowWith(home, project, name, hooks); await applyFolderAllowWith(home, project, name, plan.revision, signal(), hooks); return plan; };
  return { base, home, hooks, store, ignore, make, add, allow, project, read: () => fs.readFileSync(ignore, 'utf8') };
}

test('fix 3. the store is made with a private .gitignore that leaves out folders/; the plan names it', async t => {
  const w = world(t); w.make('notes/kb');
  const plan = planFolderAddWith(w.home, w.home, 'kb', '~/notes/kb', w.hooks);
  assert.equal(plan.gitignore, 'create');
  const lines = renderFolderAddReview(plan).split('\n');
  assert.equal(lines[0], CREATE_LINE); assert.equal(lines.includes(WRITE_LINE), false);
  await applyFolderAddWith(w.home, w.home, 'kb', '~/notes/kb', plan.revision, signal(), w.hooks);
  assert.equal(w.read(), OURS);
  const s = fs.lstatSync(w.ignore);
  assert.ok(s.isFile()); assert.equal(s.mode & 0o777, 0o644); assert.equal(s.nlink, 1);
  // Any write that makes the store makes the file, not only folder add.
  const other = world(t);
  await withStoreForWriteWith(other.home, signal(), async () => {}, other.hooks);
  assert.equal(other.read(), OURS);
});

test('fix 3. folder add and folder allow keep the file as it is when it holds every line', async t => {
  const w = world(t); w.make('notes/kb'); w.make('notes/wiki');
  await w.add('kb', '~/notes/kb');
  const before = fs.lstatSync(w.ignore, { bigint: true });
  const second = await w.add('wiki', '~/notes/wiki');
  assert.equal(second.gitignore, 'ok');
  assert.equal(renderFolderAddReview(second).split('\n').some(l => l.includes('.gitignore')), false);
  const allowed = await w.allow('kb');
  assert.equal(allowed.gitignore, 'ok'); assert.equal(renderFolderAllowReview(allowed).includes('.gitignore'), false);
  assert.equal(w.read(), OURS);
  const after = fs.lstatSync(w.ignore, { bigint: true });
  assert.equal(after.ino, before.ino); assert.equal(after.mtimeNs, before.mtimeNs);
});

test("fix 3. a person's own lines stay; only the missing lines of Bowerloom are added, once", async t => {
  const w = world(t); w.make('notes/kb');
  await withStoreForWriteWith(w.home, signal(), async () => {}, w.hooks);
  fs.writeFileSync(w.ignore, 'node_modules/\n# mine\n/folders/\n*.log', { mode: 0o644 });
  const plan = await w.add('kb', '~/notes/kb');
  assert.equal(plan.gitignore, 'update'); assert.ok(renderFolderAddReview(plan).split('\n').includes(UPDATE_LINE));
  const missing = OURS.split('\n').filter(l => l !== '/folders/').join('\n');
  assert.equal(w.read(), `node_modules/\n# mine\n/folders/\n*.log\n${missing}`);
  // A second write adds nothing.
  w.make('notes/wiki'); await w.add('wiki', '~/notes/wiki');
  assert.equal(w.read(), `node_modules/\n# mine\n/folders/\n*.log\n${missing}`);
});

test('fix 3. folder allow writes a missing .gitignore and names it in the plan', async t => {
  const w = world(t); w.make('notes/kb'); await w.add('kb', '~/notes/kb');
  fs.unlinkSync(w.ignore);
  const plan = planFolderAllowWith(w.home, w.project, 'kb', w.hooks);
  assert.equal(plan.gitignore, 'create'); assert.ok(renderFolderAllowReview(plan).split('\n').includes(WRITE_LINE));
  await applyFolderAllowWith(w.home, w.project, 'kb', plan.revision, signal(), w.hooks);
  assert.equal(w.read(), OURS);
});

test('fix 3. a .gitignore that is a link, shared, or not a plain file refuses STORE_UNSAFE and is left as it is', async t => {
  const w = world(t); w.make('notes/kb');
  await withStoreForWriteWith(w.home, signal(), async () => {}, w.hooks);
  const elsewhere = path.join(w.base, 'elsewhere'); fs.writeFileSync(elsewhere, 'theirs\n');
  const cases = [
    ['link', () => { fs.unlinkSync(w.ignore); fs.symlinkSync(elsewhere, w.ignore); }],
    ['group-writable', () => { fs.rmSync(w.ignore, { force: true }); fs.writeFileSync(w.ignore, 'mine\n'); fs.chmodSync(w.ignore, 0o664); }],
    ['two links', () => { fs.rmSync(w.ignore, { force: true }); fs.writeFileSync(w.ignore, 'mine\n', { mode: 0o644 }); fs.linkSync(w.ignore, path.join(w.base, 'second')); }],
    ['folder', () => { fs.rmSync(w.ignore, { force: true }); fs.rmSync(path.join(w.base, 'second'), { force: true }); fs.mkdirSync(w.ignore); }],
  ];
  for (const [label, arrange] of cases) {
    arrange();
    assert.throws(() => planFolderAddWith(w.home, w.home, 'kb', '~/notes/kb', w.hooks), code('STORE_UNSAFE'), label);
    assert.equal(fs.existsSync(path.join(w.store, 'folders', 'kb.json')), false, label);
  }
  assert.equal(fs.readFileSync(elsewhere, 'utf8'), 'theirs\n');
  // A link that appears between the plan and the approval refuses too, and the target is not written.
  fs.rmSync(w.ignore, { recursive: true, force: true });
  const plan = planFolderAddWith(w.home, w.home, 'kb', '~/notes/kb', w.hooks);
  fs.symlinkSync(elsewhere, w.ignore);
  await assert.rejects(applyFolderAddWith(w.home, w.home, 'kb', '~/notes/kb', plan.revision, signal(), w.hooks), e => e?.code === 'STORE_UNSAFE' || e?.code === 'STALE_APPROVAL');
  assert.equal(fs.readFileSync(elsewhere, 'utf8'), 'theirs\n');
  assert.equal(fs.existsSync(path.join(w.store, 'folders', 'kb.json')), false);
});

test('fix 3. a .gitignore edited after the plan refuses STALE_APPROVAL', async t => {
  const w = world(t); w.make('notes/kb');
  await withStoreForWriteWith(w.home, signal(), async () => {}, w.hooks);
  fs.writeFileSync(w.ignore, 'mine\n', { mode: 0o644 });
  const plan = planFolderAddWith(w.home, w.home, 'kb', '~/notes/kb', w.hooks);
  fs.writeFileSync(w.ignore, OURS);
  await assert.rejects(applyFolderAddWith(w.home, w.home, 'kb', '~/notes/kb', plan.revision, signal(), w.hooks), code('STALE_APPROVAL'));
});
