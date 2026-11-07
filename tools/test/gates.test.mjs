import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import { parseArgs, selectSteps, cleanOutputs, checkInstallersRecorded, CLEAN_PATHS, INSTALLER_PATHS, HASH_SCHEMA, STEPS, DEFAULT_FLOOR_GIB, main } from '../gates.mjs';
import { freeBytes, GIB } from '../lib/run-child.mjs';

const script = fileURLToPath(new URL('../gates.mjs', import.meta.url));
/** The skip value for a test that runs the gates: false when there is room, else a message that starts with "skipped: low disk". */
export const lowDiskSkip = free => (free > (DEFAULT_FLOOR_GIB + 1) * GIB ? false : `skipped: low disk (under ${DEFAULT_FLOOR_GIB + 1} GiB free in the temp folder)`);
const MODE = { BOWERLOOM_TOOLS_TEST_MODE: '1' };
const made = [];
test.after(() => { for (const dir of made) fs.rmSync(dir, { recursive: true, force: true }); });
const tmp = () => { const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'gates-test-'))); made.push(dir); return dir; };

test('parseArgs applies the defaults and rejects wrong use', () => {
  const ok = parseArgs([]);
  assert.deepEqual({ e2e: ok.e2e, build: ok.build, clean: ok.clean, installers: ok.cleanInstallers, json: ok.json, only: ok.only, floor: ok.floorGiB }, { e2e: false, build: false, clean: false, installers: false, json: false, only: null, floor: 12 });
  assert.equal(parseArgs(['--clean-installers']).cleanInstallers, true);
  assert.equal(parseArgs(['--min-free-gib', '20']).floorGiB, 20);
  assert.equal(parseArgs(['--min-free-gib=12']).floorGiB, 12);
  assert.deepEqual(parseArgs(['--only', 'root-test,desktop-test']).only, ['root-test', 'desktop-test']);
  for (const bad of [['--min-free-gib', '5'], ['--min-free-gib', 'abc'], ['--min-free-gib'], ['--only', 'nope'], ['--only', ''], ['--bogus'], ['stray'], ['--timeout-seconds', '0'], ['--root', 'relative/path']]) {
    assert.ok(parseArgs(bad, MODE).usage, JSON.stringify(bad));
  }
  // A flag with no value rejects one, and an inline value that starts with -- is refused.
  for (const flag of ['--json', '--e2e', '--build', '--clean', '--clean-installers', '--help']) {
    for (const value of ['false', '0', '', 'x', 'true']) assert.match(parseArgs([`${flag}=${value}`]).usage, /takes no value/, `${flag}=${value}`);
  }
  assert.ok(parseArgs(['--only=--e2e']).usage);
  assert.ok(parseArgs(['--min-free-gib=--json']).usage);
  // --e2e or --build with --only must name the matching step.
  assert.ok(parseArgs(['--e2e', '--only', 'root-test']).usage);
  assert.ok(parseArgs(['--build', '--only', 'desktop-test']).usage);
  assert.equal(parseArgs(['--e2e', '--only', 'desktop-e2e,root-test']).usage, null);
  assert.equal(parseArgs(['--build', '--only', 'desktop-build']).usage, null);
  // The test seams need the test-mode variable.
  for (const seam of [['--root', '/x'], ['--lock-dir', '/x'], ['--timeout-seconds', '5'], ['--root=/x']]) {
    assert.match(parseArgs(seam, {}).usage, /BOWERLOOM_TOOLS_TEST_MODE/, seam.join(' '));
    assert.equal(parseArgs(seam, MODE).usage, null, seam.join(' '));
  }
  assert.ok(parseArgs(['--only', 'desktop-e2e']).usage, 'e2e by name still needs --e2e');
  assert.ok(parseArgs(['--only', 'desktop-build']).usage, 'build by name still needs --build');
  assert.equal(parseArgs(['--help']).help, true);
});

test('the skip helper skips below the threshold with a "skipped: low disk" message and runs above it', () => {
  assert.equal(lowDiskSkip((DEFAULT_FLOOR_GIB + 1) * GIB + 1), false);
  assert.match(lowDiskSkip((DEFAULT_FLOOR_GIB + 1) * GIB), /^skipped: low disk/);
  assert.match(lowDiskSkip(0), /^skipped: low disk/);
});

test('selectSteps keeps the order, and adds e2e and build only on request', () => {
  const names = args => selectSteps(parseArgs(args)).map(step => step.name);
  assert.deepEqual(names([]), ['root-typecheck', 'root-test', 'desktop-typecheck', 'desktop-test']);
  assert.deepEqual(names(['--e2e', '--build']), ['root-typecheck', 'root-test', 'desktop-typecheck', 'desktop-test', 'desktop-e2e', 'desktop-build']);
  assert.deepEqual(names(['--only', 'desktop-test,root-typecheck']), ['root-typecheck', 'desktop-test']);
  assert.deepEqual(names(['--only', 'desktop-e2e', '--e2e']), ['desktop-e2e']);
  assert.equal(STEPS.filter(step => step.expectCounts).map(step => step.name).join(), 'root-test,desktop-test,desktop-e2e');
  assert.deepEqual(STEPS.map(s => s.command.join(' ')), ['npm run typecheck', 'npm test', 'npm run typecheck', 'npm test', 'npm run e2e', 'npm run build']);
  assert.deepEqual(STEPS.map(s => s.cwd), ['.', '.', 'apps/desktop', 'apps/desktop', 'apps/desktop', 'apps/desktop']);
});

