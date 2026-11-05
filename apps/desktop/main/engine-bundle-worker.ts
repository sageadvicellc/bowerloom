/**
 * The entry of the worker thread that runs the heavy work of export and import (main/engine-bundle-work.ts). It answers each job with plain data: the value, or a
 * plain refusal. A refusal of the bundle package crosses as `toJSON()` and comes back with `BundleRefusal.fromPlain`, because an error loses its fields in a structured
 * clone. Any other error with a code and words (a save refusal, a definition refusal) crosses as its code, words and paths; an error with none is only "FAILED".
 * It is bundled to its own file (tools/bundle.mjs) and started by main/engine-bundle.ts.
 */
import { parentPort } from 'node:worker_threads';
import { BundleRefusal } from '../../../packages/harness-bundle/src/index.js';
import { run } from './engine-bundle-work.js';
import type { Job } from './engine-bundle-work.js';

export type PlainRefusal =
  | { readonly kind: 'bundle'; readonly value: ReturnType<BundleRefusal['toJSON']> }
  | { readonly kind: 'coded'; readonly code: string; readonly message: string; readonly paths: readonly string[] }
  | { readonly kind: 'bug' };

const CODE = /^[A-Z][A-Z0-9_]{2,63}$/;
export function plainRefusal(error: unknown): PlainRefusal {
  if (error instanceof BundleRefusal) return { kind: 'bundle', value: error.toJSON() };
  const e = error as { code?: unknown; message?: unknown; paths?: unknown } | null;
  if (e !== null && typeof e === 'object' && typeof e.code === 'string' && CODE.test(e.code) && typeof e.message === 'string') {
    return { kind: 'coded', code: e.code, message: e.message.slice(0, 4000), paths: Array.isArray(e.paths) ? e.paths.filter((p): p is string => typeof p === 'string').slice(0, 50).map(p => p.slice(0, 1200)) : [] };
  }
  // An error with no code and words is a bug of Bowerloom, not a refusal. The window gets only "FAILED"; the stack goes to the log of the app, so the cause is not lost.
  console.error('Bowerloom: a job of export or import failed with an error it does not know.', error instanceof Error ? error.stack ?? error.message : String(error));
  return { kind: 'bug' };
}

/** Bytes go back as a transfer when the view covers its whole buffer; else as a copy, so no other view of the buffer is cut off. */
function transferable(value: unknown): ArrayBuffer[] {
  const bytes = (value as { bytes?: unknown } | null)?.bytes;
  if (bytes instanceof Uint8Array && bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength && bytes.buffer instanceof ArrayBuffer) return [bytes.buffer];
  return [];
}

if (parentPort !== null) {
  const port = parentPort;
  port.on('message', (message: { id: number; job: Job }) => {
    const { id, job } = message;
    const answer = (value: unknown): void => {
      try { port.postMessage({ id, ok: true, value }, transferable(value)); } catch (error) {
        // The value could not be cloned or sent: the job is still answered, so the host never waits for its timer.
        console.error('Bowerloom: the answer of a job of export or import could not be sent.', error instanceof Error ? error.stack ?? error.message : String(error));
        port.postMessage({ id, ok: false, refusal: { kind: 'bug' } satisfies PlainRefusal });
      }
    };
    run(job).then(answer, (error: unknown) => { port.postMessage({ id, ok: false, refusal: plainRefusal(error) }); });
  });
}
