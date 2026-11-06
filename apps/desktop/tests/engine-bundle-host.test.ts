// The host of the worker thread (main/engine-bundle-host.ts): every way a worker can stop is a refusal in words with a cause, a log line and a usage report; nothing waits for
// ever; a replacement starts only after the old thread has ended. A fake worker stands for the thread where a real one cannot be made to fail on demand.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { join } from 'node:path';
import { encodeBundle } from '../../../packages/harness-bundle/src/index.js';
import { loadDefinition } from '../../../packages/harness-definition/src/index.js';
import { CodedRefusal, WORKER_WORDS, createBundleHost } from '../main/engine-bundle-host.js';
import type { WorkerCause, WorkerLike } from '../main/engine-bundle-host.js';
import type { DecodedView, Job } from '../main/engine-bundle-work.js';
import { DESKTOP } from './support.js';
import { quietFolder } from './helpers-engine/share.js';
import { homeFolder } from './helpers-engine/folders.js';
import { tempDir } from './support.js';

class Fake extends EventEmitter implements WorkerLike {
  readonly posted: unknown[] = [];
  ended = false;
  constructor(private readonly endsAfterMs = 0) { super(); }
  postMessage(message: unknown): void { this.posted.push(message); }
  terminate(): Promise<unknown> { return new Promise(resolve => setTimeout(() => { this.ended = true; resolve(1); }, this.endsAfterMs)); }
  unref(): void { /* a fake holds nothing */ }
}
const READ: Job = { op: 'drop', key: 'bundle-1' };
const WRITE = { op: 'write', key: 'bundle-1', choices: { link: new Map(), leave: new Set() }, revision: 'a'.repeat(64), acknowledged: null, dirs: {} as never, now: '2026-10-31T12:00:00Z', projectDir: '/x', adoptState: '/y' } satisfies Job;
async function fail(run: Promise<unknown>): Promise<CodedRefusal> {
  try { await run; } catch (error) { assert.ok(error instanceof CodedRefusal, String(error)); return error; }
  throw new Error('the call did not fail');
}
/** Captures what the host writes to the console, so a test reads the log without noise. */
function logged(t: test.TestContext): string[] {
  const lines: string[] = [];
  t.mock.method(console, 'error', (...args: unknown[]) => { lines.push(args.map(String).join(' ')); });
  return lines;
}

test('each cause has its own words, for a read and for a write, and the write words that can leave a stopped save say what to do', () => {
  const causes: WorkerCause[] = ['WORKER_CRASHED', 'WORKER_OUT_OF_MEMORY', 'WORKER_NOT_STARTED', 'WORKER_TIMED_OUT'];
  assert.equal(new Set(causes.flatMap(c => [WORKER_WORDS[c].read, WORKER_WORDS[c].write])).size, 8, 'eight different sentences');
  for (const c of causes) {
    assert.match(WORKER_WORDS[c].read, /Nothing was written\./, c);
    if (c === 'WORKER_NOT_STARTED') assert.match(WORKER_WORDS[c].write, /Nothing was written\./); else assert.match(WORKER_WORDS[c].write, /Finish a stopped harness/, c);
  }
});

test('an error event: out of memory, a file that is not there, and any other error are three causes, each logged with its error code and reported', async t => {
  const lines = logged(t);
  const reports: string[] = [];
  const cases: [string, string | null, WorkerCause][] = [['oom', 'ERR_WORKER_OUT_OF_MEMORY', 'WORKER_OUT_OF_MEMORY'], ['missing', 'ERR_MODULE_NOT_FOUND', 'WORKER_NOT_STARTED'], ['plain', null, 'WORKER_CRASHED']];
  for (const [name, code, cause] of cases) {
    const fake = new Fake();
    const host = createBundleHost({ file: () => 'x', timeoutMs: 5000, writeTimeoutMs: 5000, spawn: () => fake, report: (c, w) => { reports.push(`${c}:${w}`); } });
    const pending = host.call(READ);
    await new Promise(resolve => setImmediate(resolve));
    fake.emit('error', Object.assign(new Error(`boom ${name}`), code === null ? {} : { code }));
    const r = await fail(pending);
    assert.equal(r.code, 'FAILED');
    assert.equal(r.step, cause, name);
    assert.equal(r.message, WORKER_WORDS[cause].read);
    assert.ok(lines.some(l => l.includes(cause) && l.includes(code ?? 'none')), `${name}: logged`);
  }
  assert.deepEqual(reports, ['WORKER_OUT_OF_MEMORY:false', 'WORKER_NOT_STARTED:false', 'WORKER_CRASHED:false']);
});

