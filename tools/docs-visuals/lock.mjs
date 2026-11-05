/**
 * The machine-wide e2e lock: a folder that one process makes and removes. `withLock` waits for it with a deadline, runs a function, and always removes the lock it made,
 * also when the function throws. It never removes a lock that another process holds: it removes the folder only after its own `mkdir` made it.
 */
import { mkdirSync, rmdirSync } from 'node:fs';

const sleep = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/** Takes the lock, runs `fn`, and releases the lock. Throws an error that names the lock path when the lock is not free before `timeoutMs`. */
export function withLock(lock, fn, { timeoutMs = 10 * 60 * 1000, pollMs = 5000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try { mkdirSync(lock); break; } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      if (Date.now() >= deadline) throw new Error(`Another run holds the lock ${lock}, and it was not released within ${Math.round(timeoutMs / 1000)} seconds. If no run is going, remove that empty folder by hand.`);
      sleep(pollMs);
    }
  }
  try { return fn(); } finally { rmdirSync(lock); }
}
