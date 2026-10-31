// The persona server with a stand-in for the app window: the token, the loopback rule, the host rule, the allowlist at the door, the transcript,
// the time limit, one command at a time, and how an inner failure is told to a persona. The real app is not started here.
import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Server } from 'node:http';
import type { TestContext } from 'node:test';
import { DESKTOP, tempDir } from './support.js';

interface Runner { run(cmd: string, args: unknown[]): Promise<string> }
interface Made { server: Server; listen(): Promise<number>; close(): Promise<void> }
interface ServerModule {
  createCommandServer(o: { token: string; runner: Runner; transcript: string; onStop(): void; timeoutMs?: number; redact?: (t: string) => string; logError?: (e: unknown) => void; now?: () => string }): Made;
  TOKEN_HEADER: string; TIME_LIMIT_MS: number;
}
interface ClientModule {
  readState(o: { id?: string; statePath?: string; env?: Record<string, string | undefined> }): { port: number; token: string; pid: number; file: string };
  sendCommand(state: { port: number; token: string }, cmd: string, args: string[], limit?: number): Promise<{ ok: boolean; text: string }>;
}
interface ProtocolModule { PersonaError: new (m: string) => Error }
const tool = async <T>(file: string): Promise<T> => await import(join(DESKTOP, 'tools', 'personas', file)) as T;

interface Reply { status: number; body: { ok: boolean; text: string } }
function post(port: number, opts: { path?: string; method?: string; token?: string | null; host?: string; body?: string; header?: string }): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (opts.token !== null && opts.token !== undefined) headers[opts.header ?? 'x-persona-token'] = opts.token;
    if (opts.host !== undefined) headers.host = opts.host;
    const req = request({ host: '127.0.0.1', port, path: opts.path ?? '/cmd', method: opts.method ?? 'POST', headers }, res => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => { try { resolve({ status: res.statusCode ?? 0, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) as Reply['body'] }); } catch (e) { reject(e as Error); } });
    });
    req.on('error', reject);
    req.end(opts.body ?? '');
  });
}
const cmd = (c: string, args: string[] = []): string => JSON.stringify({ cmd: c, args });

async function start(t: TestContext, runner: Runner, extra: Partial<Parameters<ServerModule['createCommandServer']>[0]> = {}): Promise<{ port: number; token: string; transcript: string; stopped: () => number; dir: string }> {
  const { createCommandServer } = await tool<ServerModule>('server.mjs');
  const dir = tempDir(t, 'bowerloom-personas-test-');
  const transcript = join(dir, 'transcript.txt');
  let stops = 0;
  const made = createCommandServer({ token: 'secret-token-1234', runner, transcript, onStop: () => { stops += 1; }, now: () => '2026-10-25T10:00:00.000Z', ...extra });
  const port = await made.listen();
  t.after(() => made.close());
  return { port, token: 'secret-token-1234', transcript, stopped: () => stops, dir };
}
const echo = (calls: string[] = []): Runner => ({ async run(c, a) { calls.push([c, ...a.map(String)].join(' ')); return `did ${c}`; } });

test('the server listens on 127.0.0.1 only, on a random port', async t => {
  const { createCommandServer } = await tool<ServerModule>('server.mjs');
  const dir = tempDir(t);
  const one = createCommandServer({ token: 'x'.repeat(20), runner: echo(), transcript: join(dir, 't.txt'), onStop() {} });
  const two = createCommandServer({ token: 'y'.repeat(20), runner: echo(), transcript: join(dir, 't.txt'), onStop() {} });
  const p1 = await one.listen(), p2 = await two.listen();
  t.after(async () => { await one.close(); await two.close(); });
  const address = one.server.address();
  assert.ok(address !== null && typeof address === 'object');
  assert.equal(address.address, '127.0.0.1');
  assert.equal(address.family, 'IPv4');
  assert.ok(p1 > 0 && p2 > 0 && p1 !== p2, 'each server gets its own port');
});

test('a request with no token, an empty token or a wrong token is refused before anything runs', async t => {
  const calls: string[] = [];
  const s = await start(t, echo(calls));
  for (const token of [null, '', 'wrong', 'secret-token-123', 'secret-token-12345', s.token.toUpperCase()]) {
    const r = await post(s.port, { token, body: cmd('look') });
    assert.equal(r.status, 401, `token ${JSON.stringify(token)}`);
    assert.equal(r.body.ok, false);
  }
  // The token in the address or the body does not count. Only the header does.
  assert.equal((await post(s.port, { path: `/cmd?token=${s.token}`, token: null, body: cmd('look') })).status, 401);
  assert.equal((await post(s.port, { token: null, body: JSON.stringify({ cmd: 'look', args: [], token: s.token }) })).status, 401);
  assert.equal((await post(s.port, { token: s.token, header: 'authorization', body: cmd('look') })).status, 401);
  assert.deepEqual(calls, []);
  assert.equal((await post(s.port, { token: s.token, body: cmd('look') })).status, 200);
  assert.deepEqual(calls, ['look']);
});

