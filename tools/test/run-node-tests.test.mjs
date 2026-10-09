import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// --test-force-exit dropped results: in 1 of 5 full runs, 11 results of one suite went missing with exit 0. Every
// test script now runs `node --test` through tools/run-node-tests.mjs, which passes the exit code through and, past
// one wall-clock limit for the whole run, kills the run's process group and exits non-zero.
const root = fileURLToPath(new URL('../../', import.meta.url));
const runner = path.join(root, 'tools/run-node-tests.mjs');
const probe = path.join(root, 'tools/test/probes/stuck-live-handle.probe.mjs');
const LIMIT_VAR = 'BOWERLOOM_TEST_WALL_LIMIT_SECONDS';
// A child `node --test` that inherits NODE_TEST_CONTEXT reports to this run instead of running on its own.
const { NODE_TEST_CONTEXT: _context, [LIMIT_VAR]: _limit, ...baseEnv } = process.env;

/** Every test command of every script in the repository's package.json files that run tests. */
function invocations() {
  const found = [];
  for (const file of ['package.json', 'apps/docs/package.json']) {
    const scripts = JSON.parse(fs.readFileSync(path.join(root, file), 'utf8')).scripts ?? {};
    for (const [name, command] of Object.entries(scripts)) {
      for (const part of String(command).split('&&')) {
        const words = part.trim().split(/\s+/);
        if (words[0] !== 'node') continue;
        const target = words[1] === '--test' ? '--test' : path.resolve(root, path.dirname(file), words[1]);
        if (target === '--test' || target === runner) found.push({ file, name, target, words });
      }
    }
  }
  return found;
}

function scratch(t, files = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bowerloom run-node-tests '));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), text);
  return dir;
}

const alive = pid => { try { process.kill(pid, 0); return true; } catch (error) { if (error.code === 'ESRCH') return false; throw error; } };
async function gone(pid, ms = 10000) {
  const until = Date.now() + ms;
  while (alive(pid)) { if (Date.now() > until) return false; await new Promise(r => setTimeout(r, 100)); }
  return true;
}
/** Runs the runner like a test script does, with NODE_TEST_CONTEXT removed and the limit variable as given. */
function run(args, { limit, timeout = 60000, env = {} } = {}) {
  const started = Date.now();
  const result = spawnSync(process.execPath, [runner, ...args], {
    encoding: 'utf8', timeout, killSignal: 'SIGKILL', env: { ...baseEnv, ...(limit === undefined ? {} : { [LIMIT_VAR]: limit }), ...env },
  });
  return { ...result, ms: Date.now() - started };
}

test('every test script runs node --test through the runner, keeps its timeouts, and passes no --test-force-exit', () => {
  const all = invocations();
  assert.ok(all.length >= 23, `found ${all.length}`);
  assert.deepEqual(all.filter(i => i.target !== runner).map(i => `${i.file} ${i.name}: bare node --test`), []);
  assert.deepEqual(all.filter(i => i.words.includes('--test-force-exit')).map(i => `${i.file} ${i.name}`), []);
  assert.deepEqual(all.filter(i => i.file === 'package.json' && !i.words.includes('--test-timeout=120000')).map(i => i.name), []);
  // The runner adds --test itself; a second one would be passed to node --test as a file pattern.
  assert.deepEqual(all.filter(i => i.words.slice(2).includes('--test')).map(i => `${i.file} ${i.name}`), []);
});

test('the runner passes the exit code of node --test through, 0 for a pass and 1 for a failure', t => {
  const dir = scratch(t, {
    'pass.test.mjs': "import test from 'node:test';\ntest('passes', () => {});\n",
    'fail.test.mjs': "import test from 'node:test';\ntest('fails on purpose', () => { throw new Error('expected'); });\n",
  });
  const passed = run(['--test-timeout=30000', path.join(dir, 'pass.test.mjs')]);
  assert.equal(passed.signal, null); assert.equal(passed.status, 0, passed.stderr);
  assert.match(passed.stdout, /passes/); assert.match(passed.stdout, /tests 1\b/);
  const failed = run(['--test-timeout=30000', path.join(dir, 'pass.test.mjs'), path.join(dir, 'fail.test.mjs')]);
  assert.equal(failed.signal, null); assert.equal(failed.status, 1, failed.stderr);
  assert.match(failed.stdout, /fails on purpose/); assert.match(failed.stdout, /tests 2\b/); assert.match(failed.stdout, /fail 1\b/);
  assert.equal(passed.stderr + failed.stderr, '', 'the runner adds nothing to a run that ends by itself');
});

