// The Node core, as it runs in the child process of the Electron main process (Electron `utilityProcess`). It hosts the shipped code of the app unchanged:
// the real-setup reader (main/real-scan.ts and shared/real/map-world.ts) and the engine service (main/engine-service.ts, which holds the plan shown last).
// Spike-only methods: `hang`, `spin`, `mark`, `events` and `engine.setNextFolder`. They exist to test the host and are not part of the call set.
import { createHash } from 'node:crypto';
import { appendFileSync } from 'node:fs';
import { buildRealResult } from '../../../apps/desktop/shared/real/map-world.js';
import { createScanner } from '../../../apps/desktop/main/real-scan.js';
import { createEngineService } from '../../../apps/desktop/main/engine-service.js';
import { ENGINE_ARITY } from '../../../apps/desktop/shared/engine/types.js';
import type { EngineCall } from '../../../apps/desktop/shared/engine/types.js';

interface ParentPort {
  on(event: 'message', listener: (message: { data: unknown }) => void): void;
  postMessage(message: unknown): void;
}
const parentPort = (process as unknown as { parentPort?: ParentPort }).parentPort;
if (parentPort === undefined) throw new Error('This file runs only as an Electron utility process.');
const port: ParentPort = parentPort;

/** An error with a short refusal code, as the call set uses them. */
class CallError extends Error {
  readonly code: string;
  constructor(code: string, message: string) { super(message); this.code = code; }
}

const home = process.env.SPIKE_HOME ?? '';
const stateRoot = process.env.SPIKE_STATE ?? '';
let nextFolder: string | null = null;
let service: ReturnType<typeof createEngineService> | null = null;
const engine = (): ReturnType<typeof createEngineService> => {
  if (home === '' || stateRoot === '') throw new CallError('FAILED', 'The core was started with no home folder.');
  // `confirm` stands in for the dialog of the main process: it says yes.
  service ??= createEngineService({ home, stateRoot, chooseFolder: async () => nextFolder, confirm: async () => true, who: 'spike' });
  return service;
};

const sleep = (ms: number): Promise<void> => new Promise(resolve => { setTimeout(resolve, ms); });
const isCall = (name: unknown): name is EngineCall => typeof name === 'string' && Object.hasOwn(ENGINE_ARITY, name);

async function scan(picked: unknown, scanHome: unknown): Promise<unknown> {
  if (typeof picked !== 'string' || typeof scanHome !== 'string') throw new CallError('BAD_ARGUMENT', 'scan needs two folders');
  const now = (): number => Date.now();
  const scanner = createScanner({ home: scanHome, now });
  const found = await scanner.pick(async () => picked);
  if (found === null) throw new CallError('FAILED', 'no folder');
  const batch = await scanner.read(found.places.map(p => p.id));
  const result = buildRealResult(batch.reads, batch.tally, { nowMs: now(), foldExtraApps: true });
  const json = JSON.stringify(result);
  return { result, bytes: Buffer.byteLength(json), digest: createHash('sha256').update(json).digest('hex'), places: found.places.length };
}

const handlers: Record<string, (args: unknown[]) => unknown> = {
  ping: () => ({ pong: true, pid: process.pid, versions: { electron: process.versions.electron, node: process.versions.node, chrome: process.versions.chrome, v8: process.versions.v8 } }),
  echo: ([value]) => value,
  scan: ([picked, scanHome]) => scan(picked, scanHome),
  /** Sends `n` numbered events, then answers. The events are sent before the answer. */
  events: ([n]) => {
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 0) throw new CallError('BAD_ARGUMENT', 'events needs a count');
    for (let i = 0; i < n; i += 1) port.postMessage({ type: 'event', seq: i });
    return { sent: n };
  },
  /** Never answers. */
  hang: () => new Promise<never>(() => undefined),
  /** Blocks the event loop of the child for good, so it cannot answer or even read its messages. */
  spin: () => { for (;;) { /* busy */ } },
  /** Appends one line to a file, then waits. It shows whether a call ran once or twice. */
  mark: async ([file, ms]) => {
    if (typeof file !== 'string' || typeof ms !== 'number') throw new CallError('BAD_ARGUMENT', 'mark needs a file and a time');
    appendFileSync(file, `${process.pid}\n`);
    await sleep(ms);
    return 'done';
  },
  sleep: async ([ms]) => { await sleep(typeof ms === 'number' ? ms : 0); return 'slept'; },
  'engine.setNextFolder': ([dir]) => { nextFolder = typeof dir === 'string' ? dir : null; return true; },
  /** One engine call of the call set, with its argument count checked as the main process checks it. */
  engine: async ([name, ...args]) => {
    if (!isCall(name)) throw new CallError('BAD_ARGUMENT', 'not a call of the set');
    if (args.length !== ENGINE_ARITY[name]) throw new CallError('BAD_ARGUMENT', 'wrong argument count');
    const fn = (engine() as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>)[name];
    if (typeof fn !== 'function') throw new CallError('BAD_ARGUMENT', 'not a call of the set');
    return fn(...args);
  },
};

port.on('message', ({ data }) => {
  const message = data as { type?: string; id?: number; method?: string; args?: unknown[] };
  if (message.type !== 'call' || typeof message.id !== 'number' || typeof message.method !== 'string') return;
  const { id, method } = message;
  const handler = Object.hasOwn(handlers, method) ? handlers[method] : undefined;
  if (handler === undefined) { port.postMessage({ type: 'result', id, ok: false, code: 'BAD_ARGUMENT', message: 'unknown method' }); return; }
  Promise.resolve()
    .then(() => handler(Array.isArray(message.args) ? message.args : []))
    .then(
      value => port.postMessage({ type: 'result', id, ok: true, value }),
      (error: unknown) => port.postMessage({ type: 'result', id, ok: false, code: typeof (error as { code?: unknown })?.code === 'string' ? (error as { code: string }).code : 'FAILED', message: error instanceof Error ? error.message : String(error) }),
    );
});

port.postMessage({ type: 'ready', pid: process.pid });
