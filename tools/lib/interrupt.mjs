// Shared by the release and lane tooling. Never shipped. On SIGINT, SIGTERM, or SIGHUP a tool must stop its children, release what it holds, and exit 130.
// run-child.mjs records each live child process group here. A tool registers cleanup functions (remove a temp folder, release the e2e lock) with
// onInterrupt; they also run on a normal exit through runCleanups. The pattern follows tools/run-node-tests.mjs.
import { redact } from './safe-env.mjs';

export const INTERRUPT_EXIT = 130;
const SIGNALS = ['SIGINT', 'SIGTERM', 'SIGHUP'];
const TERM_GRACE_MS = 1500;
const live = new Set();
const cleanups = new Set();
let installed = null;
let stopping = false;

/** True once a signal has arrived and the tool is shutting down. runChild starts no new child then. */
export const isStopping = () => stopping;

/** Records a live child process group (its leader's pid). */
export function trackGroup(pid) { if (pid) live.add(pid); }
export function untrackGroup(pid) { live.delete(pid); }
export const liveGroupCount = () => live.size;

function killGroup(pid, signal) {
  try { process.kill(-pid, signal); } catch (error) { if (error.code !== 'ESRCH' && error.code !== 'EPERM') throw error; }
}

/** Sends `signal` to every live child group. */
export function killLiveGroups(signal) { for (const pid of live) killGroup(pid, signal); }

/** Registers a synchronous cleanup. Returns a function that removes it. Cleanups run once each, newest first. */
export function onInterrupt(fn) { cleanups.add(fn); return () => cleanups.delete(fn); }

const defaultSay = line => process.stderr.write(line + '\n');

/** Runs and clears every registered cleanup. An error in one never stops the others; it is said as one line on stderr (through `say`). */
export function runCleanups(say = defaultSay) {
  for (const fn of [...cleanups].reverse()) {
    cleanups.delete(fn);
    try { fn(); } catch (error) {
      const line = `cleanup failed: ${redact(error?.message ?? String(error)).split('\n')[0].slice(0, 200)}`;
      try { say(line); } catch { /* stderr is closed: nothing more to do. */ }
    }
  }
}

/**
 * Installs the three signal handlers once. On a signal: TERM every live child group, wait a short grace, KILL what is left, run the cleanups, and
 * exit 130. `exit` can be replaced in tests. Returns a function that removes the handlers.
 */
export function installInterruptHandlers({ exit = code => process.exit(code), say = defaultSay } = {}) {
  if (installed) return installed;
  const handlers = SIGNALS.map(signal => {
    const handler = () => {
      if (stopping) return;
      stopping = true;
      say(`interrupted by ${signal}; stopping child processes and cleaning up`);
      killLiveGroups('SIGTERM');
      setTimeout(() => {
        killLiveGroups('SIGKILL');
        runCleanups(say);
        exit(INTERRUPT_EXIT);
      }, live.size ? TERM_GRACE_MS : 0);
    };
    process.on(signal, handler);
    return [signal, handler];
  });
  installed = () => { for (const [signal, handler] of handlers) process.off(signal, handler); installed = null; stopping = false; };
  return installed;
}
