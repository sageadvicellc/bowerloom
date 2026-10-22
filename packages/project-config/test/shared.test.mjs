// Spec 06, section 3.9: a project is shared when bowerloom.lock.json exists, or when it sits in a git work tree whose
// config has [remote "origin"] with a url. Detection reads files only and starts no process.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
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

const UNKNOWN = what => ({ shared: true, reason: 'unknown', unknown: what });

test('5. a .git file is followed only when its gitdir is <x>/.git/worktrees/<name> and commondir names <x>/.git', t => {
  const dir = folder(t), main = path.join(dir, 'main'); gitFolder(main);
  const admin = path.join(main, '.git', 'worktrees', 'feature'); fs.mkdirSync(admin, { recursive: true, mode: 0o755 });
  fs.writeFileSync(path.join(admin, 'commondir'), '../..\n', { mode: 0o644 });
  const tree = path.join(dir, 'feature'); fs.mkdirSync(tree, { mode: 0o700 });
  fs.writeFileSync(path.join(tree, '.git'), `gitdir: ${admin}\n`, { mode: 0o644 });
  assert.deepEqual(isSharedProject(projectAt(tree)), { shared: true, reason: 'origin' });
  fs.writeFileSync(path.join(tree, '.git'), 'gitdir: ../main/.git/worktrees/feature\n', { mode: 0o644 });
  assert.deepEqual(isSharedProject(projectAt(tree)), { shared: true, reason: 'origin' }, 'a relative gitdir resolves against the folder of the file');
});

test('5. a .git file whose gitdir has any other form counts as shared, and that path is never read', t => {
  const dir = folder(t), elsewhere = path.join(dir, 'gitdirs', 'app'); gitFolder(path.join(dir, 'gitdirs')); fs.renameSync(path.join(dir, 'gitdirs', '.git'), elsewhere);
  const repo = path.join(dir, 'repo'); fs.mkdirSync(repo, { mode: 0o700 });
  fs.writeFileSync(path.join(repo, '.git'), `gitdir: ${elsewhere}\n`, { mode: 0o644 });
  const project = projectAt(repo), seen = [], lstat = fs.lstatSync, open = fs.openSync;
  t.mock.method(fs, 'lstatSync', (p, ...a) => { seen.push(String(p)); return lstat(p, ...a); });
  t.mock.method(fs, 'openSync', (p, ...a) => { seen.push(String(p)); return open(p, ...a); });
  syncBuiltinESMExports();
  try { assert.deepEqual(isSharedProject(project), UNKNOWN('.git')); } finally { t.mock.restoreAll(); syncBuiltinESMExports(); }
  assert.equal(seen.some(p => p.startsWith(elsewhere)), false, seen.join('\n'));
});

test('5. a worktree whose commondir names another folder counts as shared', t => {
  const dir = folder(t), main = path.join(dir, 'main'); gitFolder(main); gitFolder(path.join(dir, 'other'));
  const admin = path.join(main, '.git', 'worktrees', 'feature'); fs.mkdirSync(admin, { recursive: true, mode: 0o755 });
  fs.writeFileSync(path.join(admin, 'commondir'), '../../../other/.git\n', { mode: 0o644 });
  const tree = path.join(dir, 'feature'); fs.mkdirSync(tree, { mode: 0o700 }); fs.writeFileSync(path.join(tree, '.git'), `gitdir: ${admin}\n`, { mode: 0o644 });
  assert.deepEqual(isSharedProject(projectAt(tree)), UNKNOWN('.git'));
});

test('5a. a submodule (.git file to <x>/.git/modules/<name>) reads the config of that folder', t => {
  const dir = folder(t), main = path.join(dir, 'main'); gitFolder(main);
  const mod = path.join(main, '.git', 'modules', 'lib'); fs.mkdirSync(mod, { recursive: true, mode: 0o755 }); fs.writeFileSync(path.join(mod, 'config'), CONFIG, { mode: 0o644 });
  const sub = path.join(main, 'lib'); fs.mkdirSync(sub, { mode: 0o700 }); fs.writeFileSync(path.join(sub, '.git'), `gitdir: ${mod}\n`, { mode: 0o644 });
  assert.deepEqual(isSharedProject(projectAt(sub)), { shared: true, reason: 'origin' });
});