test('cleanOutputs removes only the allowlisted build outputs and reports bytes; the installers are not in the default list', async () => {
  const root = tmp();
  assert.equal(CLEAN_PATHS.includes('apps/desktop/release'), false);
  assert.equal(CLEAN_PATHS.includes('dist'), true, 'root npm test writes dist');
  assert.deepEqual(INSTALLER_PATHS, ['apps/desktop/release']);
  for (const rel of [...CLEAN_PATHS, ...INSTALLER_PATHS]) { fs.mkdirSync(path.join(root, rel), { recursive: true }); fs.writeFileSync(path.join(root, rel, 'file.bin'), Buffer.alloc(1000)); }
  fs.mkdirSync(path.join(root, 'apps/desktop/src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'apps/desktop/src/keep.ts'), 'keep');
  fs.mkdirSync(path.join(root, 'release'), { recursive: true });
  fs.writeFileSync(path.join(root, 'release/keep.json'), '{}');
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src/keep.js'), '');
  const result = cleanOutputs(root);
  assert.deepEqual(result.removed.map(r => r.path).sort(), [...CLEAN_PATHS].sort());
  assert.ok(result.freedBytes >= 4000);
  assert.deepEqual(result.refused, []);
  assert.equal(result.error, null);
  for (const rel of CLEAN_PATHS) assert.equal(fs.existsSync(path.join(root, rel)), false, rel);
  for (const rel of ['apps/desktop/src/keep.ts', 'release/keep.json', 'src/keep.js', 'apps/desktop/release/file.bin']) assert.equal(fs.existsSync(path.join(root, rel)), true, rel);
  const installers = cleanOutputs(root, INSTALLER_PATHS);
  assert.deepEqual(installers.removed.map(r => r.path), ['apps/desktop/release']);
  assert.equal(fs.existsSync(path.join(root, 'apps/desktop/release')), false);
});

test('cleanOutputs skips a missing path quietly', () => {
  const result = cleanOutputs(tmp());
  assert.deepEqual(result, { removed: [], refused: [], freedBytes: 0, error: null });
});

test('cleanOutputs refuses a path that is a symlink and leaves the target alone', () => {
  const root = tmp(), outside = tmp();
  fs.writeFileSync(path.join(outside, 'precious.txt'), 'keep');
  fs.mkdirSync(path.join(root, 'apps/desktop'), { recursive: true });
  fs.symlinkSync(outside, path.join(root, 'apps/desktop/dist'));
  fs.symlinkSync(outside, path.join(root, 'test-results'));
  const result = cleanOutputs(root);
  assert.deepEqual(result.removed, []);
  assert.deepEqual(result.refused.map(r => r.path).sort(), ['apps/desktop/dist', 'test-results']);
  assert.match(result.refused[0].reason, /symlink/);
  assert.equal(fs.readFileSync(path.join(outside, 'precious.txt'), 'utf8'), 'keep');
  assert.equal(fs.lstatSync(path.join(root, 'test-results')).isSymbolicLink(), true);
});

test('cleanOutputs refuses a path that reaches outside the repository through a linked parent', () => {
  const root = tmp(), outside = tmp();
  fs.mkdirSync(path.join(outside, 'dist'), { recursive: true });
  fs.writeFileSync(path.join(outside, 'dist/precious.txt'), 'keep');
  fs.mkdirSync(path.join(root, 'apps'), { recursive: true });
  fs.symlinkSync(outside, path.join(root, 'apps/desktop'));
  const result = cleanOutputs(root);
  assert.deepEqual(result.removed, []);
  assert.ok(result.refused.some(r => r.path === 'apps/desktop/dist' && /outside/.test(r.reason)), JSON.stringify(result));
  assert.equal(fs.existsSync(path.join(outside, 'dist/precious.txt')), true);
});

test('cleanOutputs refuses a linked parent that stays inside the repository, because the real path is not the path (strict match)', () => {
  const root = tmp();
  fs.mkdirSync(path.join(root, 'apps/other/dist'), { recursive: true });
  fs.writeFileSync(path.join(root, 'apps/other/dist/file.txt'), 'keep');
  fs.symlinkSync(path.join(root, 'apps/other'), path.join(root, 'apps/desktop'));
  const result = cleanOutputs(root);
  assert.deepEqual(result.removed, []);
  assert.ok(result.refused.some(r => r.path === 'apps/desktop/dist'), JSON.stringify(result));
  assert.equal(fs.existsSync(path.join(root, 'apps/other/dist/file.txt')), true);
});

test('cleanOutputs reports a path it cannot remove in error and still handles the others', { skip: process.getuid?.() === 0 ? 'skipped: running as root' : false }, () => {
  const root = tmp();
  fs.mkdirSync(path.join(root, 'apps/desktop/.build'), { recursive: true });
  fs.writeFileSync(path.join(root, 'apps/desktop/.build/x.bin'), 'x');
  fs.mkdirSync(path.join(root, 'test-results'));
  fs.chmodSync(path.join(root, 'apps/desktop'), 0o555); // .build cannot be removed from a read-only parent
  try {
    const result = cleanOutputs(root);
    assert.match(result.error, /apps\/desktop\/\.build/);
    assert.deepEqual(result.removed.map(r => r.path), ['test-results']);
  } finally { fs.chmodSync(path.join(root, 'apps/desktop'), 0o755); }
});

// ---- Integration: the script against a made-up repository root ----

/** Makes a root with a package.json at the top and in apps/desktop. `behaviour` maps a step name to { code, out } or a custom script body. */
function fakeRoot(behaviour = {}) {
  const root = tmp();
  fs.mkdirSync(path.join(root, 'apps/desktop'), { recursive: true });
  const body = (name, spec = {}) => {
    const file = `step-${name}.mjs`;
    const lines = [
      "import fs from 'node:fs'; import path from 'node:path';",
      `fs.appendFileSync(${JSON.stringify(path.join(root, 'trace.txt'))}, ${JSON.stringify(name)} + ' ' + path.basename(process.cwd()) + '\\n');`,
      spec.code === undefined && spec.body === undefined ? "console.log('ℹ tests 2\\nℹ pass 2\\nℹ fail 0\\nℹ skipped 0');" : '',
      spec.body ?? '',
      spec.out ? `console.log(${JSON.stringify(spec.out)});` : '',
      spec.hang ? '' : `process.exit(${spec.code ?? 0});`,
    ];
    return { file, text: lines.join('\n') };
  };
  const write = (dir, prefix, names, scripts) => {
    for (const [script, name] of names) {
      const { file, text } = body(`${prefix}${name}`, behaviour[`${prefix}${name}`]);
      fs.writeFileSync(path.join(dir, file), text);
      scripts[script] = `node ${file}`;
    }
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'fake', private: true, scripts }));
  };
  write(root, 'root-', [['typecheck', 'typecheck'], ['test', 'test']], {});
  write(path.join(root, 'apps/desktop'), 'desktop-', [['typecheck', 'typecheck'], ['test', 'test'], ['e2e', 'e2e'], ['build', 'build']], {});
  return root;
}
const gates = (root, args = [], env = {}) => spawnSync(process.execPath, [script, '--root', root, '--json', ...args], { encoding: 'utf8', env: { ...process.env, ...MODE, ...env }, timeout: 120000 });
/** True once no process has this pid (polls up to `ms`). */
async function goneWithin(pid, ms = 5000) {
  const end = Date.now() + ms;
  for (;;) {
    try { process.kill(pid, 0); } catch (error) { if (error.code === 'ESRCH') return true; throw error; }
    if (Date.now() > end) return false;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
}
async function waitFor(file, ms = 60000) {
  const end = Date.now() + ms;
  while (!fs.existsSync(file) && Date.now() < end) await new Promise(resolve => setTimeout(resolve, 50));
  return fs.existsSync(file);
}
const trace = root => fs.existsSync(path.join(root, 'trace.txt')) ? fs.readFileSync(path.join(root, 'trace.txt'), 'utf8').trim().split('\n') : [];
const skip = lowDiskSkip(freeBytes(os.tmpdir()));

test('gates: --help exits 0 and a wrong flag exits 2', { skip }, () => {
  const help = spawnSync(process.execPath, [script, '--help'], { encoding: 'utf8' });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /Usage: node tools\/gates\.mjs/);
  const bad = spawnSync(process.execPath, [script, '--nope'], { encoding: 'utf8' });
  assert.equal(bad.status, 2);
  assert.equal(spawnSync(process.execPath, [script, '--min-free-gib', '3'], { encoding: 'utf8' }).status, 2);
});

