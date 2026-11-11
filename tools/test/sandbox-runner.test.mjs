import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const runner = path.join(root, 'tools/sandbox/run-gates.sh');
const made = [];
test.after(() => { for (const dir of made) fs.rmSync(dir, { recursive: true, force: true }); });
const tmp = () => { const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sandbox-runner-test-'))); made.push(dir); return dir; };

const printed = () => {
  const result = spawnSync('bash', [runner, '--print-commands'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.split('\n').filter(line => line.startsWith('docker '));
};

test('the runner prints a build and a run command, and nothing else starts', () => {
  const lines = printed();
  assert.equal(lines.filter(l => l.startsWith('docker build ')).length, 1);
  assert.equal(lines.filter(l => l.startsWith('docker run ')).length, 1);
});

test('the run command mounts nothing from the host, publishes no port, and never reaches the host docker socket', () => {
  const run = printed().find(l => l.startsWith('docker run '));
  assert.doesNotMatch(run, /(^| )(-v|--volume|--mount)( |=)/, 'no bind mount and no volume');
  assert.doesNotMatch(run, /(^| )(-p|-P|--publish|--publish-all)( |=|$)/, 'no published port');
  assert.doesNotMatch(run, /docker\.sock/);
  assert.doesNotMatch(run, /--privileged|--pid=host|--network[= ]host|--net[= ]host|--userns=host/);
  assert.doesNotMatch(run, /(^| )(-e|--env)( |=)(HOME|DOCKER_HOST)/);
  assert.doesNotMatch(run, /--env-file/);
});

test('the run command runs as root with no network', () => {
  const run = printed().find(l => l.startsWith('docker run '));
  assert.match(run, /--user 0:0/);
  assert.match(run, /--network none/);
});

test('the build command uses the sandbox Dockerfile and the repository as its only context', () => {
  const build = printed().find(l => l.startsWith('docker build '));
  assert.match(build, /-f tools\/sandbox\/Dockerfile/);
  assert.match(build, / \.$/);
});

test('the Dockerfile has a pinned Node tag in the engine range, copies the source in, and declares no volume', () => {
  const text = fs.readFileSync(path.join(root, 'tools/sandbox/Dockerfile'), 'utf8');
  const from = text.match(/^FROM node:(\d+)\.(\d+)\.(\d+)-[a-z]+@sha256:[0-9a-f]{64}$/m);
  assert.ok(from, 'FROM names an exact node version and a digest');
  const [major, minor] = [Number(from[1]), Number(from[2])];
  assert.equal(major, 24);
  assert.ok(minor >= 11, 'node 24.11 or later');
  assert.match(text, /^COPY \. \/work$/m);
  assert.doesNotMatch(text, /^VOLUME /m);
  assert.doesNotMatch(text, /^USER /m, 'the image runs as root on purpose');
  assert.match(text, /xvfb/);
});

test('the runner refuses, and says how to start Docker Desktop, when Docker cannot be used', () => {
  const bin = tmp();
  fs.writeFileSync(path.join(bin, 'docker'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
  const result = spawnSync('bash', [runner], { encoding: 'utf8', env: { PATH: `${bin}:/usr/bin:/bin` } });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /open -a Docker/);
  assert.match(result.stderr, /docker info/);
});

test('the runner refuses when there is no docker command at all', () => {
  const bin = tmp();
  for (const tool of ['bash', 'dirname', 'cd']) { const found = spawnSync('sh', ['-c', `command -v ${tool}`], { encoding: 'utf8' }).stdout.trim(); if (found.startsWith('/')) fs.symlinkSync(found, path.join(bin, tool)); }
  const result = spawnSync('/bin/bash', [runner], { encoding: 'utf8', env: { PATH: bin } });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Docker/);
});

test('the runner never runs a test command on the host', () => {
  const text = fs.readFileSync(runner, 'utf8').split('\n').filter(line => !line.trim().startsWith('#')).join('\n');
  assert.doesNotMatch(text,/npm (run |test)|playwright|node tools\/gates/, 'the host only runs docker');
});

const MD = path.join(root, 'tools/sandbox/machine-dependent.mjs');
const frozen = JSON.parse(fs.readFileSync(path.join(root, 'docs/v0.9/test-inventory.json'), 'utf8'));
const names = frozen.suites.root.skips.filter(s => s.kind === 'machine-dependent' && s.group === undefined).map(s => s.name);

test('the machine-dependent check reads four frozen names, and passes only when all four passed', () => {
  assert.equal(names.length, 4);
  const dir = tmp();
  const write = status => { const file = path.join(dir, 'run.jsonl'); fs.writeFileSync(file, names.map((name, i) => JSON.stringify({ file: `f${i}.mjs`, name, status: status(i) })).join('\n') + '\n'); return file; };
  const ok = spawnSync('node', [MD, write(() => 'pass')], { encoding: 'utf8' });
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  for (const name of names) assert.ok(ok.stdout.split('\n').some(line => /^pass +/.test(line) && line.endsWith(name)), name);
  const skipped = spawnSync('node', [MD, write(i => (i === 2 ? 'skip' : 'pass'))], { encoding: 'utf8' });
  assert.equal(skipped.status, 1);
  assert.match(skipped.stdout, /skip +L5/);
});

test('the machine-dependent check fails on a missing test and on an empty run', () => {
  const dir = tmp();
  const file = path.join(dir, 'run.jsonl');
  fs.writeFileSync(file, JSON.stringify({ file: 'a.mjs', name: names[0], status: 'pass' }) + '\n');
  const missing = spawnSync('node', [MD, file], { encoding: 'utf8' });
  assert.equal(missing.status, 1);
  assert.match(missing.stdout, /missing/);
  fs.writeFileSync(file, '');
  assert.equal(spawnSync('node', [MD, file], { encoding: 'utf8' }).status, 1);
});

const SUMMARY = path.join(root, 'tools/sandbox/summarize-gates.mjs');

test('the gates summary prints the counts of each step and exits 1 on a failed step', () => {
  const dir = tmp();
  const file = path.join(dir, 'gates.json');
  const step = (name, passed, counts) => ({ name, passed, exitCode: passed ? 0 : 1, counts, firstFailure: passed ? null : 'boom' });
  fs.writeFileSync(file, JSON.stringify({ ok: false, failedStep: 'root-test', steps: [step('root-typecheck', true, null), step('root-test', false, { pass: 3, fail: 1, skipped: 2 })], notRun: ['desktop-test'] }));
  const result = spawnSync('node', [SUMMARY, file], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /root-typecheck +passed/);
  assert.match(result.stdout, /root-test +FAILED.*pass 3, fail 1, skipped 2/);
  assert.match(result.stdout, /not run: desktop-test/);
  assert.match(result.stdout, /boom/);
});

test('the gates summary fails on a missing or unreadable file', () => {
  const result = spawnSync('node', [SUMMARY, path.join(tmp(), 'none.json')], { encoding: 'utf8' });
  assert.equal(result.status, 1);
});

const E2E = path.join(root, 'tools/sandbox/summarize-e2e.mjs');
const fixtureInventory = () => { const f = path.join(tmp(), 'inv.json'); fs.writeFileSync(f, JSON.stringify({ suites: { e2e: { counts: { tests: 1 } } } })); return f; };
const spec = (title, status) => ({ title, file: 'a.spec.ts', tests: [{ status, annotations: [] }] });

test('the e2e summary prints the Playwright counts and names each failed test', () => {
  const dir = tmp();
  const file = path.join(dir, 'e2e.json');
  fs.writeFileSync(file, JSON.stringify({ stats: { expected: 2, unexpected: 1, flaky: 0, skipped: 3 }, suites: [{ title: 'a.spec.ts', file: 'a.spec.ts', specs: [spec('works', 'expected'), spec('breaks', 'unexpected')] }] }));
  const result = spawnSync('node', [E2E, file], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /FAILED +pass 2, fail 1, flaky 0, skipped 3/);
  assert.match(result.stdout, /failed: apps\/desktop\/e2e\/a\.spec\.ts: breaks/);
  fs.writeFileSync(file, JSON.stringify({ stats: { expected: 2, unexpected: 0, flaky: 0, skipped: 1 }, suites: [] }));
  assert.equal(spawnSync('node', [E2E, file, '--inventory', fixtureInventory()], { encoding: 'utf8' }).status, 0);
});

test('the e2e summary fails when no test passed, and when the file is missing', () => {
  const dir = tmp();
  const file = path.join(dir, 'e2e.json');
  fs.writeFileSync(file, JSON.stringify({ stats: { expected: 0, unexpected: 0, flaky: 0, skipped: 5 }, suites: [] }));
  assert.equal(spawnSync('node', [E2E, file], { encoding: 'utf8' }).status, 1);
  assert.equal(spawnSync('node', [E2E, path.join(dir, 'none.json')], { encoding: 'utf8' }).status, 1);
});

// ---- round 1: hardening, --out safety, exit handling ----

test('the run command drops every capability but a short list, blocks new privileges, and limits processes, memory and time', () => {
  const run = printed().find(l => l.startsWith('docker run '));
  assert.match(run, /--cap-drop ALL/);
  assert.match(run, /--security-opt no-new-privileges/);
  assert.match(run, /--pids-limit \d+/);
  assert.match(run, /--memory \d+g/);
  const added = [...run.matchAll(/--cap-add (\w+)/g)].map(m => m[1]);
  assert.ok(added.length > 0 && added.length <= 8, 'a short, named list of capabilities');
  assert.ok(!added.includes('SYS_ADMIN') && !added.includes('NET_ADMIN') && !added.includes('ALL'));
});

const runOut = (args, env = {}) => spawnSync('bash', [runner, '--print-commands', ...args], { encoding: 'utf8', env: { ...process.env, ...env } });

test('--out refuses a leading dash, the root folder, the home folder, a file, and a folder that holds files', () => {
  const home = tmp();
  const full = tmp(); fs.writeFileSync(path.join(full, 'keep.txt'), 'x');
  const file = path.join(tmp(), 'f'); fs.writeFileSync(file, 'x');
  for (const [out, env] of [['-x', {}], ['/', {}], [home, { HOME: home }], [`${home}/`, { HOME: home }], [file, {}], [full, {}], ['', {}]]) {
    const result = runOut(['--out', out], env);
    assert.equal(result.status, 2, `--out "${out}": ${result.stdout}${result.stderr}`);
    assert.match(result.stderr, /--out/);
  }
});

test('--out takes a folder that does not exist or is empty, and the empty one stays empty until the copy', () => {
  const base = tmp();
  assert.equal(runOut(['--out', path.join(base, 'new')], { HOME: '/nonexistent-home' }).status, 0);
  const empty = path.join(base, 'empty'); fs.mkdirSync(empty);
  assert.equal(runOut(['--out', empty], { HOME: '/nonexistent-home' }).status, 0);
  assert.deepEqual(fs.readdirSync(empty), []);
});

/** A fake docker that records its calls and makes files for `docker cp`. */
const fakeDocker = (bin, log) => {
  fs.writeFileSync(path.join(bin, 'docker'), `#!/bin/sh
echo "$*" >> "${log}"
case "$1" in
  info|build|inspect) exit 0 ;;
  run) [ -n "\${FAKE_RUN_SLEEP:-}" ] && sleep "\$FAKE_RUN_SLEEP"; exit \${FAKE_RUN_EXIT:-0} ;;
  rm) [ -n "\${FAKE_RM_FAIL:-}" ] && { echo "rm failed: busy" >&2; exit 1; }; exit 0 ;;
  kill) exit 0 ;;
  cp) [ -n "\${FAKE_CP_FAIL:-}" ] && exit 1
      src="\${2#*:}"; dst="$3"
      case "$src" in
        */logs) mkdir -p "$dst"; echo log > "$dst/a.log"; ln -s /etc/passwd "$dst/evil"; mkfifo "$dst/pipe" ;;
        *) case "$src" in */gates-root-test.json) [ -n "\${FAKE_MISSING:-}" ] && exit 0 ;; esac; echo x > "$dst" ;;
      esac; exit 0 ;;
esac
exit 0
`, { mode: 0o755 });
};
const withFake = () => { const bin = tmp(); const log = path.join(bin, 'calls.log'); fakeDocker(bin, log); return { bin, log, env: bin2 => ({ PATH: `${bin}:${process.env.PATH}`, HOME: bin2 ?? bin }) }; };
const REQUIRED = ['gates-root-typecheck.json', 'gates-root-test.json', 'gates-desktop-typecheck.json', 'gates-desktop-test.json', 'e2e.json', 'machine-dependent.jsonl'];

test('a good copy puts the named result files in the out folder, drops symlinks, and exits with the container status', () => {
  const f = withFake(); const out = path.join(tmp(), 'out');
  const result = spawnSync('bash', [runner, '--out', out], { encoding: 'utf8', env: { ...f.env(), FAKE_RUN_EXIT: '1' } });
  assert.equal(result.status, 1, result.stdout + result.stderr);
  for (const name of REQUIRED) assert.ok(fs.existsSync(path.join(out, name)), name);
  assert.ok(fs.existsSync(path.join(out, 'logs', 'a.log')));
  assert.ok(!fs.existsSync(path.join(out, 'logs', 'evil')) && !fs.lstatSync(path.join(out, 'logs'), { throwIfNoEntry: false })?.isSymbolicLink());
  assert.deepEqual(fs.readdirSync(out).filter(n => n.startsWith('.')), [], 'no temporary folder is left');
});

test('a failed docker cp exits 5, and so does a result file that did not arrive', () => {
  for (const extra of [{ FAKE_CP_FAIL: '1' }, { FAKE_MISSING: '1' }]) {
    const f = withFake(); const out = path.join(tmp(), 'out');
    const result = spawnSync('bash', [runner, '--out', out], { encoding: 'utf8', env: { ...f.env(), ...extra } });
    assert.equal(result.status, 5, result.stdout + result.stderr);
    assert.match(result.stderr, /could not copy|missing/);
  }
});

test('a failed container removal is a warning, and an overall time limit kills the container', () => {
  const f = withFake();
  const warn = spawnSync('bash', [runner], { encoding: 'utf8', env: { ...f.env(), FAKE_RM_FAIL: '1' } });
  assert.match(warn.stderr, /could not remove the container/);
  const text = fs.readFileSync(runner, 'utf8');
  assert.match(text, /BOWERLOOM_SANDBOX_LIMIT_SECONDS/);
  assert.match(text, /docker kill/);
});

test('the usage text matches the options', () => {
  const result = spawnSync('bash', [runner, '--help'], { encoding: 'utf8' });
  assert.equal(result.status, 0);
  for (const word of ['--out', '--print-commands', 'new folder']) assert.ok(result.stdout.includes(word), word);
});

// ---- in-container.sh, run in a temporary working folder with stub tools ----
const inContainer = path.join(root, 'tools/sandbox/in-container.sh');
const canRun = process.getuid?.() === 0 && spawnSync('sh', ['-c', 'command -v timeout'], { encoding: 'utf8' }).status === 0;
const sandboxRun = (extraEnv = {}) => {
  const cwd = tmp(); const out = path.join(cwd, 'out'); const bin = path.join(cwd, 'bin');
  fs.mkdirSync(path.join(cwd, 'tools/sandbox'), { recursive: true }); fs.mkdirSync(path.join(cwd, 'apps/desktop'), { recursive: true }); fs.mkdirSync(bin);
  for (const f of ['summarize-gates.mjs', 'summarize-e2e.mjs', 'machine-dependent.mjs', 'probe-report.mjs', 'skip-ceilings.json']) fs.symlinkSync(path.join(root, 'tools/sandbox', f), path.join(cwd, 'tools/sandbox', f));
  fs.symlinkSync(path.join(root, 'tools/inventory-reporter.mjs'), path.join(cwd, 'tools/inventory-reporter.mjs'));
  fs.writeFileSync(path.join(cwd, 'tools/gates.mjs'), `const step=process.argv[process.argv.indexOf('--only')+1];const bad=process.env.FAKE_GATE_FAIL===step;
console.log(JSON.stringify({ok:!bad,steps:[{name:step,passed:!bad,exitCode:bad?1:0,counts:{pass:1,fail:bad?1:0,skipped:0}}],notRun:[]}));process.exit(bad?1:0);\n`);
  fs.mkdirSync(path.join(cwd, '.trellis/gates'), { recursive: true });
  const names = frozen.suites.root.skips.filter(s => s.kind === 'machine-dependent' && s.group === undefined).map(s => s.name);
  fs.mkdirSync(path.join(cwd, 'md')); fs.writeFileSync(path.join(cwd, 'md/four.test.mjs'), `import test from 'node:test';\n${names.map(n => `test(${JSON.stringify(n)}, () => {});`).join('\n')}\n`);
  const stub = (name, body) => fs.writeFileSync(path.join(bin, name), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
  stub('npm', 'case "$*" in *"run build"*) [ "${FAKE_NPM_FAIL:-}" = build ] && { echo build broke >&2; exit 1; } ;; *"run bundle"*) [ "${FAKE_NPM_FAIL:-}" = bundle ] && exit 1 ;; esac; exit 0');
  stub('xvfb-run', 'shift; shift; exec "$@"');
  stub('npx', `echo '${JSON.stringify({ stats: { expected: 300, unexpected: 0, flaky: 0, skipped: 5 }, suites: [], errors: [] })}' > "$PLAYWRIGHT_JSON_OUTPUT_NAME"; exit \${FAKE_PW_EXIT:-0}`);
  const result = spawnSync('sh', [inContainer], { cwd, encoding: 'utf8', env: { ...process.env, NODE_TEST_CONTEXT: undefined, PATH: `${bin}:${process.env.PATH}`, BOWERLOOM_SANDBOX: '1', BOWERLOOM_SANDBOX_OUT: out, BOWERLOOM_SANDBOX_MD_FILES: 'md/four.test.mjs', ...extraEnv } });
  return { result, out };
};

test('in-container: a clean run exits 0', { skip: !canRun && 'runs in the container, as root, with timeout' }, () => {
  const { result, out } = sandboxRun();
  assert.equal(result.status, 0, result.stdout + result.stderr + fs.readFileSync(path.join(out, 'machine-dependent.stderr'), 'utf8'));
});

test('in-container: a Playwright timeout (124) fails the step, is logged, and cannot read as passed', { skip: !canRun && 'runs in the container, as root, with timeout' }, () => {
  const { result, out } = sandboxRun({ FAKE_PW_EXIT: '124' });
  assert.notEqual(result.status, 0);
  assert.match(fs.readFileSync(path.join(out, 'logs/desktop-e2e.exitcode'), 'utf8'), /124/);
  assert.match(result.stdout, /timed out|124/);
});

test('in-container: a gate that fails, and a build that fails, fail the run, and the build error is shown', { skip: !canRun && 'runs in the container, as root, with timeout' }, () => {
  assert.notEqual(sandboxRun({ FAKE_GATE_FAIL: 'root-test' }).result.status, 0);
  const build = sandboxRun({ FAKE_NPM_FAIL: 'build' });
  assert.notEqual(build.result.status, 0);
  assert.match(build.result.stdout + build.result.stderr, /build broke|build failed/);
  assert.notEqual(sandboxRun({ FAKE_NPM_FAIL: 'bundle' }).result.status, 0);
});

test('in-container: every long command has a time limit, and it refuses outside the container', () => {
  const text = fs.readFileSync(inContainer, 'utf8');
  for (const needle of [/timeout -k 30 \d+ npm run bundle/, /timeout -k 30 \d+ npm run build/, /timeout -k 30 \d+ node --test/, /timeout -k 30 \d+ xvfb-run/]) assert.match(text, needle);
  const result = spawnSync('sh', [inContainer], { encoding: 'utf8', env: { ...process.env, BOWERLOOM_SANDBOX: '' } });
  assert.equal(result.status, 2);
});

// ---- summaries ----
const e2eReport = over => JSON.stringify({ stats: { expected: 300, unexpected: 0, flaky: 0, skipped: 5 }, suites: [], errors: [], ...over });
const e2eRun = (report, extra = []) => { const f = path.join(tmp(), 'e2e.json'); fs.writeFileSync(f, report); return spawnSync('node', [E2E, f, ...extra], { encoding: 'utf8' }); };

test('the e2e summary fails on a top-level error, on an interrupted run, on a nonzero exit code, and on fewer tests than the frozen count', () => {
  assert.equal(e2eRun(e2eReport({})).status, 0);
  const withError = e2eRun(e2eReport({ errors: [{ message: 'spec failed to load' }] }));
  assert.equal(withError.status, 1); assert.match(withError.stdout, /spec failed to load/);
  const interrupted = e2eRun(e2eReport({ suites: [{ title: 'a', file: 'a.spec.ts', specs: [{ title: 't', file: 'a.spec.ts', tests: [{ status: 'skipped', annotations: [], results: [{ status: 'interrupted' }] }] }] }] }));
  assert.equal(interrupted.status, 1); assert.match(interrupted.stdout, /interrupted/);
  const code = e2eRun(e2eReport({}), ['--exit-code', '124']);
  assert.equal(code.status, 1); assert.match(code.stdout, /124/);
  const few = e2eRun(e2eReport({ stats: { expected: 10, unexpected: 0, flaky: 0, skipped: 0 } }));
  assert.equal(few.status, 1); assert.match(few.stdout, /frozen/);
});

test('the e2e summary prints a warning with the skipped count', () => {
  assert.match(e2eRun(e2eReport({})).stdout, /warning: 5 skipped/);
});

test('the gates summary fails when the step named by the file is not in the record', () => {
  const dir = tmp(); const file = path.join(dir, 'gates-root-test.json');
  fs.writeFileSync(file, JSON.stringify({ ok: true, steps: [{ name: 'desktop-test', passed: true, exitCode: 0, counts: { pass: 1, fail: 0, skipped: 0 } }], notRun: [] }));
  const result = spawnSync('node', [SUMMARY, file], { encoding: 'utf8' });
  assert.equal(result.status, 1); assert.match(result.stdout, /step root-test is missing/);
});

test('the machine-dependent check prints the node --test exit code and judges by the four names', () => {
  const file = path.join(tmp(), 'run.jsonl');
  fs.writeFileSync(file, names.map(name => JSON.stringify({ file: 'f.mjs', name, status: 'pass' })).join('\n') + '\n');
  const other = spawnSync('node', [MD, file, '--node-exit', '1'], { encoding: 'utf8' });
  assert.match(other.stdout, /node --test exit code: 1/);
  assert.equal(other.status, 0, 'other tests of the same files may fail for root');
  fs.writeFileSync(file, names.slice(1).map(name => JSON.stringify({ file: 'f.mjs', name, status: 'pass' })).join('\n') + '\n');
  assert.equal(spawnSync('node', [MD, file, '--node-exit', '0'], { encoding: 'utf8' }).status, 1);
});


// ---- round 2 ----
test('a relative --out is resolved against the caller folder, so a copy never lands in the repository', () => {
  const f = withFake(); const cwd = tmp();
  fs.mkdirSync(path.join(cwd, 'docs')); fs.writeFileSync(path.join(cwd, 'docs/keep.md'), 'x');
  const refused = spawnSync('bash', [runner, '--print-commands', '--out', 'docs'], { cwd, encoding: 'utf8' });
  assert.equal(refused.status, 2, 'docs in the caller folder holds a file, so it is refused');
  const result = spawnSync('bash', [runner, '--out', 'rel-out'], { cwd, encoding: 'utf8', env: { ...f.env() } });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  for (const name of REQUIRED) assert.ok(fs.existsSync(path.join(cwd, 'rel-out', name)), name);
  assert.ok(!fs.existsSync(path.join(root, 'rel-out')), 'nothing was written into the repository');
});

test('--out refuses a ".." part, so $HOME/nope/.. cannot reach the home folder', () => {
  const home = tmp();
  const result = runOut(['--out', `${home}/nope/..`], { HOME: home });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /\.\./);
  assert.ok(!fs.existsSync(path.join(home, 'nope')), 'the check made no folder');
});

test('staging removes a pipe and a link, and leaves no stage folder or timeout marker', () => {
  const f = withFake(); const out = path.join(tmp(), 'out'); const tmpdir = tmp();
  const result = spawnSync('bash', [runner, '--out', out], { encoding: 'utf8', env: { ...f.env(), TMPDIR: tmpdir } });
  assert.equal(result.status, 0, result.stderr);
  assert.ok(!fs.existsSync(path.join(out, 'logs', 'pipe')) && !fs.existsSync(path.join(out, 'logs', 'evil')));
  assert.deepEqual(fs.readdirSync(out).filter(n => n.startsWith('.')), []);
  assert.deepEqual(fs.readdirSync(tmpdir), [], 'the timeout marker is removed');
});

test('a TERM signal exits 130 and still removes the container', () => {
  const f = withFake();
  const result = spawnSync('sh', ['-c', `bash "${runner}" & pid=$!; sleep 1; kill -TERM $pid; wait $pid; echo status:$?`], { encoding: 'utf8', env: { ...f.env(), FAKE_RUN_SLEEP: '3' } });
  assert.match(result.stdout, /status:130/);
  assert.match(fs.readFileSync(f.log, 'utf8'), /rm -f bowerloom-sandbox-/);
});

test('the runner writes the timeout marker before it kills, and traps INT and TERM', () => {
  const text = fs.readFileSync(runner, 'utf8');
  assert.match(text, /trap 'exit 130' INT TERM/);
  assert.match(text, /mktemp "\$\{TMPDIR:-\/tmp\}\/bowerloom-sandbox-timeout/);
  assert.ok(text.indexOf('echo timeout > "$marker"') < text.indexOf('docker kill'), 'marker first');
});

test('the e2e summary fails when the frozen count cannot be read, and when --exit-code has no value', () => {
  const missing = e2eRun(e2eReport({}), ['--inventory', '/nonexistent']);
  assert.equal(missing.status, 1); assert.match(missing.stdout, /frozen count unavailable/);
  const noValue = e2eRun(e2eReport({}), ['--exit-code']);
  assert.equal(noValue.status, 1); assert.match(noValue.stdout + noValue.stderr, /exit-code/);
});

// ---- skip ceilings and the probe report ----
const ceilingsFile = ceilings => { const f = path.join(tmp(), 'ceilings.json'); fs.writeFileSync(f, JSON.stringify(ceilings)); return f; };

test('the gates summary fails when a step skips more tests than its ceiling, and passes at the ceiling', () => {
  const dir = tmp();
  const file = path.join(dir, 'gates-root-test.json');
  const record = skipped => JSON.stringify({ ok: true, steps: [{ name: 'root-test', passed: true, exitCode: 0, counts: { pass: 3, fail: 0, skipped } }], notRun: [] });
  fs.writeFileSync(file, record(11));
  const over = spawnSync('node', [SUMMARY, file, '--ceilings', ceilingsFile({ 'root-test': 10 })], { encoding: 'utf8' });
  assert.equal(over.status, 1);
  assert.match(over.stdout, /root-test +FAILED +skipped 11, above the ceiling of 10/);
  fs.writeFileSync(file, record(10));
  assert.equal(spawnSync('node', [SUMMARY, file, '--ceilings', ceilingsFile({ 'root-test': 10 })], { encoding: 'utf8' }).status, 0);
});

test('the gates summary fails closed when the ceilings file cannot be read', () => {
  const file = path.join(tmp(), 'gates-root-test.json');
  fs.writeFileSync(file, JSON.stringify({ ok: true, steps: [{ name: 'root-test', passed: true, exitCode: 0, counts: { pass: 3, fail: 0, skipped: 0 } }], notRun: [] }));
  const result = spawnSync('node', [SUMMARY, file, '--ceilings', path.join(tmp(), 'none.json')], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /cannot read the skip ceilings/);
});

test('the e2e summary fails when more tests skipped than the desktop-e2e ceiling', () => {
  const run = (skipped, ceiling) => e2eRun(e2eReport({ stats: { expected: 300, unexpected: 0, flaky: 0, skipped } }), ['--ceilings', ceilingsFile({ 'desktop-e2e': ceiling })]);
  const over = run(6, 5);
  assert.equal(over.status, 1);
  assert.match(over.stdout, /6 tests skipped, above the ceiling of 5/);
  assert.equal(run(5, 5).status, 0);
});

test('the e2e summary fails closed when the ceilings file cannot be read', () => {
  const result = e2eRun(e2eReport({}), ['--ceilings', path.join(tmp(), 'none.json')]);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /cannot read the skip ceilings/);
});

test('the shipped ceilings name the three suites with whole numbers, and the run prints the probes', () => {
  const ceilings = JSON.parse(fs.readFileSync(path.join(root, 'tools/sandbox/skip-ceilings.json'), 'utf8'));
  for (const name of ['root-test', 'desktop-test', 'desktop-e2e']) assert.ok(Number.isInteger(ceilings[name]) && ceilings[name] > 0, name);
  assert.match(fs.readFileSync(inContainer, 'utf8'), /node tools\/sandbox\/probe-report\.mjs/);
});

test('the machine-dependent check ignores the frozen skips of the sandbox work, which skip in the container by design', () => {
  const dir = tmp();
  const inv = path.join(dir, 'inv.json');
  const skip = (name, group) => ({ file: 'a.mjs', name, status: 'skip', kind: 'machine-dependent', reason: 'r', ...(group ? { group } : {}) });
  fs.writeFileSync(inv, JSON.stringify({ suites: { root: { skips: [skip('runs here'), skip('skips as root', 'sandbox-work')] } } }));
  const file = path.join(dir, 'run.jsonl');
  fs.writeFileSync(file, [{ file: 'a.mjs', name: 'runs here', status: 'pass' }, { file: 'a.mjs', name: 'skips as root', status: 'skip' }].map(r => JSON.stringify(r)).join('\n') + '\n');
  const result = spawnSync('node', [MD, file, inv], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /1 machine-dependent tests: all passed/);
});

// Each run has its own image tag, so two runs on one machine never overwrite each other's image.
const imageOf = (line, verb) => (verb === 'build' ? /(?:^| )-t (\S+)/.exec(line)?.[1] : line.trim().split(/\s+/).at(-1));
const tagsOf = env => {
  const result = runOut([], env);
  assert.equal(result.status, 0, result.stderr);
  const lines = result.stdout.split('\n').filter(line => line.startsWith('docker '));
  return { build: imageOf(lines.find(l => l.startsWith('docker build ')), 'build'), run: imageOf(lines.find(l => l.startsWith('docker run ')), 'run') };
};

test('each run builds and runs its own image tag, and never the shared :local tag', () => {
  const env = { BOWERLOOM_SANDBOX_IMAGE: '' };
  const first = tagsOf(env), second = tagsOf(env);
  for (const tags of [first, second]) {
    assert.match(tags.build, /^bowerloom-sandbox:run-\d+-\d+$/);
    assert.equal(tags.run, tags.build, 'the run uses the image it built');
  }
  assert.notEqual(first.build, second.build, 'two runs get two tags');
});

test('BOWERLOOM_SANDBOX_IMAGE overrides the tag', () => {
  const tags = tagsOf({ BOWERLOOM_SANDBOX_IMAGE: 'bowerloom-sandbox:mine' });
  assert.deepEqual(tags, { build: 'bowerloom-sandbox:mine', run: 'bowerloom-sandbox:mine' });
});

function fakeDockerCalls(env) {
  const dir = tmp(), log = path.join(dir, 'calls.log');
  fs.writeFileSync(path.join(dir, 'docker'), `#!/bin/sh\necho "$*" >> "${log}"\ncase "$1" in inspect) exit 1;; build) [ -n "$FAKE_DOCKER_BUILD_FAIL" ] && exit 1;; esac\nexit 0\n`, { mode: 0o755 });
  const result = spawnSync('bash', [runner], { encoding: 'utf8', env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, ...env } });
  return { result, calls: fs.readFileSync(log, 'utf8').split('\n').filter(Boolean) };
}

test('the run removes its own image when it ends, and no other tag', () => {
  const { calls } = fakeDockerCalls({ BOWERLOOM_SANDBOX_IMAGE: '' });
  const built = /-t (\S+)/.exec(calls.find(c => c.startsWith('build ')))[1];
  assert.match(built, /^bowerloom-sandbox:run-\d+-\d+$/);
  assert.deepEqual(calls.filter(c => c.startsWith('rmi ') || c.startsWith('image rm')), [`rmi ${built}`]);
});

test('a tag given by BOWERLOOM_SANDBOX_IMAGE belongs to the caller, so the run does not remove it', () => {
  const { calls } = fakeDockerCalls({ BOWERLOOM_SANDBOX_IMAGE: 'bowerloom-sandbox:mine' });
  assert.equal(calls.some(c => c.startsWith('rmi ') || c.startsWith('image rm')), false);
});

test('a build that fails leaves no image to remove, so the run does not call rmi', () => {
  const { result, calls } = fakeDockerCalls({ BOWERLOOM_SANDBOX_IMAGE: '', FAKE_DOCKER_BUILD_FAIL: '1' });
  assert.equal(result.status, 4);
  assert.equal(calls.some(c => c.startsWith('rmi ') || c.startsWith('image rm')), false);
});
