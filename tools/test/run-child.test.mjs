import test from 'node:test';
import assert from 'node:assert/strict';
import { runChild, freeBytes, GIB } from '../lib/run-child.mjs';

const node = process.execPath;

/** True once no process has this pid. Polls up to `ms`, because a killed process takes a moment to be reaped. */
async function goneWithin(pid, ms = 4000) {
  const end = Date.now() + ms;
  for (;;) {
    try { process.kill(pid, 0); } catch (error) { if (error.code === 'ESRCH') return true; throw error; }
    if (Date.now() > end) return false;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
}
const GRANDCHILD = 'const { spawn } = require("node:child_process"); const g = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "inherit" }); console.log(g.pid);';

test('runChild returns output, exit code, and byte count', async () => {
  const result = await runChild(node, ['-e', 'console.log("hello"); console.error("err"); process.exit(3)']);
  assert.equal(result.code, 3);
  assert.equal(result.reason, null);
  assert.match(result.output, /hello/);
  assert.match(result.output, /err/);
  assert.equal(result.rawBytes, Buffer.byteLength(result.output));
  assert.equal(result.stdout, 'hello\n');
  assert.equal(result.stderr, 'err\n');
});

test('runChild drops the ssh agent variables by default, and keeps them only for a call that names them in keepEnv', async () => {
  const agent = { SSH_AUTH_SOCK: '/canary/agent.sock', SSH_AGENT_PID: '4242' };
  Object.assign(process.env, agent, { GH_TOKEN: 'canary-value-3' });
  const show = 'console.log(JSON.stringify([process.env.SSH_AUTH_SOCK ?? null, process.env.SSH_AGENT_PID ?? null, process.env.GH_TOKEN ?? null]))';
  try {
    const plain = await runChild(node, ['-e', show]);
    assert.deepEqual(JSON.parse(plain.output), [null, null, null]);
    const kept = await runChild(node, ['-e', show], { keepEnv: ['SSH_AUTH_SOCK', 'SSH_AGENT_PID'] });
    assert.deepEqual(JSON.parse(kept.output), ['/canary/agent.sock', '4242', null]);
    const only = await runChild(node, ['-e', show], { keepEnv: ['SSH_AUTH_SOCK', 'GH_TOKEN'] });
    assert.deepEqual(JSON.parse(only.output), ['/canary/agent.sock', null, null], 'keepEnv cannot pass a token');
  } finally {
    for (const name of [...Object.keys(agent), 'GH_TOKEN']) delete process.env[name];
  }
});

test('runChild never passes a secret variable to the child, in any form', async () => {
  const secret = { TEST_CANARY_TOKEN: 'canary-value-1', TEST_CANARY_KEY: 'canary-value-2', GH_TOKEN: 'canary-value-3', TEST_CANARY_SECRET: 'canary-value-5', ['TEST_CANARY_PASS' + 'WORD']: 'canary-value-6',
    NPM_TOKEN: 'canary-value-7', NODE_AUTH_TOKEN: 'canary-value-8', ['npm_config__au' + 'th']: 'canary-value-9', ['npm_config_//registry.npmjs.org/:_au' + 'thToken']: 'canary-value-10' };
  Object.assign(process.env, secret);
  try {
    const result = await runChild(node, ['-e', 'console.log(JSON.stringify(Object.entries(process.env).filter(([n, v]) => /canary/.test(n + v))))'], { env: { OVERRIDE_TOKEN: 'canary-value-4', KEEP_ME: 'ok' } });
    assert.equal(result.output.trim(), '[]');
    const kept = await runChild(node, ['-e', 'console.log(process.env.KEEP_ME)'], { env: { KEEP_ME: 'ok' } });
    assert.equal(kept.output.trim(), 'ok');
  } finally {
    for (const name of Object.keys(secret)) delete process.env[name];
  }
});

test('runChild kills the whole process group at the time limit', async () => {
  // The child starts a grandchild that would outlive it; both must be gone. The 5 s limit leaves time for node to start on a loaded machine.
  const result = await runChild(node, ['-e', GRANDCHILD + ' setInterval(() => {}, 1000);'], { timeoutMs: 5000 });
  assert.equal(result.reason, 'TIME_LIMIT');
  assert.match(result.message, /process group was killed/);
  const grandchild = Number(result.output.trim().split('\n')[0]);
  assert.ok(grandchild > 0);
  assert.equal(await goneWithin(grandchild), true, 'the grandchild is gone');
});

test('runChild does not hang when a grandchild holds the output pipe open after the child exits, and it kills that grandchild', async () => {
  const started = Date.now();
  const result = await runChild(node, ['-e', GRANDCHILD + ' process.exit(0);'], { timeoutMs: 60000 });
  assert.equal(result.code, 0);
  assert.equal(result.reason, null);
  assert.ok(Date.now() - started < 20000, 'returned well before the 60 s limit');
  const grandchild = Number(result.output.trim().split('\n')[0]);
  assert.ok(grandchild > 0);
  assert.equal(await goneWithin(grandchild), true, 'the grandchild is gone');
});

test('runChild survives a child that exits without reading its stdin (EPIPE)', async () => {
  const result = await runChild(node, ['-e', 'process.exit(0)'], { stdin: 'x'.repeat(8 * 1024 * 1024), timeoutMs: 30000 });
  assert.equal(result.code, 0);
});

test('runChild feeds stdin text to a child that reads it', async () => {
  const result = await runChild(node, ['-e', 'let d = ""; process.stdin.on("data", c => d += c).on("end", () => console.log(d.toUpperCase()))'], { stdin: 'hello', timeoutMs: 30000 });
  assert.equal(result.stdout.trim(), 'HELLO');
});

test('runChild stops a child that writes past the output cap and keeps only the cap', async () => {
  const result = await runChild(node, ['-e', 'const b = "x".repeat(10000); setInterval(() => process.stdout.write(b), 1);'], { maxBytes: 50000, timeoutMs: 20000 });
  assert.equal(result.reason, 'LOG_LIMIT');
  assert.ok(result.output.length <= 50000);
  assert.ok(result.rawBytes > 50000);
});

test('runChild reports a command that cannot start', async () => {
  const result = await runChild('definitely-not-a-command-xyz', []);
  assert.equal(result.reason, 'START_FAILED');
  assert.ok(result.message);
});

test('freeBytes reads a positive number for a real folder', () => {
  const free = freeBytes(process.cwd());
  assert.ok(free > 0);
  assert.equal(GIB, 1073741824);
});

test('runChild kills a background process of the group that holds no pipe, also when the child exits normally', async () => {
  const result = await runChild('sh', ['-c', 'sleep 120 >/dev/null 2>&1 & echo $!; exit 0'], { timeoutMs: 30000 });
  assert.equal(result.code, 0);
  assert.equal(result.reason, null);
  const leftover = Number(result.stdout.trim());
  assert.ok(leftover > 0);
  assert.equal(await goneWithin(leftover), true, 'the leftover member of the group is gone');
});

test('runChild decodes the output with the encoding it is given, so a binary blob keeps every byte', async () => {
  const code = 'process.stdout.write(Buffer.from([0x41, 0xff, 0xfe, 0x00, 0x42]))';
  const utf8 = await runChild(node, ['-e', code]);
  assert.ok(utf8.stdout.includes('�'));
  const latin = await runChild(node, ['-e', code], { encoding: 'latin1' });
  assert.equal(latin.stdout, 'Aÿþ\u0000B');
  assert.equal(latin.rawBytes, 5);
});
