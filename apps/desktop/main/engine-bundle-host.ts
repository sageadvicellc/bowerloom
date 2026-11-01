/**
 * The host of the worker thread that runs the heavy work of export and import (main/engine-bundle-work.ts). It is the one place of main that starts a thread.
 *  - A job is a plain object; the worker answers it with plain data or a plain refusal (main/engine-bundle-worker.ts). Bytes go over as a transfer.
 *  - Every job has a timer. A worker that stops (an error, an exit, a message it cannot read, an out-of-memory stop, a timer that runs out) is a refusal in words for each job
 *    it held, never a crash and never a wait without end. The window code is `FAILED` (the contract has no other); `step` says which cause, and the words differ by cause
 *    and by whether the job was a write.
 *  - Nothing is lost silently: every cause is written to the console with its error code, and reported to the usage log through `report` (a cause, never a name or a path).
 *  - The replacement of a stopped worker starts only after the old thread has ended, so two threads never work on one folder.
 */
import { Worker } from 'node:worker_threads';
import { BundleRefusal } from '../../../packages/harness-bundle/src/index.js';
import type { Job } from './engine-bundle-work.js';
import type { PlainRefusal } from './engine-bundle-worker.js';

/** A refusal with a code and words, as `refusalOf` reads one. `step` is the cause of a stopped worker. */
export class CodedRefusal extends Error {
  readonly step?: string;
  constructor(readonly code: string, message: string, readonly paths: readonly string[] = [], step?: string) {
    super(message);
    this.name = 'CodedRefusal';
    if (step !== undefined) this.step = step;
  }
}

/** Why a worker stopped. These are the `step` of the refusal and the `code` of the usage line. */
export const WORKER_CAUSES = Object.freeze(['WORKER_CRASHED', 'WORKER_OUT_OF_MEMORY', 'WORKER_NOT_STARTED', 'WORKER_TIMED_OUT'] as const);
export type WorkerCause = (typeof WORKER_CAUSES)[number];

/** The words for each cause. A write that was running may have left a stopped save, and the words say what to do; a job that only reads wrote nothing. */
export const WORKER_WORDS: Readonly<Record<WorkerCause, { readonly read: string; readonly write: string }>> = Object.freeze({
  WORKER_CRASHED: {
    read: 'The part of Bowerloom that reads harness files stopped before it finished. Nothing was written. Try again.',
    write: 'The part of Bowerloom that writes an import stopped before it finished. The folder may hold a stopped save. Use Finish a stopped harness to put it back.',
  },
  WORKER_OUT_OF_MEMORY: {
    read: 'This file needs more memory than Bowerloom allows, so it stopped. Nothing was written. Choose a smaller file.',
    write: 'The write of this import needed more memory than Bowerloom allows, so it stopped. The folder may hold a stopped save. Use Finish a stopped harness to put it back.',
  },
  WORKER_NOT_STARTED: {
    read: 'Bowerloom could not start the part that reads harness files. Nothing was written. Close Bowerloom and open it again. If it keeps happening, report a problem from the Help menu.',
    write: 'Bowerloom could not start the part that writes an import. Nothing was written. Close Bowerloom and open it again. If it keeps happening, report a problem from the Help menu.',
  },
  WORKER_TIMED_OUT: {
    read: 'Reading this took longer than Bowerloom allows, so it stopped. Nothing was written. Try a smaller file.',
    write: 'Writing this import took longer than Bowerloom allows, so it stopped. The folder may hold a stopped save. Use Finish a stopped harness to put it back.',
  },
});

/** The minimum of a worker that the host uses; a test hands in another. */
export interface WorkerLike {
  postMessage(message: unknown, transfer?: ArrayBuffer[]): void;
  terminate(): Promise<unknown>;
  unref(): unknown;
  on(event: 'message', listener: (message: { id: number; ok: boolean; value?: unknown; refusal?: PlainRefusal }) => void): unknown;
  on(event: 'error', listener: (error: unknown) => void): unknown;
  on(event: 'exit', listener: (code: number) => void): unknown;
  on(event: 'messageerror', listener: (error: unknown) => void): unknown;
}

