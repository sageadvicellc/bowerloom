// Gate 1 Part A, "the core runs with no shell at all": the Node core of the Tauri sidecar is started by plain Node, with no Tauri and no Electron in the process tree.
// The channel is one stdin and stdout pipe, one JSON line each way. Nothing listens on a port.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { join } from 'node:path';
import { SPIKE, giveUpAfter, waitFor } from './support.mjs';

const CORE = join(SPIKE, 'tauri', 'src-tauri', 'resources', 'core.mjs');

function startCore(t) {
  assert.ok(existsSync(CORE), `no core at ${CORE}: run npm run build:tauri`);
  const child = spawn(process.execPath, [CORE], { stdio: ['pipe', 'pipe', 'pipe'] });
  t.after(() => child.kill('SIGKILL'));
  const messages = [];
  const waiters = [];
  createInterface({ input: child.stdout }).on('line', line => {
    const message = JSON.parse(line);
    messages.push(message);
    for (const w of waiters.splice(0)) w();
  });
  const send = message => child.stdin.write(`${JSON.stringify(message)}\n`);
  const next = async predicate => {
    for (;;) {
      const found = messages.find(predicate);
      if (found) { messages.splice(messages.indexOf(found), 1); return found; }
      await Promise.race([new Promise(resolve => waiters.push(resolve)), giveUpAfter(15000).then(() => { throw new Error('no message in 15 s'); })]);
    }
  };
  const ended = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })));
  return { child, send, next, messages, ended };
}

test('A0.1 the core says ready first, with its process id, and ping returns', async t => {
  const core = startCore(t);
  const ready = await core.next(m => m.type === 'ready');
  assert.equal(ready.pid, core.child.pid);
  core.send({ type: 'call', id: 1, method: 'ping', args: [] });
  const reply = await core.next(m => m.type === 'result' && m.id === 1);
  assert.equal(reply.ok, true);
  assert.equal(reply.value.pong, true);
});

test('A0.2 10,000 numbered events arrive in order, once each, before the answer', async t => {
  const core = startCore(t);
  await core.next(m => m.type === 'ready');
  core.send({ type: 'call', id: 7, method: 'events', args: [10000] });
  const reply = await core.next(m => m.type === 'result' && m.id === 7);
  assert.equal(reply.value.sent, 10000);
  const seqs = core.messages.filter(m => m.type === 'event').map(m => m.seq);
  assert.equal(seqs.length, 10000);
  assert.deepEqual(seqs, Array.from({ length: 10000 }, (_, i) => i));
});

test('A0.3 an unknown method is refused with BAD_ARGUMENT and a line that is not JSON is ignored', async t => {
  const core = startCore(t);
  await core.next(m => m.type === 'ready');
  core.child.stdin.write('this is not json\n');
  core.send({ type: 'call', id: 2, method: 'nope', args: [] });
  const reply = await core.next(m => m.type === 'result' && m.id === 2);
  assert.equal(reply.ok, false);
  assert.equal(reply.code, 'BAD_ARGUMENT');
  core.send({ type: 'call', id: 3, method: 'ping', args: [] });
  assert.equal((await core.next(m => m.type === 'result' && m.id === 3)).ok, true);
});

test('A0.4 the core ends by itself when its stdin closes (the shell is gone)', async t => {
  const core = startCore(t);
  await core.next(m => m.type === 'ready');
  core.child.stdin.end();
  const end = await Promise.race([core.ended, giveUpAfter(5000)]);
  assert.ok(end, 'the core ended within 5 s of the pipe closing');
  assert.equal(end.code, 0);
});

test('A0.5 the core holds no listening port', async t => {
  const core = startCore(t);
  await core.next(m => m.type === 'ready');
  const lsof = spawn('lsof', ['-nP', '-a', '-p', String(core.child.pid), '-iTCP', '-iUDP'], { stdio: ['ignore', 'pipe', 'ignore'] });
  let out = '';
  lsof.stdout.on('data', c => { out += c; });
  await new Promise(resolve => lsof.once('exit', resolve));
  assert.equal(out.trim(), '', `lsof showed sockets: ${out}`);
  assert.equal(await waitFor(() => true, 10), true);
});
