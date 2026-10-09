#!/usr/bin/env node
// Test tooling, never shipped. Every test script runs `node --test` through this file:
//   node tools/run-node-tests.mjs <the node --test arguments, without --test>
// It starts `node --test <arguments>` as a child with inherited stdio, in its own process group, and exits with the
// child's exit code. One wall-clock limit bounds the whole run: past it, the child's whole process group is killed
// and this runner exits 124 with a message naming the limit. The limit is 45 minutes. BOWERLOOM_TEST_WALL_LIMIT_SECONDS
// can lower it, never raise it. It replaces --test-force-exit, which once ended a run with results missing and exit 0.
import { spawn } from 'node:child_process';
import os from 'node:os';

const DEFAULT_LIMIT_SECONDS = 45 * 60;
const LIMIT_VAR = 'BOWERLOOM_TEST_WALL_LIMIT_SECONDS';
const TIMED_OUT_EXIT = 124;
const GRACE_MS = 5000;
const FORWARDED = ['SIGINT', 'SIGTERM', 'SIGHUP'];

const say = line => process.stderr.write(`run-node-tests: ${line}\n`);

/** The limit in seconds, or a refusal: the variable must be a whole number of seconds above zero. */
function limitSeconds(value) {
  if (value === undefined) return { seconds: DEFAULT_LIMIT_SECONDS };
  if (!/^[1-9][0-9]*$/.test(value)) return { refused: `${LIMIT_VAR}=${JSON.stringify(value)} is not a whole number of seconds above 0; no tests were run.` };
  const asked = Number(value);
  if (asked > DEFAULT_LIMIT_SECONDS) return { seconds: DEFAULT_LIMIT_SECONDS, note: `${LIMIT_VAR}=${value} can only lower the limit; using the default of ${DEFAULT_LIMIT_SECONDS} s.` };
  return { seconds: asked };
}

function killGroup(pid, signal) {
  try { process.kill(-pid, signal); } catch (error) { if (error.code !== 'ESRCH') throw error; }
}

function main() {
  const limit = limitSeconds(process.env[LIMIT_VAR]);
  if (limit.refused) { say(limit.refused); process.exitCode = 2; return; }
  if (limit.note) say(limit.note);

  // detached: the child leads a new process group, so one kill reaches node --test and every test process under it.
  const child = spawn(process.execPath, ['--test', ...process.argv.slice(2)], { stdio: 'inherit', detached: true });
  let timedOut = false, forwarded = null, grace = null;

  const timer = setTimeout(() => {
    timedOut = true;
    say(`the run passed its wall-clock limit of ${limit.seconds} s (default ${DEFAULT_LIMIT_SECONDS} s = 45 min; ${LIMIT_VAR} can lower it). `
      + `Killing the node --test process group ${child.pid}. The run FAILED; its results are incomplete.`);
    killGroup(child.pid, 'SIGTERM');
    grace = setTimeout(() => killGroup(child.pid, 'SIGKILL'), GRACE_MS);
  }, limit.seconds * 1000);

  // The child is no longer in the terminal's process group, so an interrupt sent to this runner is passed on.
  const handlers = FORWARDED.map(signal => {
    const handler = () => { forwarded ??= signal; killGroup(child.pid, signal); };
    process.on(signal, handler); return [signal, handler];
  });

  child.on('error', error => { clearTimeout(timer); say(`could not start node --test: ${error.message}`); process.exitCode = 1; });
  child.on('exit', (code, signal) => {
    clearTimeout(timer); clearTimeout(grace);
    for (const [name, handler] of handlers) process.off(name, handler);
    if (timedOut || forwarded) killGroup(child.pid, 'SIGKILL'); // test processes the stopped run left behind
    if (timedOut) { process.exitCode = TIMED_OUT_EXIT; return; }
    // A run stopped from outside never counts as a pass, whatever node --test returned.
    if (forwarded) { say(`the run was stopped by ${forwarded}; it FAILED and its results are incomplete.`); process.exitCode = 128 + os.constants.signals[forwarded]; return; }
    if (code !== null) { process.exitCode = code; return; }
    say(`node --test ended by signal ${signal}; the run FAILED.`);
    process.exitCode = 128 + (os.constants.signals[signal] ?? 0);
  });
}

main();