test('a request that names another host is refused, so a web page cannot reach the server by a rebound name', async t => {
  const calls: string[] = [];
  const s = await start(t, echo(calls));
  for (const host of ['evil.example', `evil.example:${s.port}`, '10.0.0.5:' + s.port, `127.0.0.1:${s.port + 1}`, '[::1]:' + s.port]) {
    const r = await post(s.port, { token: s.token, host, body: cmd('look') });
    assert.equal(r.status, 403, `host "${host}"`);
  }
  assert.equal((await post(s.port, { token: s.token, host: `localhost:${s.port}`, body: cmd('look') })).status, 200);
  assert.equal((await post(s.port, { token: s.token, host: `127.0.0.1:${s.port}`, body: cmd('look') })).status, 200);
  assert.deepEqual(calls, ['look', 'look']);
});

test('only POST /cmd answers, and the body must be valid JSON of a known shape and a small size', async t => {
  const calls: string[] = [];
  const s = await start(t, echo(calls));
  assert.equal((await post(s.port, { token: s.token, method: 'GET', body: '' })).status, 404);
  assert.equal((await post(s.port, { token: s.token, method: 'PUT', body: cmd('look') })).status, 404);
  assert.equal((await post(s.port, { token: s.token, path: '/', body: cmd('look') })).status, 404);
  assert.equal((await post(s.port, { token: s.token, path: '/state', body: cmd('look') })).status, 404);
  assert.equal((await post(s.port, { token: s.token, path: '/cmd/../etc/passwd', body: cmd('look') })).status, 404);
  assert.equal((await post(s.port, { token: s.token, body: 'not json' })).status, 400);
  assert.equal((await post(s.port, { token: s.token, body: 'null' })).status, 400);
  assert.equal((await post(s.port, { token: s.token, body: '7' })).status, 400);
  assert.equal((await post(s.port, { token: s.token, body: JSON.stringify({ args: [] }) })).status, 400);
  const big = await post(s.port, { token: s.token, body: JSON.stringify({ cmd: 'log', args: ['x'.repeat(20000)] }) }).catch(() => ({ status: 413 }));
  assert.equal(big.status, 413);
  assert.deepEqual(calls, []);
});

test('a command that is not on the allowlist never reaches the app, and the refusal is in the transcript', async t => {
  const calls: string[] = [];
  const s = await start(t, echo(calls));
  for (const word of ['eval', 'evaluate', 'html', 'readFile', 'screenshot']) {
    const r = await post(s.port, { token: s.token, body: cmd(word, ['document.body.innerHTML']) });
    assert.equal(r.status, 400);
    assert.match(r.body.text, /I do not know/);
  }
  const bad = await post(s.port, { token: s.token, body: cmd('click', ['seven']) });
  assert.equal(bad.status, 400);
  assert.deepEqual(calls, []);
  const text = readFileSync(s.transcript, 'utf8');
  assert.match(text, /> eval document\.body\.innerHTML\n {2}error:/);
  assert.match(text, /> click seven\n {2}error:\n {4}I need a number/);
});

test('every command and its result is appended to the transcript, in order, and the transcript is never rewritten', async t => {
  const s = await start(t, { async run(c, a) { return c === 'look' ? 'line one\nline two' : `did ${c} ${a.join(' ')}`; } });
  writeFileSync(s.transcript, 'earlier note\n');
  await post(s.port, { token: s.token, body: cmd('look') });
  await post(s.port, { token: s.token, body: cmd('click', ['3']) });
  await post(s.port, { token: s.token, body: cmd('log', ['this', 'is', 'confusing']) });
  const text = readFileSync(s.transcript, 'utf8');
  assert.equal(text, [
    'earlier note',
    '[2026-10-25T10:00:00.000Z] > look', '  ok:', '    line one', '    line two',
    '[2026-10-25T10:00:00.000Z] > click 3', '  ok:', '    did click 3',
    '[2026-10-25T10:00:00.000Z] > log this is confusing', '  ok:', '    Noted.', '',
  ].join('\n'));
});

test('log writes a note and does not touch the app, and stop answers first and then asks the driver to end', async t => {
  const calls: string[] = [];
  const s = await start(t, echo(calls));
  const note = await post(s.port, { token: s.token, body: cmd('log', ['hello']) });
  assert.deepEqual(note, { status: 200, body: { ok: true, text: 'Noted.' } });
  assert.deepEqual(calls, []);
  assert.equal(s.stopped(), 0);
  const stop = await post(s.port, { token: s.token, body: cmd('stop') });
  assert.equal(stop.body.ok, true);
  assert.match(stop.body.text, /Stopping/);
  assert.deepEqual(calls, [], 'stop is handled by the driver, not the window');
  await new Promise(r => setImmediate(r));
  assert.equal(s.stopped(), 1);
});

