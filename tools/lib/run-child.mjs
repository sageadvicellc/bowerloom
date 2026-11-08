// Shared by tools/gates.mjs and tools/lane-tree.mjs. Test and release tooling, never shipped.
// It runs one child process the way tools/verify.mjs and tools/run-node-tests.mjs do: in its own process group, with a time limit and an
// output cap, and it kills the whole group on a timeout. Secret variables (see safe-env.mjs) are removed from the child's environment.
import { spawn } from 'node:child_process';
import { statfsSync } from 'node:fs';
import { scrubEnv } from './safe-env.mjs';
import { trackGroup, untrackGroup, isStopping } from './interrupt.mjs';

export const GIB = 1024 ** 3;
const KILL_GRACE_MS = 2000;
// After the child exits, its output pipes get this long to close. A grandchild that holds a pipe open must not hang the caller.
const PIPE_GRACE_MS = 2000;

/** Free bytes for an unprivileged user on the volume that holds `dir`. */
export function freeBytes(dir) {
  const stats = statfsSync(dir);
  return stats.bavail * stats.bsize;
}

function killGroup(pid, signal) {
  try { process.kill(-pid, signal); } catch (error) { if (error.code !== 'ESRCH') throw error; }
}

/**
 * Runs `command` with `args` and resolves; it never rejects.
 * Options: `cwd`, `env` (overrides, scrubbed), `keepEnv` (names of the ssh agent variables, SSH_AUTH_SOCK and SSH_AGENT_PID, to pass on; pass it for git commands only, never for npm, node, a gate, or pack), `timeoutMs` (default 10 minutes), `maxBytes` (default 4 MiB; output past it stops the run), `stdin` (text), `encoding` (how output bytes are decoded; default 'utf8', 'latin1' keeps every byte).
 * The result has `code`, `signal`, `reason` (null, 'TIME_LIMIT', 'LOG_LIMIT', or 'START_FAILED'), `rawBytes` (all bytes seen), `output` (the first
 * `maxBytes` as text, stdout and stderr in arrival order), `stdout` and `stderr` (the same text, split), `ms`, and `message` (set when the reason is not null).
 * It resolves when the child exits and its pipes close, or 2 s after the exit if a grandchild still holds a pipe (the group is then killed).
 */
export function runChild(command, args, { cwd, env, timeoutMs = 10 * 60 * 1000, maxBytes = 4 * 1024 * 1024, stdin = null, encoding = 'utf8', keepEnv = [] } = {}) {
  return new Promise(resolve => {
    const started = performance.now();
    if (isStopping()) {
      resolve({ code: null, signal: null, reason: 'START_FAILED', rawBytes: 0, output: '', stdout: '', stderr: '', ms: 0, message: 'the tool is stopping after a signal; no new child was started' });
      return;
    }
    const posix = process.platform !== 'win32';
    let child;
    try {
      child = spawn(command, args, { cwd, env: scrubEnv({ ...process.env, ...(env ?? {}) }, { keep: keepEnv }), stdio: [stdin === null ? 'ignore' : 'pipe', 'pipe', 'pipe'], detached: posix });
    } catch (error) {
      resolve({ code: null, signal: null, reason: 'START_FAILED', rawBytes: 0, output: '', stdout: '', stderr: '', ms: 0, message: error.message });
      return;
    }
    if (posix) trackGroup(child.pid);
    const chunks = [], outChunks = [], errChunks = [];
    let rawBytes = 0, kept = 0, reason = null, message = null, killTimer = null, graceTimer = null, finished = false, exitInfo = null;
    const kill = signal => { try { if (posix && child.pid) killGroup(child.pid, signal); else child.kill(signal); } catch { /* The group already stopped. */ } };
    const abort = (why, text) => {
      if (reason) return;
      reason = why; message = text;
      kill('SIGTERM');
      killTimer = setTimeout(() => kill('SIGKILL'), KILL_GRACE_MS);
    };
    const timer = setTimeout(() => abort('TIME_LIMIT', `${command} ran past its limit of ${Math.round(timeoutMs / 1000)} s and its process group was killed`), timeoutMs);
    const finish = (code, signal) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer); clearTimeout(killTimer); clearTimeout(graceTimer);
      // Whatever the run ended with, members of the group may be left behind (a background process that holds no pipe). Kill them; a group with no
      // member left answers ESRCH, which is ignored.
      kill('SIGKILL');
      if (posix) untrackGroup(child.pid);
      resolve({ code, signal, reason, rawBytes, output: Buffer.concat(chunks).toString(encoding), stdout: Buffer.concat(outChunks).toString(encoding), stderr: Buffer.concat(errChunks).toString(encoding), ms: Math.round(performance.now() - started), message });
    };
    const collect = into => chunk => {
      rawBytes += chunk.length;
      if (kept < maxBytes) { const piece = chunk.subarray(0, maxBytes - kept); chunks.push(piece); into.push(piece); kept += piece.length; }
      if (rawBytes > maxBytes) abort('LOG_LIMIT', `${command} wrote more than ${maxBytes} bytes and its process group was killed`);
    };
    child.stdout.on('data', collect(outChunks));
    child.stderr.on('data', collect(errChunks));
    child.stdout.on('error', () => {});
    child.stderr.on('error', () => {});
    if (stdin !== null) {
      child.stdin.on('error', () => {}); // The child may exit before it reads (EPIPE).
      child.stdin.end(stdin);
    }
    child.once('error', error => { if (!reason) { reason = 'START_FAILED'; message = error.message; } });
    child.once('exit', (code, signal) => {
      exitInfo = { code, signal, strayed: false };
      graceTimer = setTimeout(() => {
        exitInfo.strayed = true;
        child.stdout.destroy(); child.stderr.destroy();
        finish(code, signal);
      }, PIPE_GRACE_MS);
    });
    child.once('close', (code, signal) => finish(code, signal));
  });
}
