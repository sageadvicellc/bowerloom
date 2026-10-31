import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  COMMIT_MESSAGES, GIT_HARDENING, checkGitArgv, findGit, gitArgv, gitCandidates, runGit,
} from '../../../dist/packages/notes-source/src/git.js';
import { applyStarter, planStarter } from '../../../dist/packages/notes-source/src/index.js';
import { GIT, needsGit, ownGit, put, refusal, script, template, tempDir } from './fixture.mjs';

const H = [...GIT_HARDENING];

// ---- finding git -------------------------------------------------------------------------------------------------------

test('on macOS the candidates are only the Command Line Tools and Xcode gits, never the /usr/bin/git shim', () => {
  const mac = gitCandidates('darwin');
  assert.ok(mac.length >= 2);
  assert.ok(mac.includes('/Library/Developer/CommandLineTools/usr/bin/git'));
  assert.ok(mac.includes('/Applications/Xcode.app/Contents/Developer/usr/bin/git'));
  for (const c of mac) {
    assert.ok(path.isAbsolute(c));
    assert.match(c, /\/usr\/bin\/git$/);
    assert.notEqual(c, '/usr/bin/git');
    assert.ok(c.startsWith('/Library/Developer/') || c.includes('.app/Contents/Developer/') || c.endsWith('/Developer/usr/bin/git'), c);
  }
  assert.deepEqual(gitCandidates('linux'), ['/usr/bin/git', '/bin/git']);
  assert.deepEqual(gitCandidates('win32'), []);
});

test('a missing git refuses NOTES_GIT_MISSING: no candidate, an absent file, a folder, a relative path, or a file others can write', t => {
  const dir = tempDir(t);
  const writable = script(dir, 'git-open', 'exit 0'); fs.chmodSync(writable, 0o777);
  const noExec = path.join(dir, 'git-text'); fs.writeFileSync(noExec, 'x', { mode: 0o644 });
  assert.throws(() => findGit({ candidates: [] }), refusal('NOTES_GIT_MISSING'));
  assert.throws(() => findGit({ candidates: [path.join(dir, 'absent')] }), refusal('NOTES_GIT_MISSING'));
  assert.throws(() => findGit({ candidates: [dir] }), refusal('NOTES_GIT_MISSING'));
  assert.throws(() => findGit({ candidates: ['git'] }), refusal('NOTES_GIT_MISSING'));
  assert.throws(() => findGit({ candidates: [writable, noExec] }), refusal('NOTES_GIT_MISSING'));
});

test('findGit takes the first candidate that is a plain executable file, owned by root or you, that nobody else can write', t => {
  const dir = tempDir(t);
  const good = script(dir, 'git', 'exit 0');
  const found = findGit({ candidates: [path.join(dir, 'absent'), good] });
  assert.equal(found.path, good);
  assert.ok(Object.isFrozen(found));
});

// ---- the argv allowlist ------------------------------------------------------------------------------------------------

test('gitArgv builds exactly the five allowed forms, each behind the fixed hardening options', () => {
  assert.deepEqual(H.slice(0, 2), ['-c', 'core.hooksPath=/dev/null']);
  for (const want of ['core.fsmonitor=false', 'commit.gpgsign=false', 'log.showSignature=false', 'user.name=Bowerloom', 'user.email=bowerloom@localhost']) {
    assert.ok(H.includes(want), want);
  }
  assert.deepEqual(gitArgv({ op: 'init' }), [...H, 'init', '-q']);
  assert.deepEqual(gitArgv({ op: 'add', paths: ['a.md', 'pages/b c.md'] }), [...H, 'add', '--', 'a.md', 'pages/b c.md']);
  assert.deepEqual(gitArgv({ op: 'commit', message: COMMIT_MESSAGES.starter }), [...H, 'commit', '-q', '-m', COMMIT_MESSAGES.starter]);
  assert.deepEqual(gitArgv({ op: 'log-time' }), [...H, 'log', '-1', '--format=%ct']);
  assert.deepEqual(gitArgv({ op: 'status' }), [...H, 'status', '--porcelain']);
  for (const op of [{ op: 'init' }, { op: 'add', paths: ['x.md'] }, { op: 'commit', message: COMMIT_MESSAGES.history }, { op: 'log-time' }, { op: 'status' }]) {
    assert.doesNotThrow(() => checkGitArgv(gitArgv(op)));
  }
});