test('gates: runs the four default steps in order, prints one JSON object, and writes private logs', { skip }, () => {
  const root = fakeRoot();
  const run = gates(root);
  assert.equal(run.status, 0, run.stderr + run.stdout);
  const summary = JSON.parse(run.stdout);
  assert.equal(summary.ok, true);
  assert.equal(summary.failedStep, null);
  assert.deepEqual(summary.steps.map(s => s.name), ['root-typecheck', 'root-test', 'desktop-typecheck', 'desktop-test']);
  assert.deepEqual(trace(root), ['root-typecheck ' + path.basename(root), 'root-test ' + path.basename(root), 'desktop-typecheck desktop', 'desktop-test desktop']);
  for (const step of summary.steps) {
    assert.deepEqual(Object.keys(step).sort(), ['command', 'counts', 'cwd', 'exitCode', 'firstFailure', 'log', 'ms', 'name', 'passed', 'rawBytes', 'reason']);
    assert.equal(step.reason, null);
    assert.equal(step.passed, true);
    assert.equal(step.exitCode, 0);
    assert.deepEqual(step.counts, { pass: 2, fail: 0, skipped: 0 });
    assert.equal(step.firstFailure, null);
    assert.ok(step.rawBytes > 0);
    const log = path.join(root, '.trellis/gates', `${step.name}.log`);
    assert.equal(step.log, `.trellis/gates/${step.name}.log`);
    assert.equal(fs.statSync(log).mode & 0o777, 0o600);
    assert.ok(fs.statSync(log).size >= step.rawBytes - 0 && fs.readFileSync(log, 'utf8').includes('ℹ pass 2'));
  }
  assert.equal(summary.steps[0].command, 'npm run typecheck');
  assert.equal(summary.steps[3].cwd, 'apps/desktop');
  assert.ok(summary.floorGiB === 12 && summary.freeGiB > 12);
  assert.equal(summary.clean, null);
  assert.equal(summary.lockWarning, null);
  assert.equal(run.stdout.trim().split('\n').length, 1);
});

test('gates: stops at the first failing step, prints its first failing line, and exits 1', { skip }, () => {
  const root = fakeRoot({ 'root-test': { code: 1, out: 'a\nnot ok 1 - the broken case\nb', body: "console.log('# pass 4\\n# fail 1\\n# skipped 0');" } });
  const run = gates(root);
  assert.equal(run.status, 1);
  const summary = JSON.parse(run.stdout);
  assert.equal(summary.ok, false);
  assert.equal(summary.failedStep, 'root-test');
  assert.deepEqual(summary.steps.map(s => s.name), ['root-typecheck', 'root-test']);
  assert.deepEqual(summary.notRun, ['desktop-typecheck', 'desktop-test']);
  assert.equal(summary.steps[1].passed, false);
  assert.equal(summary.steps[1].exitCode, 1);
  assert.equal(summary.steps[1].firstFailure, 'not ok 1 - the broken case');
  assert.deepEqual(summary.steps[1].counts, { pass: 4, fail: 1, skipped: 0 });
  assert.equal(trace(root).length, 2);
});

