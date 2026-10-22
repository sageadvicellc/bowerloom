// Spec 06, section 3.9: a project is shared when bowerloom.lock.json exists, or when it sits in a git work tree whose
// config has [remote "origin"] with a url. Detection reads files only and starts no process.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import '../../../dist/tests/support/isolate-home.js';
import { isSharedProject } from '../../../dist/packages/project-config/src/shared.js';
import { discoverProject } from '../../../dist/packages/project-context/src/index.js';

const HOME = process.env.HOME;
const CONFIG = '[core]\n\trepositoryformatversion = 0\n[remote "origin"]\n\turl = https://github.com/sageadvicellc/app.git\n\tfetch = +refs/heads/*:refs/remotes/origin/*\n';
function folder(t, name = 'shared-') {
  const dir = fs.mkdtempSync(path.join(HOME, name)); fs.chmodSync(dir, 0o700);
  t.after(() => { try { fs.chmodSync(path.join(dir, 'repo', '.git', 'config'), 0o644); } catch { /* gone */ } fs.rmSync(dir, { recursive: true, force: true }); });
  return dir;
}
/** A project folder with a bowerloom.json at `dir`. */
function projectAt(dir) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(dir, 'bowerloom.json'), JSON.stringify({ format: 'bowerloom/project/v1beta1', harnesses: ['claude', 'codex'], skills: [], prompts: [], teams: [] }), { mode: 0o644 });
  return discoverProject(dir, HOME);
}
function gitFolder(repo, config = CONFIG) {
  fs.mkdirSync(path.join(repo, '.git'), { recursive: true, mode: 0o755 });
  fs.writeFileSync(path.join(repo, '.git', 'config'), config, { mode: 0o644 });
  fs.writeFileSync(path.join(repo, '.git', 'HEAD'), 'ref: refs/heads/main\n', { mode: 0o644 });
}
const NOT = { shared: false, reason: null };

test('1. a lock file makes the project shared, with reason lock', t => {
  const dir = folder(t), project = projectAt(path.join(dir, 'app'));
  assert.deepEqual(isSharedProject(project), NOT);
  fs.writeFileSync(path.join(project.dir, 'bowerloom.lock.json'), '{}\n', { mode: 0o644 });
  assert.deepEqual(isSharedProject(project), { shared: true, reason: 'lock' });
});

test('2. a .git/config with [remote "origin"] and a url makes the project shared, from the work tree root and from a sub folder', t => {
  const dir = folder(t), repo = path.join(dir, 'repo'); gitFolder(repo);
  assert.deepEqual(isSharedProject(projectAt(repo)), { shared: true, reason: 'origin' });
  assert.deepEqual(isSharedProject(projectAt(path.join(repo, 'packages', 'web'))), { shared: true, reason: 'origin' });
});

test('3 and 4. only [remote "upstream"], or origin with no url, is not shared', t => {
  const dir = folder(t), repo = path.join(dir, 'repo');
  gitFolder(repo, '[remote "upstream"]\n\turl = https://github.com/o/r.git\n');
  assert.deepEqual(isSharedProject(projectAt(repo)), NOT);
  gitFolder(repo, '[remote "origin"]\n\tfetch = +refs/heads/*:refs/remotes/origin/*\n[branch "main"]\n\turl = https://github.com/o/r.git\n');
  assert.deepEqual(isSharedProject(projectAt(repo)), NOT);
  gitFolder(repo, '[remote "origin"]\n\turl =\n');
  assert.deepEqual(isSharedProject(projectAt(repo)), NOT);
  gitFolder(repo, '[remote "Origin"]\n\turl = https://github.com/o/r.git\n');
  assert.deepEqual(isSharedProject(projectAt(repo)), NOT, 'the remote name is matched exactly');
});