test('the allowlist refuses every other argv form with NOTES_GIT_ARGV', () => {
  const bad = [
    [], ['status', '--porcelain'], [...H], [...H, 'push'], [...H, 'clone', 'https://example.invalid/x'], [...H, 'init'],
    [...H, 'status', '--porcelain', '--ignored'], [...H, 'status'], [...H, 'log', '-1', '--format=%H'], [...H, 'log', '-2', '--format=%ct'],
    [...H, 'commit', '-q', '-m', 'Something else'], [...H, 'commit', '-q', '--amend', '-m', COMMIT_MESSAGES.starter],
    [...H, 'commit', '-q', '-m', COMMIT_MESSAGES.starter, '--no-verify'],
    [...H, 'add', 'a.md'], [...H, 'add', '--'], [...H, 'add', '-f', '--', 'a.md'], [...H, 'add', '--', '-f'],
    [...H, 'add', '--', '/etc/hosts'], [...H, 'add', '--', '../out.md'], [...H, 'add', '--', 'a/../../b.md'], [...H, 'add', '--', 'a//b.md'],
    [...H, 'add', '--', '.git/config'], [...H, 'add', '--', 'x/.GIT/config'], [...H, 'add', '--', '.hidden.md'], [...H, 'add', '--', 'a/./b.md'],
    [...H, 'add', '--', 'a\\b.md'], [...H, 'add', '--', 'a\0b.md'], [...H, 'add', '--', 'a\nb.md'], [...H, 'add', '--', ''], [...H, 'add', '--', 'a.md', 'a.md'],
    [...H, 'add', '--', 'dir/'], [...H, 'add', '--', ...Array.from({ length: 1001 }, (_, i) => `p${i}.md`)],
    ['-c', 'core.pager=sh', ...H.slice(2), 'status', '--porcelain'], [...H.slice(0, -2), 'status', '--porcelain'],
    [...H.slice(0, 2), '-c', 'core.fsmonitor=/tmp/x', ...H.slice(4), 'status', '--porcelain'],
    [...H, 'status', 1], [...H, 'status', '--porcelain', undefined], 'status', null,
  ];
  for (const argv of bad) assert.throws(() => checkGitArgv(argv), refusal('NOTES_GIT_ARGV'), JSON.stringify(argv));
  for (const command of [{ op: 'push' }, { op: 'add', paths: [] }, { op: 'add', paths: ['../x'] }, { op: 'add', paths: 'a.md' },
    { op: 'commit', message: 'free text' }, { op: 'status', extra: true }, null, 'init']) {
    assert.throws(() => gitArgv(command), refusal('NOTES_GIT_ARGV'), JSON.stringify(command));
  }
});

// ---- the runner, with a stand-in git -----------------------------------------------------------------------------------

test('runGit spawns the found binary with only the allowed argv, the verified folder as cwd, and a minimal environment', async t => {
  const bin = tempDir(t), dir = tempDir(t);
  const rec = script(bin, 'git', 'printf "%s\\n" "$@" > "$0.argv"; /usr/bin/env > "$0.env"; /bin/pwd -P > "$0.cwd"');
  const saved = { ...process.env };
  t.after(() => { for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k]; Object.assign(process.env, saved); });
  Object.assign(process.env, { GIT_DIR: '/nowhere', GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'core.pager', GIT_CONFIG_VALUE_0: 'sh', GIT_EXEC_PATH: '/nowhere', GIT_SSH_COMMAND: 'sh', DYLD_INSERT_LIBRARIES: '/nowhere', LD_PRELOAD: '/nowhere', SECRET_TOKEN: 'canary-value' });
  fs.mkdirSync(path.join(dir, '.git'));
  const git = findGit({ candidates: [rec] });
  await runGit(git, dir, { op: 'status' });
  assert.deepEqual(fs.readFileSync(rec + '.argv', 'utf8').trimEnd().split('\n'), gitArgv({ op: 'status' }));
  assert.equal(fs.readFileSync(rec + '.cwd', 'utf8').trim(), dir);
  const env = Object.fromEntries(fs.readFileSync(rec + '.env', 'utf8').trimEnd().split('\n').map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)])
    .filter(([k]) => !['PWD', 'SHLVL', '_', 'OLDPWD'].includes(k)));
  assert.deepEqual(env, {
    PATH: '/usr/bin:/bin', LC_ALL: 'C', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0', GIT_LITERAL_PATHSPECS: '1',
    GIT_ATTR_NOSYSTEM: '1', GIT_OPTIONAL_LOCKS: '0', GIT_DIR: path.join(dir, '.git'), GIT_WORK_TREE: dir,
  });
  await runGit(git, dir, { op: 'init' });
  const initEnv = fs.readFileSync(rec + '.env', 'utf8');
  assert.doesNotMatch(initEnv, /^GIT_DIR=|^GIT_WORK_TREE=/m, 'init runs in the folder itself');
});

