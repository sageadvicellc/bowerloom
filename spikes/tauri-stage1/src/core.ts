// The Node core, with no knowledge of its host. It hosts the shipped code of the app unchanged: the real-setup reader (main/real-scan.ts, shared/real/map-world.ts) and the engine
// service (main/engine-service.ts, which holds the plan shown last). A host gives it a `send` function and hands it each message it receives.
// Two hosts use it: the Electron utility process (child.ts) and the Tauri sidecar (stdio.ts).
// Spike-only methods: `hang`, `spin`, `mark`, `events`, `sleep` and `engine.setNextFolder`. They exist to test the hosts and are not part of the call set.
import { createHash } from 'node:crypto';
import { appendFileSync } from 'node:fs';
import { buildRealResult } from '../../../apps/desktop/shared/real/map-world.js';
import { createScanner } from '../../../apps/desktop/main/real-scan.js';
import { createEngineService } from '../../../apps/desktop/main/engine-service.js';
import { createScanSession } from '../../../apps/desktop/main/scan-session.js';
import type { ScanSession } from '../../../apps/desktop/main/scan-session.js';
import type { RealResult } from '../../../apps/desktop/shared/real/types.js';
import { ENGINE_ARITY } from '../../../apps/desktop/shared/engine/types.js';
import type { EngineCall } from '../../../apps/desktop/shared/engine/types.js';

/** An error with a short refusal code, as the call set uses them. */
class CallError extends Error {
  readonly code: string;
  constructor(code: string, message: string) { super(message); this.code = code; }
}

const sleep = (ms: number): Promise<void> => new Promise(resolve => { setTimeout(resolve, ms); });
const isCall = (name: unknown): name is EngineCall => typeof name === 'string' && Object.hasOwn(ENGINE_ARITY, name);

export interface Core {
  /** Handles one message from the host. A message that is not a call is ignored. */
  handle(data: unknown): void;
  /** The first message a host sends when the core can take calls. */
  ready(): void;
}

export function createCore(send: (message: unknown) => void, env: NodeJS.ProcessEnv = process.env): Core {
  const home = env.SPIKE_HOME ?? '';
  const stateRoot = env.SPIKE_STATE ?? '';
  let nextFolder: string | null = null;
  let service: ReturnType<typeof createEngineService> | null = null;
  const engine = (): ReturnType<typeof createEngineService> => {
    if (home === '' || stateRoot === '') throw new CallError('FAILED', 'The core was started with no home folder.');
    // `confirm` stands in for the dialog of the shell: it says yes.
    service ??= createEngineService({ home, stateRoot, chooseFolder: async () => nextFolder, confirm: async () => true, who: 'spike' });
    return service;
  };

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

  /** The scan as the app does it with the saved read: the read is kept in the state folder (main/scan-session.ts), and `scanSaved` answers what a launch asks. */
  let session: ScanSession | null = null;
  const sessionOf = (scanHome: string): ScanSession => {
    if (stateRoot === '') throw new CallError('FAILED', 'The core was started with no state folder.');
    session ??= createScanSession({ home: scanHome, stateRoot });
    return session;
  };
  const countOf = (counts: { skills: number; agents: number; tools: number; hooks: number; notes: number }): number => counts.skills + counts.agents + counts.tools + counts.hooks + counts.notes;
  async function scanKept(picked: unknown, scanHome: unknown): Promise<unknown> {
    if (typeof picked !== 'string' || typeof scanHome !== 'string') throw new CallError('BAD_ARGUMENT', 'scanKept needs two folders');
    const now = (): number => Date.now();
    const scanner = createScanner({ home: scanHome, now });
    const found = await scanner.pick(async () => picked);
    if (found === null) throw new CallError('FAILED', 'no folder');
    const read = async (): Promise<RealResult> => {
      const batch = await scanner.read(found.places.map(p => p.id));
      return buildRealResult(batch.reads, batch.tally, { nowMs: now(), foldExtraApps: true });
    };
    const result = await sessionOf(scanHome).keepRead(found.places, read);
    return { items: countOf(result.counts), places: found.places.length };
  }

  const handlers: Record<string, (args: unknown[]) => unknown> = {
    scanKept: ([picked, scanHome]) => scanKept(picked, scanHome),
    scanSaved: async ([scanHome]) => {
      if (typeof scanHome !== 'string') throw new CallError('BAD_ARGUMENT', 'scanSaved needs the home folder');
      const answer = await sessionOf(scanHome).savedScan();
      return answer.status === 'saved' ? { status: 'saved', items: countOf(answer.result.counts) } : { status: answer.status, items: null };
    },
    ping: () => ({ pong: true, pid: process.pid, versions: { electron: process.versions.electron, node: process.versions.node, chrome: process.versions.chrome, v8: process.versions.v8 } }),
    echo: ([value]) => value,
    scan: ([picked, scanHome]) => scan(picked, scanHome),
    /** Sends `n` numbered events, then answers. The events are sent before the answer. */
    events: ([n]) => {
      if (typeof n !== 'number' || !Number.isInteger(n) || n < 0) throw new CallError('BAD_ARGUMENT', 'events needs a count');
      for (let i = 0; i < n; i += 1) send({ type: 'event', seq: i });
      return { sent: n };
    },
    /** Never answers. */
    hang: () => new Promise<never>(() => undefined),
    /** Blocks the event loop of the core for good, so it cannot answer or even read its messages. */
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

  return {
    ready: () => send({ type: 'ready', pid: process.pid }),
    handle: data => {
      const message = data as { type?: string; id?: number; method?: string; args?: unknown[] } | null;
      if (message === null || typeof message !== 'object' || message.type !== 'call' || typeof message.id !== 'number' || typeof message.method !== 'string') return;
      const { id, method } = message;
      const handler = Object.hasOwn(handlers, method) ? handlers[method] : undefined;
      if (handler === undefined) { send({ type: 'result', id, ok: false, code: 'BAD_ARGUMENT', message: 'unknown method' }); return; }
      Promise.resolve()
        .then(() => handler(Array.isArray(message.args) ? message.args : []))
        .then(
          value => send({ type: 'result', id, ok: true, value }),
          (error: unknown) => send({ type: 'result', id, ok: false, code: typeof (error as { code?: unknown })?.code === 'string' ? (error as { code: string }).code : 'FAILED', message: error instanceof Error ? error.message : String(error) }),
        );
    },
  };
}