test('gates: the human output names the failing line and not the whole log', { skip }, () => {
  const root = fakeRoot({ 'root-typecheck': { code: 2, out: Array.from({ length: 300 }, (_, i) => `noise line ${i}`).join('\n') + '\nsrc/a.ts(1,1): error TS2304: Cannot find name' } });
  const run = spawnSync(process.execPath, [script, '--root', root], { encoding: 'utf8', env: { ...process.env, ...MODE } });
  assert.equal(run.status, 1);
  assert.match(run.stdout, /root-typecheck/);
  assert.match(run.stdout, /error TS2304: Cannot find name/);
  assert.doesNotMatch(run.stdout, /noise line 5\b/);
  assert.ok(run.stdout.split('\n').length < 20);
});

test('gates: --only runs just the named steps', { skip }, () => {
  const root = fakeRoot();
  const run = gates(root, ['--only', 'desktop-test']);
  assert.equal(run.status, 0);
  assert.deepEqual(JSON.parse(run.stdout).steps.map(s => s.name), ['desktop-test']);
  assert.deepEqual(trace(root), ['desktop-test desktop']);
});

test('gates: --e2e takes the lock around the e2e step and releases it', { skip }, () => {
  const lock = path.join(tmp(), 'lock');
  const root = fakeRoot({ 'desktop-e2e': { body: `console.log(process.getBuiltinModule('node:fs').existsSync(${JSON.stringify(lock)}) ? 'LOCK_HELD' : 'LOCK_MISSING'); console.log('  3 passed (2.0s)\\n  1 skipped');` } });
  const run = gates(root, ['--e2e', '--lock-dir', lock]);
  assert.equal(run.status, 0, run.stderr + run.stdout);
  const summary = JSON.parse(run.stdout);
  const e2e = summary.steps.find(s => s.name === 'desktop-e2e');
  assert.deepEqual(e2e.counts, { pass: 3, fail: 0, skipped: 1 });
  assert.match(fs.readFileSync(path.join(root, '.trellis/gates/desktop-e2e.log'), 'utf8'), /LOCK_HELD/);
  assert.equal(fs.existsSync(lock), false, 'the lock is released');
});

test('gates: --e2e refuses at once, with a clear message, when the lock is held, and leaves the lock alone', { skip }, () => {
  const root = fakeRoot();
  const lock = path.join(tmp(), 'lock');
  fs.mkdirSync(lock);
  const run = gates(root, ['--e2e', '--lock-dir', lock]);
  assert.equal(run.status, 1);
  const summary = JSON.parse(run.stdout);
  assert.equal(summary.ok, false);
  assert.match(summary.refused, /lock/);
  assert.match(summary.refused, /held/);
  assert.deepEqual(summary.steps, []);
  assert.deepEqual(trace(root), []);
  assert.equal(fs.existsSync(lock), true, 'a lock that another run holds is never removed');
});

test('gates: the default lock is the repository path /tmp/bowerloom-test.lock', () => {
  const source = fs.readFileSync(script, 'utf8');
  assert.match(source, /'\/tmp\/bowerloom-test\.lock'/);
});

test('gates: the lock is released when the e2e step fails', { skip }, () => {
  const root = fakeRoot({ 'desktop-e2e': { code: 1, out: '  1) [electron] › e2e/x.spec.ts:1:1 › fails\n  1 failed' } });
  const lock = path.join(tmp(), 'lock');
  const run = gates(root, ['--e2e', '--lock-dir', lock]);
  assert.equal(run.status, 1);
  assert.equal(JSON.parse(run.stdout).failedStep, 'desktop-e2e');
  assert.equal(fs.existsSync(lock), false);
});

test('gates: --build runs the build step last', { skip }, () => {
  const root = fakeRoot();
  const run = gates(root, ['--build']);
  assert.equal(run.status, 0);
  assert.equal(JSON.parse(run.stdout).steps.at(-1).name, 'desktop-build');
  assert.equal(trace(root).at(-1), 'desktop-build desktop');
});

test('gates: refuses to start when free disk is under a raised floor', () => {
  const root = fakeRoot();
  const run = gates(root, ['--min-free-gib', '999999999']);
  assert.equal(run.status, 1);
  const summary = JSON.parse(run.stdout);
  assert.equal(summary.ok, false);
  assert.match(summary.refused, /free disk/);
  assert.deepEqual(summary.steps, []);
  assert.deepEqual(trace(root), []);
});

test('gates: no token reaches a step, and none is written to the log', { skip }, () => {
  const root = fakeRoot({ 'root-typecheck': { body: "console.log(JSON.stringify(Object.keys(process.env).filter(n => /TOKEN|_KEY$/.test(n))));" } });
  const run = gates(root, [], { GH_TOKEN: 'canary-aaa', GITHUB_TOKEN: 'canary-bbb', NPM_TOKEN: 'canary-ccc', SOME_API_KEY: 'canary-ddd' });
  assert.equal(run.status, 0);
  const log = fs.readFileSync(path.join(root, '.trellis/gates/root-typecheck.log'), 'utf8');
  assert.match(log, /\[\]/);
  assert.doesNotMatch(log + run.stdout, /canary-/);
});

test('gates: a step past its time limit is killed with its whole group and reported as failed', { skip }, async () => {
  const pidFile = path.join(tmp(), 'grandchild-pid');
  const body = `const g = process.getBuiltinModule('node:child_process').spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' }); fs.writeFileSync(${JSON.stringify(pidFile)}, String(g.pid)); setInterval(() => {}, 1000);`;
  const root = fakeRoot({ 'root-typecheck': { hang: true, body } });
  const run = gates(root, ['--timeout-seconds', '5']);
  assert.equal(run.status, 1, run.stderr + run.stdout);
  const step = JSON.parse(run.stdout).steps[0];
  assert.equal(step.passed, false);
  assert.equal(step.reason, 'TIME_LIMIT');
  assert.match(step.firstFailure, /limit/);
  assert.equal(await goneWithin(Number(fs.readFileSync(pidFile, 'utf8'))), true, 'the grandchild is gone');
});

