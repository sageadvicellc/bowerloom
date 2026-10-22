// Fix 3 of the beta.3 docs review, through the real binary: the store keeps a .gitignore, so `git add -A` in a store leaves
// folders/ out, and store status warns when the git index of the store already tracks something under folders/. The git
// repository is a local fixture made with the git helper of the tests; nothing touches the network.
import './support/isolate-home.js';
import test from './support/lock-slot-retry.js';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { world, run, mustApprove, git } from './support/config-cli.js';

const WARNING = '  Warning: folders/ is tracked by git; run git rm -r --cached folders and commit';
const status = (w: ReturnType<typeof world>) => {
  const text = run(w.home, ['store', 'status'], w.env), json = run(w.home, ['store', 'status', '--json'], w.env);
  assert.equal(text.status, 0, text.stderr); assert.equal(json.status, 0, json.stderr);
  return { text: text.stdout, tracked: (JSON.parse(json.stdout) as { git: { foldersTracked: boolean | null } }).git.foldersTracked };
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