test('a failure inside the app is told in plain words, with no stack, no file name and no folder, while a plain error from the tool passes through', async t => {
  const { PersonaError } = await tool<ProtocolModule>('protocol.mjs');
  const logged: unknown[] = [];
  const s = await start(t, {
    async run(c) {
      if (c === 'click') throw new Error('boom at /Users/someone/secret/repo/apps/desktop/renderer/home/HomeApp.tsx:88');
      throw new PersonaError('Control [9] is out of date. Run look.');
    },
  }, { logError: e => logged.push(e) });
  const inner = await post(s.port, { token: s.token, body: cmd('click', ['2']) });
  assert.equal(inner.body.ok, false);
  assert.match(inner.body.text, /Something went wrong inside the app window/);
  assert.doesNotMatch(inner.body.text, /Users|HomeApp|boom|\.tsx/);
  assert.equal(logged.length, 1, 'the real cause goes to the operator, not to the persona');
  const plain = await post(s.port, { token: s.token, body: cmd('hover', ['9']) });
  assert.deepEqual(plain.body, { ok: false, text: 'Control [9] is out of date. Run look.' });
  assert.doesNotMatch(readFileSync(s.transcript, 'utf8'), /Users\/someone|HomeApp/);
});

test('a result is cleaned of folder names before it is sent and before it is written', async t => {
  const s = await start(t, { async run() { return 'look at /work/private/repo/file.ts please'; } }, { redact: text => text.split('/work/private/repo').join('<path>') });
  const r = await post(s.port, { token: s.token, body: cmd('look') });
  assert.equal(r.body.text, 'look at <path>/file.ts please');
  assert.doesNotMatch(readFileSync(s.transcript, 'utf8'), /work\/private/);
});

test('a command that runs past the time limit is given up with a plain message, and the next command still works', async t => {
  let hang = true;
  const s = await start(t, { run: async () => (hang ? new Promise<string>(() => {}) : 'fine') }, { timeoutMs: 150 });
  const began = Date.now();
  const slow = await post(s.port, { token: s.token, body: cmd('look') });
  assert.ok(Date.now() - began < 2000, 'it answers soon after the limit');
  assert.equal(slow.body.ok, false);
  assert.match(slow.body.text, /longer than 5 seconds/);
  hang = false;
  assert.deepEqual((await post(s.port, { token: s.token, body: cmd('look') })).body, { ok: true, text: 'fine' });
  assert.match(readFileSync(s.transcript, 'utf8'), /error:\n {4}That took longer than 5 seconds/);
});

test('the real limit is under five seconds, so a client that waits five always gets an answer', async () => {
  const { TIME_LIMIT_MS } = await tool<ServerModule>('server.mjs');
  assert.ok(TIME_LIMIT_MS < 5000 && TIME_LIMIT_MS >= 3000, String(TIME_LIMIT_MS));
});

test('commands run one at a time, in the order they came', async t => {
  let running = 0, peak = 0;
  const order: string[] = [];
  const s = await start(t, {
    async run(c, a) {
      running += 1; peak = Math.max(peak, running);
      await new Promise(r => setTimeout(r, 40));
      order.push(`${c}${a.join('')}`);
      running -= 1;
      return 'ok';
    },
  });
  const sent = ['1', '2', '3', '4'].map(n => post(s.port, { token: s.token, body: cmd('click', [n]) }));
  const replies = await Promise.all(sent);
  assert.ok(replies.every(r => r.body.ok));
  assert.equal(peak, 1, 'two commands never ran at the same time');
  assert.equal(order.length, 4);
});

test('the client reads a state file, reports a missing or damaged one in plain words, and sends a command with the token', async t => {
  const { readState, sendCommand } = await tool<ClientModule>('client.mjs');
  const calls: string[] = [];
  const s = await start(t, echo(calls));
  const env = { BOWERLOOM_PERSONAS_DIR: s.dir };
  assert.throws(() => readState({ id: 'ghost', env }), /No session is running for the id "ghost"/);
  writeFileSync(join(s.dir, 'state-bad.json'), '{"port":"x"}');
  assert.throws(() => readState({ id: 'bad', env }), /damaged/);
  writeFileSync(join(s.dir, 'state-ok.json'), JSON.stringify({ port: s.port, token: s.token, pid: process.pid }));
  const state = readState({ id: 'ok', env });
  assert.deepEqual(await sendCommand(state, 'look', []), { ok: true, text: 'did look' });
  assert.deepEqual(await sendCommand({ port: state.port, token: 'wrong' }, 'look', []), { ok: false, text: 'A token is needed.' });
  await assert.rejects(sendCommand(state, 'evaluate', ['1']), /I do not know/, 'the client refuses before it sends');
  assert.deepEqual(calls, ['look']);
  await assert.rejects(sendCommand({ port: 1, token: 'x' }, 'look', []), /not answering/);
});
