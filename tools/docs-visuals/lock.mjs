/**
 * The machine-wide e2e lock: a folder that one process makes and removes. `withLock` waits for it with a deadline, runs a function, and always removes the lock it made,
 * also when the function throws. It removes the lock only at the end of its own run. A folder removed by hand while a run is going may then belong to another run,
 * so never remove it by hand while a capture or e2e run is active.
 * A run killed by a signal cannot run `finally`, so it leaves the lock, as every e2e tool in this repository does. The timeout message names the folder to remove.
 * The lock is not reclaimed on its own: each way of guessing that a holder is gone opened a race in which two runs could hold it.
 */
import { mkdirSync, rmdirSync } from 'node:fs';

const sleep = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/** Takes the lock, runs `fn`, and releases the lock. Throws an error that names the lock path when the lock is not free before `timeoutMs`. */
export function withLock(lock, fn, { timeoutMs = 10 * 60 * 1000, pollMs = 5000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try { mkdirSync(lock); break; } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      if (Date.now() >= deadline) throw new Error(`Another run holds the lock ${lock}, and it was not released within ${Math.round(timeoutMs / 1000)} seconds. If a stopped capture left it, check that no capture or e2e run is active, then remove that empty folder by hand.`);
      sleep(pollMs);
    }
  }
  try { return fn(); } finally { try { rmdirSync(lock); } catch (error) { if (error?.code !== 'ENOENT') throw error; } }
}