test('5. a .git file with gitdir is followed only to a real folder owned by the user', t => {
  const dir = folder(t), real = path.join(dir, 'gitdirs', 'app'); gitFolder(path.join(dir, 'gitdirs'));
  fs.renameSync(path.join(dir, 'gitdirs', '.git'), real);
  const repo = path.join(dir, 'repo'); fs.mkdirSync(repo, { mode: 0o700 });
  fs.writeFileSync(path.join(repo, '.git'), `gitdir: ${real}\n`, { mode: 0o644 });
  const project = projectAt(repo);
  assert.deepEqual(isSharedProject(project), { shared: true, reason: 'origin' });
  // A relative gitdir resolves against the folder of the file.
  fs.writeFileSync(path.join(repo, '.git'), 'gitdir: ../gitdirs/app\n', { mode: 0o644 });
  assert.deepEqual(isSharedProject(project), { shared: true, reason: 'origin' });
  // A link, a missing folder, a file, or a first line that is not gitdir: are ignored.
  fs.symlinkSync(real, path.join(dir, 'linked'));
  for (const line of [`gitdir: ${path.join(dir, 'linked')}\n`, `gitdir: ${path.join(dir, 'missing')}\n`, `gitdir: ${path.join(real, 'config')}\n`, `worktree: ${real}\n`, '']) {
    fs.writeFileSync(path.join(repo, '.git'), line, { mode: 0o644 });
    assert.deepEqual(isSharedProject(project), NOT, line);
  }
  // A .git file over 4096 bytes is not read.
  fs.writeFileSync(path.join(repo, '.git'), `gitdir: ${real}\n${'#'.repeat(4096)}`, { mode: 0o644 });
  assert.deepEqual(isSharedProject(project), NOT);
});

test('5a. a worktree (a .git file plus a commondir file) reads the config of the common folder', t => {
  const dir = folder(t), main = path.join(dir, 'main'); gitFolder(main);
  const admin = path.join(main, '.git', 'worktrees', 'feature'); fs.mkdirSync(admin, { recursive: true, mode: 0o755 });
  fs.writeFileSync(path.join(admin, 'commondir'), '../..\n', { mode: 0o644 });
  const tree = path.join(dir, 'feature'); fs.mkdirSync(tree, { mode: 0o700 });
  fs.writeFileSync(path.join(tree, '.git'), `gitdir: ${admin}\n`, { mode: 0o644 });
  assert.deepEqual(isSharedProject(projectAt(tree)), { shared: true, reason: 'origin' });
  // Without commondir the admin folder holds no config: not shared.
  fs.rmSync(path.join(admin, 'commondir'));
  assert.deepEqual(isSharedProject(projectAt(tree)), NOT);
});

test('5b and 6. a .git in the home folder is ignored, and the search stops at home', t => {
  gitFolder(HOME); t.after(() => fs.rmSync(path.join(HOME, '.git'), { recursive: true, force: true }));
  const dir = folder(t);
  assert.deepEqual(isSharedProject(projectAt(path.join(dir, 'app'))), NOT);
});

test('5c. a config that is a FIFO is not shared, does not block, and does not throw', t => {
  const dir = folder(t), repo = path.join(dir, 'repo'); fs.mkdirSync(path.join(repo, '.git'), { recursive: true, mode: 0o755 });
  execFileSync('mkfifo', [path.join(repo, '.git', 'config')]);
  assert.deepEqual(isSharedProject(projectAt(repo)), NOT);
});

test('5d. a header such as [REMOTE "origin"] and a key such as URL = x match', t => {
  const dir = folder(t), repo = path.join(dir, 'repo'); gitFolder(repo, '[REMOTE "origin"]\n    URL = x\n');
  assert.deepEqual(isSharedProject(projectAt(repo)), { shared: true, reason: 'origin' });
  gitFolder(repo, '  [remote   "origin"]  \n\tUrl=git@github.com:o/r.git\n');
  assert.deepEqual(isSharedProject(projectAt(repo)), { shared: true, reason: 'origin' });
});

test('7. an unreadable config is not shared and does not throw', t => {
  const dir = folder(t), repo = path.join(dir, 'repo'); gitFolder(repo);
  fs.chmodSync(path.join(repo, '.git', 'config'), 0o000);
  assert.deepEqual(isSharedProject(projectAt(repo)), NOT);
  // A group-writable config is still read: the rule asks only for a regular file the user owns. A .git folder that is a link is not used.
  fs.chmodSync(path.join(repo, '.git', 'config'), 0o664);
  assert.deepEqual(isSharedProject(projectAt(repo)), { shared: true, reason: 'origin' });
  fs.chmodSync(path.join(repo, '.git', 'config'), 0o644);
  fs.renameSync(path.join(repo, '.git'), path.join(dir, 'moved-git')); fs.symlinkSync(path.join(dir, 'moved-git'), path.join(repo, '.git'));
  assert.deepEqual(isSharedProject(projectAt(repo)), NOT);
});

test('8. a config over 65536 bytes is not shared and does not throw', t => {
  const dir = folder(t), repo = path.join(dir, 'repo'); gitFolder(repo, CONFIG + `# ${'x'.repeat(65536)}\n`);
  assert.deepEqual(isSharedProject(projectAt(repo)), NOT);
});
