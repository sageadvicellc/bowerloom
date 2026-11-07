import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validateSlug, baseBranchOf, isInside, parseArgs, baseProblem, ignoredAllowed, parseStatus, createLane, MARKER_SCHEMA, DEFAULT_FLOOR_GIB } from '../lane-tree.mjs';
import { freeBytes, GIB } from '../lib/run-child.mjs';

const gatesScript = fileURLToPath(new URL('../gates.mjs', import.meta.url));

const script = fileURLToPath(new URL('../lane-tree.mjs', import.meta.url));
/** The skip value for a test that makes a real lane: false when there is room, else a message that starts with "skipped: low disk". */
export const lowDiskSkip = free => (free > (DEFAULT_FLOOR_GIB + 1) * GIB ? false : `skipped: low disk (under ${DEFAULT_FLOOR_GIB + 1} GiB free in the temp folder)`);
const skip = lowDiskSkip(freeBytes(os.tmpdir()));
const made = [];
test.after(() => { for (const dir of made) fs.rmSync(dir, { recursive: true, force: true }); });
const tmp = () => { const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'lane-tree-test-'))); made.push(dir); return dir; };

// Real git, no stubs. The identity and config are fixed so the host's settings never matter, and a git location variable from an outer run is dropped.
const { GIT_DIR: _d, GIT_INDEX_FILE: _i, GIT_WORK_TREE: _w, ...CLEAN_ENV } = process.env;
const GIT_ENV = { ...CLEAN_ENV, GIT_CEILING_DIRECTORIES: fs.realpathSync(os.tmpdir()), BOWERLOOM_TOOLS_TEST_MODE: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null', GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@example.com', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@example.com' };
function git(cwd, ...args) {
  const run = spawnSync('git', args, { cwd, encoding: 'utf8', env: GIT_ENV });
  assert.equal(run.status, 0, `git ${args.join(' ')}\n${run.stderr}`);
  return run.stdout.trim();
}
const BASE = 'release/lane';

/** A bare origin plus a source clone with one commit on release/lane, pushed. */
function fixture() {
  const home = tmp();
  const origin = path.join(home, 'origin.git');
  const source = path.join(home, 'source');
  fs.mkdirSync(origin);
  git(origin, 'init', '-q', '--bare');
  fs.mkdirSync(source);
  git(source, 'init', '-q', '-b', BASE);
  fs.writeFileSync(path.join(source, 'README.md'), 'hello\n');
  fs.writeFileSync(path.join(source, '.gitignore'), 'node_modules/\n');
  git(source, 'add', '.');
  git(source, 'commit', '-qm', 'first');
  git(source, 'remote', 'add', 'origin', origin);
  git(source, 'push', '-q', 'origin', BASE);
  const work = path.join(home, 'work');
  fs.mkdirSync(work);
  return { home, origin, source, work, baseCommit: git(source, 'rev-parse', 'HEAD') };
}
function lane(fx, args, env = {}, cwd = undefined) {
  const run = spawnSync(process.execPath, [script, ...args, '--json'], { encoding: 'utf8', env: { ...GIT_ENV, ...env }, timeout: 120000, cwd });
  let json = null;
  try { json = JSON.parse(run.stdout); } catch { /* not JSON */ }
  return { status: run.status, json, stdout: run.stdout, stderr: run.stderr };
}
const create = (fx, name, extra = [], env) => lane(fx, ['create', '--source', fx.source, '--name', name, '--base', BASE, '--dest', path.join(fx.work, name), ...extra], env);
const remove = (dest, extra = [], env = {}, cwd = undefined) => lane(null, ['remove', '--dest', dest, ...extra], env, cwd);
const realGit = spawnSync('which', ['git'], { encoding: 'utf8' }).stdout.trim();
/** A folder with a `git` wrapper that appends "ran" to a file, then runs the real git (or the `intercept` shell fragment first). Returns { bin, ran, env }. */
function gitWrapper(intercept = '') {
  const bin = tmp();
  if (typeof intercept === 'function') intercept = intercept(bin);
  const ran = path.join(bin, 'ran');
  fs.writeFileSync(path.join(bin, 'git'), `#!/bin/sh\necho ran >> ${JSON.stringify(ran)}\n${intercept}\nexec ${JSON.stringify(realGit)} "$@"\n`, { mode: 0o755 });
  return { bin, ran, env: { PATH: `${bin}${path.delimiter}${process.env.PATH}` } };
}
const markerPath = dest => path.join(dest, '.git', 'lane-tree.json');
const readMarker = dest => JSON.parse(fs.readFileSync(markerPath(dest), 'utf8'));
const writeMarker = (dest, patch) => fs.writeFileSync(markerPath(dest), JSON.stringify({ ...readMarker(dest), ...patch }));


// ---- Pure functions ----

test('validateSlug accepts lower-case slugs and refuses the rest', () => {
  for (const ok of ['a', 'a1', 'lane-1', '0.8b2'.replace('.', '-')]) assert.equal(validateSlug(ok), true, ok);
  for (const bad of ['', '-x', 'Upper', 'a_b', 'a b', 'a/b', 'a.b', '../x', 'x\n', 'é']) assert.equal(validateSlug(bad), false, JSON.stringify(bad));
});

test('baseBranchOf strips origin/ and refs/heads/, and returns null for a commit id', () => {
  assert.equal(baseBranchOf('release/0.8.0-beta.2'), 'release/0.8.0-beta.2');
  assert.equal(baseBranchOf('origin/release/0.8.0-beta.2'), 'release/0.8.0-beta.2');
  assert.equal(baseBranchOf('refs/heads/main'), 'main');
  assert.equal(baseBranchOf('refs/remotes/origin/main'), 'main');
  assert.equal(baseBranchOf('a'.repeat(40)), null);
});

test('isInside is true for the folder itself and its children, and false for a sibling with the same prefix', () => {
  assert.equal(isInside('/a/b', '/a/b'), true);
  assert.equal(isInside('/a/b/c/d', '/a/b'), true);
  assert.equal(isInside('/a/bc', '/a/b'), false);
  assert.equal(isInside('/a', '/a/b'), false);
});

test('parseArgs reads each subcommand and rejects wrong use', () => {
  const ok = parseArgs(['create', '--name', 'x', '--base', 'main', '--dest', '/abs/x', '--modules-from', '/abs/m', '--branch', 'task/y']);
  assert.deepEqual({ cmd: ok.command, name: ok.name, base: ok.base, dest: ok.dest, modules: ok.modulesFrom, branch: ok.branch, floor: ok.floorGiB }, { cmd: 'create', name: 'x', base: 'main', dest: '/abs/x', modules: '/abs/m', branch: 'task/y', floor: 12 });
  assert.equal(parseArgs(['remove', '--dest', '/abs/x', '--apply']).apply, true);
  assert.equal(parseArgs(['remove', '--dest', '/abs/x']).apply, false);
  assert.equal(parseArgs(['list']).command, 'list');
  assert.equal(parseArgs(['--help']).help, true);
  assert.equal(parseArgs([]).usage !== null, true);
  for (const bad of [['create', '--base', 'main', '--dest', '/x'], ['create', '--name', 'a', '--dest', '/x'], ['create', '--name', 'a', '--base', 'm'], ['remove'], ['remove', '--dest'], ['create', '--bogus'], ['frob'],
    ['create', '--name', 'a', '--base', 'm', '--dest', '/x', '--min-free-gib', '3'], ['remove', '--dest', '/x', '--base', 'm'], ['list', '--root']]) {
    assert.ok(parseArgs(bad).usage, JSON.stringify(bad));
  }
  assert.ok(MARKER_SCHEMA.startsWith('bowerloom/'));
  for (const bad of [['remove', '--dest', '/x', '--apply=false'], ['remove', '--dest', '/x', '--json=1'], ['create', '--name', 'a', '--base', 'm', '--dest', '/x', '--json=x'], ['create', '--name', 'a', '--base=--upload-pack=x', '--dest', '/x'],
    ['create', '--name', 'a', '--base', 'HEAD', '--dest', '/x'], ['create', '--name', 'a', '--base', '-x', '--dest', '/x'], ['remove', '--dest=--apply']]) {
    assert.ok(parseArgs(bad).usage, JSON.stringify(bad));
  }
});

test('--help exits 0 and a wrong use exits 2', () => {
  const help = spawnSync(process.execPath, [script, '--help'], { encoding: 'utf8' });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /Usage: node tools\/lane-tree\.mjs/);
  assert.equal(spawnSync(process.execPath, [script, 'create'], { encoding: 'utf8' }).status, 2);
  assert.equal(spawnSync(process.execPath, [script], { encoding: 'utf8' }).status, 2);
});