export interface BundleHostOptions {
  /** The worker's file: a path or a URL. Asked when a worker starts. */
  readonly file: () => string | URL;
  /** The longest a decode, an encode or a plan may take, in milliseconds. */
  readonly timeoutMs: number;
  /** The longest a write may take. A write that times out is stopped like a crash: its journal says what to do. */
  readonly writeTimeoutMs: number;
  /** Told of every stopped worker: the cause, and whether a write was running. Never a name or a path. */
  readonly report?: (cause: WorkerCause, write: boolean) => void;
  /** Starts a worker. Tests only. */
  readonly spawn?: (file: string | URL) => WorkerLike;
}
export interface BundleHost {
  /** Changes when the worker restarts: what it held is gone. */
  generation(): number;
  call<T>(job: Job, options?: { readonly transfer?: ArrayBuffer[]; readonly timeoutMs?: number }): Promise<T>;
  /** Sends a job only if a worker is running. Never starts one and never throws. */
  tell(job: Job): void;
  /** Stops the worker. Resolves when its thread has ended (bounded). */
  close(): Promise<void>;
}

interface Waiting { readonly worker: WorkerLike; readonly resolve: (value: never) => void; readonly reject: (error: unknown) => void; readonly timer: NodeJS.Timeout; readonly write: boolean }

function revive(refusal: PlainRefusal): unknown {
  if (refusal.kind === 'bundle') return BundleRefusal.fromPlain(refusal.value);
  if (refusal.kind === 'coded') return new CodedRefusal(refusal.code, refusal.message, refusal.paths);
  return new CodedRefusal('FAILED', 'Bowerloom could not finish this. Nothing more was changed.');
}
const errorCode = (error: unknown): string => { const c = (error as { code?: unknown } | null)?.code; return typeof c === 'string' && /^[A-Z0-9_]{1,60}$/.test(c) ? c : 'none'; };
const detail = (error: unknown): string => (error instanceof Error ? error.stack ?? error.message : String(error));
/** The longest the host waits for a stopped thread to end before it starts the next one. */
const ENDING_MS = 5000;