test('a worker that cannot be created is NOT_STARTED, logged with its stack; an exit and a message it cannot read are crashes', async t => {
  const lines = logged(t);
  const broken = createBundleHost({ file: () => 'x', timeoutMs: 5000, writeTimeoutMs: 5000, spawn: () => { throw new Error('no thread'); } });
  const r = await fail(broken.call(WRITE));
  assert.equal(r.step, 'WORKER_NOT_STARTED');
  assert.equal(r.message, WORKER_WORDS.WORKER_NOT_STARTED.write);
  assert.ok(lines.some(l => l.includes('could not be started')));
  const exits = new Fake();
  const host = createBundleHost({ file: () => 'x', timeoutMs: 5000, writeTimeoutMs: 5000, spawn: () => exits });
  const pending = host.call(WRITE);
  await new Promise(resolve => setImmediate(resolve));
  exits.emit('exit', 1);
  const exited = await fail(pending);
  assert.equal(exited.step, 'WORKER_CRASHED');
  assert.equal(exited.message, WORKER_WORDS.WORKER_CRASHED.write, 'a write that stopped points to Finish a stopped harness');
  const odd = new Fake();
  const h2 = createBundleHost({ file: () => 'x', timeoutMs: 5000, writeTimeoutMs: 5000, spawn: () => odd });
  const p2 = h2.call(READ);
  await new Promise(resolve => setImmediate(resolve));
  odd.emit('messageerror', new Error('cannot read'));
  assert.equal((await fail(p2)).step, 'WORKER_CRASHED');
  assert.equal(h2.generation(), 1, 'what the worker held is gone');
});

test('a timer that runs out: a read says nothing was written; a write points to the stopped save; the next worker starts only after the old thread has ended', async t => {
  logged(t);
  const made: Fake[] = [];
  const host = createBundleHost({ file: () => 'x', timeoutMs: 40, writeTimeoutMs: 40, spawn: () => { const w = new Fake(made.length === 0 ? 150 : 0); made.push(w); return w; } });
  const read = await fail(host.call(READ));
  assert.equal(read.step, 'WORKER_TIMED_OUT');
  assert.equal(read.message, WORKER_WORDS.WORKER_TIMED_OUT.read);
  assert.equal(made.length, 1);
  // The old thread needs 150 ms to end; the second call waits for it.
  const began = Date.now();
  const write = await fail(host.call(WRITE));
  assert.equal(made.length, 2);
  assert.ok(made[0]!.ended, 'the first thread ended before the second was started');
  assert.ok(Date.now() - began >= 100, 'the call waited for the old thread');
  assert.equal(write.message, WORKER_WORDS.WORKER_TIMED_OUT.write);
});

test('close() fails the jobs it holds as a stop, ends the thread, and a later call starts a new one', async t => {
  logged(t);
  const made: Fake[] = [];
  const host = createBundleHost({ file: () => 'x', timeoutMs: 5000, writeTimeoutMs: 5000, spawn: () => { const w = new Fake(); made.push(w); return w; } });
  const pending = fail(host.call(WRITE));
  await new Promise(resolve => setImmediate(resolve));
  await host.close();
  assert.equal((await pending).message, WORKER_WORDS.WORKER_CRASHED.write);
  assert.ok(made[0]!.ended);
  const again = host.call(READ);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(made.length, 2);
  made[1]!.emit('message', { id: 2, ok: true, value: 7 });
  assert.equal(await again, 7);
});

test('the real worker drops a bundle when it is told to: the next job for it is refused as not held', async t => {
  const base = tempDir(t, 'bowerloom-host-');
  const home = homeFolder(base);
  const dir = quietFolder(home);
  const loaded = loadDefinition(join(dir, '.bowerloom'));
  assert.equal(loaded.ok, true);
  if (!loaded.ok) return;
  const encoded = await encodeBundle(loaded.definition);
  const host = createBundleHost({ file: () => join(DESKTOP, '.build', 'tests', 'bundle-worker.mjs'), timeoutMs: 60_000, writeTimeoutMs: 60_000 });
  t.after(() => host.close());
  const bytes = Uint8Array.from(encoded.bytes);
  const d = await host.call<DecodedView>({ op: 'decode', key: 'bundle-5', bytes }, { transfer: [bytes.buffer as ArrayBuffer] });
  assert.equal(d.harness, 'quiet');
  const choices = { link: new Map<string, string>(), leave: new Set<string>() };
  const io = { projectDir: join(base, 'nowhere'), adoptState: join(base, 'state') };
  // Held: the plan is made (for a folder that is not there yet, which a plan reads and does not touch).
  const held = await host.call<{ makes: boolean }>({ op: 'plan', key: 'bundle-5', choices, ...io });
  assert.equal(held.makes, true);
  host.tell({ op: 'drop', key: 'bundle-5' });
  const dropped = await fail(host.call({ op: 'plan', key: 'bundle-5', choices, ...io }));
  assert.equal(dropped.code, 'UNKNOWN_BUNDLE_HELD');
});