// ---- create ----

test('create: makes a working copy on a new branch at the fetched base, with the marker file', { skip }, () => {
  const fx = fixture();
  const dest = path.join(fx.work, 'lane1');
  const run = create(fx, 'lane1');
  assert.equal(run.status, 0, run.stderr + run.stdout);
  assert.equal(run.json.ok, true);
  assert.equal(run.json.command, 'create');
  assert.equal(run.json.branch, 'task/lane1');
  assert.equal(run.json.baseCommit, fx.baseCommit);
  assert.equal(run.stdout.trim().split('\n').length, 1);
  assert.equal(git(dest, 'rev-parse', '--abbrev-ref', 'HEAD'), 'task/lane1');
  assert.equal(git(dest, 'rev-parse', 'HEAD'), fx.baseCommit);
  assert.equal(git(dest, 'remote', 'get-url', 'origin'), fx.origin, 'origin is the source origin, not the source clone');
  assert.equal(git(dest, 'status', '--porcelain'), '');
  assert.equal(fs.readFileSync(path.join(dest, 'README.md'), 'utf8'), 'hello\n');
  const marker = JSON.parse(fs.readFileSync(path.join(dest, '.git', 'lane-tree.json'), 'utf8'));
  assert.equal(marker.schema, MARKER_SCHEMA);
  assert.equal(marker.name, 'lane1');
  assert.equal(marker.source, fx.source);
  assert.equal(marker.base, BASE);
  assert.equal(marker.branch, 'task/lane1');
  assert.equal(marker.baseCommit, fx.baseCommit);
  assert.ok(!Number.isNaN(Date.parse(marker.createdAt)));
  for (const key of ['ok', 'command', 'name', 'dest', 'base', 'baseCommit', 'branch', 'modules', 'freeGiB', 'floorGiB', 'refused']) assert.ok(key in run.json, key);
});

test('create: takes the base from the origin, not from commits that only the source clone has', { skip }, () => {
  const fx = fixture();
  fs.writeFileSync(path.join(fx.source, 'local-only.txt'), 'x');
  git(fx.source, 'add', '.');
  git(fx.source, 'commit', '-qm', 'local only');
  const run = create(fx, 'lane2', ['--base', `origin/${BASE}`]);
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.json.baseCommit, fx.baseCommit);
  assert.equal(fs.existsSync(path.join(fx.work, 'lane2', 'local-only.txt')), false);
});

test('create: --branch names the branch', { skip }, () => {
  const fx = fixture();
  const run = create(fx, 'lane3', ['--branch', 'feature/custom-name']);
  assert.equal(run.status, 0, run.stderr);
  assert.equal(git(path.join(fx.work, 'lane3'), 'rev-parse', '--abbrev-ref', 'HEAD'), 'feature/custom-name');
  assert.equal(JSON.parse(fs.readFileSync(path.join(fx.work, 'lane3', '.git', 'lane-tree.json'), 'utf8')).branch, 'feature/custom-name');
});

test('create: refuses a relative destination', { skip }, () => {
  const fx = fixture();
  const run = lane(fx, ['create', '--source', fx.source, '--name', 'x', '--base', BASE, '--dest', 'relative/x']);
  assert.equal(run.status, 1);
  assert.match(run.json.refused, /absolute/);
});

test('create: refuses an existing destination and leaves it alone', { skip }, () => {
  const fx = fixture();
  const dest = path.join(fx.work, 'taken');
  fs.mkdirSync(dest);
  fs.writeFileSync(path.join(dest, 'mine.txt'), 'keep');
  const run = create(fx, 'taken');
  assert.equal(run.status, 1);
  assert.match(run.json.refused, /exists/);
  assert.equal(fs.readFileSync(path.join(dest, 'mine.txt'), 'utf8'), 'keep');
});

test('create: refuses a destination that is a dangling symlink', { skip }, () => {
  const fx = fixture();
  fs.symlinkSync(path.join(fx.home, 'nowhere'), path.join(fx.work, 'link'));
  const run = create(fx, 'link');
  assert.equal(run.status, 1);
  assert.match(run.json.refused, /exists/);
});

test('create: refuses when the parent folder is missing, and creates nothing', { skip }, () => {
  const fx = fixture();
  const dest = path.join(fx.work, 'missing-parent', 'lane');
  const run = lane(fx, ['create', '--source', fx.source, '--name', 'x', '--base', BASE, '--dest', dest]);
  assert.equal(run.status, 1);
  assert.match(run.json.refused, /parent/);
  assert.equal(fs.existsSync(path.join(fx.work, 'missing-parent')), false);
});

test('create: refuses a destination inside the source repository', { skip }, () => {
  const fx = fixture();
  fs.mkdirSync(path.join(fx.source, 'sub'));
  const run = lane(fx, ['create', '--source', fx.source, '--name', 'x', '--base', BASE, '--dest', path.join(fx.source, 'sub', 'lane')]);
  assert.equal(run.status, 1);
  assert.match(run.json.refused, /inside the source/);
  assert.equal(fs.existsSync(path.join(fx.source, 'sub', 'lane')), false);
});

test('create: refuses a bad slug', { skip }, () => {
  const fx = fixture();
  for (const slug of ['Bad_Slug', '-lead', 'a b']) {
    const run = lane(fx, ['create', '--source', fx.source, '--name', slug, '--base', BASE, '--dest', path.join(fx.work, 'slug-test')]);
    assert.equal(run.status, 1, slug);
    assert.match(run.json.refused, /slug/);
  }
  assert.equal(fs.existsSync(path.join(fx.work, 'slug-test')), false);
});

test('create: refuses an invalid branch name', { skip }, () => {
  const fx = fixture();
  const run = create(fx, 'b1', ['--branch', 'bad..name']);
  assert.equal(run.status, 1);
  assert.match(run.json.refused, /branch/);
  assert.equal(fs.existsSync(path.join(fx.work, 'b1')), false);
});

test('create: refuses when free disk is under the floor plus the sizes it needs', { skip }, () => {
  const fx = fixture();
  const run = create(fx, 'big', ['--min-free-gib', '999999999']);
  assert.equal(run.status, 1);
  assert.match(run.json.refused, /free disk/);
  assert.equal(fs.existsSync(path.join(fx.work, 'big')), false);
});

test('create: --min-free-gib below the default is wrong use', () => {
  const run = spawnSync(process.execPath, [script, 'create', '--name', 'x', '--base', BASE, '--dest', '/nope/x', '--min-free-gib', '2'], { encoding: 'utf8' });
  assert.equal(run.status, 2);
});

