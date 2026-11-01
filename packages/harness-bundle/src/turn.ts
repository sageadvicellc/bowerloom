/**
 * A way to give the event loop a turn. A long loop over the files of a bundle calls the function it gets here after each file; the function answers with a promise only
 * when the loop has run for a while, so a small bundle pays nothing and a large one never holds the main process for more than a short time.
 */
import { performance } from 'node:perf_hooks';

/** The longest stretch of work between two turns, in milliseconds. */
export const TURN_MS = 12;

/** Returns a function: call it after each unit of work, and `await` the result when it is a promise. */
export function turnTaker(): () => Promise<void> | undefined {
  let since = performance.now();
  return () => {
    if (performance.now() - since < TURN_MS) return undefined;
    return new Promise<void>(resolve => {
      setImmediate(() => { since = performance.now(); resolve(); });
    });
  };
}
