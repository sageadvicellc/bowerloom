/**
 * The machine-wide e2e lock: a folder that one process makes and removes. `withLock` waits for it with a deadline, runs a function, and always removes the lock it made,
 * also when the function throws. It writes its process id to an `owner` file inside the folder. It never removes a lock that a live process holds. It reclaims a lock only
 * when that lock carries an `owner` file whose process is gone, which is what an interrupted run of this script leaves. A lock with no `owner` file comes from another tool
 * and is only waited for.
 */
import { mkdirSync, readFileSync, renameSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const sleep = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const alive = pid => { try { process.kill(pid, 0); return true; } catch (error) { return error?.code === 'EPERM'; } };
const ownerOf = folder => { try { const pid = Number.parseInt(readFileSync(join(folder, 'owner'), 'utf8'), 10); return pid > 0 ? pid : null; } catch { return null; } };
const quietly = fn => { try { fn(); } catch (error) { if (error?.code !== 'ENOENT') throw error; } };
const removeFolder = folder => { quietly(() => unlinkSync(join(folder, 'owner'))); quietly(() => rmdirSync(folder)); };

/**
 * Reclaims a lock whose owner `deadPid` is gone. The folder is first moved aside with one atomic rename, so when two waiters race only one of them moves it.
 * If the moved folder turns out to name another owner (a new lock made between the check and the move), it is put back. Returns true when the stale lock is gone.
 */
export function reclaimStale(lock, deadPid) {
  const aside = `${lock}.stale-${process.pid}-${Date.now()}`;
  try { renameSync(lock, aside); } catch (error) { if (error?.code === 'ENOENT') return true; throw error; }
  if (ownerOf(aside) === deadPid) { removeFolder(aside); return true; }
  try { renameSync(aside, lock); } catch { throw new Error(`The lock ${lock} changed owner while it was being reclaimed. Its folder is at ${aside}; check that no run is going, then remove both by hand.`); }
  return false;
}

/** Takes the lock, runs `fn`, and releases the lock. Throws an error that names the lock path when the lock is not free before `timeoutMs`. */
export function withLock(lock, fn, { timeoutMs = 10 * 60 * 1000, pollMs = 5000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try { mkdirSync(lock); } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      const owner = ownerOf(lock);
      if (owner !== null && owner !== process.pid && !alive(owner) && reclaimStale(lock, owner)) continue;
      if (Date.now() >= deadline) throw new Error(`Another run holds the lock ${lock}, and it was not released within ${Math.round(timeoutMs / 1000)} seconds. If no run is going, remove that folder by hand.`);
      sleep(pollMs);
      continue;
    }
    try { writeFileSync(join(lock, 'owner'), String(process.pid)); } catch (error) { removeFolder(lock); throw error; }
    break;
  }
  try { return fn(); } finally { if (ownerOf(lock) === process.pid) removeFolder(lock); }
}
