#!/usr/bin/env node
/**
 * `bowerloom-guard`: the entry Claude Code runs as a PreToolUse hook (spec 05, section 3.9). It runs the hook form only.
 * This file loads nothing at start, so the guard modules load on one dynamic import and a failed import is caught here:
 * the route prints a deny line and returns 0, and it calls no exit function, so stdout drains to a pipe on macOS.
 */
import { homedir } from 'node:os';

const STOP = 'Bowerloom guard: the guard could not run, so the call is blocked. Run bowerloom apply, or reinstall Bowerloom.';
const deny = (reason: string): string => `${JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } })}\n`;

// Track 11 of beta.3, follow-up item 2 (decided: fail closed): any error on stdout or stderr, EPIPE among them, means
// Claude Code may not have the answer, so the guard exits 2, which blocks the call, and never crashes with exit 1.
// The same rule as failClosedOnBrokenPipe in broken-pipe.ts, written out here so this file still loads nothing.
const LOST = 'Bowerloom guard: the hook output could not be written, so the call is blocked.';
let lost = false;
const broken = (): void => {
  if (lost) return; lost = true; process.exitCode = 2;
  try { process.stderr.write(`${LOST}\n`); } catch { /* stderr is gone too */ }
};
process.stdout.on('error', broken); process.stderr.on('error', broken);
process.on('exit', () => { if (lost) process.exitCode = 2; });

async function main(): Promise<void> {
  try {
    const { runGuard } = await import('./guard-run.js');
    process.exitCode = await runGuard(process.argv.slice(2), {
      stdin: process.stdin, out: text => { process.stdout.write(text); }, err: text => { process.stderr.write(text); }, env: process.env, home: homedir(), cwd: process.cwd(),
    });
  } catch {
    try { process.stdout.write(deny(STOP)); process.exitCode = 0; } catch { process.exitCode = 2; }
  }
}
void main();