test('gates: --clean removes build outputs after a failing run too, and reports the bytes', { skip }, () => {
  const root = fakeRoot({ 'desktop-test': { code: 1, out: 'not ok 1 - x' } });
  fs.mkdirSync(path.join(root, 'apps/desktop/.build'), { recursive: true });
  fs.writeFileSync(path.join(root, 'apps/desktop/.build/x.bin'), Buffer.alloc(4096));
  fs.mkdirSync(path.join(root, 'test-results'), { recursive: true });
  const run = gates(root, ['--clean']);
  assert.equal(run.status, 1);
  const summary = JSON.parse(run.stdout);
  assert.deepEqual(summary.clean.removed.map(r => r.path).sort(), ['apps/desktop/.build', 'test-results']);
  assert.ok(summary.clean.freedBytes >= 4096);
  assert.equal(fs.existsSync(path.join(root, 'apps/desktop/.build')), false);
  assert.equal(fs.existsSync(path.join(root, '.trellis/gates/desktop-test.log')), true, 'the logs stay');
});

test('gates: without --clean nothing is removed', { skip }, () => {
  const root = fakeRoot();
  fs.mkdirSync(path.join(root, 'apps/desktop/dist'), { recursive: true });
  const run = gates(root);
  assert.equal(run.status, 0);
  assert.equal(fs.existsSync(path.join(root, 'apps/desktop/dist')), true);
});

// ---- Rules added after review ----

test('gates: a test step that exits 0 but prints no summary, shows failures, or ran no passing test is a failed step', { skip }, () => {
  const cases = [
    ['no summary', { body: "console.log('all good, trust me');" }, 'NO_SUMMARY', /no test summary/],
    ['failures in the summary', { body: "console.log('ℹ pass 3\\nℹ fail 2\\nℹ skipped 0');" }, 'TEST_FAILURES', /2 failed/],
    ['zero passes', { body: "console.log('ℹ pass 0\\nℹ fail 0\\nℹ skipped 4');" }, 'NO_TESTS_RAN', /no test passed/],
  ];
  for (const [label, spec, reason, pattern] of cases) {
    const root = fakeRoot({ 'root-test': { code: 0, ...spec } });
    const run = gates(root, ['--only', 'root-test']);
    assert.equal(run.status, 1, label);
    const step = JSON.parse(run.stdout).steps[0];
    assert.equal(step.passed, false, label);
    assert.equal(step.exitCode, 0, label);
    assert.equal(step.reason, reason, label);
    assert.match(step.firstFailure, pattern, label);
  }
  // A typecheck step has no summary to find and still passes on exit 0.
  const root = fakeRoot({ 'root-typecheck': { body: "console.log('tsc done');" } });
  assert.equal(JSON.parse(gates(root, ['--only', 'root-typecheck']).stdout).steps[0].passed, true);
});

test('gates: secrets in a step output are redacted in the log, the JSON, and the human output', { skip }, () => {
  const tok = ['gh', 'p_', 'a1B2c3D4'.repeat(5)].join('');
  const authLine = ['//registry.example.com/:_auth', 'Token=', 'abc123def456'].join('');
  const root = fakeRoot({ 'root-typecheck': { code: 1, out: `starting\nnpm error ${tok}\n${authLine}\nAuthorization: Bearer abcdefgh12345678` } });
  const run = gates(root);
  const log = fs.readFileSync(path.join(root, '.trellis/gates/root-typecheck.log'), 'utf8');
  for (const text of [log, run.stdout]) {
    assert.doesNotMatch(text, /a1B2c3D4a1B2c3D4/);
    assert.doesNotMatch(text, /abc123def456/);
    assert.doesNotMatch(text, /abcdefgh12345678/);
  }
  assert.match(log, /\[redacted\]/);
  assert.match(JSON.parse(run.stdout).steps[0].firstFailure, /^npm error \[redacted\]$/);
  const human = spawnSync(process.execPath, [script, '--root', root], { encoding: 'utf8', env: { ...process.env, ...MODE } });
  assert.doesNotMatch(human.stdout, /a1B2c3D4a1B2c3D4/);
});

test('gates: a step gets empty npm config files that are removed afterwards, and never the user npmrc', { skip }, () => {
  const report = path.join(tmp(), 'npm-env.json');
  const root = fakeRoot({ 'root-typecheck': { body: `const u = process.env.npm_config_userconfig, g = process.env.npm_config_globalconfig; fs.writeFileSync(${JSON.stringify(report)}, JSON.stringify({ u, g, uText: fs.readFileSync(u, 'utf8'), gText: fs.readFileSync(g, 'utf8'), mode: fs.statSync(u).mode & 0o777 }));` } });
  const home = tmp();
  fs.writeFileSync(path.join(home, '.npmrc'), '//registry.example.com/:_auth' + 'Token=should-not-be-read\n');
  const run = gates(root, ['--only', 'root-typecheck'], { HOME: home, npm_config_userconfig: path.join(home, '.npmrc') });
  assert.equal(run.status, 0, run.stderr + run.stdout);
  const seen = JSON.parse(fs.readFileSync(report, 'utf8'));
  assert.notEqual(seen.u, path.join(home, '.npmrc'));
  assert.deepEqual([seen.uText, seen.gText, seen.mode], ['', '', 0o600]);
  assert.equal(fs.existsSync(seen.u), false, 'the config folder is removed after the run');
});

