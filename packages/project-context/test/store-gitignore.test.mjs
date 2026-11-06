// Beta.3 docs review, fix 3: the store keeps a .gitignore that leaves out the files of this machine, folders/ first, so
// `git add -A` in a store pushed to GitHub never publishes registered-folder records or grants. Every test makes its own
// home folder in a temporary folder; nothing here touches the real home.
import test from '../../../dist/tests/support/lock-slot-retry.js';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { syncBuiltinESMExports } from 'node:module';
import '../../../dist/tests/support/isolate-home.js';
import {
  applyFolderAddWith, applyFolderAllowWith, planFolderAddWith, planFolderAllowWith, renderFolderAddReview, renderFolderAllowReview,
} from '../../../dist/packages/project-context/src/registered-folders.js';
import { withStoreForWriteWith } from '../../../dist/packages/project-context/src/store.js';
import { takeStoreGitignoreFailure } from '../../../dist/packages/project-context/src/store-gitignore.js';
import { runWithApproval } from '../../../dist/apps/cli/src/confirm.js';

const code = expected => error => { if (error?.code !== expected) throw new Error(`expected ${expected}, got ${error?.code ?? error} ${error?.message ?? ''}`); return true; };
const signal = () => new AbortController().signal;
const OURS = [
  '# Bowerloom: files of this machine. Git leaves them out, so a pushed store does not publish them.',
  '/folders/',
  '.*.tmp',
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
  assert.equal(allowed.gitignore, 'ok'); assert.equal(renderFolderAllowReview(allowed).split('\n').filter(l => !l.includes('Warning:')).some(l => l.includes('.gitignore')), false, 'no store .gitignore line; the warning about .claude/skills may name .gitignore');
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
    // Review L4: the message names the file and says why.
    assert.throws(() => planFolderAddWith(w.home, w.home, 'kb', '~/notes/kb', w.hooks), e => e?.code === 'STORE_UNSAFE' && e.message.includes('~/.bowerloom/.gitignore is a link, or not a plain file that you own with one link and no write access for others'), label);
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

// --- Round 2 of the reviews of PR 100. ---
test('S2. the bytes a person wrote stay byte for byte, even when they are not UTF-8', async t => {
  const w = world(t); w.make('notes/kb');
  await withStoreForWriteWith(w.home, signal(), async () => {}, w.hooks);
  const theirs = Buffer.from([0x6e, 0x6f, 0x74, 0x65, 0xff, 0xfe, 0x0a, 0x2a, 0x2e, 0x6c, 0x6f, 0x67]);
  fs.writeFileSync(w.ignore, theirs, { mode: 0o644 });
  await w.add('kb', '~/notes/kb');
  const now = fs.readFileSync(w.ignore);
  assert.ok(now.subarray(0, theirs.length).equals(theirs)); assert.equal(now[theirs.length], 0x0a);
  assert.equal(now.subarray(theirs.length + 1).toString('utf8'), OURS);
});

test('S3. a line counts only as git reads it: exact, and not undone by a later ! line', async t => {
  const w = world(t); w.make('notes/kb'); w.make('notes/wiki');
  await withStoreForWriteWith(w.home, signal(), async () => {}, w.hooks);
  fs.writeFileSync(w.ignore, `${OURS.replace('/folders/\n', '  /folders/\n')}`, { mode: 0o644 });
  await w.add('kb', '~/notes/kb');
  assert.ok(w.read().endsWith('\n/folders/\n'), w.read());
  fs.writeFileSync(w.ignore, `${OURS}!/folders/\n`, { mode: 0o644 });
  await w.add('wiki', '~/notes/wiki');
  assert.ok(w.read().endsWith('!/folders/\n/folders/\n'), w.read());
});

test('S5. a .gitignore that would pass 65536 bytes is refused before any write, and the message names the file and the limit', async t => {
  const w = world(t); w.make('notes/kb');
  await withStoreForWriteWith(w.home, signal(), async () => {}, w.hooks);
  const big = `${'#'.repeat(79)}\n`.repeat(819);
  fs.writeFileSync(w.ignore, big, { mode: 0o644 });
  assert.throws(() => planFolderAddWith(w.home, w.home, 'kb', '~/notes/kb', w.hooks), e => e?.code === 'STORE_UNSAFE' && e.message.includes('~/.bowerloom/.gitignore') && e.message.includes('65536 bytes'));
  assert.equal(w.read(), big);
});

test('H1. every store write adds the missing lines, not only a create, folder add, or folder allow', async t => {
  const w = world(t);
  await withStoreForWriteWith(w.home, signal(), async () => {}, w.hooks);
  fs.unlinkSync(w.ignore);
  await withStoreForWriteWith(w.home, signal(), async () => {}, w.hooks);
  assert.equal(w.read(), OURS);
  // A write that refuses leaves the file as it was.
  fs.unlinkSync(w.ignore);
  await assert.rejects(withStoreForWriteWith(w.home, signal(), async () => { throw new Error('refused'); }, w.hooks), /refused/);
  assert.equal(fs.existsSync(w.ignore), false);
});

test('M3. a .gitignore write that fails when the store is made does not fail the command; the result says so', async t => {
  const w = world(t), open = fs.openSync;
  fs.openSync = (file, ...rest) => { if (/\.gitignore\.[a-f0-9]{16}\.tmp$/.test(String(file))) throw Object.assign(new Error('no space'), { code: 'ENOSPC' }); return open(file, ...rest); };
  syncBuiltinESMExports();
  let output;
  try {
    const change = { plan: async () => ({ revision: 'a'.repeat(64) }), revision: p => p.revision, review: () => 'Make the store.', apply: async () => withStoreForWriteWith(w.home, signal(), async (_s, _h, created) => ({ created }), w.hooks) };
    output = await runWithApproval(change, { approve: 'a'.repeat(64), json: false }, { ask: async () => 'n' });
  } finally { fs.openSync = open; syncBuiltinESMExports(); }
  assert.equal(output.exitCode, 0);
  assert.match(output.output, /^Applied plan a{64}\.\nNote: the store was written, but ~\/\.bowerloom\/\.gitignore was not \(STORE_WRITE_FAILED\)\. Run bowerloom store status\.\n$/);
  assert.ok(fs.existsSync(path.join(w.store, 'store.json'))); assert.equal(fs.existsSync(w.ignore), false);
  assert.equal(takeStoreGitignoreFailure(), null, 'the note is given once');
});

test('L2 (round 3). a later ! line that could match the folder undoes /folders/; one that cannot does not', async t => {
  const w = world(t); w.make('notes/kb'); w.make('notes/wiki');
  await withStoreForWriteWith(w.home, signal(), async () => {}, w.hooks);
  for (const [negation, undoes] of [['!*/', true], ['!*', true], ['!**', true], ['!fold*', true], ['!/folders', true], ['!**/folders/', true], ['!skills/a.md', false], ['!notes', false], ['!/skills/', false]]) {
    fs.writeFileSync(w.ignore, `${OURS}${negation}\n`, { mode: 0o644 });
    assert.equal(planFolderAddWith(w.home, w.home, 'kb', '~/notes/kb', w.hooks).gitignore, undoes ? 'update' : 'ok', negation);
  }
});