test('create: refuses when the source has no origin', { skip }, () => {
  const fx = fixture();
  git(fx.source, 'remote', 'remove', 'origin');
  const run = create(fx, 'noorigin');
  assert.equal(run.status, 1);
  assert.match(run.json.refused, /origin/);
  assert.equal(fs.existsSync(path.join(fx.work, 'noorigin')), false);
});

test('create: removes its own half-made folder when the base cannot be fetched', { skip }, () => {
  const fx = fixture();
  const run = create(fx, 'nobase', ['--base', 'release/does-not-exist']);
  assert.equal(run.status, 1);
  assert.match(run.json.refused, /fetch/);
  assert.equal(run.json.cleanedPartial, true);
  assert.equal(fs.existsSync(path.join(fx.work, 'nobase')), false);
});

test('create: --modules-from must be an absolute existing folder', { skip }, () => {
  const fx = fixture();
  assert.match(create(fx, 'm1', ['--modules-from', 'relative/dir']).json.refused, /absolute/);
  assert.match(create(fx, 'm2', ['--modules-from', path.join(fx.home, 'absent')]).json.refused, /modules-from/);
  assert.equal(fs.existsSync(path.join(fx.work, 'm1')), false);
});

test('create: --modules-from copies both node_modules folders on macOS, and skips with a message elsewhere', { skip }, () => {
  const fx = fixture();
  const checkout = path.join(fx.home, 'checkout');
  fs.mkdirSync(path.join(checkout, 'node_modules/pkg'), { recursive: true });
  fs.writeFileSync(path.join(checkout, 'node_modules/pkg/index.js'), 'root-module');
  fs.mkdirSync(path.join(checkout, 'apps/desktop/node_modules/dep'), { recursive: true });
  fs.writeFileSync(path.join(checkout, 'apps/desktop/node_modules/dep/index.js'), 'desktop-module');
  const run = create(fx, 'mods', ['--modules-from', checkout]);
  assert.equal(run.status, 0, run.stderr + run.stdout);
  const dest = path.join(fx.work, 'mods');
  if (process.platform === 'darwin') {
    assert.deepEqual(run.json.modules.copied.sort(), ['apps/desktop/node_modules', 'node_modules']);
    assert.equal(run.json.modules.skipped, null);
    assert.equal(fs.readFileSync(path.join(dest, 'node_modules/pkg/index.js'), 'utf8'), 'root-module');
    assert.equal(fs.readFileSync(path.join(dest, 'apps/desktop/node_modules/dep/index.js'), 'utf8'), 'desktop-module');
    fs.writeFileSync(path.join(dest, 'node_modules/pkg/index.js'), 'changed in the lane');
    assert.equal(fs.readFileSync(path.join(checkout, 'node_modules/pkg/index.js'), 'utf8'), 'root-module', 'a copy, not a link');
    assert.equal(git(dest, 'status', '--porcelain'), '', 'node_modules is ignored or absent from the tree');
  } else {
    assert.deepEqual(run.json.modules.copied, []);
    assert.match(run.json.modules.skipped, /macOS|darwin/i);
    assert.equal(fs.existsSync(path.join(dest, 'node_modules')), false);
  }
});

test('create: never runs npm', { skip }, () => {
  const fx = fixture();
  const wrapper = gitWrapper();
  const witness = path.join(wrapper.bin, 'npm-was-called');
  fs.writeFileSync(path.join(wrapper.bin, 'npm'), `#!/bin/sh\necho called >> ${JSON.stringify(witness)}\n`, { mode: 0o755 });
  const checkout = path.join(fx.home, 'checkout');
  fs.mkdirSync(path.join(checkout, 'node_modules'), { recursive: true });
  const run = create(fx, 'nonpm', ['--modules-from', checkout], wrapper.env);
  assert.equal(run.status, 0, run.stderr);
  assert.equal(fs.existsSync(wrapper.ran), true, 'the PATH wrapper was used, so an npm call would have been seen');
  assert.equal(fs.existsSync(witness), false);
});

test('create: git runs without any token in its environment', { skip }, () => {
  const fx = fixture();
  // A git wrapper that records the secret variables it can see, then runs the real git.
  let seen = '';
  const wrapper = gitWrapper(bin => { seen = path.join(bin, 'env-seen'); return `env | grep -E '(_TOKEN|_KEY|_SECRET|_PASSWORD|_auth)=' >> ${JSON.stringify(seen)}`; });
  const run = create(fx, 'notoken', [], { ...wrapper.env, GH_TOKEN: 'canary-1', GITHUB_TOKEN: 'canary-2', SOME_API_KEY: 'canary-3', SOME_SECRET: 'canary-4', npm_config__auth: 'canary-5' });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(fs.existsSync(wrapper.ran), true, 'the git wrapper ran');
  assert.equal(fs.existsSync(seen) ? fs.readFileSync(seen, 'utf8') : '', '');
});

test('create: --base that git could read as an option is refused and runs nothing', { skip }, () => {
  const fx = fixture();
  const payload = path.join(fx.home, 'payload-ran');
  const upload = `--upload-pack=touch ${payload}`;
  // Through the command line: usage errors, exit 2.
  for (const argv of [['--base', upload], [`--base=${upload}`], ['--base=-x'], ['--base', '-x']]) {
    const run = lane(fx, ['create', '--source', fx.source, '--name', 'inj', '--dest', path.join(fx.work, 'inj'), ...argv]);
    assert.equal(run.status, 2, JSON.stringify(argv));
    assert.equal(run.json.ok, false);
    assert.equal(fs.existsSync(payload), false);
    assert.equal(fs.existsSync(path.join(fx.work, 'inj')), false);
  }
  assert.equal(fs.existsSync(payload), false, 'the payload never ran');
});

test('createLane (the library entry) refuses a leading-dash base and never runs the fetch payload', { skip }, async () => {
  const fx = fixture();
  const payload = path.join(fx.home, 'payload-ran');
  const dest = path.join(fx.work, 'lib');
  const base = { name: 'lib', dest, branch: null, modulesFrom: null, source: fx.source, floorGiB: DEFAULT_FLOOR_GIB };
  for (const bad of [`--upload-pack=touch ${payload}`, `-x`, 'HEAD']) {
    const result = await createLane({ ...base, base: bad });
    assert.equal(result.ok, false, bad);
    assert.ok(result.refused, bad);
    assert.equal(fs.existsSync(dest), false);
  }
  // A name that is not a valid ref is refused after the prefix is stripped.
  const spaced = await createLane({ ...base, base: `origin/bad name ${payload}` });
  assert.equal(spaced.ok, false);
  assert.equal(fs.existsSync(payload), false);
});

test('create: --base HEAD is a usage error, and a 40-character commit id is accepted', { skip }, () => {
  const fx = fixture();
  assert.equal(create(fx, 'h1', ['--base', 'HEAD']).status, 2);
  assert.equal(create(fx, 'h2', ['--base=head']).status, 2);
  const run = create(fx, 'h3', ['--base', fx.baseCommit]);
  assert.equal(run.status, 0, run.stderr + run.stdout);
  assert.equal(run.json.baseCommit, fx.baseCommit);
  assert.equal(baseProblem('release/x'), null);
  assert.match(baseProblem('HEAD'), /HEAD/);
});