test('gates: --root to a missing folder exits 2, and with --json prints one error object', () => {
  const run = spawnSync(process.execPath, [script, '--root', path.join(tmp(), 'absent'), '--json'], { encoding: 'utf8', env: { ...process.env, ...MODE } });
  assert.equal(run.status, 2);
  assert.equal(run.stdout.trim().split('\n').length, 1);
  const json = JSON.parse(run.stdout);
  assert.deepEqual({ ok: json.ok, exit: json.exit, error: typeof json.error }, { ok: false, exit: 2, error: 'string' });
});

test('gates: a usage error with --json prints exactly one JSON object, also for --json=x', () => {
  for (const argv of [['--nope', '--json'], ['--clean=false', '--json'], ['--json=x'], ['--e2e', '--only', 'root-test', '--json'], ['--root', '/x', '--json']]) {
    const run = spawnSync(process.execPath, [script, ...argv], { encoding: 'utf8', env: { ...process.env, BOWERLOOM_TOOLS_TEST_MODE: undefined } });
    assert.equal(run.status, 2, argv.join(' '));
    assert.equal(run.stdout.trim().split('\n').length, 1, argv.join(' '));
    const json = JSON.parse(run.stdout);
    assert.deepEqual({ ok: json.ok, exit: json.exit }, { ok: false, exit: 2 }, argv.join(' '));
    assert.ok(json.error);
  }
});

test('gates: --clean=false is a usage error and removes nothing', { skip }, () => {
  const root = fakeRoot();
  fs.mkdirSync(path.join(root, 'test-results'));
  const run = spawnSync(process.execPath, [script, '--root', root, '--clean=false'], { encoding: 'utf8', env: { ...process.env, ...MODE } });
  assert.equal(run.status, 2);
  assert.equal(fs.existsSync(path.join(root, 'test-results')), true);
  assert.deepEqual(trace(root), []);
});

test('main reports a --root below a file as one JSON usage error', async () => {
  let out = '', err = '';
  const file = path.join(tmp(), 'a-file');
  fs.writeFileSync(file, 'x');
  const code = await main(['--json', '--root', path.join(file, 'nested')], { write: text => { out += text; } }, { write: text => { err += text; } }, MODE);
  assert.equal(code, 2);
  assert.equal(out.trim().split('\n').length, 1);
  assert.equal(JSON.parse(out).exit, 2);
  assert.match(err, /gates:/);
});

/** Writes release/beta.json, apps/desktop/release/<files>, and (unless `record` is false) release/desktop-sha256.json. `record` can override parts of the hash file. */
function installerFixture(root, { version = '0.8.0-beta.2', files = { 'Bowerloom-0.8.0-beta.2-arm64.dmg': 'dmg bytes', 'Bowerloom-0.8.0-beta.2-arm64.zip': 'zip bytes' }, record = {}, extra = {} } = {}) {
  fs.mkdirSync(path.join(root, 'apps/desktop/release'), { recursive: true });
  fs.mkdirSync(path.join(root, 'release'), { recursive: true });
  fs.writeFileSync(path.join(root, 'release/beta.json'), JSON.stringify({ version }));
  for (const [name, text] of Object.entries({ ...files, ...extra })) fs.writeFileSync(path.join(root, 'apps/desktop/release', name), text);
  if (record === false) return;
  const hashes = Object.fromEntries(Object.entries(files).map(([name, text]) => [name, crypto.createHash('sha256').update(text).digest('hex')]));
  fs.writeFileSync(path.join(root, 'release/desktop-sha256.json'), JSON.stringify({ schema: HASH_SCHEMA, version, files: hashes, ...record }));
}

test('checkInstallersRecorded accepts a hash file that matches release/beta.json and the real hash of every installer', () => {
  assert.equal(HASH_SCHEMA, 'bowerloom/desktop-hashes/v1');
  const root = tmp();
  installerFixture(root, { extra: { 'latest-mac.yml': 'not an installer', 'x.dmg.blockmap': 'not an installer' } });
  const result = checkInstallersRecorded(root);
  assert.equal(result.ok, true, result.reason);
  assert.deepEqual(result.installers, ['Bowerloom-0.8.0-beta.2-arm64.dmg', 'Bowerloom-0.8.0-beta.2-arm64.zip']);
  assert.equal(checkInstallersRecorded(tmp()).ok, true, 'no installer folder: nothing to protect');
});

test('checkInstallersRecorded refuses each way the record can fail to cover the installers', () => {
  const cases = {
    'no hash file': [{ record: false }, /desktop-sha256\.json does not exist/],
    'an unreadable hash file': [{}, /not valid JSON/, root => fs.writeFileSync(path.join(root, 'release/desktop-sha256.json'), '{nope')],
    'the wrong schema': [{ record: { schema: 'other/v1' } }, /wrong shape/],
    'a hash that is not 64 hex characters': [{ record: { files: { 'Bowerloom-0.8.0-beta.2-arm64.dmg': 'abc', 'Bowerloom-0.8.0-beta.2-arm64.zip': 'abc' } } }, /wrong shape/],
    'another version than release/beta.json': [{ record: { version: '0.8.0-beta.1' } }, /version 0\.8\.0-beta\.1.*0\.8\.0-beta\.2/],
    'a hash that differs from the file': [{}, /differs.*Bowerloom-0\.8\.0-beta\.2-arm64\.dmg/, root => fs.writeFileSync(path.join(root, 'apps/desktop/release/Bowerloom-0.8.0-beta.2-arm64.dmg'), 'changed after the hashes were written')],
    'an installer with no recorded hash': [{}, /not recorded.*extra\.zip/, root => fs.writeFileSync(path.join(root, 'apps/desktop/release/extra.zip'), 'new')],
    'no release/beta.json': [{}, /release\/beta\.json/, root => fs.rmSync(path.join(root, 'release/beta.json'))],
    'a release record with no version': [{}, /release\/beta\.json/, root => fs.writeFileSync(path.join(root, 'release/beta.json'), '{}')],
  };
  for (const [label, [options, pattern, after]] of Object.entries(cases)) {
    const root = tmp();
    installerFixture(root, options);
    after?.(root);
    const result = checkInstallersRecorded(root);
    assert.equal(result.ok, false, label);
    assert.match(result.reason, pattern, label);
  }
});

