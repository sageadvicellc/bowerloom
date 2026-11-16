#!/usr/bin/env node
// `bowerloom`: the old name of the CLI. It prints one notice on stderr when a person is at a terminal, then runs `latebrake` in
// this process. It loads its helpers on dynamic imports so that a broken install is caught here and gets the right exit code.
const args = process.argv.slice(2);
// The hook form blocks a tool call on exit 2 and on no other code, so it fails with 2 and never prints a notice.
const hookForm = args[0] === 'context' && args[1] === 'guard';

async function main() {
  try {
    const { writeSync, fstatSync } = await import('node:fs');
    const { NOTICE, shouldNotice } = await import('../lib/notice.js');
    let stderrOpen = true;
    try { fstatSync(2); } catch { stderrOpen = false; }
    if (shouldNotice({ args, stdoutIsTTY: process.stdout.isTTY, stderrOpen })) {
      try { writeSync(2, `${NOTICE}\n`); } catch { /* the notice is a courtesy; the command still runs */ }
    }
    const { forward } = await import('../lib/forward.js');
    await forward('latebrake');
  } catch {
    try { process.stderr.write('bowerloom: could not start latebrake. Install it with: npm install -g latebrake\n'); } catch { /* stderr is gone */ }
    process.exitCode = hookForm ? 2 : 1;
  }
}
void main();