test('create: when --modules-from copies nothing, ok stays true and the JSON says modulesCopied false with a note', { skip }, () => {
  const fx = fixture();
  const empty = path.join(fx.home, 'no-modules');
  fs.mkdirSync(empty);
  const run = create(fx, 'nomods', ['--modules-from', empty]);
  assert.equal(run.status, 0, run.stderr + run.stdout);
  assert.equal(run.json.ok, true);
  assert.equal(run.json.modulesCopied, false);
  assert.ok(typeof run.json.modulesNote === 'string' && run.json.modulesNote.length > 0);
  const human = spawnSync(process.execPath, [script, 'create', '--source', fx.source, '--name', 'nomods2', '--base', BASE, '--dest', path.join(fx.work, 'nomods2'), '--modules-from', empty], { encoding: 'utf8', env: GIT_ENV });
  assert.match(human.stdout, /modules NOT copied/);
  const without = create(fx, 'nomods3');
  assert.equal(without.json.modulesCopied, false);
  assert.equal(without.json.modulesNote, null);
});

test('create: a du failure refuses the run instead of lowering the disk need, and makes nothing', { skip }, () => {
  const fx = fixture();
  const bin = tmp();
  fs.writeFileSync(path.join(bin, 'du'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
  const run = create(fx, 'nodu', [], { PATH: `${bin}${path.delimiter}${process.env.PATH}` });
  assert.equal(run.status, 1);
  assert.match(run.json.refused, /du failed/);
  assert.equal(fs.existsSync(path.join(fx.work, 'nodu')), false);
});

test('create: removes the half-made folder when the marker cannot be written', { skip }, () => {
  const fx = fixture();
  // A template post-checkout hook makes a folder where the marker file goes, so the write fails.
  const template = tmp();
  fs.mkdirSync(path.join(template, 'hooks'));
  fs.writeFileSync(path.join(template, 'hooks', 'post-checkout'), '#!/bin/sh\nmkdir "$(git rev-parse --git-dir)/lane-tree.json"\n', { mode: 0o755 });
  const run = create(fx, 'nomarker', [], { GIT_TEMPLATE_DIR: template });
  assert.equal(run.status, 1, run.stderr + run.stdout);
  assert.match(run.json.refused, /marker/);
  assert.equal(run.json.cleanedPartial, true);
  assert.equal(fs.existsSync(path.join(fx.work, 'nomarker')), false);
});

test('create: stores a nonce in the marker and in the repository config, and the real path of the folder', { skip }, () => {
  const fx = fixture();
  assert.equal(create(fx, 'nonce').status, 0);
  const dest = path.join(fx.work, 'nonce');
  const marker = readMarker(dest);
  assert.match(marker.nonce, /^[0-9a-f]{32}$/);
  assert.equal(git(dest, 'config', '--local', '--get', 'laneTree.nonce'), marker.nonce);
  assert.equal(marker.dest, dest);
  const second = create(fx, 'nonce2');
  assert.equal(second.status, 0);
  assert.notEqual(readMarker(path.join(fx.work, 'nonce2')).nonce, marker.nonce);
});

test('create: does not copy the source tags into the lane', { skip }, () => {
  const fx = fixture();
  git(fx.source, 'tag', 'local-only-tag');
  assert.equal(create(fx, 'notags').status, 0);
  assert.equal(git(path.join(fx.work, 'notags'), 'tag', '--list'), '');
});

test('create: an interrupt stops the clone, removes the half-made folder, and exits 130', { skip }, async () => {
  const fx = fixture();
  const dest = path.join(fx.work, 'interrupted');
  const wrapper = gitWrapper(`if [ "$1" = clone ]; then ${JSON.stringify(realGit)} "$@" || exit $?; echo $$ > ${JSON.stringify(path.join(fx.home, 'slow-pid'))}; touch ${JSON.stringify(path.join(fx.home, 'ready'))}; exec sleep 60; fi`);
  const child = spawn(process.execPath, [script, 'create', '--source', fx.source, '--name', 'interrupted', '--base', BASE, '--dest', dest, '--json'], { env: { ...GIT_ENV, ...wrapper.env }, stdio: ['ignore', 'pipe', 'pipe'] });
  const exited = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })));
  const end = Date.now() + 60000;
  while (!fs.existsSync(path.join(fx.home, 'ready')) && Date.now() < end) await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(fs.existsSync(path.join(fx.home, 'ready')), true, 'the clone step started');
  assert.equal(fs.existsSync(dest), true, 'the half-made folder exists');
  child.kill('SIGINT');
  const result = await exited;
  assert.equal(result.code, 130);
  assert.equal(fs.existsSync(dest), false, 'the half-made folder was removed');
  const pid = Number(fs.readFileSync(path.join(fx.home, 'slow-pid'), 'utf8'));
  const until = Date.now() + 5000;
  let alive = true;
  while (alive && Date.now() < until) { try { process.kill(pid, 0); await new Promise(resolve => setTimeout(resolve, 50)); } catch { alive = false; } }
  assert.equal(alive, false, 'the slow child is gone');
});

// ---- remove ----

test('remove: is a dry run by default and deletes nothing', { skip }, () => {
  const fx = fixture();
  assert.equal(create(fx, 'dry').status, 0);
  const dest = path.join(fx.work, 'dry');
  const run = remove(dest);
  assert.equal(run.status, 0, run.stderr + run.stdout);
  assert.equal(run.json.ok, true);
  assert.equal(run.json.apply, false);
  assert.equal(run.json.wouldRemove, true);
  assert.equal(run.json.removed, false);
  assert.ok(run.json.bytes > 0);
  assert.deepEqual(run.json.refusals, []);
  assert.equal(fs.existsSync(dest), true);
});

test('remove --apply deletes a clean lane whose HEAD is still the base commit, and touches no other repo', { skip }, () => {
  const fx = fixture();
  assert.equal(create(fx, 'gone').status, 0);
  const before = { source: git(fx.source, 'branch', '--list'), origin: git(fx.origin, 'branch', '--list') };
  const dest = path.join(fx.work, 'gone');
  const run = remove(dest, ['--apply']);
  assert.equal(run.status, 0, run.stderr + run.stdout);
  assert.equal(run.json.removed, true);
  assert.equal(fs.existsSync(dest), false);
  assert.deepEqual({ source: git(fx.source, 'branch', '--list'), origin: git(fx.origin, 'branch', '--list') }, before);
  assert.equal(fs.existsSync(fx.work), true);
});

test('remove: refuses a folder that has no marker, even a clean git clone', { skip }, () => {
  const fx = fixture();
  const dest = path.join(fx.work, 'plain');
  git(fx.work, 'clone', '-q', fx.origin, dest);
  const run = remove(dest, ['--apply']);
  assert.equal(run.status, 1);
  assert.ok(run.json.refusals.some(r => /marker/.test(r)));
  assert.equal(fs.existsSync(dest), true);
});

test('remove: refuses a folder that does not exist, and a relative path', { skip }, () => {
  const fx = fixture();
  assert.equal(remove(path.join(fx.work, 'absent')).status, 1);
  const relative = remove('relative/path');
  assert.equal(relative.status, 1);
  assert.ok(relative.json.refusals.some(r => /absolute/.test(r)));
});

test('remove: refuses a symlink to a lane, and the lane survives', { skip }, () => {
  const fx = fixture();
  assert.equal(create(fx, 'real').status, 0);
  const link = path.join(fx.work, 'link-to-real');
  fs.symlinkSync(path.join(fx.work, 'real'), link);
  const run = remove(link, ['--apply']);
  assert.equal(run.status, 1);
  assert.ok(run.json.refusals.some(r => /symlink/.test(r)));
  assert.equal(fs.existsSync(path.join(fx.work, 'real', 'README.md')), true);
  assert.equal(fs.lstatSync(link).isSymbolicLink(), true);
});

