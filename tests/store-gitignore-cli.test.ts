// Fix 3 of the beta.3 docs review, through the real binary: the store keeps a .gitignore, so `git add -A` in a store leaves
// folders/ out, and store status warns when the git index of the store already tracks something under folders/. The git
// repository is a local fixture made with the git helper of the tests; nothing touches the network.
import './support/isolate-home.js';
import test from './support/lock-slot-retry.js';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { world, run, mustApprove, git, gitRaw, shell } from './support/config-cli.js';

const WARNING = '  Warning: folders/ is tracked by git. In ~/.bowerloom, run git rm -r --cached folders and commit. Records already pushed stay in git history.';
const UNREADABLE = "  Warning: Bowerloom could not read the store's git index, so it cannot tell whether folders/ is tracked. Run git -C ~/.bowerloom ls-files folders.";
const OUTER = '  Warning: ~/.bowerloom is inside another git repository, so Bowerloom cannot tell whether folders/ is tracked. Run git -C ~/.bowerloom ls-files folders.';
const MISSING = "  Warning: ~/.bowerloom/.gitignore misses lines that keep this machine's files, folders/ among them, out of git.";
const status = (w: ReturnType<typeof world>) => {
  const text = run(w.home, ['store', 'status'], w.env), json = run(w.home, ['store', 'status', '--json'], w.env);
  assert.equal(text.status, 0, text.stderr); assert.equal(json.status, 0, json.stderr);
  const g = (JSON.parse(json.stdout) as { git: { foldersTracked: boolean | null; foldersCheck: string; gitignore: string } }).git;
  return { text: text.stdout, tracked: g.foldersTracked, check: g.foldersCheck, gitignore: g.gitignore };
};

test('fix 3: folder add makes the store with its .gitignore; git add -A leaves folders/ out; status warns when the index tracks it', t => {
  const w = world(t); mkdirSync(join(w.home, 'notes', 'kb'), { recursive: true, mode: 0o755 });
  const planned = run(w.home, ['folder', 'add', 'kb', '~/notes/kb'], w.env);
  assert.equal(planned.status, 3, planned.stderr);
  mustApprove(w.home, ['folder', 'add', 'kb', '~/notes/kb'], w.env);
  assert.match(planned.stdout, /Create the store at ~\/\.bowerloom \(store\.json, and a \.gitignore that leaves out the files of this machine\)\. It holds definitions only\./);
  assert.match(readFileSync(join(w.store, '.gitignore'), 'utf8'), /^\/folders\/$/m);
  git(w.store, ['init', '-q'], w); git(w.store, ['add', '-A'], w);
  const listed = git(w.store, ['ls-files'], w).stdout.split('\n').filter(Boolean);
  assert.deepEqual(listed.sort(), ['.gitignore', 'store.json']);
  let s = status(w); assert.doesNotMatch(s.text, /Warning: folders/); assert.equal(s.tracked, false);
  // A person forces the records in, or committed them before this release.
  git(w.store, ['add', '-f', 'folders'], w);
  s = status(w); assert.ok(s.text.split('\n').includes(WARNING), s.text); assert.equal(s.tracked, true);
  // Index version 3 (extended flags) and version 4 (compressed paths) are read too.
  git(w.store, ['update-index', '--skip-worktree', 'store.json'], w);
  assert.equal(status(w).tracked, true);
  git(w.store, ['update-index', '--index-version', '4'], w);
  assert.equal(status(w).tracked, true);
  // The command the warning names takes it away.
  git(w.store, ['rm', '-r', '-q', '--cached', 'folders'], w);
  s = status(w); assert.doesNotMatch(s.text, /Warning: folders/); assert.equal(s.tracked, false);
});

// --- Round 2 of the reviews of PR 100. ---
function storeWithFolder(t: Parameters<typeof world>[0]) {
  const w = world(t); mkdirSync(join(w.home, 'notes', 'kb'), { recursive: true, mode: 0o755 });
  mustApprove(w.home, ['folder', 'add', 'kb', '~/notes/kb'], w.env);
  return w;
}
const ignored = (w: ReturnType<typeof world>, path: string): boolean => gitRaw(w.store, ['check-ignore', '-q', '--no-index', path], w).status === 0;

