#!/usr/bin/env node
/**
 * `bowerloom-guard`: the entry Claude Code runs as a PreToolUse hook (spec 05, section 3.9). It runs the hook form only.
 * This file loads nothing at start, so the guard modules load on one dynamic import and a failed import is caught here:
 * the route prints a deny line and returns 0, and it calls no exit function, so stdout drains to a pipe on macOS.
 */
import { homedir } from 'node:os';

const STOP = 'Bowerloom guard: the guard could not run, so the call is blocked. Run bowerloom apply, or reinstall Bowerloom.';
const deny = (reason: string): string => `${JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } })}\n`;

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