test('checkInstallersRecorded refuses an installer that is a symlink, because the hash would be of another file', () => {
  const root = tmp(), outside = tmp();
  installerFixture(root);
  fs.writeFileSync(path.join(outside, 'real.dmg'), 'x');
  fs.symlinkSync(path.join(outside, 'real.dmg'), path.join(root, 'apps/desktop/release/linked.dmg'));
  const result = checkInstallersRecorded(root);
  assert.equal(result.ok, false);
  assert.match(result.reason, /linked\.dmg.*symlink|symlink.*linked\.dmg/);
});

test('gates: --clean leaves the installers, and --clean-installers removes them once the hash file covers them', { skip }, () => {
  const root = fakeRoot();
  installerFixture(root);
  fs.mkdirSync(path.join(root, 'apps/desktop/dist'), { recursive: true });
  fs.writeFileSync(path.join(root, 'apps/desktop/dist/f.bin'), 'x');
  let run = gates(root, ['--clean']);
  assert.equal(run.status, 0, run.stderr + run.stdout);
  assert.equal(fs.existsSync(path.join(root, 'apps/desktop/release/Bowerloom-0.8.0-beta.2-arm64.dmg')), true, 'installers stay with --clean');
  assert.equal(fs.existsSync(path.join(root, 'apps/desktop/dist')), false);
  run = gates(root, ['--clean-installers']);
  assert.equal(run.status, 0, run.stdout);
  const summary = JSON.parse(run.stdout);
  assert.deepEqual(summary.clean.removed.map(r => r.path), ['apps/desktop/release']);
  assert.deepEqual(summary.clean.refused, []);
  assert.equal(fs.existsSync(path.join(root, 'apps/desktop/release')), false);
  assert.equal(fs.existsSync(path.join(root, 'release/desktop-sha256.json')), true, 'the hash file stays');
});

test('gates: --clean-installers refuses, exits 1, and keeps the installers when the hash file does not cover them', { skip }, () => {
  const root = fakeRoot();
  installerFixture(root, { record: false });
  let run = gates(root, ['--clean-installers']);
  assert.equal(run.status, 1, run.stdout);
  let summary = JSON.parse(run.stdout);
  assert.equal(summary.ok, false);
  assert.equal(summary.failedStep, null, 'the steps passed; the refusal is what fails the run');
  assert.deepEqual(summary.clean.removed, []);
  assert.equal(summary.clean.refused.length, 1);
  assert.equal(summary.clean.refused[0].path, 'apps/desktop/release');
  assert.match(summary.clean.refused[0].reason, /desktop-sha256\.json does not exist/);
  assert.equal(fs.existsSync(path.join(root, 'apps/desktop/release/Bowerloom-0.8.0-beta.2-arm64.dmg')), true);
  const human = spawnSync(process.execPath, [script, '--root', root, '--clean-installers'], { encoding: 'utf8', env: { ...process.env, ...MODE } });
  assert.equal(human.status, 1);
  assert.match(human.stdout, /refused to remove apps\/desktop\/release: .*desktop-sha256/);
  assert.doesNotMatch(human.stdout, /all steps passed/);
  // Fix the record and run again.
  installerFixture(root);
  run = gates(root, ['--clean-installers']);
  assert.equal(run.status, 0, run.stdout);
  summary = JSON.parse(run.stdout);
  assert.equal(summary.ok, true);
});

test('gates: a path that --clean refuses (a symlink) makes the run fail with exit 1, and the symlink target is left alone', { skip }, () => {
  const root = fakeRoot(), outside = tmp();
  fs.writeFileSync(path.join(outside, 'precious.txt'), 'keep');
  fs.symlinkSync(outside, path.join(root, 'test-results'));
  const run = gates(root, ['--clean']);
  assert.equal(run.status, 1, run.stdout);
  const summary = JSON.parse(run.stdout);
  assert.equal(summary.ok, false);
  assert.deepEqual(summary.clean.refused.map(r => r.path), ['test-results']);
  assert.equal(summary.clean.error, null);
  assert.equal(fs.readFileSync(path.join(outside, 'precious.txt'), 'utf8'), 'keep');
});

test('gates: --clean removes the root dist that a root npm test writes', { skip }, () => {
  const root = fakeRoot();
  fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
  fs.writeFileSync(path.join(root, 'dist/index.js'), 'x');
  const run = gates(root, ['--clean']);
  assert.equal(run.status, 0, run.stdout);
  assert.ok(JSON.parse(run.stdout).clean.removed.some(r => r.path === 'dist'));
  assert.equal(fs.existsSync(path.join(root, 'dist')), false);
});

test('gates: the help text says installers are cleaned after release verify passes', () => {
  const help = spawnSync(process.execPath, [script, '--help'], { encoding: 'utf8' }).stdout.replace(/\s+/g, ' ');
  assert.match(help, /release verify/);
  assert.match(help, /refuses unless release\/desktop-sha256\.json/);
  assert.doesNotMatch(help, /run `release hashes` first/);
});

