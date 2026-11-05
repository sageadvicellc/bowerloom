/**
 * The machine-wide e2e lock: a folder that one process makes and removes. `withLock` waits for it with a deadline, runs a function, and always removes the lock it made,
 * also when the function throws. It writes its process id to an `owner` file inside the folder. It never removes a lock that a live process holds. It reclaims a lock only
 * when that lock carries an `owner` file whose process is gone, which is what an interrupted run of this script leaves. A lock with no `owner` file comes from another tool
 * and is only waited for.
 */
import { mkdirSync, readFileSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const sleep = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const alive = pid => { try { process.kill(pid, 0); return true; } catch (error) { return error?.code === 'EPERM'; } };
const ownerOf = lock => { try { return Number.parseInt(readFileSync(join(lock, 'owner'), 'utf8'), 10); } catch { return null; } };
const removeQuietly = (fn, path) => { try { fn(path); } catch (error) { if (error?.code !== 'ENOENT') throw error; } };

/** Removes a lock this process made. A folder that is already gone is not an error. */
function release(lock) {
  if (ownerOf(lock) !== process.pid) return;
  removeQuietly(unlinkSync, join(lock, 'owner'));
  removeQuietly(rmdirSync, lock);
}

/** Takes the lock, runs `fn`, and releases the lock. Throws an error that names the lock path when the lock is not free before `timeoutMs`. */
export function withLock(lock, fn, { timeoutMs = 10 * 60 * 1000, pollMs = 5000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try { mkdirSync(lock); writeFileSync(join(lock, 'owner'), String(process.pid)); break; } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      const owner = ownerOf(lock);
      if (Number.isInteger(owner) && owner !== process.pid && !alive(owner)) {
        removeQuietly(unlinkSync, join(lock, 'owner'));
        removeQuietly(rmdirSync, lock);
        continue;
      }
      if (Date.now() >= deadline) throw new Error(`Another run holds the lock ${lock}, and it was not released within ${Math.round(timeoutMs / 1000)} seconds. If no run is going, remove that folder by hand.`);
      sleep(pollMs);
    }
  }
  try { return fn(); } finally { release(lock); }
}
