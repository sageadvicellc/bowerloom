#!/usr/bin/env node
/**
 * `bowerloom-guard`: the old name of the hook entry that Claude Code runs before a tool call. It runs `latebrake-guard` in
 * this process. Like the guard entry it forwards to, it imports nothing at start, so a failed load is caught here: the route
 * prints one deny line on stdout and returns 0, and it calls no exit function, so stdout drains to a pipe on macOS.
 * It never writes a notice, because stdout carries the hook's answer.
 */
// The reason goes back to the model, so it describes the fault and gives no command to run.
const STOP = 'Bowerloom guard: the guard could not run because the latebrake package is missing or cannot load, so the call is blocked.';
const deny = reason => `${JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } })}\n`;

// Any error on stdout or stderr, a broken pipe among them, means Claude Code may not have the answer. The guard then exits 2,
// which blocks the call, and never exits 1, which does not.
const LOST = 'Bowerloom guard: the hook output could not be written, so the call is blocked.';
let lost = false;
const broken = () => {
  if (lost) return; lost = true; process.exitCode = 2;
  try { process.stderr.write(`${LOST}\n`); } catch { /* stderr is gone too */ }
};
process.stdout.on('error', broken); process.stderr.on('error', broken);
process.on('exit', () => { if (lost) process.exitCode = 2; });

async function main() {
  try {
    const { forward } = await import('../lib/forward.js');
    await forward('latebrake-guard');
  } catch {
    try { process.stdout.write(deny(STOP)); process.exitCode = 0; } catch { process.exitCode = 2; }
  }
}
void main();