test('a stuck test holding a live handle makes the run fail at the wall-clock limit instead of hanging', async t => {
  const dir = scratch(t), pids = path.join(dir, 'probe.pid');
  const result = run(['--test-timeout=1500', probe], { limit: '3', env: { BOWERLOOM_PROBE_PID_FILE: pids } });
  assert.equal(result.signal, null, 'the runner ended by itself, not by the test timeout');
  assert.notEqual(result.status, 0); assert.equal(result.status, 124);
  assert.ok(result.ms >= 3000 && result.ms < 30000, `took ${result.ms} ms`);
  assert.match(result.stderr, /wall-clock limit of 3 s/); assert.match(result.stderr, new RegExp(LIMIT_VAR));
  assert.match(result.stdout, /stuck with a live handle/, 'the per-test timeout still reported the stuck test');
  // The probe's test process and its node --test parent were both in the killed process group.
  const [testPid, runPid] = fs.readFileSync(pids, 'utf8').trim().split(' ').map(Number);
  assert.ok(testPid > 0 && runPid > 0);
  assert.equal(await gone(testPid), true, 'the stuck test process is gone'); assert.equal(await gone(runPid), true, 'node --test is gone');
});

test('the limit variable can only lower the 45-minute default, and a value that is not a whole number of seconds is refused', t => {
  const dir = scratch(t, { 'pass.test.mjs': "import test from 'node:test';\ntest('passes', () => {});\n" });
  const higher = run([path.join(dir, 'pass.test.mjs')], { limit: '99999' });
  assert.equal(higher.status, 0, higher.stderr);
  assert.match(higher.stderr, /can only lower/); assert.match(higher.stderr, /2700 s/);
  const lower = run([path.join(dir, 'pass.test.mjs')], { limit: '600' });
  assert.equal(lower.status, 0, lower.stderr); assert.equal(lower.stderr, '');
  for (const bad of ['0', '-5', '1.5', 'abc', '', '45m']) {
    const refused = run([path.join(dir, 'pass.test.mjs')], { limit: bad });
    assert.equal(refused.status, 2, `${JSON.stringify(bad)}: ${refused.stderr}`);
    assert.match(refused.stderr, new RegExp(LIMIT_VAR)); assert.doesNotMatch(refused.stdout, /passes/, 'no run was started');
  }
});

test('a SIGTERM to the runner reaches the whole run, and the runner exits non-zero', async t => {
  const dir = scratch(t), pids = path.join(dir, 'probe.pid');
  const child = spawn(process.execPath, [runner, probe], { env: { ...baseEnv, BOWERLOOM_PROBE_PID_FILE: pids }, stdio: 'ignore' });
  t.after(() => { try { child.kill('SIGKILL'); } catch {} });
  const until = Date.now() + 30000;
  while (!fs.existsSync(pids) || !fs.readFileSync(pids, 'utf8').includes(' ')) {
    assert.ok(Date.now() < until, 'the probe started'); await new Promise(r => setTimeout(r, 100));
  }
  const [testPid, runPid] = fs.readFileSync(pids, 'utf8').trim().split(' ').map(Number);
  const exited = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })));
  child.kill('SIGTERM');
  const { code, signal } = await exited;
  assert.equal(signal, null); assert.ok(code !== 0 && code !== null, `exit ${code}`);
  assert.equal(await gone(testPid), true, 'the stuck test process is gone'); assert.equal(await gone(runPid), true, 'node --test is gone');
});