test('remove: refuses a lane with an untracked file, a modified file, or a stash', { skip }, () => {
  const fx = fixture();
  assert.equal(create(fx, 'dirty').status, 0);
  const dest = path.join(fx.work, 'dirty');
  fs.writeFileSync(path.join(dest, 'new.txt'), 'x');
  let run = remove(dest, ['--apply']);
  assert.equal(run.status, 1);
  assert.ok(run.json.refusals.some(r => /uncommitted|status/.test(r)));
  assert.equal(fs.existsSync(dest), true);
  fs.rmSync(path.join(dest, 'new.txt'));
  fs.writeFileSync(path.join(dest, 'README.md'), 'changed\n');
  run = remove(dest, ['--apply']);
  assert.equal(run.status, 1);
  git(dest, 'stash', 'push', '-q');
  run = remove(dest, ['--apply']);
  assert.equal(run.status, 1);
  assert.ok(run.json.refusals.some(r => /stash/.test(r)));
  assert.equal(fs.existsSync(dest), true);
});

test('remove: refuses unpushed commits when the remote branch does not exist, then allows them once pushed', { skip }, () => {
  const fx = fixture();
  assert.equal(create(fx, 'work').status, 0);
  const dest = path.join(fx.work, 'work');
  fs.writeFileSync(path.join(dest, 'feature.txt'), 'f');
  git(dest, 'add', '.');
  git(dest, 'commit', '-qm', 'feature');
  let run = remove(dest, ['--apply']);
  assert.equal(run.status, 1);
  assert.ok(run.json.refusals.some(r => /base commit/.test(r)), JSON.stringify(run.json));
  assert.equal(fs.existsSync(dest), true);
  git(dest, 'push', '-q', 'origin', 'task/work');
  run = remove(dest);
  assert.equal(run.status, 0, JSON.stringify(run.json));
});

test('remove: refuses commits that are on HEAD and not on origin/<branch>', { skip }, () => {
  const fx = fixture();
  assert.equal(create(fx, 'ahead').status, 0);
  const dest = path.join(fx.work, 'ahead');
  git(dest, 'push', '-q', 'origin', 'task/ahead');
  fs.writeFileSync(path.join(dest, 'later.txt'), 'l');
  git(dest, 'add', '.');
  git(dest, 'commit', '-qm', 'later');
  const run = remove(dest, ['--apply']);
  assert.equal(run.status, 1);
  assert.ok(run.json.refusals.some(r => /not on origin/.test(r)), JSON.stringify(run.json));
  assert.equal(fs.existsSync(dest), true);
});

test('remove: refuses when origin cannot be reached', { skip }, () => {
  const fx = fixture();
  assert.equal(create(fx, 'offline').status, 0);
  const dest = path.join(fx.work, 'offline');
  git(dest, 'remote', 'set-url', 'origin', path.join(fx.home, 'no-such-origin.git'));
  const run = remove(dest, ['--apply']);
  assert.equal(run.status, 1);
  assert.ok(run.json.refusals.some(r => /origin/.test(r)));
  assert.equal(fs.existsSync(dest), true);
});

test('remove: refuses a marker that is not valid', { skip }, () => {
  const fx = fixture();
  assert.equal(create(fx, 'badmarker').status, 0);
  const dest = path.join(fx.work, 'badmarker');
  fs.writeFileSync(path.join(dest, '.git', 'lane-tree.json'), '{"schema":"other"}');
  const run = remove(dest, ['--apply']);
  assert.equal(run.status, 1);
  assert.ok(run.json.refusals.some(r => /marker/.test(r)));
  assert.equal(fs.existsSync(dest), true);
});

test('remove: refuses a lane that holds an ignored file outside the allowlist, and allows node_modules, .trellis, and .DS_Store', { skip }, () => {
  const fx = fixture();
  assert.equal(create(fx, 'ignored').status, 0);
  const dest = path.join(fx.work, 'ignored');
  fs.mkdirSync(path.join(dest, 'node_modules/pkg'), { recursive: true });
  fs.mkdirSync(path.join(dest, 'apps/desktop/node_modules/dep'), { recursive: true });
  fs.writeFileSync(path.join(dest, 'node_modules/pkg/index.js'), 'x');
  fs.writeFileSync(path.join(dest, 'apps/desktop/node_modules/dep/index.js'), 'x');
  fs.writeFileSync(path.join(dest, '.git/info/exclude'), '.trellis/\n.DS_Store\n.env\n*.pem\n');
  fs.mkdirSync(path.join(dest, '.trellis/gates'), { recursive: true });
  fs.writeFileSync(path.join(dest, '.trellis/gates/x.log'), 'log');
  fs.writeFileSync(path.join(dest, '.DS_Store'), 'x');
  let run = remove(dest);
  assert.equal(run.status, 0, JSON.stringify(run.json));
  fs.writeFileSync(path.join(dest, '.env'), 'SECRET=1\n');
  run = remove(dest, ['--apply']);
  assert.equal(run.status, 1);
  assert.ok(run.json.refusals.some(r => /ignored/.test(r) && /\.env/.test(r)), JSON.stringify(run.json));
  assert.equal(fs.existsSync(path.join(dest, '.env')), true, 'nothing was deleted');
  fs.rmSync(path.join(dest, '.env'));
  fs.mkdirSync(path.join(dest, 'keys'));
  fs.writeFileSync(path.join(dest, 'keys/server.pem'), 'x');
  run = remove(dest, ['--apply']);
  assert.equal(run.status, 1, 'an ignored file inside a plain folder is refused too');
  fs.rmSync(path.join(dest, 'keys'), { recursive: true });
  run = remove(dest, ['--apply']);
  assert.equal(run.status, 0, JSON.stringify(run.json));
  assert.equal(fs.existsSync(dest), false);
});

test('ignoredAllowed and parseStatus read git status entries', () => {
  for (const ok of ['node_modules/', 'apps/desktop/node_modules/', 'a/b/node_modules/pkg/x.js', '.trellis/', '.trellis/gates/a.log', '.DS_Store', 'sub/.DS_Store',
    'dist/', 'dist/index.js', 'apps/desktop/.trellis/', 'apps/desktop/.trellis/gates/a.log', 'a/b/c/.trellis/x']) assert.equal(ignoredAllowed(ok), true, ok);
  for (const bad of ['.env', 'keys/server.pem', 'node_modules_old/', 'x.trellis/', '.trellis-extra/', 'apps/desktop/dist/', 'sub/dist/', 'distro/', 'dist.js', 'a/x.trellis/y']) assert.equal(ignoredAllowed(bad), false, bad);
  assert.deepEqual(parseStatus(' M a.txt\0?? b.txt\0!! .env\0R  new.txt\0old.txt\0!! node_modules/\0'), { changed: ['a.txt', 'b.txt', 'new.txt'], ignored: ['.env', 'node_modules/'] });
});

test('remove: refuses a second local branch with commits that origin lacks, then allows it once pushed', { skip }, () => {
  const fx = fixture();
  assert.equal(create(fx, 'second').status, 0);
  const dest = path.join(fx.work, 'second');
  git(dest, 'push', '-q', 'origin', 'task/second');
  git(dest, 'checkout', '-q', '-b', 'scratch');
  fs.writeFileSync(path.join(dest, 'only-here.txt'), 'x');
  git(dest, 'add', '.');
  git(dest, 'commit', '-qm', 'only on scratch');
  git(dest, 'checkout', '-q', 'task/second');
  let run = remove(dest, ['--apply']);
  assert.equal(run.status, 1);
  assert.ok(run.json.refusals.some(r => /local branches are not on origin/.test(r)), JSON.stringify(run.json));
  assert.equal(fs.existsSync(path.join(dest, 'only-here.txt')) || fs.existsSync(dest), true);
  git(dest, 'push', '-q', 'origin', 'scratch');
  run = remove(dest);
  assert.equal(run.status, 0, JSON.stringify(run.json));
});

