// Safety tests for scripts/release.mjs: human-only subcommands, the secret scrub, the no-real-publish guarantee, time and output limits.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { assertSafeNpmArgs, entryState, runCli, validateConfig, UsageError } from '../../scripts/release.mjs';
import { allFiles, fakeStreams, isGone, makeFixture, repoRoot, scriptPath, TARBALL, testConfig, VERSION, waitForPid } from './release-fixture.mjs';

const CANARY = 'canary-secret-9f8e7d6c5b4a';
// Built from parts so that a scan of this file does not see a token-shaped literal.
const NPM_SHAPED = ['npm', '_', 'abcdefghijklmnopqrstuvwxyz0123456789'].join('');
const SECRET_ENV = { NPM_TOKEN: CANARY, NODE_AUTH_TOKEN: CANARY + '-a', GH_TOKEN: CANARY + '-b', GITHUB_TOKEN: CANARY + '-c', VERCEL_TOKEN: CANARY + '-d', SERVICE_API_KEY: CANARY + '-e', CUSTOM_TOKEN: CANARY + '-f', 'npm_config_//registry.example.test/:_authToken': CANARY + '-g', DB_PASSWORD: CANARY + '-h' };
const readAll = dir => allFiles(dir).map(f => fs.readFileSync(f, 'utf8')).join('\n');

