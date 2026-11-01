/**
 * A way to give the event loop a turn. A long loop over the files of a bundle calls the function it gets here after each file; the function answers with a promise only
 * when the loop has run for a while, so a small bundle pays nothing. This shortens the stalls of the loops of this package. It does not remove the stalls of the steps that
 * are one synchronous call (the load of the files as a harness, with its secret scan; the summary; the revision), which can take seconds for a large bundle. A caller that
 * must keep its event loop free (the app's main process) runs the package in a worker thread or a utility process; see README.md, Where to run it.
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