test('remove: refuses a detached HEAD', { skip }, () => {
  const fx = fixture();
  assert.equal(create(fx, 'detached').status, 0);
  const dest = path.join(fx.work, 'detached');
  git(dest, 'checkout', '-q', '--detach');
  const run = remove(dest, ['--apply']);
  assert.equal(run.status, 1);
  assert.ok(run.json.refusals.some(r => /detached/.test(r)), JSON.stringify(run.json));
  assert.equal(fs.existsSync(dest), true);
});

test('remove: a failed git stash list is a refusal, not a pass', { skip }, () => {
  const fx = fixture();
  assert.equal(create(fx, 'stashfail').status, 0);
  const dest = path.join(fx.work, 'stashfail');
  const wrapper = gitWrapper('case " $* " in *" stash "*) echo "fatal: simulated" >&2; exit 1;; esac');
  const run = remove(dest, ['--apply'], wrapper.env);
  assert.equal(run.status, 1);
  assert.ok(run.json.refusals.some(r => /stash/.test(r)), JSON.stringify(run.json));
  assert.equal(fs.existsSync(wrapper.ran), true, 'the wrapper ran');
  assert.equal(fs.existsSync(dest), true);
});

test('remove: refuses a local tag that origin lacks', { skip }, () => {
  const fx = fixture();
  assert.equal(create(fx, 'tagged').status, 0);
  const dest = path.join(fx.work, 'tagged');
  git(dest, 'tag', 'v-local');
  let run = remove(dest, ['--apply']);
  assert.equal(run.status, 1);
  assert.ok(run.json.refusals.some(r => /tag/.test(r) && /v-local/.test(r)), JSON.stringify(run.json));
  git(dest, 'push', '-q', 'origin', 'v-local');
  run = remove(dest);
  assert.equal(run.status, 0, JSON.stringify(run.json));
});

test('remove: refuses a marker forged in the primary checkout, and the checkout survives', { skip }, () => {
  const fx = fixture();
  const forged = { schema: MARKER_SCHEMA, name: 'fake', source: fx.home, base: BASE, branch: BASE, baseCommit: fx.baseCommit, dest: fx.source, nonce: 'a'.repeat(32), createdAt: new Date().toISOString() };
  fs.writeFileSync(path.join(fx.source, '.git', 'lane-tree.json'), JSON.stringify(forged));
  let run = remove(fx.source, ['--apply']);
  assert.equal(run.status, 1);
  assert.ok(run.json.refusals.some(r => /nonce/.test(r)), JSON.stringify(run.json));
  assert.equal(fs.existsSync(path.join(fx.source, 'README.md')), true);
  // Even with the nonce also written into the config, a marker that names another source and dest is only as good as the other checks; a wrong dest is refused.
  git(fx.source, 'config', 'laneTree.nonce', 'a'.repeat(32));
  fs.writeFileSync(path.join(fx.source, '.git', 'lane-tree.json'), JSON.stringify({ ...forged, dest: fx.home }));
  run = remove(fx.source, ['--apply']);
  assert.equal(run.status, 1);
  assert.ok(run.json.refusals.some(r => /different folder/.test(r)), JSON.stringify(run.json));
  assert.equal(fs.existsSync(path.join(fx.source, 'README.md')), true);
});

test('remove: refuses a marker whose nonce does not match, a copied marker, and an old-format marker', { skip }, () => {
  const fx = fixture();
  assert.equal(create(fx, 'nonce-bad').status, 0);
  const dest = path.join(fx.work, 'nonce-bad');
  const original = readMarker(dest);
  writeMarker(dest, { nonce: 'b'.repeat(32) });
  let run = remove(dest, ['--apply']);
  assert.ok(run.json.refusals.some(r => /nonce/.test(r)), JSON.stringify(run.json));
  writeMarker(dest, { nonce: original.nonce, dest: path.join(fx.work, 'elsewhere') });
  run = remove(dest, ['--apply']);
  assert.ok(run.json.refusals.some(r => /different folder/.test(r)), JSON.stringify(run.json));
  writeMarker(dest, { dest: original.dest, schema: 'bowerloom/lane-tree/v1' });
  run = remove(dest, ['--apply']);
  assert.ok(run.json.refusals.some(r => /not valid/.test(r)), JSON.stringify(run.json));
  assert.equal(fs.existsSync(dest), true);
});

test('remove: refuses when dest is or contains the marker source, the current folder, or the home folder', { skip }, () => {
  const fx = fixture();
  assert.equal(create(fx, 'guarded').status, 0);
  const dest = path.join(fx.work, 'guarded');
  fs.mkdirSync(path.join(dest, 'sub'));
  const original = readMarker(dest);
  for (const source of [dest, path.join(dest, 'sub')]) {
    writeMarker(dest, { source });
    const run = remove(dest, ['--apply']);
    assert.equal(run.status, 1, source);
    assert.ok(run.json.refusals.some(r => /source repository/.test(r)), JSON.stringify(run.json));
  }
  writeMarker(dest, { source: original.source });
  let run = remove(dest, ['--apply'], {}, path.join(dest, 'sub'));
  assert.equal(run.status, 1);
  assert.ok(run.json.refusals.some(r => /current folder/.test(r)), JSON.stringify(run.json));
  run = remove(dest, ['--apply'], { HOME: path.join(dest, 'sub') });
  assert.equal(run.status, 1);
  assert.ok(run.json.refusals.some(r => /home folder/.test(r)), JSON.stringify(run.json));
  assert.equal(fs.existsSync(dest), true);
  // The same lane is removable once none of the three applies.
  assert.equal(remove(dest, ['--apply']).status, 0);
});

test('remove: a branch name in the marker that git could read as an option is refused and runs nothing', { skip }, () => {
  const fx = fixture();
  assert.equal(create(fx, 'inject').status, 0);
  const dest = path.join(fx.work, 'inject');
  const payload = path.join(fx.home, 'payload-ran');
  writeMarker(dest, { branch: `--upload-pack=touch ${payload}` });
  const run = remove(dest, ['--apply']);
  assert.equal(run.status, 1);
  assert.equal(fs.existsSync(payload), false, 'the payload never ran');
  assert.equal(fs.existsSync(dest), true);
});

test('remove --apply=false, --json=x, and --apply=0 are usage errors that delete nothing', { skip }, () => {
  const fx = fixture();
  assert.equal(create(fx, 'inline').status, 0);
  const dest = path.join(fx.work, 'inline');
  for (const flag of ['--apply=false', '--apply=0', '--apply=', '--apply=true']) {
    const run = lane(null, ['remove', '--dest', dest, flag]);
    assert.equal(run.status, 2, flag);
    assert.equal(run.json.ok, false);
    assert.equal(run.json.exit, 2);
    assert.match(run.json.error, /takes no value/);
    assert.equal(fs.existsSync(dest), true, flag);
  }
  const jsonValue = spawnSync(process.execPath, [script, 'remove', '--dest', dest, '--json=x'], { encoding: 'utf8', env: GIT_ENV });
  assert.equal(jsonValue.status, 2);
  assert.deepEqual(Object.keys(JSON.parse(jsonValue.stdout)).sort(), ['error', 'exit', 'ok']);
  assert.equal(fs.existsSync(dest), true);
});