test('gates: a word that names an Object.prototype member is a usage error, not a flag', () => {
  for (const word of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
    assert.match(parseArgs([word], MODE).usage ?? '', /unknown argument/, word);
    assert.match(parseArgs([`--${word}`], MODE).usage ?? '', /unknown argument/, word);
  }
  const run = spawnSync(process.execPath, [script, 'constructor', '--json'], { encoding: 'utf8' });
  assert.equal(run.status, 2);
  assert.equal(JSON.parse(run.stdout).exit, 2);
});

test('gates: a different file named gates.mjs that imports the real one makes it print an error and exit 2', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'gates.mjs'), `import ${JSON.stringify(script)};\n`);
  const run = spawnSync(process.execPath, [path.join(dir, 'gates.mjs'), '--help'], { encoding: 'utf8' });
  assert.equal(run.status, 2);
  assert.match(run.stderr, /gates: the program started as .* is not this script/);
  assert.equal(run.stdout, '');
});

test('gates: --clean that cannot remove something still prints the run summary, with clean.error', { skip: process.getuid?.() === 0 ? 'skipped: running as root' : skip }, () => {
  const root = fakeRoot();
  fs.mkdirSync(path.join(root, 'apps/desktop/.build'), { recursive: true });
  fs.writeFileSync(path.join(root, 'apps/desktop/.build/x.bin'), 'x');
  fs.chmodSync(path.join(root, 'apps/desktop'), 0o555);
  try {
    const run = gates(root, ['--clean']);
    const summary = JSON.parse(run.stdout);
    assert.equal(summary.steps.length, 4, 'the step results are still there');
    assert.match(summary.clean.error, /\.build/);
    assert.equal(summary.ok, false);
    assert.equal(run.status, 1);
  } finally { fs.chmodSync(path.join(root, 'apps/desktop'), 0o755); }
});

test('gates: a lock that cannot be removed is reported as a warning and does not hide the step result', { skip }, () => {
  const lock = path.join(tmp(), 'lock');
  const root = fakeRoot({ 'desktop-e2e': { body: `fs.writeFileSync(${JSON.stringify(path.join(lock, 'stray.txt'))}, 'x'); console.log('  2 passed (1.0s)');` } });
  const run = gates(root, ['--e2e', '--only', 'desktop-e2e', '--lock-dir', lock]);
  const summary = JSON.parse(run.stdout);
  assert.equal(summary.steps[0].passed, true);
  assert.match(summary.lockWarning, /could not remove the e2e lock/);
  assert.equal(summary.ok, false);
  assert.equal(run.status, 1);
  fs.rmSync(lock, { recursive: true, force: true });
});

test('gates: an interrupt stops the step group, releases the e2e lock, removes the npm config folder, and exits 130', { skip }, async () => {
  const dir = tmp();
  const lock = path.join(dir, 'lock'), ready = path.join(dir, 'ready'), pidFile = path.join(dir, 'pid'), cfgFile = path.join(dir, 'cfg');
  const body = `const g = process.getBuiltinModule('node:child_process').spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' }); fs.writeFileSync(${JSON.stringify(pidFile)}, String(g.pid)); fs.writeFileSync(${JSON.stringify(cfgFile)}, process.env.npm_config_userconfig); fs.writeFileSync(${JSON.stringify(ready)}, 'x'); setInterval(() => {}, 1000);`;
  const root = fakeRoot({ 'desktop-e2e': { hang: true, body } });
  const child = spawn(process.execPath, [script, '--root', root, '--json', '--e2e', '--only', 'desktop-e2e', '--lock-dir', lock], { env: { ...process.env, ...MODE }, stdio: ['ignore', 'pipe', 'pipe'] });
  const exited = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })));
  assert.equal(await waitFor(ready), true, 'the e2e step started');
  assert.equal(fs.existsSync(lock), true, 'the lock is held while the step runs');
  child.kill('SIGINT');
  const result = await exited;
  assert.equal(result.code, 130);
  assert.equal(fs.existsSync(lock), false, 'the lock is released');
  assert.equal(fs.existsSync(path.dirname(fs.readFileSync(cfgFile, 'utf8'))), false, 'the npm config folder is removed');
  assert.equal(await goneWithin(Number(fs.readFileSync(pidFile, 'utf8'))), true, 'the grandchild is gone');
});

test('gates: an interrupt skips the --clean clean-up, so the build outputs stay', { skip }, async () => {
  const dir = tmp();
  const ready = path.join(dir, 'ready');
  const body = `fs.writeFileSync(${JSON.stringify(ready)}, 'x'); setInterval(() => {}, 1000);`;
  const root = fakeRoot({ 'root-test': { hang: true, body } });
  fs.mkdirSync(path.join(root, 'test-results'), { recursive: true });
  fs.writeFileSync(path.join(root, 'test-results/keep.txt'), 'keep');
  const child = spawn(process.execPath, [script, '--root', root, '--json', '--clean', '--only', 'root-test'], { env: { ...process.env, ...MODE }, stdio: ['ignore', 'pipe', 'pipe'] });
  const exited = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })));
  assert.equal(await waitFor(ready), true, 'the step started');
  child.kill('SIGINT');
  assert.equal((await exited).code, 130);
  assert.equal(fs.existsSync(path.join(root, 'test-results/keep.txt')), true, 'an interrupted run does not delete build outputs');
});

test('gates: the seams --root, --lock-dir, and --timeout-seconds are refused without the test-mode variable', () => {
  const env = { ...process.env, BOWERLOOM_TOOLS_TEST_MODE: undefined };
  for (const argv of [['--root', os.tmpdir()], ['--lock-dir', '/tmp/x'], ['--timeout-seconds', '5']]) {
    const run = spawnSync(process.execPath, [script, ...argv, '--json'], { encoding: 'utf8', env });
    assert.equal(run.status, 2, argv.join(' '));
    assert.match(JSON.parse(run.stdout).error, /BOWERLOOM_TOOLS_TEST_MODE/);
  }
});