test('runGit refuses a bad command and an unverified folder before it starts anything', async t => {
  const bin = tempDir(t), dir = tempDir(t);
  const rec = script(bin, 'git', 'touch "$0.ran"');
  const git = findGit({ candidates: [rec] });
  await assert.rejects(runGit(git, dir, { op: 'push' }), refusal('NOTES_GIT_ARGV'));
  await assert.rejects(runGit(git, 'relative/folder', { op: 'status' }), refusal('NOTES_PATH_UNSAFE'));
  await assert.rejects(runGit(git, dir + '/', { op: 'status' }), refusal('NOTES_PATH_UNSAFE'));
  await assert.rejects(runGit(git, path.join(dir, 'absent'), { op: 'status' }), refusal('NOTES_FOLDER_MISSING'));
  fs.symlinkSync(dir, path.join(bin, 'link'));
  await assert.rejects(runGit(git, path.join(bin, 'link'), { op: 'status' }), refusal('NOTES_PATH_UNSAFE'));
  await assert.rejects(runGit({ path: rec }, dir, { op: 'status' }), refusal('NOTES_USAGE'), 'only a binary that findGit returned runs');
  assert.equal(fs.existsSync(rec + '.ran'), false);
});

test('a git that runs too long is killed and refuses NOTES_GIT_TIMEOUT', async t => {
  const bin = tempDir(t), dir = tempDir(t);
  const git = findGit({ candidates: [script(bin, 'git', 'exec /bin/sleep 30')] });
  const started = Date.now();
  await assert.rejects(runGit(git, dir, { op: 'init' }, { timeoutMs: 300 }), refusal('NOTES_GIT_TIMEOUT'));
  assert.ok(Date.now() - started < 10_000, 'the runner did not wait for the child');
});

test('a git that prints past the output cap is killed and refuses NOTES_GIT_OUTPUT', async t => {
  const bin = tempDir(t), dir = tempDir(t);
  const git = findGit({ candidates: [script(bin, 'git', 'exec /usr/bin/yes')] });
  await assert.rejects(runGit(git, dir, { op: 'init' }, { outputBytes: 4096, timeoutMs: 10_000 }), refusal('NOTES_GIT_OUTPUT'));
});

test('a git that fails refuses NOTES_GIT_FAILED, and a git removed after it was found refuses NOTES_GIT_MISSING', async t => {
  const bin = tempDir(t), dir = tempDir(t);
  const failing = findGit({ candidates: [script(bin, 'git', 'echo oops >&2; exit 3')] });
  await assert.rejects(runGit(failing, dir, { op: 'init' }), refusal('NOTES_GIT_FAILED'));
  const gone = findGit({ candidates: [script(bin, 'git2', 'exit 0')] });
  fs.unlinkSync(gone.path);
  await assert.rejects(runGit(gone, dir, { op: 'init' }), refusal('NOTES_GIT_MISSING'));
  fs.mkdirSync(path.join(dir, '.git-not'));
  fs.symlinkSync(path.join(dir, '.git-not'), path.join(dir, '.git'));
  await assert.rejects(runGit(failing, dir, { op: 'status' }), refusal('NOTES_PATH_UNSAFE'), 'every form but init needs .git to be a real folder');
});