test('a usage error with --json prints exactly one JSON object on stdout, and a value that starts with -- is refused', () => {
  for (const argv of [['frob'], ['create'], ['remove'], ['create', '--bogus'], ['remove', '--dest=--apply'], ['list', '--root=--json']]) {
    const run = spawnSync(process.execPath, [script, ...argv, '--json'], { encoding: 'utf8', env: GIT_ENV });
    assert.equal(run.status, 2, JSON.stringify(argv));
    assert.equal(run.stdout.trim().split('\n').length, 1);
    const json = JSON.parse(run.stdout);
    assert.deepEqual({ ok: json.ok, exit: json.exit, hasError: typeof json.error === 'string' && json.error !== '' }, { ok: false, exit: 2, hasError: true });
  }
});

test('the --source seam is refused unless the test-mode variable is set', () => {
  const { BOWERLOOM_TOOLS_TEST_MODE: _t, ...without } = GIT_ENV;
  const run = spawnSync(process.execPath, [script, 'list', '--source', os.tmpdir(), '--json'], { encoding: 'utf8', env: without });
  assert.equal(run.status, 2);
  assert.match(JSON.parse(run.stdout).error, /BOWERLOOM_TOOLS_TEST_MODE/);
  assert.ok(parseArgs(['list', '--source', '/x'], {}).usage);
  assert.equal(parseArgs(['list', '--source', '/x'], { BOWERLOOM_TOOLS_TEST_MODE: '1' }).usage, null);
});

test('lowDiskSkip skips below the threshold with a "skipped: low disk" message and runs above it', () => {
  assert.equal(lowDiskSkip((DEFAULT_FLOOR_GIB + 1) * GIB + 1), false);
  assert.match(lowDiskSkip((DEFAULT_FLOOR_GIB + 1) * GIB), /^skipped: low disk/);
  assert.match(lowDiskSkip(0), /^skipped: low disk/);
});

// ---- list ----

test('list: finds the folders that carry the marker and skips the rest', { skip }, () => {
  const fx = fixture();
  assert.equal(create(fx, 'one').status, 0);
  assert.equal(create(fx, 'two', ['--branch', 'task/second']).status, 0);
  git(fx.work, 'clone', '-q', fx.origin, path.join(fx.work, 'plain'));
  fs.mkdirSync(path.join(fx.work, 'empty'));
  fs.symlinkSync(path.join(fx.work, 'one'), path.join(fx.work, 'alias'));
  const run = lane(fx, ['list', '--root', fx.work]);
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.json.ok, true);
  assert.deepEqual(run.json.lanes.map(l => l.name).sort(), ['one', 'two']);
  const two = run.json.lanes.find(l => l.name === 'two');
  assert.equal(two.branch, 'task/second');
  assert.equal(two.path, path.join(fx.work, 'two'));
  assert.equal(two.base, BASE);
  assert.ok(two.createdAt);
});

test('list: an empty folder gives an empty list, and a relative or missing root is refused', () => {
  const root = tmp();
  const empty = lane(null, ['list', '--root', root]);
  assert.equal(empty.status, 0);
  assert.deepEqual(empty.json.lanes, []);
  assert.equal(lane(null, ['list', '--root', 'relative']).status, 1);
  assert.equal(lane(null, ['list', '--root', path.join(root, 'absent')]).status, 1);
});

test('list: with no --root and no resolvable source repository is exit 2', () => {
  const notRepo = tmp();
  const run = lane(null, ['list', '--source', notRepo]);
  assert.equal(run.status, 2);
  assert.equal(run.json.ok, false);
  assert.match(run.json.error, /--root/);
});

test('list: changes nothing in the folder it reads', { skip }, () => {
  const fx = fixture();
  assert.equal(create(fx, 'still').status, 0);
  const before = JSON.stringify(fs.readdirSync(path.join(fx.work, 'still', '.git')).sort());
  lane(fx, ['list', '--root', fx.work]);
  assert.equal(JSON.stringify(fs.readdirSync(path.join(fx.work, 'still', '.git')).sort()), before);
});

// ---- Rules added in the final fix round ----

/** A `git` wrapper that logs each call's arguments, one line each, to `log`, then runs `intercept` and the real git. */
const loggingGit = (log, intercept = '') => gitWrapper(`echo "git $*" >> ${JSON.stringify(log)}\n${intercept}`);
const SAFE_FLAGS = ['core.fsmonitor=false', 'core.hooksPath=/dev/null', 'protocol.ext.allow=never'];

test('remove: runs du first, before it reads the status', { skip }, () => {
  const fx = fixture();
  assert.equal(create(fx, 'order').status, 0);
  const dest = path.join(fx.work, 'order');
  const log = path.join(fx.home, 'order.log');
  const bin = tmp();
  fs.writeFileSync(path.join(bin, 'du'), `#!/bin/sh\necho du >> ${JSON.stringify(log)}\nexec /usr/bin/du "$@"\n`, { mode: 0o755 });
  const wrapper = loggingGit(log);
  const run = remove(dest, [], { PATH: `${wrapper.bin}${path.delimiter}${bin}${path.delimiter}${process.env.PATH}` });
  assert.equal(run.status, 0, run.stderr + run.stdout);
  const lines = fs.readFileSync(log, 'utf8').trim().split('\n');
  const du = lines.indexOf('du'), status = lines.findIndex(line => / status /.test(line));
  assert.ok(du >= 0 && status >= 0, lines.join('\n'));
  assert.ok(du < status, `du (${du}) runs before status (${status})`);
  assert.equal(lines.filter(line => line === 'du').length, 1, 'du runs once');
});

for (const [label, fragment] of [
  ['an untracked file appears', dest => `echo late > ${JSON.stringify(dest)}/late.txt`],
  ['a commit is made', dest => `${JSON.stringify(realGit)} -C ${JSON.stringify(dest)} -c user.name=t -c user.email=t@example.com commit -q --allow-empty -m late`],
  ['a stash entry appears', dest => `echo more >> ${JSON.stringify(dest)}/README.md; ${JSON.stringify(realGit)} -C ${JSON.stringify(dest)} -c user.name=t -c user.email=t@example.com stash -q`],
]) {
  test(`remove --apply: refuses and deletes nothing when ${label} between the inspection and the delete`, { skip }, () => {
    const fx = fixture();
    const name = 'late' + label.length;
    assert.equal(create(fx, name).status, 0);
    const dest = path.join(fx.work, name);
    const counter = path.join(fx.home, 'count');
    // The trigger belongs to the second call of the git subcommand that the check reads, which is the re-check made just before the delete.
    const sub = label.startsWith('an untracked') ? 'status' : label.startsWith('a commit') ? 'stash' : 'stash';
    const wrapper = gitWrapper(`case " $* " in *" ${sub} "*) n=$(cat ${JSON.stringify(counter + sub)} 2>/dev/null || echo 0); n=$((n+1)); echo $n > ${JSON.stringify(counter + sub)}; if [ $n = 2 ]; then ${fragment(dest)}; fi;; esac`);
    const run = remove(dest, ['--apply'], wrapper.env);
    assert.equal(run.status, 1, run.stdout + run.stderr);
    assert.equal(run.json.removed, false);
    assert.ok(run.json.refusals.some(r => /changed since the inspection/.test(r)), JSON.stringify(run.json));
    assert.equal(fs.existsSync(dest), true, 'the lane was not deleted');
  });
}

test('remove: every git command that targets the lane carries the three safety options', { skip }, () => {
  const fx = fixture();
  assert.equal(create(fx, 'flags').status, 0);
  const dest = path.join(fx.work, 'flags');
  const log = path.join(fx.home, 'flags.log');
  const wrapper = loggingGit(log);
  const run = remove(dest, ['--apply'], wrapper.env);
  assert.equal(run.status, 0, run.stderr + run.stdout);
  const lines = fs.readFileSync(log, 'utf8').trim().split('\n');
  assert.ok(lines.length >= 10, `${lines.length} git calls were logged`);
  for (const line of lines) for (const flag of SAFE_FLAGS) assert.ok(line.includes(`-c ${flag}`), `${flag} in: ${line}`);
});

