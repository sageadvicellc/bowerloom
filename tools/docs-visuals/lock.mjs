/**
 * The machine-wide e2e lock: a folder that one process makes and removes. `withLock` waits for it with a deadline, runs a function, and always removes the lock it made,
 * also when the function throws. It writes its process id to an `owner` file inside the folder. It never removes a lock that a live process holds. It reclaims a lock only
 * when that lock carries an `owner` file whose process is gone, which is what an interrupted run of this script leaves. A lock with no `owner` file comes from another tool
 * and is only waited for.
 * One limit: a SIGTERM sent to the capture script alone can leave its Playwright child running while the lock reads as stale. Ctrl-C reaches both, because they share a
 * process group.
 */
import { mkdirSync, readFileSync, renameSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const sleep = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const alive = pid => { try { process.kill(pid, 0); return true; } catch (error) { return error?.code === 'EPERM'; } };
const ownerOf = (folder, file = join(folder, 'owner')) => { try { const pid = Number.parseInt(readFileSync(file, 'utf8'), 10); return pid > 0 ? pid : null; } catch { return null; } };
const quietly = fn => { try { fn(); } catch (error) { if (error?.code !== 'ENOENT') throw error; } };
const removeFolder = folder => { quietly(() => unlinkSync(join(folder, 'owner'))); quietly(() => rmdirSync(folder)); };

/**
 * Reclaims a lock whose owner `deadPid` is gone. Only the `owner` file moves, with one atomic rename inside the folder, so the lock path stays taken the whole time
 * and, when two waiters race, only one of them moves it. If the moved file names another owner (a new lock made between the check and the move), it is put back.
 * Returns true when the stale lock is gone or another waiter already took it.
 */
export function reclaimStale(lock, deadPid) {
  const owner = join(lock, 'owner');
  const aside = join(lock, `owner.stale-${process.pid}-${Date.now()}`);
  try { renameSync(owner, aside); } catch (error) { if (error?.code === 'ENOENT') return true; throw error; }
  if (ownerOf(lock, aside) !== deadPid) { renameSync(aside, owner); return false; }
  quietly(() => unlinkSync(aside));
  quietly(() => rmdirSync(lock));
  return true;
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
    try { writeFileSync(join(lock, 'owner'), String(process.pid)); } catch (error) { try { removeFolder(lock); } catch { /* the write error below is the one to report */ } throw error; }
    break;
  }
  try { return fn(); } finally { if (ownerOf(lock) === process.pid) removeFolder(lock); }
}