/** Runs one subcommand in-process with fake streams. */
async function inProcess(fx, args, { tty }) {
  const streams = fakeStreams({ tty });
  const code = await runCli(['--repo', fx.repo, ...args], { env: fx.baseEnv, stdin: streams.stdin, stdout: streams.stdout, stderr: streams.stderr });
  return { code, out: streams.out(), err: streams.err() };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// human-only subcommands

test('publish and retire refuse without a terminal: exit 2, commands printed, nothing run, no npm call', t => {
  const fx = makeFixture(t, { config: testConfig({ retire: [{ version: '0.7.0-beta.1', message: 'Use the newer beta.' }] }) });
  assert.equal(fx.run(['gates']).status, 0);
  assert.equal(fx.run(['dry-run']).status, 0);
  const callsBefore = fx.npmCalls().length;
  for (const [sub, expected] of [['publish', /npm publish \S+ --tag beta --access public/], ['retire', /npm deprecate bowerloom@0\.7\.0-beta\.1 'Use the newer beta\.'/]]) {
    const r = fx.run([sub]);
    assert.equal(r.status, 2, sub);
    assert.match(r.stdout, expected, sub);
    assert.match(r.stderr, /for a person at a terminal/);
    const json = fx.run([sub, '--json']);
    assert.equal(json.status, 2);
    const out = json.json();
    assert.equal(out.outcome, 'refused');
    assert.equal(out.ok, false);
    assert.equal(out.exit, 2);
    assert.ok(out.commands.length >= 1);
    assert.equal(json.stdout.split('\n').filter(Boolean).length, 1);
  }
  assert.equal(fx.npmCalls().length, callsBefore, 'the human-only subcommands start no npm process');
  assert.equal(fx.git('ls-remote', '--tags', 'origin'), '');
});

test('publish prints the dry-run tarball, its hashes and the whoami, login and publish commands, and runs no npm', async t => {
  const fx = makeFixture(t);
  assert.equal(fx.run(['gates']).status, 0);
  const dry = fx.run(['dry-run', '--json']).json();
  const callsBefore = fx.npmCalls().length;
  const r = await inProcess(fx, ['publish'], { tty: true });
  assert.equal(r.code, 0);
  const lines = r.out.split('\n');
  assert.ok(lines.includes(`npm whoami --registry https://registry.example.test`));
  assert.ok(lines.some(l => l.startsWith('npm login ')));
  assert.ok(lines.some(l => l.includes('Run npm login only if whoami fails or does not show tester')));
  assert.ok(lines.includes(`npm publish ${dry.tarball} --tag beta --access public --registry https://registry.example.test`));
  assert.ok(lines.includes(`# tarball SHA-256: ${dry.sha256}`));
  assert.ok(lines.includes(`# tarball integrity: ${dry.integrity}`));
  assert.equal(fx.npmCalls().length, callsBefore, 'the publish subcommand starts no npm process');
  assert.equal(fx.npmCalls().filter(c => c.args[0] === 'publish' && !c.args.includes('--dry-run')).length, 0);
});

test('publish without a dry-run receipt, at a terminal or not, exits 1 with "run dry-run first" and prints no command', async t => {
  const fx = makeFixture(t);
  assert.equal(fx.run(['gates']).status, 0);
  for (const tty of [true, false]) {
    const r = await inProcess(fx, ['publish'], { tty });
    assert.equal(r.code, 1, `tty ${tty}`);
    assert.equal(r.out, '', 'nothing is printed to stdout');
    assert.match(r.err, /run dry-run first/);
    assert.doesNotMatch(r.out + r.err, /npm publish|npm login|npm whoami|tarball-path/);
  }
  const json = fx.run(['publish', '--json']);
  assert.equal(json.status, 1);
  assert.equal(json.json().outcome, 'failed');
  assert.equal(json.json().commands, undefined);
  assert.equal(fx.npmCalls().filter(c => c.args[0] === 'publish').length, 0);
});

test('with a terminal, retire prints its commands, exit 0, and runs nothing', async t => {
  const fx = makeFixture(t, { config: testConfig({ retire: [{ version: '0.7.0-beta.1', message: "It's old; use the beta" }, { version: '0.7.0-beta.2', message: 'Retired.' }] }) });
  assert.equal(fx.run(['gates']).status, 0);
  const callsBefore = fx.npmCalls().length;
  const retire = await inProcess(fx, ['retire'], { tty: true });
  assert.equal(retire.code, 0);
  assert.match(retire.out, /^npm deprecate bowerloom@0\.7\.0-beta\.1 'It'\\''s old; use the beta' --registry https:\/\/registry\.example\.test$/m);
  assert.match(retire.out, /^npm deprecate bowerloom@0\.7\.0-beta\.2 Retired\. --registry/m);
  assert.match(retire.out, /^npm dist-tag add bowerloom@0\.8\.0-beta\.2 beta --registry/m);
  assert.equal(fx.npmCalls().length, callsBefore);
});

test('retire with nothing configured says "nothing configured"', async t => {
  const fx = makeFixture(t);
  const r = await inProcess(fx, ['retire'], { tty: true });
  assert.equal(r.code, 0);
  assert.match(r.out, /nothing configured/);
  assert.doesNotMatch(r.out, /npm deprecate|npm dist-tag/);
});

test('a terminal on only one side is still a refusal', async t => {
  const fx = makeFixture(t);
  for (const [stdin, stdout] of [[true, false], [false, true], [false, false]]) {
    const out = [];
    const code = await runCli(['--repo', fx.repo, 'retire'], { env: fx.baseEnv, stdin: { isTTY: stdin }, stdout: { isTTY: stdout, write: s => out.push(s) }, stderr: { write: () => {} } });
    assert.equal(code, 2, `stdin ${stdin}, stdout ${stdout}`);
    assert.match(out.join(''), /nothing configured/);
  }
});

// ---------------------------------------------------------------------------------------------------------------------------------
// secrets

test('a canary NPM_TOKEN in the parent env never reaches the fake npm, the fake pack or git, and never appears in any output, log or receipt', t => {
  const fx = makeFixture(t);
  const env = { ...SECRET_ENV, KEEP_ME: 'visible' };
  const outputs = [];
  const go = args => { const r = fx.run(args, { env }); outputs.push(r.stdout, r.stderr); return r; };
  assert.equal(go(['preflight']).status, 0);
  assert.equal(go(['gates']).status, 0);
  assert.equal(go(['dry-run']).status, 0);
  fx.artifacts({ 'a-0.8.0-beta.2.dmg': 'one' });
  assert.equal(go(['hashes']).status, 0);
  const integrity = 'sha512-' + crypto.createHash('sha512').update(TARBALL).digest('base64');
  fx.setNpm({ distTags: { beta: VERSION }, versions: { [VERSION]: { integrity } } });
  assert.equal(go(['verify']).status, 0);
  go(['status']);
  go(['publish']);
  go(['tag']);
  assert.ok(fx.npmCalls().length > 10);
  for (const call of [...fx.npmCalls(), ...fx.packCalls()]) {
    for (const name of Object.keys(SECRET_ENV)) assert.ok(!(name in call.env), `${name} reached a child`);
    assert.equal(call.env.KEEP_ME, 'visible');
    assert.equal(call.env.GIT_TERMINAL_PROMPT, '0');
  }
  const everything = [fs.readFileSync(fx.npmLog, 'utf8'), ...outputs, readAll(path.join(fx.repo, '.trellis'))].join('\n');
  assert.ok(!everything.includes(CANARY), 'the canary value appears somewhere');
});

test('the in-process run also passes a scrubbed env to the children', async t => {
  const fx = makeFixture(t);
  const streams = fakeStreams();
  const code = await runCli(['--repo', fx.repo, 'gates'], { env: { ...fx.baseEnv, ...SECRET_ENV }, stdin: streams.stdin, stdout: streams.stdout, stderr: streams.stderr });
  assert.equal(code, 0);
  for (const call of fx.npmCalls()) assert.deepEqual(Object.keys(call.env).filter(n => n in SECRET_ENV), []);
  assert.ok(!(streams.out() + streams.err()).includes(CANARY));
});

test('a failing child that echoes a token shape or a secret value shows only the mark, in the output, the log and the echoed command', t => {
  const fx = makeFixture(t);
  fx.setNpm({ fail: [{ match: 'run typecheck', message: `npm error 401 ${NPM_SHAPED} and ${CANARY}` }] });
  const r = fx.run(['gates', '--json'], { env: { NPM_TOKEN: CANARY } });
  assert.equal(r.status, 1);
  assert.ok(!r.stdout.includes(CANARY) && !r.stdout.includes(NPM_SHAPED));
  assert.match(r.json().message, /\[redacted\]/);
  const log = fs.readFileSync(path.join(fx.repo, r.json().log), 'utf8');
  assert.ok(!log.includes(CANARY) && !log.includes(NPM_SHAPED));
});

// ---------------------------------------------------------------------------------------------------------------------------------
// no real publish

test('assertSafeNpmArgs refuses publish without --dry-run and every npm subcommand that can change the registry or the login', () => {
  assert.doesNotThrow(() => assertSafeNpmArgs(['publish', '--dry-run', 'x.tgz', '--tag', 'beta']));
  for (const args of [['publish', 'x.tgz', '--dry-run'], ['publish', '--', '--dry-run'], ['publish', '--dry-run', '--', 'x.tgz'], ['publish', '--', '--dry-run', 'x.tgz'], ['publish', '--tag', 'beta', '--dry-run', 'x.tgz'], ['publish', 'x.tgz', '--', '--dry-run']]) {
    assert.throws(() => assertSafeNpmArgs(args), /refuses/, args.join(' '));
  }
  for (const args of [['publish', 'x.tgz', '--dry-run', '--no-dry-run'], ['publish', 'x.tgz', '--dry-run=false'], ['publish', '--dry-run', '--dry-run', 'x.tgz'], ['publish', '--dry-run=true', 'x.tgz'], ['publish', 'x.tgz', '--no-dry-run'], ['publish', '--dryRun', 'x.tgz'], ['publish', 'x.tgz', '--tag', 'beta'], ['publish'], ['login'], ['adduser'], ['whoami'], ['deprecate', 'p@1', 'm'], ['dist-tag', 'add', 'p@1', 'beta'], ['unpublish', 'p'], ['token', 'create'], ['owner', 'add'], ['access', 'public'], ['logout'], []]) {
    assert.throws(() => assertSafeNpmArgs(args), /refuses/, args.join(' '));
  }
  for (const args of [['ci'], ['run', 'typecheck'], ['test'], ['view', 'p', 'dist-tags'], ['init', '-y'], ['install', 'bowerloom@beta', '--ignore-scripts', '--no-audit', '--no-fund', '--registry', 'https://registry.example.test']]) assert.doesNotThrow(() => assertSafeNpmArgs(args));
  const install = ['install', 'bowerloom@beta', '--ignore-scripts', '--no-audit', '--no-fund', '--registry', 'https://registry.example.test'];
  for (const args of [['init'], ['init', '-y', '--scope', 'x'], ['init', 'create-x'], ['init', '-y', '-y'], ['install'], ['install', 'p@beta'], ['install', '-g', 'p@beta'], install.slice(0, 6), [...install, '--global'], ['install', '--ignore-scripts', 'bowerloom@beta', '--no-audit', '--no-fund', '--registry', 'https://registry.example.test'],
    [...install.slice(0, 6), 'http://registry.example.test'], [...install.slice(0, 6), '--registry=https://x'], ['install', '--global', ...install.slice(2)], ['install', '../local-dir', ...install.slice(2)], ['install', 'p@beta', '--ignore-scripts', '--no-audit', '--no-fund', '--prefix', '/tmp/x'], install.map((a, i) => (i === 2 ? '--no-ignore-scripts' : a))]) {
    assert.throws(() => assertSafeNpmArgs(args), /refuses/, args.join(' '));
  }
  for (const args of [['run', 'x', '--', '-e', 'code'], ['run', 'x', '-p', 'code'], ['test', '--eval', 'code'], ['run', 'x', '--eval=code']]) assert.throws(() => assertSafeNpmArgs(args), /refuses/, args.join(' '));
});

test('the config check allows only npm ci, npm run NAME and npm test as a gate, and refuses node gates and eval flags', () => {
  const base = testConfig();
  const withGate = command => ({ ...base, gates: [{ name: 'g', cwd: '.', command }] });
  for (const command of [['npm', 'ci'], ['npm', 'test'], ['npm', 'run', 'typecheck'], ['npm', 'run', 'test:unit']]) assert.doesNotThrow(() => validateConfig(withGate(command)), command.join(' '));
  for (const command of [['node', 'x.mjs'], ['node', '-e', 'process.exit()'], ['node', '--eval', 'x'], ['node', '-p', '1'], ['npm', 'run'], ['npm', 'run', 'x', 'y'], ['npm', 'run', '-e'], ['npm', 'ci', '--force'], ['npm', 'test', '--', '--eval', 'x'], ['npm', 'exec', 'x'], ['npm', 'publish'], ['npm', 'run', '--eval=x'], ['npm', '-p']]) {
    assert.throws(() => validateConfig(withGate(command)), UsageError, command.join(' '));
  }
  assert.throws(() => validateConfig({ ...base, e2eGates: [{ name: 'g', cwd: '.', command: ['node', 'x.mjs'] }] }), UsageError);
});

test('a gate list that tries npm publish or npm login is refused as a config error before npm starts', t => {
  for (const command of [['npm', 'publish'], ['npm', 'publish', 'x.tgz', '--tag', 'beta'], ['npm', 'login'], ['npm', 'dist-tag', 'add', 'p@1', 'beta'], ['node', '-e', 'x']]) {
    const config = testConfig({ gates: [{ name: 'bad', cwd: '.', command }] });
    const fx = makeFixture(t, { config });
    const r = fx.run(['gates', '--json']);
    assert.equal(r.status, 2, command.join(' '));
    assert.match(r.json().message, /^config: gates\[0\]\.command/);
    assert.equal(fx.npmCalls().length, 0, command.join(' '));
  }
});

test('the script source has one npm publish spawn and it carries --dry-run; every other mention is a message or a printed command', () => {
  const lines = fs.readFileSync(scriptPath, 'utf8').split('\n');
  const code = lines.map((text, i) => ({ text, n: i + 1 })).filter(l => !l.text.trim().startsWith('//') && !l.text.trim().startsWith('*') && !l.text.trim().startsWith('/**'));
  const spawns = code.filter(l => /\bspawnNpm\(ctx, \[/.test(l.text));
  const publishSpawns = spawns.filter(l => l.text.includes("'publish'"));
  assert.equal(publishSpawns.length, 1);
  assert.match(publishSpawns[0].text, /\['publish', '--dry-run', /);
  // Every quoted 'publish' is that spawn, the guard, a table row, a phase name, or the human-only handler.
  const quoted = code.filter(l => l.text.includes("'publish'"));
  for (const l of quoted) assert.ok(/\['publish', '--dry-run'|sub === 'publish'|name: 'publish'|humanOnly\(ctx, 'publish'|add\('publish'|publish: cmdPublish/.test(l.text), `line ${l.n}: ${l.text.trim()}`);
  // Every "npm publish" in code is a message, the dry-run description, or the printed command inside cmdPublish.
  const start = lines.findIndex(l => l.startsWith('async function cmdPublish'));
  const end = lines.findIndex(l => l.startsWith('function tagName'));
  for (const l of code.filter(l => l.text.includes('npm publish'))) {
    if (l.n - 1 > start && l.n - 1 < end) assert.match(l.text, /`npm publish \$\{shellQuote\(tarball\)\}/, `line ${l.n}`);
    else assert.match(l.text, /--dry-run|refuses npm publish without --dry-run/, `line ${l.n}`);
  }
  // One child-process door, and the npm binary is chosen only in the guarded places.
  assert.equal(code.filter(l => /\bspawn\(/.test(l.text)).length, 1);
  assert.equal(code.filter(l => /exec(?:File)?(?:Sync)?\(|spawnSync\(|fork\(/.test(l.text)).length, 0);
  const binaryUses = code.filter(l => l.text.includes('npmBinary(ctx.env)'));
  assert.equal(binaryUses.length, 1);
  for (const l of binaryUses) {
    const near = lines.slice(Math.max(0, l.n - 4), l.n).join('\n');
    assert.match(near, /assertSafeNpmArgs\(/, `npmBinary at line ${l.n} is not guarded`);
  }
});

test('across a whole release run the fake npm sees no publish without --dry-run, and no login, whoami, deprecate or dist-tag', t => {
  const fx = makeFixture(t);
  for (const args of [['preflight'], ['gates', '--e2e'], ['dry-run'], ['publish'], ['status'], ['verify'], ['tag'], ['retire']]) fx.run(args);
  const calls = fx.npmCalls();
  const subs = new Set(calls.map(c => c.args[0]));
  assert.ok(subs.has('publish'), 'the dry run did call publish');
  for (const sub of subs) assert.ok(['ci', 'run', 'test', 'publish', 'view', 'init', 'install'].includes(sub), `unexpected npm ${sub}`);
  for (const c of calls.filter(c => c.args[0] === 'publish')) assert.ok(c.args.includes('--dry-run'));
  assert.ok(!calls.some(c => c.args.join(' ').includes('REAL PUBLISH')));
});

// ---------------------------------------------------------------------------------------------------------------------------------
// limits and files

test('a gate that passes its time limit is killed with its whole process group, and the failure says so', async t => {
  const config = testConfig();
  // The limit is 5 s, well above the start-up time of a loaded machine, so the fake npm has written its pid file before the timer fires.
  config.gates[1].timeoutSeconds = 5;
  const fx = makeFixture(t, { config });
  const pidFile = path.join(fx.root, 'grandchild.pid');
  fx.setNpm({ fail: [{ match: 'run typecheck', hang: true, pidFile }] });
  const started = Date.now();
  const r = fx.run(['gates', '--json']);
  assert.equal(r.status, 1);
  assert.match(r.json().message, /gate "root: npm run typecheck" failed: timed out; the process group was killed/);
  assert.ok(Date.now() - started < 60_000);
  const pid = await waitForPid(pidFile, 1000);
  const gone = await isGone(pid);
  if (!gone) process.kill(pid, 'SIGKILL');
  assert.equal(gone, true, 'the grandchild process was still running');
  assert.deepEqual(fx.npmCalls().map(c => c.args.join(' ')), ['ci', 'run typecheck']);
});

test('a gate that floods its output is stopped at the cap, fails, and leaves no process behind', async t => {
  const fx = makeFixture(t);
  const pidFile = path.join(fx.root, 'flood-grandchild.pid');
  fx.setNpm({ fail: [{ match: 'ci', flood: true, pidFile }] });
  const r = fx.run(['gates', '--json']);
  assert.equal(r.status, 1);
  assert.match(r.json().message, /output passed the cap; the process group was killed/);
  assert.ok(r.stdout.length < 2000);
  const pid = await waitForPid(pidFile, 1000);
  const gone = await isGone(pid);
  if (!gone) process.kill(pid, 'SIGKILL');
  assert.equal(gone, true, 'the grandchild process was still running');
});

test('logs and receipts are private: files 0600 and the release state folder is not readable by others', t => {
  const fx = makeFixture(t);
  assert.equal(fx.run(['gates']).status, 0);
  assert.equal(fx.run(['dry-run']).status, 0);
  const files = allFiles(path.join(fx.repo, '.trellis/release'));
  assert.ok(files.some(f => f.includes('/logs/')) && files.some(f => f.includes('/receipts/')));
  for (const f of files) assert.equal(fs.statSync(f).mode & 0o777, 0o600, f);
  assert.equal(fs.statSync(path.join(fx.repo, '.trellis/release/logs')).mode & 0o077, 0);
  assert.equal(fx.git('status', '--porcelain'), '', 'the state folder is git-ignored');
});

test('a read-only subcommand writes no file under the repository', t => {
  const fx = makeFixture(t);
  for (const args of [['status'], ['preflight'], ['claims'], ['publish'], ['retire']]) fx.run(args);
  assert.equal(allFiles(path.join(fx.repo, '.trellis')).length, 0);
  assert.equal(fx.git('status', '--porcelain'), '');
});

// ---------------------------------------------------------------------------------------------------------------------------------
// credential isolation

test('every npm child gets empty npm config files, so a user .npmrc with a token is never read', t => {
  const fx = makeFixture(t);
  fs.writeFileSync(path.join(fx.baseEnv.HOME, '.npmrc'), `//registry.example.test/:_${'auth'}Token=${CANARY}\n`);
  assert.equal(fx.run(['gates']).status, 0);
  assert.equal(fx.run(['dry-run']).status, 0);
  fx.artifacts({ 'a-0.8.0-beta.2.dmg': 'one' });
  assert.equal(fx.run(['hashes']).status, 0);
  fx.setNpm({ distTags: { beta: VERSION }, versions: { [VERSION]: { integrity: 'sha512-x' } } });
  fx.run(['status']);
  fx.run(['verify']);
  const calls = fx.npmCalls();
  assert.ok(calls.some(c => c.args[0] === 'view') && calls.some(c => c.args[0] === 'install') && calls.some(c => c.args[0] === 'publish') && calls.some(c => c.args[0] === 'ci'));
  for (const call of calls) {
    assert.equal(call.userconfigSize, 0, `userconfig of npm ${call.args[0]} is not an empty file`);
    assert.equal(call.globalconfigSize, 0, `globalconfig of npm ${call.args[0]} is not an empty file`);
    assert.ok(!call.env.npm_config_userconfig.startsWith(fx.baseEnv.HOME));
  }
  assert.deepEqual(fs.readdirSync(fx.tmp).filter(n => n.includes('npmcfg')), [], 'the config folder is removed');
  assert.ok(!readAll(path.join(fx.repo, '.trellis')).includes(CANARY));
});

test('the echoed command line and the log header are redacted too', t => {
  const config = testConfig({ gates: [{ name: 'gate', cwd: '.', command: ['npm', 'run', NPM_SHAPED] }] });
  const bad = makeFixture(t, { config });
  const r = bad.run(['gates', '--json']);
  assert.ok(!r.stderr.includes(NPM_SHAPED) && !r.stdout.includes(NPM_SHAPED));
  assert.ok(!readAll(path.join(bad.repo, '.trellis')).includes(NPM_SHAPED));
});

// ---------------------------------------------------------------------------------------------------------------------------------
// signals

test('SIGTERM stops the running gate and its whole process group, and exits 130', async t => {
  const fx = makeFixture(t);
  const pidFile = path.join(fx.root, 'grandchild.pid');
  fx.setNpm({ fail: [{ match: 'run typecheck', hang: true, pidFile }] });
  const run = fx.start(['gates']);
  const pid = await waitForPid(pidFile);
  run.child.kill('SIGTERM');
  const result = await run.done;
  assert.equal(result.status, 130, result.stderr);
  assert.equal(await isGone(pid), true, 'the grandchild process was still running');
  assert.equal(allFiles(path.join(fx.repo, '.trellis/release/receipts')).length, 0);
});

test('SIGINT reaches a child that ignores SIGTERM: it is killed after a short grace, and the exit is 130', async t => {
  const fx = makeFixture(t);
  const pidFile = path.join(fx.root, 'grandchild.pid'), selfPidFile = path.join(fx.root, 'npm.pid');
  fx.setNpm({ fail: [{ match: 'run typecheck', hang: true, ignoreTerm: true, pidFile, selfPidFile }] });
  const run = fx.start(['gates']);
  const pid = await waitForPid(pidFile);
  const self = await waitForPid(selfPidFile);
  run.child.kill('SIGINT');
  const result = await run.done;
  assert.equal(result.status, 130, result.stderr);
  assert.equal(await isGone(self), true, 'the fake npm survived SIGTERM and was not killed');
  assert.equal(await isGone(pid), true);
});

test('SIGHUP during a dry run removes the temporary folders and stops the pack', async t => {
  const fx = makeFixture(t);
  assert.equal(fx.run(['gates']).status, 0);
  const pidFile = path.join(fx.root, 'pack.pid');
  const run = fx.start(['dry-run'], { env: { FAKE_PACK_HANG: pidFile } });
  const pid = await waitForPid(pidFile);
  assert.ok(fs.readdirSync(fx.tmp).some(n => n.startsWith('bowerloom-release-')), 'the work folder exists while the pack runs');
  run.child.kill('SIGHUP');
  const result = await run.done;
  assert.equal(result.status, 130, result.stderr);
  assert.deepEqual(fs.readdirSync(fx.tmp), []);
  assert.equal(await isGone(pid), true);
  assert.equal(allFiles(path.join(fx.repo, '.trellis/release/receipts')).filter(f => f.includes('dry-run')).length, 0);
});

// ---------------------------------------------------------------------------------------------------------------------------------
// child output handling

test('a gate that leaves a daemon holding its pipes does not hold up the run, and the daemon is killed', async t => {
  const fx = makeFixture(t);
  const pidFile = path.join(fx.root, 'daemon.pid');
  fx.setNpm({ fail: [{ match: 'run typecheck', daemon: true, pidFile }] });
  const run = fx.start(['gates', '--json']);
  const timer = setTimeout(() => run.child.kill('SIGKILL'), 40_000);
  t.after(() => { clearTimeout(timer); try { process.kill(Number(fs.readFileSync(pidFile, 'utf8')), 'SIGKILL'); } catch { /* gone */ } });
  const started = Date.now();
  const result = await run.done;
  clearTimeout(timer);
  assert.equal(result.status, 0, result.stderr);
  assert.ok(Date.now() - started < 30_000, 'the run waited for the daemon');
  assert.equal(await isGone(await waitForPid(pidFile)), true, 'the daemon is still running');
});

test('output is decoded as UTF-8 across chunk borders', t => {
  const fx = makeFixture(t);
  fx.setNpm({ fail: [{ match: 'run typecheck', splitUtf8: true, message: 'npm error caf\u00e9 \u2615 broken' }] });
  const r = fx.run(['gates', '--json']);
  assert.equal(r.status, 1);
  assert.equal(r.json().message, 'gate "root: npm run typecheck" failed: npm error caf\u00e9 \u2615 broken');
});

// ---------------------------------------------------------------------------------------------------------------------------------
// seams

test('a test seam prints one loud warning on stderr and is recorded in every receipt', t => {
  const fx = makeFixture(t);
  const r = fx.run(['gates']);
  const warnings = r.stderr.split('\n').filter(l => l.startsWith('WARNING: test seams active'));
  assert.equal(warnings.length, 1);
  for (const name of ['BOWERLOOM_RELEASE_NPM', 'BOWERLOOM_RELEASE_PACK', 'BOWERLOOM_RELEASE_FREE_GIB', '--repo']) assert.ok(warnings[0].includes(name), name);
  assert.equal(fx.run(['dry-run']).status, 0);
  assert.equal(fx.run(['verify', '--tarball', path.join(fx.root, 'nope.tgz')]).status, 1);
  const receipts = allFiles(path.join(fx.repo, '.trellis/release/receipts'));
  assert.equal(receipts.length, 2);
  for (const f of receipts) assert.deepEqual(JSON.parse(fs.readFileSync(f, 'utf8')).seams.sort(), ['--repo', 'BOWERLOOM_RELEASE_FREE_GIB', 'BOWERLOOM_RELEASE_NPM', 'BOWERLOOM_RELEASE_PACK']);
});

test('a single seam is named alone', async t => {
  const fx = makeFixture(t);
  const streams = fakeStreams();
  const env = { ...fx.baseEnv };
  delete env.BOWERLOOM_RELEASE_PACK;
  delete env.BOWERLOOM_RELEASE_FREE_GIB;
  await runCli(['--repo', fx.repo, 'claims'], { env, stdin: streams.stdin, stdout: streams.stdout, stderr: streams.stderr });
  assert.match(streams.err(), /^WARNING: test seams active \(BOWERLOOM_RELEASE_NPM, --repo\)/m);
});

// ---------------------------------------------------------------------------------------------------------------------------------
// receipts and seams

/** Runs one subcommand in-process with the seam variables in `drop` removed from the environment. */
async function withoutSeams(fx, args, drop) {
  const streams = fakeStreams();
  const env = { ...fx.baseEnv };
  for (const name of drop) delete env[name];
  const code = await runCli(['--repo', fx.repo, ...args], { env, stdin: streams.stdin, stdout: streams.stdout, stderr: streams.stderr });
  return { code, out: streams.out(), err: streams.err() };
}

test('a receipt made under one set of seams is accepted only by a run with exactly that set, not by any run with a seam', async t => {
  const fx = makeFixture(t);
  // Gates under three seams (the pack seam is off; gates do not use it).
  const written = await withoutSeams(fx, ['gates'], ['BOWERLOOM_RELEASE_PACK']);
  assert.equal(written.code, 0, written.err);
  const receipt = JSON.parse(fs.readFileSync(allFiles(path.join(fx.repo, '.trellis/release/receipts'))[0], 'utf8'));
  assert.deepEqual(receipt.seams.sort(), ['--repo', 'BOWERLOOM_RELEASE_FREE_GIB', 'BOWERLOOM_RELEASE_NPM']);
  assert.equal(receipt.schema, 'bowerloom/release-receipt/v2');
  // A run with all four seams has seams, and still does not accept it.
  const four = fx.run(['tag', '--json']);
  assert.equal(four.status, 1);
  assert.match(four.json().message, /no passing gates receipt/);
  // A run with a different set of three does not accept it either.
  const other = await withoutSeams(fx, ['tag', '--json'], ['BOWERLOOM_RELEASE_FREE_GIB']);
  assert.equal(other.code, 1);
  assert.match(other.out, /no passing gates receipt/);
  // The same set does, and so does a gates run: it is already done.
  assert.equal((await withoutSeams(fx, ['gates'], ['BOWERLOOM_RELEASE_PACK'])).out.includes('already done'), true);
  // The tag step also needs a verify receipt of the same seams.
  const threeSeams = ['--repo', 'BOWERLOOM_RELEASE_FREE_GIB', 'BOWERLOOM_RELEASE_NPM'];
  fx.verified(fx.git('rev-parse', 'HEAD'), { seams: threeSeams });
  assert.equal((await withoutSeams(fx, ['tag'], ['BOWERLOOM_RELEASE_PACK'])).code, 0);
});

test('a receipt with no seams list, or from the first receipt schema, is treated as absent', t => {
  const fx = makeFixture(t);
  assert.equal(fx.run(['gates']).status, 0);
  const file = allFiles(path.join(fx.repo, '.trellis/release/receipts'))[0];
  const good = JSON.parse(fs.readFileSync(file, 'utf8'));
  const seen = () => fx.run(['dry-run', '--json']);
  for (const [name, edit] of [
    ['no seams key', r => { delete r.seams; }],
    ['seams not a list', r => { r.seams = 'none'; }],
    ['first schema', r => { r.schema = 'bowerloom/release-receipt/v1'; }],
  ]) {
    const damaged = JSON.parse(JSON.stringify(good));
    edit(damaged);
    fs.writeFileSync(file, JSON.stringify(damaged));
    const r = seen();
    assert.equal(r.status, 1, name);
    assert.match(r.json().message, /no passing gates receipt/, name);
    const gates = fx.run(['status', '--json']).json().phases.find(p => p.phase === 'gates');
    assert.equal(gates.state, 'todo', name);
  }
  assert.equal(fx.packCalls().length, 0);
  fs.writeFileSync(file, JSON.stringify(good));
  assert.equal(seen().status, 0);
});

test('a gates receipt must carry passing counts for every test gate of the config', t => {
  const fx = makeFixture(t);
  assert.equal(fx.run(['gates']).status, 0);
  const file = allFiles(path.join(fx.repo, '.trellis/release/receipts'))[0];
  const good = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(good.gates.filter(g => g.counts).length, 2);
  for (const [name, edit] of [
    ['counts removed from a test gate', r => { delete r.gates.find(g => g.name === 'root: npm test').counts; }],
    ['zero passing tests', r => { r.gates.find(g => g.name === 'desktop: npm test').counts.pass = 0; }],
    ['a failed test', r => { r.gates.find(g => g.name === 'desktop: npm test').counts.fail = 1; }],
    ['a gate missing', r => { r.gates = r.gates.filter(g => g.name !== 'root: npm run typecheck'); }],
    ['no gate list', r => { delete r.gates; }],
    ['end-to-end claimed without its gate', r => { r.e2e = true; }],
  ]) {
    const damaged = JSON.parse(JSON.stringify(good));
    edit(damaged);
    fs.writeFileSync(file, JSON.stringify(damaged));
    const r = fx.run(['dry-run', '--json']);
    assert.equal(r.status, 1, name);
    assert.match(r.json().message, /no passing gates receipt/, name);
  }
  assert.equal(fx.packCalls().length, 0);
});

// ---------------------------------------------------------------------------------------------------------------------------------
// publish printing

const dryReceiptFile = fx => allFiles(path.join(fx.repo, '.trellis/release/receipts')).find(f => path.basename(f).startsWith('dry-run-'));
const editReceipt = (fx, patch) => { const f = dryReceiptFile(fx); fs.writeFileSync(f, JSON.stringify({ ...JSON.parse(fs.readFileSync(f, 'utf8')), ...patch })); };

test('publish prints the shasum step, and strips control characters from the expected account', async t => {
  const fx = makeFixture(t, { record: { npm: { published: false, authenticatedIdentity: 'te\u001b[31mst\nuser' } } });
  assert.equal(fx.run(['gates']).status, 0);
  const dry = fx.run(['dry-run', '--json']).json();
  const r = await inProcess(fx, ['publish'], { tty: true });
  assert.equal(r.code, 0);
  assert.ok(r.out.split('\n').includes(`shasum -a 256 ${dry.tarball}`));
  assert.ok(!/[\u0000-\u0008\u000b-\u001f\u007f]/.test(r.out));
  assert.match(r.out, /does not show te\[31mstuser\./);
});

test('publish refuses, prints nothing and exits 1, when the receipt is damaged or the tarball is missing or changed', async t => {
  const fx = makeFixture(t);
  assert.equal(fx.run(['gates']).status, 0);
  const dry = fx.run(['dry-run', '--json']).json();
  const good = fs.readFileSync(dryReceiptFile(fx), 'utf8');
  const cases = [
    ['bad sha256', () => editReceipt(fx, { sha256: 'xyz' }), /receipt SHA-256 is not valid/],
    ['bad integrity', () => editReceipt(fx, { integrity: 'sha1-abc' }), /receipt integrity is not valid/],
    ['control character in the path', () => editReceipt(fx, { tarball: dry.tarball + '\nrm -rf x' }), /tarball path/],
    ['changed tarball', () => fs.writeFileSync(dry.tarball, 'changed bytes'), /does not match the dry-run receipt/],
    ['missing tarball', () => fs.rmSync(dry.tarball), /tarball .* not found/],
  ];
  for (const [name, damage, message] of cases) {
    fs.writeFileSync(dryReceiptFile(fx), good);
    fs.writeFileSync(dry.tarball, TARBALL);
    damage();
    const r = await inProcess(fx, ['publish'], { tty: true });
    assert.equal(r.code, 1, name);
    assert.equal(r.out, '', name);
    assert.match(r.err, message, name);
    const plain = fx.run(['publish']);
    assert.equal(plain.status, 1, name);
    assert.equal(plain.stdout, '', name);
  }
  assert.equal(fx.npmCalls().filter(c => c.args[0] === 'publish' && !c.args.includes('--dry-run')).length, 0);
});

// ---------------------------------------------------------------------------------------------------------------------------------
// config details, entry point, help

test('a tag prefix must start with a letter or digit', () => {
  for (const bad of ['-x', '.v', '_v', ' v']) assert.throws(() => validateConfig({ ...testConfig(), tagPrefix: bad }), UsageError, JSON.stringify(bad));
  for (const good of ['v', 'rel-', '']) assert.doesNotThrow(() => validateConfig({ ...testConfig(), tagPrefix: good }), JSON.stringify(good));
});

test('the hash file lists names in plain code-point order, not in locale order', t => {
  const fx = makeFixture(t);
  fx.artifacts({ 'a-0.8.0-beta.2.dmg': '1', 'B-0.8.0-beta.2.dmg': '2', 'c-0.8.0-beta.2.zip': '3' });
  assert.equal(fx.run(['hashes']).status, 0);
  assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(path.join(fx.repo, 'release/desktop-sha256.json'), 'utf8')).files), ['B-0.8.0-beta.2.dmg', 'a-0.8.0-beta.2.dmg', 'c-0.8.0-beta.2.zip']);
});

test('entryState tells the main script, an importer, and a look-alike that must not exit silently', t => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(fs.realpathSync(process.env.TMPDIR || '/tmp'), 'bowerloom-entry-test-')));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const link = path.join(dir, 'link.mjs');
  fs.symlinkSync(scriptPath, link);
  fs.writeFileSync(path.join(dir, 'release.mjs'), '// another file with the same name\n');
  assert.equal(entryState(scriptPath, scriptPath), 'main');
  assert.equal(entryState(link, scriptPath), 'main');
  assert.equal(entryState('/usr/bin/other-runner.mjs', scriptPath), 'imported');
  assert.equal(entryState(undefined, scriptPath), 'imported');
  assert.equal(entryState(path.join(dir, 'release.mjs'), scriptPath), 'mismatch');
  assert.equal(entryState(path.join(dir, 'gone', 'release.mjs'), scriptPath), 'mismatch');
});

test('started through a symlink, the script runs; started under its own name from another file, it says so and exits 2 instead of 0', t => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(fs.realpathSync(process.env.TMPDIR || '/tmp'), 'bowerloom-link-test-')));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const link = path.join(dir, 'link.mjs');
  fs.symlinkSync(scriptPath, link);
  const viaLink = spawnSync(process.execPath, [link, '--help'], { encoding: 'utf8', timeout: 60_000 });
  assert.equal(viaLink.status, 0, viaLink.stderr);
  assert.match(viaLink.stdout, /Usage: node scripts\/release\.mjs/);
  // A preload that makes the entry path look like another file called release.mjs.
  const preload = 'data:text/javascript,process.argv[1]=' + JSON.stringify(path.join(dir, 'gone', 'release.mjs'));
  const lookAlike = spawnSync(process.execPath, ['--import', preload, scriptPath, '--help'], { encoding: 'utf8', timeout: 60_000 });
  assert.equal(lookAlike.status, 2, lookAlike.stdout);
  assert.match(lookAlike.stderr, /is not this script/);
});

test('--help --json prints one JSON object with the subcommand table', t => {
  const fx = makeFixture(t);
  const r = fx.run(['--help', '--json']);
  assert.equal(r.status, 0);
  assert.equal(r.stdout.split('\n').filter(Boolean).length, 1);
  const out = r.json();
  assert.equal(out.schema, 'bowerloom/release-result/v1');
  assert.equal(out.ok, true);
  assert.equal(out.outcome, 'help');
  assert.deepEqual(out.commands.map(c => c.name), ['status', 'preflight', 'gates', 'dry-run', 'publish', 'hashes', 'verify', 'tag', 'retire', 'claims']);
  assert.match(out.usage, /^Usage: /);
});

test('the ssh agent variables reach git but never npm, node, or the pack script', t => {
  const fx = makeFixture(t);
  const seen = path.join(fx.root, 'ssh-seen.txt');
  const sshCommand = path.join(fx.root, 'fake-ssh.sh');
  fs.writeFileSync(sshCommand, `#!/bin/sh\nprintf '%s|%s' "$SSH_AUTH_SOCK" "$SSH_AGENT_PID" > '${seen}'\nexit 1\n`, { mode: 0o755 });
  fx.git('config', 'core.sshCommand', sshCommand);
  fx.git('remote', 'set-url', 'origin', 'ssh://example.invalid/none.git');
  const env = { SSH_AUTH_SOCK: '/canary/agent.sock', SSH_AGENT_PID: '4242' };
  const pre = fx.run(['preflight', '--json'], { env });
  assert.equal(pre.status, 1, 'the fake ssh refuses, so the fetch fails');
  assert.equal(fs.readFileSync(seen, 'utf8'), '/canary/agent.sock|4242', 'git over ssh sees the agent');

  const gates = fx.run(['gates', '--json'], { env });
  assert.equal(gates.status, 0, gates.stderr);
  const calls = fx.npmCalls();
  assert.ok(calls.length > 0);
  for (const call of calls) {
    assert.equal(call.env.SSH_AUTH_SOCK, undefined, `npm ${call.args.join(' ')}`);
    assert.equal(call.env.SSH_AGENT_PID, undefined, `npm ${call.args.join(' ')}`);
  }
  const dry = fx.run(['dry-run', '--json'], { env });
  assert.equal(dry.status, 0, dry.stderr);
  for (const call of fx.packCalls()) {
    assert.equal(call.env.SSH_AUTH_SOCK, undefined, 'pack');
    assert.equal(call.env.SSH_AGENT_PID, undefined, 'pack');
  }
});