test('remove: a core.fsmonitor command in the lane config is not run, and a protocol.ext.allow=always override does not run an ext:: remote', { skip }, () => {
  const fx = fixture();
  assert.equal(create(fx, 'hostile').status, 0);
  const dest = path.join(fx.work, 'hostile');
  const ranMonitor = path.join(fx.home, 'monitor-ran'), ranExt = path.join(fx.home, 'ext-ran');
  const monitor = path.join(fx.home, 'monitor.sh');
  fs.writeFileSync(monitor, `#!/bin/sh\ntouch ${JSON.stringify(ranMonitor)}\n`, { mode: 0o755 });
  git(dest, 'config', 'core.fsmonitor', monitor);
  git(dest, 'config', 'protocol.ext.allow', 'always');
  git(dest, 'remote', 'set-url', 'origin', `ext::sh -c "touch ${ranExt}" %S`);
  const run = remove(dest, ['--apply']);
  assert.equal(run.status, 1);
  assert.equal(fs.existsSync(ranMonitor), false, 'the fsmonitor command never ran');
  assert.equal(fs.existsSync(ranExt), false, 'the ext:: remote never ran');
  assert.equal(fs.existsSync(dest), true);
});

test('remove: git error text in a refusal is redacted', { skip }, () => {
  const fx = fixture();
  assert.equal(create(fx, 'redacted').status, 0);
  const dest = path.join(fx.work, 'redacted');
  const token = ['gh', 'p_', 'A1b2C3d4E5f6'.repeat(3)].join('');
  const wrapper = gitWrapper(`case " $* " in *" stash "*) echo "fatal: remote https://user:${token}@example.com failed" >&2; exit 1;; esac`);
  const run = remove(dest, ['--apply'], wrapper.env);
  assert.equal(run.status, 1);
  const text = JSON.stringify(run.json);
  assert.equal(text.includes(token), false);
  assert.match(text, /\[redacted\]/);
  assert.equal(run.stderr.includes(token), false);
});

test('create: claims the destination atomically and never deletes a folder that appeared meanwhile', { skip }, () => {
  const fx = fixture();
  const dest = path.join(fx.work, 'raced');
  // Another process makes the folder after the first look at dest and before the claim; the wrapper does it at the disk-size step.
  const wrapper = gitWrapper(`case " $* " in *" --absolute-git-dir "*) mkdir -p ${JSON.stringify(dest)}; echo keep > ${JSON.stringify(path.join(dest, 'precious.txt'))};; esac`);
  const run = create(fx, 'raced', [], wrapper.env);
  assert.equal(run.status, 1, run.stdout + run.stderr);
  assert.match(run.json.refused, /already exists/);
  assert.equal(run.json.cleanedPartial, false);
  assert.equal(fs.readFileSync(path.join(dest, 'precious.txt'), 'utf8'), 'keep\n', 'the other folder is untouched');
});

test('create: when a step fails after the claim, the folder it made is removed', { skip }, () => {
  const fx = fixture();
  const run = create(fx, 'claimed', ['--base', 'release/does-not-exist']);
  assert.equal(run.status, 1);
  assert.equal(run.json.cleanedPartial, true);
  assert.equal(fs.existsSync(path.join(fx.work, 'claimed')), false);
});

test('usage says that remove refuses a lane whose branch was squash-merged and deleted on origin, so it is deleted by hand', () => {
  const help = spawnSync(process.execPath, [script, '--help'], { encoding: 'utf8' });
  assert.match(help.stdout.replace(/\s+/g, ' '), /squash-merged and deleted on origin.*by hand/);
});

test('a word that names an Object.prototype member is a usage error, not a subcommand or a flag', () => {
  for (const word of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
    assert.match(parseArgs([word]).usage ?? '', /unknown subcommand/, word);
    assert.match(parseArgs(['list', `--${word}`]).usage ?? '', /unknown argument/, word);
    assert.match(parseArgs(['remove', '--dest', '/x', word]).usage ?? '', /unknown argument/, word);
  }
  for (const word of ['constructor', 'toString']) {
    const run = spawnSync(process.execPath, [script, word, '--json'], { encoding: 'utf8' });
    assert.equal(run.status, 2, word);
    assert.equal(JSON.parse(run.stdout).exit, 2);
  }
});

test('a different file named lane-tree.mjs that imports the real one makes it print an error and exit 2', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'lane-tree.mjs'), `import ${JSON.stringify(script)};\n`);
  const run = spawnSync(process.execPath, [path.join(dir, 'lane-tree.mjs'), '--help'], { encoding: 'utf8' });
  assert.equal(run.status, 2);
  assert.match(run.stderr, /lane-tree: the program started as .* is not this script/);
  assert.equal(run.stdout, '');
});

test('gates --clean on a lane, then remove --apply: the build outputs gates cleans (root dist included) and the .trellis folders at any depth do not block the removal', { skip }, () => {
  const fx = fixture();
  assert.equal(create(fx, 'cleaned').status, 0);
  const dest = path.join(fx.work, 'cleaned');
  const ignore = ['dist/', 'apps/desktop/.build/', 'apps/desktop/dist/', 'apps/desktop/test-results/', 'test-results/', '.trellis/', 'apps/desktop/.trellis/', '/package.json', '/step.mjs'];
  fs.writeFileSync(path.join(dest, '.git/info/exclude'), ignore.join('\n') + '\n');
  // A fake build: the one gate step that runs is a script that writes every kind of output a real run leaves.
  const outputs = ['dist/bundle.js', 'apps/desktop/.build/x.bin', 'apps/desktop/dist/y.js', 'apps/desktop/test-results/z.json', 'test-results/w.json', 'apps/desktop/.trellis/gates/n.log'];
  fs.writeFileSync(path.join(dest, 'step.mjs'), [
    "import fs from 'node:fs'; import path from 'node:path';",
    `for (const rel of ${JSON.stringify(outputs)}) { fs.mkdirSync(path.dirname(rel), { recursive: true }); fs.writeFileSync(rel, 'x'); }`,
    "console.log('ℹ tests 1\\nℹ pass 1\\nℹ fail 0\\nℹ skipped 0');",
  ].join('\n'));
  fs.writeFileSync(path.join(dest, 'package.json'), JSON.stringify({ name: 'fake', private: true, scripts: { typecheck: 'node step.mjs', test: 'node step.mjs' } }));
  const ran = spawnSync(process.execPath, [gatesScript, '--root', dest, '--json', '--only', 'root-typecheck', '--clean', '--min-free-gib', '12'], { encoding: 'utf8', env: { ...GIT_ENV, ...process.env, BOWERLOOM_TOOLS_TEST_MODE: '1' }, timeout: 120000 });
  assert.equal(ran.status, 0, ran.stdout + ran.stderr);
  const summary = JSON.parse(ran.stdout);
  assert.ok(summary.clean.removed.some(r => r.path === 'dist'), 'root dist was cleaned');
  assert.equal(fs.existsSync(path.join(dest, 'dist')), false);
  assert.equal(fs.existsSync(path.join(dest, '.trellis/gates')), true, 'the gate logs stay');
  fs.rmSync(path.join(dest, 'step.mjs')); fs.rmSync(path.join(dest, 'package.json'));
  const run = remove(dest, ['--apply']);
  assert.equal(run.status, 0, JSON.stringify(run.json));
  assert.equal(fs.existsSync(dest), false);
  // The same lane with a root dist left behind and nested .trellis is also removable (both are allowed ignored paths).
});