test('runGit refuses timeout and output limits out of range with NOTES_USAGE', async t => {
  const bin = tempDir(t), dir = tempDir(t);
  const git = findGit({ candidates: [script(bin, 'git', 'exit 0')] });
  for (const o of [{ timeoutMs: 0 }, { timeoutMs: 1e9 }, { timeoutMs: 1.5 }, { outputBytes: 0 }, { outputBytes: 1e12 }]) {
    await assert.rejects(runGit(git, dir, { op: 'status' }, o), refusal('NOTES_USAGE'), JSON.stringify(o));
  }
});

// ---- the environment scrub, with real git ------------------------------------------------------------------------------

test('a hostile global git config, hooks, a gpg sign setting, and git variables in the environment have no effect', { skip: needsGit }, async t => {
  const home = tempDir(t), dir = path.join(tempDir(t), 'notes');
  const marker = path.join(home, 'ran');
  const hook = `echo "$0" >> "${marker}"; exit 1`;
  const hooks = path.join(home, 'hooks'); fs.mkdirSync(hooks);
  for (const name of ['pre-commit', 'commit-msg', 'post-commit', 'reference-transaction', 'post-index-change']) script(hooks, name, hook);
  const tpl = path.join(home, 'template'); fs.mkdirSync(path.join(tpl, 'hooks'), { recursive: true }); script(path.join(tpl, 'hooks'), 'pre-commit', hook);
  const gpg = script(home, 'gpg', hook), fsmonitor = script(home, 'fsmonitor', hook);
  const config = [
    '[user]', '\tname = Someone Else', '\temail = someone@example.invalid', '\tsigningkey = ABCDEF',
    '[core]', `\thooksPath = ${hooks}`, `\tfsmonitor = ${fsmonitor}`, '\tpager = false',
    '[commit]', '\tgpgsign = true', '[gpg]', `\tprogram = ${gpg}`, '[init]', `\ttemplateDir = ${tpl}`, '\tdefaultBranch = hostile', '',
  ].join('\n');
  fs.writeFileSync(path.join(home, '.gitconfig'), config);
  put(home, 'xdg/git/config', config);
  const saved = { ...process.env };
  t.after(() => { for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k]; Object.assign(process.env, saved); });
  Object.assign(process.env, {
    HOME: home, XDG_CONFIG_HOME: path.join(home, 'xdg'), GIT_CONFIG_GLOBAL: path.join(home, '.gitconfig'), GIT_TEMPLATE_DIR: tpl,
    GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'core.hooksPath', GIT_CONFIG_VALUE_0: hooks, GIT_AUTHOR_NAME: 'Someone Else', GIT_COMMITTER_NAME: 'Someone Else',
    GIT_DIR: path.join(home, 'elsewhere.git'), GIT_INDEX_FILE: path.join(home, 'index'),
  });
  const plan = planStarter(dir, template());
  const result = await applyStarter(dir, plan.revision, template());
  for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
  Object.assign(process.env, saved);
  assert.equal(result.clean, true);
  assert.equal(fs.existsSync(marker), false, 'no hook, gpg program, or fsmonitor ran');
  assert.equal(fs.existsSync(path.join(home, 'elsewhere.git')), false);
  assert.equal(fs.existsSync(path.join(dir, '.git', 'hooks', 'pre-commit')), false, 'the hostile template folder was not used');
  assert.equal(ownGit(dir, ['log', '-1', '--format=%an <%ae>|%cn <%ce>']), 'Bowerloom <bowerloom@localhost>|Bowerloom <bowerloom@localhost>');
  assert.doesNotMatch(ownGit(dir, ['cat-file', 'commit', 'HEAD']), /gpgsig/);
  assert.equal(ownGit(dir, ['symbolic-ref', 'HEAD']), 'refs/heads/main');
});

test('the real git found on this machine is one of the trusted candidates', { skip: needsGit }, () => {
  assert.ok(gitCandidates(process.platform).some(c => c === GIT.path || (fs.existsSync(c) && fs.realpathSync(c) === GIT.path)), GIT.path);
});
