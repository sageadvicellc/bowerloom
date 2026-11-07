import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { installInterruptHandlers, onInterrupt, runCleanups, isStopping, liveGroupCount, INTERRUPT_EXIT } from '../lib/interrupt.mjs';
import { runChild } from '../lib/run-child.mjs';

const lib = name => fileURLToPath(new URL(`../lib/${name}`, import.meta.url));
const made = [];
test.after(() => { for (const dir of made) fs.rmSync(dir, { recursive: true, force: true }); });
const tmp = () => { const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'interrupt-test-'))); made.push(dir); return dir; };

async function waitFor(file, ms = 30000) {
  const end = Date.now() + ms;
  while (!fs.existsSync(file) && Date.now() < end) await new Promise(resolve => setTimeout(resolve, 25));
  return fs.existsSync(file);
}
async function goneWithin(pid, ms = 8000) {
  const end = Date.now() + ms;
  for (;;) {
    try { process.kill(pid, 0); } catch (error) { if (error.code === 'ESRCH') return true; throw error; }
    if (Date.now() > end) return false;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
}

/**
 * Runs a small program that installs the handlers, registers cleanups, and runs one long child. `shell` is the child's shell text.
 * Returns { dir, program, stderr() } once the child has written its pid file; the caller sends the signal.
 */
async function launch({ shell, throwingCleanup = false }) {
  const dir = tmp();
  const pidFile = path.join(dir, 'pid'), cleaned = path.join(dir, 'cleaned');
  const program = path.join(dir, 'program.mjs');
  fs.writeFileSync(program, [
    "import fs from 'node:fs';",
    `import { installInterruptHandlers, onInterrupt } from ${JSON.stringify(lib('interrupt.mjs'))};`,
    `import { runChild } from ${JSON.stringify(lib('run-child.mjs'))};`,
    'installInterruptHandlers();',
    `onInterrupt(() => fs.writeFileSync(${JSON.stringify(cleaned)}, 'cleaned'));`,
    throwingCleanup ? "onInterrupt(() => { throw new Error('cleanup boom'); });" : '',
    `await runChild('sh', ['-c', ${JSON.stringify(shell.replaceAll('PIDFILE', pidFile))}], { timeoutMs: 120000 });`,
    '// The program ends by itself; the pending interrupt timer keeps it alive until the handler exits 130.',
  ].join('\n'));
  const child = spawn(process.execPath, [program], { stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk; });
  const exited = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })));
  assert.equal(await waitFor(pidFile), true, 'the child started');
  await new Promise(resolve => setTimeout(resolve, 100)); // let the pid file be written in full
  return { child, exited, pid: Number(fs.readFileSync(pidFile, 'utf8')), cleaned, stderr: () => stderr };
}

for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) {
  test(`${signal} stops the child group, runs the cleanups, and exits 130`, async () => {
    const run = await launch({ shell: 'echo $$ > PIDFILE; exec sleep 120' });
    run.child.kill(signal);
    const result = await run.exited;
    assert.equal(result.code, INTERRUPT_EXIT);
    assert.equal(fs.existsSync(run.cleaned), true, 'the cleanup ran');
    assert.equal(await goneWithin(run.pid), true, 'the child is gone');
    assert.match(run.stderr(), new RegExp(`interrupted by ${signal}`));
  });
}

test('a child that ignores TERM is killed after the grace period, with the rest of its group', async () => {
  const run = await launch({ shell: "trap '' TERM; (sleep 120 &) ; echo $$ > PIDFILE; while true; do sleep 1; done" });
  const started = Date.now();
  run.child.kill('SIGTERM');
  const result = await run.exited;
  assert.equal(result.code, INTERRUPT_EXIT);
  assert.ok(Date.now() - started >= 1000, 'it waited for the grace period before it escalated');
  assert.equal(await goneWithin(run.pid), true, 'the shell is gone after SIGKILL');
  assert.equal(fs.existsSync(run.cleaned), true);
});

test('a cleanup that throws prints one stderr line, the other cleanups still run, and the exit is 130', async () => {
  const run = await launch({ shell: 'echo $$ > PIDFILE; exec sleep 120', throwingCleanup: true });
  run.child.kill('SIGTERM');
  const result = await run.exited;
  assert.equal(result.code, INTERRUPT_EXIT);
  assert.equal(fs.existsSync(run.cleaned), true, 'the cleanup that does not throw still ran');
  const lines = run.stderr().split('\n').filter(line => /cleanup failed/.test(line));
  assert.equal(lines.length, 1, run.stderr());
  assert.match(lines[0], /cleanup boom/);
});

test('isStopping turns true on a signal, runChild then refuses to start a child, and removing the handlers resets it', async () => {
  const exits = [], said = [];
  const remove = installInterruptHandlers({ exit: code => exits.push(code), say: line => said.push(line) });
  try {
    assert.equal(isStopping(), false);
    const before = await runChild(process.execPath, ['-e', '0']);
    assert.equal(before.reason, null);
    process.emit('SIGTERM');
    assert.equal(isStopping(), true);
    const refused = await runChild(process.execPath, ['-e', 'require("node:fs").writeFileSync(process.argv[1], "ran")', path.join(tmp(), 'ran')]);
    assert.equal(refused.reason, 'START_FAILED');
    assert.match(refused.message, /stopping/);
    assert.equal(liveGroupCount(), 0, 'nothing is left tracked');
    const end = Date.now() + 5000;
    while (exits.length === 0 && Date.now() < end) await new Promise(resolve => setTimeout(resolve, 10));
    assert.deepEqual(exits, [INTERRUPT_EXIT]);
    assert.match(said[0], /interrupted by SIGTERM/);
  } finally { remove(); }
  assert.equal(isStopping(), false);
});

test('runCleanups runs the newest first, once each, says one line for each failure, and never stops at one', () => {
  const order = [], said = [];
  const forget = onInterrupt(() => order.push('first'));
  onInterrupt(() => { throw new Error('bad one'); });
  onInterrupt(() => order.push('third'));
  onInterrupt(() => { throw new Error('bad two'); });
  forget();
  runCleanups(line => said.push(line));
  assert.deepEqual(order, ['third']);
  assert.equal(said.length, 2);
  assert.match(said[0], /cleanup failed: bad two/);
  assert.match(said[1], /cleanup failed: bad one/);
  runCleanups(line => said.push(line));
  assert.equal(said.length, 2, 'cleanups run once');
});