test('H1. a store with no .gitignore (as beta.2 made it): status warns, and its printed steps never track folders/', t => {
  const w = storeWithFolder(t); unlinkSync(join(w.store, '.gitignore'));
  const s = status(w);
  assert.equal(s.gitignore, 'create'); assert.ok(s.text.split('\n').includes(MISSING), s.text);
  const lines = s.text.split('\n'), start = lines.indexOf('  To fix this, run these commands yourself:');
  assert.ok(start > 0, s.text);
  const steps = lines.slice(start + 1).filter(l => l.startsWith('    ')).map(l => l.trim());
  const write = steps.findIndex(c => c.startsWith('printf ')), add = steps.indexOf('git add -A');
  assert.ok(write > 0 && write < add, steps.join('\n'));
  for (const command of steps) if (!command.startsWith('cd ') && !command.startsWith('git remote') && !command.startsWith('git push')) shell(w.store, command, w);
  assert.deepEqual(git(w.store, ['ls-files'], w).stdout.split('\n').filter(Boolean).sort(), ['.gitignore', 'store.json']);
  assert.equal(status(w).gitignore, 'ok');
  // A .gitignore that is a link: status says it cannot check it.
  unlinkSync(join(w.store, '.gitignore')); writeFileSync(join(w.base, 'theirs'), '/folders/\n'); shell(w.store, `ln -s ${JSON.stringify(join(w.base, 'theirs'))} .gitignore`, w);
  const linked = status(w); assert.equal(linked.gitignore, 'unsafe'); assert.match(linked.text, /Warning: ~\/\.bowerloom\/\.gitignore is a link, or not a plain file that you own/);
});

test('S3 and S4. git reads the lines as Bowerloom wrote them: an indented line and a later ! line are fixed; item files ending .tmp stay', t => {
  const w = world(t); mkdirSync(join(w.home, 'notes', 'kb'), { recursive: true, mode: 0o755 }); mkdirSync(join(w.home, 'notes', 'wiki'), { recursive: true, mode: 0o755 });
  mustApprove(w.home, ['skill', 'create', 'house', '--global'], w.env);
  git(w.store, ['init', '-q'], w);
  writeFileSync(join(w.store, '.gitignore'), '  /folders/\n');
  mustApprove(w.home, ['folder', 'add', 'kb', '~/notes/kb'], w.env);
  assert.equal(ignored(w, 'folders/kb.json'), true);
  writeFileSync(join(w.store, '.gitignore'), `${readFileSync(join(w.store, '.gitignore'), 'utf8')}!/folders/\n`);
  mustApprove(w.home, ['folder', 'add', 'wiki', '~/notes/wiki'], w.env);
  assert.equal(ignored(w, 'folders/wiki.json'), true);
  assert.equal(ignored(w, 'skills/house/LICENSE.tmp'), false); assert.equal(ignored(w, 'skills/house/NOTICE-x.tmp'), false);
  assert.equal(ignored(w, '.store.json.0123456789abcdef.tmp'), true); assert.equal(ignored(w, 'folders/.folder-kb.0123456789abcdef.tmp'), true);
});

test('M4, M5, L1 and C4. an index Bowerloom cannot read, a split index, a store inside another repository, and a sha256 index', t => {
  const w = storeWithFolder(t);
  // No repository at all: checked, nothing tracked.
  let s = status(w); assert.equal(s.check, 'no-repository'); assert.equal(s.tracked, false);
  git(w.store, ['init', '-q'], w); git(w.store, ['add', '-f', 'folders'], w);
  s = status(w); assert.equal(s.check, 'checked'); assert.equal(s.tracked, true);
  // A split index keeps entries in a shared file: unknown, said in both outputs.
  git(w.store, ['update-index', '--split-index'], w);
  s = status(w); assert.equal(s.tracked, null); assert.equal(s.check, 'unreadable'); assert.ok(s.text.split('\n').includes(UNREADABLE), s.text); assert.doesNotMatch(s.text, /folders\/ is tracked by git/);
  // Bytes that are no index.
  writeFileSync(join(w.store, '.git', 'index'), 'DIRC\u0000\u0000\u0000\u0009 not an index');
  s = status(w); assert.equal(s.tracked, null); assert.ok(s.text.split('\n').includes(UNREADABLE));
  // A store with no repository of its own, inside a repository of the home folder.
  const outer = storeWithFolder(t); git(outer.home, ['init', '-q'], outer);
  s = status(outer); assert.equal(s.check, 'outer-repository'); assert.equal(s.tracked, null); assert.ok(s.text.split('\n').includes(OUTER), s.text);
  // A sha256 repository: its index is read with 32-byte object names.
  const wide = storeWithFolder(t); git(wide.store, ['init', '-q', '--object-format=sha256'], wide); git(wide.store, ['add', '-f', 'folders'], wide);
  s = status(wide); assert.equal(s.tracked, true); assert.equal(s.check, 'checked');
});