export function createBundleHost(options: BundleHostOptions): BundleHost {
  let worker: WorkerLike | null = null;
  let generation = 0, next = 1;
  const waiting = new Map<number, Waiting>();
  /** The threads that were told to end and have not been seen to end. */
  let ending: Promise<unknown> = Promise.resolve();

  const retire = (w: WorkerLike): void => {
    const ended = w.terminate().then(() => undefined, (error: unknown) => { console.error('Bowerloom: the helper thread of export and import did not end cleanly.', detail(error)); });
    ending = Promise.all([ending, ended]);
  };
  /** Rejects the jobs this worker held (only those: a worker that was closed and replaced must not fail the jobs of the new one) and forgets it. */
  const failAll = (stopped: WorkerLike, cause: WorkerCause, error?: unknown): void => {
    if (worker === stopped) { worker = null; generation += 1; }
    const mine = [...waiting].filter(([, w]) => w.worker === stopped);
    if (mine.length === 0) return;
    console.error(`Bowerloom: the helper thread of export and import stopped (${cause}, error code ${errorCode(error)}).`, error === undefined ? '' : detail(error));
    for (const [id, w] of mine) {
      clearTimeout(w.timer); waiting.delete(id);
      try { options.report?.(cause, w.write); } catch (inner) { console.error('Bowerloom could not report a stopped helper thread.', detail(inner)); }
      w.reject(new CodedRefusal('FAILED', WORKER_WORDS[cause][w.write ? 'write' : 'read'], [], cause));
    }
  };
  /** A worker that could not be started at all: the file is missing, or it did not load before it answered anything. */
  const startFailure = (error: unknown): boolean => ['ERR_MODULE_NOT_FOUND', 'MODULE_NOT_FOUND', 'ERR_WORKER_PATH', 'ERR_WORKER_INIT_FAILED', 'ENOENT'].includes(errorCode(error));
  const start = (): WorkerLike => {
    const file = options.file();
    const w: WorkerLike = options.spawn !== undefined ? options.spawn(file) : new Worker(file, { resourceLimits: { maxOldGenerationSizeMb: 2048 } });
    w.unref();
    let answered = false;
    w.on('message', m => {
      answered = true;
      const found = waiting.get(m.id);
      if (found === undefined) return;
      clearTimeout(found.timer); waiting.delete(m.id);
      if (m.ok) found.resolve(m.value as never); else found.reject(revive(m.refusal ?? { kind: 'bug' }));
    });
    w.on('error', error => {
      const cause: WorkerCause = errorCode(error) === 'ERR_WORKER_OUT_OF_MEMORY' ? 'WORKER_OUT_OF_MEMORY' : !answered && startFailure(error) ? 'WORKER_NOT_STARTED' : 'WORKER_CRASHED';
      failAll(w, cause, error);
    });
    w.on('exit', () => failAll(w, 'WORKER_CRASHED'));
    // A message the host cannot read means the worker and the host no longer agree: the thread is stopped, as for a crash.
    w.on('messageerror', error => { failAll(w, 'WORKER_CRASHED', error); retire(w); });
    return w;
  };
  const settled = async (): Promise<void> => {
    let timer: NodeJS.Timeout | undefined;
    await Promise.race([ending, new Promise<void>(resolve => { timer = setTimeout(resolve, ENDING_MS); })]);
    clearTimeout(timer);
  };

  return {
    generation: () => generation,
    call: async <T,>(job: Job, opts: { readonly transfer?: ArrayBuffer[]; readonly timeoutMs?: number } = {}): Promise<T> => {
      const write = job.op === 'write';
      // The thread of an earlier stop must have ended before the next starts.
      if (worker === null) await settled();
      return new Promise<T>((resolve, reject) => {
        let w: WorkerLike;
        try { w = worker ?? (worker = start()); } catch (error) {
          worker = null;
          console.error('Bowerloom: the helper thread of export and import could not be started.', detail(error));
          try { options.report?.('WORKER_NOT_STARTED', write); } catch (inner) { console.error('Bowerloom could not report a stopped helper thread.', detail(inner)); }
          reject(new CodedRefusal('FAILED', WORKER_WORDS.WORKER_NOT_STARTED[write ? 'write' : 'read'], [], 'WORKER_NOT_STARTED'));
          return;
        }
        const id = next; next += 1;
        const timer = setTimeout(() => { failAll(w, 'WORKER_TIMED_OUT'); retire(w); }, opts.timeoutMs ?? (write ? options.writeTimeoutMs : options.timeoutMs));
        waiting.set(id, { worker: w, resolve: resolve as (value: never) => void, reject, timer, write });
        try { w.postMessage({ id, job }, opts.transfer ?? []); } catch (error) {
          clearTimeout(timer); waiting.delete(id);
          console.error('Bowerloom: a job could not be sent to the helper thread of export and import.', detail(error));
          reject(new CodedRefusal('FAILED', WORKER_WORDS.WORKER_CRASHED[write ? 'write' : 'read'], [], 'WORKER_CRASHED'));
        }
      });
    },
    tell: job => {
      try { worker?.postMessage({ id: 0, job }); } catch (error) { console.error('Bowerloom: a message to the helper thread of export and import could not be sent.', detail(error)); }
    },
    close: async () => {
      const w = worker;
      worker = null; generation += 1;
      if (w !== null) { failAll(w, 'WORKER_CRASHED'); retire(w); }
      await settled();
    },
  };
}