test('5b. a .git in the home folder is ignored', t => {
  gitFolder(HOME); t.after(() => fs.rmSync(path.join(HOME, '.git'), { recursive: true, force: true }));
  assert.deepEqual(isSharedProject(projectAt(path.join(folder(t), 'app'))), NOT);
});

test('6. no .git up to home is not shared: the search stops at home', t => {
  assert.deepEqual(isSharedProject(projectAt(path.join(folder(t), 'app'))), NOT);
});

test('5c. a config that is a FIFO counts as shared, and does not block or throw', t => {
  const dir = folder(t), repo = path.join(dir, 'repo'); fs.mkdirSync(path.join(repo, '.git'), { recursive: true, mode: 0o755 });
  execFileSync('mkfifo', [path.join(repo, '.git', 'config')]);
  assert.deepEqual(isSharedProject(projectAt(repo)), UNKNOWN('.git/config'));
});

test('5d. a header such as [REMOTE "origin"] and a key such as URL = x match', t => {
  const dir = folder(t), repo = path.join(dir, 'repo'); gitFolder(repo, '[REMOTE "origin"]\n    URL = x\n');
  assert.deepEqual(isSharedProject(projectAt(repo)), { shared: true, reason: 'origin' });
});

test('7. an unreadable config counts as shared and does not throw', t => {
  const dir = folder(t), repo = path.join(dir, 'repo'); gitFolder(repo);
  fs.chmodSync(path.join(repo, '.git', 'config'), 0o000);
  assert.deepEqual(isSharedProject(projectAt(repo)), UNKNOWN('.git/config'));
});

test('M2. a group-writable .git (0775) and config (0664), as umask 002 makes them, are read as git reads them', t => {
  const dir = folder(t), repo = path.join(dir, 'repo'); gitFolder(repo, '[core]\n');
  fs.chmodSync(path.join(repo, '.git'), 0o775); fs.chmodSync(path.join(repo, '.git', 'config'), 0o664);
  assert.deepEqual(isSharedProject(projectAt(repo)), NOT);
  gitFolder(repo); fs.chmodSync(path.join(repo, '.git', 'config'), 0o664);
  assert.deepEqual(isSharedProject(projectAt(repo)), { shared: true, reason: 'origin' });
});

test('M2. a .git and config owned by another user are read as git reads them', t => {
  const dir = folder(t), repo = path.join(dir, 'repo'); gitFolder(repo);
  assert.deepEqual(isSharedProject(projectAt(repo), { uid: 12345 }), { shared: true, reason: 'origin' });
});

test('M2. a worktree of a bare repository is shared by the origin of that repository', t => {
  const dir = folder(t), bare = path.join(dir, 'app.git');
  fs.mkdirSync(path.join(bare, 'objects'), { recursive: true, mode: 0o755 }); fs.writeFileSync(path.join(bare, 'HEAD'), 'ref: refs/heads/main\n'); fs.writeFileSync(path.join(bare, 'config'), CONFIG);
  const admin = path.join(bare, 'worktrees', 'feature'); fs.mkdirSync(admin, { recursive: true, mode: 0o755 }); fs.writeFileSync(path.join(admin, 'commondir'), '../..\n');
  const tree = path.join(dir, 'feature'); fs.mkdirSync(tree, { mode: 0o700 }); fs.writeFileSync(path.join(tree, '.git'), `gitdir: ${admin}\n`);
  assert.deepEqual(isSharedProject(projectAt(tree)), { shared: true, reason: 'origin' });
  fs.rmSync(path.join(bare, 'HEAD'));
  assert.deepEqual(isSharedProject(projectAt(tree)), UNKNOWN('.git'), 'a commondir that is no git folder is unknown');
});

test('M2. a submodule inside a worktree is shared by the config of its module folder', t => {
  const dir = folder(t), main = path.join(dir, 'main'); gitFolder(main);
  const admin = path.join(main, '.git', 'worktrees', 'feature'), tree = path.join(dir, 'feature');
  fs.mkdirSync(admin, { recursive: true, mode: 0o755 }); fs.writeFileSync(path.join(admin, 'commondir'), '../..\n'); fs.writeFileSync(path.join(admin, 'gitdir'), `${tree}/.git\n`);
  fs.mkdirSync(tree, { mode: 0o700 }); fs.writeFileSync(path.join(tree, '.git'), `gitdir: ${admin}\n`);
  const mod = path.join(admin, 'modules', 'lib'); fs.mkdirSync(mod, { recursive: true, mode: 0o755 }); fs.writeFileSync(path.join(mod, 'config'), CONFIG);
  const sub = path.join(tree, 'lib'); fs.mkdirSync(sub, { mode: 0o700 }); fs.writeFileSync(path.join(sub, '.git'), `gitdir: ${mod}\n`);
  assert.deepEqual(isSharedProject(projectAt(sub)), { shared: true, reason: 'origin' });
  const away = path.join(dir, 'away'); fs.mkdirSync(away, { mode: 0o700 }); fs.writeFileSync(path.join(away, '.git'), `gitdir: ${mod}\n`);
  assert.deepEqual(isSharedProject(projectAt(away)), UNKNOWN('.git'), 'a worktree module of a tree that is not above the project is unknown');
});

test('L3. a submodule gitdir whose repository is not above the project is unknown', t => {
  const dir = folder(t), other = path.join(dir, 'other'); gitFolder(other);
  const mod = path.join(other, '.git', 'modules', 'lib'); fs.mkdirSync(mod, { recursive: true, mode: 0o755 }); fs.writeFileSync(path.join(mod, 'config'), '[core]\n');
  const repo = path.join(dir, 'repo'); fs.mkdirSync(repo, { mode: 0o700 }); fs.writeFileSync(path.join(repo, '.git'), `gitdir: ${mod}\n`);
  assert.deepEqual(isSharedProject(projectAt(repo)), UNKNOWN('.git'));
});

test('L3. a gitdir under /Volumes, /net or /Network is unknown, and nothing there is read', t => {
  const dir = folder(t), repo = path.join(dir, 'repo'); fs.mkdirSync(repo, { mode: 0o700 });
  const project = projectAt(repo);
  for (const root of ['/Volumes', '/net', '/Network']) {
    fs.writeFileSync(path.join(repo, '.git'), `gitdir: ${root}/share/app/.git/worktrees/x\n`);
    const seen = [], lstat = fs.lstatSync, open = fs.openSync;
    t.mock.method(fs, 'lstatSync', (p, ...a) => { seen.push(String(p)); return lstat(p, ...a); });
    t.mock.method(fs, 'openSync', (p, ...a) => { seen.push(String(p)); return open(p, ...a); });
    syncBuiltinESMExports();
    try { assert.deepEqual(isSharedProject(project), UNKNOWN('.git'), root); } finally { t.mock.restoreAll(); syncBuiltinESMExports(); }
    assert.equal(seen.some(p => p.startsWith(root + '/')), false, seen.join('\n'));
  }
});

test('7. a .git folder that is a link counts as shared', t => {
  const dir = folder(t), repo = path.join(dir, 'repo'); gitFolder(repo, '[core]\n');
  fs.renameSync(path.join(repo, '.git'), path.join(dir, 'moved-git')); fs.symlinkSync(path.join(dir, 'moved-git'), path.join(repo, '.git'));
  assert.deepEqual(isSharedProject(projectAt(repo)), UNKNOWN('.git'));
});

test('8. a config over 65536 bytes counts as shared and does not throw', t => {
  const dir = folder(t), repo = path.join(dir, 'repo'); gitFolder(repo, `[core]\n# ${'x'.repeat(65536)}\n`);
  assert.deepEqual(isSharedProject(projectAt(repo)), UNKNOWN('.git/config'));
});

test('a .git folder with no config, or a config with no origin, is not shared', t => {
  const dir = folder(t), repo = path.join(dir, 'repo'); fs.mkdirSync(path.join(repo, '.git'), { recursive: true, mode: 0o755 });
  assert.deepEqual(isSharedProject(projectAt(repo)), NOT);
});
